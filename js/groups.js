// ==================== Configuration ====================
const API_BASE = "https://livetalk.runasp.net/api";
const HUB_URL = "https://livetalk.runasp.net/chat";
const MEDIA_BASE = "https://livetalk.runasp.net";

// ==================== Global Variables ====================
let connection = null;
let currentUserId = null;
let currentGroupId = null;
let currentGroupName = null;
let currentGroupImage = null;
let isAdmin = false;
let groupsList = [];
let groupTypingUsers = new Map();
let selectedUsersToAdd = new Set();
let allUsersForAdding = [];
let replyToMessage = null;
let typingTimeout = null;
let isTyping = false;

// ⭐ NEW: Unread count tracking
let unreadCounts = {};

// Voice Recording Variables
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let isRecording = false;

// ==================== Authentication ====================
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

// ==================== Initialize ====================
document.addEventListener("DOMContentLoaded", async () => {
    if (!checkAuth()) return;

    console.log("🚀 Starting Groups initialization...");

    const token = getAccessToken();
    const payload = JSON.parse(atob(token.split('.')[1]));
    currentUserId = payload.sub || payload.nameid;
    console.log("Current User ID:", currentUserId);

    await connectSignalR();
    setupEventListeners();
    await loadGroupsList();
});

// ==================== SignalR Connection ====================
async function connectSignalR() {
    try {
        console.log("📡 Connecting to Chat Hub...");
        
        connection = new signalR.HubConnectionBuilder()
            .withUrl(`${HUB_URL}?access_token=${getAccessToken()}`, {
                skipNegotiation: true,
                transport: signalR.HttpTransportType.WebSockets
            })
            .configureLogging(signalR.LogLevel.Information)
            .withAutomaticReconnect()
            .build();

        setupSignalREvents();
        await connection.start();
        console.log("✅ Connected to Chat Hub!");
        
    } catch (error) {
        console.error("❌ Error connecting:", error);
        setTimeout(connectSignalR, 5000);
    }
}

