/**
 * PostsStore — Project-Aware Post Storage Module
 * 
 * Provides a normalized storage layer for posts with project scoping.
 * 
 * Storage Schema (chrome.storage.local key: "posts_store"):
 * {
 *   byId:        { [shortcode]: postObject },
 *   byProject:   { [projectId]: [shortcode, ...] },
 *   unassigned:  [shortcode, ...],
 *   meta: {
 *     version:       2,
 *     lastUpdated:   timestamp,
 *     migratedFrom:  "posts_dataset" | null
 *   }
 * }
 * 
 * Data Integrity Rules:
 *   1. Every post exists exactly once in byId (keyed by shortcode)
 *   2. A shortcode appears in EITHER unassigned OR one byProject entry, never both
 *   3. Unassigned posts are first-class citizens — captured, stored, rendered, usable
 *   4. projectId is required ONLY when syncing to backend
 *   5. UI rendering NEVER depends on filteredPosts for sync payloads
 */

const POSTS_STORE_KEY = "posts_store";
const POSTS_STORE_VERSION = 2;

// ==================== Internal Helpers ====================

/**
 * Creates a fresh empty store object.
 */
function _createEmptyStore() {
    return {
        byId: {},
        byProject: {},
        unassigned: [],
        meta: {
            version: POSTS_STORE_VERSION,
            lastUpdated: Date.now(),
            migratedFrom: null
        }
    };
}

/**
 * Read the posts_store from chrome.storage.local.
 * @returns {Promise<object>} The posts_store object
 */
async function _readStore() {
    return new Promise((resolve) => {
        chrome.storage.local.get([POSTS_STORE_KEY], (result) => {
            const store = result[POSTS_STORE_KEY];
            if (store && store.meta && store.meta.version === POSTS_STORE_VERSION) {
                resolve(store);
            } else {
                resolve(_createEmptyStore());
            }
        });
    });
}

/**
 * Persist the posts_store to chrome.storage.local.
 * @param {object} store - The store object to save
 * @returns {Promise<void>}
 */
async function _writeStore(store) {
    store.meta.lastUpdated = Date.now();
    return new Promise((resolve) => {
        chrome.storage.local.set({ [POSTS_STORE_KEY]: store }, resolve);
    });
}

/**
 * Validate store state against core invariants (in-memory, no I/O).
 *
 * Invariants checked:
 *   1. Bucket exclusivity: every ID in exactly one bucket
 *   2. Count consistency: byId count === unassigned + sum(byProject)
 *   3. No orphaned bucket refs (IDs in buckets must exist in byId)
 *
 * @param {object} store - The store object to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function _validateStoreState(store) {
    const errors = [];
    const byIdKeys = new Set(Object.keys(store.byId));

    // Collect all bucket references
    const unassignedSet = new Set(store.unassigned);
    const projectSets = {};
    let totalBucketRefs = store.unassigned.length;

    for (const [pid, shortcodes] of Object.entries(store.byProject)) {
        projectSets[pid] = new Set(shortcodes);
        totalBucketRefs += shortcodes.length;
    }

    // 1. Check for orphaned bucket refs (ID in bucket but not in byId)
    for (const sc of store.unassigned) {
        if (!byIdKeys.has(sc)) {
            errors.push(`Orphan in unassigned: "${sc}" not found in byId`);
        }
    }
    for (const [pid, shortcodes] of Object.entries(store.byProject)) {
        for (const sc of shortcodes) {
            if (!byIdKeys.has(sc)) {
                errors.push(`Orphan in project ${pid}: "${sc}" not found in byId`);
            }
        }
    }

    // 2. Check for IDs in byId but missing from all buckets
    for (const sc of byIdKeys) {
        let found = unassignedSet.has(sc);
        if (!found) {
            for (const pSet of Object.values(projectSets)) {
                if (pSet.has(sc)) { found = true; break; }
            }
        }
        if (!found) {
            errors.push(`Unbucketed: "${sc}" exists in byId but not in any bucket`);
        }
    }

    // 3. Check for IDs in multiple buckets
    const seenIds = new Set();
    for (const sc of store.unassigned) {
        seenIds.add(sc);
    }
    for (const [pid, shortcodes] of Object.entries(store.byProject)) {
        for (const sc of shortcodes) {
            if (seenIds.has(sc)) {
                errors.push(`Multi-bucket: "${sc}" appears in project ${pid} AND another bucket`);
            }
            seenIds.add(sc);
        }
    }

    // 4. Count consistency
    if (byIdKeys.size !== totalBucketRefs - errors.filter(e => e.startsWith('Multi-bucket')).length) {
        // Use a cleaner count: unique bucket refs vs byId
        const uniqueBucketIds = new Set([...store.unassigned]);
        for (const shortcodes of Object.values(store.byProject)) {
            for (const sc of shortcodes) uniqueBucketIds.add(sc);
        }
        if (byIdKeys.size !== uniqueBucketIds.size) {
            errors.push(`Count mismatch: byId has ${byIdKeys.size} entries, buckets reference ${uniqueBucketIds.size} unique IDs`);
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Safe write wrapper — validates invariants BEFORE persisting.
 * Fail-fast: if invariants are violated, the write is rejected and state is not corrupted.
 *
 * @param {object} store - The store object to validate and persist
 * @param {string} operationName - Name of the calling operation (for error logging)
 * @returns {Promise<void>}
 * @throws {Error} If invariants are violated
 */
