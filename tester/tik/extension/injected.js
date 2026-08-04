/**
 * Injected Script — Runs in PAGE context (not content script sandbox)
 *
 * Purpose:
 *   Monkey-patches window.fetch and XMLHttpRequest to intercept
 *   GraphQL responses from Instagram's API endpoints.
 *
 * Instagram's current API patterns (2025+):
 *   - POST to /api/graphql (modern, uses doc_id in body)
 *   - POST to /graphql/query (legacy, uses query_hash in URL)
 *   - Various /api/v1/ REST endpoints
 *
 * Communication:
 *   injected.js → window.postMessage → content.js → chrome.runtime.sendMessage → background.js
 */

(function () {
    "use strict";

    // Match ALL graphql-related endpoints Instagram uses
    const GRAPHQL_PATTERNS = [
        /\/api\/graphql/i,
        /\/graphql\/query/i,
        /\/api\/v1\/feed\/user\//i,
        /\/api\/v1\/users\//i,
    ];

    const MESSAGE_TYPE = "INSTA_SURFER_GRAPHQL_CAPTURE";

    function isGraphQLRequest(url) {
        return GRAPHQL_PATTERNS.some(pattern => pattern.test(url));
    }

    console.log("[Insta Surfer] Injected script loaded — intercepting GraphQL requests");

    // ==================== Fetch Interceptor ====================

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const [resource, config] = args;
        const url = typeof resource === "string" ? resource : resource?.url || "";

        // Call original fetch
        const response = await originalFetch.apply(this, args);

        // Check if this is a GraphQL / API request
        if (isGraphQLRequest(url)) {
            try {
                // Clone response so we don't consume the original stream
                const cloned = response.clone();
                const responseText = await cloned.text();

                let responseJSON = null;
                try {
                    responseJSON = JSON.parse(responseText);
                } catch (e) {
                    // Not JSON — skip
                }

                if (responseJSON && responseJSON.data) {
                    // Extract doc_id from request body (POST requests)
                    let docId = null;
                    let variables = {};

                    if (config && config.body) {
                        try {
                            // Body can be FormData, URLSearchParams, or string
                            let bodyStr = "";
                            if (typeof config.body === "string") {
                                bodyStr = config.body;
                            } else if (config.body instanceof URLSearchParams) {
                                bodyStr = config.body.toString();
                            }

                            // Parse as URL params (Instagram sends form-encoded POST body)
                            const params = new URLSearchParams(bodyStr);
                            docId = params.get("doc_id") || params.get("query_hash") || null;

                            try {
                                variables = JSON.parse(params.get("variables") || "{}");
                            } catch (e) {}
                        } catch (e) {}
                    }

                    // Also check URL params (for GET requests)
                    if (!docId) {
                        try {
                            const urlObj = new URL(url, window.location.origin);
                            docId = urlObj.searchParams.get("doc_id")
                                || urlObj.searchParams.get("query_hash")
                                || null;
                            if (!Object.keys(variables).length) {
                                try {
                                    variables = JSON.parse(urlObj.searchParams.get("variables") || "{}");
                                } catch (e) {}
                            }
                        } catch (e) {}
                    }

                    // Post to content script
                    window.postMessage({
                        type: MESSAGE_TYPE,
                        payload: {
                            url: url,
                            queryHash: docId,
                            variables: variables,
                            response: responseJSON,
                            timestamp: Date.now(),
                            method: "fetch",
                            requestMethod: config?.method || "GET",
                        },
                    }, "*");

                    console.log("[Insta Surfer] ✅ Captured GraphQL response:", {
                        url: url.substring(0, 80),
                        docId,
                        dataKeys: Object.keys(responseJSON.data || {}),
                    });
                }
            } catch (err) {
                console.warn("[Insta Surfer] Failed to capture fetch response:", err.message);
            }
        }

        return response;
    };

    // ==================== XMLHttpRequest Interceptor ====================

    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._instaSurferUrl = url;
        this._instaSurferMethod = method;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const sendBody = args[0];

        if (this._instaSurferUrl && isGraphQLRequest(this._instaSurferUrl)) {
            this.addEventListener("load", function () {
                try {
                    let responseJSON = null;
                    try {
                        responseJSON = JSON.parse(this.responseText);
                    } catch (e) {}

                    if (responseJSON && responseJSON.data) {
                        let docId = null;
                        let variables = {};

                        // Parse from request body
                        if (sendBody) {
                            try {
                                const params = new URLSearchParams(sendBody.toString());
                                docId = params.get("doc_id") || params.get("query_hash") || null;
                                try {
                                    variables = JSON.parse(params.get("variables") || "{}");
                                } catch (e) {}
                            } catch (e) {}
                        }

                        // Parse from URL
                        if (!docId) {
                            try {
                                const urlObj = new URL(this._instaSurferUrl, window.location.origin);
                                docId = urlObj.searchParams.get("doc_id")
                                    || urlObj.searchParams.get("query_hash")
                                    || null;
                            } catch (e) {}
                        }

                        window.postMessage({
                            type: MESSAGE_TYPE,
                            payload: {
                                url: this._instaSurferUrl,
                                queryHash: docId,
                                variables: variables,
                                response: responseJSON,
                                timestamp: Date.now(),
                                method: "xhr",
                                requestMethod: this._instaSurferMethod,
                            },
                        }, "*");

                        console.log("[Insta Surfer] ✅ Captured XHR response:", {
                            url: this._instaSurferUrl.substring(0, 80),
                            docId,
                        });
                    }
                } catch (err) {
                    console.warn("[Insta Surfer] Failed to capture XHR response:", err.message);
                }
            });
        }

        return originalXHRSend.apply(this, args);
    };

    console.log("[Insta Surfer] Fetch + XHR interceptors installed — watching for GraphQL + API requests");
})();
