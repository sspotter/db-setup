/**
 * Developer Test Script - Manual UI Trigger
 * Copy and paste this into your extension's Background Service Worker console
 * (Go to chrome://extensions -> Inspect Service Worker)
 */

(function testUpdateUI() {
    const mockData = {
        version: "9.9.9",
        message: "Developer Test: Soft Update Banner is working! 🚀",
        url: "https://google.com",
        type: "minor"
    };

    console.log("--- Manually triggering update banner for testing ---");
    
    // Notify all Instagram tabs
    chrome.tabs.query({ url: "https://*.instagram.com/*" }, (tabs) => {
        if (tabs.length === 0) {
            console.error("No Instagram tabs found! Open Instagram to see the banner.");
            return;
        }
        
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                type: "UPDATE_AVAILABLE",
                payload: mockData
            }).then(() => {
                console.log(`Banner triggered on tab: ${tab.url}`);
            }).catch(err => {
                console.warn(`Failed to trigger on tab ${tab.id}: Script might not be loaded yet.`);
            });
        });
    });
})();
