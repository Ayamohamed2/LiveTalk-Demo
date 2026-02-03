// Configuration
const API_BASE = "https://livetalk.runasp.net/api";
const CALL_HUB_URL = "https://livetalk.runasp.net/callHub";

// Global Variables
let callConnection = null;
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallId = null;
let currentCallType = null; // 0 = Voice, 1 = Video
let callStartTime = null;
let callTimer = null;
let isMuted = false;
let isVideoEnabled = true;
let isCaller = false;
let otherUserId = null;
let otherUserName = null;
let currentUserId = null;
let isCallActive = false;
let pendingIceCandidates = [];

// ICE Servers Configuration
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

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

    console.log("Initializing call page...");
    
    // Get current user ID
    const token = getAccessToken();
    const payload = JSON.parse(atob(token.split('.')[1]));
    currentUserId = payload.sub || payload.nameid;
    console.log("Current User ID:", currentUserId);
    
    // Get call parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const receiverId = urlParams.get('receiverId');
    const receiverName = urlParams.get('receiverName');
    const callType = parseInt(urlParams.get('callType') || '0');
    const incomingCallId = urlParams.get('callId');
    const callerId = urlParams.get('callerId');
    const callerName = urlParams.get('callerName');

    await connectToCallHub();
    setupEventListeners();

    // If it's an outgoing call
    if (receiverId && receiverName && !incomingCallId) {
        otherUserId = receiverId;
        otherUserName = receiverName;
        currentCallType = callType;
        isCaller = true;
        
        updateCallUI("Calling...", receiverName, callType);
        showProperContainer(callType);
        await initiateCall(receiverId, receiverName, callType);
    }
    // If it's an incoming call (opened from notification)
    else if (incomingCallId && callerId && callerName) {
        currentCallId = incomingCallId;
        currentCallType = callType;
        otherUserId = callerId;
        otherUserName = decodeURIComponent(callerName);
        isCaller = false;
        
        updateCallUI("Connecting...", otherUserName, currentCallType);
        showProperContainer(currentCallType);
        
        // Auto-accept the call since user clicked accept
        console.log("Auto-accepting incoming call:", incomingCallId);
        await acceptCall();
    }
});

// Connect to SignalR Call Hub
async function connectToCallHub() {
    try {
        console.log("Connecting to Call Hub...");
        
        callConnection = new signalR.HubConnectionBuilder()
            .withUrl(`${CALL_HUB_URL}?access_token=${getAccessToken()}`, {
                skipNegotiation: true,
                transport: signalR.HttpTransportType.WebSockets
            })
            .configureLogging(signalR.LogLevel.Information)
            .withAutomaticReconnect()
            .build();

        // Setup SignalR event handlers
        setupCallHubEvents();

        await callConnection.start();
        console.log("✅ Connected to Call Hub!");
        
    } catch (error) {
        console.error("Error connecting to Call Hub:", error);
        showStatus("Connection failed. Please try again.", "error");
        setTimeout(() => {
            cleanupAndClose();
        }, 3000);
    }
}

