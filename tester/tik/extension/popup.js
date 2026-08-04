/**
 * Popup Controller — Insta Surfer
 *
 * Pure UI layer. All logic lives in background.js.
 * This file only:
 *   1. Sends messages to background.js
 *   2. Renders the UI based on responses
 *
 * Flow on popup open:
 *   → sendMessage("GET_STATUS")
 *   → background returns { platform, login, capture, stats, profiles }
 *   → render all status indicators instantly
 */

// ==================== DOM Elements ====================

const els = {
    // Status
    statusIndicator: document.getElementById("status-indicator"),
    platformText: document.getElementById("platform-text"),
    loginIndicator: document.getElementById("login-indicator"),
    loginText: document.getElementById("login-text"),
    usernameRow: document.getElementById("username-row"),
    usernameText: document.getElementById("username-text"),
    profileStatsContainer: document.getElementById("profile-stats-container"),
    profileFollowers: document.getElementById("profile-followers"),
    profileFollowing: document.getElementById("profile-following"),
    profileMedia: document.getElementById("profile-media"),
    profileLastPost: document.getElementById("profile-last-post"),
    profileOldestCaptured: document.getElementById("profile-oldest-captured"),
    toggleOldestPosts: document.getElementById("toggle-oldest-posts"),
    oldestPostsList: document.getElementById("oldest-posts-list"),
    btnRefreshStatus: document.getElementById("btn-refresh-status"),

    // Capture
    captureBadge: document.getElementById("capture-badge"),
    btnStart: document.getElementById("btn-start"),
    btnCaptureComments: document.getElementById("btn-capture-comments"),
    btnStop: document.getElementById("btn-stop"),

    // Auto Scroll
    autoscrollBadge: document.getElementById("autoscroll-badge"),
    btnAutoscrollToggle: document.getElementById("btn-autoscroll-toggle"),
    btnAutoscrollLabel: document.getElementById("btn-autoscroll-label"),

    // Stats
    statProfiles: document.getElementById("stat-profiles"),
    statPosts: document.getElementById("stat-posts"),
    statQueries: document.getElementById("stat-queries"),

    // Preview
    previewSection: document.getElementById("preview-section"),
    previewList: document.getElementById("preview-list"),
    btnTogglePreview: document.getElementById("btn-toggle-preview"),

    // Actions
    btnExport: document.getElementById("btn-export"),
    btnSaveDB: document.getElementById("btn-save-db"),
    btnClear: document.getElementById("btn-clear"),
    btnOptions: document.getElementById("btn-options"),
    btnToggleOnPageCounter: document.getElementById("btn-toggle-onpage-counter"),
    onPageCounterDot: document.getElementById("onpage-counter-dot"),
    onPageCounterLabel: document.getElementById("onpage-counter-label"),

    // Projects
    projectSelect: document.getElementById("project-select"),
    btnNewProject: document.getElementById("btn-new-project"),
    projectModal: document.getElementById("project-modal"),
    newProjectName: document.getElementById("new-project-name"),
    newProjectDesc: document.getElementById("new-project-desc"),
    btnCreateProject: document.getElementById("btn-create-project"),
    btnCancelProject: document.getElementById("btn-cancel-project"),
    btnDeleteProject: document.getElementById("btn-delete-project"),
    projectError: document.getElementById("project-error"),

    // Footer
    footerText: document.getElementById("footer-text"),
    versionBadge: document.getElementById("version-badge-display"),
};

let previewVisible = false;

// ==================== Initialization ====================

document.addEventListener("DOMContentLoaded", init);

