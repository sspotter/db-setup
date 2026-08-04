/**
 * Global Configuration — Insta Surfer
 * 
 * Centralized settings for the extension.
 */
const CONFIG = {
    // Default Backend API URL
    // DEFAULT_API_URL: "http://localhost:3002/",
    DEFAULT_API_URL: "http://instasurfer.medpushmena.com:8442/",
    // DEFAULT_API_URL: "https://medpush-virtual-machine.tail3e5104.ts.net/",
    // DEFAULT_API_URL: "https://instasurfdatabase.vercel.app/",
    // DEFAULT_API_URL: "https://ideal-robot-pjjpr7rw7942r7pq-3001.app.github.dev/",
    
    // Help Message
    CONNECTION_ERROR_MESSAGE: "Ensure your backend is running at ${DEFAULT_API_URL}",

    // Utilities
    normalizeUrl: function(url) {
        if (!url) return "";
        let u = url.trim();
        if (u.endsWith('/')) u = u.slice(0, -1);
        return u;
    }
};

// Ensure it's available in global scope for different environments
if (typeof globalThis !== 'undefined') {
    globalThis.CONFIG = CONFIG;
}