// Setup Call Hub Events
function setupCallHubEvents() {
    // Call Initiated
    callConnection.on("CallInitiated", async (data) => {
        console.log("CallInitiated event:", data);
        currentCallId = data.callId;
        currentCallType = data.callType;
        otherUserId = data.receiverId;
        otherUserName = data.receiverName;
        
        updateCallUI("Calling...", data.receiverName, data.callType);
        showProperContainer(data.callType);
        playRingtone();
        
        // Setup local media immediately
        await setupLocalMedia(data.callType);
    });

    // Incoming Call (this shouldn't normally fire in call.html, but just in case)
    callConnection.on("IncomingCall", async (data) => {
        console.log("IncomingCall event:", data);
        currentCallId = data.callId;
        currentCallType = data.callType;
        otherUserId = data.callerId;
        otherUserName = data.callerName;
        isCaller = false;
        
        showIncomingCallModal(data);
        playRingtone();
    });

    // Call Accepted
    callConnection.on("CallAccepted", async (data) => {
        console.log("CallAccepted event:", data);
        stopRingtone();
        updateCallUI("Connecting...", otherUserName, currentCallType);
        
        // Caller creates offer
        if (isCaller) {
            console.log("I'm the caller, creating offer...");
            await createOffer();
        }
    });

    // Call Connected
    callConnection.on("CallConnected", async (data) => {
        console.log("CallConnected event:", data);
        stopRingtone();
        updateCallUI("Connected", otherUserName, currentCallType);
        
        // Receiver sets up media and waits for offer
        if (!isCaller) {
            console.log("I'm the receiver, setting up media...");
            await setupLocalMedia(currentCallType);
        }
    });

    // Call Rejected
    callConnection.on("CallRejected", async (data) => {
        console.log("CallRejected event:", data);
        stopRingtone();
        
        // Save rejected call log
        await saveCallLog("Rejected", 0);
        
        showStatus("Call was rejected", "error");
        
        setTimeout(() => {
            cleanupAndClose();
        }, 2000);
    });

    // Call Busy
    callConnection.on("CallBusy", async (userId) => {
        console.log("CallBusy event:", userId);
        stopRingtone();
        
        // Save busy call log
        await saveCallLog("Busy", 0);
        
        showStatus("User is busy on another call", "error");
        
        setTimeout(() => {
            cleanupAndClose();
        }, 2000);
    });

    // Call Ended
    callConnection.on("CallEnded", async (data) => {
        console.log("CallEnded event:", data);
        stopRingtone();
        playCallEndSound();
        
        const duration = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
        await saveCallLog("Ended", duration);
        
        showStatus("Call ended", "success");
        
        setTimeout(() => {
            cleanupAndClose();
        }, 2000);
    });

    // Call Terminated
    callConnection.on("CallTerminated", (data) => {
        console.log("CallTerminated event:", data);
        cleanupAndClose();
    });

    // WebRTC Signaling - Receive Offer
    callConnection.on("ReceiveOffer", async (data) => {
        console.log("ReceiveOffer event:", data);
        await handleOffer(data.offer);
    });

    // WebRTC Signaling - Receive Answer
    callConnection.on("ReceiveAnswer", async (data) => {
        console.log("ReceiveAnswer event:", data);
        await handleAnswer(data.answer);
    });

    // WebRTC Signaling - Receive ICE Candidate
    callConnection.on("ReceiveIceCandidate", async (data) => {
        console.log("ReceiveIceCandidate event:", data);
        await handleIceCandidate(data.candidate);
    });

    // User Mute Status Changed
    callConnection.on("UserMuteStatusChanged", (data) => {
        console.log("UserMuteStatusChanged event:", data);
        if (data.isMuted) {
            showStatus(`${otherUserName} muted`, "");
        } else {
            showStatus(`${otherUserName} unmuted`, "");
        }
    });

    // Connection events
    callConnection.onreconnecting((error) => {
        console.log("Call Hub reconnecting...", error);
    });

    callConnection.onreconnected((connectionId) => {
        console.log("Call Hub reconnected:", connectionId);
    });

    callConnection.onclose((error) => {
        console.log("Call Hub connection closed:", error);
    });
}

// Setup Event Listeners
function setupEventListeners() {
    // End Call Button
    const endCallBtn = document.getElementById("endCallBtn");
    if (endCallBtn) {
        endCallBtn.addEventListener("click", endCall);
    }

    // Toggle Mute Button
    const muteBtn = document.getElementById("toggleMuteBtn");
    if (muteBtn) {
        muteBtn.addEventListener("click", toggleMute);
    }

    // Toggle Video Button
    const videoBtn = document.getElementById("toggleVideoBtn");
    if (videoBtn) {
        videoBtn.addEventListener("click", toggleVideo);
    }

    // Accept Call Button
    const acceptBtn = document.getElementById("acceptCallBtn");
    if (acceptBtn) {
        acceptBtn.addEventListener("click", async () => {
            hideIncomingCallModal();
            await acceptCall();
        });
    }

    // Reject Call Button
    const rejectBtn = document.getElementById("rejectCallBtn");
    if (rejectBtn) {
        rejectBtn.addEventListener("click", rejectCall);
    }
}

// Call Actions
async function initiateCall(receiverId, receiverName, callType) {
    try {
        console.log(`Initiating ${callType === 1 ? 'video' : 'voice'} call to:`, receiverName);
        
        // Setup local media first
        await setupLocalMedia(callType);
        
        // Then initiate call through SignalR
        await callConnection.invoke("InitiateCall", receiverId, receiverName, callType);
        
    } catch (error) {
        console.error("Error initiating call:", error);
        showStatus("Failed to initiate call", "error");
        setTimeout(() => {
            cleanupAndClose();
        }, 2000);
    }
}