async function _safeWriteStore(store, operationName) {
    const { valid, errors } = _validateStoreState(store);
    if (!valid) {
        console.error(`[PostsStore] INVARIANT VIOLATION in ${operationName}:`, errors);
        throw new Error(`State mutation violated invariants in ${operationName}: ${errors.join('; ')}`);
    }
    return _writeStore(store);
}


// ==================== Read Operations ====================

/**
 * Get the full posts_store object.
 * @returns {Promise<object>}
 */
async function getPostsStore() {
    return _readStore();
}

/**
 * Get a single post by shortcode.
 * @param {string} shortcode
 * @returns {Promise<object|null>}
 */
async function getPostById(shortcode) {
    const store = await _readStore();
    return store.byId[shortcode] || null;
}

/**
 * Get all unassigned posts (not linked to any project).
 * @returns {Promise<object[]>} Array of post objects
 */
async function getUnassignedPosts() {
    const store = await _readStore();
    return store.unassigned
        .map(sc => store.byId[sc])
        .filter(Boolean);
}

/**
 * Get all posts linked to a specific project.
 * @param {string} projectId
 * @returns {Promise<object[]>} Array of post objects
 */
async function getProjectPosts(projectId) {
    const store = await _readStore();
    const shortcodes = store.byProject[projectId] || [];
    return shortcodes
        .map(sc => store.byId[sc])
        .filter(Boolean);
}

/**
 * Get all posts in the store (regardless of assignment).
 * @returns {Promise<object[]>} Array of post objects
 */
async function getAllPosts() {
    const store = await _readStore();
    return Object.values(store.byId);
}

// ==================== Write Operations ====================

/**
 * Add new posts to the store. Posts go to `unassigned` by default.
 * Deduplicates by shortcode — existing posts are NOT overwritten.
 * 
 * @param {object[]} posts - Array of post objects (must have .shortcode)
 * @returns {Promise<{added: number, total: number}>}
 */
async function addPosts(posts) {
    const store = await _readStore();
    let added = 0;

    for (const post of posts) {
        if (!post.shortcode) continue;
        
        if (!store.byId[post.shortcode]) {
            // New post — add to byId and unassigned
            store.byId[post.shortcode] = post;
            if (!store.unassigned.includes(post.shortcode)) {
                store.unassigned.push(post.shortcode);
            }
            added++;
        }
    }

    if (added > 0) {
        await _safeWriteStore(store, 'addPosts');
    }

    return {
        added,
        total: Object.keys(store.byId).length
    };
}

/**
 * Update an existing post in byId (merge fields).
 * Does NOT change project assignment.
 * 
 * @param {string} shortcode
 * @param {object} updates - Partial post fields to merge
 * @returns {Promise<boolean>} True if post existed and was updated
 */
