/**
 * Content Script — Runs in content script sandbox on instagram.com
 *
 * Responsibilities:
 *   1. Detect platform (instagram.com)
 *   2. Inject the fetch interceptor (injected.js) into page context
 *   3. Listen for captured GraphQL data via window.postMessage
 *   4. Forward captured data to background.js via chrome.runtime.sendMessage
 *   5. Report platform status to background
 */

(function () {
    "use strict";

    const GRAPHQL_MESSAGE_TYPE = "INSTA_SURFER_GRAPHQL_CAPTURE";

    console.log("[Insta Surfer] Content script loaded on:", window.location.href);

    // ==================== Platform Detection ====================

    function detectPlatform() {
        const hostname = window.location.hostname;
        if (hostname.includes("instagram.com")) {
            return { detected: true, platform: "instagram", url: window.location.href };
        }
        return { detected: false, platform: null, url: window.location.href };
    }

    // Report platform status to background
    const platformInfo = detectPlatform();
    chrome.runtime.sendMessage({
        type: "PLATFORM_DETECTED",
        payload: platformInfo,
    });

    console.log("[Insta Surfer] Platform detection:", platformInfo);

    // ==================== Inject Fetch Interceptor ====================

    function injectScript() {
        try {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("injected.js");
            script.onload = function () {
                this.remove(); // Clean up after injection
            };
            (document.head || document.documentElement).appendChild(script);
            console.log("[Insta Surfer] Injected fetch interceptor into page context");
        } catch (err) {
            console.error("[Insta Surfer] Failed to inject script:", err);
        }
    }

    injectScript();

    // ==================== Listen for Captured GraphQL Data ====================

    let captureActive = false;

    // Check initial capture state from background
    chrome.runtime.sendMessage({ type: "GET_CAPTURE_STATE" }, (response) => {
        if (response && response.active) {
            captureActive = true;
            console.log("[Insta Surfer] Capture is active — listening for GraphQL data");
        }
        updateCaptureDotUI(); // covers the case where this resolves after the card is already built
    });

    // ==================== Auto Scroll ====================
    // Repeatedly jumps the page to its current bottom, simulating the user
    // holding End, so Instagram's infinite-scroll keeps loading more content.
    // Toggled from the popup; keeps running after the popup closes (a normal
    // popup's JS context is destroyed on close, but this interval lives here,
    // in the persistent content script) until STOP_AUTO_SCROLL or the page
    // navigates away. SPA navigation within instagram.com does not reload the
    // content script, so it survives clicking through to another profile.

    let autoScrollTimer = null;
    // Ticks taken this session. Reset on Start, left showing its final value
    // after Stop (rather than zeroed) so the on-page card can report "how many
    // scrolls that took" instead of the number vanishing the instant it stops.
    let autoScrollCount = 0;

    function startAutoScroll() {
        if (autoScrollTimer) return; // already running — idempotent
        autoScrollCount = 0;
        updateAutoScrollUI(true);
        autoScrollTimer = setInterval(() => {
            // Instant jump, not smooth: smooth scrolling animates and queues,
            // so it falls behind when re-triggered every tick.
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
            autoScrollCount++;
            updateAutoScrollUI(true);
        }, 600);
        console.log("[Insta Surfer] Auto scroll started");
    }

    function stopAutoScroll() {
        if (autoScrollTimer) {
            clearInterval(autoScrollTimer);
            autoScrollTimer = null;
            updateAutoScrollUI(false);
            console.log("[Insta Surfer] Auto scroll stopped");
        }
    }

    // Keeps the on-page card's button/label and scroll count in sync,
    // regardless of whether auto-scroll was toggled from the card itself or
    // relayed here from the popup — both drive the same timer, this is the
    // one place that reflects it into the DOM. onpageCounterCard is assigned
    // in buildOnPagePanel(), called unconditionally at script load, so by the
    // time any of these can fire the card already exists; the guard covers
    // the (currently unreachable) case where it doesn't.
    function updateAutoScrollUI(active) {
        if (!onpageCounterCard) return;
        const btn = onpageCounterCard.querySelector('[data-tsc="autoscroll-toggle"]');
        if (btn) {
            btn.classList.toggle("on", active);
            btn.textContent = active ? "⏸ Stop Auto Scroll" : "⤓ Start Auto Scroll";
        }
        const countEl = onpageCounterCard.querySelector('[data-tsc="scroll-count"]');
        if (countEl) countEl.textContent = String(autoScrollCount);
    }

    // Listen for capture state changes and auto-scroll controls from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case "SET_CAPTURE_STATE":
                captureActive = message.active;
                console.log(`[Insta Surfer] Capture state changed: ${captureActive ? "ACTIVE" : "STOPPED"}`);
                updateCaptureDotUI();
                sendResponse({ success: true });
                return false;

            case "START_AUTO_SCROLL":
                startAutoScroll();
                sendResponse({ success: true, active: true, scrollCount: autoScrollCount });
                return false;

            case "STOP_AUTO_SCROLL":
                stopAutoScroll();
                sendResponse({ success: true, active: false, scrollCount: autoScrollCount });
                return false;

            case "GET_AUTO_SCROLL_STATE":
                sendResponse({ success: true, active: !!autoScrollTimer, scrollCount: autoScrollCount });
                return false;

            default:
                return false; // not ours — let the other listeners handle it
        }
    });

    // Listen for GraphQL captures from injected.js
    window.addEventListener("message", (event) => {
        // Only accept messages from the same page
        if (event.source !== window) return;
        if (!event.data || event.data.type !== GRAPHQL_MESSAGE_TYPE) return;

        // Only forward if capture is active
        if (!captureActive) return;

        const { payload } = event.data;
        console.log("[Insta Surfer] Captured GraphQL response:", {
            queryHash: payload.queryHash,
            method: payload.method,
            hasData: !!payload.response?.data,
        });

        // Forward to background service worker
        chrome.runtime.sendMessage({
            type: "GRAPHQL_CAPTURED",
            payload: payload,
        });
    });

    // ==================== Extract Username from Page ====================

    function extractUsername() {
        // Try to extract from URL path: /username/
        const pathMatch = window.location.pathname.match(/^\/([^/]+)\/?$/);
        if (pathMatch && !["explore", "reels", "stories", "direct", "accounts", "p"].includes(pathMatch[1])) {
            return pathMatch[1];
        }
        return null;
    }

    // Report detected username
    const username = extractUsername();
    if (username) {
        chrome.runtime.sendMessage({
            type: "USERNAME_DETECTED",
            payload: { username },
        });
        console.log("[Insta Surfer] Detected profile username:", username);
    }

    // ==================== Update Notification Banner ====================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "UPDATE_AVAILABLE") {
            handleUpdateMessage(message.payload);
        }
    });

    // Check for pending updates immediately on load for this tab
    chrome.storage.local.get(["pendingUpdate"], (res) => {
        if (res.pendingUpdate) {
            handleUpdateMessage(res.pendingUpdate);
        }
    });

    /**
     * Handle the update availability message
     */
    async function handleUpdateMessage(data) {
        try {
            const res = await chrome.storage.local.get("lastSeenUpdateVersion");
            if (res.lastSeenUpdateVersion === data.version) {
                console.log("[Insta Surfer] Update banner already seen for version:", data.version);
                return;
            }

            showUpdateBanner(data);
        } catch (err) {
            console.error("[Insta Surfer] Error handling update message:", err);
        }
    }

    /**
     * Render a premium update banner at the top of the page
     */
    function showUpdateBanner(data) {
        // Remove existing banner if any
        const existing = document.getElementById("insta-surfer-update-banner");
        if (existing) existing.remove();

        const banner = document.createElement("div");
        banner.id = "insta-surfer-update-banner";
        
        // Premium Styles
        Object.assign(banner.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            zIndex: "999999",
            background: "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid rgba(0, 0, 0, 0.1)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "15px",
            transition: "all 0.3s ease",
            animation: "slideDown 0.5s ease-out",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        });

        // Add keyframes for animation
        if (!document.getElementById("insta-surfer-styles")) {
            const styleSheet = document.createElement("style");
            styleSheet.id = "insta-surfer-styles";
            styleSheet.innerText = `
                @keyframes slideDown {
                    from { transform: translateY(-100%); }
                    to { transform: translateY(0); }
                }
                .is-update-btn {
                    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-weight: 600;
                    font-size: 14px;
                    cursor: pointer;
                    transition: transform 0.2s;
                }
                .is-update-btn:hover { transform: scale(1.05); }
                .is-dismiss-btn {
                    background: transparent;
                    color: #666;
                    border: none;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0 10px;
                }
                .is-dismiss-btn:hover { color: #000; }
            `;
            document.head.appendChild(styleSheet);
        }

        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">🚀</span>
                <span style="color: #262626; font-size: 14px; font-weight: 500;">
                    ${data.message || 'A new update is available for Insta Surfer!'} (v${data.version})
                </span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <button class="is-update-btn">Update Now</button>
                <button class="is-dismiss-btn" title="Dismiss">×</button>
            </div>
        `;

        document.body.prepend(banner);

        // Events
        banner.querySelector(".is-update-btn").onclick = () => {
            window.open(data.url, "_blank");
            banner.remove();
        };

        banner.querySelector(".is-dismiss-btn").onclick = () => {
            chrome.storage.local.set({ lastSeenUpdateVersion: data.version });
            banner.style.transform = "translateY(-100%)";
            setTimeout(() => banner.remove(), 300);
        };
    }

    // ==================== On-Page Counter Card ====================
    // A small fixed widget in the top-right corner holding:
    //   1. A hard-refresh button (bypasses cache — the programmatic Ctrl+Shift+R)
    //   2. A live stats card mirroring the popup's capture stats, driven purely by
    //      `capture_stats` / `onpage_counter_enabled` in chrome.storage.local.
    // Passive live view: background WRITES capture_stats, this SUBSCRIBES via
    // storage.onChanged. The only direct messages are the two imperative actions.
    // The card is ON by default (hidden only when the user explicitly toggles it off).

    let onpagePanel = null;
    let onpageCounterCard = null;

    function whenBodyReady(cb) {
        if (document.body) { cb(); return; }
        document.addEventListener("DOMContentLoaded", cb, { once: true });
    }

    function buildOnPagePanel() {
        if (onpagePanel || !document.body) return;

        // Distinct id from the update-banner stylesheet ("insta-surfer-styles") to avoid collision.
        if (!document.getElementById("insta-surfer-onpage-styles")) {
            const style = document.createElement("style");
            style.id = "insta-surfer-onpage-styles";
            style.textContent = `
                #insta-surfer-onpage-panel {
                    position: fixed; top: 84px; right: 16px; z-index: 2147483646;
                    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
                    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
                    pointer-events: none;
                }
                #insta-surfer-onpage-panel > * { pointer-events: auto; }
                #insta-surfer-hard-refresh {
                    width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
                    background: linear-gradient(135deg, #f09433, #dc2743); color: #fff;
                    font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 6px 18px rgba(220,39,67,0.45); transition: transform .15s ease, box-shadow .15s ease;
                }
                #insta-surfer-hard-refresh:hover { transform: scale(1.08) rotate(45deg); box-shadow: 0 8px 22px rgba(220,39,67,0.6); }
                #insta-surfer-hard-refresh:active { transform: scale(0.94); }
                #insta-surfer-counter-card {
                    background: linear-gradient(135deg, rgba(30,41,59,0.96), rgba(15,23,42,0.96));
                    backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 12px; padding: 10px 14px; color: #fff;
                    box-shadow: 0 8px 28px rgba(0,0,0,0.35); min-width: 150px;
                }
                #insta-surfer-counter-card .tsc-title {
                    font-size: 11px; font-weight: 700; letter-spacing: .4px; color: rgba(255,255,255,0.85);
                    display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
                }
                #insta-surfer-counter-card .tsc-context {
                    display: flex; align-items: center; gap: 6px; max-width: 220px;
                    background: rgba(220,39,67,0.18); border: 1px solid rgba(220,39,67,0.3);
                    border-radius: 8px; padding: 4px 8px; margin-bottom: 8px;
                }
                #insta-surfer-counter-card .tsc-ctx-icon { font-size: 12px; line-height: 1; flex: 0 0 auto; }
                #insta-surfer-counter-card .tsc-ctx-label {
                    font-size: 11px; font-weight: 600; color: #fbcfe8;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                #insta-surfer-counter-card .tsc-profile-stats {
                    font-size: 11px; color: #94a3b8; margin: -4px 0 8px 2px;
                    max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                #insta-surfer-counter-card .tsc-dot {
                    width: 7px; height: 7px; border-radius: 50%; background: #ef4444;
                    transition: background .2s ease;
                }
                #insta-surfer-counter-card .tsc-dot.on {
                    background: #22c55e;
                    box-shadow: 0 0 0 0 rgba(34,197,94,0.6); animation: is-tsc-pulse 2s infinite;
                }
                @keyframes is-tsc-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }
                    70% { box-shadow: 0 0 0 7px rgba(34,197,94,0); }
                    100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
                }
                #insta-surfer-counter-card .tsc-row {
                    display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
                    font-size: 12px; padding: 2px 0;
                }
                #insta-surfer-counter-card .tsc-label { color: #94a3b8; }
                #insta-surfer-counter-card .tsc-value { font-weight: 700; font-size: 15px; color: #fff; }
                #insta-surfer-counter-card .tsc-open-viewer {
                    margin-top: 8px; width: 100%; display: none; align-items: center; justify-content: center; gap: 6px;
                    background: linear-gradient(135deg, #f09433, #dc2743); color: #fff; border: none;
                    border-radius: 8px; padding: 7px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
                    transition: filter .15s ease;
                }
                #insta-surfer-counter-card:hover .tsc-open-viewer { display: flex; }
                #insta-surfer-counter-card .tsc-open-viewer:hover { filter: brightness(1.12); }
                #insta-surfer-counter-card .tsc-autoscroll {
                    margin-top: 8px; width: 100%; display: none; align-items: center; justify-content: center; gap: 6px;
                    background: rgba(148,163,184,0.16); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.35);
                    border-radius: 8px; padding: 7px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
                    transition: filter .15s ease, background .2s ease, color .2s ease, border-color .2s ease;
                }
                #insta-surfer-counter-card:hover .tsc-autoscroll { display: flex; }
                #insta-surfer-counter-card .tsc-autoscroll:hover { filter: brightness(1.12); }
                #insta-surfer-counter-card .tsc-autoscroll.on {
                    background: #22c55e; color: #fff; border-color: transparent;
                    box-shadow: 0 0 10px rgba(34,197,94,0.4);
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        }

        onpagePanel = document.createElement("div");
        onpagePanel.id = "insta-surfer-onpage-panel";

        const refreshBtn = document.createElement("button");
        refreshBtn.id = "insta-surfer-hard-refresh";
        refreshBtn.title = "Hard refresh this page (bypass cache)";
        refreshBtn.textContent = "⟳";
        refreshBtn.addEventListener("click", () => {
            // Ask the background to hard-reload this tab (bypasses cache). Fall back
            // to a plain reload if the extension context is unavailable.
            try {
                chrome.runtime.sendMessage({ type: "HARD_RELOAD" }, () => {
                    if (chrome.runtime.lastError) location.reload();
                });
            } catch (e) {
                location.reload();
            }
        });

        onpageCounterCard = document.createElement("div");
        onpageCounterCard.id = "insta-surfer-counter-card";
        onpageCounterCard.style.display = "none";
        onpageCounterCard.innerHTML = `
            <div class="tsc-title"><span class="tsc-dot" data-tsc="capture-dot"></span> INSTA SURFER</div>
            <div class="tsc-context"><span class="tsc-ctx-icon" data-tsc="ctx-icon"></span><span class="tsc-ctx-label" data-tsc="ctx-label"></span></div>
            <div class="tsc-profile-stats" data-tsc="profile-stats" style="display:none;"></div>
            <div class="tsc-row"><span class="tsc-label">Posts</span><span class="tsc-value" data-tsc="posts">0</span></div>
            <div class="tsc-row"><span class="tsc-label">Comments</span><span class="tsc-value" data-tsc="comments">0</span></div>
            <div class="tsc-row"><span class="tsc-label">Views</span><span class="tsc-value" data-tsc="views">0</span></div>
            <button class="tsc-autoscroll" data-tsc="autoscroll-toggle" title="Repeatedly scroll to the bottom, like holding End, until clicked again">⤓ Start Auto Scroll</button>
            <button class="tsc-open-viewer" data-tsc="open-viewer" title="Open the dataset viewer (posts & comments)">📂 Open dataset viewer</button>
            `;
            updateCaptureDotUI(); // reflect whatever captureActive already is at build time
            // <div class="tsc-row"><span class="tsc-label">Scrolls</span><span class="tsc-value" data-tsc="scroll-count">0</span></div>

        const openViewerBtn = onpageCounterCard.querySelector('[data-tsc="open-viewer"]');
        if (openViewerBtn) {
            openViewerBtn.addEventListener("click", () => {
                try {
                    chrome.runtime.sendMessage({ type: "OPEN_DATASET_VIEWER" }, () => void chrome.runtime.lastError);
                } catch (e) { /* extension context unavailable */ }
            });
        }

        const autoscrollBtn = onpageCounterCard.querySelector('[data-tsc="autoscroll-toggle"]');
        if (autoscrollBtn) {
            autoscrollBtn.addEventListener("click", () => {
                if (autoScrollTimer) stopAutoScroll(); else startAutoScroll();
            });
        }

        onpagePanel.appendChild(refreshBtn);
        onpagePanel.appendChild(onpageCounterCard);
        document.body.appendChild(onpagePanel);
        updateOnPageContext();
    }

    // Derive a human-readable label for the Instagram page we're gathering from.
    // The only site coupling in the whole card — URL-based, reads no IG DOM.
    function getPageContext() {
        const path = window.location.pathname;

        // Hashtag feed: /explore/tags/<tag>/
        const tagMatch = path.match(/^\/explore\/tags\/([^/]+)/);
        if (tagMatch) {
            let tag = tagMatch[1];
            try { tag = decodeURIComponent(tag); } catch (e) { /* keep raw */ }
            return { icon: "🏷️", label: "#" + tag };
        }

        // Search: ?q=<keyword> (e.g. /explore/search/keyword/?q=foo)
        try {
            const q = new URLSearchParams(window.location.search).get("q");
            if (q) return { icon: "🔍", label: '"' + q + '"' };
        } catch (e) { /* no query */ }

        // Reels feed or single reel: /reels/ , /reel/<id>/
        if (/^\/reels?\//.test(path)) return { icon: "🎬", label: "Reels" };

        // Single post: /p/<shortcode>/
        if (/^\/p\//.test(path)) return { icon: "🖼️", label: "Post" };

        // Explore landing
        if (/^\/explore\/?$/.test(path)) return { icon: "🧭", label: "Explore" };

        // Direct messages
        if (/^\/direct\//.test(path)) return { icon: "✉️", label: "Direct" };

        // Profile — reuse the closure's extractUsername() (single non-reserved segment)
        const profile = extractUsername();
        if (profile) return { icon: "👤", label: "@" + profile, username: profile };

        // Home feed
        if (path === "/" || path === "") return { icon: "🏠", label: "Home" };

        const seg = path.split("/").filter(Boolean)[0];
        return { icon: "📄", label: seg || "Instagram" };
    }

    // Username the profile-stats line last rendered for, so the
    // profiles_dataset storage listener knows whether a write is about the
    // profile currently being viewed (and worth a live re-render) or some
    // other profile captured in the background.
    let currentContextUsername = null;

    // Reflects captureActive onto the title dot: red when capture is off,
    // green (pulsing) when on. Called from three places — the initial
    // GET_CAPTURE_STATE response, buildOnPagePanel() (in case that response
    // already arrived first), and SET_CAPTURE_STATE — so the dot is correct
    // regardless of which of the two async events (card built vs. capture
    // state known) happens to land first. Idempotent; safe to over-call.
    function updateCaptureDotUI() {
        const dot = onpageCounterCard && onpageCounterCard.querySelector('[data-tsc="capture-dot"]');
        if (dot) dot.classList.toggle("on", captureActive);
    }

    function renderProfileStats(username, profiles) {
        const el = onpageCounterCard && onpageCounterCard.querySelector('[data-tsc="profile-stats"]');
        if (!el) return;
        const profile = username && (profiles || []).find(p => p.username === username);
        // No captured data yet for this profile — hide rather than show 0s,
        // which would read as "zero posts" instead of "not captured yet".
        if (!profile || !(profile.media_count > 0 || profile.follower_count > 0)) {
            el.style.display = "none";
            el.textContent = "";
            return;
        }
        el.textContent = `${(profile.media_count || 0).toLocaleString()} posts · `
            + `${(profile.follower_count || 0).toLocaleString()} followers`;
        el.style.display = "block";
    }

    function updateOnPageContext() {
        if (!onpageCounterCard) return;
        const ctx = getPageContext();
        const iconEl = onpageCounterCard.querySelector('[data-tsc="ctx-icon"]');
        const labelEl = onpageCounterCard.querySelector('[data-tsc="ctx-label"]');
        // textContent (never innerHTML) — page-derived strings must stay inert.
        if (iconEl) iconEl.textContent = ctx.icon;
        if (labelEl) {
            labelEl.textContent = ctx.label;
            labelEl.title = ctx.label;
        }

        currentContextUsername = ctx.username || null;
        if (currentContextUsername) {
            chrome.storage.local.get(["profiles_dataset"], (res) => {
                renderProfileStats(currentContextUsername, res.profiles_dataset);
            });
            refreshProfilePostCount(currentContextUsername);
        } else {
            renderProfileStats(null, null);
            // Left the profile page — Posts reverts to the store-wide total.
            // renderOnPageCounter's guard now passes since currentContextUsername
            // is null, so this repaints it instead of leaving the last profile's
            // (now stale) number on screen.
            chrome.storage.local.get(["capture_stats"], (res) => renderOnPageCounter(res.capture_stats));
        }
    }

    // Compact K/M/B formatter — viewsCaptured is a store-wide sum and can reach
    // millions; shared with the profile-scoped Posts count below.
    function fmtCompact(n) {
        if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
        if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
        return String(n);
    }

    function renderOnPageCounter(stats) {
        if (!onpageCounterCard) return;
        const set = (key, val) => {
            const el = onpageCounterCard.querySelector(`[data-tsc="${key}"]`);
            if (el) el.textContent = fmtCompact(val || 0);
        };
        // Posts is scoped to the profile being viewed when there is one (see
        // refreshProfilePostCount) — capture_stats.postsCaptured is store-wide
        // and would overwrite that with the wrong number on every capture tick.
        if (!currentContextUsername) set("posts", stats?.postsCaptured);
        set("comments", stats?.commentsCaptured);
        set("views", stats?.viewsCaptured);
    }

    // Posts captured for the specific profile being viewed, not the store-wide
    // total — e.g. @barbicanworld's row reads however many of ITS posts are in
    // the local dataset, not "549" (every post from every profile this
    // session). Requires a background round trip (PostsStore.getAllPosts() is
    // a full scan; content scripts don't have PostsStore), so this is called
    // on meaningful events only — a profile navigation, or a capture_stats
    // change while already on one — never on a timer.
    function refreshProfilePostCount(username) {
        if (!onpageCounterCard) return;
        chrome.runtime.sendMessage({ type: "GET_PROFILE_POST_COUNT", username }, (response) => {
            if (chrome.runtime.lastError) return; // extension context gone / bg unreachable
            // The user may have navigated away before this resolved.
            if (username !== currentContextUsername) return;
            const el = onpageCounterCard.querySelector('[data-tsc="posts"]');
            if (el && response && response.success) el.textContent = fmtCompact(response.count || 0);
        });
    }

    function setCounterVisibility(enabled) {
        if (!onpageCounterCard) return;
        onpageCounterCard.style.display = enabled ? "block" : "none";
        if (enabled) {
            updateOnPageContext();
            chrome.storage.local.get(["capture_stats"], (res) => {
                renderOnPageCounter(res.capture_stats);
            });
        }
    }

    function initOnPagePanel() {
        whenBodyReady(() => {
            buildOnPagePanel();
            chrome.storage.local.get(["onpage_counter_enabled", "capture_stats"], (res) => {
                if (res.capture_stats) renderOnPageCounter(res.capture_stats);
                // Default ON: visible unless the user has explicitly toggled it off.
                setCounterVisibility(res.onpage_counter_enabled !== false);
            });

            // SPA fallback: Instagram's in-app navigation doesn't always fire
            // popstate/pushState, so the context label could go stale. Poll the URL
            // and refresh the label whenever it changes.
            let lastSeenUrl = window.location.href;
            setInterval(() => {
                if (window.location.href !== lastSeenUrl) {
                    lastSeenUrl = window.location.href;
                    updateOnPageContext();
                }
            }, 700);
        });
    }

    // The only coupling to background/popup: react to storage writes.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.capture_stats && onpageCounterCard && onpageCounterCard.style.display !== "none") {
            renderOnPageCounter(changes.capture_stats.newValue);
            // A capture_stats change means the store changed — if we're on a
            // profile page, its post count may have just gone up.
            if (currentContextUsername) refreshProfilePostCount(currentContextUsername);
        }
        if (changes.onpage_counter_enabled) {
            setCounterVisibility(!!changes.onpage_counter_enabled.newValue);
        }
        // Profile capture can complete a few seconds after landing on the page
        // (it depends on Instagram's own GraphQL response), so re-render the
        // stats line live once it does — but only when it's for the profile
        // currently on screen; a background capture of some other profile
        // shouldn't touch this tab's card.
        if (changes.profiles_dataset && currentContextUsername
            && onpageCounterCard && onpageCounterCard.style.display !== "none") {
            renderProfileStats(currentContextUsername, changes.profiles_dataset.newValue);
        }
    });

    initOnPagePanel();
})();
