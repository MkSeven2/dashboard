// script.js - Revised based on provided server.js logic

document.addEventListener('DOMContentLoaded', () => {
    console.log("Saber Teacher Dashboard Initializing - Revised...");

    // --- Configuration ---
    const WS_URL = "wss://extension.mkseven1.com"; // Make sure this matches your server
    const PLACEHOLDER_FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAEUlEQVR42mNkIAAYIBAAJBtnBAAAAABJRU5ErkJggg=='; // Transparent pixel
    const PLACEHOLDER_SCREENSHOT = 'placeholder.png'; // Use a real placeholder image path if available

    // --- DOM Elements (Assuming IDs from your HTML structure) ---
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.getElementById('main-content');
    const navList = document.querySelector('.nav-list');
    const views = document.querySelectorAll('.view');
    const currentViewTitle = document.getElementById('view-title'); // Changed ID from HTML
    const connectionStatusDiv = document.getElementById('connection-status');
    const connectionStatusText = connectionStatusDiv?.querySelector('.text');
    const studentGrid = document.getElementById('student-grid');
    const loadingPlaceholder = document.getElementById('loading-placeholder'); // Changed ID from HTML
    const noStudentsPlaceholder = document.getElementById('no-students-placeholder'); // Changed ID from HTML
    const studentCardTemplate = document.getElementById('student-card-template');

    // Toolbar (Screens View - Assuming IDs from your HTML)
    const selectAllCheckbox = document.getElementById('select-all-students'); // Changed ID from HTML
    const selectedCountSpan = document.getElementById('selected-count');
    const lockSelectedBtn = document.getElementById('lock-selected'); // Changed ID from HTML
    const unlockSelectedBtn = document.getElementById('unlock-selected'); // Changed ID from HTML
    const openTabSelectedBtn = document.getElementById('open-tab-selected'); // Changed ID from HTML
    const closeTabSelectedBtn = document.getElementById('close-tab-selected'); // Changed ID from HTML
    const announceSelectedBtn = document.getElementById('announce-selected'); // Changed ID from HTML
    const blockSiteSelectedBtn = document.getElementById('block-site-selected'); // Changed ID from HTML
    const focusSelectedBtn = document.getElementById('focus-selected'); // Changed ID from HTML
    const sortStudentsSelect = document.getElementById('sort-students');
    const filterStudentsInput = document.getElementById('student-search'); // Changed ID from HTML

    // Action Modals (Assuming IDs from your HTML)
    const openTabModal = document.getElementById('open-tab-modal');
    const openTabUrlInput = document.getElementById('open-tab-url');
    const confirmOpenTabBtn = document.getElementById('confirm-open-tab');
    const announceModal = document.getElementById('announce-modal');
    const announceMessageInput = document.getElementById('announce-message');
    const announceDurationInput = document.getElementById('announce-duration');
    const confirmAnnounceBtn = document.getElementById('confirm-announce');
    // Add references for block site / focus modals if created

    // Large Student Detail Modal & Elements (Assuming IDs from your HTML)
    const studentDetailModal = document.getElementById('student-detail-modal');
    const detailModalStudentName = document.getElementById('detail-student-name'); // Changed ID from HTML
    const detailModalScreenshot = document.getElementById('detail-screenshot'); // Changed ID from HTML
    const detailModalActiveTabEl = document.getElementById('detail-active-tab'); // Changed ID from HTML
    const detailModalTabListEl = document.getElementById('detail-tab-list'); // Changed ID from HTML
    const detailModalActivityLogEl = document.getElementById('detail-activity-log'); // Changed ID from HTML
    // Add references for buttons inside detail modal if needed for event listeners

    // Settings View Controls (Example - Assuming IDs from your HTML)
    // const defaultBlocklistInput = document.getElementById('default-blocklist');
    // const saveDefaultBlocklistBtn = defaultBlocklistInput?.nextElementSibling;

    // --- State Variables ---
    let teacherSocket = null;
    let connectedStudents = new Map(); // clientId -> { clientId, email, userId?, status, currentTabs?, activeTab?, lastScreenshotUrl?, lastUpdate }
    let selectedStudentIds = new Set();
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_DELAY = 5000;
    let reconnectTimeoutId = null;
    let currentSort = 'name'; // Default sort
    let currentFilter = ''; // Default filter
    let activeViewId = 'screens'; // Default view ID (matches HTML)


    // --- WebSocket Functions ---
    function connectWebSocket() {
        if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;

        if (teacherSocket && (teacherSocket.readyState === WebSocket.OPEN || teacherSocket.readyState === WebSocket.CONNECTING)) {
            console.log("WS: Already open or connecting.");
            return;
        }

        updateConnectionStatus('connecting', 'Connecting...');
        console.log(`WS: Attempting to connect to ${WS_URL}...`);
        try {
            teacherSocket = new WebSocket(WS_URL);
        } catch (error) {
            console.error("WS: Failed to create WebSocket:", error);
            updateConnectionStatus('disconnected', 'Connection Failed');
            scheduleReconnect();
            return;
        }

        teacherSocket.onopen = () => {
            updateConnectionStatus('connected', 'Connected');
            reconnectAttempts = 0;
            console.log('WS: Connection established.');
            // Send teacher connect message (as defined in server.js)
            sendMessageToServer({ type: 'teacher_connect', data: { /* Optional teacher info */ } });
            // Server should respond with 'initial_student_list'
        };

        teacherSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleServerMessage(message);
            } catch (error) {
                console.error('WS: Error processing message or invalid JSON:', event.data, error);
            }
        };

        teacherSocket.onerror = (error) => {
            console.error("WS: Error:", error);
            updateConnectionStatus('disconnected', 'Error');
            // onclose will handle reconnect scheduling
        };

        teacherSocket.onclose = (event) => {
            const reasonText = event.reason ? ` (${event.reason})` : ` (Code: ${event.code})`;
            console.log(`WS: Connection closed.${reasonText}`);
            updateConnectionStatus('disconnected', `Closed${reasonText}`);
            teacherSocket = null;
            markAllStudentsDisconnected(); // Mark students visually disconnected
            scheduleReconnect(); // Attempt to reconnect
        };
    }
