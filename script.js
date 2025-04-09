// --- Sabre Dashboard Script ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("Sabre Dashboard Initializing...");

    // --- Config ---
    const WS_URL = "wss://extension.mkseven1.com"; // CHANGE TO YOUR ACTUAL SERVER URL
    const RECONNECT_DELAY_MS = 5000;
    const MAX_RECONNECT_ATTEMPTS = 10;

    // --- DOM Elements ---
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.getElementById('main-content');
    const viewTitle = document.getElementById('view-title');
    const views = document.querySelectorAll('.view');
    const navItems = document.querySelectorAll('.nav-item');
    const connectionStatusDiv = document.getElementById('connection-status');
    const connectionStatusText = connectionStatusDiv?.querySelector('.text');
    const studentGrid = document.getElementById('student-grid');
    const studentCardTemplate = document.getElementById('student-card-template');
    const loadingPlaceholder = document.getElementById('loading-placeholder');
    const noStudentsPlaceholder = document.getElementById('no-students-placeholder');
    const selectAllCheckbox = document.getElementById('select-all-students');
    const selectedCountSpan = document.getElementById('selected-count');

    // Modals
    const openTabModal = document.getElementById('open-tab-modal');
    const announceModal = document.getElementById('announce-modal');
    const studentDetailModal = document.getElementById('student-detail-modal');

    // --- State ---
    let teacherSocket = null;
    let connectedStudents = new Map(); // clientId -> studentData object
    let selectedStudentIds = new Set();
    let reconnectAttempts = 0;
    let currentView = 'screens'; // Default view

    // --- WebSocket Handling ---
    function connectWebSocket() {
        if (teacherSocket && (teacherSocket.readyState === WebSocket.OPEN || teacherSocket.readyState === WebSocket.CONNECTING)) {
            console.log("WS: Already connected or connecting.");
            return;
        }

        updateConnectionStatus('connecting', 'Connecting...');
        console.log(`WS: Attempting connection to ${WS_URL}...`);
        teacherSocket = new WebSocket(WS_URL);

        teacherSocket.onopen = () => {
            console.log("WS: Connection established.");
            updateConnectionStatus('connected', 'Connected');
            reconnectAttempts = 0;
            sendMessageToServer({ type: 'teacher_connect', data: { teacherId: 'YOUR_TEACHER_ID' } }); // Identify as teacher
            // Request initial student list or state from server
            sendMessageToServer({ type: 'request_initial_state' });
        };

        teacherSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleServerMessage(message);
            } catch (error) {
                console.error("WS: Error parsing message:", error, event.data);
            }
        };

        teacherSocket.onerror = (error) => {
            console.error("WS: Error:", error);
            // onclose will handle reconnect logic
        };

        teacherSocket.onclose = (event) => {
            console.log(`WS: Connection closed (Code: ${event.code}, Reason: ${event.reason || 'N/A'})`);
            teacherSocket = null;
            markAllStudentsDisconnected(); // Update UI
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                updateConnectionStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
                setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
            } else {
                console.error("WS: Max reconnect attempts reached.");
                updateConnectionStatus('disconnected', 'Reconnect Failed');
            }
        };
    }

    function sendMessageToServer(payload) {
        if (teacherSocket && teacherSocket.readyState === WebSocket.OPEN) {
            try {
                teacherSocket.send(JSON.stringify(payload));
            } catch (error) {
                console.error("WS: Send error:", error);
            }
        } else {
            console.warn("WS: Not connected. Message not sent:", payload);
            // Maybe queue message or show error?
        }
    }

    function updateConnectionStatus(status, text) {
        if (connectionStatusDiv && connectionStatusText) {
            connectionStatusDiv.className = `status-indicator ${status}`;
            connectionStatusText.textContent = text;
        }
    }

    // --- Server Message Handler (Placeholder) ---
    function handleServerMessage(message) {
        const { type, data, clientId } = message; // Assuming server includes clientId
        // console.log(`WS: Received [${type}]`, data);

        switch (type) {
            case 'initial_state': // Example: Server sends list of currently connected students
                connectedStudents.clear();
                if (data && Array.isArray(data.students)) {
                    data.students.forEach(student => connectedStudents.set(student.clientId, student));
                }
                renderStudentGrid();
                break;
            case 'student_connected':
                if (clientId && data) {
                    connectedStudents.set(clientId, { ...data, status: 'connected' });
                    upsertStudentCard(clientId, connectedStudents.get(clientId));
                    updateNoStudentsPlaceholder();
                }
                break;
            case 'student_disconnected':
                if (clientId) {
                    const student = connectedStudents.get(clientId);
                    if (student) {
                        student.status = 'disconnected';
                         updateStudentCard(clientId, student); // Update visual status
                        // Optionally remove card after a delay or keep it greyed out
                        // connectedStudents.delete(clientId);
                        // removeStudentCard(clientId);
                    }
                     if (selectedStudentIds.has(clientId)) {
                         selectedStudentIds.delete(clientId);
                         updateSelectionUI();
                     }
                     updateNoStudentsPlaceholder();
                }
                break;
            case 'student_update': // Generic update (tabs, screenshot URL, etc.)
                if (clientId && data) {
                    const student = connectedStudents.get(clientId);
                    if (student) {
                        // Selectively update student data
                        Object.assign(student, data);
                        student.lastUpdate = Date.now();
                        updateStudentCard(clientId, student);
                    }
                }
                break;
             case 'student_locked':
                  if (clientId) {
                     const student = connectedStudents.get(clientId);
                     if(student) { student.status = 'locked'; updateStudentCard(clientId, student); }
                  }
                 break;
             case 'student_unlocked':
                  if (clientId) {
                     const student = connectedStudents.get(clientId);
                     if(student) { student.status = 'connected'; updateStudentCard(clientId, student); }
                  }
                 break;
            case 'command_ack': // Acknowledge command success
                console.log(`CMD ACK: ${data?.command} for ${data?.targetClientId}`);
                break;
            case 'command_error': // Report command failure
                console.error(`CMD FAIL: ${data?.command} for ${data?.targetClientId}: ${data?.error}`);
                alert(`Command failed for student ${data?.targetClientId || 'Unknown'}: ${data?.error}`);
                break;
            // Add more handlers for timeline events, reports data, etc.
            default:
                console.warn(`WS: Unhandled message type: ${type}`);
        }
    }

    // --- UI Rendering ---
    function renderStudentGrid() {
        studentGrid.innerHTML = ''; // Clear existing
        if (connectedStudents.size === 0) {
             updateNoStudentsPlaceholder();
            return;
        }
        loadingPlaceholder.classList.add('hidden');
        noStudentsPlaceholder.classList.add('hidden');

        // Add filtering/sorting logic here if needed before iterating
        connectedStudents.forEach((studentData, clientId) => {
            upsertStudentCard(clientId, studentData);
        });
         updateSelectionUI();
    }

    function upsertStudentCard(clientId, studentData) {
        let card = studentGrid.querySelector(`.student-card[data-client-id="${clientId}"]`);
        if (!card) {
            if (!studentCardTemplate) return;
            card = studentCardTemplate.content.cloneNode(true).querySelector('.student-card');
            card.dataset.clientId = clientId;
            studentGrid.appendChild(card);

            // Add event listeners for new cards
             card.querySelector('.screenshot-container').addEventListener('click', () => showStudentDetail(clientId));
             card.querySelector('.student-select').addEventListener('change', handleStudentSelectChange);
             card.querySelector('.close-tab-btn').addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent card click
                const activeTabId = studentData.activeTab?.id; // Need to store active tab ID on studentData
                 if (activeTabId && confirm(`Close active tab for ${studentData.name || clientId}?`)) {
                    sendStudentCommand(clientId, 'close_tab', { tabId: activeTabId });
                 } else if (!activeTabId) {
                    alert('No active tab identified to close.');
                 }
             });
             // Add listener for card menu button if implementing dropdown
        }
        updateStudentCard(clientId, studentData, card); // Update content
    }

     function updateStudentCard(clientId, studentData, cardElement = null) {
         const card = cardElement || studentGrid.querySelector(`.student-card[data-client-id="${clientId}"]`);
         if (!card) return;

         card.dataset.status = studentData.status || 'disconnected'; // For CSS styling

         const nameEl = card.querySelector('.student-name');
         const statusDot = card.querySelector('.status-dot');
         const screenshotImg = card.querySelector('.screenshot-img');
         const noScreenshotOverlay = card.querySelector('.no-screenshot-overlay');
         const lastUpdatedEl = card.querySelector('.last-updated');
         const faviconEl = card.querySelector('.favicon');
         const tabTitleEl = card.querySelector('.tab-title');
         const lockOverlay = card.querySelector('.card-lock-overlay');
         const selectCheckbox = card.querySelector('.student-select');

         nameEl.textContent = studentData.name || studentData.email || `ID: ${clientId.substring(0, 6)}`;
         selectCheckbox.checked = selectedStudentIds.has(clientId);

          // Status Dot is handled by CSS using data-status attribute

         // Screenshot
          if (studentData.screenshotUrl) {
              screenshotImg.src = studentData.screenshotUrl;
              screenshotImg.style.display = 'block';
              noScreenshotOverlay.classList.add('hidden');
          } else {
              screenshotImg.style.display = 'none'; // Hide broken image
               screenshotImg.src = 'placeholder.png'; // Reset placeholder
              noScreenshotOverlay.classList.remove('hidden');
          }
         lastUpdatedEl.textContent = studentData.lastUpdate ? `Updated: ${new Date(studentData.lastUpdate).toLocaleTimeString()}` : 'Never';

         // Active Tab
         const activeTab = studentData.activeTab || null; // Assuming server sends { id, title, url, favIconUrl }
          if (activeTab) {
              faviconEl.src = activeTab.favIconUrl || 'favicon.png';
              tabTitleEl.textContent = activeTab.title || 'Untitled Tab';
              tabTitleEl.title = activeTab.url || '';
          } else {
              faviconEl.src = 'favicon.png';
              tabTitleEl.textContent = 'No active tab';
              tabTitleEl.title = '';
          }
           faviconEl.onerror = () => { faviconEl.src = 'favicon.png'; }; // Fallback for broken favicons

           // Lock Overlay
           lockOverlay.classList.toggle('hidden', studentData.status !== 'locked');
     }

    function removeStudentCard(clientId) {
        const card = studentGrid.querySelector(`.student-card[data-client-id="${clientId}"]`);
        if (card) card.remove();
    }

    function markAllStudentsDisconnected() {
        connectedStudents.forEach((student, clientId) => {
            student.status = 'disconnected';
            updateStudentCard(clientId, student);
        });
        // Clear selection as students are effectively gone
        selectedStudentIds.clear();
        updateSelectionUI();
         updateNoStudentsPlaceholder();
    }

     function updateNoStudentsPlaceholder() {
         const hasActiveStudents = Array.from(connectedStudents.values()).some(s => s.status !== 'disconnected');
         loadingPlaceholder.classList.add('hidden'); // Hide loading once we know state
         noStudentsPlaceholder.classList.toggle('hidden', connectedStudents.size > 0); // Show if map is empty
         // Optionally, show "No ACTIVE students" if map has only disconnected ones
     }


    // --- Selection Handling ---
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
         updateSelectionUI();
     }

     selectAllCheckbox?.addEventListener('change', () => {
         const isChecked = selectAllCheckbox.checked;
         selectedStudentIds.clear(); // Clear previous selection

         if (isChecked) {
              // Select only currently visible/active students if filtering is applied
              // Or select all known students
              studentGrid.querySelectorAll('.student-card').forEach(card => {
                  const clientId = card.dataset.clientId;
                  if(clientId) selectedStudentIds.add(clientId); // Add all currently rendered students
              });
         }

         // Update individual checkboxes
         studentGrid.querySelectorAll('.student-select').forEach(cb => {
             cb.checked = isChecked;
         });
         updateSelectionUI();
     });

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

    // --- Sidebar & View Switching ---
    sidebarToggle?.addEventListener('click', () => {
        body.classList.toggle('sidebar-collapsed');
    });

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = item.dataset.view;
            if (!targetView || targetView === currentView) return;

            switchView(targetView);
        });
    });

    function switchView(viewId) {
        currentView = viewId;
        // Update Nav Highlight
        navItems.forEach(nav => {
            nav.classList.toggle('active', nav.dataset.view === viewId);
        });
        // Update Title
        viewTitle.textContent = document.querySelector(`.nav-item[data-view="${viewId}"] span`)?.textContent || 'Dashboard';
        // Show/Hide Views
        views.forEach(view => {
            view.classList.toggle('active', view.id === `${viewId}-view`);
        });
        console.log(`Switched view to: ${viewId}`);
         // Add logic to load data for the new view if necessary (e.g., fetch timeline data)
    }

    // --- Modal Handling ---
    function showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal?.classList.remove('hidden');
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        modal?.classList.add('hidden');
        // Reset modal fields if necessary
        resetModalFields(modalId);
    }

     function resetModalFields(modalId) {
         switch (modalId) {
             case 'open-tab-modal':
                 document.getElementById('open-tab-url').value = '';
                 break;
             case 'announce-modal':
                  document.getElementById('announce-message').value = '';
                  document.getElementById('announce-duration').value = '10';
                 break;
             // Add resets for other modals
         }
     }

    // Add listeners for elements that open modals
    document.getElementById('open-tab-selected')?.addEventListener('click', () => showModal('open-tab-modal'));
    document.getElementById('announce-selected')?.addEventListener('click', () => showModal('announce-modal'));

    // Add listeners for modal close buttons (using event delegation)
    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('close-modal-btn')) {
            const modalId = event.target.dataset.modalId;
            if (modalId) closeModal(modalId);
        }
        // Close modal if clicking outside content
        if (event.target.classList.contains('modal')) {
             closeModal(event.target.id);
        }
    });

    // Add listeners for modal confirmation buttons
     document.getElementById('confirm-open-tab')?.addEventListener('click', () => {
         const url = document.getElementById('open-tab-url').value;
         if (url && selectedStudentIds.size > 0) {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                alert('Please enter a valid URL starting with http:// or https://');
                return;
            }
            sendBulkCommand('open_tab', { url });
            closeModal('open-tab-modal');
         } else if(selectedStudentIds.size === 0) {
             alert("No students selected.");
         }
     });
     document.getElementById('confirm-announce')?.addEventListener('click', () => {
          const message = document.getElementById('announce-message').value;
          const duration = parseInt(document.getElementById('announce-duration').value, 10) * 1000; // Convert s to ms
          if (message && duration && selectedStudentIds.size > 0) {
              sendBulkCommand('send_announcement', { message, duration });
              closeModal('announce-modal');
          } else if (selectedStudentIds.size === 0) {
              alert("No students selected.");
          }
     });


    // --- Student Detail Modal ---
    function showStudentDetail(clientId) {
         const student = connectedStudents.get(clientId);
         if (!student || !studentDetailModal) return;

         console.log("Showing detail for:", clientId);
         document.getElementById('detail-student-name').textContent = student.name || student.email || `ID: ${clientId}`;
         // Add logic to populate screenshot, tabs, activity log etc. from studentData
         const screenshotEl = document.getElementById('detail-screenshot');
         screenshotEl.src = student.screenshotUrl || 'placeholder.png';

          const activeTabEl = document.getElementById('detail-active-tab');
          activeTabEl.textContent = student.activeTab?.title || 'N/A';

          const tabListEl = document.getElementById('detail-tab-list');
          tabListEl.innerHTML = ''; // Clear previous
          if(student.tabs && Object.keys(student.tabs).length > 0) {
                Object.values(student.tabs).forEach(tab => {
                    const li = document.createElement('li');
                    li.textContent = `${tab.title || 'Untitled'} (${tab.url || 'No URL'})`;
                    // Add close button for each tab?
                    tabListEl.appendChild(li);
                });
          } else {
               tabListEl.innerHTML = '<li>No tabs reported.</li>';
          }

          // Populate activity log (placeholder)
          document.getElementById('detail-activity-log').innerHTML = '<li>Activity Log Placeholder</li>';


         studentDetailModal.dataset.viewingClientId = clientId; // Store ID for actions
         showModal('student-detail-modal');
         // Request fresh data for this student?
         // sendStudentCommand(clientId, 'get_details', {});
    }

     // Add listeners for actions WITHIN the detail modal (delegate if needed)


    // --- Action Sending ---
    function sendStudentCommand(clientId, command, data = {}) {
        console.log(`Sending command [${command}] to ${clientId}`, data);
        sendMessageToServer({
            type: 'teacher_command',
            payload: {
                targetClientId: clientId,
                command: command,
                data: data
            }
        });
        // Add optimistic UI updates here if desired (e.g., show "locking..." overlay)
    }

    function sendBulkCommand(command, data = {}) {
        const targetIds = Array.from(selectedStudentIds);
        if (targetIds.length === 0) {
            console.warn("Bulk command attempted with no selection.");
            return;
        }
        console.log(`Sending bulk command [${command}] to ${targetIds.length} students`, data);
         // Option 1: Send one message per student (might be better for server processing)
          targetIds.forEach(clientId => {
              sendStudentCommand(clientId, command, data);
          });
         // Option 2: Send a single message with multiple targets (requires server support)
         /*
         sendMessageToServer({
             type: 'teacher_bulk_command',
             payload: {
                 targetClientIds: targetIds,
                 command: command,
                 data: data
             }
         });
         */
         // Add optimistic UI updates for all selected students
    }

    // --- Toolbar Action Listeners ---
    document.getElementById('lock-selected')?.addEventListener('click', () => sendBulkCommand('lock_screen', { message: "Screen Locked" }));
    document.getElementById('unlock-selected')?.addEventListener('click', () => sendBulkCommand('unlock_screen'));
    // Open Tab and Announce handled by modal confirmations
     document.getElementById('close-tab-selected')?.addEventListener('click', () => {
         if (confirm(`Close the active tab for all ${selectedStudentIds.size} selected students?`)) {
              // Need server support or client-side logic to know active tab ID for each student
              // This simplified version sends a generic command; server/client needs context
              sendBulkCommand('close_active_tab', {}); // Server/Client must interpret this
              alert("Close command sent. Individual success depends on student state.");
         }
     });
     document.getElementById('block-site-selected')?.addEventListener('click', () => {
         const blocklistString = prompt("Enter block patterns (one per line, e.g., *://*.coolmathgames.com/*):");
         if (blocklistString !== null) { // Check if prompt wasn't cancelled
             const blockedSites = blocklistString.split('\n').map(s => s.trim()).filter(s => s.length > 0);
             sendBulkCommand('update_blocklist', { blockedSites });
         }
     });
    document.getElementById('focus-selected')?.addEventListener('click', () => {
         const url = prompt("Enter URL to focus selected students on:");
         if (url && url.trim()) {
             if (!url.startsWith('http://') && !url.startsWith('https://')) {
                 alert('Please enter a valid URL starting with http:// or https://');
                 return;
             }
              sendBulkCommand('focus_tab', { url: url.trim() }); // Client needs to handle this command
         }
    });


    // --- Initial Setup ---
    function initializeDashboard() {
        console.log("Setting up UI and connecting...");
        // Set initial view
        switchView(currentView);
         // Check initial window size for sidebar
         if (window.innerWidth <= 768) {
              body.classList.add('sidebar-collapsed');
         }
         updateSelectionUI(); // Initialize button states
         updateNoStudentsPlaceholder(); // Show initial placeholder
        connectWebSocket();
    }

    initializeDashboard();
});
