// Updated script.js V3 - Attempting to fix interaction and state issues
document.addEventListener('DOMContentLoaded', () => {
    console.log("Saber Teacher Dashboard Initializing V3...");

    // --- Configuration ---
    const WS_URL = "wss://extension.mkseven1.com"; // Double-check this URL!
    const PLACEHOLDER_FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkIAAYIBAAJBtnBAAAAABJRU5ErkJggg=='; // Transparent pixel

    // --- DOM Elements ---
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.getElementById('main-content');
    const navList = document.querySelector('.nav-list'); // Target the UL for delegation
    const views = document.querySelectorAll('.view');
    const currentViewTitle = document.getElementById('current-view-title');
    const connectionStatusDiv = document.getElementById('connection-status');
    const connectionStatusText = connectionStatusDiv?.querySelector('.text');
    const studentGrid = document.getElementById('student-grid');
    const loadingPlaceholder = document.getElementById('loading-students-placeholder');
    const noStudentsPlaceholder = document.getElementById('no-students-placeholder');
    const studentCardTemplate = document.getElementById('student-card-template');

    // Roster View
    const studentRosterView = document.getElementById('students-view'); // Parent view
    const studentRosterBody = document.getElementById('student-roster-body');
    const studentRosterRowTemplate = document.getElementById('student-roster-row-template');
    const rosterSelectAllCheckbox = document.getElementById('roster-select-all');
    const rosterFilterInput = document.getElementById('roster-filter-input');

    // Toolbar (Screens View)
    const screensViewToolbar = document.querySelector('#screens-view .view-toolbar'); // For delegation if needed
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const selectedCountSpan = document.getElementById('selected-count');
    const lockSelectedBtn = document.getElementById('lock-selected-btn');
    const unlockSelectedBtn = document.getElementById('unlock-selected-btn');
    const openTabSelectedBtn = document.getElementById('open-tab-selected-btn');
    const announceSelectedBtn = document.getElementById('announce-selected-btn');
    const blockSiteSelectedBtn = document.getElementById('block-site-selected-btn');
    const sortStudentsSelect = document.getElementById('sort-students');
    const filterStudentsInput = document.getElementById('filter-students');

    // Action Modals
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

    // Large Student Detail Modal & Elements
    const studentDetailModal = document.getElementById('student-detail-modal');
    const detailModalStudentName = document.getElementById('detail-modal-student-name');
    const detailModalScreenshot = document.getElementById('detail-modal-screenshot');
    const detailModalActiveTabDiv = document.getElementById('detail-modal-active-tab');
    const detailModalOtherTabsList = document.getElementById('detail-modal-other-tabs-list');
    const detailModalOtherTabsCount = document.getElementById('detail-modal-other-tabs-count');
    const detailModalTabItemTemplate = document.getElementById('detail-modal-tab-item-template');
    // Buttons inside detail modal (get parent for delegation if needed)
    const detailModalActions = studentDetailModal?.querySelector('.detail-actions');
    const detailModalTabSection = studentDetailModal?.querySelector('.student-tabs-view');


    // Settings View Controls
    const defaultBlocklistInput = document.getElementById('default-blocklist-input');
    const saveDefaultBlocklistBtn = document.getElementById('save-default-blocklist-btn');
    const defaultIntervalInput = document.getElementById('default-interval-input');
    const saveDefaultIntervalBtn = document.getElementById('save-default-interval-btn');

    // Header Controls (Session - Placeholders)
    const startSessionBtn = document.getElementById('start-session-btn');
    const endSessionBtn = document.getElementById('end-session-btn');
    const currentSessionInfo = document.getElementById('current-session-info');

    // --- State Variables ---
    let teacherSocket = null;
    let connectedStudents = new Map(); // clientId -> { clientId, email, userId, currentTabs, status, lastScreenshotUrl, lastUpdate, elementRef? }
    let selectedStudentIds = new Set();
    let currentSessionId = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_DELAY = 5000;
    let reconnectTimeoutId = null;
    let currentSort = 'name';
    let currentFilter = '';
    let activeViewId = 'screens-view'; // Track the currently active view


    // --- WebSocket Functions --- (Robust reconnection logic - unchanged)
    function connectWebSocket() {
        if (teacherSocket && (teacherSocket.readyState === WebSocket.OPEN || teacherSocket.readyState === WebSocket.CONNECTING)) {
            console.log("WebSocket already open or connecting.");
            return;
        }

        updateConnectionStatus('connecting', 'Connecting...');
        console.log(`Attempting to connect to ${WS_URL}...`);
        teacherSocket = new WebSocket(WS_URL);

        teacherSocket.onopen = () => {
            updateConnectionStatus('connected', 'Connected');
            reconnectAttempts = 0;
            sendMessageToServer({ type: 'teacher_connect' }); // Identify as teacher
            console.log('WebSocket connection established.');
            // Request initial data if needed (e.g., active sessions, initial students)
             requestInitialData();
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
            // onclose will likely follow, handle cleanup there
        };

        teacherSocket.onclose = (event) => {
            console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
            updateConnectionStatus('disconnected', `Closed (${event.code})`);
            teacherSocket = null;
            markAllStudentsDisconnected(); // Update UI for all students

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(`Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_DELAY / 1000}s...`);
                updateConnectionStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
                setTimeout(connectWebSocket, RECONNECT_DELAY);
            } else {
                console.error("Max WebSocket reconnect attempts reached.");
                updateConnectionStatus('disconnected', 'Reconnect failed');
            }
        };
    }

    function scheduleReconnect() {
        // Avoid scheduling if already trying or connected
        if (reconnectTimeoutId || (teacherSocket && teacherSocket.readyState === WebSocket.OPEN)) {
             return;
        }

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_DELAY / 1000}s...`);
            updateConnectionStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
            reconnectTimeoutId = setTimeout(connectWebSocket, RECONNECT_DELAY);
        } else {
            console.error("Max WebSocket reconnect attempts reached.");
            updateConnectionStatus('disconnected', 'Reconnect failed');
        }
    }
    function requestInitialData() {
         // Ask server for list of currently connected students in relevant sessions
         // This depends on your server implementation
         sendMessageToServer({ type: 'request_initial_state' });
     }
     function sendMessageToServer(payload) {
        if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
            try {
                teacherSocket.send(JSON.stringify(payload));
            } catch (error) {
                console.error("Error sending message:", error);
            }
        } else {
            console.warn("WebSocket not open. Message not sent:", payload);
            // Optionally show an error to the user
            // alert("Cannot send command: Not connected to the server.");
        }
    }
    function updateConnectionStatus(status, text) {
        connectionStatusDiv.className = `status-indicator ${status}`;
        connectionStatusText.textContent = text;
    }
    // Add implementations from V2 if they were removed
     function connectWebSocket() {
         if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
         reconnectTimeoutId = null;

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
             scheduleReconnect();
             return;
         }

         teacherSocket.onopen = () => {
             updateConnectionStatus('connected', 'Connected');
             reconnectAttempts = 0;
             console.log('WebSocket connection established.');
             sendMessageToServer({ type: 'teacher_connect' });
             requestInitialData();
         };

         teacherSocket.onmessage = (event) => {
             try {
                 const message = JSON.parse(event.data);
                 handleServerMessage(message);
             } catch (error) {
                 console.error('Error processing message or invalid JSON:', event.data, error);
             }
         };

         teacherSocket.onerror = (error) => {
             console.error("WebSocket error:", error);
             updateConnectionStatus('disconnected', 'Error');
             // onclose will handle reconnect scheduling
         };

         teacherSocket.onclose = (event) => {
             console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
             const reasonText = event.reason ? ` (${event.reason})` : ` (Code: ${event.code})`;
             updateConnectionStatus('disconnected', `Closed${reasonText}`);
             teacherSocket = null;
             markAllStudentsDisconnected();
             scheduleReconnect();
         };
     }

     function scheduleReconnect() {
         // Avoid scheduling if already trying or connected
         if (reconnectTimeoutId || (teacherSocket && teacherSocket.readyState === WebSocket.OPEN)) {
              return;
         }

         if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
             reconnectAttempts++;
             console.log(`Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_DELAY / 1000}s...`);
             updateConnectionStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
             reconnectTimeoutId = setTimeout(connectWebSocket, RECONNECT_DELAY);
         } else {
             console.error("Max WebSocket reconnect attempts reached.");
             updateConnectionStatus('disconnected', 'Reconnect failed');
         }
     }

     function requestInitialData() {
         sendMessageToServer({ type: 'get_initial_student_list' });
     }

     function sendMessageToServer(payload) {
         if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
             try {
                 teacherSocket.send(JSON.stringify(payload));
             } catch (error) {
                 console.error("Error sending message:", error);
             }
         } else {
             console.warn("WebSocket not open. Message not sent:", payload);
         }
     }

     function updateConnectionStatus(status, text) {
         if (connectionStatusDiv && connectionStatusText) {
             connectionStatusDiv.className = `status-indicator ${status}`;
             connectionStatusText.textContent = text;
         } else {
             // console.warn("Connection status elements not found in DOM."); // Reduce noise
         }
     }


    // --- Server Message Handling ---

    function handleServerMessage(message) {
        const { type, data } = message;
        // console.log(`Handling message: ${type}`, data); // Debug log

        let needsUiRefresh = false; // Flag to trigger grid/roster/count updates

        switch (type) {
            case 'initial_student_list':
                console.log("Processing initial student list...");
                connectedStudents.clear(); // Clear previous state completely
                selectedStudentIds.clear(); // Clear selection
                if (data && Array.isArray(data)) {
                    data.forEach(studentData => {
                        if(studentData?.clientId) {
                            connectedStudents.set(studentData.clientId, createStudentStateObject(studentData.clientId, studentData));
                        }
                    });
                }
                needsUiRefresh = true;
                break;

            case 'student_connected':
                if (data?.clientId) {
                    console.log(`Student connected/updated: ${data.clientId}`);
                    // Add or update student state in the map
                    // Crucially, this replaces any previous entry for the clientId, preventing duplicates in the map
                    connectedStudents.set(data.clientId, createStudentStateObject(data.clientId, { ...data, status: 'connected' }, connectedStudents.get(data.clientId)));
                    needsUiRefresh = true;
                } else { console.warn("Received student_connected without clientId:", data); }
                break;

            case 'student_disconnected':
                if (data?.clientId) {
                    console.log(`Student disconnected: ${data.clientId}`);
                    const student = connectedStudents.get(data.clientId);
                    if(student) {
                        student.status = 'disconnected';
                        // Keep student in map but mark as disconnected
                        // Remove from selection if they were selected
                        if (selectedStudentIds.has(data.clientId)) {
                            selectedStudentIds.delete(data.clientId);
                        }
                        needsUiRefresh = true;
                    }
                    // Remove card explicitly? No, render handles it based on status filter potentially
                     // Remove from target select dropdown
                    removeStudentFromSelect(data.clientId);
                }
                break;

            // --- Direct handling of relayed student data ---
            case 'student_screenshot':
                 if (data?.clientId && data.payload?.imageData) {
                     const student = connectedStudents.get(data.clientId);
                     if (student) {
                         student.lastScreenshotUrl = data.payload.imageData;
                         student.lastUpdate = Date.now();
                         updateStudentScreenshotUI(data.clientId, data.payload.imageData); // Update card UI directly
                         updateDetailModalScreenshotIfVisible(data.clientId, data.payload.imageData); // Update large modal if open
                     }
                 }
                break;
             case 'student_screenshot_error':
             case 'student_screenshot_skipped':
                  if (data?.clientId && data.payload) {
                     const student = connectedStudents.get(data.clientId);
                     if(student) student.lastScreenshotUrl = null; // Clear last known good screenshot
                     updateStudentScreenshotUI(data.clientId, null, data.payload.error || data.payload.reason);
                     updateDetailModalScreenshotIfVisible(data.clientId, null, data.payload.error || data.payload.reason);
                  }
                 break;
            case 'student_tabs_update':
                 if (data?.clientId && data.payload) {
                     const student = connectedStudents.get(data.clientId);
                     if (student) {
                         student.currentTabs = data.payload;
                         student.lastUpdate = Date.now();
                         updateStudentActiveTabUI(data.clientId, data.payload); // Update card UI directly
                         updateDetailModalTabsIfVisible(data.clientId, data.payload); // Update large modal if open
                     }
                 }
                break;
            case 'student_status_update':
                 if (data?.clientId && data.payload?.status) {
                    const student = connectedStudents.get(data.clientId);
                    if(student && student.status !== data.payload.status) {
                         student.status = data.payload.status;
                         needsUiRefresh = true; // Status change requires grid/roster refresh
                    }
                 }
                break;
            // --- End Direct Handling ---

            case 'command_failed':
                console.error(`Command failed for student ${data?.targetClientId}: ${data?.reason}`);
                alert(`Command failed for student ${data?.targetClientId || 'Unknown'}: ${data?.reason || 'Unknown error'}`);
                break;

             // Add handlers for session_update, pong, error etc. as needed

            default:
                console.warn("Received unhandled message type:", type, data);
        }

         // Centralized UI refresh after processing messages that affect the grid/roster
        if (needsUiRefresh) {
             console.log("Needs UI Refresh: Rendering Grid and Roster");
             renderStudentGrid(); // Apply filter/sort and update grid
             updateRoster(); // Update table view
             updateNoStudentsPlaceholder();
             updateBulkActionButtons();
             updateSelectedCount();
             // Update dropdown only if the list of students actually changed (less churn)
             // Consider comparing keys before and after update, or just rebuild less often
             populateTargetStudentSelect(); // Rebuild dropdown based on current students
        }
    }

     // Helper to create/update student state object (more defensive)
     function createStudentStateObject(clientId, newData, existingState = {}) {
         const newStatus = ['connected', 'disconnected', 'locked'].includes(newData?.status) ? newData.status : (existingState.status || 'disconnected'); // Default to disconnected if unknown
         return {
             clientId: clientId,
             email: newData?.email || existingState.email || 'Unknown Email',
             userId: newData?.userId || existingState.userId || 'Unknown ID',
             status: newStatus,
             // Ensure currentTabs is always an object
             currentTabs: (typeof newData?.currentTabs === 'object' && newData.currentTabs !== null) ? newData.currentTabs : (existingState.currentTabs || {}),
             lastScreenshotUrl: newData?.lastScreenshotUrl || existingState.lastScreenshotUrl || null,
             lastUpdate: Date.now(),
         };
     }


    function markAllStudentsDisconnected() {
        let changed = false;
        connectedStudents.forEach(student => {
            if (student.status !== 'disconnected') {
                 student.status = 'disconnected';
                 changed = true;
            }
        });
         if(changed) {
             console.log("Marking all students disconnected visually.");
             renderStudentGrid(); // Re-render all cards to show disconnected status
             updateRoster();
             updateSelectedCount(); // Deselect all
             updateBulkActionButtons();
         }
    }

    // --- Centralized Rendering with Filter/Sort ---

    function renderStudentGrid() {
        if (!studentGrid || !studentCardTemplate) {
             console.error("Cannot render grid: studentGrid or template missing.");
             return;
        }
        // console.log(`Rendering grid. Filter: "${currentFilter}", Sort: "${currentSort}"`);

        const fragment = document.createDocumentFragment();
        const filteredAndSortedStudents = getFilteredAndSortedStudents();

        // Clear existing grid content *before* adding new/updated cards
        studentGrid.innerHTML = '';

        if (filteredAndSortedStudents.length === 0) {
             updateNoStudentsPlaceholder(); // Show appropriate placeholder
        } else {
            if(noStudentsPlaceholder) noStudentsPlaceholder.classList.add('hidden');
            if(loadingPlaceholder) loadingPlaceholder.classList.add('hidden');

            filteredAndSortedStudents.forEach(student => {
                const card = createStudentCardElement(student.clientId, student); // Create the raw element
                if (card) {
                    // Apply state AFTER creation
                    updateStudentCardContent(card, student);
                    updateStudentStatusOnCard(card, student.status);
                    updateStudentScreenshotUI(student.clientId, student.lastScreenshotUrl, null, card); // Pass card ref
                    updateStudentActiveTabUI(student.clientId, student.currentTabs, card); // Pass card ref
                    const checkbox = card.querySelector('.student-select-checkbox');
                    if (checkbox) checkbox.checked = selectedStudentIds.has(student.clientId);
                    fragment.appendChild(card);
                }
            });
            studentGrid.appendChild(fragment);
        }
         // console.log("Grid rendering complete.");
    }

    function getFilteredAndSortedStudents() {
        let studentsArray = Array.from(connectedStudents.values());

        // Apply Filter
        if (currentFilter) {
            const filterLower = currentFilter.toLowerCase();
            studentsArray = studentsArray.filter(student =>
                (student.email && student.email.toLowerCase().includes(filterLower)) ||
                (student.clientId && student.clientId.toLowerCase().includes(filterLower))
            );
        }

        // Apply Sort
        studentsArray.sort((a, b) => {
            if (currentSort === 'status') {
                const statusOrder = { connected: 1, locked: 2, disconnected: 3 };
                const statusA = statusOrder[a.status] || 4;
                const statusB = statusOrder[b.status] || 4;
                if (statusA !== statusB) return statusA - statusB;
            }
            const nameA = a.email || a.clientId;
            const nameB = b.email || b.clientId;
            return nameA.localeCompare(nameB);
        });

        return studentsArray;
    }

    // --- DOM Manipulation & UI Updates ---

    // Creates the card ELEMENT, but doesn't attach complex listeners here
    function createStudentCardElement(clientId, studentData) {
        if (!studentCardTemplate) return null;
        const cardClone = studentCardTemplate.content.cloneNode(true);
        const cardElement = cardClone.querySelector('.student-card');
        if (!cardElement) return null;

        cardElement.id = `student-card-${clientId}`;
        cardElement.dataset.clientId = clientId; // Crucial for event delegation

        // Set initial name/title immediately
        updateStudentCardContent(cardElement, studentData);

         // Attach checkbox listener directly as it manages selection state
         const checkbox = cardElement.querySelector('.student-select-checkbox');
         if (checkbox) {
              checkbox.dataset.clientId = clientId; // Add clientId for easier access in handler
             checkbox.addEventListener('change', handleStudentSelectionChange);
         }
         // Attach listener for opening large modal directly to preview
         const screenshotPreview = cardElement.querySelector('.screenshot-preview');
         if(screenshotPreview) {
             screenshotPreview.dataset.clientId = clientId;
             screenshotPreview.addEventListener('click', handleScreenshotPreviewClick);
         }

        return cardElement;
    }

     // Handles checkbox change event
     function handleStudentSelectionChange(event) {
         const checkbox = event.target;
         const clientId = checkbox.dataset.clientId;
         if (!clientId) return;
         handleStudentSelection(clientId, checkbox.checked);
     }


    function updateStudentCardContent(cardElement, studentData) {
         if (!cardElement || !studentData) return;
         const nameEl = cardElement.querySelector('.student-name');
         if(nameEl) {
             nameEl.textContent = studentData.email || `Client: ${studentData.clientId?.substring(0, 6) ?? '??'}`;
             nameEl.title = `${studentData.email}\nID: ${studentData.clientId}`;
         }
    }


    function updateStudentStatus(clientId, status) {
         const student = connectedStudents.get(clientId);
         if (student && student.status !== status) {
             student.status = status;
              // Don't trigger full render, just update specific elements
             const card = document.getElementById(`student-card-${clientId}`);
             if(card) updateStudentStatusOnCard(card, status);
             updateRosterRowStatus(clientId, status);
         }
     }

     function updateRosterRowStatus(clientId, status) {
        if (!studentRosterBody) return;
        const row = studentRosterBody.querySelector(`tr[data-client-id="${clientId}"]`);
        const badge = row?.querySelector('.status-badge');
        if (badge) {
            const statusText = status || 'disconnected';
            badge.textContent = statusText.charAt(0).toUpperCase() + statusText.slice(1);
            badge.className = `status-badge ${statusText}`;
        }
    }

     function updateStudentStatusOnCard(cardElement, status) {
        if (!cardElement) return;
        cardElement.dataset.status = status; // For CSS styling
        const statusDot = cardElement.querySelector('.status-dot');
        statusDot.className = `status-dot ${status}`; // Update class for color
        statusDot.title = status.charAt(0).toUpperCase() + status.slice(1); // Capitalize title

         // Maybe add visual indication for locked state
        const screenshotPreview = cardElement.querySelector('.screenshot-preview');
        if (status === 'locked') {
            screenshotPreview.style.border = '3px solid var(--warning-color)'; // Example indicator
        } else {
            screenshotPreview.style.border = 'none';
        }
   }


     // Renamed to specify UI update
     function updateStudentScreenshotUI(clientId, imageDataUrl, errorMessage = null) {
        const card = document.getElementById(`student-card-${clientId}`);
        if (!card) return;
        const imgElement = card.querySelector('.screenshot-img');
        const noScreenshotDiv = card.querySelector('.no-screenshot');
        const lastUpdatedSpan = card.querySelector('.last-updated');

        if (imageDataUrl) {
            imgElement.src = imageDataUrl;
            imgElement.classList.remove('hidden');
            noScreenshotDiv.classList.add('hidden');
            lastUpdatedSpan.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        } else {
            imgElement.classList.add('hidden');
            imgElement.src = 'placeholder-screenshot.png'; // Reset placeholder
            noScreenshotDiv.classList.remove('hidden');
            noScreenshotDiv.textContent = errorMessage || "No Screenshot Available";
             lastUpdatedSpan.textContent = `Updated: Never`;
        }
    }

    // Renamed to specify UI update
    function updateStudentActiveTabUI(clientId, tabsData) {
        const card = document.getElementById(`student-card-${clientId}`);
       if (!card || !tabsData) return;

       const activeTabInfoDiv = card.querySelector('.active-tab-info');
       const faviconImg = activeTabInfoDiv.querySelector('.favicon');
       const tabTitleSpan = activeTabInfoDiv.querySelector('.tab-title');

       let activeTab = null;
       if (typeof tabsData === 'object') {
            activeTab = Object.values(tabsData).find(tab => tab && tab.active);
       }

       if (activeTab) {
            card.dataset.activeTabId = activeTab.id; // Store for close action
            faviconImg.src = activeTab.favIconUrl || 'placeholder-favicon.png';
            faviconImg.onerror = () => { faviconImg.src = 'placeholder-favicon.png'; }; // Fallback
            tabTitleSpan.textContent = activeTab.title || 'Untitled Tab';
            tabTitleSpan.title = activeTab.url || 'No URL';
       } else {
            card.dataset.activeTabId = ''; // Clear stored ID
            faviconImg.src = 'placeholder-favicon.png';
            tabTitleSpan.textContent = 'No Active Tab';
            tabTitleSpan.title = '';
       }
   }


    // (updateNoStudentsPlaceholder remains the same, uses getFilteredAndSortedStudents now)
    function updateNoStudentsPlaceholder() {
        if (connectedStudents.size === 0) {
            noStudentsPlaceholder.classList.remove('hidden');
            loadingPlaceholder.classList.add('hidden');
        } else {
            noStudentsPlaceholder.classList.add('hidden');
        }
    }

    // (updateBulkActionButtons remains the same)
    function updateBulkActionButtons() {
        const hasSelection = selectedStudentIds.size > 0;
        lockSelectedBtn.disabled = !hasSelection;
        unlockSelectedBtn.disabled = !hasSelection;
        openTabSelectedBtn.disabled = !hasSelection;
        announceSelectedBtn.disabled = !hasSelection;
        blockSiteSelectedBtn.disabled = !hasSelection;
    }


    // (updateSelectedCount remains the same)
    function updateSelectedCount() {
        selectedCountSpan.textContent = `(${selectedStudentIds.size} Selected)`;
        selectAllCheckbox.checked = connectedStudents.size > 0 && selectedStudentIds.size === connectedStudents.size;
         selectAllCheckbox.indeterminate = selectedStudentIds.size > 0 && selectedStudentIds.size < connectedStudents.size;
    }

    // --- Student Roster View --- (Update to use central rendering if needed, or keep separate)
    function updateRoster() {
        if (!studentRosterBody || !studentRosterRowTemplate) return;
        studentRosterBody.innerHTML = ''; // Clear

        const studentsToRender = getFilteredAndSortedStudents(); // Maybe different filter/sort for roster later?

        if (studentsToRender.length === 0) {
            studentRosterBody.innerHTML = `<tr><td colspan="6">${connectedStudents.size === 0 ? 'No students connected.' : 'No students match filter.'}</td></tr>`;
            return;
        }

        studentsToRender.forEach(student => {
             const rowClone = studentRosterRowTemplate.content.cloneNode(true);
             const rowElement = rowClone.querySelector('tr');
             if (!rowElement) return;
             rowElement.dataset.clientId = student.clientId;
             rowElement.querySelector('.roster-name').textContent = student.email?.split('@')[0] || 'Unknown';
             rowElement.querySelector('.roster-email').textContent = student.email || 'N/A';
             updateRosterRowStatus(student.clientId, student.status); // Use helper
             rowElement.querySelector('.roster-session').textContent = currentSessionId || 'N/A'; // Use actual session ID when implemented
             // Add listeners for roster actions using delegation on studentRosterBody if needed
             studentRosterBody.appendChild(rowElement);
        });
    }

    // --- Event Listeners ---

    // Sidebar Toggle (remains the same)
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
             if (window.innerWidth <= 768) {
                 // Special toggle for mobile overlay behavior
                 body.classList.toggle('sidebar-force-open');
                 // Ensure standard collapse class reflects state when overlay is closed
                 if (!body.classList.contains('sidebar-force-open')) {
                     body.classList.add('sidebar-collapsed');
                 } else {
                      body.classList.remove('sidebar-collapsed'); // Ensure expanded visually
                 }
             } else {
                 // Standard toggle for desktop
                 body.classList.toggle('sidebar-collapsed');
                 body.classList.remove('sidebar-force-open'); // Clear mobile state if toggling on desktop
             }
         });
         // Close mobile overlay if clicking main content
         mainContent.addEventListener('click', () => {
             if(body.classList.contains('sidebar-force-open')) {
                 body.classList.remove('sidebar-force-open');
                 body.classList.add('sidebar-collapsed');
             }
         });

    } else { console.warn("Sidebar toggle button not found."); }


    // Sidebar Navigation (Clearer View Switching)
    if(navList) {
         navList.addEventListener('click', (e) => {
            const navLink = e.target.closest('.nav-item a');
            if (!navLink) return;

            const navItem = navLink.closest('.nav-item');
            const targetViewId = navItem?.dataset.view;
            if (!targetViewId) return;

            e.preventDefault();
            console.log(`Switching view to: ${targetViewId}`);
            activeViewId = targetViewId; // Store active view

            // Update nav item highlight
            document.querySelectorAll('.nav-item.active').forEach(i => i.classList.remove('active'));
            navItem.classList.add('active');

            // Switch view panel
            views.forEach(view => {
                view.classList.toggle('active', view.id === targetViewId);
            });

            // Update header title
            if(currentViewTitle) {
                currentViewTitle.textContent = navItem.querySelector('span')?.textContent || 'Dashboard';
            }

            // Update roster if switching to it
            if (targetViewId === 'students-view') {
                updateRoster();
            }
             // Update grid if switching to it (applies filter/sort)
             if (targetViewId === 'screens-view') {
                 renderStudentGrid();
             }

            // Close mobile sidebar
            if (window.innerWidth <= 768 && body.classList.contains('sidebar-force-open')) {
                 body.classList.remove('sidebar-force-open');
                 body.classList.add('sidebar-collapsed');
            }
        });
    }


    // Filter and Sort Listeners (remain the same, trigger renderStudentGrid)
    if(filterStudentsInput) { filterStudentsInput.addEventListener('input', (e) => { /* ... call render ... */ }); }
    if(sortStudentsSelect) { sortStudentsSelect.addEventListener('change', (e) => { /* ... call render ... */ }); }
    // Implement similar for roster filter if #roster-filter-input exists

     // Selection Handling (Select All) (remains the same)
    if (selectAllCheckbox) { /* ... listener code ... */ }

    // Handle individual student selection (called by checkbox listener)
    function handleStudentSelection(clientId, isSelected) {
        if (isSelected) {
            selectedStudentIds.add(clientId);
        } else {
            selectedStudentIds.delete(clientId);
        }
        // Update card visual selection state (optional)
        const card = document.getElementById(`student-card-${clientId}`);
        card?.classList.toggle('selected', isSelected);

        updateSelectedCount(); // Updates count and selectAll checkbox state
        updateBulkActionButtons();
    }

    // --- Bulk Action Button Listeners --- (remain the same, use sendCommandToStudent)
    lockSelectedBtn?.addEventListener('click', () => { /* ... */ });
    unlockSelectedBtn?.addEventListener('click', () => { /* ... */ });
    openTabSelectedBtn?.addEventListener('click', () => { /* ... */ });
    announceSelectedBtn?.addEventListener('click', () => { /* ... */ });
    blockSiteSelectedBtn?.addEventListener('click', () => { /* ... */ });

    // --- Modal Confirm Button Listeners --- (remain the same)
    confirmOpenTabBtn?.addEventListener('click', () => { /* ... */ });
    confirmAnnounceBtn?.addEventListener('click', () => { /* ... */ });
    confirmBlockSiteBtn?.addEventListener('click', () => { /* ... */ });

    // --- Command Sending Helper --- (remains the same, includes optimistic UI)
    function sendCommandToStudent(targetClientId, command, commandData = {}) { /* ... */ }

    // --- Modal Helpers --- (showModal, closeModal remain the same)
    function showModal(modalId) { /* ... */ }
    function closeModal(modalId) { /* ... */ }

    // --- Modal Close Event Listeners (remain the same) ---
    document.addEventListener('click', (e) => { /* ... */ });
    window.addEventListener('keydown', (e) => { /* ... */ });

    // --- Individual Student Actions (Prompts) (remain the same) ---
    function promptAndOpenTabForStudent(clientId) {
        const url = prompt(`Enter URL to open for student ${connectedStudents.get(clientId)?.email || clientId}:`, 'https://');
        if (url && url !== 'https://') {
             try {
               new URL(url); // Basic validation
                sendCommandToStudent(clientId, 'open_tab', { url: url });
            } catch (_) {
                alert("Invalid URL format.");
            }
        }
    }

    function promptAndAnnounceToStudent(clientId) {
        const message = prompt(`Enter announcement for student ${connectedStudents.get(clientId)?.email || clientId}:`);
        if (message) {
            sendCommandToStudent(clientId, 'send_announcement', { message: message, duration: 7000 }); // 7 sec duration
        }
    }

    // --- Large Student Detail Modal ---

     // EVENT DELEGATION for screenshot preview clicks
     if (studentGrid) {
         studentGrid.addEventListener('click', (e) => {
             const previewElement = e.target.closest('.screenshot-preview');
             if (previewElement) {
                 handleScreenshotPreviewClick(previewElement);
             }
             // Add delegation for card action buttons here if needed
             const actionButton = e.target.closest('.action-btn');
             if (actionButton) {
                 const card = actionButton.closest('.student-card');
                 const clientId = card?.dataset.clientId;
                 if (!clientId) return;

                 e.stopPropagation(); // Prevent screenshot click if button clicked

                 if (actionButton.classList.contains('lock-btn')) {
                      sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked by Teacher' });
                 } else if (actionButton.classList.contains('unlock-btn')) {
                      sendCommandToStudent(clientId, 'unlock_screen', {});
                 } else if (actionButton.classList.contains('open-tab-btn')) {
                      promptAndOpenTabForStudent(clientId);
                 } else if (actionButton.classList.contains('message-btn')) {
                      promptAndAnnounceToStudent(clientId);
                 } else if (actionButton.classList.contains('close-tab-btn')) {
                      const activeTabId = card.dataset.activeTabId;
                      if (activeTabId) { sendCommandToStudent(clientId, 'close_tab', { tabId: parseInt(activeTabId, 10) }); }
                      else { alert("Could not determine active tab."); }
                 }
             }
         });
     }


    function handleScreenshotPreviewClick(previewElement) {
         // const previewElement = event.currentTarget; // No longer needed with delegation target
         const clientId = previewElement.dataset.clientId;
         if (clientId) {
             showStudentDetailModal(clientId);
         } else {
             console.error("Could not find clientId on clicked preview element.");
         }
     }

     // (showStudentDetailModal remains the same)
     function showStudentDetailModal(clientId) { /* ... */ }
     // (updateDetailModalScreenshotIfVisible remains the same)
     function updateDetailModalScreenshotIfVisible(clientId, screenshotUrl, errorMsg = null) { /* ... */ }
     // (updateDetailModalTabsIfVisible remains the same)
     function updateDetailModalTabsIfVisible(clientId, tabsData) { /* ... */ }
     // (populateTabItem remains the same)
     function populateTabItem(element, tabData, clientId, isActive) { /* ... */ }

      // --- EVENT DELEGATION for Detail Modal Actions ---
      if (detailModalActions) {
           detailModalActions.addEventListener('click', (e) => {
               const button = e.target.closest('.btn');
               if (!button) return;
               const clientId = studentDetailModal?.dataset.viewingClientId;
               if (!clientId) return;

               const buttonId = button.id;
               if (buttonId === 'detail-modal-refresh-btn') {
                    sendCommandToStudent(clientId, 'get_current_state', {}); // Request refresh
                    console.log(`Requested refresh for ${clientId}`);
               } else if (buttonId === 'detail-modal-lock-btn') {
                    sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked' });
               } else if (buttonId === 'detail-modal-unlock-btn') {
                    sendCommandToStudent(clientId, 'unlock_screen', {});
               } else if (buttonId === 'detail-modal-message-btn') {
                    promptAndAnnounceToStudent(clientId);
               }
           });
      }
      // EVENT DELEGATION for Detail Modal Tab Close Buttons
      if(detailModalTabSection) {
           detailModalTabSection.addEventListener('click', (e) => {
                const closeButton = e.target.closest('.close-tab-btn');
                if(!closeButton) return;

                const tabItem = closeButton.closest('.tab-item');
                const tabId = tabItem?.dataset.tabId;
                const clientId = studentDetailModal?.dataset.viewingClientId; // Get client from modal state

                if(tabId && clientId) {
                     e.stopPropagation();
                     const tabTitle = tabItem.querySelector('.tab-title')?.textContent || 'this tab';
                      if (confirm(`Close "${tabTitle}" for this student?`)) {
                           sendCommandToStudent(clientId, 'close_tab', { tabId: parseInt(tabId, 10) });
                           // Optimistically remove (handle potential race conditions if needed)
                           tabItem.remove();
                            if (detailModalOtherTabsCount && tabItem.closest('ul')?.id === 'detail-modal-other-tabs-list') {
                                detailModalOtherTabsCount.textContent = parseInt(detailModalOtherTabsCount.textContent, 10) - 1;
                            } else if (tabItem.id === 'detail-modal-active-tab') {
                                 // Handle removing active tab display more gracefully
                                 tabItem.innerHTML = '<p class="text-muted">Active tab closed.</p>';
                            }
                      }
                }
           });
      }


    // --- Settings --- (load/save remain the same)
    function loadSettings() { /* ... */ }
    saveDefaultBlocklistBtn?.addEventListener('click', () => { /* ... */ });
    saveDefaultIntervalBtn?.addEventListener('click', () => { /* ... */ });

    // --- Add student to select dropdown ---
     function populateTargetStudentSelect() {
         if (!targetStudentSelect) return;
         const currentSelection = targetStudentSelect.value; // Preserve selection if possible
         targetStudentSelect.innerHTML = '<option value="">-- Select Student --</option>';
         connectedStudents.forEach((student, clientId) => {
              if(student.status === 'connected' || student.status === 'locked') { // Only list active students?
                 addStudentToSelect(clientId, student.email);
              }
         });
          // Restore selection if still valid
         if (connectedStudents.has(currentSelection)) {
             targetStudentSelect.value = currentSelection;
         }
     }
     function addStudentToSelect(clientId, email) {
          // ... (same as V2) ...
          if (!targetStudentSelect || Array.from(targetStudentSelect.options).some(opt => opt.value === clientId)) return;
         const option = document.createElement('option');
         option.value = clientId;
         option.textContent = `${email || 'N/A'} (${clientId.substring(0,6)}...)`;
         targetStudentSelect.appendChild(option);
     }
     function removeStudentFromSelect(clientId) {
          // ... (same as V2) ...
          if (!targetStudentSelect) return;
         const option = targetStudentSelect.querySelector(`option[value="${clientId}"]`);
         if (option) option.remove();
     }


    // --- Initialization ---
    function initializeDashboard() {
        console.log("Initializing dashboard UI and WebSocket...");
        if (window.innerWidth <= 768 && !body.classList.contains('sidebar-force-open')) {
            body.classList.add('sidebar-collapsed');
        }
        loadSettings();
        updateBulkActionButtons();
        updateSelectedCount();
        updateNoStudentsPlaceholder();
        connectWebSocket();
    }

    initializeDashboard();

}); // End DOMContentLoaded
