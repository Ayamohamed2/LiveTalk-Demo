// ==================== Configuration ====================
const API_BASE = "https://livetalk.runasp.net/api";
const HUB_URL = "https://livetalk.runasp.net/chat";
const CALL_HUB_URL = "https://livetalk.runasp.net/callHub";
const MEDIA_BASE = "https://livetalk.runasp.net";

// ==================== Global Variables ====================
let connection = null;
let callConnection = null;
let currentChatUserId = null;
let currentChatUserName = null;
let currentChatUserEmail = null;
let currentChatUserImage = null;
let allUsers = [];
let chatList = [];
let onlineUsers = new Set();
let typingTimeout = null;
let isTyping = false;
let currentUserId = null;
let unreadCounts = {};
let replyToMessage = null;

// Voice Recording Variables
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingInterval = null;
let isRecording = false;

// Call Variables
let pendingIncomingCall = null;
let ringtoneAudio = null;

// ==================== Authentication Functions ====================
function getAccessToken() {
    return localStorage.getItem("accessToken");
}

function getRefreshToken() {
    return localStorage.getItem("refreshToken");
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

    console.log("🚀 Starting chat initialization...");

    const token = getAccessToken();
    const payload = JSON.parse(atob(token.split('.')[1]));
    currentUserId = payload.sub || payload.nameid;
    console.log("Current User ID:", currentUserId);

    initializeRingtone();
    await connectSignalR();
    await connectCallHub();
    setupEventListeners();
    await loadChatList();
});

// ==================== Ringtone Initialization ====================
function initializeRingtone() {
    ringtoneAudio = document.getElementById("incomingRingtone");
    if (ringtoneAudio) {
        ringtoneAudio.loop = true;
    }
}

// ==================== SignalR Chat Hub Connection ====================
async function connectSignalR() {
    try {
        console.log("📡 Connecting to Chat Hub...");
        
        connection = new signalR.HubConnectionBuilder()
            .withUrl(`${HUB_URL}?access_token=${getAccessToken()}`, {
                skipNegotiation: true,
                transport: signalR.HttpTransportType.WebSockets
            })
            .configureLogging(signalR.LogLevel.Information)
            .withAutomaticReconnect([0, 2000, 5000, 10000])
            .build();

        setupChatHubEvents();

        await connection.start();
        console.log("✅ Connected to Chat Hub!");
        
    } catch (error) {
        console.error("❌ Error connecting to Chat Hub:", error);
        setTimeout(connectSignalR, 5000);
    }
}

// ==================== Chat Hub Events ====================
function setupChatHubEvents() {
    // Initial user statuses
    connection.on("InitialUserStatuses", async (userStatuses) => {
        console.log("📊 Initial user statuses:", userStatuses);
        
        onlineUsers.clear();
        
        userStatuses.forEach(userStatus => {
            if (userStatus.isOnline) {
                onlineUsers.add(userStatus.userId);
            }
            updateUserStatus(userStatus.userId, userStatus.isOnline, userStatus.lastSeen);
        });
        
        // ⭐ تحديث الرسائل غير المُسلمة للمستخدمين المتصلين
        for (const userStatus of userStatuses) {
            if (userStatus.isOnline) {
                await markUndeliveredMessagesAsDelivered(userStatus.userId);
            }
        }
    });

    // User online
    connection.on("UserOnline", async (userId) => {
        console.log("🟢 User online:", userId);
        onlineUsers.add(userId);
        updateUserStatus(userId, true);
        
        // ⭐ تحديث الرسائل غير المُسلمة إلى delivered
        await markUndeliveredMessagesAsDelivered(userId);
    });

    // User offline
    connection.on("Useroffline", (userId, lastSeen) => {
        console.log("🔴 User offline:", userId, lastSeen);
        onlineUsers.delete(userId);
        updateUserStatus(userId, false, lastSeen);
    });

    connection.on("OnlineUsersList", (users) => {
        console.log("OnlineUsersList event:", users);
        onlineUsers.clear();
        users.forEach(userId => {
            onlineUsers.add(userId);
            updateUserStatus(userId, true);
        });
    });

    // Receive message
    connection.on("ReceiveMessage", (message) => {
        console.log("📨 Received message:", message);
        handleReceivedMessage(message);
    });

    // ⭐ Message Delivered
    connection.on("MessageDelivered", (messageId) => {
        console.log("✅ Message delivered:", messageId);
        updateMessageStatus(messageId, 'delivered');
    });

    // ⭐ Messages Read
    connection.on("MessagesRead", (messageIds) => {
        console.log("👁️ Messages read:", messageIds);
        messageIds.forEach(id => updateMessageStatus(id, 'read'));
    });

    // ⭐ Message Deleted For Everyone
    connection.on("MessageDeletedForEveryone", (data) => {
        console.log("🗑️ Message deleted for everyone:", data);
        removeOrUpdateMessageInUI(data.messageId, true);
    });

    // Typing indicator
    connection.on("Typing", (userName, userId) => {
        if (userId === currentChatUserId) {
            showTypingIndicator(userName);
        }
    });

    // Stop typing indicator
    connection.on("StopTyping", (userName, userId) => {
        if (userId === currentChatUserId) {
            hideTypingIndicator();
        }
    });

    // User blocked
    connection.on("UserBlocked", (data) => {
        console.log("🚫 User blocked:", data);
        if (data.blockerId === currentChatUserId || currentChatUserId === data.blockerId) {
            // ⭐ نعطل الـ input بدل ما نرجع للخلف
            toggleChatInput(false);
            alert("This user has blocked you or you blocked them. You cannot send messages.");
        }
        loadChatList(); // Refresh chat list
    });

    // User unblocked
    connection.on("UserUnblocked", (data) => {
        console.log("✅ User unblocked:", data);
        // ⭐ إذا كان المستخدم الحالي، نفعل الـ input
        if (data.blockerId === currentChatUserId || data.blockedUserId === currentChatUserId) {
            toggleChatInput(true);
        }
        loadChatList(); // Refresh chat list
    });

    // Connection reconnected
    connection.onreconnected(async () => {
        console.log("🔄 Reconnected to Chat Hub");
        await loadChatList();
    });

    // Connection reconnecting
    connection.onreconnecting(() => {
        console.log("⏳ Reconnecting to Chat Hub...");
    });

    // Connection closed
    connection.onclose(async () => {
        console.log("❌ Chat Hub connection closed");
        await connectSignalR();
    });
}