async function updatePost(shortcode, updates) {
    const store = await _readStore();
    if (!store.byId[shortcode]) return false;
    
    store.byId[shortcode] = { ...store.byId[shortcode], ...updates };
    await _safeWriteStore(store, 'updatePost');
    return true;
}

/**
 * Assign shortcodes to a project. Moves them from unassigned → byProject[projectId].
 * 
 * @param {string[]} shortcodes - Array of shortcodes to assign
 * @param {string} projectId - Target project ID
 * @returns {Promise<{assigned: number}>}
 */
async function assignToProject(shortcodes, projectId) {
    const store = await _readStore();

    if (!store.byProject[projectId]) {
        store.byProject[projectId] = [];
    }

    let assigned = 0;

    for (const sc of shortcodes) {
        // Skip if shortcode doesn't exist in byId
        if (!store.byId[sc]) continue;

        // Add to project if not already there
        if (!store.byProject[projectId].includes(sc)) {
            store.byProject[projectId].push(sc);
            assigned++;
        }

        // Remove from unassigned
        const uIdx = store.unassigned.indexOf(sc);
        if (uIdx !== -1) {
            store.unassigned.splice(uIdx, 1);
        }
    }

    if (assigned > 0) {
        await _safeWriteStore(store, 'assignToProject');
    }

    return { assigned };
}

/**
 * Unassign shortcodes from their project. Moves them back to unassigned.
 * 
 * @param {string[]} shortcodes - Array of shortcodes to unassign
 * @returns {Promise<{unassigned: number}>}
 */
async function unassignFromProject(shortcodes) {
    const store = await _readStore();
    let count = 0;

    for (const sc of shortcodes) {
        if (!store.byId[sc]) continue;

        // Remove from all projects
        for (const pid of Object.keys(store.byProject)) {
            const idx = store.byProject[pid].indexOf(sc);
            if (idx !== -1) {
                store.byProject[pid].splice(idx, 1);
                // Clean up empty project arrays
                if (store.byProject[pid].length === 0) {
                    delete store.byProject[pid];
                }
            }
        }

        // Add back to unassigned if not already there
        if (!store.unassigned.includes(sc)) {
            store.unassigned.push(sc);
            count++;
        }
    }

    if (count > 0) {
        await _safeWriteStore(store, 'unassignFromProject');
    }

    return { unassigned: count };
}

/**
 * Remove a post completely from the store (byId + unassigned/byProject).
 * 
 * @param {string} shortcode
 * @returns {Promise<boolean>} True if post was found and removed
 */
async function removePost(shortcode) {
    const store = await _readStore();
    if (!store.byId[shortcode]) return false;

    delete store.byId[shortcode];

    // Remove from unassigned
    const uIdx = store.unassigned.indexOf(shortcode);
    if (uIdx !== -1) store.unassigned.splice(uIdx, 1);

    // Remove from all projects
    for (const pid of Object.keys(store.byProject)) {
        const idx = store.byProject[pid].indexOf(shortcode);
        if (idx !== -1) {
            store.byProject[pid].splice(idx, 1);
            if (store.byProject[pid].length === 0) {
                delete store.byProject[pid];
            }
        }
    }

    await _safeWriteStore(store, 'removePost');
    return true;
}

/**
 * Bulk upsert posts into byId and assign to a specific project.
 * Posts that already exist in byId are updated (merged).
 * Posts are added to byProject[projectId] and removed from unassigned.
 * 
 * This is used when loading project data from the server (merge strategy).
 * 
 * @param {object[]} posts - Array of post objects
 * @param {string} projectId - Target project ID
 * @returns {Promise<{added: number, updated: number, assigned: number}>}
 */
