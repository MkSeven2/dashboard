// script.js

/**
 * @fileoverview Frontend logic for the Saber Teacher Dashboard.
 * Handles WebSocket communication, UI updates, and user interactions.
 *
 * AI Maintainer Instructions:
 * - CONFIG: Central place for settings (WebSocket URL, defaults). Update wsUrl here.
 * - WebSocket Handling: See connectWebSocket, handleWebSocketMessage, sendMessageToServer. Message structure is { type: string, data: any }.
 * - UI Updates: Functions like addStudentCard, updateStudentCard, updateTabsList handle DOM manipulation. Use data-* attributes for identifying elements.
 * - Event Handling: Event delegation is used. Listeners are attached to #controls-panel and #students-container. Actions are determined by `event.target.dataset.action`.
 * - State Management: `connectedStudents` Map stores { clientId: { email: string, element: HTMLElement } }.
 * - Command Sending: `sendCommand` is the primary function. `sendGlobalCommand` handles actions for all/selected students.
 * - Extensibility: To add new commands, define the command string, update the server to handle it, and add a corresponding button/control with the correct `data-action` and payload generation in `handleControlPanelAction` or `handleStudentCardAction`.
 * - Error Handling: Basic try/catch and WebSocket error/close events. Consider a more robust notification system than alert().
 */