async function init() {
    console.log("[Popup] Initializing...");

    // Dynamically set version
    if (els.versionBadge && chrome.runtime?.getManifest) {
        els.versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
    }

    // --- Remote Config: Kill Switch & Maintenance ---
    const stored = await chrome.storage.local.get(['remoteConfig']);
    const remoteConfig = stored.remoteConfig;

    if (remoteConfig?.global?.enabled === false) {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:300px;background:#1a1a2e;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:20px;">
                <div>
                    <div style="font-size:36px;margin-bottom:12px;">🔒</div>
                    <h2 style="margin:0 0 6px;font-size:16px;">Temporarily Disabled</h2>
                    <p style="color:#a1a1aa;margin:0;font-size:12px;">The extension has been disabled remotely. Please check back later.</p>
                </div>
            </div>`;
        return;
    }

    if (remoteConfig?.global?.maintenanceMode === true) {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:300px;background:#1a1a2e;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:20px;">
                <div>
                    <div style="font-size:36px;margin-bottom:12px;">🔧</div>
                    <h2 style="margin:0 0 6px;font-size:16px;">Under Maintenance</h2>
                    <p style="color:#a1a1aa;margin:0;font-size:12px;">We're performing maintenance. The extension will be back shortly.</p>
                </div>
            </div>`;
        return;
    }

    // Basic View Elements
    els.loadingView = document.getElementById("loading-view");
    els.loginView = document.getElementById("login-view");
    els.signupView = document.getElementById("signup-view");
    els.mainView = document.getElementById("main-view");
    
    // Login Elements
    els.loginEmail = document.getElementById("login-email");
    els.loginPassword = document.getElementById("login-password");
    els.btnLogin = document.getElementById("btn-login");
    els.loginError = document.getElementById("login-error");
    els.btnLogout = document.getElementById("btn-logout");

    // Signup Elements
    els.signupEmail = document.getElementById("signup-email");
    els.signupPassword = document.getElementById("signup-password");
    els.signupConfirmPassword = document.getElementById("signup-confirm-password");
    els.btnSignup = document.getElementById("btn-signup");
    els.signupError = document.getElementById("signup-error");
    els.signupSuccess = document.getElementById("signup-success");

    // Backend URL override (advanced) — lets user point at an alternate database/backend
    els.loginApiUrl = document.getElementById("login-api-url");
    els.signupApiUrl = document.getElementById("signup-api-url");
    els.btnTestBackendLogin = document.getElementById("btn-test-backend-login");
    els.btnTestBackendSignup = document.getElementById("btn-test-backend-signup");
    els.backendStatusLogin = document.getElementById("backend-status-login");
    els.backendStatusSignup = document.getElementById("backend-status-signup");

    await initBackendUrlControls();

    // Toggle Links
    els.linkShowSignup = document.getElementById("link-show-signup");
    els.linkShowLogin = document.getElementById("link-show-login");

    if (els.btnLogin) {
        if (remoteConfig?.ui?.buttons?.showLogin === false) {
            els.btnLogin.style.display = 'none';
        }
        els.btnLogin.addEventListener("click", handleLogin);
    }
    if (els.btnLogout) els.btnLogout.addEventListener("click", handleLogout);
    if (els.btnSignup) els.btnSignup.addEventListener("click", handleSignup);

    if (els.linkShowSignup) {
        if (remoteConfig?.ui?.buttons?.showSignup === false) {
            els.linkShowSignup.parentElement.style.display = 'none';
        }
        els.linkShowSignup.addEventListener("click", (e) => {
            e.preventDefault();
            showSignupView();
        });
    }

    if (els.linkShowLogin) {
        els.linkShowLogin.addEventListener("click", (e) => {
            e.preventDefault();
            showLoginView();
        });
    }

    // Enter key support for login
    if (els.loginPassword) {
        els.loginPassword.addEventListener("keyup", (e) => {
            if (e.key === "Enter") handleLogin();
        });
    }

    // Enter key support for signup
    if (els.signupConfirmPassword) {
        els.signupConfirmPassword.addEventListener("keyup", (e) => {
            if (e.key === "Enter") handleSignup();
        });
    }

    // Initial Auth Check
    await checkAuth();

    // Bind button events
    els.btnStart.addEventListener("click", handleStartCapture);
    if (els.btnCaptureComments) els.btnCaptureComments.addEventListener("click", handleCaptureComments);
    els.btnStop.addEventListener("click", handleStopCapture);
    if (els.btnAutoscrollToggle) els.btnAutoscrollToggle.addEventListener("click", handleToggleAutoScroll);
    refreshAutoScrollState();
    els.btnExport.addEventListener("click", handleExport);
    els.btnSaveDB.addEventListener("click", handleSaveToDB);
    els.btnClear.addEventListener("click", handleClear);
    els.btnTogglePreview.addEventListener("click", togglePreview);
    
    // Refresh Status
    if (els.btnRefreshStatus) {
        els.btnRefreshStatus.addEventListener("click", handleRefreshStatus);
    }
    
    // Toggle Oldest Posts List
    if (els.toggleOldestPosts) {
        els.toggleOldestPosts.addEventListener("click", () => {
             if (els.oldestPostsList.style.display === "none") {
                 els.oldestPostsList.style.display = "flex";
             } else {
                 els.oldestPostsList.style.display = "none";
             }
        });
    }

    // Options Page
    if (els.btnOptions) {
        els.btnOptions.addEventListener("click", () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options.html'));
            }
        });
    }

    // On-page counter toggle
    await setupOnPageCounterToggle();

    // Project Selector
    if (els.projectSelect) {
        els.projectSelect.addEventListener("change", handleProjectChange);
    }
    if (els.btnNewProject) {
        els.btnNewProject.addEventListener("click", () => {
            els.projectModal.style.display = "block";
            els.newProjectName.value = "";
            els.newProjectDesc.value = "";
            els.projectError.style.display = "none";
            els.newProjectName.focus();
        });
    }
    if (els.btnCreateProject) {
        els.btnCreateProject.addEventListener("click", handleCreateProject);
    }
    if (els.btnCancelProject) {
        els.btnCancelProject.addEventListener("click", () => {
            els.projectModal.style.display = "none";
        });
    }
    // Enter key support for project creation
    if (els.newProjectName) {
        els.newProjectName.addEventListener("keyup", (e) => {
            if (e.key === "Enter") handleCreateProject();
        });
    }
    // Delete project
    if (els.btnDeleteProject) {
        els.btnDeleteProject.addEventListener("click", handleDeleteProject);
    }

    // Fetch full status from background
    await refreshFullStatus();
}

// ==================== On-Page Counter Toggle ====================

// Flips the `onpage_counter_enabled` flag that drives the injected on-page card.
// The card is ON by default (visible unless explicitly turned off), so an absent
// flag is treated as enabled.
async function setupOnPageCounterToggle() {
    const btn = els.btnToggleOnPageCounter;
    if (!btn) return;

    const stored = await chrome.storage.local.get(["onpage_counter_enabled"]);
    let enabled = stored.onpage_counter_enabled !== false; // default ON

    const paint = () => {
        if (els.onPageCounterDot) {
            els.onPageCounterDot.style.background = enabled ? "#22c55e" : "#6b7280";
        }
        if (els.onPageCounterLabel) {
            els.onPageCounterLabel.textContent = enabled ? "Showing on page" : "Show on page";
        }
    };
    paint();

    btn.addEventListener("click", () => {
        enabled = !enabled;
        chrome.storage.local.set({ onpage_counter_enabled: enabled }); // triggers the card via storage.onChanged
        paint();
    });
}

// ==================== Backend URL Override ====================

// Prefill the advanced backend-URL inputs and wire up their "Test & Save" buttons.
async function initBackendUrlControls() {
    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const savedUrl = stored.extension_settings?.apiUrl || "";
        // Only prefill when the user has explicitly overridden the default,
        // so the placeholder still hints the field is optional.
        if (els.loginApiUrl && savedUrl && savedUrl !== CONFIG.DEFAULT_API_URL) {
            els.loginApiUrl.value = savedUrl;
        }
        if (els.signupApiUrl && savedUrl && savedUrl !== CONFIG.DEFAULT_API_URL) {
            els.signupApiUrl.value = savedUrl;
        }
    } catch (err) {
        console.warn("[Popup] Could not load saved backend URL:", err);
    }

    if (els.btnTestBackendLogin) {
        els.btnTestBackendLogin.addEventListener("click", () =>
            handleTestAndSaveBackend(els.loginApiUrl, els.backendStatusLogin));
    }
    if (els.btnTestBackendSignup) {
        els.btnTestBackendSignup.addEventListener("click", () =>
            handleTestAndSaveBackend(els.signupApiUrl, els.backendStatusSignup));
    }
}