async function acceptCall() {
    try {
        console.log("Accepting call:", currentCallId);
        hideIncomingCallModal();
        stopRingtone();
        
        updateCallUI("Connecting...", otherUserName, currentCallType);
        showProperContainer(currentCallType);
        
        // Setup local media
        await setupLocalMedia(currentCallType);
        
        // Accept call through SignalR
        await callConnection.invoke("AcceptCall", currentCallId);
        
    } catch (error) {
        console.error("Error accepting call:", error);
        showStatus("Failed to accept call", "error");
    }
}

async function rejectCall() {
    try {
        console.log("Rejecting call:", currentCallId);
        hideIncomingCallModal();
        stopRingtone();
        
        await callConnection.invoke("RejectCall", currentCallId);
        
        // Save rejected call log
        await saveCallLog("Rejected", 0);
        
        showStatus("Call rejected", "");
        
        setTimeout(() => {
            cleanupAndClose();
        }, 1000);
        
    } catch (error) {
        console.error("Error rejecting call:", error);
        cleanupAndClose();
    }
}

async function endCall() {
    try {
        console.log("Ending call:", currentCallId);
        
        const duration = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
        
        // Save call log before ending
        await saveCallLog("Ended", duration);
        
        // End call through SignalR
        if (callConnection && currentCallId) {
            await callConnection.invoke("EndCall", currentCallId);
        }
        
        playCallEndSound();
        showStatus("Call ended", "success");
        
        setTimeout(() => {
            cleanupAndClose();
        }, 1000);
        
    } catch (error) {
        console.error("Error ending call:", error);
        cleanupAndClose();
    }
}

// WebRTC Functions
async function setupLocalMedia(callType) {
    try {
        console.log("Setting up local media for type:", callType);
        
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: callType === 1 ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user"
            } : false
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("Got local stream:", localStream.id);

        // Display local video
        const localVideo = document.getElementById("localVideo");
        if (localVideo && callType === 1) {
            localVideo.srcObject = localStream;
            localVideo.style.display = "block";
        }

        // Create peer connection
        await createPeerConnection();

        // Add local stream to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
            console.log("Added track to peer connection:", track.kind);
        });

        // Show/hide video controls
        const videoBtn = document.getElementById("toggleVideoBtn");
        if (videoBtn) {
            videoBtn.style.display = callType === 1 ? "flex" : "none";
        }

    } catch (error) {
        console.error("Error accessing media devices:", error);
        showStatus("Failed to access camera/microphone", "error");
        
        if (error.name === 'NotAllowedError') {
            showStatus("Please allow camera and microphone access", "error");
        }
        
        setTimeout(() => {
            cleanupAndClose();
        }, 3000);
    }
}

async function createPeerConnection() {
    try {
        console.log("Creating peer connection...");
        
        peerConnection = new RTCPeerConnection(iceServers);

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("New ICE candidate:", event.candidate);
                callConnection.invoke("SendIceCandidate", currentCallId, otherUserId, event.candidate)
                    .catch(err => console.error("Error sending ICE candidate:", err));
            }
        };

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log("Received remote track:", event.track.kind);
            
            if (!remoteStream) {
                remoteStream = new MediaStream();
                const remoteVideo = document.getElementById("remoteVideo");
                if (remoteVideo) {
                    remoteVideo.srcObject = remoteStream;
                }
            }
            
            remoteStream.addTrack(event.track);
            
            // Start call timer when we receive first track
            if (!isCallActive) {
                isCallActive = true;
                startCallTimer();
                updateCallUI("Connected", otherUserName, currentCallType);
                
                // Hide overlay for video calls after connection
                if (currentCallType === 1) {
                    setTimeout(() => {
                        hideCallInfoOverlay();
                    }, 2000);
                }
            }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log("Connection state:", peerConnection.connectionState);
            
            if (peerConnection.connectionState === 'connected') {
                console.log("✅ Peer connection established!");
            } else if (peerConnection.connectionState === 'failed' || 
                       peerConnection.connectionState === 'disconnected') {
                console.log("❌ Peer connection failed or disconnected");
                showStatus("Connection lost", "error");
                setTimeout(() => {
                    endCall();
                }, 2000);
            }
        };

        // Handle ICE connection state changes
        peerConnection.oniceconnectionstatechange = () => {
            console.log("ICE connection state:", peerConnection.iceConnectionState);
        };

        console.log("✅ Peer connection created!");
        
    } catch (error) {
        console.error("Error creating peer connection:", error);
        throw error;
    }
}

