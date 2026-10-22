
document.addEventListener("DOMContentLoaded", () => {
    const authForm = document.getElementById("authForm");
    const loginTab = document.getElementById("loginTab");
    const registerTab = document.getElementById("registerTab");
    const usernameGroup = document.getElementById("usernameGroup");
    const usernameInput = document.getElementById("username");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const togglePassword = document.getElementById("togglePassword");
    const formTitle = document.getElementById("formTitle");
    const formSubtitle = document.getElementById("formSubtitle");
    const submitButton = document.getElementById("submitButton");
    const authMessage = document.getElementById("authMessage");

    const requiredElements = [
        authForm, loginTab, registerTab, usernameGroup,
        usernameInput, emailInput, passwordInput, togglePassword,
        formTitle, formSubtitle, submitButton, authMessage
    ];

    if (requiredElements.some(element => !element)) {
        console.error("Authentication page is missing an HTML element.");
        return;
    }

    let currentMode = "login";

    function showMessage(message, type = "") {
        authMessage.textContent = message;
        authMessage.className = `auth-message ${type}`;
    }

    function setMode(mode) {
        currentMode = mode;
        const isRegister = mode === "register";

        loginTab.classList.toggle("active", !isRegister);
        registerTab.classList.toggle("active", isRegister);

        usernameGroup.hidden = !isRegister;
        usernameInput.required = isRegister;

        passwordInput.autocomplete = isRegister
            ? "new-password"
            : "current-password";

        formTitle.textContent = isRegister
            ? "Join the club."
            : "Welcome back.";

        formSubtitle.textContent = isRegister
            ? "Create an account to start your movie journey."
            : "Log in to continue your movie journey.";

        submitButton.textContent = isRegister
            ? "Create Account"
            : "Login";

        showMessage("");
    }

    loginTab.addEventListener("click", () => setMode("login"));
    registerTab.addEventListener("click", () => setMode("register"));

    togglePassword.addEventListener("click", () => {
        const showPassword = passwordInput.type === "password";

        passwordInput.type = showPassword ? "text" : "password";
        togglePassword.textContent = showPassword ? "🙈" : "👁";
        togglePassword.setAttribute(
            "aria-label",
            showPassword ? "Hide password" : "Show password"
        );
        togglePassword.setAttribute(
            "aria-pressed",
            String(showPassword)
        );
    });

    authForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        showMessage("");

        const isRegister = currentMode === "register";

        const payload = {
            email: emailInput.value.trim(),
            password: passwordInput.value
        };

        if (isRegister) {
            payload.username = usernameInput.value.trim();

            if (payload.username.length < 3) {
                showMessage("Username must contain at least 3 characters.", "error");
                return;
            }

            if (payload.password.length < 8) {
                showMessage("Password must contain at least 8 characters.", "error");
                return;
            }
        }

        submitButton.disabled = true;
        submitButton.textContent = isRegister
            ? "Creating account..."
            : "Logging in...";

        try {
            const API_BASE_URL = "https://what-2-watch-api.onrender.com";
            const response = await fetch(
                `${API_BASE_URL}${isRegister ? "/api/auth/register" : "/api/auth/login"}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                }
            );

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                const detail = data.detail;
                const message = Array.isArray(detail)
                    ? detail.map(item => item.msg).join(", ")
                    : detail;

                throw new Error(
                    message || `Request failed (${response.status}).`
                );
            }

            if (!data.access_token || !data.user) {
                throw new Error("The server response is missing login information.");
            }

            sessionStorage.setItem("what2watch_token", data.access_token);
            sessionStorage.setItem(
                "what2watch_user",
                JSON.stringify(data.user)
            );

            showMessage(
                isRegister
                    ? "Account created successfully!"
                    : "Login successful!",
                "success"
            );

            window.location.assign("/index.html");
        } catch (error) {
            console.error("Authentication error:", error);
            showMessage(
                error.message || "Could not connect. Check that the backend is running.",
                "error"
            );
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = currentMode === "register"
                ? "Create Account"
                : "Login";
        }
    });

    setMode("login");
});
