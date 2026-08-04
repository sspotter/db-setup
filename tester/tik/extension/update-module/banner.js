/**
 * Insta Surfer - Shared Update Banner (Popup & Options)
 * Automatically checks for pending updates and displays a banner.
 */

(function initUpdateBanner() {
    "use strict";

    async function checkUpdate() {
        try {
            const data = await chrome.storage.local.get(["pendingUpdate", "lastSeenUpdateVersion"]);
            const updateData = data.pendingUpdate;

            if (!updateData) return; // No pending update
            if (data.lastSeenUpdateVersion === updateData.version) return; // Already dismissed

            showUpdateBanner(updateData);
        } catch (err) {
            console.error("[Insta Surfer Banner] Error checking update:", err);
        }
    }

    // Also listen for broadcasts if the popup is already open when the check happens
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "UPDATE_AVAILABLE") {
            chrome.storage.local.get("lastSeenUpdateVersion", (val) => {
                if (val.lastSeenUpdateVersion !== message.payload.version) {
                    showUpdateBanner(message.payload);
                }
            });
        }
    });

    function showUpdateBanner(data) {
        // Remove existing if any
        const existing = document.getElementById("insta-surfer-global-banner");
        if (existing) existing.remove();

        const banner = document.createElement("div");
        banner.id = "insta-surfer-global-banner";
        
        // Premium Styles for extension contexts
        Object.assign(banner.style, {
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            zIndex: "999999",
            background: "rgba(30, 30, 46, 0.95)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "all 0.3s ease",
            animation: "slideDown 0.5s ease-out",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            color: "#fff",
            boxSizing: "border-box"
        });

        // Add keyframes for animation
        if (!document.getElementById("insta-surfer-banner-styles")) {
            const styleSheet = document.createElement("style");
            styleSheet.id = "insta-surfer-banner-styles";
            styleSheet.innerText = `
                @keyframes slideDown {
                    from { transform: translateY(-100%); }
                    to { transform: translateY(0); }
                }
                .is-global-update-btn {
                    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
                    color: white;
                    border: none;
                    padding: 6px 16px;
                    border-radius: 20px;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    transition: transform 0.2s;
                    text-decoration: none;
                    display: inline-block;
                }
                .is-global-update-btn:hover { transform: scale(1.05); }
                .is-global-dismiss-btn {
                    background: none;
                    border: none;
                    color: #a1a1aa;
                    cursor: pointer;
                    font-size: 18px;
                    line-height: 1;
                    padding: 4px;
                    transition: color 0.2s;
                    position: absolute;
                    top: 8px;
                    right: 8px;
                }
                .is-global-dismiss-btn:hover { color: #fff; }
                .is-global-banner-text {
                    font-size: 13px;
                    font-weight: 500;
                    text-align: center;
                    margin: 0;
                    padding-right: 20px;
                }
            `;
            document.head.appendChild(styleSheet);
        }

        const typeLabel = data.type === 'major' ? '🔥 Major Update' : '✨ New Update';

        banner.innerHTML = `
            <p class="is-global-banner-text">
                <strong>${typeLabel} (v${data.version}):</strong> ${data.message}
            </p>
            <div style="display: flex; gap: 10px;">
                <button class="is-global-update-btn" id="is-global-update-action">Update Now</button>
            </div>
            <button class="is-global-dismiss-btn" id="is-global-dismiss-action" title="Dismiss">&times;</button>
        `;

        document.body.appendChild(banner);

        // Event Listeners
        document.getElementById("is-global-update-action").addEventListener("click", () => {
            if (data.url) {
                window.open(data.url, '_blank');
            }
        });

        document.getElementById("is-global-dismiss-action").addEventListener("click", () => {
            banner.style.transform = "translateY(-100%)";
            banner.style.opacity = "0";
            
            setTimeout(() => banner.remove(), 300);

            // Save dismissal state
            chrome.storage.local.set({ lastSeenUpdateVersion: data.version });
        });
    }

    // Run check on load
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", checkUpdate);
    } else {
        checkUpdate();
    }
})();
