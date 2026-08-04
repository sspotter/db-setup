/**
 * ReachStore — Local-first influencer reach aggregate.
 *
 * Owns chrome.storage.local key "reach_store": { [scopeKey]: aggregate }.
 * scopeKey is a projectId, or 'unassigned' when no project is active.
 *
 * Aggregate shape:
 * {
 *   brand:    { username, followers, postCount, impressions, is_verified },
 *   partners: [ { username, followers, collabCount, impressions, is_verified } ],
 *   totals:   { followers, collabPosts, paidPosts, impressions },
 *   computedAt, projectId
 * }
 */
const REACH_STORE_KEY = "reach_store";

async function _read() {
    return new Promise((resolve) => {
        chrome.storage.local.get([REACH_STORE_KEY], (res) => resolve(res[REACH_STORE_KEY] || {}));
    });
}

async function _write(store) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [REACH_STORE_KEY]: store }, resolve);
    });
}

async function getAggregate(scopeKey) {
    const store = await _read();
    return store[scopeKey] || null;
}

async function saveAggregate(scopeKey, aggregate) {
    const store = await _read();
    store[scopeKey] = aggregate;
    await _write(store);
}

async function clearAggregate(scopeKey) {
    const store = await _read();
    if (store[scopeKey]) {
        delete store[scopeKey];
        await _write(store);
    }
}

async function clear() {
    await _write({});
}

/**
 * Map a calculateCollectiveReach partners list into the persisted aggregate.
 * @param {Array} partnersList items: { username, followers, postCount, is_verified, sources:Set }
 * @param {string} mainUsername the brand/owner username
 * @param {{projectId?:string|null, collabCount?:number, paidCount?:number}} meta
 */
function buildAggregate(partnersList, mainUsername, meta = {}) {
    const list = Array.isArray(partnersList) ? partnersList : [];
    const impressionsOf = (p) => (p.followers || 0) * (p.postCount || 1);

    // Prefer the explicitly named brand; otherwise fall back to the item tagged as
    // 'Owner' (matches renderCollectiveReachDOM's own main-user detection). This keeps
    // the "Mainbrand" section intact even when mainUsername is null (e.g. posts with no
    // scrapedFromProfile).
    let brandItem = mainUsername ? (list.find(p => p.username === mainUsername) || null) : null;
    if (!brandItem) {
        brandItem = list.find(p => p.sources && typeof p.sources.has === 'function' && p.sources.has('Owner')) || null;
    }
    const brand = brandItem ? {
        username: brandItem.username,
        followers: brandItem.followers || 0,
        postCount: brandItem.postCount || 0,
        impressions: impressionsOf(brandItem),
        is_verified: !!brandItem.is_verified,
    } : null;

    const partners = list
        .filter(p => p !== brandItem)
        .map(p => ({
            username: p.username,
            followers: p.followers || 0,
            collabCount: p.postCount || 0,
            impressions: impressionsOf(p),
            is_verified: !!p.is_verified,
        }));

    const totalsFollowers = list.reduce((s, p) => s + (p.followers || 0), 0);
    const totalsImpr = list.reduce((s, p) => s + impressionsOf(p), 0);

    return {
        brand,
        partners,
        totals: {
            followers: totalsFollowers,
            collabPosts: meta.collabCount || 0,
            paidPosts: meta.paidCount || 0,
            impressions: totalsImpr,
        },
        computedAt: Date.now(),
        projectId: meta.projectId || null,
    };
}

/**
 * Reconstruct a renderable partners list (+ stats) from a stored aggregate.
 * `sources` is rebuilt as a Set so the panel's main-user detection works.
 */
function toPartnersList(aggregate) {
    if (!aggregate) return { partnersList: [], stats: { collabCount: 0, paidCount: 0 } };

    const partnersList = [];
    if (aggregate.brand) {
        partnersList.push({
            username: aggregate.brand.username,
            followers: aggregate.brand.followers || 0,
            postCount: aggregate.brand.postCount || 0,
            is_verified: !!aggregate.brand.is_verified,
            sources: new Set(['Owner']),
            is_excluded_manually: false,
        });
    }
    for (const p of (aggregate.partners || [])) {
        partnersList.push({
            username: p.username,
            followers: p.followers || 0,
            postCount: p.collabCount || 0,
            is_verified: !!p.is_verified,
            sources: new Set(['Co-author']),
            is_excluded_manually: false,
        });
    }

    return {
        partnersList,
        stats: {
            collabCount: aggregate.totals ? (aggregate.totals.collabPosts || 0) : 0,
            paidCount: aggregate.totals ? (aggregate.totals.paidPosts || 0) : 0,
        },
    };
}

const ReachStore = {
    getAggregate,
    saveAggregate,
    clearAggregate,
    clear,
    buildAggregate,
    toPartnersList,
    STORE_KEY: REACH_STORE_KEY,
};

if (typeof globalThis !== "undefined") {
    globalThis.ReachStore = ReachStore;
}
