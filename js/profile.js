// ==================== Configuration ====================
const API_BASE = "https://livetalk.runasp.net/api";

// ==================== Global Variables ====================
let originalData = {};
let selectedImageFile = null;

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

    console.log("🚀 Loading profile...");
    await loadProfile();
    setupEventListeners();
});

// ==================== Event Listeners ====================
function setupEventListeners() {
    document.getElementById("profileForm").addEventListener("submit", handleSubmit);
}

// ==================== Load Profile Data ====================
async function loadProfile() {
    showLoading(true);
    
    try {
        const response = await fetch(`${API_BASE}/UserProfile`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${getAccessToken()}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem("accessToken");
                localStorage.removeItem("refreshToken");
                window.location.href = "index.html";
                return;
            }
            throw new Error("Failed to load profile");
        }

        const data = await response.json();
        console.log("✅ Profile loaded:", data);
        
        // Store original data
        originalData = {
            name: data.name || "",
            email: data.email || "",
            phoneNumber: data.phoneNumber || "",
            imageUrl: data.imageUrl || ""
        };

        // Populate form
        document.getElementById("name").value = originalData.name;
        document.getElementById("email").value = originalData.email;
        document.getElementById("phoneNumber").value = originalData.phoneNumber || "";

        // Set profile image
        if (originalData.imageUrl) {
            document.getElementById("profileImage").src = originalData.imageUrl;
            document.getElementById("profileImage").style.display = "block";
            document.getElementById("profilePlaceholder").style.display = "none";
        } else {
            const initial = originalData.name ? originalData.name.charAt(0).toUpperCase() : "U";
            document.getElementById("profilePlaceholder").textContent = initial;
            document.getElementById("profileImage").style.display = "none";
            document.getElementById("profilePlaceholder").style.display = "flex";
        }

    } catch (error) {
        console.error("❌ Error loading profile:", error);
        showError("Failed to load profile. Please refresh the page.");
    } finally {
        showLoading(false);
    }
}

// ==================== Image Preview ====================
function previewImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
        showError("Please select a valid image file");
        return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showError("Image size must be less than 5MB");
        return;
    }

    selectedImageFile = file;

    // Preview the image
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById("profileImage").src = e.target.result;
        document.getElementById("profileImage").style.display = "block";
        document.getElementById("profilePlaceholder").style.display = "none";
    };
    reader.readAsDataURL(file);
}

// ==================== Handle Form Submit ====================
async function handleSubmit(event) {
    event.preventDefault();

    const name = document.getElementById("name").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();

    // Validate
    if (!name) {
        showError("Name is required");
        return;
    }

    // Check if anything changed
    if (name === originalData.name && 
        phoneNumber === originalData.phoneNumber && 
        !selectedImageFile) {
        showError("No changes detected");
        return;
    }

    showLoading(true);
    hideMessages();

    try {
        // Create FormData
        const formData = new FormData();
        formData.append("Name", name);
        formData.append("phoneNumber", phoneNumber);
        
        if (selectedImageFile) {
            formData.append("imagefile", selectedImageFile);
        }

        // Send update request
        const response = await fetch(`${API_BASE}/UserProfile`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${getAccessToken()}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "Failed to update profile");
        }

        const data = await response.json();
        console.log("✅ Profile updated:", data);

        // Update original data
        originalData = {
            name: data.name || "",
            email: data.email || "",
            phoneNumber: data.phoneNumber || "",
            imageUrl: data.imageUrl || ""
        };

        // Clear selected image
        selectedImageFile = null;

        // Show success message
        showSuccess("Profile updated successfully!");

        // Reload profile after 1.5 seconds
        setTimeout(() => {
            loadProfile();
        }, 1500);

    } catch (error) {
        console.error("❌ Error updating profile:", error);
        showError(error.message || "Failed to update profile. Please try again.");
    } finally {
        showLoading(false);
    }
}

// ==================== Reset Form ====================
function resetForm() {
    // Reset form fields
    document.getElementById("name").value = originalData.name;
    document.getElementById("phoneNumber").value = originalData.phoneNumber || "";

    // Reset image
    selectedImageFile = null;
    if (originalData.imageUrl) {
        document.getElementById("profileImage").src = originalData.imageUrl;
        document.getElementById("profileImage").style.display = "block";
        document.getElementById("profilePlaceholder").style.display = "none";
    } else {
        const initial = originalData.name ? originalData.name.charAt(0).toUpperCase() : "U";
        document.getElementById("profilePlaceholder").textContent = initial;
        document.getElementById("profileImage").style.display = "none";
        document.getElementById("profilePlaceholder").style.display = "flex";
    }

    hideMessages();
}

// ==================== UI Helper Functions ====================
function showLoading(show) {
    const overlay = document.getElementById("loadingOverlay");
    const saveBtn = document.getElementById("saveBtn");
    
    if (show) {
        overlay.style.display = "flex";
        saveBtn.disabled = true;
    } else {
        overlay.style.display = "none";
        saveBtn.disabled = false;
    }
}

function showSuccess(message) {
    const successMsg = document.getElementById("successMessage");
    successMsg.textContent = `✓ ${message}`;
    successMsg.style.display = "block";
    
    setTimeout(() => {
        successMsg.style.display = "none";
    }, 3000);
}

function showError(message) {
    const errorMsg = document.getElementById("errorMessage");
    errorMsg.textContent = `✗ ${message}`;
    errorMsg.style.display = "block";
    
    setTimeout(() => {
        errorMsg.style.display = "none";
    }, 3000);
}

function hideMessages() {
    document.getElementById("successMessage").style.display = "none";
    document.getElementById("errorMessage").style.display = "none";
}

// ==================== Navigation ====================
function goBack() {
    // Check if came from chat or dashboard
    const referrer = document.referrer;
    if (referrer.includes('chat.html')) {
        window.location.href = "chat.html";
    } else if (referrer.includes('dashboard.html')) {
        window.location.href = "dashboard.html";
    } else {
        // Default to chat
        window.location.href = "chat.html";
    }
}

console.log("✅ profile.js loaded successfully!");