// ==================== SignalR Events ====================
function setupSignalREvents() {
    // Receive group message
    connection.on("ReceiveGroupMessage", (message) => {
    console.log("📨 Group message received:", message);
    if (currentGroupId === message.groupId) {
        displayGroupMessage(message);
    } else {
        // Update unread count for other groups
        fetchUnreadCount(message.groupId);
    }
    loadGroupsList();

    });

    // Typing indicators
    connection.on("UserStartedTyping", (data) => {
        if (currentGroupId === data.groupId && data.userId !== currentUserId) {
            if (!groupTypingUsers.has(data.groupId)) {
                groupTypingUsers.set(data.groupId, new Set());
            }
            groupTypingUsers.get(data.groupId).add(data.userName);
            updateTypingIndicator();
        }
    });

    connection.on("UserStoppedTyping", (data) => {
        if (currentGroupId === data.groupId) {
            if (groupTypingUsers.has(data.groupId)) {
                groupTypingUsers.get(data.groupId).delete(data.userName);
                updateTypingIndicator();
            }
        }
    });

    // Member events
    connection.on("MemberJoined", (data) => {
        if (currentGroupId === data.groupId) {
            showSystemMessage(`${data.userName} joined the group`);
        }
        loadGroupsList();
    });

    connection.on("MembersAdded", (data) => {
        if (currentGroupId === data.groupId) {
            const names = data.members.map(m => m.userName).join(", ");
            showSystemMessage(`${names} added to the group`);
        }
        loadGroupsList();
    });

    connection.on("MemberRemoved", (data) => {
        if (currentGroupId === data.groupId) {
            console.log(data);
            showSystemMessage(`${data.userName} was removed from the group`);
            if (data.userId === currentUserId) {
                alert(`You have been removed from ${data.groupName}`);
                backToGroupsList();
            }
        }
        loadGroupsList();
    });

    connection.on("RemovedFromGroup", (data) => {
        alert(`You have been removed from ${data.groupName}`);
        if (currentGroupId === data.groupId) {
            backToGroupsList();
        }
        loadGroupsList();
    });

    connection.on("MemberLeft", (data) => {
        if (currentGroupId === data.groupId) {
            showSystemMessage(`${data.userName} left the group`);
        }
        loadGroupsList();
    });

    connection.on("GroupInfoUpdated", (data) => {
        if (currentGroupId === data.groupId) {
            currentGroupName = data.name;
            currentGroupImage = data.imageUrl;
            document.getElementById("chatGroupName").textContent = data.name;
            showSystemMessage(`Group information was updated`);
        }
        loadGroupsList();
    });

    connection.on("MessageRead", (data) => {
        updateMessageReadStatus(data.messageId, data.userName);
    });

    // Message deleted for everyone
    connection.on("MessageDeletedForEveryone", (data) => {
        console.log("🗑️ Message deleted:", data);
        const msg = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (msg) {
            msg.innerHTML = `
                <div class="message-deleted" style="font-style: italic; color: #5B9BD5; padding: 8px;">
                    <em>🚫 This message was deleted</em>
                </div>
            `;
            msg.classList.add('deleted');
        }
    });

    connection.onreconnected(async () => {
        console.log("🔄 Reconnected");
        await loadGroupsList();
    });
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    document.getElementById("logoutBtn").addEventListener("click", handleLogout);
    document.getElementById("backToChats").addEventListener("click", () => {
        window.location.href = "chat.html";
    });
    document.getElementById("backBtn").addEventListener("click", backToGroupsList);
    
    document.getElementById("createGroupBtn").addEventListener("click", () => openModal("createGroupModal"));
    document.getElementById("joinGroupBtn").addEventListener("click", () => openModal("joinGroupModal"));
    document.getElementById("groupInfoBtn").addEventListener("click", loadGroupInfo);
    document.getElementById("viewMembersBtn").addEventListener("click", loadGroupMembers);
    document.getElementById("addMembersBtn").addEventListener("click", () => {
        openModal("addMembersModal");
        loadUsersToAdd();
    });
    document.getElementById("leaveGroupBtn").addEventListener("click", leaveGroup);
    document.getElementById("clearChatBtn").addEventListener("click", clearGroupChat);

    document.getElementById("createGroupForm").addEventListener("submit", createGroup);
    document.getElementById("joinGroupForm").addEventListener("submit", joinGroup);
    document.getElementById("confirmAddMembers").addEventListener("click", addMembers);
    document.getElementById("cancelReply").addEventListener("click", cancelReply);

    document.getElementById("searchMembersToAdd").addEventListener("input", filterUsersToAdd);
    document.getElementById("searchGroups").addEventListener("input", handleSearch);

    document.getElementById("messageInput").addEventListener("input", handleTypingStart);
    document.getElementById("messageInput").addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById("sendBtn").addEventListener("click", sendMessage);
    
    // Voice recording events
    const voiceBtn = document.getElementById("voiceRecordBtn");
    voiceBtn.addEventListener("mousedown", startVoiceRecording);
    voiceBtn.addEventListener("mouseup", stopAndSendVoice);
    voiceBtn.addEventListener("mouseleave", cancelIfRecording);
    voiceBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startVoiceRecording(); });
    voiceBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopAndSendVoice(); });
    voiceBtn.addEventListener("touchcancel", (e) => { e.preventDefault(); cancelIfRecording(); });
    
    document.getElementById("attachBtn").addEventListener("click", toggleAttachMenu);
    document.getElementById("fileInput").addEventListener("change", handleFileSelect);
    document.getElementById("imageBtn").addEventListener("click", () => {
        document.getElementById("fileInput").accept = "image/*";
        document.getElementById("fileInput").click();
    });
    document.getElementById("videoBtn").addEventListener("click", () => {
        document.getElementById("fileInput").accept = "video/*";
        document.getElementById("fileInput").click();
    });
}
// Fetch unread count for a specific group
async function fetchUnreadCount(groupId) {
    try {
        const response = await fetch(`${API_BASE}/Group/UnreadCount/${groupId}`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            const data = await response.json();
            unreadCounts[groupId] = data.unreadCount || 0;
            updateGroupUnreadBadge(groupId, data.unreadCount);
        }
    } catch (error) {
        console.error("Error fetching unread count:", error);
    }
}

// ⭐ NEW: Update unread count badge in UI
function updateGroupUnreadBadge(groupId, count) {
    const groupItem = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
    if (!groupItem) return;

    let badge = groupItem.querySelector('.unread-badge');
    
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'unread-badge';
            groupItem.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
    } else {
        if (badge) badge.remove();
    }
}

// ⭐ NEW: Update unread count when receiving message
async function updateUnreadCount(groupId) {
    if (!unreadCounts[groupId]) {
        unreadCounts[groupId] = 0;
    }
    unreadCounts[groupId]++;
    updateGroupUnreadBadge(groupId, unreadCounts[groupId]);
}

// ==================== Load Groups List ====================
async function loadGroupsList() {
    try {
        const response = await fetch(`${API_BASE}/Group/MyGroups`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            groupsList = await response.json();
            
            // Fetch unread counts for all groups
            for (const group of groupsList) {
                await fetchUnreadCount(group.id);
            }
            
            displayGroupsList();
        }
    } catch (error) {
        console.error("Error loading groups:", error);
    }
}