async function createOffer() {
    try {
        console.log("Creating offer...");
        
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: currentCallType === 1
        });
        
        await peerConnection.setLocalDescription(offer);
        console.log("Local description set (offer)");
        
        // Send offer to other peer
        await callConnection.invoke("SendOffer", currentCallId, otherUserId, offer);
        console.log("Offer sent to:", otherUserId);
        
    } catch (error) {
        console.error("Error creating offer:", error);
        showStatus("Failed to establish connection", "error");
    }
}

async function handleOffer(offer) {
    try {
        console.log("Handling offer...");
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("Remote description set (offer)");
        
        // Process any pending ICE candidates
        if (pendingIceCandidates.length > 0) {
            console.log(`Processing ${pendingIceCandidates.length} pending ICE candidates`);
            for (const candidate of pendingIceCandidates) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            pendingIceCandidates = [];
        }
        
        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log("Local description set (answer)");
        
        // Send answer to other peer
        await callConnection.invoke("SendAnswer", currentCallId, otherUserId, answer);
        console.log("Answer sent to:", otherUserId);
        
    } catch (error) {
        console.error("Error handling offer:", error);
        showStatus("Failed to establish connection", "error");
    }
}

async function handleAnswer(answer) {
    try {
        console.log("Handling answer...");
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("Remote description set (answer)");
        
        // Process any pending ICE candidates
        if (pendingIceCandidates.length > 0) {
            console.log(`Processing ${pendingIceCandidates.length} pending ICE candidates`);
            for (const candidate of pendingIceCandidates) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            pendingIceCandidates = [];
        }
        
    } catch (error) {
        console.error("Error handling answer:", error);
        showStatus("Failed to establish connection", "error");
    }
}

async function handleIceCandidate(candidate) {
    try {
        if (!peerConnection) {
            console.log("Peer connection not ready, queuing ICE candidate");
            pendingIceCandidates.push(candidate);
            return;
        }
        
        if (!peerConnection.remoteDescription) {
            console.log("Remote description not set, queuing ICE candidate");
            pendingIceCandidates.push(candidate);
            return;
        }
        
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("ICE candidate added");
        
    } catch (error) {
        console.error("Error handling ICE candidate:", error);
    }
}

// Media Controls
async function toggleMute() {
    if (!localStream) return;
    
    isMuted = !isMuted;
    
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    const muteBtn = document.getElementById("toggleMuteBtn");
    if (isMuted) {
        muteBtn.classList.add("muted");
        showStatus("Microphone muted", "");
    } else {
        muteBtn.classList.remove("muted");
        showStatus("Microphone unmuted", "");
    }
    
    // Notify other user
    try {
        await callConnection.invoke("ToggleMute", currentCallId, isMuted);
    } catch (error) {
        console.error("Error toggling mute:", error);
    }
}

function toggleVideo() {
    if (!localStream || currentCallType !== 1) return;
    
    isVideoEnabled = !isVideoEnabled;
    
    localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideoEnabled;
    });
    
    const videoBtn = document.getElementById("toggleVideoBtn");
    if (!isVideoEnabled) {
        videoBtn.classList.add("disabled");
        showStatus("Camera disabled", "");
    } else {
        videoBtn.classList.remove("disabled");
        showStatus("Camera enabled", "");
    }
}

// UI Functions
function showProperContainer(callType) {
    const videoContainer = document.getElementById("videoContainer");
    const voiceContainer = document.getElementById("voiceContainer");
    
    if (callType === 1) {
        // Video call
        videoContainer.style.display = "block";
        voiceContainer.style.display = "none";
    } else {
        // Voice call
        videoContainer.style.display = "none";
        voiceContainer.style.display = "flex";
    }
}

function updateCallUI(status, userName, callType) {
    // Update user name
    document.getElementById("callUserName").textContent = userName;
    document.getElementById("voiceUserName").textContent = userName;
    
    // Update initial
    const initial = userName ? userName.charAt(0).toUpperCase() : 'U';
    document.getElementById("callUserInitial").textContent = initial;
    document.getElementById("voiceUserInitial").textContent = initial;
    
    // Update status
    if (status) {
        document.getElementById("callStatus").textContent = status;
        document.getElementById("voiceCallStatus").textContent = status;
    }
}

