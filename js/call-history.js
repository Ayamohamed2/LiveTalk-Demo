// Configuration
const API_BASE = "https://livetalk.runasp.net/api";

// Global Variables
let allCalls = [];
let filteredCalls = [];
let currentFilter = 'all';
let selectedCallDetails = null;

// Get tokens
function getAccessToken() {
    return localStorage.getItem("accessToken");
}

function checkAuth() {
    const token = getAccessToken();
    if (!token) {
        window.location.href = "index.html";
        return false;
    }
    return true;
}

// Initialize
document.addEventListener("DOMContentLoaded", async () => {
    if (!checkAuth()) return;

    console.log("Initializing call history page...");
    
    setupEventListeners();
    await loadCallHistory();
});

// Setup Event Listeners
function setupEventListeners() {
    // Back button
    const backBtn = document.getElementById("backBtn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            window.location.href = "chat.html";
        });
    }

    // Clear history button
    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener("click", clearAllHistory);
    }

    // Filter tabs
    const filterTabs = document.querySelectorAll(".filter-tab");
    filterTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            // Remove active class from all tabs
            filterTabs.forEach(t => t.classList.remove("active"));
            
            // Add active class to clicked tab
            tab.classList.add("active");
            
            // Apply filter
            currentFilter = tab.dataset.filter;
            applyFilter(currentFilter);
        });
    });

    // Modal close button
    const closeModalBtn = document.querySelector(".close-modal");
    if (closeModalBtn) {
        closeModalBtn.addEventListener("click", closeModal);
    }

    // Click outside modal to close
    const modal = document.getElementById("callDetailsModal");
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }

    // Modal action buttons
    const callBackBtn = document.getElementById("callBackBtn");
    const videoCallBackBtn = document.getElementById("videoCallBackBtn");
    const deleteCallBtn = document.getElementById("deleteCallBtn");

    if (callBackBtn) {
        callBackBtn.addEventListener("click", () => makeCall(0));
    }

    if (videoCallBackBtn) {
        videoCallBackBtn.addEventListener("click", () => makeCall(1));
    }

    if (deleteCallBtn) {
        deleteCallBtn.addEventListener("click", deleteCallLog);
    }
}