// Reduce whatever the user pasted to a clean base URL. Strips a trailing
// "/api/health" (or any "/api/..." path) and stray slashes, so we never end up
// requesting ".../api/health/api/health".
function toBaseUrl(raw) {
    let u = (raw || "").trim();
    u = u.replace(/\/+$/, "");            // trailing slashes
    u = u.replace(/\/api(\/.*)?$/i, "");  // a pasted /api/... path
    u = u.replace(/\/+$/, "");            // any slashes left behind
    return CONFIG.normalizeUrl(u);
}

function showBackendStatus(statusEl, message, ok) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = ok ? "#22c55e" : "#ef4444";
    statusEl.style.display = "block";
}

// Persist the overridden backend URL into extension_settings.apiUrl (or clear it
// to fall back to CONFIG.DEFAULT_API_URL when left blank), after a health check.
async function handleTestAndSaveBackend(inputEl, statusEl) {
    if (!inputEl) return;
    const raw = inputEl.value.trim();
    const stored = await chrome.storage.local.get(["extension_settings"]);
    const settings = stored.extension_settings || {};

    // Blank input → clear override and use the hardcoded default.
    if (!raw) {
        delete settings.apiUrl;
        await chrome.storage.local.set({ extension_settings: settings });
        showBackendStatus(statusEl, "Cleared — using default backend.", true);
        return;
    }

    const url = toBaseUrl(raw);
    // Reflect the cleaned base URL back into the box so what's saved is visible.
    if (url !== raw) inputEl.value = url;
    showBackendStatus(statusEl, "Testing connection...", true);
    statusEl.style.color = "#a1a1aa";

    try {
        const res = await fetch(`${url}/api/health`, { method: "GET" });
        if (res.ok) {
            settings.apiUrl = url;
            await chrome.storage.local.set({ extension_settings: settings });
            showBackendStatus(statusEl, "✅ Connected & saved.", true);
        } else {
            showBackendStatus(statusEl, `Reachable but returned HTTP ${res.status}. Not saved.`, false);
        }
    } catch (err) {
        showBackendStatus(statusEl, "❌ Could not reach that backend. Check the URL.", false);
    }
}

// ==================== Authentication ====================

async function checkAuth() {
    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const token = stored.extension_settings?.token;
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);

        if (!token) {
            showLoginView();
            return;
        }

        // Verify token with backend. A slow or unreachable backend must not
        // hang the popup open on a blank screen indefinitely — fetch has no
        // default timeout, so one is enforced here.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        let response;
        try {
            response = await fetch(`${apiUrl}/api/auth/me`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }

        if (response.ok) {
            showMainView();
        } else {
            showLoginView();
            chrome.storage.local.set({ 
                extension_settings: { ...stored.extension_settings, token: null } 
            });
        }
    } catch (err) {
        console.error("[Popup] Auth check failed:", err);
        showLoginView();
    }
}

async function handleLogin() {
    const email = els.loginEmail.value.trim();
    const password = els.loginPassword.value.trim();

    if (!email || !password) {
        els.loginError.textContent = "Please enter email and password.";
        els.loginError.style.display = "block";
        return;
    }

    els.btnLogin.disabled = true;
    els.btnLogin.textContent = "Logging in...";
    els.loginError.style.display = "none";

    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        // A URL typed into the advanced box takes precedence, even without an
        // explicit "Test & Save" — persist it so the rest of the app uses it too.
        const typedUrl = els.loginApiUrl ? els.loginApiUrl.value.trim() : "";
        if (typedUrl) {
            const settings = stored.extension_settings || {};
            settings.apiUrl = toBaseUrl(typedUrl);
            await chrome.storage.local.set({ extension_settings: settings });
            stored.extension_settings = settings;
        }
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);

        const response = await fetch(`${apiUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Save token
            const settings = stored.extension_settings || {};
            settings.token = data.token;
            // set default API url if not present to ensure saves work out of box
            if (!settings.apiUrl) settings.apiUrl = CONFIG.DEFAULT_API_URL;

            await chrome.storage.local.set({ extension_settings: settings });
            
            els.loginEmail.value = "";
            els.loginPassword.value = "";
            showMainView();
        } else {
            els.loginError.textContent = data.error || "Login failed.";
            els.loginError.style.display = "block";
        }
    } catch (err) {
        console.error("[Popup] Login error:", err);
        els.loginError.textContent = "Could not connect to server.";
        els.loginError.style.display = "block";
    } finally {
        els.btnLogin.disabled = false;
        els.btnLogin.textContent = "Login";
    }
}

async function handleSignup() {
    const email = els.signupEmail.value.trim();
    const password = els.signupPassword.value.trim();
    const confirmPassword = els.signupConfirmPassword.value.trim();

    if (!email || !password || !confirmPassword) {
        els.signupError.textContent = "Please fill in all fields.";
        els.signupError.style.display = "block";
        els.signupSuccess.style.display = "none";
        return;
    }

    if (password !== confirmPassword) {
        els.signupError.textContent = "Passwords do not match.";
        els.signupError.style.display = "block";
        els.signupSuccess.style.display = "none";
        return;
    }

    els.btnSignup.disabled = true;
    els.btnSignup.textContent = "Signing up...";
    els.signupError.style.display = "none";
    els.signupSuccess.style.display = "none";

    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        // Honor a URL typed into the advanced box (see handleLogin).
        const typedUrl = els.signupApiUrl ? els.signupApiUrl.value.trim() : "";
        if (typedUrl) {
            const settings = stored.extension_settings || {};
            settings.apiUrl = toBaseUrl(typedUrl);
            await chrome.storage.local.set({ extension_settings: settings });
            stored.extension_settings = settings;
        }
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);

        const response = await fetch(`${apiUrl}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            els.signupSuccess.textContent = "Account created! Logging in...";
            els.signupSuccess.style.display = "block";
            
            const settings = stored.extension_settings || {};
            settings.token = data.token;
            if (!settings.apiUrl) settings.apiUrl = CONFIG.DEFAULT_API_URL;

            await chrome.storage.local.set({ extension_settings: settings });
            
            els.signupEmail.value = "";
            els.signupPassword.value = "";
            els.signupConfirmPassword.value = "";
            
            setTimeout(() => {
                showMainView();
                els.btnSignup.disabled = false;
                els.btnSignup.textContent = "Sign Up";
                els.signupSuccess.style.display = "none";
            }, 1000);
        } else {
            els.signupError.textContent = data.error || "Signup failed.";
            els.signupError.style.display = "block";
            els.btnSignup.disabled = false;
            els.btnSignup.textContent = "Sign Up";
        }
    } catch (err) {
        console.error("[Popup] Signup error:", err);
        els.signupError.textContent = "Could not connect to server.";
        els.signupError.style.display = "block";
        els.btnSignup.disabled = false;
        els.btnSignup.textContent = "Sign Up";
    }
}