function displayGroupsList() {
    const container = document.getElementById("groupsList");
    
    if (!groupsList || groupsList.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #8696a0;">
                <p>No groups yet</p>
                <p style="font-size: 12px;">Create or join a group to get started</p>
            </div>
        `;
        return;
    }

    container.innerHTML = groupsList.map(group => {
        const lastMessage = group.lastMessage;
        const lastMessageText = lastMessage ? 
            (lastMessage.type === 0 ? lastMessage.text : `📎 Media`) : 
            "No messages yet";
        const lastMessageTime = lastMessage ? formatMessageTime(lastMessage.createdAt) : "";

        return `
            <div class="group-item user-item" data-group-id="${group.id}" onclick="openGroup(${group.id}, '${escapeHtml(group.name)}', '${group.imageUrl || ''}', ${group.isAdmin})">
                ${group.imageUrl ? 
                    `<img src="${group.imageUrl}" alt="${group.name}" class="user-avatar">` : 
                    `<div class="user-avatar">${group.name.charAt(0).toUpperCase()}</div>`
                }
                <div class="user-info">
                    <div class="user-name-row">
                        <h4>${escapeHtml(group.name)}</h4>
                        ${group.isAdmin ? '<span class="group-badge">Admin</span>' : ''}
                    </div>
                    
                </div>
              <div class="user-meta">
    ${(unreadCounts[group.id] || 0) > 0 ? `<span class="unread-badge">${unreadCounts[group.id] > 99 ? '99+' : unreadCounts[group.id]}</span>` : ''}
    <div style="font-size: 11px; color: #8696a0;">${group.membersCount} members</div>
</div>
            </div>
        `;
    }).join('');
}

// ==================== Open Group ====================
async function openGroup(groupId, groupName, groupImage, adminStatus) {
    currentGroupId = groupId;
    currentGroupName = groupName;
    currentGroupImage = groupImage;
    isAdmin = adminStatus;
    // ⭐ NEW: Mark messages as read when opening group
    await markGroupMessagesAsRead(groupId);

    document.getElementById("welcomeScreen").style.display = "none";
    document.getElementById("chatScreen").style.display = "flex";
    document.getElementById("chatGroupName").textContent = groupName;
    document.getElementById("addMembersBtn").style.display = isAdmin ? "block" : "none";

    document.getElementById("messagesContainer").innerHTML = "";

    try {
        await connection.invoke("JoinGroup", groupId);
    } catch (error) {
        console.error("Error joining SignalR group:", error);
    }

    await loadGroupMessages(groupId);
    await loadMembersCount(groupId);

    document.querySelectorAll('.group-item').forEach(item => item.classList.remove('active'));
    document.querySelector(`[data-group-id="${groupId}"]`)?.classList.add('active');
}

async function loadMembersCount(groupId) {
    try {
        const response = await fetch(`${API_BASE}/Group/Members/${groupId}`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });
        if (response.ok) {
            const members = await response.json();
            document.getElementById("chatGroupMembers").textContent = `${members.length} members`;
        }
    } catch (error) {
        console.error("Error loading members count:", error);
    }
}

// ==================== Load Messages ====================
async function loadGroupMessages(groupId) {
    try {
        const response = await fetch(`${API_BASE}/Group/Messages/${groupId}`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            const messages = await response.json();
            messages.forEach(msg => displayGroupMessage(msg));
        }
    } catch (error) {
        console.error("Error loading messages:", error);
    }
}

// ==================== Display Message ====================
function displayGroupMessage(message) {
    const container = document.getElementById("messagesContainer");
    const isMine = message.senderId === currentUserId;

    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${isMine ? 'sent' : 'received'}`;
    messageDiv.dataset.messageId = message.id;
    messageDiv.dataset.senderId = message.senderId;

    let content = '';

    // Sender name for received messages
    if (!isMine) {
        content += `<div class="message-sender sender-name" style="font-weight: 600; color: #5B9BD5; font-size: 13px; margin-bottom: 4px;">
            ${escapeHtml(message.senderName || 'Unknown')}
        </div>`;
    }

    // Reply preview
    if (message.replyToMessageId) {
        content += `
            <div style="background: rgba(0,0,0,0.1); border-left: 3px solid #5B9BD5; padding: 6px 10px; margin-bottom: 6px; border-radius: 4px; font-size: 12px;">
                <div style="color: #5B9BD5; font-weight: 600;">${escapeHtml(message.replyToSenderName || 'Unknown')}</div>
                <div style="color: #8696a0;">${message.replyToType === 0 ? escapeHtml(message.replyToText || '') : '📎 Media'}</div>
            </div>
        `;
    }

    // Message content
    if (message.textContent) {
        content += `<div class="message-text">${escapeHtml(message.textContent)}</div>`;
    }

    // Media
    if (message.mediaUrl) {
        if (message.type === 1) {
            content += `<img src="${message.mediaUrl}" class="message-media" style="max-width: 300px; border-radius: 8px; cursor: pointer;" onclick="window.open('${message.mediaUrl}', '_blank')">`;
        } else if (message.type === 2) {
            content += `<video src="${message.mediaUrl}" class="message-media" controls style="max-width: 300px; border-radius: 8px;"></video>`;
        } else if (message.type === 3) {
            content += `
                <div class="voice-message" style="display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                    <audio controls style="flex: 1; height: 30px;">
                        <source src="${message.mediaUrl}" type="audio/webm">
                    </audio>
                    <span style="font-size: 12px; color: #8696a0; white-space: nowrap;">${message.mediaDuration ? formatDuration(message.mediaDuration) : '0:00'}</span>
                </div>
            `;
        }
    }

    // Time and read receipts
    const timeText = formatMessageTime(message.createdAt);
    
    if (isMine) {
        let ticksHtml = '';
        if (message.readByAll || message.readByCount > 0) {
            ticksHtml = '<span class="message-ticks ticks-blue">✓✓</span>';
        } else {
            ticksHtml = '<span class="message-ticks ticks-gray">✓✓</span>';
        }
        
        content += `
            <div class="message-time" style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px;">
                <span class="read-receipts" onclick="showWhoRead(${message.id})" style="cursor: pointer; font-size: 11px; color: #8696a0; text-decoration: underline;">
                    who read?
                </span>
                <span style="font-size: 11px; color: #8696a0;">${timeText}</span>
                ${ticksHtml}
            </div>
        `;
    } else {
        content += `<div class="message-time" style="font-size: 11px; color: #8696a0; margin-top: 4px;">${timeText}</div>`;
    }

    messageDiv.innerHTML = content;
    
    // Context menu
    messageDiv.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e, message);
    });

    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;

    // Mark as read if not mine
    if (!isMine) {
        markAsRead(message.id);
    }
}

