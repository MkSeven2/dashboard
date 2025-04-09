// Updated script.js
document.addEventListener('DOMContentLoaded', () => {
    console.log("Saber Teacher Dashboard Initializing...");

    // --- Configuration ---
    const WS_URL = "wss://extension.mkseven1.com"; // Double-check this URL!

    // --- DOM Elements ---
    // (Assuming these elements exist in your HTML based on the provided script)
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.getElementById('main-content');
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const currentViewTitle = document.getElementById('current-view-title');
    const connectionStatusDiv = document.getElementById('connection-status');
    const connectionStatusText = connectionStatusDiv?.querySelector('.text'); // Safety check
    const studentGrid = document.getElementById('student-grid');
    const loadingPlaceholder = document.getElementById('loading-students-placeholder');
    const noStudentsPlaceholder = document.getElementById('no-students-placeholder');
    const studentCardTemplate = document.getElementById('student-card-template');
    const studentRosterBody = document.getElementById('student-roster-body');
    const studentRosterRowTemplate = document.getElementById('student-roster-row-template');
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const selectedCountSpan = document.getElementById('selected-count');

    // Toolbar Buttons
    const lockSelectedBtn = document.getElementById('lock-selected-btn');
    const unlockSelectedBtn = document.getElementById('unlock-selected-btn');
    const openTabSelectedBtn = document.getElementById('open-tab-selected-btn');
    const announceSelectedBtn = document.getElementById('announce-selected-btn');
    const blockSiteSelectedBtn = document.getElementById('block-site-selected-btn');

    // Modals & Controls
    const openTabModal = document.getElementById('open-tab-modal');
    const openTabUrlInput = document.getElementById('open-tab-url');
    const confirmOpenTabBtn = document.getElementById('confirm-open-tab-btn');

    const announceModal = document.getElementById('announce-modal');
    const announceMessageInput = document.getElementById('announce-message');
    const announceDurationInput = document.getElementById('announce-duration');
    const confirmAnnounceBtn = document.getElementById('confirm-announce-btn');

    const blockSiteModal = document.getElementById('block-site-modal');
    const blockPatternsInput = document.getElementById('block-patterns-input');
    const confirmBlockSiteBtn = document.getElementById('confirm-block-site-btn');

    // Settings View Controls (Example)
    const defaultBlocklistInput = document.getElementById('default-blocklist-input');
    const saveDefaultBlocklistBtn = document.getElementById('save-default-blocklist-btn');
    const defaultIntervalInput = document.getElementById('default-interval-input');
    const saveDefaultIntervalBtn = document.getElementById('save-default-interval-btn');

    // --- State Variables ---
    let teacherSocket = null;
    let connectedStudents = new Map(); // clientId -> { clientId, email, userId, currentTabs, status ('connected', 'disconnected', 'locked'), lastScreenshotUrl, lastUpdate }
    let selectedStudentIds = new Set();
    let currentSessionId = null; // Placeholder
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10; // Keep trying (or set higher/infinite?)
    const RECONNECT_DELAY = 5000; // 5 seconds
    let reconnectTimeoutId = null; // To manage reconnection timer


    // --- WebSocket Functions ---

    function connectWebSocket() {
        // Clear any pending reconnect timeout
        if (reconnectTimeoutId) {
            clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = null;
        }

        if (teacherSocket && (teacherSocket.readyState === WebSocket.OPEN || teacherSocket.readyState === WebSocket.CONNECTING)) {
            console.log("WebSocket already open or connecting.");
            return;
        }

        updateConnectionStatus('connecting', 'Connecting...');
        console.log(`Attempting to connect to ${WS_URL}...`);
        try {
             teacherSocket = new WebSocket(WS_URL);
        } catch (error) {
            console.error("Failed to create WebSocket:", error);
            updateConnectionStatus('disconnected', 'Connection Failed');
            scheduleReconnect(); // Try again after delay
            return;
        }


        teacherSocket.onopen = () => {
            updateConnectionStatus('connected', 'Connected');
            reconnectAttempts = 0; // Reset attempts on successful connection
            console.log('WebSocket connection established.');
            sendMessageToServer({ type: 'teacher_connect' }); // Identify as teacher
            requestInitialData(); // Request full state after connecting/reconnecting
        };

        teacherSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                // console.log('Message received:', message.type); // Less verbose
                handleServerMessage(message);
            } catch (error) {
                console.error('Error processing message or invalid JSON:', event.data, error);
            }
        };

        teacherSocket.onerror = (error) => {
            console.error("WebSocket error:", error);
            updateConnectionStatus('disconnected', 'Error');
            // Don't schedule reconnect here, onclose will handle it
        };

        teacherSocket.onclose = (event) => {
            console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
            const reasonText = event.reason ? ` (${event.reason})` : ` (Code: ${event.code})`;
            updateConnectionStatus('disconnected', `Closed${reasonText}`);
            teacherSocket = null;
            markAllStudentsDisconnected(); // Update UI for all students

            // Schedule reconnection attempt
            scheduleReconnect();
        };
    }

    function scheduleReconnect() {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_DELAY / 1000}s...`);
            updateConnectionStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
            // Store timeout ID to prevent multiple concurrent timers
            if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = setTimeout(connectWebSocket, RECONNECT_DELAY);
        } else {
            console.error("Max WebSocket reconnect attempts reached.");
            updateConnectionStatus('disconnected', 'Reconnect failed');
            // Optionally display a manual reconnect button here
        }
    }

    // Renamed for clarity
    function requestInitialData() {
        // Ask server for list of currently connected students
        // The server should respond with 'initial_student_list'
        sendMessageToServer({ type: 'get_initial_student_list' }); // Adjusted type based on previous examples
    }


    function sendMessageToServer(payload) {
        if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
            try {
                teacherSocket.send(JSON.stringify(payload));
                 // console.log("Sent:", payload.type); // Debug log
            } catch (error) {
                console.error("Error sending message:", error);
            }
        } else {
            console.warn("WebSocket not open. Message not sent:", payload);
            // updateConnectionStatus('disconnected', 'Not Connected'); // Indicate connection issue
        }
    }

    function updateConnectionStatus(status, text) {
        if (connectionStatusDiv && connectionStatusText) {
             connectionStatusDiv.className = `status-indicator ${status}`;
             connectionStatusText.textContent = text;
        } else {
            console.warn("Connection status elements not found in DOM.");
        }
    }

    // --- Server Message Handling ---

    function handleServerMessage(message) {
        const { type, data } = message;

        switch (type) {
            case 'initial_student_list':
                console.log("Received initial student list:", data);
                if(loadingPlaceholder) loadingPlaceholder.classList.add('hidden');
                connectedStudents.clear();
                if(studentGrid) studentGrid.innerHTML = '';
                if(studentRosterBody) studentRosterBody.innerHTML = '';
                if (data && Array.isArray(data)) {
                    data.forEach(studentData => processStudentUpdate(studentData.clientId, studentData));
                }
                updateBulkActionButtons();
                updateNoStudentsPlaceholder();
                updateRoster();
                break;

            case 'student_connected':
                console.log("Student connected:", data);
                // Ensure data includes necessary fields (clientId, email etc.)
                if (data && data.clientId) {
                     processStudentUpdate(data.clientId, { ...data, status: 'connected' });
                     updateNoStudentsPlaceholder();
                     updateRoster();
                } else {
                     console.warn("Received student_connected without clientId:", data);
                }
                break;

            case 'student_disconnected':
                console.log("Student disconnected:", data);
                 if (data && data.clientId) {
                    updateStudentStatus(data.clientId, 'disconnected');
                    updateRoster();
                 }
                break;

            // --- Direct handling of relayed student data (Adjust based on YOUR server) ---
            case 'student_screenshot': // Assuming server sends this type directly now
                 if (data && data.clientId && data.payload) {
                     updateStudentScreenshot(data.clientId, data.payload.imageData);
                     const student = connectedStudents.get(data.clientId);
                     if(student) student.lastScreenshotUrl = data.payload.imageData;
                 }
                break;
             case 'student_screenshot_error':
             case 'student_screenshot_skipped':
                  if (data && data.clientId && data.payload) {
                     updateStudentScreenshot(data.clientId, null, data.payload.error || data.payload.reason);
                  }
                 break;
            case 'student_tabs_update': // Assuming server sends this type directly
                 if (data && data.clientId && data.payload) {
                     const student = connectedStudents.get(data.clientId);
                     if (student) {
                         student.currentTabs = data.payload;
                         student.lastUpdate = Date.now();
                         updateStudentActiveTab(data.clientId, data.payload);
                         // Optionally update a more detailed tab list view if implemented
                     }
                 }
                break;
            case 'student_status_update': // If student extension sends its own status (e.g., locked state confirmed)
                 if (data && data.clientId && data.payload && data.payload.status) {
                    updateStudentStatus(data.clientId, data.payload.status);
                    updateRoster();
                 }
                break;
            // --- End Direct Handling ---

            case 'command_failed':
                console.error(`Command failed for student ${data?.targetClientId}: ${data?.reason}`);
                alert(`Command failed for student ${data?.targetClientId || 'Unknown'}: ${data?.reason || 'Unknown error'}`);
                break;

             case 'session_update':
                console.log("Session update:", data);
                // Update UI related to sessions
                break;

             case 'pong':
                // console.log('Pong received');
                break;

             case 'error': // General server error message
                console.error('Server Error:', message.message);
                alert(`Server Error: ${message.message}`);
                break;

            default:
                console.warn("Received unhandled message type:", type);
        }
    }

    // Removed handleStudentPayload as messages are now handled directly based on type

    function processStudentUpdate(clientId, studentData) {
        if (!clientId || !studentData) {
            console.warn("processStudentUpdate called with invalid data:", clientId, studentData);
            return;
        }

        const isNewStudent = !connectedStudents.has(clientId);
        const studentState = connectedStudents.get(clientId) || {};

        // Update student map - Prioritize new data but keep old if new is missing
        const updatedState = {
            clientId: clientId,
            email: studentData.email || studentState.email || 'Unknown Email',
            userId: studentData.userId || studentState.userId || 'Unknown ID',
            // Ensure status is valid, default to 'connected' if joining, else keep old or 'disconnected'
            status: ['connected', 'disconnected', 'locked'].includes(studentData.status) ? studentData.status : (studentState.status || 'connected'),
            currentTabs: studentData.currentTabs || studentState.currentTabs || {},
            lastScreenshotUrl: studentData.lastScreenshotUrl || studentState.lastScreenshotUrl || null, // Store URL not image data blob directly
            lastUpdate: Date.now(),
        };
        connectedStudents.set(clientId, updatedState);

        // Add or Update Student Card in Grid View
        let card = document.getElementById(`student-card-${clientId}`);
        if (isNewStudent || !card) {
            if(card) card.remove(); // Remove old if somehow it existed but wasn't in map
            if(studentCardTemplate) { // Check template exists
                 card = createStudentCard(clientId, updatedState);
                 if (studentGrid) {
                    studentGrid.appendChild(card);
                 } else {
                     console.error("studentGrid element not found!");
                 }
                 if(loadingPlaceholder) loadingPlaceholder.classList.add('hidden');
            } else {
                console.error("studentCardTemplate not found!");
                return; // Cannot create card
            }

        } else {
            // Update existing card elements (Name primarily, status handled separately)
            updateStudentCardContent(card, updatedState);
        }

        // Ensure visual status is correct after adding/updating
        updateStudentStatusOnCard(card, updatedState.status);

        // Update screenshot and tab info from the latest data
        if(updatedState.lastScreenshotUrl) {
            updateStudentScreenshot(clientId, updatedState.lastScreenshotUrl);
        }
         // Update active tab display even if tabs data wasn't in this specific update
        if(Object.keys(updatedState.currentTabs).length > 0) {
            updateStudentActiveTab(clientId, updatedState.currentTabs);
        }
         // Add to dropdown select
        addStudentToSelect(clientId, updatedState.email);
    }

    function markAllStudentsDisconnected() {
        connectedStudents.forEach(student => {
            student.status = 'disconnected';
            updateStudentStatus(student.clientId, 'disconnected'); // Updates map and card
        });
         updateRoster(); // Update table view
    }

    // --- DOM Manipulation & UI Updates ---

    function createStudentCard(clientId, studentData) {
        // Ensure the template exists before cloning
        if (!studentCardTemplate) {
            console.error("Cannot create student card: Template not found.");
            return null; // Return null or throw an error
        }
        const cardClone = studentCardTemplate.content.cloneNode(true);
        const cardElement = cardClone.querySelector('.student-card');
        if (!cardElement) {
            console.error("Cannot create student card: '.student-card' not found in template.");
            return null;
        }
        cardElement.id = `student-card-${clientId}`;
        cardElement.dataset.clientId = clientId;

        // Initial content update
        updateStudentCardContent(cardElement, studentData);

        // Add event listeners - Use event delegation later if performance is an issue
        const checkbox = cardElement.querySelector('.student-select-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', () => handleStudentSelection(clientId, checkbox.checked));
        }

        // Attach listeners to buttons *if they exist in the template*
        // Use optional chaining (?.) for safety
        cardElement.querySelector('.lock-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked by Teacher' });
        });
        cardElement.querySelector('.unlock-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            sendCommandToStudent(clientId, 'unlock_screen', {});
        });
        cardElement.querySelector('.open-tab-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            promptAndOpenTabForStudent(clientId);
        });
        cardElement.querySelector('.message-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            promptAndAnnounceToStudent(clientId);
        });
        cardElement.querySelector('.close-tab-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const activeTabId = cardElement.dataset.activeTabId; // Relies on dataset being set
            if (activeTabId) {
                sendCommandToStudent(clientId, 'close_tab', { tabId: parseInt(activeTabId, 10) });
            } else {
                alert("Could not determine the active tab to close.");
            }
        });

        return cardElement;
    }

    function updateStudentCardContent(cardElement, studentData) {
        if (!cardElement || !studentData) return;
        const nameEl = cardElement.querySelector('.student-name');
        if(nameEl) {
            nameEl.textContent = studentData.email || `Client: ${studentData.clientId?.substring(0, 6) ?? '??'}`;
            nameEl.title = `${studentData.email}\nID: ${studentData.clientId}`;
        }
        // Status dot is updated via updateStudentStatusOnCard
        // Screenshot and Active Tab are updated by their respective functions
    }


    function updateStudentStatus(clientId, status) {
        const student = connectedStudents.get(clientId);
        if (student) {
            student.status = status;
            const card = document.getElementById(`student-card-${clientId}`);
            if (card) {
                updateStudentStatusOnCard(card, status);
            }
            // Update roster if it's the current view
             if (document.getElementById('students-view')?.classList.contains('active')) {
                 updateRoster();
             }
        }
    }

    function updateStudentStatusOnCard(cardElement, status) {
        if (!cardElement) return;
        cardElement.dataset.status = status; // For CSS styling [data-status="connected"] etc.
        const statusDot = cardElement.querySelector('.status-dot');
        if (statusDot) {
             statusDot.className = `status-dot ${status}`; // Update class for color
             statusDot.title = status.charAt(0).toUpperCase() + status.slice(1); // Capitalize title
        }

        // Maybe add visual indication for locked state more prominently
        const screenshotPreview = cardElement.querySelector('.screenshot-preview'); // Assuming this class exists
        if(screenshotPreview) {
            if (status === 'locked') {
                cardElement.classList.add('locked'); // Add class to card itself
                screenshotPreview.style.borderColor = 'var(--warning-color, red)';
            } else {
                cardElement.classList.remove('locked');
                screenshotPreview.style.borderColor = 'transparent'; // Or original border
            }
        }
    }

    function updateStudentScreenshot(clientId, imageDataUrl, errorMessage = null) {
        const card = document.getElementById(`student-card-${clientId}`);
        if (!card) return;

        // Check if elements exist before accessing properties
        const imgElement = card.querySelector('.screenshot-img');
        const noScreenshotDiv = card.querySelector('.no-screenshot');
        const lastUpdatedSpan = card.querySelector('.last-updated');

        if (!imgElement || !noScreenshotDiv || !lastUpdatedSpan) {
             console.warn(`Screenshot elements missing in card for client ${clientId}`);
             return;
        }

         // Log the received URL for debugging 404s
         // console.log(`Updating screenshot for ${clientId}. URL: ${imageDataUrl ? imageDataUrl.substring(0, 50) + '...' : 'null'}, Error: ${errorMessage}`);

        if (imageDataUrl && typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image')) {
            // Only update if it looks like a valid data URL
            imgElement.src = imageDataUrl;
            imgElement.classList.remove('hidden');
            noScreenshotDiv.classList.add('hidden');
            lastUpdatedSpan.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        } else {
            // Handle missing/invalid data or errors
            imgElement.classList.add('hidden');
            // Avoid setting src to null/undefined which might cause issues or unwanted requests
            // imgElement.src = ''; // Clear src or set to a known valid placeholder
            imgElement.removeAttribute('src'); // Or remove src entirely

            noScreenshotDiv.classList.remove('hidden');
            noScreenshotDiv.textContent = errorMessage || "Screenshot Unavailable";
             // Consider setting a placeholder background/icon via CSS on '.no-screenshot'
            lastUpdatedSpan.textContent = `Updated: Never`;

             if(imageDataUrl && !imageDataUrl.startsWith('data:image')) {
                 console.error(`Invalid image data URL received for ${clientId}:`, imageDataUrl);
             }
        }
    }

    function updateStudentActiveTab(clientId, tabsData) {
        const card = document.getElementById(`student-card-${clientId}`);
        if (!card || !tabsData) return;

        const activeTabInfoDiv = card.querySelector('.active-tab-info');
        if(!activeTabInfoDiv) return; // Element missing

        const faviconImg = activeTabInfoDiv.querySelector('.favicon');
        const tabTitleSpan = activeTabInfoDiv.querySelector('.tab-title');
        if(!faviconImg || !tabTitleSpan) return; // Elements missing

        let activeTab = null;
        if (typeof tabsData === 'object' && tabsData !== null) {
            activeTab = Object.values(tabsData).find(tab => tab && tab.active);
        }

        if (activeTab) {
            card.dataset.activeTabId = activeTab.id; // Store for close action
             // Provide a default placeholder favicon path
            const placeholderFavicon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkIAAYIBAAJBtnBAAAAABJRU5ErkJggg=='; // Transparent pixel
            faviconImg.src = (activeTab.favIconUrl && activeTab.favIconUrl.startsWith('http')) ? activeTab.favIconUrl : placeholderFavicon;
            faviconImg.onerror = () => { faviconImg.src = placeholderFavicon; }; // Fallback on error
            tabTitleSpan.textContent = activeTab.title || 'Untitled Tab';
            tabTitleSpan.title = activeTab.url || 'No URL';
        } else {
            card.dataset.activeTabId = ''; // Clear stored ID
            faviconImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkIAAYIBAAJBtnBAAAAABJRU5ErkJggg=='; // Placeholder
            tabTitleSpan.textContent = 'No Active Tab';
            tabTitleSpan.title = '';
        }
    }


    function updateNoStudentsPlaceholder() {
        if (!noStudentsPlaceholder || !loadingPlaceholder) return;
         if (connectedStudents.size === 0) {
             // Show "No Students" only if not actively loading/connecting
             if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
                 noStudentsPlaceholder.classList.remove('hidden');
                 loadingPlaceholder.classList.add('hidden');
             } else {
                 // If disconnected or connecting, show loading/connecting status instead
                 noStudentsPlaceholder.classList.add('hidden');
                  // Loading placeholder might be shown based on connection status elsewhere
             }
         } else {
             noStudentsPlaceholder.classList.add('hidden');
              loadingPlaceholder.classList.add('hidden');
         }
    }

    function updateBulkActionButtons() {
        // Check if buttons exist before setting disabled property
        const hasSelection = selectedStudentIds.size > 0;
        if(lockSelectedBtn) lockSelectedBtn.disabled = !hasSelection;
        if(unlockSelectedBtn) unlockSelectedBtn.disabled = !hasSelection;
        if(openTabSelectedBtn) openTabSelectedBtn.disabled = !hasSelection;
        if(announceSelectedBtn) announceSelectedBtn.disabled = !hasSelection;
        if(blockSiteSelectedBtn) blockSiteSelectedBtn.disabled = !hasSelection;
    }

    function updateSelectedCount() {
         if (!selectedCountSpan || !selectAllCheckbox) return;
        selectedCountSpan.textContent = `(${selectedStudentIds.size} Selected)`;
        // Handle state when no students are connected
         const totalStudents = connectedStudents.size;
         selectAllCheckbox.disabled = totalStudents === 0; // Disable if no students
        selectAllCheckbox.checked = totalStudents > 0 && selectedStudentIds.size === totalStudents;
        selectAllCheckbox.indeterminate = selectedStudentIds.size > 0 && selectedStudentIds.size < totalStudents;
    }

    // --- Student Roster View ---
    function updateRoster() {
        if (!studentRosterBody || !studentRosterRowTemplate) return;
        studentRosterBody.innerHTML = ''; // Clear existing rows

        if (connectedStudents.size === 0) {
            studentRosterBody.innerHTML = '<tr><td colspan="6">No students found or connected.</td></tr>';
            return;
        }

        // Sort students maybe? Example: by email
         const sortedStudents = Array.from(connectedStudents.values()).sort((a, b) => (a.email || '').localeCompare(b.email || ''));

         sortedStudents.forEach(student => {
            const rowClone = studentRosterRowTemplate.content.cloneNode(true);
            const rowElement = rowClone.querySelector('tr');
            if (!rowElement) return; // Template might be invalid
            rowElement.dataset.clientId = student.clientId;

            // Safely access properties and provide fallbacks
            rowElement.querySelector('.roster-name').textContent = student.email?.split('@')[0] || 'Unknown';
            rowElement.querySelector('.roster-email').textContent = student.email || 'N/A';

            const statusBadge = rowElement.querySelector('.status-badge');
            if(statusBadge) {
                const statusText = student.status || 'disconnected';
                statusBadge.textContent = statusText.charAt(0).toUpperCase() + statusText.slice(1);
                statusBadge.className = `status-badge ${statusText}`;
            }

             rowElement.querySelector('.roster-session').textContent = currentSessionId || 'N/A'; // Placeholder

            studentRosterBody.appendChild(rowElement);
        });
    }

    // --- Event Listeners ---

    // Sidebar Toggle
    if(sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            // Simplified toggle logic (adjust based on your specific CSS needs)
            document.body.classList.toggle('sidebar-collapsed');
            // Add more complex logic for mobile/desktop if needed here
        });
    } else { console.warn("Sidebar toggle button not found."); }


    // Sidebar Navigation
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetViewId = item.dataset.view;
            if (!targetViewId) return;

            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            views.forEach(view => {
                view.classList.toggle('active', view.id === targetViewId);
            });

            if(currentViewTitle) {
                currentViewTitle.textContent = item.querySelector('span')?.textContent || 'Dashboard';
            }

            if (targetViewId === 'students-view') { // Assuming 'students-view' is the ID for the roster table container
                updateRoster();
            }

             // Optional: Close mobile sidebar after navigation
             // if (window.innerWidth <= 768) { document.body.classList.add('sidebar-collapsed'); }
        });
    });

    // Selection Handling (Select All)
    if (selectAllCheckbox) {
         selectAllCheckbox.addEventListener('change', () => {
            const isChecked = selectAllCheckbox.checked;
             // Update internal state first
             if (isChecked) {
                 connectedStudents.forEach((_, clientId) => selectedStudentIds.add(clientId));
             } else {
                 selectedStudentIds.clear();
             }
             // Update UI checkboxes based on new state
            document.querySelectorAll('.student-select-checkbox').forEach(checkbox => {
                checkbox.checked = isChecked;
                // We don't need to call handleStudentSelection here as we updated the Set directly
            });
            updateSelectedCount();
            updateBulkActionButtons();
        });
    }

    function handleStudentSelection(clientId, isSelected) {
        // This function is called by individual card checkboxes
        if (isSelected) {
            selectedStudentIds.add(clientId);
        } else {
            selectedStudentIds.delete(clientId);
        }
        updateSelectedCount(); // Updates count and selectAll checkbox state
        updateBulkActionButtons();
    }

    // --- Bulk Action Buttons ---
    // Attach listeners only if the buttons exist
    lockSelectedBtn?.addEventListener('click', () => {
        if (selectedStudentIds.size > 0 && confirm(`Lock screens for ${selectedStudentIds.size} selected students?`)) {
            selectedStudentIds.forEach(clientId => {
                sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked by Teacher' });
            });
        }
    });

    unlockSelectedBtn?.addEventListener('click', () => {
        if (selectedStudentIds.size > 0 && confirm(`Unlock screens for ${selectedStudentIds.size} selected students?`)) {
            selectedStudentIds.forEach(clientId => {
                sendCommandToStudent(clientId, 'unlock_screen', {});
            });
        }
    });

    openTabSelectedBtn?.addEventListener('click', () => {
         if (selectedStudentIds.size === 0) { alert("No students selected."); return; }
         if(openTabUrlInput) openTabUrlInput.value = 'https://';
         showModal('open-tab-modal');
    });

    announceSelectedBtn?.addEventListener('click', () => {
         if (selectedStudentIds.size === 0) { alert("No students selected."); return; }
         if(announceMessageInput) announceMessageInput.value = '';
         showModal('announce-modal');
    });

    blockSiteSelectedBtn?.addEventListener('click', () => {
        if (selectedStudentIds.size === 0) { alert("No students selected."); return; }
        if(blockPatternsInput && defaultBlocklistInput) blockPatternsInput.value = defaultBlocklistInput.value; // Use default as starting point
        showModal('block-site-modal');
    });

    // --- Modal Confirm Buttons ---
    // Check elements exist before adding listeners
    confirmOpenTabBtn?.addEventListener('click', () => {
        const url = openTabUrlInput?.value.trim();
        if (selectedStudentIds.size === 0) { alert("No students selected."); return; }
        if (url && url !== 'https://') {
            try {
                new URL(url); // Basic validation
                selectedStudentIds.forEach(clientId => {
                    sendCommandToStudent(clientId, 'open_tab', { url: url });
                });
                closeModal('open-tab-modal');
            } catch (_) { alert("Please enter a valid URL (e.g., https://example.com)"); }
        } else { alert("Please enter a URL."); }
    });

    confirmAnnounceBtn?.addEventListener('click', () => {
        const message = announceMessageInput?.value.trim();
        const duration = parseInt(announceDurationInput?.value, 10) || 5000;
        if (selectedStudentIds.size === 0) { alert("No students selected."); return; }
        if (message) {
            selectedStudentIds.forEach(clientId => {
                sendCommandToStudent(clientId, 'send_announcement', { message: message, duration: duration });
            });
            closeModal('announce-modal');
        } else { alert("Please enter an announcement message."); }
    });

    confirmBlockSiteBtn?.addEventListener('click', () => {
        const patterns = blockPatternsInput?.value
            ?.split('\n')
            ?.map(p => p.trim())
            ?.filter(p => p.length > 0) || []; // Safe parsing

        if (selectedStudentIds.size === 0) { alert("No students selected."); return; }

        console.log(`Updating blocklist for ${selectedStudentIds.size} students:`, patterns);
        selectedStudentIds.forEach(clientId => {
            sendCommandToStudent(clientId, 'update_blocklist', { blockedSites: patterns });
        });
        closeModal('block-site-modal');
    });


    // --- Command Sending Helper ---

    function sendCommandToStudent(targetClientId, command, commandData = {}) {
        console.log(`Sending command [${command}] to student [${targetClientId}]`, commandData);
        sendMessageToServer({
            type: 'teacher_command',
            data: {
                targetClientId: targetClientId,
                command: command,
                data: commandData
            }
        });

        // Optimistic UI update for lock/unlock status
        if (command === 'lock_screen') {
            updateStudentStatus(targetClientId, 'locked');
        } else if (command === 'unlock_screen') {
            const student = connectedStudents.get(targetClientId);
            // Only change status if currently locked
            if(student && student.status === 'locked') {
                updateStudentStatus(targetClientId, 'connected');
            }
        }
        // Note: Roster update is handled within updateStudentStatus now
    }


    // --- Modal Helpers ---
    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            const input = modal.querySelector('input, textarea');
            if (input) setTimeout(() => input.focus(), 50); // Allow time for transition/render
        } else { console.warn(`Modal with ID ${modalId} not found.`); }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('hidden');
    }

    // Attach modal close listeners more robustly
    document.addEventListener('click', (e) => {
         // Close on background click
         if (e.target.classList.contains('modal')) {
             closeModal(e.target.id);
         }
         // Close via explicit close button
         if (e.target.classList.contains('close-btn')) {
             const modal = e.target.closest('.modal');
             if(modal) closeModal(modal.id);
         }
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal:not(.hidden)').forEach(modal => closeModal(modal.id));
        }
    });


    // --- Individual Student Actions (Prompts) ---
    function promptAndOpenTabForStudent(clientId) {
        const studentInfo = connectedStudents.get(clientId);
        const url = prompt(`Enter URL to open for student ${studentInfo?.email || clientId}:`, 'https://');
        if (url && url !== 'https://') {
            try { new URL(url); sendCommandToStudent(clientId, 'open_tab', { url: url }); }
            catch (_) { alert("Invalid URL format."); }
        }
    }

    function promptAndAnnounceToStudent(clientId) {
        const studentInfo = connectedStudents.get(clientId);
        const message = prompt(`Enter announcement for student ${studentInfo?.email || clientId}:`);
        if (message) {
            sendCommandToStudent(clientId, 'send_announcement', { message: message, duration: 7000 });
        }
    }


    // --- Settings ---
    function loadSettings() {
        if(defaultBlocklistInput) defaultBlocklistInput.value = localStorage.getItem('saberDefaultBlocklist') || '';
        if(defaultIntervalInput) defaultIntervalInput.value = localStorage.getItem('saberDefaultInterval') || '5000';
    }
    saveDefaultBlocklistBtn?.addEventListener('click', () => {
        if(!defaultBlocklistInput) return;
        localStorage.setItem('saberDefaultBlocklist', defaultBlocklistInput.value);
        alert('Default blocklist saved locally.');
    });
    saveDefaultIntervalBtn?.addEventListener('click', () => {
        if(!defaultIntervalInput) return;
        const interval = parseInt(defaultIntervalInput.value, 10);
        if(isNaN(interval) || interval < 2000) { // Minimum 2s
            alert("Interval must be 2000ms or higher."); return;
        }
        localStorage.setItem('saberDefaultInterval', interval);
        alert('Default screenshot interval saved locally.');
        // Maybe add button to apply default interval to selected students?
    });

     // --- Add student to select dropdown ---
     function addStudentToSelect(clientId, email) {
         if (!targetStudentSelect || Array.from(targetStudentSelect.options).some(opt => opt.value === clientId)) return;
         const option = document.createElement('option');
         option.value = clientId;
         option.textContent = `${email || 'N/A'} (${clientId.substring(0,6)}...)`;
         targetStudentSelect.appendChild(option);
     }

      function removeStudentFromSelect(clientId) {
         if (!targetStudentSelect) return;
         const option = targetStudentSelect.querySelector(`option[value="${clientId}"]`);
         if (option) option.remove();
     }


    // --- Initialization ---
    function initializeDashboard() {
        console.log("Initializing dashboard UI and WebSocket...");
        // Set initial sidebar state based on screen width
        if (window.innerWidth <= 768 && !document.body.classList.contains('sidebar-force-open')) {
             document.body.classList.add('sidebar-collapsed');
        }
        loadSettings();
        updateBulkActionButtons(); // Ensure buttons are initially disabled if needed
        updateSelectedCount();
        updateNoStudentsPlaceholder(); // Show initial placeholder correctly
        connectWebSocket(); // Start connection
    }

    initializeDashboard();

}); // End DOMContentLoaded