(function() {
    'use strict';

    // --- Configuration ---
    const CONFIG = {
        // !!! IMPORTANT: Update this URL to your actual WebSocket server endpoint !!!
        // wsUrl: 'wss://your-websocket-server-url.onrender.com', // Example Render URL
        wsUrl: 'wss://extension.mkseven1.com', // Example Local URL (use wss for secure connections)
        defaultScreenshotInterval: 5000, // ms
        minScreenshotInterval: 1000, // ms
        reconnectDelay: 5000, // ms
        pingInterval: 30000, // ms (send ping to keep connection alive)
        defaultFavicon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkIAAYIBAAJBtnBAAAAABJRU5ErkJggg==', // Transparent pixel
        announcementDuration: 7000 // ms
    };

    // --- DOM Element References ---
    const dom = {
        header: document.querySelector('.dashboard-header'),
        connectionStatus: document.getElementById('connection-status'),
        controlsPanel: document.getElementById('controls-panel'),
        studentSearchInput: document.getElementById('student-search-input'),
        targetStudentSelect: document.getElementById('target-student-select'),
        blocklistInput: document.getElementById('blocklist-input'),
        screenshotIntervalInput: document.getElementById('screenshot-interval-input'),
        studentsContainer: document.getElementById('students-container'),
        studentsPlaceholder: document.getElementById('students-placeholder')
        // Add other frequently accessed elements if needed
    };

    // --- State Variables ---
    let teacherSocket = null;
    let connectedStudents = new Map(); // Map<clientId, { email: string, element: HTMLElement, lastUpdate: number, tabs: object }>
    let reconnectTimer = null;
    let pingTimer = null;

    // === WebSocket Management ===

    /**
     * Establishes or re-establishes the WebSocket connection.
     * @param {boolean} isReconnect - Indicates if this is a reconnection attempt.
     */
    function connectWebSocket(isReconnect = false) {
        if (teacherSocket && (teacherSocket.readyState === WebSocket.OPEN || teacherSocket.readyState === WebSocket.CONNECTING)) {
            console.log("WebSocket connection already open or connecting.");
            return;
        }

        clearTimeout(reconnectTimer); // Clear any pending reconnect timer
        clearInterval(pingTimer); // Clear any pending ping timer

        updateConnectionStatus('connecting', isReconnect ? 'Reconnecting...' : 'Connecting...');
        console.log(`Attempting WebSocket connection to ${CONFIG.wsUrl}`);

        try {
            teacherSocket = new WebSocket(CONFIG.wsUrl);

            teacherSocket.onopen = handleWebSocketOpen;
            teacherSocket.onmessage = handleWebSocketMessage;
            teacherSocket.onclose = handleWebSocketClose;
            teacherSocket.onerror = handleWebSocketError;

        } catch (error) {
            console.error("Failed to create WebSocket:", error);
            updateConnectionStatus('error', 'Failed to initialize connection');
            scheduleReconnect(); // Schedule a reconnect even if creation fails
        }
    }

    /** Handles the WebSocket connection opening. */
    function handleWebSocketOpen() {
        updateConnectionStatus('connected', 'Connected');
        console.log('WebSocket connection established.');
        sendMessageToServer({ type: 'teacher_connect' }); // Identify as teacher
        // Request initial state immediately after connection
        sendMessageToServer({ type: 'get_initial_state' }); // Server needs to handle this
        startPing();
    }

    /**
     * Handles incoming WebSocket messages.
     * @param {MessageEvent} event - The WebSocket message event.
     */
    function handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
             console.debug('Message received:', message.type, message.data); // More detailed logging for debug

            // --- AI Instruction: Message Handling ---
            // Add cases here to handle new message types from the server.
            // Ensure data structure matches server output.
            switch (message.type) {
                case 'initial_state': // Combined initial load
                    handleInitialState(message.data);
                    break;
                case 'student_connected':
                    handleStudentConnected(message.data);
                    break;
                case 'student_disconnected':
                    handleStudentDisconnected(message.data);
                    break;
                case 'student_screenshot':
                    handleStudentScreenshot(message.data.clientId, message.data.payload);
                    break;
                case 'student_tabs_update':
                    handleStudentTabsUpdate(message.data.clientId, message.data.payload);
                    break;
                // Add cases for student_tab_created, _updated, _removed if server sends incremental updates
                case 'command_failed':
                    showNotification(`Command failed for student ${message.data.targetClientId}: ${message.data.reason}`, 'error');
                    break;
                case 'pong': // Response to our ping
                    // console.debug('Pong received from server.');
                    break;
                case 'error': // General error message from server
                    showNotification(`Server Error: ${message.message || 'Unknown error'}`, 'error');
                    break;
                default:
                    console.warn('Received unhandled message type:', message.type);
            }
        } catch (error) {
            console.error('Error processing WebSocket message or invalid JSON:', error, event.data);
             showNotification('Received malformed data from server.', 'error');
        }
    }

    /** Handles the WebSocket connection closing. */
    function handleWebSocketClose(event) {
        const reason = event.reason || `Code: ${event.code}`;
        updateConnectionStatus('disconnected', `Disconnected (${reason})`);
        console.warn(`WebSocket connection closed: ${reason}. Attempting reconnect...`);
        cleanupConnection();
        scheduleReconnect();
    }

    /** Handles WebSocket errors. */
    function handleWebSocketError(error) {
        updateConnectionStatus('error', 'Connection error');
        console.error('WebSocket Error:', error);
        // 'onclose' usually fires immediately after 'onerror', so reconnect logic is handled there.
        // cleanupConnection(); // Ensure cleanup happens if onclose doesn't fire for some reason
    }

    /** Cleans up timers and resets state on disconnect/error. */
    function cleanupConnection() {
         clearInterval(pingTimer);
         clearTimeout(reconnectTimer);
         pingTimer = null;
         reconnectTimer = null;
         teacherSocket = null; // Ensure socket object is cleared
         // Clear UI elements reflecting connected state
         resetUIForDisconnect();
    }

     /** Resets UI elements to a disconnected state. */
    function resetUIForDisconnect() {
        dom.studentsContainer.innerHTML = ''; // Clear all student cards
        dom.studentsPlaceholder.textContent = 'Connection lost. Attempting to reconnect...';
        dom.studentsPlaceholder.classList.remove('hidden');
        dom.targetStudentSelect.innerHTML = '<option value="all">-- All Connected Students --</option>'; // Reset dropdown
        connectedStudents.clear(); // Clear student state map
        // Optionally disable controls that require a connection
         dom.controlsPanel.querySelectorAll('button, input, select, textarea').forEach(el => el.disabled = true);
         dom.connectionStatus.classList.remove('status-connected', 'status-error', 'status-connecting');
         dom.connectionStatus.classList.add('status-disconnected');
    }

    /** Schedules a reconnection attempt. */
    function scheduleReconnect() {
         // Avoid scheduling multiple reconnects
         if (reconnectTimer) return;

         // Optionally implement exponential backoff here
         reconnectTimer = setTimeout(() => {
             connectWebSocket(true); // Pass true to indicate it's a reconnect attempt
             reconnectTimer = null; // Clear timer ID after execution
         }, CONFIG.reconnectDelay);
         console.log(`Scheduled reconnect attempt in ${CONFIG.reconnectDelay / 1000} seconds.`);
    }


    /** Starts sending periodic pings to the server. */
    function startPing() {
        clearInterval(pingTimer); // Clear existing timer if any
        pingTimer = setInterval(() => {
            sendMessageToServer({ type: 'ping' });
            // console.debug("Ping sent");
        }, CONFIG.pingInterval);
    }


    /**
     * Sends a JSON message to the WebSocket server.
     * @param {object} payload - The JavaScript object to send.
     * @returns {boolean} True if the message was sent, false otherwise.
     */
    function sendMessageToServer(payload) {
        if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
            try {
                const message = JSON.stringify(payload);
                teacherSocket.send(message);
                // console.debug("Message sent:", payload.type);
                return true;
            } catch (error) {
                console.error("Error sending WebSocket message:", error, payload);
                showNotification("Failed to send data to server.", "error");
                return false;
            }
        } else {
            console.warn("WebSocket not open. Message not sent:", payload);
            showNotification("Cannot send command: Not connected to the server.", "warning");
            return false;
        }
    }

    // === Message Handling Logic ===

    /**
     * Handles the initial state message from the server.
     * @param {object} data - Expected: { students: Array<{clientId: string, email: string, tabs?: object, screenshot?: {imageData: string, timestamp: number}}> }
     */
    function handleInitialState(data) {
        console.log("Processing initial state:", data);
        // Clear existing students before processing initial list
        dom.studentsContainer.innerHTML = '';
        dom.targetStudentSelect.innerHTML = '<option value="all">-- All Connected Students --</option>';
        connectedStudents.clear();

        if (data && Array.isArray(data.students)) {
            data.students.forEach(studentData => {
                addStudent(studentData.clientId, studentData.email);
                // Optionally update initial tabs/screenshot if provided
                if (studentData.tabs) {
                    handleStudentTabsUpdate(studentData.clientId, studentData.tabs);
                }
                if (studentData.screenshot) {
                    handleStudentScreenshot(studentData.clientId, studentData.screenshot);
                }
            });
        }
        updatePlaceholderVisibility();
        // Re-enable controls after connection is established and state received
        dom.controlsPanel.querySelectorAll('button, input, select, textarea').forEach(el => el.disabled = false);

    }

    /**
     * Handles a new student connecting.
     * @param {object} data - Expected: { clientId: string, email: string }
     */
    function handleStudentConnected(data) {
        if (data && data.clientId) {
            console.log(`Student connected: ${data.email} (${data.clientId})`);
            addStudent(data.clientId, data.email);
            updatePlaceholderVisibility();
            // Optional: Request initial tabs/screenshot for the new student
             sendCommand(data.clientId, 'get_tabs', {});
             sendCommand(data.clientId, 'get_screenshot', {});
        } else {
            console.warn("Received invalid student_connected message:", data);
        }
    }

     /**
     * Adds a student to the UI and state.
     * @param {string} clientId - The unique client ID.
     * @param {string} email - The student's email.
     */
    function addStudent(clientId, email) {
        if (!connectedStudents.has(clientId)) {
            const cardElement = createStudentCardElement(clientId, email);
            dom.studentsContainer.appendChild(cardElement);
            addStudentToSelect(clientId, email);
            connectedStudents.set(clientId, {
                email: email || 'Unknown Email',
                element: cardElement,
                lastUpdate: Date.now(),
                tabs: {} // Initialize tabs object
            });
        } else {
            console.warn(`Attempted to add duplicate student: ${clientId}`);
            // Update existing card's email if necessary
            const existingStudent = connectedStudents.get(clientId);
            if (existingStudent.email !== email) {
                 existingStudent.email = email || 'Unknown Email';
                 const titleElement = existingStudent.element.querySelector('.student-card-title');
                 if (titleElement) titleElement.textContent = `${email || 'N/A'}`;
                 // Update select dropdown text too
                 const option = dom.targetStudentSelect.querySelector(`option[value="${clientId}"]`);
                 if (option) option.textContent = formatStudentOptionText(clientId, email);
            }
        }
        filterStudents(); // Apply current search filter
    }


    /**
     * Handles a student disconnecting.
     * @param {object} data - Expected: { clientId: string }
     */
    function handleStudentDisconnected(data) {
        if (data && data.clientId) {
            const studentInfo = connectedStudents.get(data.clientId);
            if (studentInfo) {
                console.log(`Student disconnected: ${studentInfo.email} (${data.clientId})`);
                studentInfo.element.remove(); // Remove card from DOM
                removeStudentFromSelect(data.clientId);
                connectedStudents.delete(data.clientId);
                updatePlaceholderVisibility();
            }
        } else {
            console.warn("Received invalid student_disconnected message:", data);
        }
    }

    /**
     * Handles receiving a screenshot from a student.
     * @param {string} clientId - The ID of the student.
     * @param {object} payload - Expected: { imageData: string (data URL), timestamp?: number }
     */
    function handleStudentScreenshot(clientId, payload) {
        const studentInfo = connectedStudents.get(clientId);
        if (studentInfo && payload && payload.imageData) {
            const imgElement = studentInfo.element.querySelector('.screenshot-img');
            const timeElement = studentInfo.element.querySelector('.screenshot-time');
            if (imgElement) {
                imgElement.src = payload.imageData;
                imgElement.alt = `Screenshot from ${studentInfo.email}`; // Better alt text
            }
            if (timeElement) {
                // Use server timestamp if available, otherwise use local time
                const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
                timeElement.textContent = timestamp.toLocaleTimeString();
                timeElement.title = timestamp.toLocaleString(); // Show full date/time on hover
            }
            studentInfo.lastUpdate = Date.now(); // Update internal timestamp
        } else if (studentInfo) {
             console.warn(`Received screenshot data for ${clientId}, but payload was missing or invalid.`, payload);
        }
    }

    /**
     * Handles receiving updated tab information from a student.
     * @param {string} clientId - The ID of the student.
     * @param {object} tabsData - Key-value pair { tabId: { id, title, url, favIconUrl } }
     */
    function handleStudentTabsUpdate(clientId, tabsData) {
        const studentInfo = connectedStudents.get(clientId);
        if (studentInfo) {
            studentInfo.tabs = tabsData || {}; // Store the latest tabs data
            updateTabsList(studentInfo.element, clientId, studentInfo.tabs);
            studentInfo.lastUpdate = Date.now();
        } else {
             console.warn(`Received tabs update for unknown client ID: ${clientId}`);
        }
    }


    // === UI Manipulation ===

    /** Creates the HTML element for a student card.
     * @param {string} clientId
     * @param {string} email
     * @returns {HTMLElement} The created card element.
    */
    function createStudentCardElement(clientId, email) {
        const card = document.createElement('div');
        card.className = 'student-card';
        card.id = `student-${clientId}`;
        card.dataset.clientId = clientId; // Store clientId for event delegation
        card.dataset.email = email || 'Unknown Email'; // Store for searching

        // --- AI Instruction: Card Structure ---
        // Modify this template to change the layout or content of student cards.
        // Ensure elements have appropriate classes or data attributes for JS targeting.
        // Use `data-action` attributes on buttons for event delegation.
        card.innerHTML = `
            <h3>
                <span class="student-card-title">${email || 'N/A'}</span>
                <small>(${clientId})</small>
            </h3>
            <div class="screenshot-container">
                <img class="screenshot-img" src="${CONFIG.defaultFavicon}" alt="Student screenshot loading..." width="400" height="225">
                <p>Last updated: <span class="screenshot-time" title="No update received yet">Never</span></p>
            </div>
            <div class="student-controls">
                <button data-action="lock-screen" title="Lock this student's screen">Lock</button>
                <button data-action="unlock-screen" title="Unlock this student's screen">Unlock</button>
                <button data-action="open-tab" title="Open a new tab for this student">Open Tab</button>
                <button data-action="announce" title="Send an announcement to this student">Announce</button>
                <button data-action="refresh-data" class="action-button-secondary" title="Request updated screenshot and tabs">Refresh</button>
            </div>
            <div class="student-tabs">
                <h4>Tabs:</h4>
                <ul class="tabs-list"><li>Loading...</li></ul>
            </div>
        `;
        return card;
    }

     /**
     * Updates the list of tabs displayed in a student's card.
     * @param {HTMLElement} cardElement - The student's card element.
     * @param {string} clientId - The student's client ID.
     * @param {object} tabs - The tabs object { tabId: { id, title, url, favIconUrl } }.
     */
     function updateTabsList(cardElement, clientId, tabs) {
        const ul = cardElement.querySelector('.tabs-list');
        if (!ul) return;

        ul.innerHTML = ''; // Clear previous list

        const tabIds = Object.keys(tabs);

        if (tabIds.length > 0) {
            tabIds.forEach(tabId => {
                const tab = tabs[tabId];
                if (!tab || !tab.id) return; // Skip invalid data

                const li = document.createElement('li');
                const favIconUrl = (tab.favIconUrl && tab.favIconUrl.startsWith('http')) || (tab.favIconUrl && tab.favIconUrl.startsWith('data:'))
                    ? tab.favIconUrl
                    : CONFIG.defaultFavicon;

                // --- AI Instruction: Tab Item Structure ---
                // Modify this to change how individual tabs are displayed.
                // Ensure the close button has `data-action="close-tab"` and `data-tab-id`.
                li.innerHTML = `
                    <div class="tab-info">
                        <img src="${favIconUrl}" class="favicon" alt="" onerror="this.src='${CONFIG.defaultFavicon}'">
                        <span class="tab-title" title="${tab.url || ''}: ${tab.title || 'Untitled'}">${tab.title || 'Untitled Tab'}</span>
                    </div>
                    <button data-action="close-tab" data-tab-id="${tab.id}" title="Close this tab">×</button>
                 `;
                ul.appendChild(li);
            });
        } else {
            ul.innerHTML = '<li>No open tabs or data unavailable.</li>';
        }
    }

    /** Adds a student option to the target select dropdown. */
    function addStudentToSelect(clientId, email) {
        if (Array.from(dom.targetStudentSelect.options).some(opt => opt.value === clientId)) return; // Don't add duplicates
        const option = document.createElement('option');
        option.value = clientId;
        option.textContent = formatStudentOptionText(clientId, email);
        dom.targetStudentSelect.appendChild(option);
    }

     /** Formats the text displayed in the student select dropdown. */
    function formatStudentOptionText(clientId, email){
         return `${email || 'N/A'} (${clientId.substring(0, 6)}...)`; // Show partial ID
    }

    /** Removes a student option from the target select dropdown. */
    function removeStudentFromSelect(clientId) {
        const option = dom.targetStudentSelect.querySelector(`option[value="${clientId}"]`);
        if (option) option.remove();
        // If the removed student was selected, revert to "All"
        if (dom.targetStudentSelect.value === clientId) {
             dom.targetStudentSelect.value = 'all';
        }
    }

    /** Updates the visibility of the placeholder message. */
    function updatePlaceholderVisibility() {
        if (connectedStudents.size > 0) {
            dom.studentsPlaceholder.classList.add('hidden');
        } else {
             dom.studentsPlaceholder.classList.remove('hidden');
            // Message is updated in resetUIForDisconnect or set initially
            if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
                 dom.studentsPlaceholder.textContent = "Waiting for students to connect...";
            } // Otherwise, the reconnecting message is shown
        }
    }

    /**
     * Updates the connection status indicator in the header.
     * @param {'connecting' | 'connected' | 'disconnected' | 'error'} status
     * @param {string} [message=''] - Optional additional message.
     */
    function updateConnectionStatus(status, message = '') {
        dom.connectionStatus.className = `status-${status}`; // Remove old classes, add new one
        dom.connectionStatus.textContent = message || status.charAt(0).toUpperCase() + status.slice(1); // Capitalize status if no message
        dom.connectionStatus.title = message ? `${status.toUpperCase()}: ${message}` : status.toUpperCase(); // Tooltip
    }

    /**
     * Filters the visible student cards based on the search input.
     */
    function filterStudents() {
        const searchTerm = dom.studentSearchInput.value.toLowerCase().trim();
        let visibleCount = 0;

        connectedStudents.forEach((studentInfo, clientId) => {
            const emailLower = studentInfo.email.toLowerCase();
            const clientIdLower = clientId.toLowerCase();
            const isMatch = searchTerm === '' || emailLower.includes(searchTerm) || clientIdLower.includes(searchTerm);

            if (studentInfo.element) {
                 studentInfo.element.classList.toggle('hidden', !isMatch);
                 if (isMatch) visibleCount++;
            }
        });

        // Show placeholder if search yields no results but students are connected
        const noResults = connectedStudents.size > 0 && visibleCount === 0;
        dom.studentsPlaceholder.classList.toggle('hidden', !noResults);
        if (noResults) {
            dom.studentsPlaceholder.textContent = `No students found matching "${dom.studentSearchInput.value}".`;
        } else if (connectedStudents.size === 0) {
             // Ensure correct placeholder if no students are connected at all
             updatePlaceholderVisibility();
        }
    }

    /**
     * Displays a simple notification to the user.
     * @param {string} message - The message to display.
     * @param {'info' | 'success' | 'warning' | 'error'} type - The type of notification.
     */
    function showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] Notification:`, message);
        // TODO: Replace alert with a more user-friendly notification system (e.g., a toast library or a dedicated div)
        alert(`[${type.toUpperCase()}] ${message}`);
    }


    // === Command Sending ===

    /**
     * Sends a command message to a specific student or all students via WebSocket.
     * @param {string} targetClientId - The specific student's clientId, or 'all'.
     * @param {string} command - The command name (e.g., 'lock_screen', 'open_tab').
     * @param {object} [commandData={}] - Additional data payload for the command.
     */
    function sendCommand(targetClientId, command, commandData = {}) {
         if (targetClientId === 'all') {
             // If targeting all, iterate and send individually (server could also support broadcast)
             console.log(`Sending command '${command}' to ALL ${connectedStudents.size} students.`);
             let successCount = 0;
             connectedStudents.forEach((_studentInfo, clientId) => {
                 if (sendMessageToServer({
                     type: 'teacher_command',
                     data: { targetClientId: clientId, command: command, data: commandData }
                 })) {
                     successCount++;
                 }
             });
             if (successCount < connectedStudents.size) {
                 showNotification(`Command '${command}' sent to ${successCount}/${connectedStudents.size} students (some sends might have failed).`, 'warning');
             }
         } else if (connectedStudents.has(targetClientId)) {
             console.log(`Sending command '${command}' to ${targetClientId}`, commandData);
              sendMessageToServer({
                  type: 'teacher_command',
                  data: { targetClientId: targetClientId, command: command, data: commandData }
              });
         } else {
             console.error(`Cannot send command: Target client ID '${targetClientId}' not found.`);
              showNotification(`Cannot send command '${command}': Student '${targetClientId}' is not connected.`, 'error');
         }
    }

    /**
     * Helper to send commands based on the global target dropdown selection.
     * @param {string} command - The command name.
     * @param {object} commandData - Payload for the command.
     * @param {string} [confirmationMessage=null] - If provided, asks for confirmation.
     */
     function sendGlobalCommand(command, commandData, confirmationMessage = null) {
        const selectedTarget = dom.targetStudentSelect.value;

        if (!selectedTarget) {
             showNotification("Please select a target student or 'All Connected Students'.", "warning");
             return;
        }

        const targetDescription = selectedTarget === 'all' ? `ALL ${connectedStudents.size} connected students` : `student ${connectedStudents.get(selectedTarget)?.email || selectedTarget}`;

        if (confirmationMessage && !confirm(`${confirmationMessage} for ${targetDescription}?`)) {
            return; // User cancelled
        }

        sendCommand(selectedTarget, command, commandData);

        // Provide feedback after sending
        if (selectedTarget === 'all' && connectedStudents.size > 0) {
             showNotification(`Command '${command}' sent to all connected students.`, 'info');
        } else if (selectedTarget !== 'all') {
             showNotification(`Command '${command}' sent to ${targetDescription}.`, 'info');
        } else if (selectedTarget === 'all' && connectedStudents.size === 0){
            showNotification(`No students connected to send command '${command}' to.`, 'warning');
        }
    }


    // === Event Handlers ===

    /** Handles clicks within the controls panel using event delegation. */
    function handleControlPanelAction(event) {
        const target = event.target;
        if (target.tagName !== 'BUTTON' || !target.dataset.action) {
            return; // Ignore clicks that aren't on buttons with data-action
        }

        event.preventDefault(); // Prevent potential form submission if buttons are inside forms
        const action = target.dataset.action;

        // --- AI Instruction: Control Panel Actions ---
        // Add cases here for new buttons added to the controls panel.
        // Use `sendGlobalCommand` for actions targeting the selected student/all.
        switch (action) {
            case 'update-blocklist': {
                const patterns = dom.blocklistInput.value
                    .split('\n')
                    .map(p => p.trim())
                    .filter(p => p.length > 0);
                sendGlobalCommand('update_blocklist', { blockedSites: patterns });
                break;
            }
            case 'update-interval': {
                const interval = parseInt(dom.screenshotIntervalInput.value, 10);
                if (isNaN(interval) || interval < CONFIG.minScreenshotInterval) {
                    showNotification(`Invalid interval. Must be a number >= ${CONFIG.minScreenshotInterval}ms.`, 'error');
                    return;
                }
                sendGlobalCommand('set_screenshot_interval', { interval: interval });
                break;
            }
            case 'lock-all':
                 sendGlobalCommand('lock_screen', { message: 'Screen Locked by Teacher' }, 'Are you sure you want to lock');
                break;
            case 'unlock-all':
                 sendGlobalCommand('unlock_screen', {}, 'Are you sure you want to unlock');
                break;
             case 'announce-all': {
                 const message = prompt("Enter announcement message for ALL students:");
                 if (message) {
                      sendGlobalCommand('send_announcement', { message: message, duration: CONFIG.announcementDuration }, 'Are you sure you want to announce');
                 }
                 break;
             }
             case 'refresh-all':
                 sendGlobalCommand('get_tabs', {}, 'Are you sure you want to refresh tab data for');
                 sendGlobalCommand('get_screenshot', {}, 'Are you sure you want to refresh screenshots for');
                 break;
            default:
                console.warn('Unhandled control panel action:', action);
        }
    }

    /** Handles clicks within the students container using event delegation. */
    function handleStudentCardAction(event) {
        const target = event.target;
        const studentCard = target.closest('.student-card'); // Find the parent card

        if (!studentCard || target.tagName !== 'BUTTON' || !target.dataset.action) {
            return; // Ignore clicks not on buttons within a card
        }

        event.preventDefault();
        const clientId = studentCard.dataset.clientId;
        const action = target.dataset.action;

        if (!clientId) {
            console.error("Could not find clientId on student card.", studentCard);
            return;
        }

        // --- AI Instruction: Student Card Actions ---
        // Add cases here for new buttons added within student cards.
        // Use `sendCommand(clientId, ...)` to target the specific student.
        switch (action) {
            case 'lock-screen':
                sendCommand(clientId, 'lock_screen', { message: 'Screen Locked by Teacher' });
                break;
            case 'unlock-screen':
                sendCommand(clientId, 'unlock_screen', {});
                break;
            case 'open-tab': {
                const url = prompt(`Enter URL to open for student ${connectedStudents.get(clientId)?.email || clientId}:`, 'https://');
                if (url) {
                     // Basic URL validation (optional but recommended)
                    try {
                       new URL(url); // Test if it's a valid URL structure
                       sendCommand(clientId, 'open_tab', { url: url });
                    } catch (_) {
                       showNotification(`Invalid URL format: "${url}"`, 'error');
                    }
                }
                break;
            }
            case 'announce': {
                const message = prompt(`Enter announcement message for student ${connectedStudents.get(clientId)?.email || clientId}:`);
                if (message) {
                    sendCommand(clientId, 'send_announcement', { message: message, duration: CONFIG.announcementDuration });
                }
                break;
            }
            case 'close-tab': {
                const tabId = parseInt(target.dataset.tabId, 10);
                if (!isNaN(tabId)) {
                    // Optional: Add confirmation?
                    // if (confirm(`Close tab ${tabId} for ${clientId}?`)) {
                         sendCommand(clientId, 'close_tab', { tabId: tabId });
                    // }
                } else {
                    console.error("Invalid tabId for close_tab action:", target.dataset.tabId);
                }
                break;
            }
             case 'refresh-data': {
                 console.log(`Requesting refresh for ${clientId}`);
                 sendCommand(clientId, 'get_tabs', {});
                 sendCommand(clientId, 'get_screenshot', {});
                 // Optionally show a loading indicator on the card
                 const cardTitle = studentCard.querySelector('.student-card-title');
                 if(cardTitle) {
                     const originalText = cardTitle.textContent;
                     cardTitle.textContent += ' (Refreshing...)';
                     setTimeout(() => { if (cardTitle) cardTitle.textContent = originalText; }, 2000); // Reset after 2s
                 }
                 break;
             }
            default:
                console.warn('Unhandled student card action:', action);
        }
    }

    // === Initialization ===

    /** Initializes the application */
    function initialize() {
        console.log("Initializing Saber Teacher Dashboard...");

        // Set default values
        dom.screenshotIntervalInput.value = CONFIG.defaultScreenshotInterval;
        dom.screenshotIntervalInput.min = CONFIG.minScreenshotInterval;

        // Attach event listeners using delegation
        dom.controlsPanel.addEventListener('click', handleControlPanelAction);
        dom.studentsContainer.addEventListener('click', handleStudentCardAction);

        // Add listener for search input
        dom.studentSearchInput.addEventListener('input', filterStudents);

        // Initial connection attempt
        connectWebSocket();

        // Show initial placeholder state
        updatePlaceholderVisibility();
        // Disable controls initially until connected
         dom.controlsPanel.querySelectorAll('button, input, select, textarea').forEach(el => el.disabled = true);
    }

    // --- Start the application once the DOM is ready ---
    document.addEventListener('DOMContentLoaded', initialize);

})(); // IIFE to encapsulate scope