// Load Call History
async function loadCallHistory() {
    try {
        showLoading(true);

        const response = await fetch(`${API_BASE}/Call/GetCallHistory`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (response.ok) {
            allCalls = await response.json();
            console.log("Loaded call history:", allCalls);
            
            if (allCalls.length === 0) {
                showEmptyState(true);
            } else {
                showEmptyState(false);
                applyFilter(currentFilter);
            }
        } else {
            console.error("Failed to load call history. Status:", response.status);
            showError("Failed to load call history");
        }

    } catch (error) {
        console.error("Error loading call history:", error);
        showError("Error connecting to server");
    } finally {
        showLoading(false);
    }
}

// Apply Filter
function applyFilter(filter) {
    console.log("Applying filter:", filter);

    if (filter === 'all') {
        filteredCalls = [...allCalls];
    } else if (filter === 'incoming') {
        filteredCalls = allCalls.filter(call => call.isIncoming);
    } else if (filter === 'outgoing') {
        filteredCalls = allCalls.filter(call => call.isOutgoing);
    } 

    console.log(`Filtered calls (${filter}):`, filteredCalls.length);
    renderCallHistory(filteredCalls);
}

// Render Call History
function renderCallHistory(calls) {
    const listElement = document.getElementById("callHistoryList");
    listElement.innerHTML = '';

    if (calls.length === 0) {
        showEmptyState(true);
        return;
    }

    showEmptyState(false);

    // Group calls by date
    const groupedCalls = groupCallsByDate(calls);

    // Render each group
    Object.keys(groupedCalls).forEach(date => {
        // Add date divider
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.textContent = date;
        listElement.appendChild(divider);

        // Add calls for this date
        groupedCalls[date].forEach(call => {
            const callItem = createCallItem(call);
            listElement.appendChild(callItem);
        });
    });
}

// Group Calls By Date
function groupCallsByDate(calls) {
    const groups = {};

    calls.forEach(call => {
        const date = formatDateGroup(new Date(call.startedAt));
        
        if (!groups[date]) {
            groups[date] = [];
        }
        
        groups[date].push(call);
    });

    return groups;
}

// Create Call Item
function createCallItem(call) {
    const item = document.createElement('div');
    item.className = 'call-item';
    
   

    // Determine name
    const name = call.isIncoming ? call.callerName : call.receiverName;
    const initial = name ? name.charAt(0).toUpperCase() : 'U';

    // Determine call type icon
    const typeIcon = call.callType === 1 ? 
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>' :
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>';

    // Determine status badge
    let statusBadge = '';
    let statusClass = '';
    
    if (call.isIncoming) {
        statusClass = 'incoming';
        statusBadge = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>';
    } else {
        statusClass = 'outgoing';
        statusBadge = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>';
    }

    // Format duration
    const duration = formatDuration(call.duration);
    const time = formatTime(new Date(call.startedAt));

    // Determine call details text
    let detailsText = '';
    if (call.callStatus === 4) {
        detailsText = 'Missed';
    } else if (call.callStatus === 3) {
        detailsText = 'Declined';
    } else if (call.callStatus === 5) {
        detailsText = 'Busy';
    } else {
        detailsText = call.isIncoming ? 'Incoming' : 'Outgoing';
    }

    item.innerHTML = `
        <div class="call-icon">
            ${initial}
            <div class="status-badge ${statusClass}">
                ${statusBadge}
            </div>
        </div>
        <div class="call-info">
            <div class="call-name">${name}</div>
            <div class="call-details">
                <span class="call-type-icon">${typeIcon}</span>
                <span>${detailsText}</span>
            </div>
        </div>
        <div class="call-time">
            <div class="call-date">${time}</div>
            ${duration !== '00:00' ? `<div class="call-duration">${duration}</div>` : ''}
        </div>
    `;

    // Add click event to show details
    item.addEventListener('click', () => showCallDetails(call));

    return item;
}

// Show Call Details Modal
function showCallDetails(call) {
    selectedCallDetails = call;

    const modal = document.getElementById("callDetailsModal");
    const name = call.isIncoming ? call.callerName : call.receiverName;
    const initial = name ? name.charAt(0).toUpperCase() : 'U';

    // Update modal content
    document.getElementById("detailInitial").textContent = initial;
    document.getElementById("detailName").textContent = name;
    document.getElementById("detailType").textContent = call.callType === 1 ? '📹 Video Call' : '📞 Voice Call';
    
    // Update status
    let statusText = '';
    switch(call.callStatus) {
        case 0: statusText = 'Ringing'; break;
        case 1: statusText = 'Active'; break;
        case 2: statusText = 'Completed'; break;
        case 3: statusText = 'Declined'; break;
        case 4: statusText = 'Missed'; break;
        case 5: statusText = 'Busy'; break;
        default: statusText = 'Unknown';
    }
    document.getElementById("detailStatus").textContent = statusText;

    // Update direction
    document.getElementById("detailDirection").textContent = call.isIncoming ? 'Incoming' : 'Outgoing';

    // Update duration
    document.getElementById("detailDuration").textContent = formatDuration(call.duration);

    // Update date and time
    const callDate = new Date(call.startedAt);
    document.getElementById("detailDate").textContent = formatFullDate(callDate);
    document.getElementById("detailTime").textContent = formatTime(callDate);

    // Show modal
    modal.style.display = 'flex';
}

// Close Modal
function closeModal() {
    const modal = document.getElementById("callDetailsModal");
    modal.style.display = 'none';
    selectedCallDetails = null;
}

// Make Call from Modal
function makeCall(callType) {
    if (!selectedCallDetails) return;

    const userId = selectedCallDetails.isIncoming ? selectedCallDetails.callerId : selectedCallDetails.receiverId;
    const userName = selectedCallDetails.isIncoming ? selectedCallDetails.callerName : selectedCallDetails.receiverName;

    console.log(`Making ${callType === 1 ? 'video' : 'voice'} call to:`, userName);

    const width = callType === 1 ? 1000 : 800;
    const height = callType === 1 ? 700 : 600;

    const callWindow = window.open(
        `call.html?receiverId=${userId}&receiverName=${encodeURIComponent(userName)}&callType=${callType}`,
        'CallWindow',
        `width=${width},height=${height},resizable=yes,scrollbars=no,status=no,toolbar=no,menubar=no,location=no`
    );

    if (!callWindow) {
        alert("Please allow popups to make calls.");
    }

    closeModal();
}

// Delete Call Log
async function deleteCallLog() {
    if (!selectedCallDetails) return;

    if (!confirm(`Are you sure you want to delete this call from history?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/Call/DeleteCallLog/${selectedCallDetails.id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (response.ok) {
            console.log("Call log deleted successfully");
            
            // Remove from arrays
            allCalls = allCalls.filter(c => c.id !== selectedCallDetails.id);
            
            // Reapply filter
            applyFilter(currentFilter);
            
            closeModal();
        } else {
            console.error("Failed to delete call log. Status:", response.status);
            alert("Failed to delete call log");
        }

    } catch (error) {
        console.error("Error deleting call log:", error);
        alert("Error deleting call log");
    }
}

// Clear All History
async function clearAllHistory() {
    if (!confirm("Are you sure you want to clear all call history? This action cannot be undone.")) {
        return;
    }

    try {
        showLoading(true);

        // Delete all calls one by one
        const deletePromises = allCalls.map(call => 
            fetch(`${API_BASE}/Call/DeleteCallLog/${call.id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${getAccessToken()}`
                }
            })
        );

        await Promise.all(deletePromises);

        console.log("All call history cleared");
        
        allCalls = [];
        filteredCalls = [];
        
        showEmptyState(true);
        renderCallHistory([]);

    } catch (error) {
        console.error("Error clearing call history:", error);
        alert("Error clearing call history");
    } finally {
        showLoading(false);
    }
}

// Utility Functions
function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '00:00';
    
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTime(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function formatDateGroup(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Reset time to compare dates only
    today.setHours(0, 0, 0, 0);
    yesterday.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);

    if (compareDate.getTime() === today.getTime()) {
        return 'Today';
    } else if (compareDate.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    } else if (isThisWeek(date)) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    } else {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }
}

function formatFullDate(date) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function isThisWeek(date) {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return date >= weekStart && date <= weekEnd;
}

function showLoading(show) {
    const loadingIndicator = document.getElementById("loadingIndicator");
    loadingIndicator.style.display = show ? 'flex' : 'none';
}

function showEmptyState(show) {
    const emptyState = document.getElementById("emptyState");
    emptyState.style.display = show ? 'flex' : 'none';
}

function showError(message) {
    alert(message);
}

console.log("✅ Call history script loaded successfully!");