async function mergeProjectPosts(posts, projectId) {
    const store = await _readStore();

    if (!store.byProject[projectId]) {
        store.byProject[projectId] = [];
    }

    let added = 0;
    let updated = 0;
    let assigned = 0;

    for (const post of posts) {
        if (!post.shortcode) continue;

        if (store.byId[post.shortcode]) {
            // Existing post — merge (server fields take priority)
            store.byId[post.shortcode] = { ...store.byId[post.shortcode], ...post };
            updated++;
        } else {
            // New post — add to byId
            store.byId[post.shortcode] = post;
            added++;
        }

        // Assign to project if not already
        if (!store.byProject[projectId].includes(post.shortcode)) {
            store.byProject[projectId].push(post.shortcode);
            assigned++;
        }

        // Remove from unassigned
        const uIdx = store.unassigned.indexOf(post.shortcode);
        if (uIdx !== -1) {
            store.unassigned.splice(uIdx, 1);
        }
    }

    await _safeWriteStore(store, 'mergeProjectPosts');

    return { added, updated, assigned };
}

// ==================== Sync Helpers ====================

/**
 * Get the sync payload for a project — ONLY project-scoped posts.
 * This is what gets sent to the backend.
 * Asserts every post has a valid projectId before returning.
 * 
 * @param {string} projectId
 * @returns {Promise<object[]>} Array of post objects with projectId attached
 */
async function getSyncPayload(projectId) {
    if (!projectId) {
        console.error('[PostsStore] getSyncPayload called without projectId — refusing to sync');
        return [];
    }

    const store = await _readStore();
    const shortcodes = store.byProject[projectId] || [];

    const payload = shortcodes
        .map(sc => store.byId[sc])
        .filter(Boolean)
        .map(post => ({ ...post, projectId }));

    // Assert: no unassigned posts leaked into sync payload
    const unassignedSet = new Set(store.unassigned);
    const leaked = payload.filter(p => unassignedSet.has(p.shortcode));
    if (leaked.length > 0) {
        console.error(`[PostsStore] SYNC GUARD: ${leaked.length} unassigned posts leaked into sync payload for project ${projectId}`);
        return payload.filter(p => !unassignedSet.has(p.shortcode));
    }

    return payload;
}

/**
 * Get a debug summary of the current store state.
 * @returns {Promise<object>}
 */
async function getDebugState() {
    const store = await _readStore();
    
    const byProjectSummary = {};
    for (const [pid, shortcodes] of Object.entries(store.byProject)) {
        byProjectSummary[pid] = shortcodes.length;
    }

    return {
        totalPosts: Object.keys(store.byId).length,
        unassigned: store.unassigned.length,
        byProject: byProjectSummary,
        version: store.meta.version,
        lastUpdated: store.meta.lastUpdated,
        migratedFrom: store.meta.migratedFrom
    };
}

// ==================== Clear ====================

/**
 * Clear the entire posts_store, resetting to empty.
 * @returns {Promise<void>}
 */
async function clearPostsStore() {
    await _writeStore(_createEmptyStore()); // bypass safeWrite — empty store is always valid
}

/**
 * Remove all posts for a specific project from byProject (but keep the posts in byId).
 * Posts that were exclusively in this project go back to unassigned.
 * 
 * @param {string} projectId
 * @returns {Promise<{released: number}>}
 */
async function clearProjectAssignments(projectId) {
    const store = await _readStore();
    const shortcodes = store.byProject[projectId] || [];
    let released = 0;

    for (const sc of shortcodes) {
        // Check if this post is in any OTHER project
        let inOtherProject = false;
        for (const pid of Object.keys(store.byProject)) {
            if (pid !== projectId && store.byProject[pid].includes(sc)) {
                inOtherProject = true;
                break;
            }
        }

        // If not in any other project, move to unassigned
        if (!inOtherProject && !store.unassigned.includes(sc)) {
            store.unassigned.push(sc);
            released++;
        }
    }

    delete store.byProject[projectId];
    await _safeWriteStore(store, 'clearProjectAssignments');

    return { released };
}

// ==================== Migration ====================

/**
 * Migrate from the legacy `posts_dataset` format to the new `posts_store` format.
 * 
 * Behavior:
 *   1. Reads `posts_dataset.posts[]`
 *   2. Writes each post to `posts_store.byId[shortcode]`
 *   3. If `extension_settings.activeProjectId` exists, assigns all to that project
 *   4. Otherwise, all go to `posts_store.unassigned`
 *   5. Preserves original `posts_dataset` as `posts_dataset_backup`
 *   6. Sets `posts_store.meta.migratedFrom = "posts_dataset"`
 * 
 * @returns {Promise<{migrated: number, projectId: string|null}>}
 */
