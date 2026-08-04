/**
 * Storage Utility — Wrapper around chrome.storage.local
 * 
 * Provides clean async API for:
 *   - Capture state management
 *   - Posts dataset storage
 *   - GraphQL query library
 *   - Session persistence
 */

const StorageKeys = {
    CAPTURE_STATE: "capture_state",       // { active: bool, startedAt: timestamp }
    POSTS_DATASET: "posts_dataset",       // { profileId, posts: [] }
    GRAPHQL_QUERIES: "graphql_queries",   // { queryHash: { type, variables, ... } }
    PLATFORM_STATUS: "platform_status",   // { detected: bool, platform: string }
    LOGIN_STATUS: "login_status",         // { loggedIn: bool, username: string }
    CAPTURE_STATS: "capture_stats",       // { totalCaptured, lastCapturedAt }
};

/**
 * Get a value from storage
 * @param {string} key - Storage key
 * @returns {Promise<any>} - Stored value or null
 */
async function storageGet(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
            resolve(result[key] ?? null);
        });
    });
}

/**
 * Set a value in storage
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @returns {Promise<void>}
 */
async function storageSet(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
    });
}

/**
 * Remove a key from storage
 * @param {string} key - Storage key to remove
 * @returns {Promise<void>}
 */
async function storageRemove(key) {
    return new Promise((resolve) => {
        chrome.storage.local.remove([key], resolve);
    });
}

/**
 * Clear all extension storage
 * @returns {Promise<void>}
 */
async function storageClearAll() {
    return new Promise((resolve) => {
        chrome.storage.local.clear(resolve);
    });
}

/**
 * Append posts to the existing dataset (avoids duplicates by shortcode)
 * @param {string} profileUsername - Instagram username
 * @param {Array} newPosts - Array of parsed post objects
 * @returns {Promise<number>} - Total posts count after merge
 */
async function appendPostsToDataset(profileUsername, newPosts) {
    const existing = await storageGet(StorageKeys.POSTS_DATASET) || {
        profileUsername,
        posts: [],
        createdAt: Date.now(),
    };

    // Deduplicate by shortcode
    const existingCodes = new Set(existing.posts.map(p => p.shortcode));
    const uniqueNew = newPosts.filter(p => !existingCodes.has(p.shortcode));

    existing.posts.push(...uniqueNew);
    existing.updatedAt = Date.now();
    existing.profileUsername = profileUsername;

    await storageSet(StorageKeys.POSTS_DATASET, existing);

    // Update stats
    await storageSet(StorageKeys.CAPTURE_STATS, {
        totalCaptured: existing.posts.length,
        newInBatch: uniqueNew.length,
        lastCapturedAt: Date.now(),
    });

    return existing.posts.length;
}

/**
 * Save a discovered GraphQL query to the library
 * @param {string} queryHash - The query hash
 * @param {object} queryMeta - { type, variables, cursorVariable, cursorResponse }
 * @returns {Promise<void>}
 */
async function saveGraphQLQuery(queryHash, queryMeta) {
    const library = await storageGet(StorageKeys.GRAPHQL_QUERIES) || {};
    library[queryHash] = {
        ...queryMeta,
        discoveredAt: Date.now(),
    };
    await storageSet(StorageKeys.GRAPHQL_QUERIES, library);
}

// Export for use in other scripts
if (typeof globalThis !== "undefined") {
    globalThis.StorageKeys = StorageKeys;
    globalThis.storageGet = storageGet;
    globalThis.storageSet = storageSet;
    globalThis.storageRemove = storageRemove;
    globalThis.storageClearAll = storageClearAll;
    globalThis.appendPostsToDataset = appendPostsToDataset;
    globalThis.saveGraphQLQuery = saveGraphQLQuery;
}