async function handleLogout() {
    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const token = stored.extension_settings?.token;
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);
        
        if (token) {
            // Tell backend to unlock device session
            await fetch(`${apiUrl}/api/auth/logout`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
        }
    } catch(e) {
        console.warn("[Popup] Could not cleanly logout on server", e);
    }

    // Always clear local
    chrome.storage.local.get(["extension_settings"], (res) => {
        chrome.storage.local.set({ 
            extension_settings: { ...(res.extension_settings || {}), token: null } 
        });
    });
    showLoginView();
}

function showLoginView() {
    if (els.loadingView) els.loadingView.style.display = "none";
    if (els.loginView && els.mainView) {
        els.loginView.style.display = "block";
        if (els.signupView) els.signupView.style.display = "none";
        els.mainView.style.display = "none";
    }
}

function showSignupView() {
    if (els.loadingView) els.loadingView.style.display = "none";
    if (els.signupView && els.mainView) {
        els.signupView.style.display = "block";
        if (els.loginView) els.loginView.style.display = "none";
        els.mainView.style.display = "none";
    }
}

function showMainView() {
    if (els.loadingView) els.loadingView.style.display = "none";
    if (els.loginView && els.mainView) {
        els.loginView.style.display = "none";
        if (els.signupView) els.signupView.style.display = "none";
        els.mainView.style.display = "block";
        // Load projects when main view shows
        loadProjects();
    }
}

// ==================== Project Management ====================

async function loadProjects() {
    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const token = stored.extension_settings?.token;
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);

        if (!token) return;

        const response = await fetch(`${apiUrl}/api/projects`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            console.warn("[Popup] Failed to load projects");
            return;
        }

        const data = await response.json();
        if (!data.success) return;

        const projects = data.projects || [];
        const savedProjectId = stored.extension_settings?.activeProjectId;

        // Populate dropdown
        els.projectSelect.innerHTML = "";

        if (projects.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No projects — click + to create";
            opt.disabled = true;
            opt.selected = true;
            els.projectSelect.appendChild(opt);
            return;
        }

        for (const proj of projects) {
            const opt = document.createElement("option");
            opt.value = proj.id;
            const postCount = proj.post_count || 0;
            const profileCount = proj.profile_count || 0;
            opt.textContent = `${proj.name} (${postCount} posts, ${profileCount} profiles)`;
            if (proj.id === savedProjectId) {
                opt.selected = true;
            }
            els.projectSelect.appendChild(opt);
        }

        // Auto-select first if no saved selection
        if (!savedProjectId && projects.length > 0) {
            els.projectSelect.value = projects[0].id;
            await saveActiveProjectId(projects[0].id);
        }
    } catch (err) {
        console.error("[Popup] Load projects error:", err);
    }
}

async function handleProjectChange() {
    const projectId = els.projectSelect.value;
    if (!projectId) return;

    const previousProjectId = await getActiveProjectId();

    // The captured posts/profiles in the popup are a single global bucket that
    // is NOT scoped per project. If we switch projects while it still holds
    // data, the next "Save to DB" would tag that old data with the new project —
    // merging the two. Clear it on switch, but confirm first so an in-progress
    // capture isn't discarded by accident.
    if (String(projectId) !== String(previousProjectId)) {
        const capturedCount = await getCapturedCount();
        if (capturedCount > 0) {
            const ok = confirm(
                `You have ${capturedCount} captured item(s) still in the popup from the ` +
                `previous project.\n\nSwitching projects will clear them so they don't get ` +
                `saved into the new project. Continue?`
            );
            if (!ok) {
                // Revert the dropdown to the previous project.
                if (previousProjectId) els.projectSelect.value = previousProjectId;
                return;
            }
            await chrome.runtime.sendMessage({ type: "CLEAR_DATASET" });
            resetCapturedDataUI();
        }
    }

    await saveActiveProjectId(projectId);
    console.log(`[Popup] Switched to project: ${projectId}`);
}

// Returns how many captured items (posts + accumulated profiles) currently sit
// in the popup's global dataset. Used to decide whether a project switch needs
// a "this will be cleared" confirmation.
async function getCapturedCount() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_DATASET" });
        const postCount = (response && response.success && response.dataset?.posts)
            ? response.dataset.posts.length : 0;
        const storedProfiles = await chrome.storage.local.get(["profiles_dataset"]);
        const profileCount = (storedProfiles.profiles_dataset || []).length;
        return postCount + profileCount;
    } catch (err) {
        return 0;
    }
}

async function handleCreateProject() {
    const name = els.newProjectName.value.trim();
    if (!name) {
        els.projectError.textContent = "Please enter a project name.";
        els.projectError.style.display = "block";
        return;
    }

    els.btnCreateProject.disabled = true;
    els.btnCreateProject.textContent = "Creating...";
    els.projectError.style.display = "none";

    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const token = stored.extension_settings?.token;
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);

        const response = await fetch(`${apiUrl}/api/projects`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                name,
                description: els.newProjectDesc.value.trim() || null
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Save as active project and reload
            await saveActiveProjectId(data.project.id);
            els.projectModal.style.display = "none";

            // A brand-new project must start empty. The captured posts/profiles
            // in the popup live in a single global dataset (PostsStore +
            // profiles_dataset) that is NOT scoped per project. If we leave it in
            // place, both the auto-sync and the manual "Save to DB" button would
            // dump the PREVIOUS project's captures into this new one — merging
            // them. Clearing the local dataset here is safe: CLEAR_DATASET only
            // wipes local staging, never data already saved to the server.
            await chrome.runtime.sendMessage({ type: "CLEAR_DATASET" });
            resetCapturedDataUI();

            await loadProjects();
            // Select the new project
            els.projectSelect.value = data.project.id;
        } else {
            els.projectError.textContent = data.error || "Failed to create project.";
            els.projectError.style.display = "block";
        }
    } catch (err) {
        console.error("[Popup] Create project error:", err);
        els.projectError.textContent = "Could not connect to server.";
        els.projectError.style.display = "block";
    } finally {
        els.btnCreateProject.disabled = false;
        els.btnCreateProject.textContent = "Create";
    }
}