async function migrateFromLegacy() {
    // Check if already migrated
    const existingStore = await _readStore();
    if (Object.keys(existingStore.byId).length > 0) {
        console.log("[PostsStore] Store already has data, skipping migration.");
        return { migrated: 0, projectId: null };
    }

    // Read legacy data
    const result = await new Promise(resolve => {
        chrome.storage.local.get(["posts_dataset", "extension_settings"], resolve);
    });

    const legacyDataset = result.posts_dataset;
    const settings = result.extension_settings || {};
    const activeProjectId = settings.activeProjectId || null;

    if (!legacyDataset || !legacyDataset.posts || legacyDataset.posts.length === 0) {
        console.log("[PostsStore] No legacy data to migrate.");
        return { migrated: 0, projectId: null };
    }

    console.log(`[PostsStore] Migrating ${legacyDataset.posts.length} posts from legacy format...`);

    const store = _createEmptyStore();
    store.meta.migratedFrom = "posts_dataset";
    let migrated = 0;

    for (const post of legacyDataset.posts) {
        if (!post.shortcode) continue;

        store.byId[post.shortcode] = post;

        if (activeProjectId) {
            // Assign to the currently active project
            if (!store.byProject[activeProjectId]) {
                store.byProject[activeProjectId] = [];
            }
            store.byProject[activeProjectId].push(post.shortcode);
        } else {
            // No project → unassigned
            store.unassigned.push(post.shortcode);
        }

        migrated++;
    }

    // Save the new store (use _writeStore directly — migration is a bootstrap operation)
    await _writeStore(store);

    // Backup the legacy dataset
    await new Promise(resolve => {
        chrome.storage.local.set({ posts_dataset_backup: legacyDataset }, resolve);
    });

    console.log(`[PostsStore] Migration complete: ${migrated} posts migrated.`
        + (activeProjectId ? ` Assigned to project ${activeProjectId}.` : ` All unassigned.`));

    // Post-migration integrity check
    const { valid, errors } = _validateStoreState(store);
    if (!valid) {
        console.warn('[PostsStore] Post-migration integrity issues:', errors);
    } else {
        console.log('[PostsStore] Post-migration integrity check: PASSED ✓');
    }

    return { migrated, projectId: activeProjectId };
}

// ==================== Integrity Operations ====================

/**
 * Validate the current persisted store against core invariants.
 * Reads from storage and checks:
 *   1. Bucket exclusivity
 *   2. Count consistency
 *   3. No orphaned bucket references
 *
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
async function validateIntegrity() {
    const store = await _readStore();
    return _validateStoreState(store);
}

/**
 * Conservative repair — fixes detected inconsistencies with a "degrade to unassigned" strategy.
 *
 * Rules:
 *   - IDs in buckets but missing from byId → remove from bucket
 *   - IDs in byId but missing from all buckets → add to unassigned
 *   - IDs in MULTIPLE buckets → remove from ALL projects, move to unassigned (never guess)
 *
 * @returns {Promise<{repaired: boolean, actions: string[]}>}
 */
