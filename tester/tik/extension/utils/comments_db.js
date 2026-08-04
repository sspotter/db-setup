/**
 * IndexedDB Helper — Local-first comment storage
 * 
 * Provides offline-first storage for comments so data survives:
 *   - Browser crashes
 *   - Extension reloads
 *   - Backend offline
 * 
 * Schema:
 *   comments store: { id, post_shortcode, username, user_id, text, timestamp, likes, replyCount, profilePic, syncedToBackend }
 *   scrape_state store: { key, sessionId, jobs, currentJobIdx, status, ... }
 *   sync_queue store: { id, post_shortcode, comments[], syncedAt }
 */

const DB_NAME = 'InstaSurfer_Comments';
const DB_VERSION = 1;

const STORES = {
    COMMENTS: 'comments',
    SCRAPE_STATE: 'scrape_state',
    SYNC_QUEUE: 'sync_queue',
};

/**
 * Open or create the IndexedDB database
 */
function openCommentsDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Comments store — keyed by IG comment ID
            if (!db.objectStoreNames.contains(STORES.COMMENTS)) {
                const commentsStore = db.createObjectStore(STORES.COMMENTS, { keyPath: 'id' });
                commentsStore.createIndex('post_shortcode', 'post_shortcode', { unique: false });
                commentsStore.createIndex('username', 'username', { unique: false });
                commentsStore.createIndex('synced', 'syncedToBackend', { unique: false });
            }

            // Scrape state store — stores current scraping session/job state
            if (!db.objectStoreNames.contains(STORES.SCRAPE_STATE)) {
                db.createObjectStore(STORES.SCRAPE_STATE, { keyPath: 'key' });
            }

            // Sync queue — batches of comments awaiting backend sync
            if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
                const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
                syncStore.createIndex('post_shortcode', 'post_shortcode', { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Save comments to IndexedDB (batch)
 * @param {string} postShortcode
 * @param {Array} comments
 * @returns {Promise<{inserted: number, duplicates: number}>}
 */
async function saveCommentsLocally(postShortcode, comments) {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readwrite');
        const store = tx.objectStore(STORES.COMMENTS);

        let inserted = 0;
        let duplicates = 0;

        for (const comment of comments) {
            if (!comment.id) continue;

            const record = {
                id: String(comment.id),
                post_shortcode: postShortcode,
                username: comment.username || null,
                user_id: comment.userId || comment.ownerId || comment.user_id || null,
                text: comment.text || null,
                timestamp: comment.timestamp || null,
                likes: comment.likes || 0,
                replyCount: comment.replyCount || 0,
                profilePic: comment.profilePic || null,
                savedAt: Date.now(),
                syncedToBackend: 0,
            };

            const putRequest = store.put(record);
            putRequest.onsuccess = () => inserted++;
            putRequest.onerror = () => duplicates++;
        }

        tx.oncomplete = () => {
            db.close();
            resolve({ inserted, duplicates });
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Get comments from IndexedDB for a specific post
 * @param {string} postShortcode
 * @returns {Promise<Array>}
 */
async function getLocalComments(postShortcode) {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readonly');
        const store = tx.objectStore(STORES.COMMENTS);
        const index = store.index('post_shortcode');
        const request = index.getAll(postShortcode);

        request.onsuccess = () => {
            db.close();
            resolve(request.result || []);
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}
/**
 * Get comments from IndexedDB for multiple shortcodes
 * @param {Array<string>} shortcodes
 * @returns {Promise<Array>}
 */
async function getCommentsForPosts(shortcodes) {
    const db = await openCommentsDB();
    const allComments = [];

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readonly');
        const store = tx.objectStore(STORES.COMMENTS);
        const index = store.index('post_shortcode');

        let pending = shortcodes.length;
        if (pending === 0) {
            db.close();
            return resolve([]);
        }

        for (const sc of shortcodes) {
            const request = index.getAll(sc);
            request.onsuccess = () => {
                if (request.result) allComments.push(...request.result);
                pending--;
                if (pending === 0) {
                    db.close();
                    resolve(allComments);
                }
            };
            request.onerror = () => {
                pending--;
                if (pending === 0) {
                    db.close();
                    resolve(allComments);
                }
            };
        }
    });
}

/**
 * Get comment count per shortcode (for dedup checking)
 * @param {Array<string>} shortcodes
 * @returns {Promise<Object>} Map of shortcode -> count
 */
async function getLocalCommentCounts(shortcodes) {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readonly');
        const store = tx.objectStore(STORES.COMMENTS);
        const index = store.index('post_shortcode');
        const counts = {};

        let pending = shortcodes.length;
        if (pending === 0) {
            db.close();
            return resolve(counts);
        }

        for (const sc of shortcodes) {
            const countReq = index.count(sc);
            countReq.onsuccess = () => {
                if (countReq.result > 0) counts[sc] = countReq.result;
                pending--;
                if (pending === 0) {
                    db.close();
                    resolve(counts);
                }
            };
            countReq.onerror = () => {
                pending--;
                if (pending === 0) {
                    db.close();
                    resolve(counts);
                }
            };
        }
    });
}

/**
 * Get all unsynced comments grouped by post
 * @returns {Promise<Object>} Map of shortcode -> comments[]
 */
async function getUnsyncedComments() {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readonly');
        const store = tx.objectStore(STORES.COMMENTS);
        const index = store.index('synced');
        const request = index.getAll(0);

        request.onsuccess = () => {
            const grouped = {};
            (request.result || []).forEach(c => {
                if (!grouped[c.post_shortcode]) grouped[c.post_shortcode] = [];
                grouped[c.post_shortcode].push(c);
            });
            db.close();
            resolve(grouped);
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

/**
 * Mark comments as synced to backend
 * @param {Array<string>} commentIds
 */
async function markCommentsSynced(commentIds) {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readwrite');
        const store = tx.objectStore(STORES.COMMENTS);

        for (const id of commentIds) {
            store.get(id).onsuccess = (event) => {
                const record = event.target.result;
                if (record) {
                    record.syncedToBackend = 1;
                    store.put(record);
                }
            };
        }

        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

/**
 * Save scrape state (session progress)
 * @param {Object} state
 */
async function saveScrapeState(state) {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.SCRAPE_STATE, 'readwrite');
        const store = tx.objectStore(STORES.SCRAPE_STATE);
        store.put({ key: 'current_session', ...state, updatedAt: Date.now() });

        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

/**
 * Load scrape state
 * @returns {Promise<Object|null>}
 */
async function loadScrapeState() {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.SCRAPE_STATE, 'readonly');
        const store = tx.objectStore(STORES.SCRAPE_STATE);
        const request = store.get('current_session');

        request.onsuccess = () => {
            db.close();
            resolve(request.result || null);
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

/**
 * Clear scrape state (after session completes)
 */
async function clearScrapeState() {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.SCRAPE_STATE, 'readwrite');
        const store = tx.objectStore(STORES.SCRAPE_STATE);
        store.delete('current_session');

        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

/**
 * Get total comment count in IndexedDB
 * @returns {Promise<number>}
 */
async function getTotalLocalComments() {
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readonly');
        const store = tx.objectStore(STORES.COMMENTS);
        const request = store.count();

        request.onsuccess = () => { db.close(); resolve(request.result); };
        request.onerror = () => { db.close(); reject(request.error); };
    });
}

/**
 * Save pre-built sentinel records directly to the comments store.
 * Used to mark zero-comment posts as "scraped" without going through
 * the normal comment parsing path.
 * @param {Array} records - fully-formed comment store records
 * @returns {Promise<void>}
 */
async function saveSentinels(records) {
    if (!records || records.length === 0) return;
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.COMMENTS, 'readwrite');
        const store = tx.objectStore(STORES.COMMENTS);
        for (const record of records) {
            store.put(record); // put = insert or overwrite — idempotent on re-capture
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

/**
 * Save the last known pagination cursor for a post shortcode.
 * Used to resume partial comment scrapes from where they left off.
 * @param {string} shortcode
 * @param {string} cursor - Instagram end_cursor value
 */
async function savePostCursor(shortcode, cursor) {
    if (!shortcode) return;
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.SCRAPE_STATE, 'readwrite');
        const store = tx.objectStore(STORES.SCRAPE_STATE);
        store.put({ key: `cursor_${shortcode}`, shortcode, cursor, savedAt: Date.now() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

/**
 * Get the last saved pagination cursor for a post shortcode.
 * Returns null if no cursor is stored (post was never partially scraped).
 * @param {string} shortcode
 * @returns {Promise<string|null>}
 */
async function getPostCursor(shortcode) {
    if (!shortcode) return null;
    const db = await openCommentsDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.SCRAPE_STATE, 'readonly');
        const store = tx.objectStore(STORES.SCRAPE_STATE);
        const request = store.get(`cursor_${shortcode}`);
        request.onsuccess = () => {
            db.close();
            resolve(request.result?.cursor || null);
        };
        request.onerror = () => { db.close(); reject(request.error); };
    });
}

// Export for use in background.js (service worker global scope)
if (typeof globalThis !== 'undefined') {
    globalThis.CommentsDB = {
        saveCommentsLocally,
        saveSentinels,
        savePostCursor,
        getPostCursor,
        getLocalComments,
        getLocalCommentCounts,
        getUnsyncedComments,
        markCommentsSynced,
        saveScrapeState,
        loadScrapeState,
        clearScrapeState,
        getTotalLocalComments,
        getCommentsForPosts,
    };
}