async function saveActiveProjectId(projectId) {
    const stored = await chrome.storage.local.get(["extension_settings"]);
    const settings = stored.extension_settings || {};
    settings.activeProjectId = projectId;
    await chrome.storage.local.set({ extension_settings: settings });
}

async function getActiveProjectId() {
    const stored = await chrome.storage.local.get(["extension_settings"]);
    return stored.extension_settings?.activeProjectId || null;
}

async function handleDeleteProject() {
    const projectId = await getActiveProjectId();
    if (!projectId) {
        alert("No project selected.");
        return;
    }

    const selectedOpt = els.projectSelect.options[els.projectSelect.selectedIndex];
    const projName = selectedOpt ? selectedOpt.textContent.split(" (")[0] : "this project";

    if (!confirm(`Delete project "${projName}"?\n\nThis only removes project associations.\nYour Instagram data will NOT be deleted.`)) {
        return;
    }

    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const token = stored.extension_settings?.token;
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);

        const res = await fetch(`${apiUrl}/api/projects/${projectId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success) {
            alert(`✅ Project "${projName}" deleted!`);
            // Clear active project
            const settings = stored.extension_settings || {};
            delete settings.activeProjectId;
            await chrome.storage.local.set({ extension_settings: settings });
            await loadProjects();
        } else {
            alert(`❌ ${data.error || "Failed to delete project"}`);
        }
    } catch (err) {
        alert(`❌ Connection Error: Could not delete project.`);
    }
}

// NOTE: syncLocalPostsToProject() was removed. It ran on project creation and
// pushed the ENTIRE global local dataset (all captured posts + profiles,
// regardless of which project they belonged to) into the freshly created
// project, merging the previous project's captures into the new one. New
// projects now start empty — the local dataset is cleared on creation instead
// (see handleCreateProject).

// ==================== Status Refresh ====================

async function refreshFullStatus() {
    try {
        console.log("[Popup] Requesting status from background...");
        const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
        console.log("[Popup] Status response received:", status);

        if (status && status.success) {
            renderPlatformStatus(status.platform);
            renderLoginStatus(status.login);
            renderCaptureState(status.capture);
            renderStats(status.stats);

            if (status.username) {
                els.usernameRow.style.display = "flex";
                if (els.usernameText) els.usernameText.textContent = `@${status.username}`;
                
                // Show rich profile stats if available
                if (status.profileStats) {
                    if (els.profileStatsContainer) els.profileStatsContainer.style.display = "block";
                    if (els.profileFollowers) els.profileFollowers.textContent = formatNumber(status.profileStats.follower_count);
                    if (els.profileFollowing) els.profileFollowing.textContent = formatNumber(status.profileStats.following_count);
                    if (els.profileMedia) els.profileMedia.textContent = formatNumber(status.profileStats.media_count);
                    
                    if (status.profileStats.latest_post_timestamp) {
                        const date = new Date(status.profileStats.latest_post_timestamp * 1000);
                        if (els.profileLastPost) els.profileLastPost.textContent = date.toLocaleDateString();
                    } else {
                        if (els.profileLastPost) els.profileLastPost.textContent = "—";
                    }
                    // Oldest-captured posts (post-count-dependent) fill in via refreshProfileSummary().
                } else {
                    els.profileStatsContainer.style.display = "none";
                }
            } else {
                els.usernameRow.style.display = "none";
                els.profileStatsContainer.style.display = "none";
            }

            // Update footer based on capture state
            renderFooter(status.capture);

            // Defer the post-count-dependent fields (profiles count + oldest posts)
            // to the heavy summary call so this fast status renders immediately.
            refreshProfileSummary();
        } else {
            console.warn("[Popup] Background reported failure or sent empty response:", status);
            renderPlatformStatus({ detected: false });
            renderLoginStatus({ loggedIn: false });
        }
    } catch (err) {
        console.error("[Popup] CRITICAL: Status refresh failed to communicate with background:", err);
        renderPlatformStatus({ detected: false });
        renderLoginStatus({ loggedIn: false });
        
        // If error is "Extension context invalidated", we could notify user to reload page
        if (err.message.includes("Extension context invalidated")) {
            els.platformText.textContent = "Please reload Instagram";
        }
    }
}

// Fetches the post-count-dependent summary (unique-author count + oldest captured
// posts) via the heavy GET_PROFILE_SUMMARY call. Kept separate from the fast
// GET_STATUS so it never runs on the 3s poll — only on open / manual refresh /
// after capture stops. Non-blocking: the popup renders before this resolves.
async function refreshProfileSummary() {
    try {
        const summary = await chrome.runtime.sendMessage({ type: "GET_PROFILE_SUMMARY" });
        if (!summary || !summary.success) return;

        if (summary.profilesCount !== undefined && els.statProfiles) {
            els.statProfiles.textContent = summary.profilesCount;
        }

        if (summary.oldestCapturedPosts && summary.oldestCapturedPosts.length > 0) {
            const oldest = summary.oldestCapturedPosts[0];
            if (els.profileOldestCaptured) els.profileOldestCaptured.textContent = new Date(oldest.timestamp).toLocaleDateString();

            if (els.oldestPostsList) {
                els.oldestPostsList.innerHTML = "";
                summary.oldestCapturedPosts.forEach((post, i) => {
                    const pDate = new Date(post.timestamp).toLocaleDateString();
                    const pLink = post.shortcode ? `https://instagram.com/p/${post.shortcode}` : "#";
                    const thumbHtml = post.imageUrl
                        ? `<img src="${post.imageUrl}" style="width: 20px; height: 20px; object-fit: cover; border-radius: 4px; border: 1px solid #3f3f46;" />`
                        : `<div style="width:20px;height:20px;border-radius:4px;background:#3f3f46;"></div>`;
                    els.oldestPostsList.innerHTML += `
                        <a href="${pLink}" target="_blank" style="display: flex; justify-content: space-between; align-items: center; text-decoration: none; color: #a1a1aa; padding: 2px 0;">
                           <span>${i + 1}. ${pDate}</span>
                           ${thumbHtml}
                        </a>
                    `;
                });
            }
        } else {
            if (els.profileOldestCaptured) els.profileOldestCaptured.textContent = "—";
            if (els.oldestPostsList) els.oldestPostsList.innerHTML = "";
        }
    } catch (err) {
        // Popup may be closing; ignore.
    }
}