function showContextMenu(event, message) {
    const existingMenu = document.querySelector(".context-menu");
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.cssText = `
        position: fixed;
        left: ${event.clientX}px;
        top: ${event.clientY}px;
        background: #2a3942;
        border: 1px solid #374045;
        border-radius: 8px;
        padding: 5px 0;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        z-index: 1000;
        min-width: 180px;
    `;

    const isMine = message.senderId === currentUserId;
    const messageText = message.textContent || 'Media';

    let menuItems = `
        <div class="context-menu-item" style="padding: 12px 20px; cursor: pointer; color: #e9edef; transition: background 0.2s;" 
             onmouseover="this.style.background='#374045'" 
             onmouseout="this.style.background=''" 
             onclick="setReply(${message.id}, '${escapeHtml(messageText)}', '${escapeHtml(message.senderName)}', ${message.type})">
            ↩️ Reply
        </div>
        <div class="context-menu-item" style="padding: 12px 20px; cursor: pointer; color: #e9edef; transition: background 0.2s;" 
             onmouseover="this.style.background='#374045'" 
             onmouseout="this.style.background=''" 
             onclick="deleteMessageForMe(${message.id})">
            🗑️ Delete for me
        </div>
    `;

    // Delete for everyone - show for sender OR admin
    if (isMine || isAdmin) {
        menuItems += `
            <div class="context-menu-item" style="padding: 12px 20px; cursor: pointer; color: #e9edef; transition: background 0.2s;" 
                 onmouseover="this.style.background='#374045'" 
                 onmouseout="this.style.background=''" 
                 onclick="deleteMessageForEveryone(${message.id})">
                🗑️ Delete for everyone
            </div>
        `;
    }

    menu.innerHTML = menuItems;
    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener("click", function closeMenu() {
            menu.remove();
            document.removeEventListener("click", closeMenu);
        });
    }, 100);
}

// ==================== Voice Recording ====================
async function startVoiceRecording() {
    if (isRecording) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.start();
        isRecording = true;
        recordingStartTime = Date.now();

        // Visual feedback
        const voiceBtn = document.getElementById("voiceRecordBtn");
        voiceBtn.style.background = "#d32f2f";
        voiceBtn.style.transform = "scale(1.1)";

        console.log("🎤 Recording started...");

    } catch (error) {
        console.error("Error starting recording:", error);
        alert("Could not access microphone");
    }
}