// ==================== Call Hub Connection ====================
async function connectCallHub() {
    try {
        console.log("📞 Connecting to Call Hub...");
        
        callConnection = new signalR.HubConnectionBuilder()
            .withUrl(`${CALL_HUB_URL}?access_token=${getAccessToken()}`, {
                skipNegotiation: true,
                transport: signalR.HttpTransportType.WebSockets
            })
            .configureLogging(signalR.LogLevel.Information)
            .withAutomaticReconnect()
            .build();

        setupCallHubEvents();

        await callConnection.start();
        console.log("✅ Connected to Call Hub!");
        
    } catch (error) {
        console.error("❌ Error connecting to Call Hub:", error);
        setTimeout(connectCallHub, 5000);
    }
}

// ==================== Call Hub Events ====================
function setupCallHubEvents() {
    // Incoming call
    callConnection.on("IncomingCall", (data) => {
        console.log("📞 Incoming call:", data);
        pendingIncomingCall = data;
        showIncomingCallNotification(data);
        playRingtone();
    });

    // Call rejected
    callConnection.on("CallRejected", (data) => {
        console.log("❌ Call rejected:", data);
        hideIncomingCallNotification();
        stopRingtone();
        pendingIncomingCall = null;
    });

    // Call ended
    callConnection.on("CallEnded", (data) => {
        console.log("🔚 Call ended:", data);
        hideIncomingCallNotification();
        stopRingtone();
        pendingIncomingCall = null;
    });

    // User busy
    callConnection.on("CallBusy", (userId) => {
        console.log("📵 User is busy:", userId);
        alert("User is busy on another call");
    });

    // Call initiated
    callConnection.on("CallInitiated", (data) => {
        console.log("📤 Call initiated:", data);
    });

    // Call accepted
    callConnection.on("CallAccepted", (data) => {
        console.log("✅ Call accepted:", data);
    });
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Logout button
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleLogout);
    }

    // ⭐ Back button (close chat)
    const backBtn = document.getElementById("backBtn");
    if (backBtn) {
        backBtn.addEventListener("click", backToUsersList);
    }

    // Call history button
    const callHistoryBtn = document.getElementById("callHistoryBtn");
    if (callHistoryBtn) {
        callHistoryBtn.addEventListener("click", () => {
            window.location.href = "call-history.html";
        });
    }

    // Search input
    const searchInput = document.getElementById("searchUsers");
    if (searchInput) {
        searchInput.addEventListener("input", handleSearch);
    }

    // Message input
    const messageInput = document.getElementById("messageInput");
    if (messageInput) {
        messageInput.addEventListener("input", handleTypingStart);
        messageInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Send button
    const sendBtn = document.getElementById("sendBtn");
    if (sendBtn) {
        sendBtn.addEventListener("click", sendMessage);
    }

    // Attach button
    const attachBtn = document.getElementById("attachBtn");
    if (attachBtn) {
        attachBtn.addEventListener("click", toggleAttachMenu);
    }

    // File input
    const fileInput = document.getElementById("fileInput");
    if (fileInput) {
        fileInput.addEventListener("change", handleFileSelect);
    }

    // Image button
    const imageBtn = document.getElementById("imageBtn");
    if (imageBtn) {
        imageBtn.addEventListener("click", () => {
            document.getElementById("fileInput").accept = "image/*";
            document.getElementById("fileInput").click();
        });
    }

    // Video button
    const videoBtn = document.getElementById("videoBtn");
    if (videoBtn) {
        videoBtn.addEventListener("click", () => {
            document.getElementById("fileInput").accept = "video/*";
            document.getElementById("fileInput").click();
        });
    }

    // Voice record button
    const voiceRecordBtn = document.getElementById("voiceRecordBtn");
    if (voiceRecordBtn) {
        voiceRecordBtn.addEventListener("click", toggleVoiceRecording);
    }

    // Cancel record button
    const cancelRecordBtn = document.getElementById("cancelRecordBtn");
    if (cancelRecordBtn) {
        cancelRecordBtn.addEventListener("click", cancelVoiceRecording);
    }

    // Send record button
    const sendRecordBtn = document.getElementById("sendRecordBtn");
    if (sendRecordBtn) {
        sendRecordBtn.addEventListener("click", sendVoiceMessage);
    }

    // Voice call button
    const voiceCallBtn = document.getElementById("voiceCallBtn");
    if (voiceCallBtn) {
        voiceCallBtn.addEventListener("click", () => initiateCall(0));
    }

    // Video call button
    const videoCallBtn = document.getElementById("videoCallBtn");
    if (videoCallBtn) {
        videoCallBtn.addEventListener("click", () => initiateCall(1));
    }

    // ⭐ Clear Chat Button
    const clearChatBtn = document.getElementById("clearChatBtn");
    if (clearChatBtn) {
        clearChatBtn.addEventListener("click", handleClearChat);
    }

    // ⭐ Block Button
    const blockBtn = document.getElementById("blockBtn");
    if (blockBtn) {
        blockBtn.addEventListener("click", handleBlockUnblock);
    }

    // Incoming call notification - Accept
    const notifAcceptBtn = document.getElementById("notifAcceptBtn");
    if (notifAcceptBtn) {
        notifAcceptBtn.addEventListener("click", acceptIncomingCall);
    }

    // Incoming call notification - Decline
    const notifDeclineBtn = document.getElementById("notifDeclineBtn");
    if (notifDeclineBtn) {
        notifDeclineBtn.addEventListener("click", declineIncomingCall);
    }

    // Close attach menu when clicking outside
    document.addEventListener("click", (e) => {
        const attachMenu = document.getElementById("attachMenu");
        const attachBtn = document.getElementById("attachBtn");
        if (attachMenu && !attachMenu.contains(e.target) && e.target !== attachBtn) {
            attachMenu.style.display = "none";
        }
    });
}