async function handleRefreshStatus() {
    els.btnRefreshStatus.disabled = true;
    els.btnRefreshStatus.innerHTML = '<span class="btn-icon">⏳</span> Refreshing...';
    
    await refreshFullStatus();
    
    setTimeout(() => {
        els.btnRefreshStatus.disabled = false;
        els.btnRefreshStatus.innerHTML = '<span class="btn-icon">🔄</span> Refresh Connection';
    }, 800);
}

// ==================== Renderers ====================

function renderPlatformStatus(platform) {
    if (platform && platform.detected) {
        if (els.statusIndicator) els.statusIndicator.className = "status-dot connected";
        if (els.platformText) els.platformText.textContent = `Instagram Detected`;
        if (els.btnStart) els.btnStart.disabled = false;
        // Hide refresh button when connected
        if (els.btnRefreshStatus) els.btnRefreshStatus.style.display = "none";
    } else {
        if (els.statusIndicator) els.statusIndicator.className = "status-dot disconnected";
        if (els.platformText) els.platformText.textContent = "Not on Instagram";
        if (els.btnStart) els.btnStart.disabled = true;
        if (els.btnCaptureComments) els.btnCaptureComments.disabled = true;
        // Show refresh button when disconnected
        if (els.btnRefreshStatus) els.btnRefreshStatus.style.display = "flex";
    }
}

function renderLoginStatus(login) {
    if (login && login.loggedIn) {
        if (els.loginIndicator) els.loginIndicator.className = "status-dot connected";
        if (els.loginText) els.loginText.textContent = "Logged In";
    } else {
        if (els.loginIndicator) els.loginIndicator.className = "status-dot warning";
        if (els.loginText) els.loginText.textContent = "Not Logged In";
    }
}

function renderCaptureState(capture) {
    if (capture && capture.active) {
        if (els.captureBadge) {
            els.captureBadge.textContent = "LIVE";
            els.captureBadge.className = "capture-badge on";
        }
        if (els.btnStart) els.btnStart.style.display = "none";
        if (els.btnCaptureComments) els.btnCaptureComments.style.display = "none";
        if (els.btnStop) els.btnStop.style.display = "flex";
    } else {
        if (els.captureBadge) {
            els.captureBadge.textContent = "OFF";
            els.captureBadge.className = "capture-badge off";
        }
        if (els.btnStart) els.btnStart.style.display = "flex";
        if (els.btnCaptureComments) els.btnCaptureComments.style.display = "flex";
        if (els.btnStop) els.btnStop.style.display = "none";
    }
    renderFooter(capture);
}

function renderStats(stats) {
    if (!stats) return;

    if (els.statPosts) els.statPosts.textContent = stats.totalCaptured || 0;
    if (els.statQueries) els.statQueries.textContent = stats.queriesSeen || 0;

    const hasData = (stats.totalCaptured || 0) > 0;
    if (els.btnExport) els.btnExport.disabled = !hasData;
    if (els.btnSaveDB) els.btnSaveDB.disabled = !hasData;
    if (els.btnClear) els.btnClear.disabled = !hasData;
    if (els.btnCaptureComments) els.btnCaptureComments.disabled = !hasData;

    if (hasData) {
        els.previewSection.style.display = "block";
        loadPreview();
    }
}

// ==================== Auto Scroll Controls ====================
// Repeatedly scrolls the active Instagram tab to its bottom (like holding
// End) until toggled off. The interval lives in that tab's content script,
// not here, so it keeps running after this popup closes; renderAutoScroll()
// re-syncs the button to the live state every time the popup reopens.

function renderAutoScroll(active) {
    if (els.autoscrollBadge) {
        els.autoscrollBadge.textContent = active ? "ON" : "OFF";
        els.autoscrollBadge.className = "autoscroll-badge " + (active ? "on" : "off");
    }
    if (els.btnAutoscrollToggle) {
        els.btnAutoscrollToggle.className = "btn " + (active ? "btn-autoscroll-on" : "btn-autoscroll-off");
    }
    if (els.btnAutoscrollLabel) {
        els.btnAutoscrollLabel.textContent = active ? "Stop Auto Scroll" : "Start Auto Scroll";
    }
}

async function refreshAutoScrollState() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_AUTO_SCROLL_STATE" });
        renderAutoScroll(!!(response && response.active));
    } catch (err) {
        console.error("[Popup] GET_AUTO_SCROLL_STATE error:", err);
        renderAutoScroll(false);
    }
}

async function handleToggleAutoScroll() {
    if (els.btnAutoscrollToggle) els.btnAutoscrollToggle.disabled = true;
    const turningOn = els.autoscrollBadge?.classList.contains("off") ?? true;

    try {
        const response = await chrome.runtime.sendMessage({
            type: turningOn ? "START_AUTO_SCROLL" : "STOP_AUTO_SCROLL",
        });
        if (response && response.success) {
            renderAutoScroll(!!response.active);
        } else if (response && response.reason === "not_instagram") {
            alert("Open an Instagram tab first.");
        } else {
            alert("Could not reach the Instagram tab. Try reloading it.");
        }
    } catch (err) {
        console.error("[Popup] Toggle auto scroll error:", err);
    } finally {
        if (els.btnAutoscrollToggle) els.btnAutoscrollToggle.disabled = false;
    }
}

function renderFooter(capture) {
    if (!els.footerText) return;
    if (capture && capture.active) {
        els.footerText.textContent = "🔴 Capturing live...";
        els.footerText.classList.add("capturing");
    } else {
        els.footerText.textContent = "Scroll Instagram to capture posts";
        els.footerText.classList.remove("capturing");
    }
}

// ==================== Capture Controls ====================

async function handleStartCapture() {
    console.log("[Popup] Starting capture...");
    els.btnStart.disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
        if (response && response.success) {
            renderCaptureState({ active: true });
        }
    } catch (err) {
        console.error("[Popup] Start capture error:", err);
    }
}

