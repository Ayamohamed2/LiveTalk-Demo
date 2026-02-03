document.addEventListener("DOMContentLoaded", () => {
    const API = "https://livetalk.runasp.net/api/account";

    const currentPassword = document.getElementById("currentPassword");
    const newPassword = document.getElementById("newPassword");
    const confirmNewPassword = document.getElementById("confirmNewPassword");
    const changeBtn = document.getElementById("changeBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const msgP = document.getElementById("msg");

    function showMsg(text) {
        msgP.innerText = text;
    }

    changeBtn.addEventListener("click", async () => {
    if (newPassword.value !== confirmNewPassword.value) {
        showMsg("New password and confirm password must match");
        return;
    }

    const token = localStorage.getItem("accessToken");
    console.log("Token used for change-password:", token);

    if (!token) {
        window.location.href = "index.html";
        return;
    }

    try {
        const res = await fetch(`${API}/change-password`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                currentPassword: currentPassword.value,
                newPassword: newPassword.value,
                confirmNewPassword: confirmNewPassword.value
            })
        });

let data;
    const text = await res.text();
    try { 
        data = JSON.parse(text); 
    } catch { 
        data = text; 
    }

    if (res.ok) showMsg("Password changed successfully!");
    else showMsg(typeof data === "string" ? data : JSON.stringify(data));
    } catch (err) {
        console.error(err);
        showMsg("Error connecting to server");
    }
});

    logoutBtn.addEventListener("click", () => {
        localStorage.clear();
        window.location.href = "index.html";
    });
});