// ==================== Load Chat List (Using MyChatList Endpoint) ====================
async function loadChatList() {
    try {
        console.log("📋 Loading chat list...");
        
        const response = await fetch(`${API_BASE}/OneToOneChat/MyChatList`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        chatList = await response.json();
        console.log("✅ Chat list loaded:", chatList);
        
        displayChatList(chatList);
        
    } catch (error) {
        console.error("❌ Error loading chat list:", error);
    }
}

// ==================== Display Chat List ====================
function displayChatList(chats) {
    const usersList = document.getElementById("usersList");
    if (!usersList) return;

    usersList.innerHTML = "";

    if (chats.length === 0) {
        usersList.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: #8696a0;">
                <p>No chats yet</p>
                <p style="font-size: 13px; margin-top: 10px;">Search for users to start chatting</p>
            </div>
        `;
        return;
    }

    chats.forEach(chat => {
        const userDiv = createChatListItem(chat);
        usersList.appendChild(userDiv);
    });
}

// ==================== Create Chat List Item ====================
function createChatListItem(chat) {
    const userDiv = document.createElement("div");
    userDiv.className = "user-item";
    userDiv.dataset.userId = chat.userId;

    const isOnline = onlineUsers.has(chat.userId);
    const profilePicUrl = chat.imageUrl || null;

    // ⭐ Show status with proper last seen
    let statusText = "";
    if (chat.showEmail) {
        // In search results, show email
        statusText = chat.email;
    } else if (isOnline) {
        statusText = "online";
    } else {
        // ⭐ استخدام getLastSeenText لعرض Last Seen بشكل صحيح
        statusText = getLastSeenText(chat.lastSeen);
    }
    
    // ⭐ حفظ lastSeen في dataset
    if (chat.lastSeen) {
        userDiv.dataset.lastseen = chat.lastSeen;
    }

    // Time formatting (keep for sorting purposes, but hide from display)
    let timeText = "";
    if (chat.lastMessageTime) {
        const messageDate = new Date(chat.lastMessageTime);
        const now = new Date();
        const diffTime = now - messageDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            timeText = messageDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            timeText = "Yesterday";
        } else if (diffDays < 7) {
            timeText = messageDate.toLocaleDateString('en-US', { weekday: 'short' });
        } else {
            timeText = messageDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
    }

    const statusColor = chat.showEmail ? '#8696a0' : (isOnline ? '#00a884' : '#8696a0');

    userDiv.innerHTML = `
        ${profilePicUrl 
            ? `<img src="${profilePicUrl}" alt="${chat.name}" class="user-avatar">` 
            : `<div class="user-avatar">${chat.name.charAt(0).toUpperCase()}</div>`
        }
        <div class="user-info">
            <div class="user-name-row">
                <h4>${chat.name}</h4>
                ${chat.isBlockedByMe ? '<span class="blocked-badge">Blocked</span>' : ''}
            </div>
            <p class="last-message user-status-text" style="color: ${statusColor};">${statusText}</p>
        </div>
        <div class="user-meta">
            ${timeText ? `<span class="message-time">${timeText}</span>` : ''}
            ${chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
            <div class="${isOnline ? 'online-status' : 'offline-status'}"></div>
        </div>
    `;

    userDiv.addEventListener("click", () => openChat(chat));

    return userDiv;
}

// ==================== Search Users (by Name or Email) ====================
async function handleSearch(e) {
    const searchTerm = e.target.value.trim().toLowerCase();
    
    if (searchTerm === "") {
        // If search is empty, reload chat list
        await loadChatList();
        return;
    }

    try {
        // Search in all users using AllUsers endpoint
        const response = await fetch(`${API_BASE}/OneToOneChat/AllUsers`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const allUsers = await response.json();
        console.log("🔍 All users:", allUsers);

        // Filter users by search term
        const filteredUsers = allUsers.filter(user => 
            user.name.toLowerCase().includes(searchTerm) ||
            user.email.toLowerCase().includes(searchTerm)
        );

        // Convert to chat list format (with email shown)
        const searchResults = filteredUsers.map(user => ({
            userId: user.id,
            name: user.name,
            email: user.email,
            imageUrl: user.imageUrl,
            unreadCount: user.unreadCount || 0,
            isBlockedByMe: false,
            lastMessageText: null,
            lastMessageType: null,
            lastMessageTime: null,
            lastMessageFromMe: false,
            showEmail: true  // ⭐ Flag to show email in search results
        }));

        displayChatList(searchResults);
        
    } catch (error) {
        console.error("❌ Error searching users:", error);
        // Fallback to local search if API fails
        const filteredChats = chatList.filter(chat => 
            chat.name.toLowerCase().includes(searchTerm) ||
            chat.email.toLowerCase().includes(searchTerm)
        );
        displayChatList(filteredChats);
    }
}

// ==================== Open Chat ====================
async function openChat(chat) {
    currentChatUserId = chat.userId;
    currentChatUserName = chat.name;
    currentChatUserEmail = chat.email;
    currentChatUserImage = chat.imageUrl;

    console.log(`💬 Opening chat with ${chat.name} (${chat.userId})`);

    // Hide welcome screen, show chat screen
    document.getElementById("welcomeScreen").style.display = "none";
    document.getElementById("chatScreen").style.display = "flex";

    // Update chat header
    updateChatHeader(chat);

    // ⭐ Update Block Button
    updateBlockButton(chat.isBlockedByMe);
    
    // ⭐ تعطيل/تفعيل الـ input بناءً على حالة البلوك
    toggleChatInput(!chat.isBlockedByMe);

    // Clear unread count
    if (chat.unreadCount > 0) {
        chat.unreadCount = 0;
        updateChatListItem(chat);
    }

    // Load messages
    await loadMessages(chat.userId);

    // Mark all messages as read (only if not blocked)
    if (!chat.isBlockedByMe) {
        await markMessagesAsRead(chat.userId);
    }
}

// ⭐ ==================== Toggle Chat Input ====================
function toggleChatInput(enabled) {
    const messageInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendBtn");
    const attachBtn = document.getElementById("attachBtn");
    const voiceRecordBtn = document.getElementById("voiceRecordBtn");
    const chatFooter = document.querySelector(".chat-footer");

    if (enabled) {
        // تفعيل الـ input
        if (messageInput) {
            messageInput.disabled = false;
            messageInput.placeholder = "Type a message...";
        }
        if (sendBtn) sendBtn.disabled = false;
        if (attachBtn) attachBtn.disabled = false;
        if (voiceRecordBtn) voiceRecordBtn.disabled = false;
        if (chatFooter) chatFooter.style.opacity = "1";
    } else {
        // تعطيل الـ input
        if (messageInput) {
            messageInput.disabled = true;
            messageInput.placeholder = "You cannot send messages to this user";
            messageInput.value = "";
        }
        if (sendBtn) sendBtn.disabled = true;
        if (attachBtn) attachBtn.disabled = true;
        if (voiceRecordBtn) voiceRecordBtn.disabled = true;
        if (chatFooter) chatFooter.style.opacity = "0.6";
    }
}

// ==================== Update Chat Header ====================
function updateChatHeader(chat) {
    const chatHeader = document.querySelector(".chat-header");
    const chatHeaderInfo = document.querySelector(".chat-header-info");
    
    // Remove existing profile picture
    const existingPic = chatHeader.querySelector(".user-avatar, .header-avatar");
    if (existingPic) existingPic.remove();

    // Add profile picture
    const profilePic = document.createElement("div");
    if (chat.imageUrl) {
        profilePic.className = "header-avatar";
        profilePic.innerHTML = `<img src="${chat.imageUrl}" alt="${chat.name}">`;
    } else {
        profilePic.className = "user-avatar";
        profilePic.textContent = chat.name.charAt(0).toUpperCase();
    }
    
    chatHeader.insertBefore(profilePic, chatHeaderInfo);

    // Update name
    document.getElementById("chatUserName").textContent = chat.name;

    // Update status
    const isOnline = onlineUsers.has(chat.userId);
    const statusElement = document.getElementById("chatUserStatus");
    if (isOnline) {
        statusElement.textContent = "online";
        statusElement.className = "user-status online";
    } else {
        // ⭐ استخدام getLastSeenText لعرض Last Seen الصحيح
        const userItem = document.querySelector(`.user-item[data-user-id="${chat.userId}"]`);
        const lastSeen = userItem ? userItem.dataset.lastseen : chat.lastSeen;
        statusElement.textContent = getLastSeenText(lastSeen);
        statusElement.className = "user-status offline";
    }
}

// ⭐ ==================== Update Block Button ====================
function updateBlockButton(isBlocked) {
    const blockBtn = document.getElementById("blockBtn");
    if (blockBtn) {
        if (isBlocked) {
            blockBtn.textContent = "Unblock";
            blockBtn.classList.add("unblock-btn");
            blockBtn.classList.remove("block-btn");
        } else {
            blockBtn.textContent = "Block";
            blockBtn.classList.add("block-btn");
            blockBtn.classList.remove("unblock-btn");
        }
    }
}

// ==================== Update Online Status ====================
// Update User Status
function updateUserStatus(userId, isOnline, lastSeen = null) {
    console.log(`updateUserStatus: userId=${userId}, isOnline=${isOnline}, lastSeen=${lastSeen}`);
    
    const statusText = isOnline ? 'online' : getLastSeenText(lastSeen);
    
    const userItem = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (userItem) {
        const statusDot = userItem.querySelector('.online-status, .offline-status');
        const statusTextElement = userItem.querySelector('.user-status-text');
        
        if (statusDot) {
            statusDot.className = isOnline ? 'online-status' : 'offline-status';
            console.log(`Updated status dot for ${userId}: ${isOnline ? 'online' : 'offline'}`);
        }
        if (statusTextElement) {
            statusTextElement.textContent = statusText;
            statusTextElement.style.color = isOnline ? '#00a884' : '#8696a0';
            console.log(`Updated status text for ${userId}: ${statusText}`);
        }
        
        if (lastSeen) {
            userItem.dataset.lastseen = lastSeen;
        }
    }

    if (userId === currentChatUserId) {
        const chatStatus = document.getElementById("chatUserStatus");
        if (chatStatus) {
            chatStatus.textContent = statusText;
            chatStatus.className = isOnline ? "user-status online" : "user-status";
            console.log(`Updated chat header status for ${userId}: ${statusText}`);
        }
    }
}

// Get Last Seen Text
function getLastSeenText(lastSeen) {
    if (!lastSeen) return 'offline';
    
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffMs = now - lastSeenDate;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'last seen just now';
    if (diffMins < 60) return `last seen ${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `last seen ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `last seen ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return `last seen ${lastSeenDate.toLocaleDateString()}`;
}

// ⭐ ==================== Load Messages (Fixed) ====================
async function loadMessages(userId) {
    try {
        console.log(`📥 Loading messages with user: ${userId}`);
        
        const response = await fetch(`${API_BASE}/OneToOneChat/messages/${userId}`, {
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (!response.ok) {
            if (response.status === 403 || response.status === 400) {
                // ⭐ المستخدم مبلوك - نعرض رسالة فارغة بدل ما نرجع للخلف
                console.log("User is blocked - showing empty messages");
                displayMessages([]);
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const messages = await response.json();
        console.log("✅ Messages loaded:", messages);
        
        displayMessages(messages);
        
    } catch (error) {
        console.error("❌ Error loading messages:", error);
    }
}

// ⭐ ==================== Display Messages (Fixed) ====================
function displayMessages(messages) {
    const messagesContainer = document.getElementById("messagesContainer");
    if (!messagesContainer) return;

    messagesContainer.innerHTML = "";

    if (messages.length === 0) {
        messagesContainer.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #8696a0;">
                <p>No messages yet. Start the conversation!</p>
            </div>
        `;
        return;
    }

    // Find unread messages
    const unreadMessages = messages.filter(m => 
        m.receiverId === currentUserId && !m.readAt
    );
    const firstUnreadIndex = unreadMessages.length > 0 
        ? messages.findIndex(m => m.id === unreadMessages[0].id)
        : -1;

    messages.forEach((message, index) => {
        // Add unread divider before first unread message
        if (index === firstUnreadIndex && firstUnreadIndex > 0) {
            const divider = document.createElement("div");
            divider.className = "unread-divider";
            divider.innerHTML = `<span>Unread Messages</span>`;
            messagesContainer.appendChild(divider);
        }

        const messageDiv = createMessageElement(message);
        messagesContainer.appendChild(messageDiv);
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ⭐ ==================== Create Message Element (Fixed) ====================
function createMessageElement(message) {
    const messageDiv = document.createElement("div");
    const isSent = message.senderId === currentUserId;
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.dataset.messageId = message.id;

    let content = "";

    // Reply preview
    if (message.replyToMessageId) {
        const replyClass = isSent ? 'reply-preview-sent' : 'reply-preview-received';
        content += `
            <div class="${replyClass}">
                <div class="reply-line"></div>
                <div class="reply-content">
                    <p class="reply-text">${escapeHtml(message.replyToText || 'Media')}</p>
                </div>
            </div>
        `;
    }

    // Message content based on type
    switch (message.type) {
        case 0: // Text
            content += `<div class="message-text">${escapeHtml(message.textContent || message.text || '')}</div>`;
            break;
        case 1: // Image
            const imageUrl = message.mediaUrl || message.media;
            if (imageUrl) {
                content += `<img src="${imageUrl}" alt="Image" class="message-media" onclick="openMediaPreview('${imageUrl}', 'image')">`;
            }
            break;
        case 2: // Video
            const videoUrl = message.mediaUrl || message.media;
            if (videoUrl) {
                content += `
                    <video class="message-media" controls>
                        <source src="${videoUrl}" type="video/mp4">
                    </video>
                `;
            }
            break;
        case 3: // Voice
            const voiceUrl = message.mediaUrl || message.media;
            if (voiceUrl) {
                content += `
                    <div class="voice-message">
                        <audio controls>
                            <source src="${voiceUrl}" type="audio/webm">
                        </audio>
                        <span class="voice-duration">${formatDuration(message.mediaDuration)}</span>
                    </div>
                `;
            }
            break;
    }

    // Message time and status
    const messageTime = new Date(message.createdAt);
    const timeString = messageTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // ⭐ Add read/delivered status for sent messages
    let statusIcon = '';
    if (isSent) {
        if (message.readAt) {
            statusIcon = '<span class="message-status read">✓✓</span>';
        } else if (message.deliveredAt) {
            statusIcon = '<span class="message-status delivered">✓✓</span>';
        } else {
            statusIcon = '<span class="message-status sent">✓</span>';
        }
    }

    content += `
        <div class="message-time">
            ${timeString}
            ${statusIcon}
        </div>
    `;

    messageDiv.innerHTML = content;

    // Add context menu (right-click)
    messageDiv.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMessageContextMenu(e, message);
    });

    return messageDiv;
}

// ⭐ ==================== Update Message Status ====================
function updateMessageStatus(messageId, status) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;
    
    const statusIcon = messageElement.querySelector('.status-icon, .message-status');
    if (!statusIcon) return;
    
    if (status === 'delivered') {
        statusIcon.className = statusIcon.classList.contains('status-icon') ? 'status-icon delivered' : 'message-status delivered';
        statusIcon.textContent = '✓✓';
    } else if (status === 'read') {
        statusIcon.className = statusIcon.classList.contains('status-icon') ? 'status-icon read' : 'message-status read';
        statusIcon.textContent = '✓✓';
    }
    
    console.log(`Message ${messageId} status updated to ${status}`);
}

// ==================== Message Context Menu ====================
function showMessageContextMenu(event, message) {
    // Remove existing menu
    const existingMenu = document.querySelector(".context-menu");
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.position = "fixed";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const isSent = message.senderId === currentUserId;
    const messageText = message.textContent || message.text || 'Media';

    menu.innerHTML = `
        <div class="context-menu-item" onclick="replyToMessageAction(${message.id}, '${escapeHtml(messageText)}')">
            Reply
        </div>
        ${isSent ? `
        <div class="context-menu-item" onclick="deleteMessageForMe(${message.id})">
            Delete for me
        </div>
        <div class="context-menu-item" onclick="deleteMessageForEveryone(${message.id})">
            Delete for everyone
        </div>
        ` : `
        <div class="context-menu-item" onclick="deleteMessageForMe(${message.id})">
            Delete for me
        </div>
        `}
    `;

    document.body.appendChild(menu);

    // Close menu on click outside
    setTimeout(() => {
        document.addEventListener("click", function closeMenu() {
            menu.remove();
            document.removeEventListener("click", closeMenu);
        });
    }, 100);
}

// Reply to message action
function replyToMessageAction(messageId, messageText) {
    replyToMessage = { id: messageId, text: messageText };
    
    // Show reply preview in input area
    const inputArea = document.querySelector(".message-input-area");
    let replyPreview = inputArea.querySelector(".reply-preview-input");
    
    if (!replyPreview) {
        replyPreview = document.createElement("div");
        replyPreview.className = "reply-preview-input";
        inputArea.insertBefore(replyPreview, inputArea.firstChild);
    }
    
    replyPreview.innerHTML = `
        <div class="reply-line"></div>
        <div class="reply-content">
            <p class="reply-label">Replying to</p>
            <p class="reply-text">${escapeHtml(messageText)}</p>
        </div>
        <button class="cancel-reply" onclick="cancelReply()">✕</button>
    `;
    
    document.getElementById("messageInput").focus();
}

// Cancel reply
function cancelReply() {
    replyToMessage = null;
    const replyPreview = document.querySelector(".reply-preview-input");
    if (replyPreview) replyPreview.remove();
}

// ==================== Send Message ====================
async function sendMessage() {
    const messageInput = document.getElementById("messageInput");
    const text = messageInput.value.trim();

    // ⭐ التحقق من أن الـ input مش معطل
    if (messageInput.disabled) {
        console.log("Cannot send message - input is disabled");
        return;
    }

    if (!text || !currentChatUserId) return;

    try {
        const formData = new FormData();
        formData.append("ReceiverId", currentChatUserId);
        formData.append("Type", 0); // Text
        formData.append("Text", text);

        let endpoint = `${API_BASE}/OneToOneChat/SendMessage`;
        
        // If replying to a message
        if (replyToMessage) {
            formData.append("ReplyToMessageId", replyToMessage.id);
            endpoint = `${API_BASE}/OneToOneChat/ReplyToMessage`;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const message = await response.json();
        console.log("✅ Message sent:", message);

        // Clear input
        messageInput.value = "";
        cancelReply();

        // Stop typing
        handleTypingStop();
        
    } catch (error) {
        console.error("❌ Error sending message:", error);
        alert("Failed to send message");
    }
}

// ==================== Send Media Message ====================
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !currentChatUserId) return;

    const fileType = file.type.startsWith('image') ? 1 : 
                     file.type.startsWith('video') ? 2 : null;

    if (fileType === null) {
        alert("Unsupported file type");
        return;
    }

    try {
        const formData = new FormData();
        formData.append("ReceiverId", currentChatUserId);
        formData.append("Type", fileType);
        formData.append("File", file);

        const response = await fetch(`${API_BASE}/OneToOneChat/SendMessage`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const message = await response.json();
        console.log("✅ Media sent:", message);

        // Reset file input
        e.target.value = "";
        
    } catch (error) {
        console.error("❌ Error sending media:", error);
        alert("Failed to send media");
    }
}

// ==================== Voice Recording ====================
async function toggleVoiceRecording() {
    if (isRecording) {
        stopVoiceRecording();
    } else {
        await startVoiceRecording();
    }
}

async function startVoiceRecording() {
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

        // Show recording indicator
        document.getElementById("voiceRecordingIndicator").style.display = "flex";
        document.querySelector(".message-input-area").style.display = "none";

        // Start recording timer
        recordingInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            document.getElementById("recordingTime").textContent = 
                `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);

    } catch (error) {
        console.error("Error starting recording:", error);
        alert("Could not access microphone");
    }
}

function stopVoiceRecording() {
    if (!mediaRecorder || !isRecording) return;

    mediaRecorder.stop();
    isRecording = false;

    clearInterval(recordingInterval);
    recordingInterval = null;

    mediaRecorder.stream.getTracks().forEach(track => track.stop());
}

function cancelVoiceRecording() {
    stopVoiceRecording();
    audioChunks = [];
    document.getElementById("voiceRecordingIndicator").style.display = "none";
    document.querySelector(".message-input-area").style.display = "flex";
}

async function sendVoiceMessage() {
    if (!mediaRecorder) {
        console.error("No media recorder");
        return;
    }

    // Stop recording first
    if (isRecording) {
        stopVoiceRecording();
    }

    // Wait for the recording to finish
    await new Promise((resolve) => {
        mediaRecorder.onstop = () => {
            resolve();
        };
    });

    if (audioChunks.length === 0) {
        console.error("No audio chunks");
        return;
    }

    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

    console.log("📤 Sending voice message, duration:", duration, "seconds");

    try {
        const formData = new FormData();
        formData.append("ReceiverId", currentChatUserId);
        formData.append("Type", 3); // Voice
        formData.append("File", audioBlob, "voice.webm");
        formData.append("MediaDuration", duration);

        const response = await fetch(`${API_BASE}/OneToOneChat/SendMessage`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Server error:", errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const message = await response.json();
        console.log("✅ Voice message sent:", message);

        // Reset
        audioChunks = [];
        document.getElementById("voiceRecordingIndicator").style.display = "none";
        document.querySelector(".message-input-area").style.display = "flex";
        
    } catch (error) {
        console.error("❌ Error sending voice message:", error);
        alert("Failed to send voice message: " + error.message);
        
        // Reset UI anyway
        audioChunks = [];
        document.getElementById("voiceRecordingIndicator").style.display = "none";
        document.querySelector(".message-input-area").style.display = "flex";
    }
}

// ==================== Typing Indicators ====================
function handleTypingStart() {
    if (!currentChatUserId || isTyping) return;

    isTyping = true;
    connection.invoke("Typing", currentChatUserId).catch(err => console.error(err));

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(handleTypingStop, 3000);
}

function handleTypingStop() {
    if (!currentChatUserId || !isTyping) return;

    isTyping = false;
    connection.invoke("StopTyping", currentChatUserId).catch(err => console.error(err));
}

function showTypingIndicator(userName) {
    const indicator = document.getElementById("typingIndicator");
    if (indicator) {
        indicator.style.display = "block";
        indicator.querySelector(".typing-text").textContent = `${userName} is typing...`;
    }
}

function hideTypingIndicator() {
    const indicator = document.getElementById("typingIndicator");
    if (indicator) {
        indicator.style.display = "none";
    }
}

// ⭐ ==================== Mark Messages as Read (Fixed) ====================
async function markMessagesAsRead(userId) {
    try {
        const response = await fetch(`${API_BASE}/OneToOneChat/MarkAsRead/${userId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (response.ok) {
            console.log("✅ Messages marked as read");
        }
    } catch (error) {
        console.error("❌ Error marking messages as read:", error);
    }
}

// ⭐ ==================== Delete Messages (Fixed) ====================
async function deleteMessageForMe(messageId) {
    try {
        const response = await fetch(`${API_BASE}/OneToOneChat/DeleteMessageForMe/${messageId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (response.ok) {
            console.log("✅ Message deleted for me");
            removeOrUpdateMessageInUI(messageId, false);
        }
    } catch (error) {
        console.error("❌ Error deleting message:", error);
    }
}

async function deleteMessageForEveryone(messageId) {
    if (!confirm("Delete this message for everyone?")) return;

    try {
        const response = await fetch(`${API_BASE}/OneToOneChat/DeleteMessageForEveryone/${messageId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (response.ok) {
            console.log("✅ Message deleted for everyone");
            removeOrUpdateMessageInUI(messageId, true);
        } else {
            const error = await response.json();
            alert(error.message || "Could not delete message");
        }
    } catch (error) {
        console.error("❌ Error deleting message for everyone:", error);
        alert("Failed to delete message");
    }
}

function removeOrUpdateMessageInUI(messageId, deletedForEveryone) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        if (deletedForEveryone) {
            // Update message to show "This message was deleted"
            const textDiv = messageElement.querySelector('.message-text');
            if (textDiv) {
                textDiv.textContent = "This message was deleted";
                textDiv.style.fontStyle = "italic";
                textDiv.style.color = "#8696a0";
            }
            // Remove media if exists
            const media = messageElement.querySelector('.message-media, .voice-message');
            if (media) media.remove();
        } else {
            // Remove completely for "delete for me"
            messageElement.remove();
        }
    }
}

// ⭐ ==================== Clear Chat ====================
async function handleClearChat() {
    if (!currentChatUserId) return;
    
    if (!confirm(`Are you sure you want to clear all messages with ${currentChatUserName}?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/OneToOneChat/ClearChat/${currentChatUserId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (response.ok) {
            console.log("✅ Chat cleared");
            // Reload messages
            await loadMessages(currentChatUserId);
            // Reload chat list
            await loadChatList();
        }
    } catch (error) {
        console.error("❌ Error clearing chat:", error);
        alert("Failed to clear chat");
    }
}

// ⭐ ==================== Block/Unblock User ====================
async function handleBlockUnblock() {
    if (!currentChatUserId) return;

    const blockBtn = document.getElementById("blockBtn");
    const isCurrentlyBlocked = blockBtn.textContent === "Unblock";
    
    const action = isCurrentlyBlocked ? "unblock" : "block";
    const endpoint = isCurrentlyBlocked 
        ? `${API_BASE}/OneToOneChat/UnblockUser`
        : `${API_BASE}/OneToOneChat/BlockUser`;

    if (!confirm(`Are you sure you want to ${action} ${currentChatUserName}?`)) {
        return;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ UserId: currentChatUserId })
        });

        if (response.ok) {
            console.log(`✅ User ${action}ed`);
            
            // Update button
            updateBlockButton(!isCurrentlyBlocked);
            
            // ⭐ تحديث حالة الـ input
            toggleChatInput(isCurrentlyBlocked); // إذا كان مبلوك وعملنا unblock → نفعل input
            
            // Reload chat list
            await loadChatList();
            
            alert(`${currentChatUserName} has been ${action}ed`);
        }
    } catch (error) {
        console.error(`❌ Error ${action}ing user:`, error);
        alert(`Failed to ${action} user`);
    }
}

// ==================== Handle Received Message ====================
function handleReceivedMessage(message) {
    // If message is for current chat, append it
    if (message.senderId === currentChatUserId || message.receiverId === currentChatUserId) {
        const messagesContainer = document.getElementById("messagesContainer");
        if (messagesContainer && document.getElementById("chatScreen").style.display !== "none") {
            const messageElement = createMessageElement(message);
            messagesContainer.appendChild(messageElement);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            // Mark as read if we're the receiver and chat is open
            if (message.receiverId === currentUserId) {
                markMessagesAsRead(currentChatUserId);
            }
        } else {
            // Chat is not open, just mark as delivered
            if (message.receiverId === currentUserId && message.id) {
                markMessageAsDelivered(message.id);
            }
        }
    } else {
        // Message is not for current chat, mark as delivered if we're receiver
        if (message.receiverId === currentUserId && message.id) {
            markMessageAsDelivered(message.id);
        }
    }

    // Reload chat list to update last message
    loadChatList();
}

// ⭐ ==================== Mark Single Message as Delivered ====================
async function markMessageAsDelivered(messageId) {
    try {
        const response = await fetch(`${API_BASE}/OneToOneChat/MarkAsDelivered/${messageId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`
            }
        });

        if (response.ok) {
            console.log("✅ Message marked as delivered:", messageId);
        }
    } catch (error) {
        console.error("❌ Error marking message as delivered:", error);
    }
}

// ⭐ Mark undelivered messages as delivered when user comes online
async function markUndeliveredMessagesAsDelivered(userId) {
    try {
        if (currentChatUserId === userId) {
            const messages = document.querySelectorAll('.message.sent[data-message-id]');
            
            for (const msgElement of messages) {
                const messageId = msgElement.getAttribute('data-message-id');
                const statusIcon = msgElement.querySelector('.status-icon, .message-status');
                
                if (statusIcon && statusIcon.classList.contains('sent')) {
                    await markMessageAsDelivered(messageId);
                }
            }
        }
    } catch (error) {
        console.error("Error marking undelivered messages:", error);
    }
}

// ==================== Update Chat List Item ====================
function updateChatListItem(chat) {
    const userItem = document.querySelector(`.user-item[data-user-id="${chat.userId}"]`);
    if (userItem) {
        // Update unread badge
        const unreadBadge = userItem.querySelector(".unread-badge");
        if (chat.unreadCount > 0) {
            if (unreadBadge) {
                unreadBadge.textContent = chat.unreadCount;
            } else {
                const metaDiv = userItem.querySelector(".user-meta");
                const badge = document.createElement("span");
                badge.className = "unread-badge";
                badge.textContent = chat.unreadCount;
                metaDiv.insertBefore(badge, metaDiv.lastElementChild);
            }
        } else {
            if (unreadBadge) unreadBadge.remove();
        }
    }
}

// ==================== Call Functions ====================
async function initiateCall(callType) {
    if (!currentChatUserId || !currentChatUserName) {
        alert("Please select a user to call");
        return;
    }

    try {
        console.log(`📞 Initiating ${callType === 1 ? 'video' : 'voice'} call to ${currentChatUserName}`);
        
        // Open call window
        const width = callType === 1 ? 1000 : 800;
        const height = callType === 1 ? 700 : 600;

        window.open(
            `call.html?receiverId=${currentChatUserId}&receiverName=${encodeURIComponent(currentChatUserName)}&callType=${callType}`,
            'CallWindow',
            `width=${width},height=${height},resizable=yes,scrollbars=no,status=no,toolbar=no,menubar=no,location=no`
        );

    } catch (error) {
        console.error("❌ Error initiating call:", error);
        alert("Failed to initiate call");
    }
}

function showIncomingCallNotification(callData) {
    const notification = document.getElementById("incomingCallNotification");
    const callerName = document.getElementById("notifCallerName");
    const callerInitial = document.getElementById("notifCallerInitial");
    const callType = document.getElementById("notifCallType");

    if (notification && callerName && callerInitial && callType) {
        callerName.textContent = callData.callerName;
        callerInitial.textContent = callData.callerName.charAt(0).toUpperCase();
        callType.textContent = callData.callType === 1 ? "📹 Video Call" : "📞 Voice Call";
        
        notification.style.display = "flex";
    }
}

function hideIncomingCallNotification() {
    const notification = document.getElementById("incomingCallNotification");
    if (notification) {
        notification.style.display = "none";
    }
}

function playRingtone() {
    if (ringtoneAudio) {
        ringtoneAudio.play().catch(e => console.log("Could not play ringtone:", e));
    }
}

function stopRingtone() {
    if (ringtoneAudio) {
        ringtoneAudio.pause();
        ringtoneAudio.currentTime = 0;
    }
}

async function acceptIncomingCall() {
    if (!pendingIncomingCall) return;

    stopRingtone();
    hideIncomingCallNotification();

    const { callId, callerId, callerName, callType } = pendingIncomingCall;

    const width = callType === 1 ? 1000 : 800;
    const height = callType === 1 ? 700 : 600;

    const callWindow = window.open(
        `call.html?callId=${callId}&callerId=${callerId}&callerName=${encodeURIComponent(callerName)}&callType=${callType}`,
        'CallWindow',
        `width=${width},height=${height},resizable=yes,scrollbars=no,status=no,toolbar=no,menubar=no,location=no`
    );

    if (!callWindow) {
        alert("Please allow popups to receive calls.");
        try {
            await callConnection.invoke("RejectCall", callId);
        } catch (error) {
            console.error("Error rejecting call:", error);
        }
    }

    pendingIncomingCall = null;
}

async function declineIncomingCall() {
    if (!pendingIncomingCall) return;

    try {
        await callConnection.invoke("RejectCall", pendingIncomingCall.callId);
        stopRingtone();
        hideIncomingCallNotification();
        pendingIncomingCall = null;
    } catch (error) {
        console.error("Error declining call:", error);
    }
}

// ==================== Utility Functions ====================
function toggleAttachMenu() {
    const menu = document.getElementById("attachMenu");
    if (menu) {
        menu.style.display = menu.style.display === "none" ? "block" : "none";
    }
}

async function backToUsersList() {
    // ⭐ Mark messages as read before leaving if chat was open
    if (currentChatUserId) {
        await markMessagesAsRead(currentChatUserId);
    }
    
    currentChatUserId = null;
    currentChatUserName = null;
    document.getElementById("chatScreen").style.display = "none";
    document.getElementById("welcomeScreen").style.display = "flex";
    
    // ⭐ Reload chat list to update unread counts
    await loadChatList();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDuration(seconds) {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function openMediaPreview(url, type) {
    window.open(url, '_blank');
}

async function handleLogout() {
    if (confirm("Are you sure you want to logout?")) {
        try {
            if (connection) await connection.stop();
            if (callConnection) await callConnection.stop();
            
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");
            window.location.href = "index.html";
        } catch (error) {
            console.error("Error during logout:", error);
        }
    }
}

console.log("✅ chat.js loaded successfully!");