function updateSelectionUI() {
         const selectedCount = selectedStudentIds.size;
         selectedCountSpan.textContent = `(${selectedCount} Selected)`;

         // Enable/disable bulk action buttons based on selection
         const bulkButtons = document.querySelectorAll('.view-toolbar .actions .btn');
         bulkButtons.forEach(btn => btn.disabled = (selectedCount === 0));

         // Update selectAll checkbox state (checked, indeterminate, or unchecked)
         const totalRendered = studentGrid.querySelectorAll('.student-card').length;
          if (totalRendered === 0) {
               selectAllCheckbox.checked = false;
               selectAllCheckbox.indeterminate = false;
          } else {
               selectAllCheckbox.checked = selectedCount === totalRendered;
               selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalRendered;
          }
     }
    
    function scheduleReconnect() {
        if (reconnectTimeoutId || (teacherSocket && teacherSocket.readyState === WebSocket.OPEN)) {
            return; // Already scheduled or connected
        }

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`WS: Attempting reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_DELAY / 1000}s...`);
            updateConnectionStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
            reconnectTimeoutId = setTimeout(connectWebSocket, RECONNECT_DELAY);
        } else {
            console.error("WS: Max reconnect attempts reached.");
            updateConnectionStatus('disconnected', 'Reconnect Failed');
        }
    }

    // No requestInitialData needed, server sends 'initial_student_list' on 'teacher_connect'

    function sendMessageToServer(payload) {
        if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
            try {
                teacherSocket.send(JSON.stringify(payload));
                // console.log("WS Sent:", payload); // Optional: log sent messages
            } catch (error) {
                console.error("WS: Error sending message:", error);
            }
        } else {
            console.warn("WS: Not open. Message not sent:", payload);
            // Consider queuing or showing an error
        }
    }

    function updateConnectionStatus(status, text) {
        if (connectionStatusDiv && connectionStatusText) {
            connectionStatusDiv.className = `status-indicator ${status}`;
            connectionStatusText.textContent = text;
        }
    }


    // --- Server Message Handling (Aligned with server.js) ---
    function handleServerMessage(message) {
        const { type, data } = message;
        // console.log(`WS Received: ${type}`, data); // Debug log

        let needsUiRefresh = false; // Flag for grid/roster updates

        switch (type) {
            case 'initial_student_list': // Server sends this after teacher connects
                console.log("Processing initial student list...");
                connectedStudents.clear();
                selectedStudentIds.clear();
                if (data && Array.isArray(data)) {
                    data.forEach(studentData => {
                        if (studentData?.clientId) {
                            // Initialize student state
                            connectedStudents.set(studentData.clientId, {
                                clientId: studentData.clientId,
                                email: studentData.email || 'Unknown Email',
                                status: 'connected', // Assume initially connected if server sends them
                                lastUpdate: Date.now()
                                // Other fields (tabs, screenshot) will come via specific updates
                            });
                        }
                    });
                }
                needsUiRefresh = true;
                break;

            case 'student_connected': // Server sends when a new student joins
                if (data?.clientId) {
                    console.log(`Student connected: ${data.email} (ID: ${data.clientId})`);
                    connectedStudents.set(data.clientId, {
                        clientId: data.clientId,
                        email: data.email || 'Unknown Email',
                        status: 'connected',
                        lastUpdate: Date.now()
                    });
                    needsUiRefresh = true;
                }
                break;

            case 'student_disconnected': // Server sends when a student leaves
                if (data?.clientId) {
                    console.log(`Student disconnected: ${data.clientId}`);
                    const student = connectedStudents.get(data.clientId);
                    if (student) {
                        student.status = 'disconnected';
                        // Keep the student in the map but mark as disconnected visually
                        if (selectedStudentIds.has(data.clientId)) {
                            selectedStudentIds.delete(data.clientId);
                        }
                        needsUiRefresh = true; // Update grid/roster to show disconnected status
                    }
                }
                break;

            // --- Handling relayed student data ---
            // Server wraps original student message `data` inside a `payload` field,
            // and adds the `clientId` at the top level.
            case 'student_screenshot':
                if (data?.clientId && data.payload?.imageData) {
                    const student = connectedStudents.get(data.clientId);
                    if (student) {
                        student.lastScreenshotUrl = data.payload.imageData;
                        student.lastUpdate = Date.now();
                        student.status = 'connected'; // Receiving data implies connected
                        updateStudentCard(data.clientId, student); // Direct UI update for screenshot
                        updateDetailModalScreenshotIfVisible(data.clientId, data.payload.imageData);
                    }
                } else { console.warn("Received student_screenshot with missing data", data); }
                break;

            case 'student_screenshot_error':
            case 'student_screenshot_skipped':
                if (data?.clientId && data.payload) {
                    const student = connectedStudents.get(data.clientId);
                    if (student) {
                        student.lastScreenshotUrl = null; // Clear previous screenshot
                        student.lastUpdate = Date.now();
                        student.status = 'connected'; // Still connected, just no screenshot
                        const reason = data.payload.error || data.payload.reason || "Screenshot unavailable";
                        updateStudentCard(data.clientId, student); // Update UI (will show placeholder)
                        updateDetailModalScreenshotIfVisible(data.clientId, null, reason);
                    }
                } else { console.warn("Received screenshot error/skip with missing data", data); }
                break;

            // Covers 'student_tabs_update', 'student_tab_created', 'student_tab_updated', 'student_tab_removed'
            case 'student_tabs_update':
            case 'student_tab_created':
            case 'student_tab_updated':
            case 'student_tab_removed':
                 if (data?.clientId && data.payload) {
                    const student = connectedStudents.get(data.clientId);
                    if (student) {
                        // The payload *is* the new tabs object or the single tab data/id
                        // For simplicity here, we just store the latest payload.
                        // A more robust solution might merge updates for single tab changes.
                        // For 'tabs_update', payload is the full tab object { tabId: {...}, ...}
                        if(type === 'student_tabs_update') {
                             student.currentTabs = data.payload;
                        } else {
                            // Handle single tab events if needed (e.g., update just one entry in student.currentTabs)
                            // For now, just note the update time and update active tab if applicable
                             // console.log(`Tab event ${type} for ${data.clientId}`, data.payload);
                        }

                        // Find the active tab from the latest full update
                         student.activeTab = typeof student.currentTabs === 'object'
                           ? Object.values(student.currentTabs).find(tab => tab && tab.active)
                           : null;

                        student.lastUpdate = Date.now();
                        student.status = 'connected'; // Receiving data implies connected
                        updateStudentCard(data.clientId, student); // Update card's active tab info
                        updateDetailModalTabsIfVisible(data.clientId, student.currentTabs);
                    }
                } else { console.warn(`Received ${type} with missing data`, data); }
                break;

            // --- Handling direct server messages/responses ---
            case 'command_failed': // Server reports command couldn't be sent/processed
                console.error(`Server reported command failed for ${data?.targetClientId}: ${data?.reason}`);
                alert(`Command failed for student ${data?.targetClientId || 'Unknown'}: ${data?.reason || 'Unknown error'}`);
                // Maybe revert optimistic UI changes if applicable
                break;

            case 'server_ack': // Optional: Server acknowledges receiving a message
                 console.log("Server ACK:", data?.message);
                 break;

             case 'pong': // Server responding to our ping
                 // console.log("Received Pong from server");
                 break;

             case 'error': // Server sending an error message (e.g., duplicate teacher)
                console.error("Server Error:", data?.message);
                alert(`Server Error: ${data?.message}`);
                if (data?.message?.includes("Another teacher session is active")) {
                    // Optionally disable UI or force disconnect
                    if(teacherSocket) teacherSocket.close();
                }
                break;

            default:
                console.warn(`Received unhandled message type: ${type}`, data);
        }

        // Centralized UI refresh for grid/roster if necessary
        if (needsUiRefresh) {
            console.log("Needs UI Refresh: Rendering Grid/Roster...");
            renderStudentGrid(); // Apply filter/sort and update grid
            // updateRoster(); // Update table view if implemented
            updateNoStudentsPlaceholder(); // Check if placeholders needed
            updateBulkActionButtons(); // Update button states based on selection
            updateSelectedCount(); // Update selection counter
            // populateTargetStudentSelect(); // Update dropdown if implemented
        }
    }

    // Helper to create/update student state object (more defensive)
    // No longer needed here, handled directly in message cases

    function markAllStudentsDisconnected() {
        let changed = false;
        connectedStudents.forEach(student => {
            if (student.status !== 'disconnected') {
                student.status = 'disconnected';
                changed = true;
                // Don't remove from map, just update status for visual representation
            }
        });
        if (changed) {
            console.log("Marking all students disconnected visually.");
            renderStudentGrid(); // Re-render cards to show disconnected status
            // updateRoster(); // Update roster if implemented
            selectedStudentIds.clear(); // Clear selection on disconnect
            updateSelectedCount();
            updateBulkActionButtons();
        }
    }

    // --- Centralized Rendering ---
    function renderStudentGrid() {
        if (!studentGrid || !studentCardTemplate) return;

        const fragment = document.createDocumentFragment();
        const studentsToDisplay = getFilteredAndSortedStudents();

        // --- Optimization: Update existing cards, remove orphans, add new ---
        const existingCardIds = new Set(Array.from(studentGrid.querySelectorAll('.student-card')).map(card => card.dataset.clientId));
        const studentsToDisplayIds = new Set(studentsToDisplay.map(s => s.clientId));

        // Remove cards for students no longer in the display list (disconnected AND not filtered out)
        existingCardIds.forEach(id => {
             if (!studentsToDisplayIds.has(id)) {
                  const card = studentGrid.querySelector(`.student-card[data-client-id="${id}"]`);
                  if (card) card.remove();
             }
        });


        // Update existing or add new cards
        studentsToDisplay.forEach(student => {
            let card = studentGrid.querySelector(`.student-card[data-client-id="${student.clientId}"]`);
            if (!card) { // Create new card
                card = createStudentCardElement(student.clientId, student);
                if(card) fragment.appendChild(card); // Add to fragment for bulk insertion
            }
             if(card) updateStudentCard(student.clientId, student, card); // Update content regardless
        });

        // Append new cards if any
        if(fragment.childNodes.length > 0) {
            studentGrid.appendChild(fragment);
        }

        updateNoStudentsPlaceholder(studentsToDisplay.length);
        updateSelectionUI(); // Ensure selection states are correct after render
         console.log(`Grid rendered with ${studentsToDisplay.length} students.`);
    }

    function getFilteredAndSortedStudents() {
        let studentsArray = Array.from(connectedStudents.values());

        // --- Filtering ---
        // 1. Filter by connection status (optional - maybe show disconnected grayed out?)
        // studentsArray = studentsArray.filter(s => s.status !== 'disconnected');

        // 2. Filter by search term
        if (currentFilter) {
            const filterLower = currentFilter.toLowerCase().trim();
            if (filterLower) {
                studentsArray = studentsArray.filter(student =>
                    (student.email && student.email.toLowerCase().includes(filterLower)) ||
                    (student.clientId && student.clientId.toLowerCase().includes(filterLower))
                );
            }
        }

        // --- Sorting ---
        studentsArray.sort((a, b) => {
            // Status Sort: connected > locked > disconnected > unknown
            if (currentSort === 'status') {
                const statusOrder = { connected: 1, locked: 2, disconnected: 3 };
                const statusA = statusOrder[a.status] || 4;
                const statusB = statusOrder[b.status] || 4;
                if (statusA !== statusB) return statusA - statusB;
            }
             // Activity Sort (requires lastUpdate timestamp)
             if (currentSort === 'activity') {
                  const lastUpdateA = a.lastUpdate || 0;
                  const lastUpdateB = b.lastUpdate || 0;
                  if (lastUpdateA !== lastUpdateB) return lastUpdateB - lastUpdateA; // Descending (most recent first)
             }

            // Default/Name Sort (as fallback or primary)
            const nameA = a.email || a.clientId;
            const nameB = b.email || b.clientId;
            return nameA.localeCompare(nameB);
        });

        return studentsArray;
    }

    // --- DOM Manipulation & UI Updates ---

    function createStudentCardElement(clientId, studentData) {
        if (!studentCardTemplate) return null;
        const cardClone = studentCardTemplate.content.cloneNode(true);
        const cardElement = cardClone.querySelector('.student-card');
        if (!cardElement) return null;

        cardElement.dataset.clientId = clientId;

        // Add essential event listeners immediately
        const checkbox = cardElement.querySelector('.student-select');
        const screenshotContainer = cardElement.querySelector('.screenshot-container');
        const closeTabBtn = cardElement.querySelector('.close-tab-btn');
        // const menuBtn = cardElement.querySelector('.card-menu .card-action-btn'); // For dropdown

         if(checkbox) {
             checkbox.addEventListener('change', handleStudentSelectChange);
             checkbox.checked = selectedStudentIds.has(clientId); // Set initial state
         }
         if(screenshotContainer) {
             screenshotContainer.addEventListener('click', () => showStudentDetail(clientId));
         }
         if(closeTabBtn) {
             closeTabBtn.addEventListener('click', (e) => {
                 e.stopPropagation(); // Prevent card click/modal open
                 const student = connectedStudents.get(clientId);
                 const activeTabId = student?.activeTab?.id;
                 if (activeTabId && confirm(`Close active tab for ${student?.email || clientId}?`)) {
                     // Send command to close specific tab via server
                      sendStudentCommand(clientId, 'close_tab', { tabId: activeTabId });
                 } else if (!activeTabId) {
                     alert('Could not determine the active tab for this student.');
                 }
             });
         }
         // Add listener for menuBtn if implementing dropdown actions

        // Initial content update happens in renderStudentGrid calling updateStudentCard
        return cardElement;
    }

    // Updates content of an existing card element
    function updateStudentCard(clientId, studentData, cardElement = null) {
        const card = cardElement || studentGrid.querySelector(`.student-card[data-client-id="${clientId}"]`);
        if (!card || !studentData) {
             // console.warn(`Card not found for update: ${clientId}`);
             return;
        }

        // Update data attributes for styling/state
        card.dataset.status = studentData.status || 'disconnected';

        // Update visible elements
        const nameEl = card.querySelector('.student-name');
        const screenshotImg = card.querySelector('.screenshot-img');
        const noScreenshotOverlay = card.querySelector('.no-screenshot-overlay');
        const lastUpdatedEl = card.querySelector('.last-updated');
        const faviconEl = card.querySelector('.favicon');
        const tabTitleEl = card.querySelector('.tab-title');
        const lockOverlay = card.querySelector('.card-lock-overlay');
        const selectCheckbox = card.querySelector('.student-select');

        if (nameEl) nameEl.textContent = studentData.email || `ID: ${clientId.substring(0, 6)}`;
        if (selectCheckbox) selectCheckbox.checked = selectedStudentIds.has(clientId); // Ensure checkbox reflects state

        // Screenshot
        if (screenshotImg && noScreenshotOverlay && lastUpdatedEl) {
            if (studentData.lastScreenshotUrl) {
                // Avoid flickering if URL hasn't changed
                if (screenshotImg.src !== studentData.lastScreenshotUrl) {
                    screenshotImg.src = studentData.lastScreenshotUrl;
                }
                screenshotImg.style.display = 'block';
                noScreenshotOverlay.classList.add('hidden');
            } else {
                screenshotImg.style.display = 'none';
                screenshotImg.src = PLACEHOLDER_SCREENSHOT; // Reset src
                noScreenshotOverlay.classList.remove('hidden');
            }
            lastUpdatedEl.textContent = studentData.lastUpdate ? `${new Date(studentData.lastUpdate).toLocaleTimeString()}` : 'Never';
        }

        // Active Tab Info
        if (faviconEl && tabTitleEl) {
            const activeTab = studentData.activeTab || null; // Already derived in message handler
            if (activeTab) {
                 if(faviconEl.src !== (activeTab.favIconUrl || PLACEHOLDER_FAVICON)) {
                      faviconEl.src = activeTab.favIconUrl || PLACEHOLDER_FAVICON;
                 }
                tabTitleEl.textContent = activeTab.title || 'Untitled Tab';
                tabTitleEl.title = activeTab.url || '';
            } else {
                 if(faviconEl.src !== PLACEHOLDER_FAVICON) faviconEl.src = PLACEHOLDER_FAVICON;
                tabTitleEl.textContent = studentData.status === 'disconnected' ? 'Disconnected' : 'No Active Tab';
                tabTitleEl.title = '';
            }
            faviconEl.onerror = () => { if(faviconEl.src !== PLACEHOLDER_FAVICON) faviconEl.src = PLACEHOLDER_FAVICON; };
        }

        // Lock Overlay
        if (lockOverlay) {
            lockOverlay.classList.toggle('hidden', studentData.status !== 'locked');
        }
    }

    function updateNoStudentsPlaceholder(studentCount = -1) {
         // Use provided count if available, otherwise count from map
         const count = studentCount >= 0 ? studentCount : connectedStudents.size;
         const anyConnected = Array.from(connectedStudents.values()).some(s => s.status !== 'disconnected');

         loadingPlaceholder.classList.add('hidden'); // Always hide loading after first check

         if (count === 0) {
              // Map is truly empty
              noStudentsPlaceholder.textContent = "No students connected.";
              noStudentsPlaceholder.classList.remove('hidden');
         } else if (!anyConnected) {
              // Students exist but all are marked disconnected
               noStudentsPlaceholder.textContent = "All students are disconnected.";
               noStudentsPlaceholder.classList.remove('hidden');
         } else if (studentCount === 0 && currentFilter) {
               // No students match the current filter
                noStudentsPlaceholder.textContent = `No students match filter "${currentFilter}".`;
                noStudentsPlaceholder.classList.remove('hidden');
         }
          else {
              // Students are present and at least one is active/matches filter
              noStudentsPlaceholder.classList.add('hidden');
         }
    }


    // (updateBulkActionButtons remains the same)
    function updateBulkActionButtons() {
        const hasSelection = selectedStudentIds.size > 0;
        lockSelectedBtn.disabled = !hasSelection;
        unlockSelectedBtn.disabled = !hasSelection;
        openTabSelectedBtn.disabled = !hasSelection;
        closeTabSelectedBtn.disabled = !hasSelection; // Enable only if selection exists
        announceSelectedBtn.disabled = !hasSelection;
        blockSiteSelectedBtn.disabled = !hasSelection;
        focusSelectedBtn.disabled = !hasSelection;
    }

    // (updateSelectedCount remains the same)
    function updateSelectedCount() {
         const selectedCount = selectedStudentIds.size;
        selectedCountSpan.textContent = `(${selectedCount} Selected)`;

        // Update selectAll checkbox state
        const renderedCards = studentGrid.querySelectorAll('.student-card');
        const totalRendered = renderedCards.length;
        const allRenderedSelected = totalRendered > 0 && selectedCount === totalRendered;

        if (selectAllCheckbox) {
             selectAllCheckbox.checked = allRenderedSelected;
             selectAllCheckbox.indeterminate = selectedCount > 0 && !allRenderedSelected;
        }
    }

    // --- Student Roster View --- (Placeholder - Implement if needed)
    // function updateRoster() { ... }

    // --- Event Listeners ---

    // Sidebar Toggle
    sidebarToggle?.addEventListener('click', () => {
        body.classList.toggle('sidebar-collapsed');
         // Add logic for mobile overlay if needed based on window width
    });

    // Sidebar Navigation
    if (navList) {
        navList.addEventListener('click', (e) => {
            const navLink = e.target.closest('.nav-item a');
            if (!navLink) return;
            const navItem = navLink.closest('.nav-item');
            const targetView = navItem?.dataset.view; // Get view ID from data-view attribute
            if (!targetView) return;

            e.preventDefault();
            switchView(targetView);
        });
    }

    // Filter and Sort Listeners
    filterStudentsInput?.addEventListener('input', (e) => {
        currentFilter = e.target.value;
        renderStudentGrid(); // Re-render with new filter
    });
    sortStudentsSelect?.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderStudentGrid(); // Re-render with new sort order
    });

    // Selection Handling (Select All)
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            const isChecked = selectAllCheckbox.checked;
            selectedStudentIds.clear(); // Clear previous

            if (isChecked) {
                 // Select all currently *displayed* students (respects filter)
                 studentGrid.querySelectorAll('.student-card').forEach(card => {
                     if (card.dataset.clientId) {
                          selectedStudentIds.add(card.dataset.clientId);
                     }
                 });
            }

            // Update individual checkboxes and UI counts/buttons
            studentGrid.querySelectorAll('.student-select').forEach(cb => {
                 cb.checked = isChecked;
            });
            updateSelectionUI();
        });
    }

    // Handle individual student selection (delegated listener on card creation)
    function handleStudentSelectChange(event) {
        const checkbox = event.target;
        const card = checkbox.closest('.student-card');
        const clientId = card?.dataset.clientId;
        if (!clientId) return;

        if (checkbox.checked) {
            selectedStudentIds.add(clientId);
        } else {
            selectedStudentIds.delete(clientId);
        }
        updateSelectionUI(); // Update counts, bulk buttons, selectAll state
    }

    // --- Bulk Action Button Listeners ---
    lockSelectedBtn?.addEventListener('click', () => sendBulkCommand('lock_screen', { message: "Screen Locked by Teacher" }));
    unlockSelectedBtn?.addEventListener('click', () => sendBulkCommand('unlock_screen'));
    openTabSelectedBtn?.addEventListener('click', () => showModal('open-tab-modal')); // Opens modal
    announceSelectedBtn?.addEventListener('click', () => showModal('announce-modal')); // Opens modal

    closeTabSelectedBtn?.addEventListener('click', () => {
        if (selectedStudentIds.size > 0 && confirm(`Close the active tab for all ${selectedStudentIds.size} selected students?`)) {
             // Note: This assumes the student client extension knows how to close its *own* active tab.
             // The server just relays the command.
             sendBulkCommand('close_active_tab', {}); // Command name is conceptual
        }
    });
    blockSiteSelectedBtn?.addEventListener('click', () => {
         const blocklistString = prompt(`Enter block patterns for ${selectedStudentIds.size} students (one per line):\n(e.g., *://*.coolmathgames.com/*)`);
         if (blocklistString !== null) { // Check prompt wasn't cancelled
             const blockedSites = blocklistString.split('\n').map(s => s.trim()).filter(s => s);
             if(blockedSites.length > 0) {
                 sendBulkCommand('update_blocklist', { blockedSites });
             } else {
                 alert("No block patterns entered.");
             }
         }
    });
    focusSelectedBtn?.addEventListener('click', () => {
         const url = prompt(`Enter URL to focus ${selectedStudentIds.size} students on:`, "https://");
         if (url && url !== "https://") {
              if (!url.startsWith('http://') && !url.startsWith('https://')) {
                  alert('Please enter a valid URL (http:// or https://)');
                  return;
              }
             sendBulkCommand('focus_tab', { url }); // Student client needs to handle this command
         }
    });


    // --- Modal Confirm Button Listeners ---
    confirmOpenTabBtn?.addEventListener('click', () => {
        const url = openTabUrlInput?.value?.trim();
        if (!url) { alert("Please enter a URL."); return; }
         if (!url.startsWith('http://') && !url.startsWith('https://')) {
             alert('URL must start with http:// or https://'); return;
         }
        if (selectedStudentIds.size > 0) {
            sendBulkCommand('open_tab', { url: url });
            closeModal('open-tab-modal');
        } else { alert("No students selected."); }
    });
    confirmAnnounceBtn?.addEventListener('click', () => {
        const message = announceMessageInput?.value?.trim();
         const duration = parseInt(announceDurationInput?.value || '10', 10) * 1000; // s to ms
        if (!message) { alert("Please enter a message."); return; }
        if (isNaN(duration) || duration < 1000) { alert("Invalid duration."); return;}

        if (selectedStudentIds.size > 0) {
            sendBulkCommand('send_announcement', { message: message, duration: duration });
            closeModal('announce-modal');
        } else { alert("No students selected."); }
    });
     // Add confirm listeners for block/focus modals if implemented

    // --- Command Sending Helpers ---
    // Sends command for a *single* student
    function sendStudentCommand(clientId, command, commandData = {}) {
        console.log(`CMD -> ${clientId}: ${command}`, commandData);
        sendMessageToServer({
            type: 'teacher_command',
            // Server expects payload structure like this based on server.js
            data: {
                targetClientId: clientId,
                command: command,
                data: commandData // This is the specific payload for the student client
            }
        });
        // Add optimistic UI updates if needed (e.g., show 'locking...' on card)
    }

    // Sends a command to all *currently selected* students
    function sendBulkCommand(command, commandData = {}) {
        const targetIds = Array.from(selectedStudentIds);
        if (targetIds.length === 0) return;
        console.log(`Bulk CMD -> ${targetIds.length} students: ${command}`, commandData);
        targetIds.forEach(clientId => {
            sendStudentCommand(clientId, command, commandData); // Send individual commands
        });
    }

    // --- Modal Helpers ---
    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal?.classList.remove('hidden');
         // Focus first input in modal if possible
        modal?.querySelector('input, textarea')?.focus();
    }
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        modal?.classList.add('hidden');
        // Reset specific modal fields
        switch (modalId) {
            case 'open-tab-modal': openTabUrlInput.value = ''; break;
            case 'announce-modal': announceMessageInput.value = ''; announceDurationInput.value = '10'; break;
            // Add other modals
        }
    }

    // Setup modal close triggers (buttons and background clicks)
    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('close-modal-btn')) {
            const modalId = event.target.dataset.modalId;
            if (modalId) closeModal(modalId);
        } else if (event.target.classList.contains('modal')) {
             closeModal(event.target.id); // Close modals on background click
        }
    });
     // Close modals on Escape key
     window.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
               document.querySelectorAll('.modal:not(.hidden)').forEach(modal => closeModal(modal.id));
          }
     });


    // --- Large Student Detail Modal ---
    function showStudentDetail(clientId) {
        const student = connectedStudents.get(clientId);
        if (!student || !studentDetailModal) return;

        console.log("Showing detail for:", clientId);

        // Populate static info
        if(detailModalStudentName) detailModalStudentName.textContent = student.email || `ID: ${clientId}`;

        // Populate dynamic info (screenshot, tabs, activity)
        updateDetailModalScreenshotIfVisible(clientId, student.lastScreenshotUrl);
        updateDetailModalTabsIfVisible(clientId, student.currentTabs);
        // updateDetailModalActivity(clientId, student.activity); // Needs activity data structure

        studentDetailModal.dataset.viewingClientId = clientId; // Store for actions
        showModal('student-detail-modal');

        // Optional: Request fresh, detailed state from student
        // sendStudentCommand(clientId, 'get_detailed_state', {});
    }

     function updateDetailModalScreenshotIfVisible(clientId, screenshotUrl, errorMsg = null) {
         // Only update if the modal is open AND showing the correct student
         if (studentDetailModal.classList.contains('hidden') || studentDetailModal.dataset.viewingClientId !== clientId) {
             return;
         }
          if (detailModalScreenshot) {
               if(screenshotUrl) {
                    detailModalScreenshot.src = screenshotUrl;
                    detailModalScreenshot.alt = `Screenshot for ${clientId}`;
                    // Hide any error message overlay if implemented
               } else {
                    detailModalScreenshot.src = PLACEHOLDER_SCREENSHOT;
                    detailModalScreenshot.alt = errorMsg || `Screenshot unavailable for ${clientId}`;
                    // Show error message overlay if implemented
               }
          }
     }

     function updateDetailModalTabsIfVisible(clientId, tabsData) {
         if (studentDetailModal.classList.contains('hidden') || studentDetailModal.dataset.viewingClientId !== clientId) {
             return;
         }

         const activeTab = typeof tabsData === 'object'
             ? Object.values(tabsData).find(tab => tab && tab.active)
             : null;

         // Update Active Tab Section
         if (detailModalActiveTabEl) {
             if (activeTab) {
                  // Simple text representation - could be more structured HTML
                  detailModalActiveTabEl.innerHTML = `
                      <img src="${activeTab.favIconUrl || PLACEHOLDER_FAVICON}" class="favicon" alt="Favicon">
                      <strong>${activeTab.title || 'Untitled'}</strong>
                      <br><small>${activeTab.url || 'No URL'}</small>
                  `;
                  // Add close button if needed, attaching listener with tabId
             } else {
                  detailModalActiveTabEl.textContent = "No active tab reported.";
             }
         }

          // Update Other Tabs List
          if (detailModalTabListEl) {
               detailModalTabListEl.innerHTML = ''; // Clear previous list
               let otherTabCount = 0;
               if (typeof tabsData === 'object') {
                    Object.values(tabsData).forEach(tab => {
                         if (tab && !tab.active) {
                              otherTabCount++;
                              const li = document.createElement('li');
                              li.innerHTML = `
                                   <img src="${tab.favIconUrl || PLACEHOLDER_FAVICON}" class="favicon" alt="">
                                   <span>${tab.title || 'Untitled'}</span>
                                   <small>(${tab.url || 'No URL'})</small>
                                   <button class="btn btn-danger btn-sm close-detail-tab-btn" data-tab-id="${tab.id}" title="Close Tab">&times;</button>
                              `;
                              detailModalTabListEl.appendChild(li);
                         }
                    });
               }
               if (otherTabCount === 0) {
                   detailModalTabListEl.innerHTML = '<li>No other tabs reported.</li>';
               }
                // Add event listener for the close buttons added above (use delegation on tabListEl)
                detailModalTabListEl.querySelectorAll('.close-detail-tab-btn').forEach(btn => {
                     btn.addEventListener('click', handleDetailTabClose);
                });
          }
     }

     function handleDetailTabClose(event) {
         const button = event.target;
         const tabId = button.dataset.tabId;
         const clientId = studentDetailModal?.dataset.viewingClientId;

         if (tabId && clientId && confirm("Close this tab for the student?")) {
             sendStudentCommand(clientId, 'close_tab', { tabId: parseInt(tabId, 10) });
              // Optimistically remove the list item
             button.closest('li')?.remove();
         }
     }
      // function updateDetailModalActivity(clientId, activityData) { ... }


    // --- View Switching Logic ---
    function switchView(viewId) {
        activeViewId = viewId; // Store the current view

        // Update nav item highlight
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewId);
        });

        // Update main header title
        const activeNavItem = document.querySelector(`.nav-item[data-view="${viewId}"] span`);
        if (currentViewTitle && activeNavItem) {
            currentViewTitle.textContent = activeNavItem.textContent;
        }

        // Show the target view, hide others
        views.forEach(view => {
            view.classList.toggle('active', view.id === `${viewId}-view`);
        });

        console.log(`Switched view to: ${viewId}`);
        // Add logic here if specific actions are needed when switching TO a view
        // e.g., if (viewId === 'timeline') fetchTimelineData();
         if (viewId === 'screens') renderStudentGrid(); // Ensure grid is rendered correctly when switching back
    }

    // --- Initialization ---
    function initializeDashboard() {
        console.log("Initializing dashboard...");
        if (window.innerWidth <= 768) { // Apply collapsed sidebar on small screens initially
            body.classList.add('sidebar-collapsed');
        }
        // loadSettings(); // Load any saved settings if implemented
        switchView(activeViewId); // Set the initial view correctly
        updateBulkActionButtons(); // Initial button states
        updateSelectedCount();
        updateNoStudentsPlaceholder();
        connectWebSocket(); // Start connection attempt
    }

    // --- Start ---
    initializeDashboard();

}); // End DOMContentLoaded