async function repairIntegrity() {
    const store = await _readStore();
    const actions = [];
    const byIdKeys = new Set(Object.keys(store.byId));

    // 1. Remove orphaned refs from unassigned
    const cleanUnassigned = store.unassigned.filter(sc => {
        if (!byIdKeys.has(sc)) {
            actions.push(`Removed orphan "${sc}" from unassigned`);
            return false;
        }
        return true;
    });
    store.unassigned = cleanUnassigned;

    // 2. Remove orphaned refs from projects
    for (const pid of Object.keys(store.byProject)) {
        store.byProject[pid] = store.byProject[pid].filter(sc => {
            if (!byIdKeys.has(sc)) {
                actions.push(`Removed orphan "${sc}" from project ${pid}`);
                return false;
            }
            return true;
        });
        if (store.byProject[pid].length === 0) {
            delete store.byProject[pid];
        }
    }

    // 3. Detect multi-bucket IDs — build occurrence map
    const idBuckets = {}; // sc -> ['unassigned'] or ['proj:123', 'proj:456']
    for (const sc of store.unassigned) {
        if (!idBuckets[sc]) idBuckets[sc] = [];
        idBuckets[sc].push('unassigned');
    }
    for (const [pid, shortcodes] of Object.entries(store.byProject)) {
        for (const sc of shortcodes) {
            if (!idBuckets[sc]) idBuckets[sc] = [];
            idBuckets[sc].push(`proj:${pid}`);
        }
    }

    // Fix multi-bucket: remove from ALL projects, ensure in unassigned
    for (const [sc, buckets] of Object.entries(idBuckets)) {
        if (buckets.length > 1) {
            // Remove from all projects
            for (const pid of Object.keys(store.byProject)) {
                const idx = store.byProject[pid].indexOf(sc);
                if (idx !== -1) {
                    store.byProject[pid].splice(idx, 1);
                    if (store.byProject[pid].length === 0) delete store.byProject[pid];
                }
            }
            // Ensure in unassigned (deduplicated)
            store.unassigned = store.unassigned.filter(id => id !== sc);
            store.unassigned.push(sc);
            actions.push(`Multi-bucket "${sc}" (was in: ${buckets.join(', ')}) → moved to unassigned`);
        }
    }

    // 4. Find IDs in byId but missing from all buckets → add to unassigned
    const allBucketedIds = new Set(store.unassigned);
    for (const shortcodes of Object.values(store.byProject)) {
        for (const sc of shortcodes) allBucketedIds.add(sc);
    }
    for (const sc of byIdKeys) {
        if (!allBucketedIds.has(sc)) {
            store.unassigned.push(sc);
            actions.push(`Unbucketed "${sc}" → added to unassigned`);
        }
    }

    if (actions.length > 0) {
        await _writeStore(store); // Use raw write — repair is a recovery operation
        console.log(`[PostsStore] Repair complete: ${actions.length} fixes applied.`, actions);
    } else {
        console.log('[PostsStore] Repair: no issues found.');
    }

    return { repaired: actions.length > 0, actions };
}

// ==================== Export via globalThis ====================

const PostsStore = {
    // Read
    getPostsStore,
    getPostById,
    getUnassignedPosts,
    getProjectPosts,
    getAllPosts,

    // Write
    addPosts,
    updatePost,
    assignToProject,
    unassignFromProject,
    removePost,
    mergeProjectPosts,

    // Sync
    getSyncPayload,
    getDebugState,

    // Integrity
    validateIntegrity,
    repairIntegrity,

    // Clear
    clearPostsStore,
    clearProjectAssignments,

    // Migration
    migrateFromLegacy,

    // Constants
    STORE_KEY: POSTS_STORE_KEY,
    VERSION: POSTS_STORE_VERSION
};

if (typeof globalThis !== "undefined") {
    globalThis.PostsStore = PostsStore;

    // Debug helper — call from browser console: await DEBUG_POSTS()
    globalThis.DEBUG_POSTS = async () => {
        const state = await PostsStore.getDebugState();
        const integrity = await PostsStore.validateIntegrity();

        console.log('%c[PostsStore] Debug Snapshot', 'font-weight:bold;color:#3B82F6');
        console.table({
            'Total Posts': state.totalPosts,
            'Unassigned': state.unassigned,
            'Projects': Object.keys(state.byProject).length,
            'Version': state.version,
            'Last Updated': new Date(state.lastUpdated).toISOString(),
        });

        if (Object.keys(state.byProject).length > 0) {
            console.log('%c  Project Breakdown:', 'font-weight:bold');
            console.table(state.byProject);
        }

        if (integrity.valid) {
            console.log('%c  Integrity: PASSED ✓', 'color:green;font-weight:bold');
        } else {
            console.warn('%c  Integrity: FAILED ✗', 'color:red;font-weight:bold');
            integrity.errors.forEach(e => console.warn('    •', e));
        }

        return { state, integrity };
    };
}
