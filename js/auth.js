document.addEventListener("DOMContentLoaded", () => {
    const API = "https://livetalk.runasp.net/api/account";

    // Elements
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const loginBtn = document.getElementById("loginBtn");

    const regEmail = document.getElementById("regEmail");
        const regName= document.getElementById("regName");

    const regPassword = document.getElementById("regPassword");
    const regConfirmPassword = document.getElementById("regConfirmPassword");
    const registerBtn = document.getElementById("registerBtn");

    const resendEmailInput = document.getElementById("resendEmail");
    const resendBtn = document.getElementById("resendBtn");

    const forgetEmailInput = document.getElementById("forgetEmail");
    const forgetDiv = document.getElementById("forgetDiv");
    const forgetBtn = document.getElementById("forgetBtn");
    const sendForgetBtn = document.getElementById("sendForgetBtn");

    const msgP = document.getElementById("msg");

    function showMsg(text) {
        msgP.innerText = text;
    }

    // Show Forget Password form
if (forgetBtn) {
    forgetBtn.addEventListener("click", () => {
        const forgetDiv = document.getElementById("forgetDiv");
        if (forgetDiv) forgetDiv.style.display = "block";
    });
}

if (loginBtn) {


    // Login
    loginBtn.addEventListener("click", async () => {
        try {
            const res = await fetch(`${API}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: loginEmail.value,
                    password: loginPassword.value
                })
            });
 let data;
    const text = await res.text(); // أولاً خد النص عشان نقدر نقرأه حتى لو مش JSON
    try {
        data = JSON.parse(text); // حاول تحول النص لـ JSON
    } catch {
        data = text; // لو فشل التحويل يبقى النص نفسه
    }
if (res.ok) {
    console.log("Login response:", data); // للتأكد
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);
    window.location.href = "dashboard.html";
} else {
    showMsg(data.message || JSON.stringify(data));
}

        } catch (err) {
            console.error(err);
            showMsg("Error connecting to server");
        }
    });
}
 if (registerBtn) {
    // Register
    registerBtn.addEventListener("click", async () => {
        try {
            const res = await fetch(`${API}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: regEmail.value,
                    Name:regName.value,
                    password: regPassword.value,
                    confirmPassword: regConfirmPassword.value
                })
            });

            const data = await res.text();
            if (res.ok) showMsg("Registered! Please check email to confirm.");
            else showMsg(JSON.stringify(data));
        } catch (err) {
            console.error(err);
            showMsg("Error connecting to server");
        }
    });
 }
 if(resendBtn){
    // Resend Email Confirmation
    resendBtn.addEventListener("click", async () => {
        try {
            const res = await fetch(`${API}/EmailConfirmation/Email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: resendEmailInput.value })
            });
            const data = await res.json();
            showMsg(data.message);
        } catch (err) {
            console.error(err);
            showMsg("Error connecting to server");
        }
    });
 }
    // Forget Password
    sendForgetBtn.addEventListener("click", async () => {
        try {
            const res = await fetch(`${API}/ForgetPassword`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: forgetEmailInput.value })
            });
            const data = await res.json();
            showMsg(data.message);
        } catch (err) {
            console.error(err);
            showMsg("Error connecting to server");
        }
    });
});