async function stopAndSendVoice() {
    if (!isRecording || !mediaRecorder) return;

    mediaRecorder.stop();
    isRecording = false;

    const voiceBtn = document.getElementById("voiceRecordBtn");
    voiceBtn.style.background = "";
    voiceBtn.style.transform = "";

    mediaRecorder.stream.getTracks().forEach(track => track.stop());

    await new Promise((resolve) => {
        mediaRecorder.onstop = () => resolve();
    });

    if (audioChunks.length === 0) return;

    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

    console.log("📤 Sending voice message, duration:", duration, "seconds");

    try {
        const formData = new FormData();
        formData.append("GroupId", currentGroupId);
        formData.append("Type", 3);
        formData.append("File", audioBlob, "voice.webm");
        formData.append("MediaDuration", duration);

        const response = await fetch(`${API_BASE}/Group/SendMessage`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getAccessToken()}` },
            body: formData
        });

        if (!response.ok) throw new Error("Failed to send voice message");

        console.log("✅ Voice message sent");
        audioChunks = [];
        
    } catch (error) {
        console.error("Error sending voice message:", error);
        alert("Failed to send voice message");
    }
}

function cancelIfRecording() {
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        audioChunks = [];
        
        const voiceBtn = document.getElementById("voiceRecordBtn");
        voiceBtn.style.background = "";
        voiceBtn.style.transform = "";
        
        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        
        console.log("🎤 Recording cancelled");
    }
}

// ==================== Send Message ====================
async function sendMessage() {
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    if (!text || !currentGroupId) return;

    const formData = new FormData();
    formData.append("GroupId", currentGroupId);
    formData.append("Type", 0);
    formData.append("Text", text);

    let endpoint = `${API_BASE}/Group/SendMessage`;
    
    if (replyToMessage) {
        formData.append("ReplyToMessageId", replyToMessage.id);
        endpoint = `${API_BASE}/Group/ReplyToMessage`;
    }

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getAccessToken()}` },
            body: formData
        });

        if (response.ok) {
            input.value = "";
            cancelReply();
            handleTypingStop();
        }
    } catch (error) {
        console.error("Error sending message:", error);
    }
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !currentGroupId) return;

    const fileType = file.type.startsWith('image') ? 1 : 
                     file.type.startsWith('video') ? 2 : null;

    if (fileType === null) {
        alert("Unsupported file type");
        return;
    }

    const formData = new FormData();
    formData.append("GroupId", currentGroupId);
    formData.append("Type", fileType);
    formData.append("File", file);

    try {
        const response = await fetch(`${API_BASE}/Group/SendMessage`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getAccessToken()}` },
            body: formData
        });

        if (response.ok) {
            e.target.value = "";
        }
    } catch (error) {
        console.error("Error sending media:", error);
    }
}

// ==================== Reply Functions ====================
function setReply(messageId, text, senderName, type) {
    replyToMessage = { id: messageId, text, senderName, type };
    const preview = document.getElementById("replyPreview");
    preview.style.display = "block";
    document.getElementById("replyToSender").textContent = senderName;
    document.getElementById("replyToText").textContent = type === 0 ? text : '📎 Media';
    document.getElementById("messageInput").focus();
}

function cancelReply() {
    replyToMessage = null;
    document.getElementById("replyPreview").style.display = "none";
}

// ==================== Delete Messages ====================
async function deleteMessageForMe(messageId) {
    if (!confirm('Delete this message for yourself?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/Group/DeleteMessageForMe/${messageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getAccessToken()}` }
        });
        
        if (response.ok) {
            const msg = document.querySelector(`[data-message-id="${messageId}"]`);
            if (msg) msg.style.display = 'none';
        } else {
            throw new Error('Failed to delete');
        }
    } catch (error) {
        console.error('Error deleting message:', error);
        alert('Failed to delete message');
    }
}

async function deleteMessageForEveryone(messageId) {
    if (!confirm('Delete this message for everyone?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/Group/DeleteMessageForEveryone/${messageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getAccessToken()}` }
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to delete');
        }
        
        console.log("✅ Message deleted for everyone");
    } catch (error) {
        console.error('Error:', error);
        alert(error.message || 'Failed to delete message');
    }
}