function showIncomingCallModal(data) {
    const modal = document.getElementById("incomingCallModal");
    const callerName = document.getElementById("incomingCallerName");
    const callTypeText = document.getElementById("incomingCallType");
    const userInitial = document.getElementById("incomingUserInitial");
    
    callerName.textContent = data.callerName;
    callTypeText.textContent = data.callType === 1 ? "Video Call" : "Voice Call";
    userInitial.textContent = data.callerName.charAt(0).toUpperCase();
    
    modal.style.display = "flex";
}

function hideIncomingCallModal() {
    const modal = document.getElementById("incomingCallModal");
    if (modal) {
        modal.style.display = "none";
    }
}

function hideCallInfoOverlay() {
    const overlay = document.querySelector(".call-info-overlay");
    if (overlay && currentCallType === 1) {
        overlay.style.transition = "opacity 0.5s";
        overlay.style.opacity = "0";
        setTimeout(() => {
            overlay.style.display = "none";
        }, 500);
    }
}

function startCallTimer() {
    if (callStartTime) return; // Already started
    
    callStartTime = Date.now();
    
    const durationElement = currentCallType === 1 ? 
        document.getElementById("callDuration") : 
        document.getElementById("voiceCallDuration");
    
    if (durationElement) {
        durationElement.style.display = "block";
    }
    
    callTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        if (durationElement) {
            durationElement.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

function showStatus(message, type) {
    // Remove existing status
    const existing = document.querySelector(".status-message");
    if (existing) existing.remove();
    
    if (!message) return;
    
    const status = document.createElement("div");
    status.className = `status-message ${type}`;
    status.textContent = message;
    document.body.appendChild(status);
    
    setTimeout(() => {
        status.style.opacity = "0";
        setTimeout(() => status.remove(), 300);
    }, 3000);
}

// Audio Functions
function playRingtone() {
    const ringtone = document.getElementById("ringtone");
    if (ringtone) {
        ringtone.play().catch(e => console.log("Could not play ringtone:", e));
    }
}

function stopRingtone() {
    const ringtone = document.getElementById("ringtone");
    if (ringtone) {
        ringtone.pause();
        ringtone.currentTime = 0;
    }
}

function playCallEndSound() {
    const endSound = document.getElementById("callEndSound");
    if (endSound) {
        endSound.play().catch(e => console.log("Could not play end sound:", e));
    }
}

// Save Call Log
async function saveCallLog(status, duration) {
    try {
        if (!otherUserId) {
            console.log("Cannot save call log: missing otherUserId");
            return;
        }
        
        const endTime = new Date();
        const startTime = callStartTime ? new Date(callStartTime) : new Date(endTime.getTime() - (duration * 1000));
        
        const callLog = {
            callerId: isCaller ? currentUserId : otherUserId,
            receiverId: isCaller ? otherUserId : currentUserId,
            callType: currentCallType,
            callStatus: getCallStatus(status),
            startedAt: startTime.toISOString(),
            endedAt: endTime.toISOString(),
            duration: duration
        };
        
        console.log("Saving call log:", callLog);
        
        const response = await fetch(`${API_BASE}/Call/SaveCallLog`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAccessToken()}`
            },
            body: JSON.stringify(callLog)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log("Call log saved successfully:", result);
        } else {
            console.error("Failed to save call log. Status:", response.status);
        }
        
    } catch (error) {
        console.error("Error saving call log:", error);
    }
}

function getCallStatus(status) {
    switch(status) {
        case "Ended": return 2;
        case "Rejected": return 3;
        case "Missed": return 4;
        case "Busy": return 5;
        default: return 2;
    }
}

// Cleanup
function cleanupAndClose() {
    console.log("Cleaning up and closing...");
    
    // Stop timer
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log("Stopped track:", track.kind);
        });
        localStream = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Stop ringtone
    stopRingtone();
    
    // Stop connection
    if (callConnection && callConnection.state === signalR.HubConnectionState.Connected) {
        callConnection.stop().catch(err => console.error("Error stopping connection:", err));
    }
    
    // Close window or redirect
    setTimeout(() => {
        if (window.opener) {
            window.close();
        } else {
            window.location.href = "chat.html";
        }
    }, 500);
}

// Handle page unload
window.addEventListener("beforeunload", async (e) => {
    if (currentCallId && callConnection) {
        try {
            await callConnection.invoke("EndCall", currentCallId);
        } catch (error) {
            console.error("Error ending call on unload:", error);
        }
    }
});

console.log("✅ Call.js loaded successfully!");