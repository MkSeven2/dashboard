/**
 * Saber Teacher Dashboard - Frontend Logic
 * Revision Date: 2025-04-09
 *
 * This script handles the user interface interactions, WebSocket communication
 * with the Saber server, and dynamic updates of the teacher dashboard.
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("Saber Teacher Dashboard Initializing - Enhanced Revision...");

    // --- Configuration ---
    const WS_URL = "wss://extension.mkseven1.com"; // Ensure this matches your deployed server URL
    const PLACEHOLDER_FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkIAAYIBAAJBtnBAAAAABJRU5ErkJggg==';
    const PLACEHOLDER_SCREENSHOT = 'placeholder.png'; // Path to a default placeholder image
    const RECONNECT_DELAY_MS = 5000; // Delay between WebSocket reconnect attempts
    const MAX_RECONNECT_ATTEMPTS = 10; // Maximum number of reconnect attempts

    // --- DOM Element Cache ---
    // Cache frequently accessed DOM elements for performance
    const domCache = {
        body: document.body,
        sidebar: document.getElementById('sidebar'),
        sidebarToggle: document.getElementById('sidebar-toggle'),
        mainContent: document.getElementById('main-content'),
        navList: document.querySelector('.nav-list'),
        views: document.querySelectorAll('.view'),
        currentViewTitle: document.getElementById('view-title'), // Matches suggested HTML
        connectionStatusDiv: document.getElementById('connection-status'),
        connectionStatusText: document.getElementById('connection-status')?.querySelector('.text'),
        studentGrid: document.getElementById('student-grid'),
        loadingPlaceholder: document.getElementById('loading-placeholder'), // Matches suggested HTML
        noStudentsPlaceholder: document.getElementById('no-students-placeholder'), // Matches suggested HTML
        studentCardTemplate: document.getElementById('student-card-template'),
        // Toolbar
        selectAllCheckbox: document.getElementById('select-all-students'), // Matches suggested HTML
        selectedCountSpan: document.getElementById('selected-count'),
        actionButtons: document.querySelectorAll('.view-toolbar .actions .btn'), // Select all action buttons
        sortStudentsSelect: document.getElementById('sort-students'),
        filterStudentsInput: document.getElementById('student-search'), // Matches suggested HTML
        // Modals
        openTabModal: document.getElementById('open-tab-modal'),
        openTabUrlInput: document.getElementById('open-tab-url'),
        confirmOpenTabBtn: document.getElementById('confirm-open-tab'),
        announceModal: document.getElementById('announce-modal'),
        announceMessageInput: document.getElementById('announce-message'),
        announceDurationInput: document.getElementById('announce-duration'),
        confirmAnnounceBtn: document.getElementById('confirm-announce'),
        // Student Detail Modal
        studentDetailModal: document.getElementById('student-detail-modal'),
        detailModalStudentName: document.getElementById('detail-student-name'), // Matches suggested HTML
        detailModalScreenshot: document.getElementById('detail-screenshot'), // Matches suggested HTML
        detailModalActiveTabEl: document.getElementById('detail-active-tab'), // Matches suggested HTML
        detailModalTabListEl: document.getElementById('detail-tab-list'), // Matches suggested HTML
        detailModalActivityLogEl: document.getElementById('detail-activity-log') // Matches suggested HTML
    };

    // --- Application State ---
    let teacherSocket = null;
    let connectedStudents = new Map(); // Map<clientId, StudentState>
    let selectedStudentIds = new Set();
    let reconnectAttempts = 0;
    let reconnectTimeoutId = null;
    let currentSort = 'name'; // Initial sort criteria
    let currentFilter = ''; // Initial filter query
    let activeViewId = 'screens'; // Initial active view

    // --- Type Definitions (for clarity, not enforced by JS) ---
    /**
     * @typedef {object} TabData
     * @property {number} id
     * @property {string} [url]
     * @property {string} [title]
     * @property {boolean} active
     * @property {boolean} [audible]
     * @property {string} [favIconUrl]
     * @property {number} [windowId]
     * @property {string} [status] - e.g., 'loading', 'complete'
     */
    /**
     * @typedef {object} StudentState
     * @property {string} clientId
     * @property {string} email
     * @property {string} [userId]
     * @property {'connected' | 'disconnected' | 'locked'} status
     * @property {Object<string, TabData>} [currentTabs] - Map of tabId to TabData
     * @property {TabData | null} [activeTab] - Cached active tab data
     * @property {string | null} [lastScreenshotUrl] - Base64 data URL or null
     * @property {number} lastUpdate - Timestamp of the last update received
     */

    // --- WebSocket Management ---
    /**
     * Establishes or re-establishes the WebSocket connection.
     */
    function connectWebSocket() {
        if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;

        if (teacherSocket && (teacherSocket.readyState === WebSocket.OPEN || teacherSocket.readyState === WebSocket.CONNECTING)) {
            console.info("WS: Already open or connecting.");
            return;
        }

        updateConnectionStatus('connecting', 'Connecting...');
        console.info(`WS: Attempting connection to ${WS_URL}...`);
        try {
            teacherSocket = new WebSocket(WS_URL);
        } catch (error) {
            console.error("WS: Failed to create WebSocket instance:", error);
            updateConnectionStatus('disconnected', 'Connection Failed');
            scheduleReconnect();
            return;
        }

        // Assign event listeners
        teacherSocket.onopen = handleWebSocketOpen;
        teacherSocket.onmessage = handleWebSocketMessage;
        teacherSocket.onerror = handleWebSocketError;
        teacherSocket.onclose = handleWebSocketClose;
    }

    function handleWebSocketOpen() {
        updateConnectionStatus('connected', 'Connected');
        reconnectAttempts = 0;
        console.info('WS: Connection established.');
        // Identify as teacher to the server
        sendMessageToServer({ type: 'teacher_connect', data: { /* Optional: teacher name, id etc. */ } });
        // Server is expected to respond with 'initial_student_list'
    }

    function handleWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            // Process the received message based on its type
            handleServerMessage(message);
        } catch (error) {
            console.error('WS: Failed to parse message or handle command:', error, event.data);
        }
    }

    function handleWebSocketError(error) {
        console.error("WS: WebSocket error occurred:", error);
        updateConnectionStatus('disconnected', 'Error');
        // The 'close' event will likely follow, handling reconnect there.
    }

    function handleWebSocketClose(event) {
        const reasonText = event.reason ? ` (${event.reason})` : ` (Code: ${event.code})`;
        console.warn(`WS: Connection closed.${reasonText}`);
        updateConnectionStatus('disconnected', `Closed${reasonText}`);
        teacherSocket = null;
        markAllStudentsDisconnected(); // Visually mark students as disconnected
        scheduleReconnect(); // Attempt to reconnect automatically
    }

    /**
     * Schedules a reconnect attempt if conditions allow.
     */
    function scheduleReconnect() {
        if (reconnectTimeoutId || (teacherSocket && teacherSocket.readyState === WebSocket.OPEN)) {
            return; // Already scheduled or connected
        }

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.info(`WS: Scheduling reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_DELAY_MS / 1000}s...`);
            updateConnectionStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
            reconnectTimeoutId = setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
        } else {
            console.error("WS: Maximum reconnect attempts reached. Giving up.");
            updateConnectionStatus('disconnected', 'Reconnect Failed');
        }
    }

    /**
     * Sends a JSON payload to the WebSocket server if connected.
     * @param {object} payload - The JavaScript object to send.
     */
    function sendMessageToServer(payload) {
        if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
            try {
                const messageString = JSON.stringify(payload);
                teacherSocket.send(messageString);
                // console.debug("WS Sent:", payload.type, payload); // Verbose logging
            } catch (error) {
                console.error("WS: Failed to stringify or send message:", error, payload);
            }
        } else {
            console.warn("WS: Connection not open. Message unsent:", payload);
            // TODO: Implement message queuing or user notification for critical messages?
        }
    }

    /**
     * Updates the connection status indicator in the UI.
     * @param {'connected' | 'disconnected' | 'connecting'} status - The connection status.
     * @param {string} text - The display text for the status.
     */
    function updateConnectionStatus(status, text) {
        if (domCache.connectionStatusDiv && domCache.connectionStatusText) {
            domCache.connectionStatusDiv.className = `status-indicator ${status}`;
            domCache.connectionStatusText.textContent = text;
        } else {
            console.warn("Connection status elements not found in DOM.");
        }
    }

    // --- Server Message Handling ---
    /**
     * Processes messages received from the WebSocket server.
     * @param {object} message - The parsed message object.
     * @param {string} message.type - The type of the message.
     * @param {object} [message.data] - The payload of the message.
     */
    function handleServerMessage(message) {
        const { type, data } = message;
        // console.debug(`WS Received: ${type}`, data); // Verbose logging

        let needsGridRefresh = false; // Flag to trigger a full grid re-render

        // Utility to safely get student state or create if missing (e.g., for updates before initial list)
        const getOrInitStudent = (clientId, defaultData = {}) => {
            if (!connectedStudents.has(clientId)) {
                 console.warn(`Received update for unknown student ${clientId}. Initializing.`);
                 connectedStudents.set(clientId, {
                      clientId: clientId,
                      email: 'Loading...',
                      status: 'connected', // Assume connected if receiving updates
                      lastUpdate: Date.now(),
                      ...defaultData
                 });
                 needsGridRefresh = true; // Need to add the card
            }
            return connectedStudents.get(clientId);
        };

        switch (type) {
            case 'initial_student_list':
                console.info("Processing initial student list...");
                connectedStudents.clear(); // Start fresh
                selectedStudentIds.clear();
                if (Array.isArray(data)) {
                    data.forEach(studentInfo => {
                        if (studentInfo?.clientId) {
                            connectedStudents.set(studentInfo.clientId, {
                                clientId: studentInfo.clientId,
                                email: studentInfo.email || 'Unknown Email',
                                status: 'connected', // Assume connected initially
                                lastUpdate: Date.now()
                            });
                        } else { console.warn("Ignoring invalid student entry in initial list:", studentInfo); }
                    });
                }
                needsGridRefresh = true;
                break;

            case 'student_connected':
                if (data?.clientId) {
                    console.info(`Student connected: ${data.email} (ID: ${data.clientId})`);
                    const student = getOrInitStudent(data.clientId); // Use getOrInit for robustness
                     student.email = data.email || student.email || 'Unknown Email'; // Update email if provided
                     student.status = 'connected';
                     student.lastUpdate = Date.now();
                    needsGridRefresh = true; // Add/update card
                } else { console.warn("Invalid 'student_connected' message:", data); }
                break;

            case 'student_disconnected':
                if (data?.clientId) {
                    console.info(`Student disconnected: ${data.clientId}`);
                    const student = connectedStudents.get(data.clientId);
                    if (student) {
                        student.status = 'disconnected';
                        student.lastUpdate = Date.now();
                        // Don't remove from map, render will handle visually
                        if (selectedStudentIds.has(data.clientId)) {
                            selectedStudentIds.delete(data.clientId);
                            // No grid refresh needed just for deselection, updateSelectionUI handles it
                            updateSelectionUI();
                        }
                         // Update the specific card directly for immediate feedback
                         updateStudentCard(data.clientId, student);
                         // needsGridRefresh = true; // Optional: full refresh if needed for sorting/filtering
                    }
                     // Check if detail modal was showing this student
                     if (domCache.studentDetailModal?.dataset.viewingClientId === data.clientId) {
                          // Optionally update modal title or show disconnected message
                     }
                } else { console.warn("Invalid 'student_disconnected' message:", data); }
                break;

            // --- Relayed Student Data Handling ---
            case 'student_screenshot':
                if (data?.clientId && data.payload?.imageData) {
                    const student = getOrInitStudent(data.clientId);
                    student.lastScreenshotUrl = data.payload.imageData;
                    student.lastUpdate = Date.now();
                    if (student.status !== 'locked') student.status = 'connected'; // Update status unless locked
                    updateStudentCard(data.clientId, student);
                    updateDetailModalScreenshotIfVisible(data.clientId, student.lastScreenshotUrl);
                } else { console.warn("Received 'student_screenshot' with missing data:", data); }
                break;

            case 'student_screenshot_error':
            case 'student_screenshot_skipped':
                 if (data?.clientId) { // Payload might be missing or just contain reason
                    const student = getOrInitStudent(data.clientId);
                    const reason = data?.payload?.error || data?.payload?.reason || "Screenshot unavailable";
                    console.warn(`Screenshot issue for ${data.clientId}: ${reason}`);
                    student.lastScreenshotUrl = null;
                    student.lastUpdate = Date.now();
                     if (student.status !== 'locked') student.status = 'connected';
                    updateStudentCard(data.clientId, student); // Show placeholder
                    updateDetailModalScreenshotIfVisible(data.clientId, null, reason);
                } else { console.warn(`Received '${type}' with missing clientId:`, data); }
                break;

            case 'student_tabs_update': // Handles the full tab list
            case 'student_tab_created': // Potentially handle single tab additions
            case 'student_tab_updated': // Potentially handle single tab updates
            case 'student_tab_removed': // Potentially handle single tab removals
                 if (data?.clientId && data.payload) {
                    const student = getOrInitStudent(data.clientId);

                    // If it's the full update, replace the tabs object
                    if (type === 'student_tabs_update') {
                         student.currentTabs = data.payload;
                    } else {
                         // TODO: More granular update based on single tab event payload
                         // This requires the payload for created/updated/removed to be defined
                         // Example: if (type === 'student_tab_removed') delete student.currentTabs[data.payload.tabId];
                         // For now, we'll just update based on the possibly partial payload if not 'tabs_update'
                         // A 'request_tabs' command might be useful after single events if needed.
                          if (typeof data.payload === 'object' && data.payload !== null) {
                               // Crude merge/update - needs server payload definition
                               student.currentTabs = { ...(student.currentTabs || {}), ...data.payload };
                          }
                    }

                    // Update cached active tab (safer to recalculate)
                    student.activeTab = typeof student.currentTabs === 'object'
                        ? Object.values(student.currentTabs || {}).find(tab => tab?.active) || null
                        : null;

                    student.lastUpdate = Date.now();
                     if (student.status !== 'locked') student.status = 'connected';
                    updateStudentCard(data.clientId, student); // Update card UI (favicon, title)
                    updateDetailModalTabsIfVisible(data.clientId, student.currentTabs); // Update modal if open
                } else { console.warn(`Received '${type}' with missing data:`, data); }
                break;

            // --- Direct Command Handling (e.g., student client confirming lock) ---
             // NOTE: Assumes student client sends 'status_update' AFTER lock/unlock command is processed.
             // If not, need explicit lock/unlock messages from server or student.
            case 'student_status_update': // Assuming student sends this on lock/unlock
                if (data?.clientId && ['locked', 'connected'].includes(data.payload?.status)) {
                     const student = getOrInitStudent(data.clientId);
                     const newStatus = data.payload.status;
                     if (student.status !== newStatus) {
                          console.info(`Status update for ${data.clientId}: ${newStatus}`);
                          student.status = newStatus;
                          student.lastUpdate = Date.now();
                          updateStudentCard(data.clientId, student); // Update card visual status (dot, overlay)
                          // Optionally update roster if implemented
                     }
                } else { console.warn("Received invalid 'student_status_update':", data); }
                 break;


            // --- Server Responses / Errors ---
            case 'command_failed':
                console.error(`Server Command Failed: Target=${data?.targetClientId}, Reason=${data?.reason}`);
                // Use a less intrusive notification than alert if possible
                showNotification(`Command failed for student ${data?.targetClientId || '?'}: ${data?.reason || 'Unknown'}`, 'error');
                // TODO: Revert any optimistic UI changes?
                break;

            case 'server_ack':
                console.info("Server ACK:", data?.message);
                break;

            case 'pong':
                // console.debug("Pong received"); // Keepalive confirmation
                break;

            case 'error': // Critical server error (e.g., duplicate teacher)
                console.error("Server Error:", data?.message);
                showNotification(`Server Error: ${data?.message}`, 'error');
                if (data?.message?.includes("Another teacher session is active")) {
                    // Disable UI and close connection
                    disableDashboard("Another teacher session is active. Please close this tab.");
                    if (teacherSocket) teacherSocket.close(1008, "Duplicate session"); // Policy Violation
                }
                break;

            default:
                console.warn(`Unhandled Server Message Type: ${type}`, data);
        }

        // --- Trigger UI Refresh if needed ---
        if (needsGridRefresh) {
            console.debug("Triggering full grid refresh...");
            renderStudentGrid();
            // updateRoster(); // If using a roster table view
            updateNoStudentsPlaceholder(); // Update based on potentially new student list
            updateBulkActionButtons();
            updateSelectedCount();
            // populateTargetStudentSelect(); // If using a target dropdown
        }
    }

    /**
     * Marks all students as disconnected visually, typically on WebSocket close.
     */
    function markAllStudentsDisconnected() {
        let changed = false;
        connectedStudents.forEach(student => {
            if (student.status !== 'disconnected') {
                student.status = 'disconnected';
                student.lastUpdate = Date.now(); // Mark update time
                changed = true;
            }
        });
        if (changed) {
            console.info("Marking all students disconnected visually.");
            renderStudentGrid(); // Re-render cards with disconnected status
            // updateRoster();
            selectedStudentIds.clear(); // Clear selection
            updateSelectionUI(); // Update counts and button states
        }
    }

    // --- UI Rendering & Updates ---

    /**
     * Renders the student grid, updating existing cards, adding new ones, and removing orphans.
     */
    function renderStudentGrid() {
        if (!domCache.studentGrid || !domCache.studentCardTemplate) {
            console.error("Cannot render grid: Grid container or template missing.");
            return;
        }

        const fragment = document.createDocumentFragment(); // For batch appending new cards
        const studentsToDisplay = getFilteredAndSortedStudents();
        const displayedStudentIds = new Set(studentsToDisplay.map(s => s.clientId));
        const currentCardElements = domCache.studentGrid.querySelectorAll('.student-card');

        // Remove cards for students no longer in the display list
        currentCardElements.forEach(card => {
            const clientId = card.dataset.clientId;
            if (clientId && !displayedStudentIds.has(clientId)) {
                card.remove();
                // console.debug(`Removed orphaned card: ${clientId}`);
            }
        });

        // Update existing cards or create and append new ones
        studentsToDisplay.forEach(student => {
            let card = domCache.studentGrid.querySelector(`.student-card[data-client-id="${student.clientId}"]`);
            if (!card) { // Card doesn't exist, create it
                card = createStudentCardElement(student.clientId); // Listener setup happens here
                if (card) fragment.appendChild(card);
                else console.error(`Failed to create card element for ${student.clientId}`);
            }
            // Update the card's content (whether new or existing)
             if (card) updateStudentCard(student.clientId, student, card);
        });

        // Append all new cards at once
        if (fragment.childNodes.length > 0) {
            domCache.studentGrid.appendChild(fragment);
        }

        updateNoStudentsPlaceholder(studentsToDisplay.length); // Update based on *displayed* count
        updateSelectionUI(); // Ensure selection counts/states are accurate
        // console.debug(`Grid render complete. Displayed: ${studentsToDisplay.length}`);
    }

    /**
     * Filters and sorts the current list of connected students based on state variables.
     * @returns {StudentState[]} Array of student state objects to display.
     */
    function getFilteredAndSortedStudents() {
        let studentsArray = Array.from(connectedStudents.values());

        // --- Filtering ---
        const filterLower = currentFilter.toLowerCase().trim();
        if (filterLower) {
            studentsArray = studentsArray.filter(student =>
                (student.email?.toLowerCase().includes(filterLower)) ||
                (student.clientId?.toLowerCase().includes(filterLower))
            );
        }
        // TODO: Add potential status filtering? (e.g., hide disconnected)

        // --- Sorting ---
        studentsArray.sort((a, b) => {
            // Status Sort Order: 'connected', 'locked', 'disconnected'
            if (currentSort === 'status') {
                const statusOrder = { connected: 1, locked: 2, disconnected: 3 };
                const statusA = statusOrder[a.status] || 4; // Unknown status last
                const statusB = statusOrder[b.status] || 4;
                if (statusA !== statusB) return statusA - statusB;
            }
            // Activity Sort (most recent update first)
            if (currentSort === 'activity') {
                return (b.lastUpdate || 0) - (a.lastUpdate || 0);
            }
            // Default: Name Sort
            return (a.email || a.clientId).localeCompare(b.email || b.clientId);
        });

        return studentsArray;
    }

    /**
     * Creates a student card element from the template and sets up basic listeners.
     * Does NOT populate dynamic content (use updateStudentCard for that).
     * @param {string} clientId - The student's client ID.
     * @returns {HTMLElement | null} The created card element or null if template missing.
     */
    function createStudentCardElement(clientId) {
        if (!domCache.studentCardTemplate) {
            console.error("Student card template not found.");
            return null;
        }
        try {
            const cardClone = domCache.studentCardTemplate.content.cloneNode(true);
            const cardElement = cardClone.querySelector('.student-card');
            if (!cardElement) throw new Error("Template missing .student-card element");

            cardElement.dataset.clientId = clientId; // Essential for linking actions

            // --- Attach Listeners ---
            const checkbox = cardElement.querySelector('.student-select');
            const screenshotContainer = cardElement.querySelector('.screenshot-container');
            const closeTabBtn = cardElement.querySelector('.close-tab-btn');
            // const menuBtn = cardElement.querySelector('.card-menu .card-action-btn');

             if (checkbox) checkbox.addEventListener('change', handleStudentSelectChange);
             if (screenshotContainer) screenshotContainer.addEventListener('click', () => showStudentDetail(clientId));
             if (closeTabBtn) {
                 closeTabBtn.addEventListener('click', (e) => {
                     e.stopPropagation(); // Prevent card click triggering detail modal
                     const student = connectedStudents.get(clientId);
                     const activeTabId = student?.activeTab?.id;
                     if (activeTabId) {
                         showConfirmation(`Close active tab for ${student?.email || clientId}?`, () => {
                             sendStudentCommand(clientId, 'close_tab', { tabId: activeTabId });
                         });
                     } else { showNotification('Could not determine the active tab for this student.', 'warn'); }
                 });
             }
            // if (menuBtn) menuBtn.addEventListener('click', handleCardMenuClick);

            return cardElement;
        } catch (error) {
            console.error(`Error creating student card element for ${clientId}:`, error);
            return null;
        }
    }

    /**
     * Updates the content and visual state of a specific student card.
     * @param {string} clientId - The student's client ID.
     * @param {StudentState} studentData - The current state data for the student.
     * @param {HTMLElement} [cardElement] - Optional cached card element.
     */
    function updateStudentCard(clientId, studentData, cardElement = null) {
        const card = cardElement || domCache.studentGrid?.querySelector(`.student-card[data-client-id="${clientId}"]`);
        if (!card || !studentData) return; // Exit if card not found or data missing

        // Update data attribute for CSS styling based on status
        card.dataset.status = studentData.status || 'disconnected';

        // --- Update Card Elements ---
        // Defensive updates: check if element exists before updating
        const nameEl = card.querySelector('.student-name');
        const screenshotImg = card.querySelector('.screenshot-img');
        const noScreenshotOverlay = card.querySelector('.no-screenshot-overlay');
        const lastUpdatedEl = card.querySelector('.last-updated');
        const faviconEl = card.querySelector('.favicon');
        const tabTitleEl = card.querySelector('.tab-title');
        const lockOverlay = card.querySelector('.card-lock-overlay');
        const selectCheckbox = card.querySelector('.student-select');

        if (nameEl) nameEl.textContent = studentData.email || `ID: ${clientId.substring(0, 6)}`;
        if (selectCheckbox) selectCheckbox.checked = selectedStudentIds.has(clientId);

        // Screenshot Area
        if (screenshotImg && noScreenshotOverlay && lastUpdatedEl) {
            if (studentData.status === 'disconnected') {
                 screenshotImg.style.display = 'none';
                 if(screenshotImg.src !== PLACEHOLDER_SCREENSHOT) screenshotImg.src = PLACEHOLDER_SCREENSHOT;
                 noScreenshotOverlay.textContent = "Disconnected";
                 noScreenshotOverlay.classList.remove('hidden');
                 lastUpdatedEl.textContent = ''; // Clear timestamp when disconnected
            } else if (studentData.lastScreenshotUrl) {
                if (screenshotImg.src !== studentData.lastScreenshotUrl) screenshotImg.src = studentData.lastScreenshotUrl;
                screenshotImg.style.display = 'block';
                noScreenshotOverlay.classList.add('hidden');
                 lastUpdatedEl.textContent = studentData.lastUpdate ? `${new Date(studentData.lastUpdate).toLocaleTimeString()}` : '';
            } else { // Connected but no screenshot URL
                screenshotImg.style.display = 'none';
                 if(screenshotImg.src !== PLACEHOLDER_SCREENSHOT) screenshotImg.src = PLACEHOLDER_SCREENSHOT;
                noScreenshotOverlay.textContent = "No Screenshot";
                noScreenshotOverlay.classList.remove('hidden');
                 lastUpdatedEl.textContent = studentData.lastUpdate ? `${new Date(studentData.lastUpdate).toLocaleTimeString()}` : '';
            }
             // Handle image load errors for screenshots
             screenshotImg.onerror = () => {
                  if(screenshotImg.src !== PLACEHOLDER_SCREENSHOT) { // Prevent infinite loop if placeholder fails
                      console.warn(`Failed to load screenshot for ${clientId}: ${screenshotImg.src}`);
                      screenshotImg.src = PLACEHOLDER_SCREENSHOT;
                      screenshotImg.style.display = 'none';
                      noScreenshotOverlay.textContent = "Load Error";
                      noScreenshotOverlay.classList.remove('hidden');
                  }
             }
        }

        // Active Tab Info (Footer)
        if (faviconEl && tabTitleEl) {
            const activeTab = studentData.activeTab; // Already derived
             let displayTitle = 'No Active Tab';
             let displayUrl = '';
             let displayFavicon = PLACEHOLDER_FAVICON;

            if (studentData.status === 'disconnected') {
                 displayTitle = 'Disconnected';
            } else if (studentData.status === 'locked') {
                 displayTitle = 'Screen Locked';
             } else if (activeTab) {
                 displayTitle = activeTab.title || 'Untitled Tab';
                 displayUrl = activeTab.url || '';
                 displayFavicon = activeTab.favIconUrl || PLACEHOLDER_FAVICON;
            } // else 'No Active Tab' is default

             if (faviconEl.src !== displayFavicon) faviconEl.src = displayFavicon;
             tabTitleEl.textContent = displayTitle;
             tabTitleEl.title = displayUrl; // Show full URL on hover

            faviconEl.onerror = () => { if (faviconEl.src !== PLACEHOLDER_FAVICON) faviconEl.src = PLACEHOLDER_FAVICON; };
        }

        // Lock Overlay
        if (lockOverlay) lockOverlay.classList.toggle('hidden', studentData.status !== 'locked');
    }


    /**
     * Updates the placeholder message visibility and content.
     * @param {number} displayedCount - The number of students currently displayed after filtering.
     */
    function updateNoStudentsPlaceholder(displayedCount = -1) {
        if (!domCache.noStudentsPlaceholder || !domCache.loadingPlaceholder) return;

        domCache.loadingPlaceholder.classList.add('hidden'); // Hide loading indicator

        const totalStudents = connectedStudents.size;
        const anyConnectedOrLocked = Array.from(connectedStudents.values()).some(s => s.status === 'connected' || s.status === 'locked');
        const countToUse = displayedCount >= 0 ? displayedCount : totalStudents; // Use displayed count if available

        let message = "";
        if (totalStudents === 0) message = "No students connected yet.";
        else if (!anyConnectedOrLocked) message = "All students are disconnected.";
        else if (countToUse === 0 && currentFilter) message = `No students match filter "${currentFilter}".`;

        if (message) {
            domCache.noStudentsPlaceholder.textContent = message;
            domCache.noStudentsPlaceholder.classList.remove('hidden');
        } else {
            domCache.noStudentsPlaceholder.classList.add('hidden');
        }
    }

    // --- Selection Management ---

    /**
     * Handles changes to individual student selection checkboxes.
     * @param {Event} event - The change event object.
     */
    function handleStudentSelectChange(event) {
        const checkbox = event.target;
        const card = checkbox.closest('.student-card');
        const clientId = card?.dataset.clientId;
        if (!clientId) {
             console.warn("Could not identify clientId from checkbox change event.");
             return;
        }

        if (checkbox.checked) selectedStudentIds.add(clientId);
        else selectedStudentIds.delete(clientId);

        updateSelectionUI(); // Update counts, button states, selectAll checkbox
    }

    /**
     * Updates the 'Select All' checkbox state and the selected count display.
     */
    function updateSelectionUI() {
        const selectedCount = selectedStudentIds.size;
        if (domCache.selectedCountSpan) domCache.selectedCountSpan.textContent = `(${selectedCount} Selected)`;

        // Update bulk action button disabled state
        domCache.actionButtons.forEach(btn => { btn.disabled = (selectedCount === 0); });

        // Update 'Select All' checkbox state
        if (domCache.selectAllCheckbox) {
             const displayedCards = domCache.studentGrid.querySelectorAll('.student-card');
             const totalDisplayed = displayedCards.length;
             if (totalDisplayed === 0) {
                  domCache.selectAllCheckbox.checked = false;
                  domCache.selectAllCheckbox.indeterminate = false;
             } else {
                  const allDisplayedSelected = selectedCount === totalDisplayed && totalDisplayed > 0;
                  domCache.selectAllCheckbox.checked = allDisplayedSelected;
                  domCache.selectAllCheckbox.indeterminate = selectedCount > 0 && !allDisplayedSelected;
             }
        }
    }

    // Add listener for the 'Select All' checkbox
    if (domCache.selectAllCheckbox) {
        domCache.selectAllCheckbox.addEventListener('change', () => {
            const isChecked = domCache.selectAllCheckbox.checked;
            selectedStudentIds.clear(); // Clear previous selection first

            if (isChecked) {
                // Select all students currently *displayed* in the grid (respects filters)
                domCache.studentGrid.querySelectorAll('.student-card').forEach(card => {
                    if (card.dataset.clientId) selectedStudentIds.add(card.dataset.clientId);
                });
            }

            // Update individual checkboxes to match the 'Select All' state
            domCache.studentGrid.querySelectorAll('.student-select').forEach(cb => { cb.checked = isChecked; });
            updateSelectionUI(); // Update counts and buttons
        });
    }


    // --- Roster View (Placeholder) ---
    // function updateRoster() { /* ... Implementation ... */ }

    // --- Event Listeners Setup ---

    /**
     * Attaches global event listeners (sidebar, navigation, filters, modals, etc.).
     */
    function attachEventListeners() {
        // Sidebar Toggle
        domCache.sidebarToggle?.addEventListener('click', () => {
            domCache.body.classList.toggle('sidebar-collapsed');
            // TODO: Add specific mobile overlay logic if required
        });

        // Sidebar Navigation (using event delegation on the list)
        domCache.navList?.addEventListener('click', (e) => {
            const navLink = e.target.closest('.nav-item a');
            if (!navLink) return;
            const navItem = navLink.closest('.nav-item');
            const targetView = navItem?.dataset.view;
            if (targetView) {
                e.preventDefault();
                switchView(targetView);
            }
        });

        // Filtering and Sorting
        domCache.filterStudentsInput?.addEventListener('input', debounce(handleFilterInput, 300)); // Debounce filter input
        domCache.sortStudentsSelect?.addEventListener('change', handleSortChange);

        // Toolbar Actions (Bulk Commands)
        document.getElementById('lock-selected')?.addEventListener('click', () => sendBulkCommand('lock_screen', { message: "Screen Locked" }));
        document.getElementById('unlock-selected')?.addEventListener('click', () => sendBulkCommand('unlock_screen'));
        document.getElementById('open-tab-selected')?.addEventListener('click', () => showModal('open-tab-modal'));
        document.getElementById('announce-selected')?.addEventListener('click', () => showModal('announce-modal'));
        document.getElementById('close-tab-selected')?.addEventListener('click', handleBulkCloseTab);
        document.getElementById('block-site-selected')?.addEventListener('click', handleBulkBlockSite);
        document.getElementById('focus-selected')?.addEventListener('click', handleBulkFocusTab);

        // Modal Confirmations
        domCache.confirmOpenTabBtn?.addEventListener('click', handleConfirmOpenTab);
        domCache.confirmAnnounceBtn?.addEventListener('click', handleConfirmAnnounce);
        // Add listeners for other modal confirmations

        // Modal Closing (delegated)
        document.addEventListener('click', handleModalCloseTriggers);
        window.addEventListener('keydown', handleEscapeKey);

         // Detail Modal Tab Close Button (delegated)
         domCache.detailModalTabListEl?.addEventListener('click', handleDetailTabClose);

    } // End attachEventListeners

    // --- Event Handlers ---

    function handleFilterInput(event) {
        currentFilter = event.target.value;
        renderStudentGrid();
    }

    function handleSortChange(event) {
        currentSort = event.target.value;
        renderStudentGrid();
    }

    function handleBulkCloseTab() {
        if (selectedStudentIds.size > 0) {
             showConfirmation(`Close the active tab for ${selectedStudentIds.size} selected students?`, () => {
                  // Assumes student client can identify and close its own active tab
                  sendBulkCommand('close_active_tab', {});
             });
        }
    }

    function handleBulkBlockSite() {
        if (selectedStudentIds.size === 0) return;
        // Use a more robust modal instead of prompt in a real app
        const blocklistString = prompt(`Enter block patterns for ${selectedStudentIds.size} students (one per line):\n(e.g., *://*.example.com/*)`);
        if (blocklistString !== null) {
            const blockedSites = blocklistString.split('\n').map(s => s.trim()).filter(Boolean);
            if (blockedSites.length > 0) sendBulkCommand('update_blocklist', { blockedSites });
            else showNotification("No block patterns entered.", "warn");
        }
    }

    function handleBulkFocusTab() {
        if (selectedStudentIds.size === 0) return;
        const url = prompt(`Enter URL to focus ${selectedStudentIds.size} students on:`, "https://");
        if (url && url !== "https://") {
             if (!isValidUrl(url)) {
                  showNotification('Please enter a valid URL (http:// or https://)', 'error'); return;
             }
            sendBulkCommand('focus_tab', { url }); // Client needs to implement 'focus_tab' command
        }
    }


    function handleConfirmOpenTab() {
        const url = domCache.openTabUrlInput?.value?.trim();
        if (!url) { showNotification("Please enter a URL.", "warn"); return; }
        if (!isValidUrl(url)) { showNotification('URL must start with http:// or https://', 'error'); return; }
        if (selectedStudentIds.size === 0) { showNotification("No students selected.", "warn"); return; }

        sendBulkCommand('open_tab', { url });
        closeModal('open-tab-modal');
    }

    function handleConfirmAnnounce() {
        const message = domCache.announceMessageInput?.value?.trim();
        const duration = parseInt(domCache.announceDurationInput?.value || '10', 10) * 1000; // s to ms
        if (!message) { showNotification("Please enter a message.", "warn"); return; }
        if (isNaN(duration) || duration < 1000) { showNotification("Invalid duration (min 1 second).", "error"); return; }
        if (selectedStudentIds.size === 0) { showNotification("No students selected.", "warn"); return; }

        sendBulkCommand('send_announcement', { message, duration });
        closeModal('announce-modal');
    }

    function handleModalCloseTriggers(event) {
        if (event.target.matches('.close-modal-btn')) {
            const modalId = event.target.dataset.modalId;
            if (modalId) closeModal(modalId);
        } else if (event.target.matches('.modal')) {
             // Close if clicking on the modal backdrop (the .modal element itself)
             closeModal(event.target.id);
        }
    }

    function handleEscapeKey(event) {
        if (event.key === 'Escape') {
            document.querySelectorAll('.modal:not(.hidden)').forEach(modal => closeModal(modal.id));
        }
    }

     function handleDetailTabClose(event) {
         const button = event.target.closest('.close-detail-tab-btn'); // Use closest for safety
         if (!button) return; // Click wasn't on a close button or its child

         const tabId = button.dataset.tabId;
         const clientId = domCache.studentDetailModal?.dataset.viewingClientId;

         if (tabId && clientId) {
              showConfirmation("Close this tab for the student?", () => {
                   sendStudentCommand(clientId, 'close_tab', { tabId: parseInt(tabId, 10) });
                   // Optimistically remove from UI
                   button.closest('li')?.remove();
                   // TODO: Update 'other tabs' count if displayed
              });
         } else {
              console.warn("Could not get tabId or clientId for closing tab in detail modal.");
         }
     }

    // --- Command Sending ---

    /**
     * Sends a command targeting a specific student via the WebSocket server.
     * @param {string} clientId - The target student's client ID.
     * @param {string} command - The command name (e.g., 'lock_screen').
     * @param {object} [commandData={}] - Optional data payload for the command.
     */
    function sendStudentCommand(clientId, command, commandData = {}) {
        if (!clientId || !command) {
             console.error("sendStudentCommand requires clientId and command."); return;
        }
        console.info(`CMD -> ${clientId}: ${command}`, commandData);
        sendMessageToServer({
            type: 'teacher_command',
            data: { // Payload structure expected by server.js
                targetClientId: clientId,
                command: command,
                data: commandData // Payload for the student client
            }
        });
        // TODO: Implement optimistic UI updates (e.g., card showing 'locking...')
    }

    /**
     * Sends a command to all currently selected students.
     * @param {string} command - The command name.
     * @param {object} [commandData={}] - Optional data payload for the command.
     */
    function sendBulkCommand(command, commandData = {}) {
        const targetIds = Array.from(selectedStudentIds);
        if (targetIds.length === 0) {
             showNotification("No students selected for bulk action.", "warn");
             return;
        }
        console.info(`Bulk CMD -> ${targetIds.length} students: ${command}`, commandData);
        targetIds.forEach(clientId => {
            sendStudentCommand(clientId, command, commandData);
        });
        // TODO: Implement optimistic UI updates for all selected cards
    }

    // --- Modal Management ---

    /**
     * Shows a modal dialog.
     * @param {string} modalId - The ID of the modal element.
     */
    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
             modal.classList.remove('hidden');
             // Attempt to focus the first focusable element within the modal
             modal.querySelector('input, textarea, button')?.focus();
        } else { console.error(`Modal with ID "${modalId}" not found.`); }
    }

    /**
     * Hides a modal dialog and resets its fields.
     * @param {string} modalId - The ID of the modal element.
     */
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('hidden');
        // Reset fields based on modal ID
        switch (modalId) {
            case 'open-tab-modal': if (domCache.openTabUrlInput) domCache.openTabUrlInput.value = ''; break;
            case 'announce-modal':
                 if (domCache.announceMessageInput) domCache.announceMessageInput.value = '';
                 if (domCache.announceDurationInput) domCache.announceDurationInput.value = '10';
                 break;
            // Add cases for other modals
        }
    }


    // --- Student Detail Modal Logic ---

    /**
     * Displays the detailed view modal for a specific student.
     * @param {string} clientId - The client ID of the student to show details for.
     */
    function showStudentDetail(clientId) {
        const student = connectedStudents.get(clientId);
        if (!student || !domCache.studentDetailModal) {
             console.warn(`Cannot show detail: Student ${clientId} not found or modal element missing.`);
             return;
        }

        console.info(`Showing detail modal for: ${clientId}`);

        // Store the currently viewed client ID on the modal itself
        domCache.studentDetailModal.dataset.viewingClientId = clientId;

        // Populate modal content immediately with current data
        if (domCache.detailModalStudentName) {
            domCache.detailModalStudentName.textContent = student.email || `ID: ${clientId}`;
        }
        updateDetailModalScreenshotIfVisible(clientId, student.lastScreenshotUrl);
        updateDetailModalTabsIfVisible(clientId, student.currentTabs);
        updateDetailModalActivity(clientId); // Placeholder for activity log

        showModal('student-detail-modal');

        // Optional: Send a request for fresh/more detailed data for this specific student
        // sendStudentCommand(clientId, 'get_detailed_state', {});
    }

    /**
     * Updates the screenshot in the detail modal, but only if it's visible and for the correct student.
     * @param {string} clientId - The client ID this update pertains to.
     * @param {string | null} screenshotUrl - The new screenshot URL or null.
     * @param {string} [errorMsg] - Optional error message if screenshot failed.
     */
    function updateDetailModalScreenshotIfVisible(clientId, screenshotUrl, errorMsg = null) {
        if (!domCache.studentDetailModal || domCache.studentDetailModal.classList.contains('hidden') || domCache.studentDetailModal.dataset.viewingClientId !== clientId) {
            return; // Modal not visible or showing a different student
        }
        if (domCache.detailModalScreenshot) {
            if (screenshotUrl) {
                 // Avoid reloading the same image unnecessarily
                 if (domCache.detailModalScreenshot.src !== screenshotUrl) {
                      domCache.detailModalScreenshot.src = screenshotUrl;
                 }
                domCache.detailModalScreenshot.alt = `Screenshot for ${student.email || clientId}`;
                 // TODO: Hide potential error overlay
            } else {
                 if (domCache.detailModalScreenshot.src !== PLACEHOLDER_SCREENSHOT) {
                      domCache.detailModalScreenshot.src = PLACEHOLDER_SCREENSHOT;
                 }
                domCache.detailModalScreenshot.alt = errorMsg || `Screenshot unavailable`;
                 // TODO: Show potential error overlay
            }
             // Handle image load errors
             domCache.detailModalScreenshot.onerror = () => {
                  if (domCache.detailModalScreenshot.src !== PLACEHOLDER_SCREENSHOT) {
                       console.warn(`Failed to load detail screenshot for ${clientId}: ${domCache.detailModalScreenshot.src}`);
                       domCache.detailModalScreenshot.src = PLACEHOLDER_SCREENSHOT;
                       domCache.detailModalScreenshot.alt = `Screenshot failed to load`;
                  }
             };
        }
    }

    /**
     * Updates the tab lists in the detail modal, but only if visible and for the correct student.
     * Handles potential text overflow.
     * @param {string} clientId - The client ID this update pertains to.
     * @param {Object<string, TabData>} [tabsData] - The student's current tabs object.
     */
    function updateDetailModalTabsIfVisible(clientId, tabsData = {}) {
        if (!domCache.studentDetailModal || domCache.studentDetailModal.classList.contains('hidden') || domCache.studentDetailModal.dataset.viewingClientId !== clientId) {
            return; // Modal not visible or showing a different student
        }

        const tabsArray = typeof tabsData === 'object' ? Object.values(tabsData || {}) : [];
        const activeTab = tabsArray.find(tab => tab?.active) || null;

        // Update Active Tab Display
        if (domCache.detailModalActiveTabEl) {
            domCache.detailModalActiveTabEl.innerHTML = ''; // Clear previous
            if (activeTab) {
                const activeTabContent = createTabListItem(activeTab, clientId, true); // Create the element
                domCache.detailModalActiveTabEl.appendChild(activeTabContent);
            } else {
                domCache.detailModalActiveTabEl.innerHTML = '<p class="text-muted">No active tab reported.</p>';
            }
        }

        // Update Other Tabs List
        if (domCache.detailModalTabListEl) {
            domCache.detailModalTabListEl.innerHTML = ''; // Clear previous
            let otherTabCount = 0;
            tabsArray.forEach(tab => {
                if (tab && !tab.active) {
                    otherTabCount++;
                     const otherTabContent = createTabListItem(tab, clientId, false); // Create the element
                     domCache.detailModalTabListEl.appendChild(otherTabContent);
                }
            });
            if (otherTabCount === 0) {
                domCache.detailModalTabListEl.innerHTML = '<li class="text-muted">No other tabs reported.</li>';
            }
             // Note: Event listener for close buttons is now delegated on the parent list (detailModalTabListEl)
        }
    }

    /**
     * Creates an HTML element (or string) representing a tab for the detail modal list.
     * Includes elements for favicon, title, URL (truncated), and close button.
     * @param {TabData} tab - The tab data object.
     * @param {string} clientId - The student's client ID (for actions).
     * @param {boolean} isActive - Whether this is the active tab item.
     * @returns {HTMLElement} The created list item element.
     */
    function createTabListItem(tab, clientId, isActive) {
        const li = document.createElement(isActive ? 'div' : 'li'); // Use div for active, li for others
         li.className = `tab-item ${isActive ? 'active-tab-detail' : ''}`; // Add classes for styling
         li.dataset.tabId = tab.id;

         const faviconSrc = tab.favIconUrl || PLACEHOLDER_FAVICON;
         const titleText = tab.title || 'Untitled Tab';
         const urlText = tab.url || 'No URL';

         // Structure designed for CSS truncation (e.g., text-overflow: ellipsis)
         // Use `title` attribute on spans to show full text on hover.
         li.innerHTML = `
            <img src="${faviconSrc}" class="favicon tab-favicon" alt="" onerror="this.onerror=null; this.src='${PLACEHOLDER_FAVICON}';">
            <div class="tab-info">
                <span class="tab-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</span>
                <span class="tab-url" title="${escapeHtml(urlText)}">${escapeHtml(urlText)}</span>
            </div>
            <button class="btn btn-icon btn-sm btn-danger close-detail-tab-btn" data-tab-id="${tab.id}" title="Close Tab">&times;</button>
         `;
         return li;
    }

    /**
     * Updates the activity log in the student detail modal. (Placeholder)
     * @param {string} clientId - The client ID of the student.
     */
    function updateDetailModalActivity(clientId) {
        if (!domCache.studentDetailModal || domCache.studentDetailModal.classList.contains('hidden') || domCache.studentDetailModal.dataset.viewingClientId !== clientId) {
            return;
        }
         if (domCache.detailModalActivityLogEl) {
              // TODO: Fetch or use stored activity data for the student
              domCache.detailModalActivityLogEl.innerHTML = '<li>Activity log feature not implemented.</li>';
         }
    }


    // --- View Management ---

    /**
     * Switches the currently visible view in the main content area.
     * @param {string} viewId - The ID of the view to activate (e.g., 'screens', 'timeline').
     */
    function switchView(viewId) {
        if (!viewId) return;
        activeViewId = viewId; // Update state

        // Update Navigation Highlight
        domCache.navList?.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewId);
        });

        // Update Header Title
        if (domCache.currentViewTitle) {
            const activeNavItem = domCache.navList?.querySelector(`.nav-item[data-view="${viewId}"] span`);
            domCache.currentViewTitle.textContent = activeNavItem?.textContent || 'Dashboard';
        }

        // Toggle View Visibility
        domCache.views.forEach(view => {
            view.classList.toggle('active', view.id === `${viewId}-view`);
        });

        console.info(`Switched view to: ${viewId}`);

        // --- Actions on View Switch ---
        switch (viewId) {
            case 'screens':
                renderStudentGrid(); // Ensure grid is up-to-date when switching to it
                break;
            case 'timeline':
                // TODO: Fetch/display timeline data
                break;
            case 'students':
                // TODO: Fetch/display student roster data (updateRoster())
                break;
            case 'settings':
                // TODO: Load settings into form fields
                break;
            case 'reports':
                // TODO: Fetch/display report data
                break;
        }
    }

    // --- Utility Functions ---

    /**
     * Basic check for http(s) URL format.
     * @param {string} str - The string to check.
     * @returns {boolean} True if it looks like a valid web URL.
     */
    function isValidUrl(str) {
        if (!str) return false;
        return str.startsWith('http://') || str.startsWith('https://');
    }

    /**
     * Simple HTML escaping function.
     * @param {string} str - String to escape.
     * @returns {string} Escaped string.
     */
     function escapeHtml(str) {
         if (!str) return '';
         return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
     }

     /**
     * Creates a debounced function that delays invoking func until after wait milliseconds.
     * @param {Function} func - The function to debounce.
     * @param {number} wait - The number of milliseconds to delay.
     * @returns {Function} The new debounced function.
     */
     function debounce(func, wait) {
         let timeout;
         return function executedFunction(...args) {
             const later = () => {
                 clearTimeout(timeout);
                 func.apply(this, args);
             };
             clearTimeout(timeout);
             timeout = setTimeout(later, wait);
         };
     }

    /**
     * Shows a simple confirmation dialog before executing an action.
     * @param {string} message - The confirmation message.
     * @param {Function} onConfirm - Callback function to execute if confirmed.
     */
     function showConfirmation(message, onConfirm) {
          if (window.confirm(message)) {
               if (typeof onConfirm === 'function') onConfirm();
          }
     }

     /**
     * Displays a temporary notification message (replace with a better UI element).
     * @param {string} message - The message to display.
     * @param {'info' | 'warn' | 'error'} [level='info'] - The notification level.
     */
     function showNotification(message, level = 'info') {
          // TODO: Implement a more user-friendly notification system (e.g., toast messages)
          console[level === 'error' ? 'error' : (level === 'warn' ? 'warn' : 'info')](`Notification: ${message}`);
          // Simple alert for errors, maybe remove for production
          if (level === 'error') {
               alert(`Error: ${message}`);
          }
     }

     /**
      * Disables dashboard interaction, useful for critical errors like duplicate sessions.
      * @param {string} message - Message to display to the user.
      */
     function disableDashboard(message) {
          // Simple overlay example - enhance as needed
          let overlay = document.getElementById('dashboard-disabled-overlay');
          if (!overlay) {
               overlay = document.createElement('div');
               overlay.id = 'dashboard-disabled-overlay';
               overlay.style.position = 'fixed';
               overlay.style.top = '0';
               overlay.style.left = '0';
               overlay.style.width = '100%';
               overlay.style.height = '100%';
               overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
               overlay.style.color = 'white';
               overlay.style.display = 'flex';
               overlay.style.justifyContent = 'center';
               overlay.style.alignItems = 'center';
               overlay.style.zIndex = '9999';
               overlay.style.fontSize = '1.5em';
               overlay.style.textAlign = 'center';
               domCache.body.appendChild(overlay);
          }
          overlay.textContent = message;
          console.error("Dashboard disabled:", message);
          // Optionally disable specific buttons/inputs
     }


    // --- Initialization ---
    /**
     * Initializes the dashboard UI, sets up event listeners, and connects to WebSocket.
     */
    function initializeDashboard() {
        console.info("Initializing Saber Dashboard...");
        if (window.innerWidth <= 768) domCache.body.classList.add('sidebar-collapsed'); // Initial mobile state

        attachEventListeners(); // Set up UI interactions
        switchView(activeViewId); // Set the initial view
        updateSelectionUI(); // Initialize button/selection states
        updateNoStudentsPlaceholder(); // Show initial placeholder state
        connectWebSocket(); // Start connection process

        console.info("Dashboard Initialized.");
    }

    // --- Start Application ---
    initializeDashboard();

}); // End DOMContentLoaded