// ==================== Who Read ====================
async function showWhoRead(messageId) {
    try {
        const response = await fetch(`${API_BASE}/Group/WhoRead/${messageId}`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            const data = await response.json();
            displayWhoReadModal(data);
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

function displayWhoReadModal(data) {
    const content = document.getElementById("whoReadContent");
    content.innerHTML = `
        <div style="padding: 10px; font-size: 13px; color: #8696a0; margin-bottom: 10px;">
            Read by ${data.readCount} of ${data.totalMembers}
        </div>
        ${data.members.map(member => `
            <div style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid #2a3942;">
                ${member.userImage ? 
                    `<img src="${member.userImage}" style="width: 40px; height: 40px; border-radius: 50%; margin-right: 12px;">` :
                    `<div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #5B9BD5 0%, #5B9BD5 100%); margin-right: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;">${member.userName.charAt(0)}</div>`
                }
                <div style="flex: 1;">
                    <strong style="color: #e9edef;">${member.userName}</strong>
                    <div style="font-size: 11px; color: ${member.hasRead ? '#53bdeb' : '#8696a0'};">
                        ${member.hasRead ? `Read ${formatReadTime(member.readAt)}` : 'Delivered'}
                    </div>
                </div>
                ${member.hasRead ? '<span style="color: #53bdeb;">✓✓</span>' : '<span style="color: #8696a0;">✓</span>'}
            </div>
        `).join('')}
    `;
    openModal("whoReadModal");
}

// ==================== Group Actions ====================
async function createGroup(e) {
    e.preventDefault();
    
    const name = document.getElementById("groupName").value;
    const description = document.getElementById("groupDescription").value;
    const imageFile = document.getElementById("groupImage").files[0];

    const formData = new FormData();
    formData.append("Name", name);
    formData.append("Description", description || "");
    if (imageFile) formData.append("Image", imageFile);

    try {
        const response = await fetch(`${API_BASE}/Group/Create`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getAccessToken()}` },
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            alert(`Group created! Join Code: ${result.joinCode}`);
            closeModal("createGroupModal");
            document.getElementById("createGroupForm").reset();
            await loadGroupsList();
        }
    } catch (error) {
        console.error("Error creating group:", error);
    }
}

async function joinGroup(e) {
    e.preventDefault();
    
    const joinCode = document.getElementById("joinCode").value;

    try {
        const response = await fetch(`${API_BASE}/Group/Join`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${getAccessToken()}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ joinCode })
        });

        if (response.ok) {
            const result = await response.json();
            alert(`Joined ${result.groupName}!`);
            closeModal("joinGroupModal");
            document.getElementById("joinGroupForm").reset();
            await loadGroupsList();
            await connection.invoke("JoinGroup", result.groupId);
        }
    } catch (error) {
        console.error("Error joining group:", error);
    }
}

async function loadUsersToAdd() {
    if (!isAdmin) {
        alert("Only admins can add members");
        return;
    }

    selectedUsersToAdd.clear();
    
    try {
        const response = await fetch(`${API_BASE}/Group/AvailableUsers/${currentGroupId}`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            allUsersForAdding = await response.json();
            displayUsersToAdd(allUsersForAdding);
        }
    } catch (error) {
        console.error("Error loading users:", error);
    }
}

function displayUsersToAdd(users) {
    const container = document.getElementById("usersToAddList");
    
    if (!users || users.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #8696a0;">No users available</div>';
        return;
    }
    
    container.innerHTML = users.map(user => `
        <div style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid #2a3942; cursor: pointer;" onclick="toggleUserSelection('${user.userId}')">
            <input type="checkbox" id="user-${user.userId}" style="margin-right: 12px; width: 18px; height: 18px;">
            ${user.imageUrl ? 
                `<img src="${user.imageUrl}" style="width: 40px; height: 40px; border-radius: 50%; margin-right: 12px;">` :
                `<div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #5B9BD5 0%, #5B9BD5 100%); margin-right: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;">${user.name.charAt(0)}</div>`
            }
            <div>
                <strong style="color: #e9edef;">${user.name}</strong>
                <div style="font-size: 12px; color: #8696a0;">${user.email}</div>
            </div>
        </div>
    `).join('');
}

function toggleUserSelection(userId) {
    const checkbox = document.getElementById(`user-${userId}`);
    if (!checkbox) return;
    
    checkbox.checked = !checkbox.checked;
    
    if (checkbox.checked) {
        selectedUsersToAdd.add(userId);
    } else {
        selectedUsersToAdd.delete(userId);
    }
}

function filterUsersToAdd(e) {
    const searchTerm = e.target.value.trim().toLowerCase();
    
    if (!allUsersForAdding || allUsersForAdding.length === 0) return;
    
    if (searchTerm === "") {
        displayUsersToAdd(allUsersForAdding);
        return;
    }
    
    const filtered = allUsersForAdding.filter(user => 
        user.name.toLowerCase().includes(searchTerm) ||
        user.email.toLowerCase().includes(searchTerm)
    );
    
    displayUsersToAdd(filtered);
}

async function addMembers() {
    if (selectedUsersToAdd.size === 0) {
        alert("Please select at least one user");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/Group/AddMembers`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${getAccessToken()}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                groupId: currentGroupId,
                userIds: Array.from(selectedUsersToAdd)
            })
        });

        if (response.ok) {
            alert("Members added successfully");
            selectedUsersToAdd.clear();
            closeModal("addMembersModal");
        }
    } catch (error) {
        console.error("Error adding members:", error);
    }
}

// ==================== Remove Member ====================
async function removeMember(userId, userName) {
    if (!confirm(`Remove ${userName} from the group?`)) return;
    
    try {
        const response = await fetch(`${API_BASE}/Group/RemoveMember`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAccessToken()}`
            },
            body: JSON.stringify({
                groupId: currentGroupId,
                userId: userId
            })
        });
        
        if (response.ok) {
            alert('Member removed successfully');
            const modal = document.getElementById('viewMembersModal');
            if (modal && modal.style.display !== 'none') {
                loadGroupMembers();
            }
        } else {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to remove member');
        }
    } catch (error) {
        console.error('Error removing member:', error);
        alert(error.message || 'Failed to remove member');
    }
}

async function leaveGroup() {
    if (!confirm(`Leave ${currentGroupName}?`)) return;

    try {
        const response = await fetch(`${API_BASE}/Group/Leave/${currentGroupId}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            alert("Left group successfully");
            await connection.invoke("LeaveGroup", currentGroupId);
            backToGroupsList();
            await loadGroupsList();
        }
    } catch (error) {
        console.error("Error leaving group:", error);
    }
}