async function handleCaptureComments() {
    console.log("[Popup] Starting comments capture...");
    if (els.btnCaptureComments) els.btnCaptureComments.disabled = true;
    
    try {
        // Get dataset
        const response = await chrome.runtime.sendMessage({ type: "GET_DATASET" });
        if (!response || !response.success || !response.dataset?.posts?.length) {
            alert("No posts captured to scrape comments for.");
            if (els.btnCaptureComments) els.btnCaptureComments.disabled = false;
            return;
        }

        const posts = response.dataset.posts;
        const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
        const profileUsername = status?.username || "unknown";

        const result = await chrome.runtime.sendMessage({ 
            type: "START_BATCH_SCRAPE", 
            posts: posts,
            profileUsername: profileUsername
        });
        
        if (result && result.success) {
            alert(`Started scraping comments for ${result.postsToScrape} posts.`);
            // Optionally render capture state or refresh UI if needed
            if (els.btnCaptureComments) els.btnCaptureComments.disabled = false;
        } else {
            alert(`Failed to start comments capture: ${result?.error || result?.message || "Unknown error"}`);
            if (els.btnCaptureComments) els.btnCaptureComments.disabled = false;
        }
    } catch (err) {
        console.error("[Popup] Start comments capture error:", err);
        if (els.btnCaptureComments) els.btnCaptureComments.disabled = false;
    }
}

async function handleStopCapture() {
    console.log("[Popup] Stopping capture...");

    try {
        const response = await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
        if (response && response.success) {
            renderCaptureState({ active: false });
            // Refresh stats after stopping
            const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
            if (status && status.success) {
                renderStats(status.stats);
                // Refresh the post-count-dependent profiles/oldest summary once.
                refreshProfileSummary();
            }
        }
    } catch (err) {
        console.error("[Popup] Stop capture error:", err);
    }
}

// ==================== Dataset Preview ====================

async function loadPreview() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_DATASET" });
        if (!response || !response.success || !response.dataset?.posts?.length) return;

        const posts = response.dataset.posts.slice(-5).reverse(); // Last 5, newest first
        els.previewList.innerHTML = "";

        for (const post of posts) {
            const item = document.createElement("div");
            item.className = "preview-item";

            const caption = post.caption
                ? (post.caption.substring(0, 50) + (post.caption.length > 50 ? "..." : ""))
                : "(no caption)";

            item.innerHTML = `
                <div class="preview-thumb" style="${post.imageUrl ? `background-image: url(${post.imageUrl}); background-size: cover;` : ''}"></div>
                <div class="preview-info">
                    <div class="preview-caption">${escapeHtml(caption)}</div>
                    <div class="preview-meta">
                        <span>❤️ ${formatNumber(post.likes)}</span>
                        <span>💬 ${formatNumber(post.comments)}</span>
                    </div>
                </div>
            `;

            els.previewList.appendChild(item);
        }
    } catch (err) {
        console.error("[Popup] Preview load error:", err);
    }
}

function togglePreview() {
    previewVisible = !previewVisible;
    els.previewList.style.display = previewVisible ? "flex" : "none";
    els.btnTogglePreview.textContent = previewVisible ? "Hide" : "Show";
}

// ==================== Export & Clear ====================

