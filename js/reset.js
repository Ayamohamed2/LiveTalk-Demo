document.addEventListener("DOMContentLoaded", () => {
    const API = "https://livetalk.runasp.net/api/account";

    const newPassword = document.getElementById("newPassword");
    const confirmPassword = document.getElementById("confirmPassword");
    const resetBtn = document.getElementById("resetBtn");
    const msgP = document.getElementById("msg");

    const urlParams = new URLSearchParams(window.location.search);

    const email = urlParams.get("email");
    const token = urlParams.get("token");

    function showMsg(text) {
        msgP.innerText = text;
    }

 resetBtn.addEventListener("click", async () => {
    if (newPassword.value !== confirmPassword.value) {
        showMsg("Passwords do not match");
        return;
    }

    try {
        // مهم: يجب استخدام encodeURIComponent للتوكن لأنه يحتوي على أحرف خاصة
        const res = await fetch(`${API}/ResetPassword?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                newPassword: newPassword.value,
                confirmPassword: confirmPassword.value
            })
        });

        const data = await res.json();

        if (res.ok) {
            showMsg("Password reset successfully");
                window.location.href = "login.html";
        } else {
            showMsg(data.message || JSON.stringify(data));
        }
    } catch (err) {
        console.error(err);
        showMsg("Error connecting to server");
    }
});
});