async function clearGroupChat() {
    if (!confirm("Clear all messages?")) return;

    try {
        const response = await fetch(`${API_BASE}/Group/ClearChat/${currentGroupId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            document.getElementById("messagesContainer").innerHTML = "";
            alert("Chat cleared");
        }
    } catch (error) {
        console.error("Error clearing chat:", error);
    }
}

async function loadGroupInfo() {
    try {
        const response = await fetch(`${API_BASE}/Group/GetGroup/${currentGroupId}`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            const group = await response.json();
            displayGroupInfo(group);
            openModal("groupInfoModal");
        }
    } catch (error) {
        console.error("Error loading group info:", error);
    }
}

function displayGroupInfo(group) {
    const content = document.getElementById("groupInfoContent");
    content.innerHTML = `
        <div style="padding: 20px;">
            ${group.imageUrl ? `<img src="${group.imageUrl}" style="width: 100px; height: 100px; border-radius: 50%; display: block; margin: 0 auto 20px;">` : ''}
            <h3 style="text-align: center; color: #e9edef;">${group.name}</h3>
            <p style="color: #8696a0; text-align: center;">${group.description || 'No description'}</p>
            <hr style="margin: 20px 0; border-color: #2a3942;">
            <p style="color: #e9edef;"><strong>Created by:</strong> ${group.creatorName}</p>
            <p style="color: #e9edef;"><strong>Members:</strong> ${group.membersCount}</p>
            <p style="color: #e9edef;"><strong>Join Code:</strong> <span style="background: #2a3942; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${group.joinCode}</span></p>
            <p style="color: #e9edef;"><strong>Created:</strong> ${new Date(group.createdAt).toLocaleDateString()}</p>
            ${isAdmin ? `
            <button onclick="showEditGroupForm()" class="btn-primary" style="margin-top: 20px; width: 100%;">
                Edit Group Info
            </button>
            ` : ''}
        </div>
    `;
}

// ==================== Update Group Info ====================
function showEditGroupForm() {
    if (!isAdmin) {
        alert('Only admins can edit group info');
        return;
    }
    
    const infoContent = document.getElementById('groupInfoContent');
    if (!infoContent) return;
    
    infoContent.innerHTML = `
        <form id="editGroupForm" style="padding: 15px;">
            <div class="form-group">
                <label style="display: block; margin-bottom: 8px; color: #e9edef; font-size: 14px; font-weight: 500;">Group Name</label>
                <input type="text" id="editGroupName" value="${currentGroupName}" required style="width: 100%; padding: 12px; background: #2a3942; border: 1px solid #374045; border-radius: 8px; color: white; font-size: 14px;">
            </div>
            <div class="form-group" style="margin-top: 15px;">
                <label style="display: block; margin-bottom: 8px; color: #e9edef; font-size: 14px; font-weight: 500;">Description</label>
                <textarea id="editGroupDescription" rows="3" style="width: 100%; padding: 12px; background: #2a3942; border: 1px solid #374045; border-radius: 8px; color: white; font-size: 14px; resize: vertical;"></textarea>
            </div>
            <div class="form-group" style="margin-top: 15px;">
                <label style="display: block; margin-bottom: 8px; color: #e9edef; font-size: 14px; font-weight: 500;">Group Image</label>
                <input type="file" id="editGroupImage" accept="image/*" style="width: 100%; padding: 12px; background: #2a3942; border: 1px solid #374045; border-radius: 8px; color: white; font-size: 14px;">
            </div>
            <button type="submit" class="btn-primary" style="margin-top: 20px; background: #5B9BD5; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; width: 100%;">Save Changes</button>
            <button type="button" class="btn-secondary" onclick="loadGroupInfo()" style="margin-top: 10px; background: #374045; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; width: 100%;">Cancel</button>
        </form>
    `;
    
    document.getElementById('editGroupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('editGroupName').value.trim();
        const desc = document.getElementById('editGroupDescription').value.trim();
        const imageFile = document.getElementById('editGroupImage').files[0];
        
        if (name) {
            await updateGroupInfo(name, desc, imageFile);
        }
    });
}

async function updateGroupInfo(name, description, imageFile) {
    if (!currentGroupId) return;
    
    const formData = new FormData();
    if (name) formData.append('Name', name);
    if (description) formData.append('Description', description);
    if (imageFile) formData.append('Image', imageFile);
    
    try {
        const response = await fetch(`${API_BASE}/Group/UpdateGroup/${currentGroupId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${getAccessToken()}` },
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            alert('Group updated successfully');
            
            currentGroupName = result.group.name;
            currentGroupImage = result.group.imageUrl;
            
            const nameEl = document.getElementById('chatGroupName');
            if (nameEl) nameEl.textContent = currentGroupName;
            
            loadGroupsList();
            closeModal('groupInfoModal');
        } else {
            throw new Error('Failed to update group');
        }
    } catch (error) {
        console.error('Error updating group:', error);
        alert('Failed to update group');
    }
}

async function loadGroupMembers() {
    try {
        const response = await fetch(`${API_BASE}/Group/Members/${currentGroupId}`, {
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });

        if (response.ok) {
            const members = await response.json();
            displayGroupMembers(members);
            openModal("viewMembersModal");
        }
    } catch (error) {
        console.error("Error loading members:", error);
    }
}

function displayGroupMembers(members) {
    const content = document.getElementById("membersListContent");
    content.innerHTML = members.map(member => `
        <div style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid #2a3942;">
            ${member.imageUrl ? 
                `<img src="${member.imageUrl}" style="width: 45px; height: 45px; border-radius: 50%; margin-right: 12px;">` :
                `<div style="width: 45px; height: 45px; border-radius: 50%; background: linear-gradient(135deg, #5B9BD5 0%, #5B9BD5 100%); margin-right: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 18px;">${member.name.charAt(0)}</div>`
            }
            <div style="flex: 1;">
                <strong style="color: #e9edef; font-size: 15px;">${member.name}</strong>
                ${member.isAdmin ? '<span style="color: #5B9BD5; font-size: 11px; margin-left: 8px;">Admin</span>' : ''}
            </div>
            ${isAdmin && member.userId !== currentUserId ? `
                <button onclick="removeMember('${member.userId}', '${escapeHtml(member.name)}')" 
                        style="background: #d32f2f; color: white; border: none; padding: 6px 12px; border-radius: 5px; cursor: pointer; font-size: 13px;">
                    Remove
                </button>
            ` : ''}
        </div>
    `).join('');
}

// ==================== Typing Indicators ====================
function handleTypingStart() {
    if (!currentGroupId || isTyping) return;

    isTyping = true;
    connection.invoke("StartTyping", currentGroupId).catch(err => console.error(err));

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(handleTypingStop, 3000);
}

function handleTypingStop() {
    if (!currentGroupId || !isTyping) return;

    isTyping = false;
    connection.invoke("GroupStopTyping", currentGroupId).catch(err => console.error(err));
}

function updateTypingIndicator() {
    const indicator = document.getElementById("typingIndicator");
    
    if (!groupTypingUsers.has(currentGroupId) || groupTypingUsers.get(currentGroupId).size === 0) {
        indicator.style.display = "none";
        return;
    }
    
    const users = Array.from(groupTypingUsers.get(currentGroupId));
    const text = users.length === 1 
        ? `${users[0]} is typing...`
        : users.length === 2
        ? `${users[0]} and ${users[1]} are typing...`
        : `${users[0]} and ${users.length - 1} others are typing...`;
    
    indicator.textContent = text;
    indicator.style.display = "block";
}

async function markAsRead(messageId) {
    try {
        await fetch(`${API_BASE}/Group/MarkAsRead/${messageId}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getAccessToken()}` }
        });
    } catch (error) {
        console.error("Error marking as read:", error);
    }
}

function updateMessageReadStatus(messageId, userName) {
    console.log(`Message ${messageId} read by ${userName}`);
}

// ⭐ NEW: Mark all group messages as read
async function markGroupMessagesAsRead(groupId) {
    try {
        const response = await fetch(`${API_BASE}/Group/MarkAllAsRead/${groupId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getAccessToken()}` }
        });
        
        if (response.ok) {
            console.log("✅ All messages marked as read for group:", groupId);
            
            // Remove unread badge from UI
            const groupItem = document.querySelector(`.group-item[data-group-id="${groupId}"]`);
            if (groupItem) {
                const badge = groupItem.querySelector('.unread-badge');
                if (badge) badge.remove();
            }
            
            // Clear unread count
            delete unreadCounts[groupId];
        }
    } catch (error) {
        console.error("Error marking messages as read:", error);
    }
}

// ==================== Utility Functions ====================
function backToGroupsList() {
    if (currentGroupId) {
        // ⭐ NEW: Mark as read before leaving
        markGroupMessagesAsRead(currentGroupId).catch(err => console.error(err));
        
        connection.invoke("LeaveGroup", currentGroupId).catch(err => console.error(err));
    }
    
    currentGroupId = null;
    currentGroupName = null;
    isAdmin = false;
    
    document.getElementById("chatScreen").style.display = "none";
    document.getElementById("welcomeScreen").style.display = "flex";
    
    loadGroupsList();
}

function handleSearch(e) {
    const searchTerm = e.target.value.trim().toLowerCase();
    
    if (searchTerm === "") {
        displayGroupsList();
        return;
    }
    
    const filtered = groupsList.filter(group => 
        group.name.toLowerCase().includes(searchTerm)
    );
    
    const container = document.getElementById("groupsList");
    container.innerHTML = filtered.map(group => `
        <div class="group-item user-item" data-group-id="${group.id}" onclick="openGroup(${group.id}, '${escapeHtml(group.name)}', '${group.imageUrl || ''}', ${group.isAdmin})">
            ${group.imageUrl ? 
                `<img src="${group.imageUrl}" alt="${group.name}" class="user-avatar">` : 
                `<div class="user-avatar">${group.name.charAt(0).toUpperCase()}</div>`
            }
            <div class="user-info">
                <h4>${escapeHtml(group.name)}</h4>
                <p style="font-size: 13px; color: #8696a0;">${group.membersCount} members</p>
            </div>
        </div>
    `).join('');
}

function toggleAttachMenu() {
    const menu = document.getElementById("attachMenu");
    menu.style.display = menu.style.display === "none" ? "flex" : "none";
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = "block";
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = "none";
}

function showSystemMessage(text) {
    const container = document.getElementById("messagesContainer");
    const div = document.createElement("div");
    div.style.cssText = "text-align: center; color: #8696a0; font-size: 12px; margin: 10px 0; padding: 8px; background: rgba(42, 57, 66, 0.3); border-radius: 6px;";
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMessageTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
}

function formatReadTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
}

function formatDuration(seconds) {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function handleLogout() {
    if (confirm("Logout?")) {
        try {
            if (connection) await connection.stop();
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");
            window.location.href = "index.html";
        } catch (error) {
            console.error("Error during logout:", error);
        }
    }
}

console.log("✅ groups.js loaded successfully!");