// script.js
document.addEventListener('DOMContentLoaded', () => {
    console.log("Saber Teacher Dashboard Initializing...");

    // --- Configuration ---
    const WS_URL = "wss://extension.mkseven1.com"; // Make sure this is correct!

    // --- DOM Elements ---
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.getElementById('main-content');
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const currentViewTitle = document.getElementById('current-view-title');
    const connectionStatusDiv = document.getElementById('connection-status');
    const connectionStatusText = connectionStatusDiv.querySelector('.text');
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
    let connectedStudents = new Map(); // clientId -> { email, userId, currentTabs, status ('connected', 'disconnected', 'locked'), lastScreenshot, lastUpdate }
    let selectedStudentIds = new Set();
    let currentSessionId = null; // Placeholder for session management
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_DELAY = 5000; // 5 seconds


    // --- WebSocket Functions ---

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

    // --- Server Message Handling ---

    function handleServerMessage(message) {
        const { type, data } = message;

        switch (type) {
            case 'initial_student_list': // Server sends list of currently connected students
                console.log("Received initial student list:", data);
                loadingPlaceholder.classList.add('hidden');
                connectedStudents.clear(); // Clear existing map
                studentGrid.innerHTML = ''; // Clear grid before adding
                 studentRosterBody.innerHTML = ''; // Clear roster
                if (data && Array.isArray(data)) {
                    data.forEach(studentData => processStudentUpdate(studentData.clientId, studentData));
                }
                updateBulkActionButtons();
                updateNoStudentsPlaceholder();
                 updateRoster(); // Update the table view as well
                break;

            case 'student_connected':
                console.log("Student connected:", data);
                 processStudentUpdate(data.clientId, { ...data, status: 'connected' });
                 updateNoStudentsPlaceholder();
                 updateRoster();
                break;

            case 'student_disconnected':
                console.log("Student disconnected:", data);
                updateStudentStatus(data.clientId, 'disconnected');
                updateRoster();
                break;

            // Message structure from server when forwarding student data:
            // { type: 'student_update', data: { clientId: 'xyz', payload: { type: 'screenshot', data: {...} } } }
            case 'student_update':
                if (data && data.clientId && data.payload) {
                    handleStudentPayload(data.clientId, data.payload);
                }
                break;

            case 'command_failed':
                console.error(`Command failed for student ${data.targetClientId}: ${data.reason}`);
                alert(`Command failed for student ${data.targetClientId || 'Unknown'}: ${data.reason || 'Unknown error'}`);
                break;

             case 'session_update': // Example: Server updates session list or status
                 console.log("Session update:", data);
                 // Update UI related to sessions here
                 break;

            case 'pong': // Ignore pong if necessary
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

    function handleStudentPayload(clientId, payload) {
         const student = connectedStudents.get(clientId);
         if (!student) return; // Ignore updates for unknown students

         student.lastUpdate = Date.now(); // Track activity

         switch (payload.type) {
             case 'screenshot':
                 updateStudentScreenshot(clientId, payload.data.imageData);
                 student.lastScreenshot = payload.data.imageData;
                 break;
             case 'screenshot_error':
             case 'screenshot_skipped':
                 updateStudentScreenshot(clientId, null, payload.data.error || payload.data.reason);
                 break;
             case 'tabs_update':
                student.currentTabs = payload.data;
                updateStudentActiveTab(clientId, payload.data);
                // Optionally update full tab list preview if implemented
                 break;
            // Handle incremental tab updates if server sends them
             case 'tab_created':
             case 'tab_updated':
             case 'tab_removed':
                // Request a full update for simplicity, or implement incremental logic
                 sendCommandToStudent(clientId, 'get_tabs', {});
                 break;

             case 'status_update': // Example: Student sends its own status (e.g., locked)
                if(payload.data.status) {
                     updateStudentStatus(clientId, payload.data.status);
                     updateRoster(); // Update table if status changes
                 }
                 break;

             default:
                 console.warn(`Unhandled student payload type: ${payload.type} for client ${clientId}`);
         }
    }

     function processStudentUpdate(clientId, studentData) {
        if (!studentData) return;

        const existingStudent = connectedStudents.has(clientId);
        const studentState = connectedStudents.get(clientId) || {};

        // Update student map
        const updatedState = {
            ...studentState,
            clientId: clientId,
            email: studentData.email || studentState.email || 'Unknown Email',
            userId: studentData.userId || studentState.userId || 'Unknown ID',
            status: studentData.status || studentState.status || 'disconnected', // Default to disconnected if not provided
            currentTabs: studentData.currentTabs || studentState.currentTabs || {},
            lastScreenshot: studentData.lastScreenshot || studentState.lastScreenshot || null,
            lastUpdate: Date.now(),
        };
        connectedStudents.set(clientId, updatedState);


         // Add or Update Student Card in Grid View
         let card = document.getElementById(`student-card-${clientId}`);
         if (!card) {
             card = createStudentCard(clientId, updatedState);
             studentGrid.appendChild(card);
             loadingPlaceholder.classList.add('hidden');
         } else {
             // Update existing card elements
             updateStudentCardContent(card, updatedState);
         }
         updateStudentStatusOnCard(card, updatedState.status); // Ensure visual status is correct

         // Update screenshot and tab info from the latest data
        if(updatedState.lastScreenshot) {
            updateStudentScreenshot(clientId, updatedState.lastScreenshot);
        }
        if(Object.keys(updatedState.currentTabs).length > 0) {
            updateStudentActiveTab(clientId, updatedState.currentTabs);
        }
     }

    function markAllStudentsDisconnected() {
        connectedStudents.forEach(student => {
             student.status = 'disconnected';
             updateStudentStatus(student.clientId, 'disconnected');
        });
         updateRoster(); // Update table view
    }


    // --- DOM Manipulation & UI Updates ---

    function createStudentCard(clientId, studentData) {
        const cardClone = studentCardTemplate.content.cloneNode(true);
        const cardElement = cardClone.querySelector('.student-card');
        cardElement.id = `student-card-${clientId}`;
        cardElement.dataset.clientId = clientId;

        // Initial content update
        updateStudentCardContent(cardElement, studentData);

        // Add event listeners for card-specific controls
        const checkbox = cardElement.querySelector('.student-select-checkbox');
        checkbox.addEventListener('change', () => handleStudentSelection(clientId, checkbox.checked));

        cardElement.querySelector('.lock-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card click through
            sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked by Teacher' });
        });
        cardElement.querySelector('.unlock-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            sendCommandToStudent(clientId, 'unlock_screen', {});
        });
         cardElement.querySelector('.open-tab-btn').addEventListener('click', (e) => {
             e.stopPropagation();
             promptAndOpenTabForStudent(clientId);
         });
          cardElement.querySelector('.message-btn').addEventListener('click', (e) => {
              e.stopPropagation();
              promptAndAnnounceToStudent(clientId);
          });
           cardElement.querySelector('.close-tab-btn').addEventListener('click', (e) => {
               e.stopPropagation();
               const activeTabId = cardElement.dataset.activeTabId; // Need to store active tab ID on card
               if(activeTabId) {
                 sendCommandToStudent(clientId, 'close_tab', { tabId: parseInt(activeTabId, 10) });
               } else {
                   alert("Could not determine the active tab to close.");
               }
           });

        return cardElement;
    }

    function updateStudentCardContent(cardElement, studentData) {
        cardElement.querySelector('.student-name').textContent = studentData.email || `Client: ${studentData.clientId.substring(0, 6)}`;
        cardElement.querySelector('.student-name').title = `${studentData.email}\nID: ${studentData.clientId}`;
        // Status dot is updated via updateStudentStatusOnCard
         // Screenshot and Active Tab are updated by their respective functions
    }


    function updateStudentStatus(clientId, status) {
        const student = connectedStudents.get(clientId);
        if (student) {
            student.status = status;
            const card = document.getElementById(`student-card-${clientId}`);
            if(card) {
                 updateStudentStatusOnCard(card, status);
            }
        }
        // No need to call updateRoster here, it's called by the message handler
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

    function updateStudentScreenshot(clientId, imageDataUrl, errorMessage = null) {
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

    function updateStudentActiveTab(clientId, tabsData) {
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


    function updateNoStudentsPlaceholder() {
         if (connectedStudents.size === 0) {
             noStudentsPlaceholder.classList.remove('hidden');
             loadingPlaceholder.classList.add('hidden');
         } else {
             noStudentsPlaceholder.classList.add('hidden');
         }
     }

    function updateBulkActionButtons() {
        const hasSelection = selectedStudentIds.size > 0;
        lockSelectedBtn.disabled = !hasSelection;
        unlockSelectedBtn.disabled = !hasSelection;
        openTabSelectedBtn.disabled = !hasSelection;
        announceSelectedBtn.disabled = !hasSelection;
        blockSiteSelectedBtn.disabled = !hasSelection;
    }

    function updateSelectedCount() {
        selectedCountSpan.textContent = `(${selectedStudentIds.size} Selected)`;
        selectAllCheckbox.checked = connectedStudents.size > 0 && selectedStudentIds.size === connectedStudents.size;
         selectAllCheckbox.indeterminate = selectedStudentIds.size > 0 && selectedStudentIds.size < connectedStudents.size;
    }


    // --- Student Roster View ---
    function updateRoster() {
         if (!studentRosterBody) return; // Only update if the view exists
         studentRosterBody.innerHTML = ''; // Clear existing rows

         if (connectedStudents.size === 0) {
             studentRosterBody.innerHTML = '<tr><td colspan="6">No students found.</td></tr>';
             return;
         }

         connectedStudents.forEach(student => {
             const rowClone = studentRosterRowTemplate.content.cloneNode(true);
             const rowElement = rowClone.querySelector('tr');
             rowElement.dataset.clientId = student.clientId;

             rowElement.querySelector('.roster-name').textContent = student.email?.split('@')[0] || 'Unknown'; // Example name extraction
             rowElement.querySelector('.roster-email').textContent = student.email || 'N/A';

             const statusBadge = rowElement.querySelector('.status-badge');
             statusBadge.textContent = student.status.charAt(0).toUpperCase() + student.status.slice(1);
             statusBadge.className = `status-badge ${student.status}`; // Set class for color

             rowElement.querySelector('.roster-session').textContent = currentSessionId || 'N/A'; // Placeholder session

             // Add event listeners for roster actions if needed

             studentRosterBody.appendChild(rowElement);
         });
    }


    // --- Event Listeners ---

    // Sidebar Toggle
    sidebarToggle.addEventListener('click', () => {
        // Check screen width to decide between collapse/force-open
        if (window.innerWidth <= 768) {
             document.body.classList.toggle('sidebar-force-open'); // Toggle explicit open class for mobile
             // Ensure standard collapsed class is removed if force-open is active
             if(document.body.classList.contains('sidebar-force-open')) {
                 document.body.classList.remove('sidebar-collapsed');
             } else {
                  document.body.classList.add('sidebar-collapsed'); // Default to collapsed on mobile if not forced open
             }
        } else {
            document.body.classList.toggle('sidebar-collapsed'); // Toggle standard collapse for desktop
             document.body.classList.remove('sidebar-force-open'); // Remove mobile override if used
        }
    });

     // Sidebar Navigation
     navItems.forEach(item => {
         item.addEventListener('click', (e) => {
             e.preventDefault();
             const targetViewId = item.dataset.view;
             if (!targetViewId) return;

             // Update active nav item
             navItems.forEach(i => i.classList.remove('active'));
             item.classList.add('active');

             // Update active view panel
             views.forEach(view => {
                 if (view.id === targetViewId) {
                     view.classList.add('active');
                     currentViewTitle.textContent = item.querySelector('span').textContent; // Update header title
                 } else {
                     view.classList.remove('active');
                 }
             });

             // If switching to roster, ensure it's up-to-date
              if (targetViewId === 'students-view') {
                 updateRoster();
             }
             // Close mobile sidebar after navigation
             if (window.innerWidth <= 768) {
                  document.body.classList.remove('sidebar-force-open');
                  document.body.classList.add('sidebar-collapsed');
             }

         });
     });

    // Selection Handling
    selectAllCheckbox.addEventListener('change', () => {
        const isChecked = selectAllCheckbox.checked;
        document.querySelectorAll('.student-select-checkbox').forEach(checkbox => {
            const card = checkbox.closest('.student-card');
            if (card) {
                const clientId = card.dataset.clientId;
                 // Only change selection if it's different from target state
                if(checkbox.checked !== isChecked) {
                    checkbox.checked = isChecked;
                    handleStudentSelection(clientId, isChecked);
                }
            }
        });
         // Ensure state consistency after bulk change
         if (!isChecked) {
             selectedStudentIds.clear();
         } else {
             connectedStudents.forEach((_, clientId) => selectedStudentIds.add(clientId));
         }
         updateSelectedCount();
         updateBulkActionButtons();
    });


    function handleStudentSelection(clientId, isSelected) {
        if (isSelected) {
            selectedStudentIds.add(clientId);
        } else {
            selectedStudentIds.delete(clientId);
        }
        updateSelectedCount();
        updateBulkActionButtons();
    }


    // Bulk Action Buttons
    lockSelectedBtn.addEventListener('click', () => {
        if (confirm(`Lock screens for ${selectedStudentIds.size} selected students?`)) {
            selectedStudentIds.forEach(clientId => {
                sendCommandToStudent(clientId, 'lock_screen', { message: 'Screen Locked by Teacher' });
            });
        }
    });

    unlockSelectedBtn.addEventListener('click', () => {
         if (confirm(`Unlock screens for ${selectedStudentIds.size} selected students?`)) {
            selectedStudentIds.forEach(clientId => {
                sendCommandToStudent(clientId, 'unlock_screen', {});
            });
         }
    });

     openTabSelectedBtn.addEventListener('click', () => {
         openTabUrlInput.value = 'https://';
         showModal('open-tab-modal');
     });

     announceSelectedBtn.addEventListener('click', () => {
         announceMessageInput.value = '';
         showModal('announce-modal');
     });

     blockSiteSelectedBtn.addEventListener('click', () => {
         // Maybe pre-fill with current default blocklist?
          blockPatternsInput.value = defaultBlocklistInput.value; // Use default as starting point
         showModal('block-site-modal');
     });

    // Modal Confirm Buttons
    confirmOpenTabBtn.addEventListener('click', () => {
        const url = openTabUrlInput.value.trim();
        if (url && url !== 'https://' && selectedStudentIds.size > 0) {
             try {
                new URL(url); // Basic URL validation
                 selectedStudentIds.forEach(clientId => {
                    sendCommandToStudent(clientId, 'open_tab', { url: url });
                });
                 closeModal('open-tab-modal');
            } catch (_) {
                alert("Please enter a valid URL (e.g., https://example.com)");
            }
        } else if (selectedStudentIds.size === 0) {
             alert("No students selected.");
         } else {
             alert("Please enter a URL.");
         }
    });

    confirmAnnounceBtn.addEventListener('click', () => {
        const message = announceMessageInput.value.trim();
        const duration = parseInt(announceDurationInput.value, 10) || 5000;
        if (message && selectedStudentIds.size > 0) {
            selectedStudentIds.forEach(clientId => {
                sendCommandToStudent(clientId, 'send_announcement', { message: message, duration: duration });
            });
            closeModal('announce-modal');
         } else if (selectedStudentIds.size === 0) {
             alert("No students selected.");
        } else {
            alert("Please enter an announcement message.");
        }
    });

    confirmBlockSiteBtn.addEventListener('click', () => {
        const patterns = blockPatternsInput.value
            .split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 0);

         if (selectedStudentIds.size > 0) {
            console.log(`Updating blocklist for ${selectedStudentIds.size} students:`, patterns);
             selectedStudentIds.forEach(clientId => {
                sendCommandToStudent(clientId, 'update_blocklist', { blockedSites: patterns });
             });
             closeModal('block-site-modal');
         } else {
              alert("No students selected.");
         }
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
             updateRoster();
         } else if (command === 'unlock_screen') {
             // Assume unlock makes them 'connected' if they were previously locked
             const student = connectedStudents.get(targetClientId);
             if(student && student.status === 'locked') {
                 updateStudentStatus(targetClientId, 'connected');
                 updateRoster();
             }
         }
    }


    // --- Modal Helpers ---
    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            // Focus first input if available
             const input = modal.querySelector('input, textarea');
             if (input) input.focus();
        }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // Close modals on background click or escape key
     document.querySelectorAll('.modal').forEach(modal => {
         modal.addEventListener('click', (e) => {
             if (e.target === modal) { // Click on the background itself
                 closeModal(modal.id);
             }
         });
     });
     window.addEventListener('keydown', (e) => {
         if (e.key === 'Escape') {
             document.querySelectorAll('.modal:not(.hidden)').forEach(modal => closeModal(modal.id));
         }
     });
     // Add closeModal calls to close buttons inside modals if not already done via inline onclick
      document.querySelectorAll('.modal .close-btn').forEach(btn => {
        const modal = btn.closest('.modal');
        if (modal && !btn.onclick) { // Avoid overriding existing inline onclick
            btn.addEventListener('click', () => closeModal(modal.id));
        }
    });

    // --- Individual Student Actions (from card buttons) ---
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


     // --- Settings ---
     // Example: Load/Save default settings using localStorage
     function loadSettings() {
         defaultBlocklistInput.value = localStorage.getItem('saberDefaultBlocklist') || '';
         defaultIntervalInput.value = localStorage.getItem('saberDefaultInterval') || '5000';
     }
     saveDefaultBlocklistBtn.addEventListener('click', () => {
         localStorage.setItem('saberDefaultBlocklist', defaultBlocklistInput.value);
         alert('Default blocklist saved.');
     });
      saveDefaultIntervalBtn.addEventListener('click', () => {
           const interval = parseInt(defaultIntervalInput.value, 10);
           if(isNaN(interval) || interval < 2000) {
               alert("Interval must be 2000ms or higher.");
               return;
           }
         localStorage.setItem('saberDefaultInterval', interval);
         alert('Default screenshot interval saved.');
     });


    // --- Initialization ---
    function initializeDashboard() {
         // Set initial state for mobile sidebar
         if (window.innerWidth <= 768) {
             document.body.classList.add('sidebar-collapsed');
         }
         loadSettings(); // Load saved settings
         updateBulkActionButtons(); // Ensure buttons are initially disabled
         updateSelectedCount();
         connectWebSocket(); // Start connection
     }

    initializeDashboard();

}); // End DOMContentLoaded
