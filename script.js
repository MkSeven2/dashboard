// Updated script.js V2 - Incorporating filter, sort, large modal
document.addEventListener('DOMContentLoaded', () => {
    console.log("Saber Teacher Dashboard Initializing...");

    // --- Configuration ---
    const WS_URL = "wss://extension.mkseven1.com"; // Double-check this URL!
    const PLACEHOLDER_FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkIAAYIBAAJBtnBAAAAABJRU5ErkJggg=='; // Transparent pixel

    // --- DOM Elements ---
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.getElementById('main-content');
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const currentViewTitle = document.getElementById('current-view-title');
    const connectionStatusDiv = document.getElementById('connection-status');
    const connectionStatusText = connectionStatusDiv?.querySelector('.text');
    const studentGrid = document.getElementById('student-grid');
    const loadingPlaceholder = document.getElementById('loading-students-placeholder');
    const noStudentsPlaceholder = document.getElementById('no-students-placeholder');
    const studentCardTemplate = document.getElementById('student-card-template');

    // Roster View
    const studentRosterBody = document.getElementById('student-roster-body');
    const studentRosterRowTemplate = document.getElementById('student-roster-row-template');
    const rosterSelectAllCheckbox = document.getElementById('roster-select-all'); // Assuming same select logic applies
    const rosterFilterInput = document.getElementById('roster-filter-input');

    // Toolbar
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

    // Large Student Detail Modal
    const studentDetailModal = document.getElementById('student-detail-modal');
    const detailModalStudentName = document.getElementById('detail-modal-student-name');
    const detailModalScreenshot = document.getElementById('detail-modal-screenshot');
    const detailModalActiveTabDiv = document.getElementById('detail-modal-active-tab');
    const detailModalOtherTabsList = document.getElementById('detail-modal-other-tabs-list');
    const detailModalOtherTabsCount = document.getElementById('detail-modal-other-tabs-count');
    const detailModalTabItemTemplate = document.getElementById('detail-modal-tab-item-template');
    // Buttons inside detail modal
    const detailModalRefreshBtn = document.getElementById('detail-modal-refresh-btn');
    const detailModalLockBtn = document.getElementById('detail-modal-lock-btn');
    const detailModalUnlockBtn = document.getElementById('detail-modal-unlock-btn');
    const detailModalMessageBtn = document.getElementById('detail-modal-message-btn');


    // Settings View Controls
    const defaultBlocklistInput = document.getElementById('default-blocklist-input');
    const saveDefaultBlocklistBtn = document.getElementById('save-default-blocklist-btn');
    const defaultIntervalInput = document.getElementById('default-interval-input');
    const saveDefaultIntervalBtn = document.getElementById('save-default-interval-btn');

    // Header Controls (Session - Currently Placeholders)
    const startSessionBtn = document.getElementById('start-session-btn');
    const endSessionBtn = document.getElementById('end-session-btn');
    const currentSessionInfo = document.getElementById('current-session-info');


    // --- State Variables ---
    let teacherSocket = null;
    let connectedStudents = new Map(); // clientId -> { clientId, email, userId, currentTabs, status, lastScreenshotUrl, lastUpdate }
    let selectedStudentIds = new Set();
    let currentSessionId = null; // Placeholder for session ID
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10; // Or Infinity
    const RECONNECT_DELAY = 5000; // 5 seconds
    let reconnectTimeoutId = null;
    let currentSort = 'name'; // Default sort
    let currentFilter = ''; // Default filter


    // --- WebSocket Functions --- (Largely unchanged, robust reconnection)

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
            console.warn("Connection status elements not found in DOM.");
        }
    }

    // --- Server Message Handling ---

    function handleServerMessage(message) {
        const { type, data } = message;

        let needsRender = false; // Flag to batch render updates

        switch (type) {
            case 'initial_student_list':
                console.log("Received initial student list:", data);
                connectedStudents.clear();
                if (data && Array.isArray(data)) {
                    data.forEach(studentData => {
                        // Directly add to map without rendering yet
                        if(studentData?.clientId) {
                           connectedStudents.set(studentData.clientId, createStudentStateObject(studentData.clientId, studentData));
                        }
                    });
                }
                needsRender = true; // Render the whole grid after processing all initial students
                break;

            case 'student_connected':
                console.log("Student connected:", data);
                if (data && data.clientId) {
                    // Add or update student state in the map
                    connectedStudents.set(data.clientId, createStudentStateObject(data.clientId, { ...data, status: 'connected' }, connectedStudents.get(data.clientId)));
                    needsRender = true; // Re-render the grid
                } else {
                    console.warn("Received student_connected without clientId:", data);
                }
                break;

            case 'student_disconnected':
                console.log("Student disconnected:", data);
                if (data && data.clientId) {
                    const student = connectedStudents.get(data.clientId);
                    if(student) {
                        student.status = 'disconnected';
                        // Optionally remove from map? Or keep for roster history? Keep for now.
                        // connectedStudents.delete(data.clientId);
                        needsRender = true; // Re-render to show disconnected status
                    }
                }
                break;

            // --- Direct handling of relayed student data ---
            case 'student_screenshot':
                 if (data?.clientId && data.payload) {
                     const student = connectedStudents.get(data.clientId);
                     if (student) {
                         student.lastScreenshotUrl = data.payload.imageData;
                         student.lastUpdate = Date.now();
                         updateStudentScreenshot(data.clientId, data.payload.imageData); // Direct UI update for screenshot
                         // Also update large modal if it's showing this student
                         updateDetailModalScreenshotIfVisible(data.clientId, data.payload.imageData);
                     }
                 }
                break;
             case 'student_screenshot_error':
             case 'student_screenshot_skipped':
                  if (data?.clientId && data.payload) {
                     updateStudentScreenshot(data.clientId, null, data.payload.error || data.payload.reason);
                     updateDetailModalScreenshotIfVisible(data.clientId, null, data.payload.error || data.payload.reason);
                  }
                 break;
            case 'student_tabs_update':
                 if (data?.clientId && data.payload) {
                     const student = connectedStudents.get(data.clientId);
                     if (student) {
                         student.currentTabs = data.payload;
                         student.lastUpdate = Date.now();
                         updateStudentActiveTab(data.clientId, data.payload); // Update card preview
                         // Update large modal tab list if it's showing this student
                         updateDetailModalTabsIfVisible(data.clientId, data.payload);
                     }
                 }
                break;
            case 'student_status_update':
                 if (data?.clientId && data.payload?.status) {
                    const student = connectedStudents.get(data.clientId);
                    if(student && student.status !== data.payload.status) {
                         student.status = data.payload.status;
                         needsRender = true; // Re-render to show new status consistently
                    }
                 }
                break;
            // --- End Direct Handling ---

            case 'command_failed':
                console.error(`Command failed for student ${data?.targetClientId}: ${data?.reason}`);
                alert(`Command failed for student ${data?.targetClientId || 'Unknown'}: ${data?.reason || 'Unknown error'}`);
                break;

             // Add handlers for session_update, pong, error etc. as before

            default:
                console.warn("Received unhandled message type:", type);
        }

         // Centralized rendering after processing messages that affect the grid/roster
        if (needsRender) {
             renderStudentGrid(); // Apply filter/sort and update grid
             updateRoster(); // Update table view
             updateNoStudentsPlaceholder();
             updateBulkActionButtons();
             updateSelectedCount(); // Ensure select-all checkbox state is correct
        }
    }

     // Helper to create/update student state object
     function createStudentStateObject(clientId, newData, existingState = {}) {
         return {
             clientId: clientId,
             email: newData.email || existingState.email || 'Unknown Email',
             userId: newData.userId || existingState.userId || 'Unknown ID',
             status: ['connected', 'disconnected', 'locked'].includes(newData.status) ? newData.status : (existingState.status || 'disconnected'),
             currentTabs: newData.currentTabs || existingState.currentTabs || {},
             lastScreenshotUrl: newData.lastScreenshotUrl || existingState.lastScreenshotUrl || null,
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
             renderStudentGrid(); // Re-render all cards to show disconnected status
             updateRoster();
         }
    }

    // --- Centralized Rendering with Filter/Sort ---

    function renderStudentGrid() {
        if (!studentGrid) return;

        const fragment = document.createDocumentFragment();
        const filteredAndSortedStudents = getFilteredAndSortedStudents();

        // Clear existing grid content *before* adding new/updated cards
        studentGrid.innerHTML = '';

        if (filteredAndSortedStudents.length === 0) {
             updateNoStudentsPlaceholder(); // Show placeholder if no students match filter
             return;
        } else {
             if(noStudentsPlaceholder) noStudentsPlaceholder.classList.add('hidden');
             if(loadingPlaceholder) loadingPlaceholder.classList.add('hidden');
        }

        filteredAndSortedStudents.forEach(student => {
            // Create or get card (safer to always create/replace based on filtered list)
            const card = createStudentCard(student.clientId, student); // createStudentCard handles template cloning
            if (card) {
                 // Apply current state to the created card
                 updateStudentCardContent(card, student);
                 updateStudentStatusOnCard(card, student.status);
                 if(student.lastScreenshotUrl) {
                    updateStudentScreenshot(student.clientId, student.lastScreenshotUrl);
                 } else {
                    updateStudentScreenshot(student.clientId, null, "Screenshot Unavailable"); // Ensure placeholder shown
                 }
                 updateStudentActiveTab(student.clientId, student.currentTabs);
                 // Update checkbox state based on selection state
                  const checkbox = card.querySelector('.student-select-checkbox');
                  if (checkbox) checkbox.checked = selectedStudentIds.has(student.clientId);

                fragment.appendChild(card);
            }
        });
        studentGrid.appendChild(fragment);
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
                // Define status order, e.g., connected > locked > disconnected
                const statusOrder = { connected: 1, locked: 2, disconnected: 3 };
                const statusA = statusOrder[a.status] || 4;
                const statusB = statusOrder[b.status] || 4;
                if (statusA !== statusB) return statusA - statusB;
            }
            // Default sort by name/email if status is the same or sort is 'name'
            const nameA = a.email || a.clientId;
            const nameB = b.email || b.clientId;
            return nameA.localeCompare(nameB);
        });

        return studentsArray;
    }


    // --- DOM Manipulation & UI Updates (Individual Element Updates) ---

    function createStudentCard(clientId, studentData) {
        if (!studentCardTemplate) { console.error("studentCardTemplate not found."); return null; }

        const cardClone = studentCardTemplate.content.cloneNode(true);
        const cardElement = cardClone.querySelector('.student-card');
        if (!cardElement) { console.error("'.student-card' not found in template."); return null; }

        cardElement.id = `student-card-${clientId}`;
        cardElement.dataset.clientId = clientId;

        // --- Attach Listeners needed for this specific card ---
        const checkbox = cardElement.querySelector('.student-select-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', () => handleStudentSelection(clientId, checkbox.checked));
        }

        // Event delegation might be better for many students, but direct is okay for now
        cardElement.querySelector('.lock-btn')?.addEventListener('click', (e) => { e.stopPropagation(); sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked by Teacher' }); });
        cardElement.querySelector('.unlock-btn')?.addEventListener('click', (e) => { e.stopPropagation(); sendCommandToStudent(clientId, 'unlock_screen', {}); });
        cardElement.querySelector('.open-tab-btn')?.addEventListener('click', (e) => { e.stopPropagation(); promptAndOpenTabForStudent(clientId); });
        cardElement.querySelector('.message-btn')?.addEventListener('click', (e) => { e.stopPropagation(); promptAndAnnounceToStudent(clientId); });
        cardElement.querySelector('.close-tab-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const activeTabId = cardElement.dataset.activeTabId;
            if (activeTabId) { sendCommandToStudent(clientId, 'close_tab', { tabId: parseInt(activeTabId, 10) }); }
            else { alert("Could not determine active tab."); }
        });
         // Listener for opening the large detail modal
         const screenshotPreview = cardElement.querySelector('.screenshot-preview');
         if(screenshotPreview) {
              // Store clientId directly on the preview element for easy access on click
              screenshotPreview.dataset.clientId = clientId;
             screenshotPreview.addEventListener('click', handleScreenshotPreviewClick);
         }

        return cardElement;
    }

    function updateStudentCardContent(cardElement, studentData) {
        // Updates content that doesn't change frequently (like name)
         if (!cardElement || !studentData) return;
         const nameEl = cardElement.querySelector('.student-name');
         if(nameEl) {
             nameEl.textContent = studentData.email || `Client: ${studentData.clientId?.substring(0, 6) ?? '??'}`;
             nameEl.title = `${studentData.email}\nID: ${studentData.clientId}`;
         }
    }

    // (updateStudentStatus remains the same, it updates the map and calls updateStudentStatusOnCard)
    function updateStudentStatus(clientId, status) {
         const student = connectedStudents.get(clientId);
         if (student && student.status !== status) { // Only update if status changed
             student.status = status;
             // Don't re-render grid here, let the main message loop handle it for consistency
             // Just update the specific card directly for immediate feedback
             const card = document.getElementById(`student-card-${clientId}`);
             if(card) updateStudentStatusOnCard(card, status);
             // Optionally update the specific roster row too
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

     // (updateStudentStatusOnCard remains largely the same)
     function updateStudentStatusOnCard(cardElement, status) {
         if (!cardElement) return;
         cardElement.dataset.status = status;
         const statusDot = cardElement.querySelector('.status-dot');
         if (statusDot) {
             statusDot.className = `status-dot ${status}`;
             statusDot.title = status.charAt(0).toUpperCase() + status.slice(1);
         }
         // More robust locked visual state
         cardElement.classList.toggle('locked', status === 'locked');
         const screenshotPreview = cardElement.querySelector('.screenshot-preview');
         if(screenshotPreview) {
             screenshotPreview.style.borderColor = status === 'locked' ? 'var(--warning-color, orange)' : 'transparent';
         }
     }

    // (updateStudentScreenshot remains largely the same, check for data:image added previously)
     function updateStudentScreenshot(clientId, imageDataUrl, errorMessage = null) {
         const card = document.getElementById(`student-card-${clientId}`);
         if (!card) return;
         const imgElement = card.querySelector('.screenshot-img');
         const noScreenshotDiv = card.querySelector('.no-screenshot');
         const lastUpdatedSpan = card.querySelector('.last-updated');

         if (!imgElement || !noScreenshotDiv || !lastUpdatedSpan) return;

         if (imageDataUrl && typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image')) {
             imgElement.src = imageDataUrl;
             imgElement.classList.remove('hidden');
             noScreenshotDiv.classList.add('hidden');
             lastUpdatedSpan.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
         } else {
             imgElement.classList.add('hidden');
             imgElement.removeAttribute('src');
             noScreenshotDiv.classList.remove('hidden');
             noScreenshotDiv.textContent = errorMessage || "Screenshot Unavailable";
             lastUpdatedSpan.textContent = `Updated: Never`;
         }
     }


    // (updateStudentActiveTab remains largely the same)
    function updateStudentActiveTab(clientId, tabsData) {
         const card = document.getElementById(`student-card-${clientId}`);
         if (!card) return;
         const activeTabInfoDiv = card.querySelector('.active-tab-info');
         if(!activeTabInfoDiv) return;
         const faviconImg = activeTabInfoDiv.querySelector('.favicon');
         const tabTitleSpan = activeTabInfoDiv.querySelector('.tab-title');
         if(!faviconImg || !tabTitleSpan) return;

         let activeTab = null;
         if (typeof tabsData === 'object' && tabsData !== null) {
             activeTab = Object.values(tabsData).find(tab => tab?.active);
         }

         if (activeTab) {
             card.dataset.activeTabId = activeTab.id;
             faviconImg.src = (activeTab.favIconUrl && activeTab.favIconUrl.startsWith('http')) ? activeTab.favIconUrl : PLACEHOLDER_FAVICON;
             faviconImg.onerror = () => { faviconImg.src = PLACEHOLDER_FAVICON; };
             tabTitleSpan.textContent = activeTab.title || 'Untitled Tab';
             tabTitleSpan.title = activeTab.url || 'No URL';
         } else {
             card.dataset.activeTabId = '';
             faviconImg.src = PLACEHOLDER_FAVICON;
             tabTitleSpan.textContent = 'No Active Tab';
             tabTitleSpan.title = '';
         }
     }


    // (updateNoStudentsPlaceholder remains the same)
    function updateNoStudentsPlaceholder() {
         if (!noStudentsPlaceholder || !loadingPlaceholder) return;
         const isConnected = teacherSocket && teacherSocket.readyState === WebSocket.OPEN;
         const hasStudents = connectedStudents.size > 0;
         const hasMatchingStudents = getFilteredAndSortedStudents().length > 0; // Check filtered list

         if (isConnected && !hasStudents) { // Connected but no students ever joined
             noStudentsPlaceholder.textContent = "No students connected in this session.";
             noStudentsPlaceholder.classList.remove('hidden');
             loadingPlaceholder.classList.add('hidden');
         } else if (isConnected && hasStudents && !hasMatchingStudents) { // Connected, students exist, but none match filter
              noStudentsPlaceholder.textContent = "No students match the current filter.";
             noStudentsPlaceholder.classList.remove('hidden');
             loadingPlaceholder.classList.add('hidden');
         } else if (!isConnected && !hasStudents) { // Not connected, show loading/connecting
              noStudentsPlaceholder.classList.add('hidden');
              // Loading shown based on connection status update
         } else { // Has matching students or still loading initial list
             noStudentsPlaceholder.classList.add('hidden');
              // Loading placeholder visibility handled by initial_student_list
         }
     }

    // (updateBulkActionButtons remains the same)
    function updateBulkActionButtons() {
         const hasSelection = selectedStudentIds.size > 0;
         if(lockSelectedBtn) lockSelectedBtn.disabled = !hasSelection;
         if(unlockSelectedBtn) unlockSelectedBtn.disabled = !hasSelection;
         if(openTabSelectedBtn) openTabSelectedBtn.disabled = !hasSelection;
         if(announceSelectedBtn) announceSelectedBtn.disabled = !hasSelection;
         if(blockSiteSelectedBtn) blockSiteSelectedBtn.disabled = !hasSelection;
     }

    // (updateSelectedCount remains the same)
    function updateSelectedCount() {
         if (!selectedCountSpan || !selectAllCheckbox) return;
         selectedCountSpan.textContent = `(${selectedStudentIds.size} Selected)`;
         const totalStudents = connectedStudents.size;
         selectAllCheckbox.disabled = totalStudents === 0;
         selectAllCheckbox.checked = totalStudents > 0 && selectedStudentIds.size === totalStudents;
         selectAllCheckbox.indeterminate = selectedStudentIds.size > 0 && selectedStudentIds.size < totalStudents;
     }

    // --- Student Roster View ---
    function updateRoster() {
        if (!studentRosterBody || !studentRosterRowTemplate) return;
        studentRosterBody.innerHTML = '';

        const studentsToRender = getFilteredAndSortedStudents(); // Apply filter/sort to roster too? Or separate filter? Assume same for now.

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
            rowElement.querySelector('.roster-session').textContent = currentSessionId || 'N/A';

            // Add listeners for roster-specific actions if needed
            // rowElement.querySelector('.view-details-btn').addEventListener('click', () => showStudentDetailModal(student.clientId));
            // rowElement.querySelector('.message-roster-btn').addEventListener('click', () => promptAndAnnounceToStudent(student.clientId));

            studentRosterBody.appendChild(rowElement);
        });
    }

    // --- Event Listeners ---

    // Sidebar Toggle
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


    // Sidebar Navigation (remains the same)
    navItems.forEach(item => { /* ... listener code ... */ });

    // Filter and Sort Listeners
    if(filterStudentsInput) {
        filterStudentsInput.addEventListener('input', (e) => {
            currentFilter = e.target.value;
            renderStudentGrid(); // Re-render grid with new filter
            updateNoStudentsPlaceholder();
        });
    }
     if(sortStudentsSelect) {
         sortStudentsSelect.addEventListener('change', (e) => {
             currentSort = e.target.value;
             renderStudentGrid(); // Re-render grid with new sort
         });
     }
     // Add similar listeners for roster filter/sort inputs if they are separate


    // Selection Handling (Select All) (remains the same)
    if (selectAllCheckbox) { /* ... listener code ... */ }

    // (handleStudentSelection remains the same)
    function handleStudentSelection(clientId, isSelected) { /* ... */ }

    // --- Bulk Action Button Listeners (check elements exist) ---
    lockSelectedBtn?.addEventListener('click', () => { /* ... */ });
    unlockSelectedBtn?.addEventListener('click', () => { /* ... */ });
    openTabSelectedBtn?.addEventListener('click', () => { /* ... */ });
    announceSelectedBtn?.addEventListener('click', () => { /* ... */ });
    blockSiteSelectedBtn?.addEventListener('click', () => { /* ... */ });

    // --- Modal Confirm Button Listeners (check elements exist) ---
    confirmOpenTabBtn?.addEventListener('click', () => { /* ... */ });
    confirmAnnounceBtn?.addEventListener('click', () => { /* ... */ });
    confirmBlockSiteBtn?.addEventListener('click', () => { /* ... */ });

    // --- Command Sending Helper (remains the same) ---
    function sendCommandToStudent(targetClientId, command, commandData = {}) { /* ... */ }

    // --- Modal Helpers (showModal, closeModal remain the same) ---
    function showModal(modalId) { /* ... */ }
    function closeModal(modalId) { /* ... */ }

    // --- Modal Close Event Listeners (using data attributes now) ---
    document.addEventListener('click', (e) => {
        // Close on background click
        if (e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
        // Close via explicit close button with data-modal-id
        const closeButton = e.target.closest('.close-btn');
        if (closeButton) {
             const modalId = closeButton.dataset.modalId || closeButton.closest('.modal')?.id;
             if (modalId) {
                 closeModal(modalId);
             }
        }
    });
    window.addEventListener('keydown', (e) => { /* ... Esc key listener ... */ });

    // --- Individual Student Actions (Prompts) (remain the same) ---
    function promptAndOpenTabForStudent(clientId) { /* ... */ }
    function promptAndAnnounceToStudent(clientId) { /* ... */ }

    // --- Large Student Detail Modal ---

    function handleScreenshotPreviewClick(event) {
         const previewElement = event.currentTarget; // The .screenshot-preview div
         const clientId = previewElement.dataset.clientId;
         if (clientId) {
             showStudentDetailModal(clientId);
         } else {
             console.error("Could not find clientId on clicked preview element.");
         }
     }

     function showStudentDetailModal(clientId) {
         const student = connectedStudents.get(clientId);
         if (!student || !studentDetailModal) return;

         console.log(`Showing detail modal for ${clientId}`);

         // Store client ID on modal for internal button actions
         studentDetailModal.dataset.viewingClientId = clientId;

         // Populate basic info
         if (detailModalStudentName) detailModalStudentName.textContent = student.email || clientId;

         // Populate Screenshot (use last known URL)
         updateDetailModalScreenshotIfVisible(clientId, student.lastScreenshotUrl);

         // Populate Tabs
         updateDetailModalTabsIfVisible(clientId, student.currentTabs);

         // Show the modal
         showModal('student-detail-modal');
          // Optionally request fresh data for this student?
         // sendCommandToStudent(clientId, 'get_current_state', {}); // Needs server support
     }

     function updateDetailModalScreenshotIfVisible(clientId, screenshotUrl, errorMsg = null) {
         // Check if modal is visible AND showing the correct student
         if (!studentDetailModal || studentDetailModal.classList.contains('hidden') || studentDetailModal.dataset.viewingClientId !== clientId) {
             return;
         }
         if (detailModalScreenshot) {
              if (screenshotUrl && typeof screenshotUrl === 'string' && screenshotUrl.startsWith('data:image')) {
                   detailModalScreenshot.src = screenshotUrl;
                   detailModalScreenshot.alt = `Screen for ${clientId}`;
              } else {
                   detailModalScreenshot.removeAttribute('src'); // Clear or set placeholder
                   detailModalScreenshot.alt = errorMsg || "Screenshot unavailable";
                   // Add a visual indication of error state if desired
              }
         }
     }

     function updateDetailModalTabsIfVisible(clientId, tabsData) {
          // Check if modal is visible AND showing the correct student
          if (!studentDetailModal || studentDetailModal.classList.contains('hidden') || studentDetailModal.dataset.viewingClientId !== clientId) {
              return;
          }

          if (!detailModalActiveTabDiv || !detailModalOtherTabsList || !detailModalTabItemTemplate) {
               console.error("Detail modal tab elements not found!"); return;
          }

          // Clear previous content
          detailModalActiveTabDiv.innerHTML = 'Loading...'; // Clear placeholder/old content
          detailModalOtherTabsList.innerHTML = '';

          let activeTab = null;
          let otherTabs = [];

          if (typeof tabsData === 'object' && tabsData !== null) {
               Object.values(tabsData).forEach(tab => {
                   if (tab) { // Ensure tab is not null/undefined
                       if (tab.active) { activeTab = tab; }
                       else { otherTabs.push(tab); }
                   }
               });
          }

          // Populate Active Tab Section
          if (activeTab) {
               populateTabItem(detailModalActiveTabDiv, activeTab, clientId, true); // Populate directly into the div
          } else {
               detailModalActiveTabDiv.innerHTML = '<p class="text-muted">No active tab found.</p>';
          }

          // Populate Other Tabs List
          if (detailModalOtherTabsCount) detailModalOtherTabsCount.textContent = otherTabs.length;

          if (otherTabs.length > 0) {
               otherTabs.forEach(tab => {
                    const tabItemClone = detailModalTabItemTemplate.content.cloneNode(true);
                    const liElement = tabItemClone.querySelector('.tab-item'); // Get the LI itself
                    if(liElement) {
                         populateTabItem(liElement, tab, clientId, false); // Populate the LI content
                         detailModalOtherTabsList.appendChild(liElement); // Append the populated LI
                    }
               });
          } else {
               detailModalOtherTabsList.innerHTML = '<li>No other tabs found.</li>';
          }
     }

      // Helper to populate a single tab item element (used for both active and other tabs)
     function populateTabItem(element, tabData, clientId, isActive) {
          if (!element || !tabData) return;

          element.dataset.tabId = tabData.id; // Store tab ID for close action

          const faviconImg = element.querySelector('.favicon');
          const titleSpan = element.querySelector('.tab-title');
          const urlSpan = element.querySelector('.tab-url');
          const closeBtn = element.querySelector('.close-tab-btn');

          if (faviconImg) {
              faviconImg.src = (tabData.favIconUrl && tabData.favIconUrl.startsWith('http')) ? tabData.favIconUrl : PLACEHOLDER_FAVICON;
              faviconImg.onerror = () => { faviconImg.src = PLACEHOLDER_FAVICON; };
          }
          if (titleSpan) {
              titleSpan.textContent = tabData.title || 'Untitled Tab';
              titleSpan.title = tabData.title || ''; // Tooltip for long titles
          }
          if (urlSpan) {
              urlSpan.textContent = tabData.url || '';
               urlSpan.title = tabData.url || ''; // Tooltip for long URLs
          }
          if (closeBtn) {
              // Remove old listener before adding new one if element is reused
              closeBtn.replaceWith(closeBtn.cloneNode(true)); // Simple way to remove listeners
              element.querySelector('.close-tab-btn').addEventListener('click', (e) => {
                   e.stopPropagation(); // Prevent potential modal close if inside clickable area
                  if (confirm(`Close tab "${tabData.title || 'Untitled'}" for this student?`)) {
                      sendCommandToStudent(clientId, 'close_tab', { tabId: tabData.id });
                      // Optionally remove the item optimistically or wait for tabs_update message
                      if (!isActive) {
                         element.remove(); // Remove from 'Other Tabs' list immediately
                          if (detailModalOtherTabsCount) detailModalOtherTabsCount.textContent = parseInt(detailModalOtherTabsCount.textContent, 10) - 1;
                      } else {
                          // Maybe show 'Closing...' on active tab or wait for update
                      }
                  }
              });
          }
          // Clear any existing specific content if populating a shared container like active tab div
          if (isActive) {
               const placeholder = element.firstChild; // Remove potential "Loading..." text node
               if (placeholder && placeholder.nodeType === Node.TEXT_NODE) {
                   placeholder.remove();
               }
               // Append the structured content if necessary (assuming template wasn't used directly)
               // This part needs refinement based on how the active tab div is structured initially
               // For simplicity, assuming the div is empty and we add elements:
               if (!element.querySelector('.favicon')) { // Check if content already exists
                   // Manually append elements if needed or use innerHTML with template string
               }
          }
     }

      // Add Listeners for buttons INSIDE the detail modal
      detailModalRefreshBtn?.addEventListener('click', () => {
          const clientId = studentDetailModal?.dataset.viewingClientId;
          if (clientId) {
              // Request fresh screenshot and tabs? Requires server support
               sendCommandToStudent(clientId, 'get_current_state', {});
               // Or just request tabs?
               // sendCommandToStudent(clientId, 'get_tabs', {});
              console.log(`Requested refresh for ${clientId}`);
              // Maybe show a loading indicator briefly
          }
      });
       detailModalLockBtn?.addEventListener('click', () => {
           const clientId = studentDetailModal?.dataset.viewingClientId;
           if (clientId) sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked' });
       });
       detailModalUnlockBtn?.addEventListener('click', () => {
            const clientId = studentDetailModal?.dataset.viewingClientId;
           if (clientId) sendCommandToStudent(clientId, 'unlock_screen', {});
       });
       detailModalMessageBtn?.addEventListener('click', () => {
            const clientId = studentDetailModal?.dataset.viewingClientId;
           if (clientId) promptAndAnnounceToStudent(clientId); // Reuse existing prompt function
       });


    // --- Settings --- (load/save remain the same)
    function loadSettings() { /* ... */ }
    saveDefaultBlocklistBtn?.addEventListener('click', () => { /* ... */ });
    saveDefaultIntervalBtn?.addEventListener('click', () => { /* ... */ });

    // --- Add student to select dropdown --- (remains the same)
    function addStudentToSelect(clientId, email) { /* ... */ }
    function removeStudentFromSelect(clientId) { /* ... */ }


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