async function handleExport() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_DATASET" });
        if (!response || !response.success) return;

        const posts = response.dataset.posts || [];
        if (posts.length === 0) return;

        const shortcodes = posts.map(p => p.shortcode);
        
        // Fetch comments and profile dataset
        const [commentsRes, storedProfiles] = await Promise.all([
            new Promise(resolve => chrome.runtime.sendMessage({ type: 'GET_COMMENTS_FOR_POSTS', shortcodes }, resolve)),
            chrome.storage.local.get(['profiles_dataset'])
        ]);

        const scrapedComments = (commentsRes && commentsRes.success) ? commentsRes.comments : [];
        const globalProfilesDataset = storedProfiles.profiles_dataset || [];

        const collabInfluencers = new Map();

        // Attach comments and calculate reach
        const postsWithComments = posts.map((post, index) => {
            const postComments = scrapedComments.filter(c => c.post_shortcode === post.shortcode);
            
            const coauthorList = post.coauthor_producers || post.coauthors || [];
            const hasCoauthors = coauthorList.length > 0;
            const isPaid = post.is_paid_partnership || post.isPaid || post.type === 'paid' || post.type === 'collab' || post.type === 'paid_collab';

            const influencersInThisPost = new Set();
            let postCollectiveReach = 0;

            const addInfluencer = (username, followers, source, extraData = {}) => {
                if (!username) return;

                if (!collabInfluencers.has(username)) {
                    collabInfluencers.set(username, {
                        username,
                        followers: followers || 0,
                        sources: new Set([source]),
                        perUserCollabCount: 0,
                        perUserPaidCount: 0,
                        postCount: 0,
                        is_verified: extraData.is_verified || false,
                        full_name: extraData.full_name || '',
                        category_name: extraData.category_name || '',
                        media_count: extraData.media_count || 0
                    });
                } else {
                    const existing = collabInfluencers.get(username);
                    existing.sources.add(source);
                    if (followers > existing.followers) existing.followers = followers;
                    if (extraData.is_verified && !existing.is_verified) existing.is_verified = extraData.is_verified;
                    if (extraData.full_name && !existing.full_name) existing.full_name = extraData.full_name;
                    if (extraData.category_name && !existing.category_name) existing.category_name = extraData.category_name;
                    if ((extraData.media_count || 0) > existing.media_count) existing.media_count = extraData.media_count;
                }

                if (!influencersInThisPost.has(username)) {
                    const inf = collabInfluencers.get(username);
                    if (hasCoauthors) inf.perUserCollabCount++;
                    if (isPaid) inf.perUserPaidCount++;
                    inf.postCount++;
                    influencersInThisPost.add(username);
                    postCollectiveReach += (followers || 0);
                }
            };

            const mainUser = post.owner?.username || post.user?.username || post.username || post.caption_user?.username;
            const mainReach = post.owner?.follower_count || post.user?.follower_count || post.owner?.edge_followed_by?.count || post.followers || 0;
            addInfluencer(mainUser, mainReach, 'Owner', post.owner || post.user || {});

            if (coauthorList.length > 0) {
                coauthorList.forEach((c) => {
                    const coReach = c.follower_count || c.edge_followed_by?.count || 0;
                    addInfluencer(c.username, coReach, 'Co-author', c);
                });
            }

            const captionUser = post.caption_user || post.caption?.user;
            if (captionUser && captionUser.username && captionUser.username !== mainUser) {
                const capReach = captionUser.follower_count || captionUser.edge_followed_by?.count || 0;
                addInfluencer(captionUser.username, capReach, 'Caption', captionUser);
            }

            return {
                ...post,
                scraped_comments: postComments,
                collectiveReach: postCollectiveReach
            };
        });

        const collabPartners = Array.from(collabInfluencers.values()).map(inf => ({
            username: inf.username,
            followers: inf.followers,
            sources: Array.from(inf.sources),
            perUserCollabCount: inf.perUserCollabCount,
            perUserPaidCount: inf.perUserPaidCount,
            postCount: inf.postCount,
            is_verified: inf.is_verified,
            full_name: inf.full_name,
            category_name: inf.category_name,
            media_count: inf.media_count,
            calculated_reach: (inf.followers || 0) * (inf.postCount || 1)
        }));
        
        const totalReach = collabPartners.reduce((sum, inf) => sum + inf.calculated_reach, 0);

        // Determine sourceUsername from the most common owner
        const ownerCounts = {};
        posts.forEach(p => {
            const u = p.owner?.username || p.caption_user?.username;
            if (u) ownerCounts[u] = (ownerCounts[u] || 0) + 1;
        });
        const sourceUsername = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

        const exportData = {
            timestamp: new Date().toISOString(),
            version: "1.2",
            sourceUsername,
            count: posts.length,
            posts: postsWithComments,
            collabPartners,
            scrapedProfiles: globalProfilesDataset,
            summary: {
                totalPosts: posts.length,
                totalCollabPartners: collabPartners.length,
                totalScrapedComments: scrapedComments.length,
                totalScrapedProfiles: globalProfilesDataset.length,
                totalReach,
            },
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `ig_scrape_results_${sourceUsername}_${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
        console.log(`[Popup] Exported ${posts.length} posts with ${scrapedComments.length} comments and ${globalProfilesDataset.length} profile data`);
    } catch (err) {
        console.error("[Popup] Export error:", err);
    }
}

async function handleSaveToDB() {
    console.log("[Popup] Saving to database...");
    
    // Visual feedback: loading state
    const originalContent = els.btnSaveDB.innerHTML;
    els.btnSaveDB.disabled = true;
    els.btnSaveDB.innerHTML = '<span class="btn-icon">⏳</span> Saving...';

    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_DATASET" });
        if (!response || !response.success || !response.dataset?.posts?.length) {
            alert("No data to save.");
            return;
        }

        const posts = response.dataset.posts;
        
        // Call Backend API
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const token = stored.extension_settings?.token;
        const apiUrl = CONFIG.normalizeUrl(stored.extension_settings?.apiUrl || CONFIG.DEFAULT_API_URL);

        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        // Get active project ID
        const activeProjectId = await getActiveProjectId();

        const apiResponse = await fetch(`${apiUrl}/api/posts`, {
            method: "POST",
            headers,
            body: JSON.stringify({ posts, project_id: activeProjectId })
        });

        // Also flush ALL accumulated profile stats in one batch (Redundancy)
        const storedProfiles = await chrome.storage.local.get(["profiles_dataset"]);
        const profilesToSave = storedProfiles.profiles_dataset || [];
        
        if (profilesToSave.length > 0) {
            try {
                const userRes = await fetch(`${apiUrl}/api/users`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ users: profilesToSave, project_id: activeProjectId })
                });
                const userResData = await userRes.json();
                console.log(`[Popup] Flushed ${profilesToSave.length} latest profiles manually (Upserted: ${userResData.upserted}).`);
            } catch (ignore) {
                console.warn("[Popup] Failed flushing batch profile stats", ignore);
            }
        }

        const result = await apiResponse.json();

        if (result.success) {
            console.log(`[Popup] Successfully saved ${result.total} records (Inserted: ${result.inserted}, Updated: ${result.updated})`);
            alert(`✅ Successfully saved to Database!\nTotal: ${result.total}\nNew: ${result.inserted}\nUpdated: ${result.updated}`);
        } else {
            console.error("[Popup] Save to DB failed:", result.error);
            alert(`❌ Error saving to database: ${result.error}`);
        }
    } catch (err) {
        console.error("[Popup] Save to DB error:", err);
        alert(`❌ Connection Error: ${CONFIG.CONNECTION_ERROR_MESSAGE}`);
    } finally {
        els.btnSaveDB.disabled = false;
        els.btnSaveDB.innerHTML = originalContent;
    }
}

async function handleClear() {
    if (!confirm("Clear all captured data? This cannot be undone.")) return;

    try {
        await chrome.runtime.sendMessage({ type: "CLEAR_DATASET" });
        resetCapturedDataUI();
        console.log("[Popup] Dataset cleared");
    } catch (err) {
        console.error("[Popup] Clear error:", err);
    }
}

// Resets the captured-data UI (stat tiles + preview) to an empty state.
// Assumes the underlying dataset has already been cleared via CLEAR_DATASET.
function resetCapturedDataUI() {
    if (els.statProfiles) els.statProfiles.textContent = "0";
    if (els.statPosts) els.statPosts.textContent = "0";
    if (els.statQueries) els.statQueries.textContent = "0";
    if (els.btnExport) els.btnExport.disabled = true;
    if (els.btnClear) els.btnClear.disabled = true;
    if (els.previewSection) els.previewSection.style.display = "none";
    if (els.previewList) els.previewList.innerHTML = "";
}

// ==================== Helpers ====================

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!num && num !== 0) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toString();
}

// ==================== Auto-Refresh Stats ====================

// Poll stats every 3 seconds while popup is open
setInterval(async () => {
    try {
        const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
        if (status && status.success) {
            renderStats(status.stats);
            renderCaptureState(status.capture);
            if (status.profilesCount !== undefined) {
                els.statProfiles.textContent = status.profilesCount;
            }
        }
    } catch (e) {
        // Popup closing, ignore
    }
}, 3000);
