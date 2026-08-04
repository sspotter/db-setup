// Import Config, IndexedDB helper, and PostsStore
importScripts('config.js');
importScripts('utils/comments_db.js');
importScripts('utils/posts_store.js');
importScripts('utils/post_index.js'); // PostIndex — same owner/coauthor attribution the Dataset Viewer uses

/**
 * Background Service Worker — Central Controller (MV3)
 *
 * Responsibilities:
 *   1. Manage capture state (on/off)
 *   2. Receive and process captured GraphQL data from content script
 *   3. Parse posts from GraphQL responses
 *   4. Store datasets via chrome.storage.local
 *   5. Check Instagram login status via cookies
 *   6. Relay status info to popup
 *   7. Track GraphQL query patterns (query hash + variables)
 *
 * Message Types Handled:
 *   PLATFORM_DETECTED    — content.js reports IG detected
 *   USERNAME_DETECTED    — content.js reports profile username
 *   GRAPHQL_CAPTURED     — content.js forwards captured GraphQL data
 *   GET_CAPTURE_STATE    — popup.js checks if capture is active
 *   START_CAPTURE        — popup.js starts capture
 *   STOP_CAPTURE         — popup.js stops capture
 *   GET_STATUS           — popup.js requests full status
 *   GET_DATASET          — popup.js requests captured posts
 *   CLEAR_DATASET        — popup.js clears stored data
 *   CHECK_LOGIN          — popup.js requests login check
 */

// ==================== State ====================

let captureState = {
    active: false,
    startedAt: null,
    activeRootProfile: null,
};

let platformStatus = {
    detected: false,
    platform: null,
    url: null,
};

let loginStatus = {
    loggedIn: false,
    sessionId: null,
    csrfToken: null,
};

let captureStats = {
    totalCaptured: 0,      // posts count (consumed by popup's "Posts" stat — do NOT repurpose)
    postsCaptured: 0,      // mirror of totalCaptured, consumed by the on-page counter card
    commentsCaptured: 0,   // Σ comments saved during scrapes (on-page card)
    viewsCaptured: 0,      // Σ view counts across stored posts (on-page card; reels only)
    queriesSeen: 0,
    lastCapturedAt: null,
};

let latestProfileStats = null;
let detectedUsername = null;
let shouldStopScraping = false;

// Batch scrape state
let batchScrapeState = {
    active: false,
    sessionId: null,
    backendUrl: null,
    token: null,
    status: 'idle', // idle | running | paused | completed | failed
    totalJobs: 0,
    completedJobs: 0,
    totalComments: 0,
    currentPost: null,
    startedAt: null,
    postDelayMin: 10,    // minimum seconds between posts (user-configurable, ≥10)
    nextDelayMs: 0,      // the actual random delay chosen for the upcoming post gap
};

// ==================== Service-Worker Keep-Alive ====================
// A batch/legacy scrape runs as long-lived async work in the MV3 service worker,
// with delays of 10-20s+ between posts (rate-limit pauses + the user's postDelayMin).
// During those gaps no fetch is in flight, so the worker's survival depended on an
// open popup/options page pinging it (GET_STATUS / GET_SCRAPE_STATUS polling). When
// the user switched tabs the popup closed / the options tab's timers were throttled,
// the pings stopped, and the worker hit its ~30s idle timeout mid-scrape — stopping it.
//
// This keeps the worker alive independently of any UI: while a scrape is active we
// touch a chrome API every 20s (well under the 30s idle limit), which resets the
// idle timer. setInterval inside the service worker is NOT subject to the background-
// tab throttling that broke the page-based polling. Reliable in practice for typical
// runs; not a hard guarantee for very long (20-30 min+) sessions.
let _keepAliveInterval = null;
let _keepAliveRefCount = 0;

function startKeepAlive() {
    _keepAliveRefCount++;
    if (_keepAliveInterval) return;
    _keepAliveInterval = setInterval(() => {
        // Any extension API call with a callback resets the idle timer.
        chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; });
    }, 20000);
    console.log('[BG] Keep-alive started (scrape in progress)');
}

function stopKeepAlive() {
    _keepAliveRefCount = Math.max(0, _keepAliveRefCount - 1);
    if (_keepAliveRefCount === 0 && _keepAliveInterval) {
        clearInterval(_keepAliveInterval);
        _keepAliveInterval = null;
        console.log('[BG] Keep-alive stopped (no active scrape)');
    }
}

// ==================== Initialization ====================

// Restore state from storage on service worker start
async function initState() {
    try {
        const stored = await chrome.storage.local.get([
            "capture_state",
            "platform_status",
            "capture_stats",
        ]);

        if (stored.capture_state) {
            captureState = stored.capture_state;
        }
        if (stored.platform_status) {
            platformStatus = stored.platform_status;
        }
        if (stored.capture_stats) {
            captureStats = stored.capture_stats;
        }

        console.log("[BG] State restored:", { captureState, platformStatus, captureStats });
    } catch (err) {
        console.error("[BG] Failed to restore state:", err);
    }
}

initState();

// ==================== Cookie-Based Login Detection ====================

async function checkInstagramLogin() {
    try {
        const cookies = await chrome.cookies.getAll({ domain: ".instagram.com" });

        const sessionCookie = cookies.find(c => c.name === "sessionid");
        const csrfCookie = cookies.find(c => c.name === "csrftoken");

        loginStatus = {
            loggedIn: !!(sessionCookie && sessionCookie.value),
            sessionId: sessionCookie?.value || null,
            csrfToken: csrfCookie?.value || null,
        };

        console.log("[BG] Login check:", loginStatus.loggedIn ? "Logged In" : "Not Logged In");
        return loginStatus;
    } catch (err) {
        console.error("[BG] Cookie check failed:", err);
        loginStatus = { loggedIn: false, sessionId: null, csrfToken: null };
        return loginStatus;
    }
}

// ==================== Post Parser ====================

/**
 * Parse Instagram GraphQL response to extract posts
 * Handles multiple response structures Instagram uses
 */
function parsePostsFromResponse(responseData) {
    const posts = [];

    try {
        const data = responseData?.data;
        if (!data) return { posts, pageInfo: null, totalCount: null };

        // Structure 1: Modern IG — xdt_api__v1__feed__user_timeline_graphql_connection
        const timelineGraphQL = data.xdt_api__v1__feed__user_timeline_graphql_connection;
        if (timelineGraphQL?.edges) {
            for (const edge of timelineGraphQL.edges) {
                if (edge.node) posts.push(extractPostData(edge.node));
            }
            return {
                posts,
                pageInfo: timelineGraphQL.page_info || null,
                totalCount: timelineGraphQL.count || null,
            };
        }

        // Structure 2: xdt_api__v1__feed__user_timeline_connection (alternate)
        const timelineConn = data.xdt_api__v1__feed__user_timeline_connection;
        if (timelineConn?.edges) {
            for (const edge of timelineConn.edges) {
                if (edge.node) posts.push(extractPostData(edge.node));
            }
            return {
                posts,
                pageInfo: timelineConn.page_info || null,
                totalCount: timelineConn.count || null,
            };
        }

        // Structure 3: Legacy — edge_owner_to_timeline_media
        const legacyTimeline = data.user?.edge_owner_to_timeline_media;
        if (legacyTimeline?.edges) {
            for (const edge of legacyTimeline.edges) {
                if (edge.node) posts.push(extractPostData(edge.node));
            }
            return {
                posts,
                pageInfo: legacyTimeline.page_info || null,
                totalCount: legacyTimeline.count || null,
            };
        }

        // Structure 4: Single post page
        const shortcodeMedia = data.shortcode_media || data.xdt_api__v1__media__shortcode__web_info?.items?.[0];
        if (shortcodeMedia) {
            posts.push(extractPostData(shortcodeMedia));
            return { posts, pageInfo: null, totalCount: null };
        }

        // Structure 5: Explore / reels feed
        const feedItems = data.xdt_api__v1__feed__timeline?.feed_items;
        if (feedItems) {
            for (const item of feedItems) {
                if (item.media_or_ad) posts.push(extractPostData(item.media_or_ad));
            }
            return { posts, pageInfo: null, totalCount: null };
        }

    } catch (err) {
        console.warn("[BG] Post parsing error:", err.message);
    }

    return { posts, pageInfo: null, totalCount: null };
}

/**
 * Extract standardized post data from a GraphQL node
 */
function extractPostData(node) {
    // Preserve full raw IG objects for rich export data (partner breakdown)
    const coauthors = node.coauthor_producers || [];
    const sponsors = node.sponsor_users || [];
    const sponsor_tags = node.sponsor_tags || [];
    const tagged_users = (node.usertags?.in || []).map(t => t.user || t);
    const caption_user = node.caption?.user || null;
    const owner = node.user || node.owner || null;

    const isPaid = node.is_paid_partnership || false;
    const hasCoauthors = coauthors.length > 0;

    // Classification logic per scraping_display_logic.md
    let classification = "Normal Post";
    let type = "normal";
    let border = "pf-normal-card";

    if (hasCoauthors && isPaid) {
        classification = "Paid Partnership Collab";
        type = "paid_collab";
        border = "pf-super-collab-card";
    } else if (isPaid) {
        classification = "Paid Partnership";
        type = "paid";
        border = "pf-paid-card";
    } else if (hasCoauthors) {
        classification = "Collaboration";
        type = "collab";
        border = "pf-collab-card";
    }

    // Also check caption for ad hashtags
    const captionText = node.caption?.text || node.edge_media_to_caption?.edges?.[0]?.node?.text || "";
    if (!isPaid && /#(ad|sponsored|partnership)\b/i.test(captionText)) {
        classification = "Paid Partnership";
        type = "paid";
        border = "pf-paid-card";
    }

    const isCarousel = (node.carousel_media_count || 0) > 0 || node.media_type === 8;
    const isVideo = node.is_video || (node.media_type === 2) || !!(node.video_versions);

    return {
        shortcode: node.code || node.shortcode || null,
        postUrl: node.code ? `https://www.instagram.com/p/${node.code}/` : (node.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : null),
        caption: captionText,
        imageUrl: node.image_versions2?.candidates?.[0]?.url || node.display_url || node.thumbnail_src || null,
        likes: node.like_count ?? node.edge_media_preview_like?.count ?? 0,
        comments: node.comment_count ?? node.edge_media_to_comment?.count ?? 0,
        // View count only exists for reels/videos (photos have none) — tolerate all payload shapes, default 0.
        views: parseInt(node.play_count ?? node.video_view_count ?? node.view_count ?? 0, 10) || 0,
        isVideo,
        isCarousel,
        productType: node.product_type || node.__typename || "unknown",
        timestamp: node.taken_at || node.taken_at_timestamp || null,
        is_pinned: node.pinned_for_viewer || node.is_pinned || false,
        isPaid,
        type,
        hasCoauthors,
        classification,
        border,
        sponsors,
        coauthors,
        sponsor_tags,
        caption_user,
        tagged_users,
        owner,
        user: owner,
        username: owner?.username || null,
        followers: owner?.follower_count || owner?.edge_followed_by?.count || 0,
        collectiveReach: 0,
        reachBreakdown: [],
    };
}

// ==================== GraphQL Query Tracking ====================

/**
 * Classify a GraphQL query based on its response structure
 */
function classifyQuery(queryHash, variables, responseData) {
    const queryMeta = {
        queryHash,
        type: "unknown",
        variables: Object.keys(variables),
        cursorVariable: null,
        cursorResponse: null,
        discoveredAt: Date.now(),
    };

    // Check for pagination cursor in variables
    if (variables.after !== undefined) {
        queryMeta.cursorVariable = "after";
    }

    // Check response for page_info
    const findPageInfo = (obj, depth = 0) => {
        if (depth > 5 || !obj || typeof obj !== "object") return null;
        if (obj.page_info) return obj.page_info;
        for (const value of Object.values(obj)) {
            const found = findPageInfo(value, depth + 1);
            if (found) return found;
        }
        return null;
    };

    const pageInfo = findPageInfo(responseData);
    if (pageInfo?.end_cursor) {
        queryMeta.cursorResponse = "page_info.end_cursor";
    }

    const data = responseData?.data || {};

    // Classify by content — modern IG structures first
    if (data.xdt_api__v1__feed__user_timeline_graphql_connection) {
        queryMeta.type = "posts";
    } else if (data.xdt_api__v1__feed__user_timeline_connection) {
        queryMeta.type = "posts";
    } else if (data.user?.edge_owner_to_timeline_media) {
        queryMeta.type = "posts";
    } else if (data.xdt_api__v1__discover__chaining) {
        queryMeta.type = "suggested_users";
    } else if (data.highlights) {
        queryMeta.type = "highlights";
    } else if (data.user) {
        queryMeta.type = "profile";
    } else if (data.shortcode_media?.edge_media_to_parent_comment) {
        queryMeta.type = "comments";
    } else if (data.user?.edge_followed_by) {
        queryMeta.type = "followers";
    } else if (data.shortcode_media?.edge_liked_by) {
        queryMeta.type = "likes";
    }

    return queryMeta;
}

// ==================== Message Handler ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const rawType = message.type || message.action || "";
    const msgType = rawType.toUpperCase().trim();
    console.log("[BG] Message received raw:", JSON.stringify(message));
    console.log("[BG] Normalized type:", msgType);

    switch (msgType) {

        // --- Platform Detection ---
        case "PLATFORM_DETECTED":
            platformStatus = message.payload;
            chrome.storage.local.set({ platform_status: platformStatus });
            sendResponse({ success: true });
            break;

        // --- Username Detection ---
        case "USERNAME_DETECTED":
            detectedUsername = message.payload.username;
            sendResponse({ success: true });
            break;

        // --- GraphQL Data Captured ---
        case "GRAPHQL_CAPTURED":
            handleGraphQLCapture(message.payload).then((result) => {
                sendResponse(result);
            });
            return true; // async response

        // --- Capture State ---
        case "GET_CAPTURE_STATE":
            sendResponse({ active: captureState.active });
            break;

        case "START_CAPTURE":
            resolveActiveInstagramUsername().then((resolved) => {
                // Falls back to the last-known username (e.g. capture started
                // from the Dataset Viewer, or the focused tab isn't a profile
                // page) rather than forcing activeRootProfile to null.
                detectedUsername = resolved || detectedUsername;
                captureState = { active: true, startedAt: Date.now(), activeRootProfile: detectedUsername };
                chrome.storage.local.set({ capture_state: captureState });
                // Notify all instagram tabs
                broadcastToInstagramTabs({ type: "SET_CAPTURE_STATE", active: true });
                sendResponse({ success: true, state: captureState });
            });
            return true; // async response

        case "STOP_CAPTURE":
            captureState = { active: false, startedAt: null, activeRootProfile: null };
            chrome.storage.local.set({ capture_state: captureState });
            broadcastToInstagramTabs({ type: "SET_CAPTURE_STATE", active: false });
            sendResponse({ success: true, state: captureState });
            break;

        case "STARTPARSING":
            shouldStopScraping = false;
            (async () => {
                try {
                    let shortcode = message.shortcode || "";
                    
                    // If shortcode is missing but 'user' (URL) is provided
                    if (!shortcode && message.user) {
                        const match = message.user.match(/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
                        if (match) shortcode = match[1];
                        else if (!message.user.includes("/")) shortcode = message.user;
                    }

                    if (!shortcode) throw new Error("Missing shortcode or post URL");

                    const comments = await fetchAllCommentsREST(shortcode, message.limit);
                    const responseBody = { 
                        success: true, 
                        comments: comments, 
                        items: comments,
                        message: { items: comments, postShortcode: shortcode }
                    };
                    sendResponse(responseBody);
                } catch (err) {
                    console.error("[BG] Scraper error:", err);
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        // Resume a partial comment scrape from the last saved cursor
        case "RESUME_COMMENTS":
            shouldStopScraping = false;
            (async () => {
                try {
                    const shortcode = message.shortcode;
                    if (!shortcode) throw new Error("Missing shortcode");
                    const cursor = message.cursor || await CommentsDB.getPostCursor(shortcode) || '';
                    console.log(`[BG] Resuming comment scrape for ${shortcode} from cursor: ${cursor ? '(stored)' : '(none — fresh start)'}`);
                    const comments = await fetchAllCommentsREST(shortcode, message.limit || 1000, cursor);
                    sendResponse({ success: true, comments, resumed: !!cursor, newCount: comments.length });
                } catch (err) {
                    console.error("[BG] Resume scrape error:", err);
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        // Get the last saved cursor for a shortcode (to check if resumable)
        case "GET_COMMENT_CURSOR":
            (async () => {
                try {
                    const cursor = await CommentsDB.getPostCursor(message.shortcode);
                    sendResponse({ success: true, cursor: cursor || null });
                } catch (err) {
                    sendResponse({ success: false, cursor: null });
                }
            })();
            return true; // async response

        case "STOP_SCRAPE":
            shouldStopScraping = true;
            if (batchScrapeState.active) {
                batchScrapeState.active = false;
                batchScrapeState.status = 'paused';
                // Pause session on backend
                pauseSessionOnBackend(batchScrapeState.sessionId);
                saveBatchScrapeStateLocally();
            }
            sendResponse({ success: true });
            break;

        // --- Batch Scrape (New V1 Engine) ---
        case "START_BATCH_SCRAPE":
            (async () => {
                try {
                    const result = await startBatchScrape(message.posts, message.profileUsername, message.postDelayMin);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "RESUME_BATCH_SCRAPE":
            (async () => {
                try {
                    const result = await resumeBatchScrape(message.sessionId);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "GET_SCRAPE_STATUS":
            sendResponse({
                success: true,
                ...batchScrapeState,
            });
            break;

        case "GET_LOCAL_COMMENTS":
            (async () => {
                try {
                    const comments = await CommentsDB.getLocalComments(message.shortcode);
                    sendResponse({ success: true, comments, count: comments.length });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "CHECK_SCRAPED_POSTS":
            (async () => {
                try {
                    const counts = await CommentsDB.getLocalCommentCounts(message.shortcodes || []);
                    sendResponse({ success: true, counts });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "GET_COMMENTS_FOR_POSTS":
            (async () => {
                try {
                    const comments = await CommentsDB.getCommentsForPosts(message.shortcodes || []);
                    sendResponse({ success: true, comments, count: comments.length });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;


        case "SYNC_COMMENTS_TO_BACKEND":
            (async () => {
                try {
                    const result = await syncCommentsToBackend();
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "SYNC_POSTS_TO_BACKEND":
            (async () => {
                try {
                    let postsToSync = message.posts;
                    // If no explicit posts provided, use PostsStore sync payload
                    if (!postsToSync && message.projectId) {
                        postsToSync = await PostsStore.getSyncPayload(message.projectId);
                    }
                    if (!postsToSync || postsToSync.length === 0) {
                        sendResponse({ success: true, message: 'No posts to sync' });
                        return;
                    }
                    await sendPostsToBackend(postsToSync, message.projectId);
                    sendResponse({ success: true });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        // --- Status (fast path) ---
        // Returns only in-memory/quick fields — NO PostsStore scan. The popup opens
        // this on load and polls it every 3s, so it must stay cheap even with
        // thousands of stored posts. The post-count-dependent fields (profilesCount,
        // oldestCapturedPosts) moved to GET_PROFILE_SUMMARY, fired once after render.
        case "GET_STATUS":
            (async () => {
                try {
                    const login = await checkInstagramLogin();
                    sendResponse({
                        success: true,
                        platform: platformStatus || { detected: false },
                        login: login || { loggedIn: false },
                        capture: captureState || { active: false },
                        stats: captureStats || { totalCaptured: 0, queriesSeen: 0 },
                        username: detectedUsername || null,
                        profileStats: latestProfileStats || null,
                    });
                } catch (err) {
                    console.error("[BG] GET_STATUS error:", err);
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true; // async response

        // --- Profile Summary (heavy path) ---
        // The one call that scans the whole PostsStore: unique-author count + the 5
        // oldest captured posts for the active profile. Fired by the popup once after
        // the fast render (and after capture stop/clear), never on the 3s poll.
        case "GET_PROFILE_SUMMARY":
            (async () => {
                try {
                    const posts = await PostsStore.getAllPosts();
                    const usernames = new Set();
                    let profilePosts = [];

                    for (const p of posts) {
                        const un = p.owner?.username || p.caption_user?.username || p.user?.username || p.username;
                        if (un) usernames.add(un);

                        if (detectedUsername && un === detectedUsername && p.timestamp && !p.is_pinned) {
                            let ts = 0;
                            if (typeof p.timestamp === 'string') {
                                ts = new Date(p.timestamp).getTime();
                            } else {
                                ts = p.timestamp > 1e11 ? p.timestamp : p.timestamp * 1000;
                            }
                            if (ts > 0) {
                                profilePosts.push({
                                    timestamp: ts,
                                    imageUrl: p.imageUrl || p.display_url || null,
                                    shortcode: p.shortcode || null
                                });
                            }
                        }
                    }

                    profilePosts.sort((a, b) => a.timestamp - b.timestamp);
                    // Keep captureStats in sync with the authoritative store count.
                    captureStats.totalCaptured = posts.length;
                    captureStats.postsCaptured = posts.length;

                    sendResponse({
                        success: true,
                        profilesCount: usernames.size,
                        oldestCapturedPosts: profilePosts.slice(0, 5),
                        totalCaptured: posts.length,
                    });
                } catch (err) {
                    console.error("[BG] GET_PROFILE_SUMMARY error:", err);
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true; // async response

        // --- On-Page Card: posts captured for the specific profile being viewed ---
        // Uses PostIndex.postProfiles() (owner OR coauthor), the same attribution
        // rule the Dataset Viewer's chips use — unlike GET_PROFILE_SUMMARY above,
        // which still matches by raw owner only. Full-scan like GET_PROFILE_SUMMARY;
        // called only on a profile navigation or a capture_stats change while on
        // one, never on a timer (see content.js refreshProfilePostCount).
        case "GET_PROFILE_POST_COUNT":
            (async () => {
                try {
                    const username = message.username;
                    if (!username) { sendResponse({ success: false, error: "No username" }); return; }
                    const posts = await PostsStore.getAllPosts();
                    const count = posts.filter(p => PostIndex.postProfiles(p).has(username)).length;
                    sendResponse({ success: true, count });
                } catch (err) {
                    console.error("[BG] GET_PROFILE_POST_COUNT error:", err);
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true; // async response

        // --- Login Check ---
        case "CHECK_LOGIN":
            checkInstagramLogin().then((login) => {
                sendResponse({ success: true, login });
            });
            return true;

        // --- Dataset (reads from PostsStore for backward compat) ---
        case "GET_DATASET":
            (async () => {
                try {
                    const allPosts = await PostsStore.getAllPosts();
                    sendResponse({
                        success: true,
                        dataset: { posts: allPosts },
                        count: allPosts.length,
                    });
                } catch (err) {
                    sendResponse({ success: true, dataset: { posts: [] }, count: 0 });
                }
            })();
            return true;

        case "GETPOSTMETADATA":
            (async () => {
                try {
                    const shortcode = message.shortcode;
                    const url = `https://www.instagram.com/graphql/query/?query_hash=b27b59419b48624f2b1c4e7f620e7fb4&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
                    const res = await fetch(url, { headers: { 'x-ig-app-id': '936619743392459' } });
                    const json = await res.json();
                    if (json.data?.shortcode_media) {
                        sendResponse({ success: true, data: json.data.shortcode_media });
                    } else {
                        sendResponse({ success: false, message: "Post not found" });
                    }
                } catch (err) {
                    sendResponse({ success: false, message: err.message });
                }
            })();
            return true;

        case "CLEAR_DATASET":
            (async () => {
                try {
                    await PostsStore.clearPostsStore();
                    chrome.storage.local.remove(["posts_dataset", "posts_dataset_backup", "profiles_dataset", "capture_stats"], () => {
                        captureStats = { totalCaptured: 0, postsCaptured: 0, commentsCaptured: 0, viewsCaptured: 0, queriesSeen: 0, lastCapturedAt: null };
                        sendResponse({ success: true });
                    });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "DEBUG_POSTS_STORE":
            (async () => {
                try {
                    const state = await PostsStore.getDebugState();
                    console.log("[BG] TOTAL POSTS:", state.totalPosts);
                    console.log("[BG] UNASSIGNED:", state.unassigned);
                    Object.entries(state.byProject).forEach(([pid, count]) => {
                        console.log(`[BG] PROJECT ${pid}:`, count);
                    });
                    sendResponse({ success: true, ...state });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "ASSIGN_TO_PROJECT":
            (async () => {
                try {
                    const shortcodes = message.shortcodes || [];
                    const projectId = message.projectId;
                    if (!projectId) {
                        sendResponse({ success: false, error: 'No projectId provided' });
                        return;
                    }
                    const result = await PostsStore.assignToProject(shortcodes, projectId);
                    console.log(`[BG] Assigned ${result.assigned} posts to project ${projectId}`);
                    sendResponse({ success: true, ...result });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "GET_UNASSIGNED_POSTS":
            (async () => {
                try {
                    const posts = await PostsStore.getUnassignedPosts();
                    sendResponse({ success: true, posts, count: posts.length });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "GET_PROJECT_POSTS":
            (async () => {
                try {
                    const posts = await PostsStore.getProjectPosts(message.projectId);
                    sendResponse({ success: true, posts, count: posts.length });
                } catch (err) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;

        case "MANUAL_UPDATE_CHECK":
            chrome.storage.local.remove(["lastSeenUpdateVersion"], () => {
                checkForUpdates()
                    .then(() => {
                        chrome.storage.local.get(["pendingUpdate"], (res) => {
                            sendResponse({ 
                                success: true, 
                                updateFound: !!res.pendingUpdate,
                                version: res.pendingUpdate ? res.pendingUpdate.version : chrome.runtime.getManifest().version
                            });
                        });
                    })
                    .catch(err => {
                        sendResponse({ success: false, error: err.message });
                    });
            });
            return true;

        case "REFETCH_CONFIG":
            checkForUpdates()
                .then(() => {
                    chrome.storage.local.get(["remoteConfig"], (res) => {
                        sendResponse({ 
                            success: true, 
                            config: res.remoteConfig
                        });
                    });
                })
                .catch(err => {
                    sendResponse({ success: false, error: err.message });
                });
            return true;

        // --- On-Page Counter Card: imperative actions ---
        case "HARD_RELOAD":
            if (sender?.tab?.id != null) {
                chrome.tabs.reload(sender.tab.id, { bypassCache: true });
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: "No tab to reload" });
            }
            break;

        case "OPEN_DATASET_VIEWER":
            try {
                chrome.runtime.openOptionsPage();
                sendResponse({ success: true });
            } catch (e) {
                chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
                sendResponse({ success: true });
            }
            break;

        // --- Auto Scroll (relayed to the focused Instagram tab's content script) ---
        case "START_AUTO_SCROLL":
        case "STOP_AUTO_SCROLL":
        case "GET_AUTO_SCROLL_STATE":
            getActiveInstagramTab().then((tab) => {
                if (!tab) {
                    sendResponse({ success: false, active: false, reason: "not_instagram" });
                    return;
                }
                chrome.tabs.sendMessage(tab.id, { type: msgType })
                    .then((resp) => sendResponse(resp || { success: true, active: msgType === "START_AUTO_SCROLL" }))
                    .catch(() => sendResponse({ success: false, active: false, reason: "no_content_script" }));
            });
            return true; // async response

        default:
            console.error("[BG] UNKNOWN MESSAGE TYPE ERROR:", msgType, "| Full message:", message);
            sendResponse({ success: false, error: "Unknown message type: " + msgType });
    }
});

// ==================== GraphQL Capture Handler ====================

async function handleGraphQLCapture(payload) {
    const { queryHash, variables, response, url } = payload;

    try {
        // 1. Classify and store query pattern
        if (queryHash) {
            const queryMeta = classifyQuery(queryHash, variables, response);
            captureStats.queriesSeen++;

            // Store query in library
            const library = (await chrome.storage.local.get(["graphql_queries"]))?.graphql_queries || {};
            library[queryHash] = queryMeta;
            await chrome.storage.local.set({ graphql_queries: library });

            console.log("[BG] Query classified:", queryMeta.type, "hash:", queryHash);
            
            if (queryMeta.type === "profile") {
                sendProfileToBackend(response?.data?.user);
            }
        }

        // 2. Try to parse posts from response
        const parsed = parsePostsFromResponse(response);

        if (parsed.posts.length > 0) {
            // Tag posts with the profile we actually visited and mark if they are reference posts
            const taggedPosts = parsed.posts
                .filter(p => p.shortcode)
                .map(p => {
                    const ownerUn = p.owner?.username || p.user?.username || p.username || p.caption_user?.username;
                    const isRef = captureState.activeRootProfile ? (ownerUn !== captureState.activeRootProfile) : false;
                    return { ...p, scrapedFromProfile: detectedUsername, is_reference: isRef };
                });

            // Add to PostsStore (deduplication handled internally — always adds to byId + unassigned first)
            const result = await PostsStore.addPosts(taggedPosts);

            // Auto-mark zero-comment posts as "scraped" in CommentsDB so they are never
            // accidentally queued for manual scraping. A sentinel record is inserted so
            // getLocalCommentCounts() returns count > 0 for these shortcodes.
            const zeroCommentPosts = taggedPosts.filter(p => (p.comments ?? p.comment_count ?? 1) === 0);
            if (zeroCommentPosts.length > 0) {
                const sentinels = zeroCommentPosts.map(p => ({
                    id: `__zero__${p.shortcode}`,
                    post_shortcode: p.shortcode,
                    username: null,
                    user_id: null,
                    text: null,
                    timestamp: null,
                    likes: 0,
                    replyCount: 0,
                    profilePic: null,
                    savedAt: Date.now(),
                    syncedToBackend: 1,       // treated as already synced — nothing to push
                    isZeroCommentSentinel: true,
                }));
                try {
                    await CommentsDB.saveSentinels(sentinels);
                    console.log(`[BG] Auto-marked ${zeroCommentPosts.length} zero-comment post(s) as scraped`);
                } catch (sentinelErr) {
                    console.warn('[BG] Failed to save zero-comment sentinels:', sentinelErr.message);
                }
            }

            // If a project is active, directly assign newly captured posts to it
            // This implements: Project active → Capture → Directly assign → project
            if (result.added > 0) {
                try {
                    const stored = await chrome.storage.local.get(['extension_settings']);
                    const activeProjectId = stored.extension_settings?.activeProjectId || null;
                    if (activeProjectId) {
                        const newShortcodes = taggedPosts.map(p => p.shortcode).filter(Boolean);
                        await PostsStore.assignToProject(newShortcodes, activeProjectId);
                        console.log(`[BG] Auto-assigned ${newShortcodes.length} posts to active project ${activeProjectId}`);
                    }
                } catch (assignErr) {
                    // Non-fatal: posts are safely in unassigned, user can assign manually
                    console.warn('[BG] Auto-assign to project failed (posts remain unassigned):', assignErr.message);
                }
            }


            // Update stats
            captureStats.totalCaptured = result.total;
            captureStats.postsCaptured = result.total;   // mirror for the on-page counter card
            captureStats.lastCapturedAt = Date.now();
            // Recompute the store-wide views sum (correct under dedup/merge; O(n) per batch).
            // Reels/videos carry a view count; photos default to 0.
            try {
                const all = await PostsStore.getAllPosts();
                captureStats.viewsCaptured = all.reduce(
                    (s, p) => s + (parseInt(p.views ?? p.play_count ?? p.video_view_count ?? p.view_count ?? 0, 10) || 0),
                    0
                );
            } catch (e) { /* keep prior viewsCaptured on error */ }
            await chrome.storage.local.set({ capture_stats: captureStats });

            console.log(`[BG] Captured ${result.added} new posts (${result.total} total in PostsStore)`);

            // Backend sync is now user-triggered via "Sync to DB" button in Projects tab
            // (no automatic fire-and-forget sync during capture)

            return {
                success: true,
                newPosts: result.added,
                totalPosts: result.total,
            };
        }

        return { success: true, newPosts: 0, totalPosts: captureStats.totalCaptured };

    } catch (err) {
        console.error("[BG] GraphQL capture processing error:", err);
        return { success: false, error: err.message };
    }
}

// ==================== Backend API Sync ====================

/**
 * Send captured posts to the backend API for database storage.
 * Uses the API URL and API Key configured in the extension settings tab.
 * This is fire-and-forget: failures are logged but don't block capture.
 */
async function sendPostsToBackend(posts, explicitProjectId) {
    try {
        const stored = await chrome.storage.local.get(["extension_settings"]);
        const settings = stored.extension_settings || {};
        const apiUrl = settings.apiUrl;

        if (!apiUrl) {
            console.log("[BG] No backend API URL configured, skipping DB sync.");
            return;
        }

        const headers = { "Content-Type": "application/json" };
        if (settings.apiKey) headers["x-api-key"] = settings.apiKey;
        if (settings.token) headers["Authorization"] = `Bearer ${settings.token}`;

        const normalizedApiUrl = apiUrl.replace(/\/+$/, '');
        const activeProjectId = explicitProjectId || settings.activeProjectId || null;
        const response = await fetch(`${normalizedApiUrl}/api/posts`, {
            method: "POST",
            headers,
            body: JSON.stringify({ posts, project_id: activeProjectId }),
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`[BG] Backend sync: ${result.inserted} inserted, ${result.updated} updated`);
        } else {
            console.warn("[BG] Backend sync failed:", response.status, await response.text());
        }
    } catch (err) {
        console.warn("[BG] Backend sync error (will retry on next capture):", err.message);
    }
}

async function sendProfileToBackend(user) {
    if (!user || !user.username) return;
    
    try {
        // Local-first: no backend config is read here — capture always persists locally,
        // regardless of apiUrl. Profiles reach the DB only via the "Save to DB" batch path.

        // The user payload can reside in user.edge_follow or similar structures.
        // We will default to zero if we can't extract the new nested fields nicely safely.
        const profileData = {
            id: user.id || user.username,
            username: user.username,
            follower_count: user.follower_count || user.edge_followed_by?.count || 0,
            following_count: user.following_count || user.edge_follow?.count || 0,
            media_count: user.media_count || user.edge_owner_to_timeline_media?.count || 0,
            biography: user.biography || "",
            external_url: user.external_url || user.external_lynx_url || "",
            is_verified: user.is_verified || false,
            latest_post_timestamp: user.edge_owner_to_timeline_media?.edges?.[0]?.node?.taken_at_timestamp || null,
            role: (captureState.activeRootProfile && user.username === captureState.activeRootProfile) ? 'root' : 'reference'
        };

        // Make it available to the popup synchronously
        latestProfileStats = profileData;

        // Persist it into the cumulative dataset
        const storedProfiles = (await chrome.storage.local.get(["profiles_dataset"]))?.profiles_dataset || [];
        const existingIdx = storedProfiles.findIndex(p => p.username === profileData.username);
        if (existingIdx !== -1) {
            storedProfiles[existingIdx] = profileData;
        } else {
            storedProfiles.push(profileData);
        }
        await chrome.storage.local.set({ profiles_dataset: storedProfiles });

        // Local-first: influencer profiles are NOT pushed to the DB per capture.
        // They are batch-synced to /api/users only when the user clicks "Save to DB".
        console.log(`[BG] Cached profile locally: ${user.username} (${profileData.follower_count} followers)`);
    } catch (err) {
        console.warn("[BG] Backend sync profile error:", err.message);
    }
}


// ==================== Active Instagram Tab Resolution ====================

/**
 * The focused Instagram tab, or null. Used wherever a background-initiated
 * action (START_CAPTURE, auto-scroll) needs to know which tab the user is
 * actually looking at — `currentWindow` is meaningless from a service worker,
 * which has no window of its own, so this uses `lastFocusedWindow` instead.
 */
async function getActiveInstagramTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.url && /^https:\/\/[^/]*\.instagram\.com\//.test(tab.url)) {
            return tab;
        }
    } catch (err) {
        console.warn("[BG] getActiveInstagramTab error:", err);
    }
    return null;
}

/**
 * Re-derives the profile username from the focused Instagram tab's URL,
 * mirroring content.js's extractUsername(). START_CAPTURE used to trust
 * `detectedUsername` — a single global last set by whichever Instagram tab
 * most recently reported in via USERNAME_DETECTED — which is stale or null
 * when capture is started from the Dataset Viewer (a non-Instagram tab) or
 * when multiple Instagram tabs are open. Falls back to the last known value
 * (via the caller) rather than forcing it to null when resolution fails.
 */
async function resolveActiveInstagramUsername() {
    const tab = await getActiveInstagramTab();
    if (!tab || !tab.url) return null;
    try {
        const path = new URL(tab.url).pathname;
        const m = path.match(/^\/([^/]+)\/?$/);
        if (m && !["explore", "reels", "stories", "direct", "accounts", "p"].includes(m[1])) {
            return m[1];
        }
    } catch (err) {
        console.warn("[BG] resolveActiveInstagramUsername parse error:", err);
    }
    return null;
}

// ==================== Broadcast to Instagram Tabs ====================

async function broadcastToInstagramTabs(message) {
    try {
        const tabs = await chrome.tabs.query({ url: "https://*.instagram.com/*" });
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {
                // Tab might not have content script loaded
            });
        }
    } catch (err) {
        console.warn("[BG] Broadcast error:", err);
    }
}

// ==================== Web Request Listener (Metadata Only) ====================

// Listen for GraphQL request completions (captures URL/headers metadata)
chrome.webRequest.onCompleted.addListener(
    (details) => {
        if (captureState.active) {
            console.log("[BG] API request detected:", details.url.substring(0, 100));
        }
    },
    { urls: ["https://*.instagram.com/api/*", "https://*.instagram.com/graphql/*"] }
);

// ==================== Batch Scraper Helpers ====================

/**
 * Legacy: Fetch all comments for a single post (used by modal scrape button).
 * Saves to IndexedDB for offline persistence.
 */
async function fetchAllCommentsREST(shortcode, limit = 500, startCursor = '') {
  // Same MV3 lifecycle risk as the batch path — keep the worker alive for the run.
  startKeepAlive();
  try {
    const GRAPHQL_QUERY_HASH = '33ba35852cb50da46f5b5e889df7d159';
    const COMMENTS_PER_PAGE = 50;
    let scrapedComments = [];
    let hasNextPage = true;
    let endCursor = startCursor || '';
    let apiCalls = 0;
    
    console.log(`[BG] Starting comment scrape for ${shortcode}, limit: ${limit}, startCursor: ${endCursor ? '(resuming)' : '(fresh)'}`);

    while (hasNextPage && !shouldStopScraping && scrapedComments.length < limit) {
        try {
            const variables = JSON.stringify({
                shortcode: shortcode,
                after: endCursor || '',
                first: COMMENTS_PER_PAGE
            });

            const url = `https://www.instagram.com/graphql/query/?query_hash=${GRAPHQL_QUERY_HASH}&variables=${encodeURIComponent(variables)}`;
            
            const res = await fetch(url, {
                headers: {
                    'x-ig-app-id': '936619743392459'
                }
            });
            apiCalls++;
            
            // Apply delay: 10 seconds every 4th API call
            if (apiCalls > 0 && apiCalls % 4 === 0) {
                console.log(`[BG] Reached ${apiCalls} API calls (Legacy). Pausing for 10 seconds to prevent rate limits...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }

            if (!res.ok) {
                if (res.status === 429) throw new Error("Rate limited by Instagram. Please wait before trying again.");
                throw new Error(`HTTP ${res.status}`);
            }

            const json = await res.json();
            const commentData = json.data?.shortcode_media?.edge_media_to_comment;
            
            if (!commentData) {
                console.warn("[BG] No comment data in response for", shortcode);
                break;
            }
            
            const edges = commentData.edges || [];
            const pageComments = [];
            edges.forEach(edge => {
                if (scrapedComments.length + pageComments.length < limit) {
                    pageComments.push({
                        id: edge.node.id,
                        username: edge.node.owner?.username,
                        userId: edge.node.owner?.id,
                        text: edge.node.text,
                        timestamp: edge.node.created_at ? new Date(edge.node.created_at * 1000).toISOString() : null,
                        likes: edge.node.edge_liked_by?.count || 0,
                        replyCount: edge.node.edge_threaded_comments?.count || 0,
                        profilePic: edge.node.owner?.profile_pic_url || null,
                        ownerId: edge.node.owner?.id,
                    });
                }
            });

            scrapedComments.push(...pageComments);

            // Save each page to IndexedDB immediately (checkpoint)
            try {
                await CommentsDB.saveCommentsLocally(shortcode, pageComments);
            } catch (dbErr) {
                console.warn('[BG] IndexedDB save warning:', dbErr.message);
            }

            // Live-update the on-page counter card (may double-count on re-scrape — accepted limitation)
            captureStats.commentsCaptured = (captureStats.commentsCaptured || 0) + pageComments.length;
            chrome.storage.local.set({ capture_stats: captureStats });
            
            hasNextPage = commentData.page_info?.has_next_page;
            endCursor = commentData.page_info?.end_cursor || '';

            // Persist cursor so a partial scrape can be resumed later
            if (hasNextPage && endCursor) {
                CommentsDB.savePostCursor(shortcode, endCursor).catch(() => {});
            } else {
                // Scrape finished — clear the stored cursor
                CommentsDB.savePostCursor(shortcode, '').catch(() => {});
            }

            console.log(`[BG] Scraped ${scrapedComments.length} comments for ${shortcode}`);
            
            if (hasNextPage && !shouldStopScraping && scrapedComments.length < limit) {
                const delay = 2000 + Math.random() * 3000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (err) {
            console.error("[BG] Page fetch error:", err);
            throw err;
        }
    }
    
    // Fire-and-forget sync to backend
    syncCommentsToBackend().catch(e => console.warn('[BG] Comment sync skipped:', e.message));

    // Log API scrape stats
    getBackendSettings().then(settings => {
        sendLogToBackend(shortcode, apiCalls, scrapedComments.length, settings).catch(() => {});
    });

    return scrapedComments;
  } finally {
    stopKeepAlive();
  }
}

// ==================== V1 Batch Scrape Engine ====================

/**
 * Get backend settings (API URL + token)
 */
async function getBackendSettings() {
    const stored = await chrome.storage.local.get(['extension_settings']);
    const settings = stored.extension_settings || {};
    return {
        apiUrl: CONFIG.normalizeUrl(settings.apiUrl || CONFIG.DEFAULT_API_URL),
        token: settings.token || null,
        apiKey: settings.apiKey || null,
        activeProjectId: settings.activeProjectId || null,
    };
}

/**
 * Build headers for backend API calls
 */
function buildBackendHeaders(settings) {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.token) headers['Authorization'] = `Bearer ${settings.token}`;
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    return headers;
}

/**
 * Check if backend is reachable
 */
async function checkBackendStatus() {
    try {
        const settings = await getBackendSettings();
        if (!settings.apiUrl) return { online: false, reason: 'no_url' };

        const res = await fetch(`${settings.apiUrl}/api/health`, { 
            signal: AbortSignal.timeout(5000) 
        });
        
        const isOnline = res.ok;
        await logConnectivity(isOnline ? 'connected' : 'unreachable', settings.apiUrl, isOnline ? null : `HTTP ${res.status}`);
        
        return { online: isOnline, status: res.status };
    } catch (err) {
        const settings = await getBackendSettings();
        await logConnectivity('unreachable', settings.apiUrl, err.message);
        return { online: false, reason: 'unreachable', error: err.message };
    }
}

/**
 * Log connectivity events to storage for the log UI
 */
async function logConnectivity(status, url, detail = null) {
    try {
        const stored = await chrome.storage.local.get(['connectivity_logs']);
        const logs = stored.connectivity_logs || [];
        
        const newEntry = {
            id: Date.now() + Math.random().toString(36).substring(7),
            timestamp: Date.now(),
            status, // 'connected' | 'unreachable'
            url,
            detail
        };
        
        logs.unshift(newEntry);
        // Keep last 50 logs
        await chrome.storage.local.set({ connectivity_logs: logs.slice(0, 50) });
    } catch (err) {
        console.error("[BG] Failed to log connectivity:", err);
    }
}

/**
 * Start a new batch scrape session
 * @param {Array} posts - [{shortcode, comments_count}]
 * @param {string} profileUsername
 */
async function startBatchScrape(posts, profileUsername, postDelayMin) {
    if (batchScrapeState.active) {
        return { success: false, error: 'A batch scrape is already running' };
    }

    shouldStopScraping = false;
    const settings = await getBackendSettings();

    // Step 1: Check which posts already have comments locally
    const shortcodes = posts.map(p => p.shortcode).filter(Boolean);
    const localCounts = await CommentsDB.getLocalCommentCounts(shortcodes);

    // Posts with 0 comments are treated as auto-scraped — no API request needed.
    // The comment count is stored on the post as `comments` (set during capture).
    const zeroCommentPosts = posts.filter(p => (p.comments ?? p.comment_count ?? 1) === 0);
    const zeroCommentShortcodes = new Set(zeroCommentPosts.map(p => p.shortcode));

    if (zeroCommentPosts.length > 0) {
        console.log(`[BATCH] Skipping ${zeroCommentPosts.length} posts with 0 comments (auto-scraped, no API call needed)`);
    }

    // Filter: skip posts already scraped locally OR posts with 0 comments
    const postsToScrape = posts.filter(
        p => !localCounts[p.shortcode] && !zeroCommentShortcodes.has(p.shortcode)
    );

    const alreadyScrapedCount = Object.keys(localCounts).length;
    console.log(`[BATCH] ${shortcodes.length} posts total | ${alreadyScrapedCount} already in IDB | ${zeroCommentPosts.length} zero-comment (auto-skip) | ${postsToScrape.length} to scrape`);

    if (postsToScrape.length === 0) {
        return {
            success: true,
            message: 'All posts already scraped',
            alreadyScraped: alreadyScrapedCount,
            zeroCommentPosts: zeroCommentPosts.length,
        };
    }

    // Step 2: Create session on backend (if online)
    let sessionId = null;
    if (settings.apiUrl) {
        try {
            const headers = buildBackendHeaders(settings);
            const res = await fetch(`${settings.apiUrl}/api/scrape/sessions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ profile_username: profileUsername, posts: postsToScrape, project_id: settings.activeProjectId }),
            });
            if (res.ok) {
                const data = await res.json();
                sessionId = data.session?.id;
                console.log(`[BATCH] Backend session created: ${sessionId}`);
            } else {
                console.warn('[BATCH] Backend session creation failed, running locally');
            }
        } catch (err) {
            console.warn('[BATCH] Backend unavailable, running locally:', err.message);
        }
    }

    // Step 3: Initialize batch scrape state
    const clampedDelayMin = Math.max(10, parseInt(postDelayMin) || 10);
    batchScrapeState = {
        active: true,
        sessionId,
        backendUrl: settings.apiUrl,
        token: settings.token,
        status: 'running',
        totalJobs: postsToScrape.length,
        completedJobs: 0,
        totalComments: 0,
        currentPost: null,
        startedAt: Date.now(),
        // skippedPosts = IDB-cached + zero-comment (neither need an API call)
        skippedPosts: alreadyScrapedCount + zeroCommentPosts.length,
        postDelayMin: clampedDelayMin,
        nextDelayMs: 0,
    };

    await saveBatchScrapeStateLocally();

    // Step 4: Run the job queue (non-blocking)
    runBatchJobQueue(postsToScrape, settings);

    return {
        success: true,
        sessionId,
        postsToScrape: postsToScrape.length,
        alreadyScraped: alreadyScrapedCount,
        zeroCommentPosts: zeroCommentPosts.length,
    };
}

/**
 * Resume an interrupted batch scrape
 */
async function resumeBatchScrape(sessionId) {
    if (batchScrapeState.active) {
        return { success: false, error: 'A batch scrape is already running' };
    }

    shouldStopScraping = false;
    const settings = await getBackendSettings();

    // Load state from IndexedDB
    const savedState = await CommentsDB.loadScrapeState();
    if (!savedState || !savedState.pendingPosts || savedState.pendingPosts.length === 0) {
        return { success: false, error: 'No session to resume' };
    }

    // Resume on backend if available
    if (sessionId && settings.apiUrl) {
        try {
            const headers = buildBackendHeaders(settings);
            await fetch(`${settings.apiUrl}/api/scrape/sessions/${sessionId}/resume`, {
                method: 'POST',
                headers,
            });
        } catch (err) {
            console.warn('[BATCH RESUME] Backend resume failed:', err.message);
        }
    }

    batchScrapeState = {
        active: true,
        sessionId: sessionId || savedState.sessionId,
        backendUrl: settings.apiUrl,
        token: settings.token,
        status: 'running',
        totalJobs: savedState.totalJobs || savedState.pendingPosts.length,
        completedJobs: savedState.completedJobs || 0,
        totalComments: savedState.totalComments || 0,
        currentPost: null,
        startedAt: Date.now(),
    };

    await saveBatchScrapeStateLocally();

    const postsToScrape = savedState.pendingPosts.map(sc => ({ shortcode: sc }));
    runBatchJobQueue(postsToScrape, settings);

    return {
        success: true,
        sessionId: batchScrapeState.sessionId,
        resumingPosts: postsToScrape.length,
    };
}

/**
 * Core job queue runner — processes posts sequentially with checkpoints
 */
async function runBatchJobQueue(posts, settings) {
  // Keep the service worker alive for the whole run so it survives navigating
  // away / closing the popup (see startKeepAlive). finally guarantees release.
  startKeepAlive();
  try {
    const GRAPHQL_QUERY_HASH = '33ba35852cb50da46f5b5e889df7d159';
    const COMMENTS_PER_PAGE = 50;
    const pendingShortcodes = posts.map(p => p.shortcode);
    let igApiCallsCount = 0; // Global counter for all requests in batch

    for (let i = 0; i < posts.length; i++) {
        if (shouldStopScraping || !batchScrapeState.active) {
            console.log('[BATCH] Scrape stopped by user');
            batchScrapeState.status = 'paused';
            break;
        }

        const post = posts[i];
        const shortcode = post.shortcode;
        if (!shortcode) continue;

        batchScrapeState.currentPost = shortcode;
        console.log(`[BATCH] Processing ${i + 1}/${posts.length}: ${shortcode}`);

        let hasNextPage = true;
        let endCursor = '';
        let pageNum = 0;
        let postComments = 0;
        let apiCalls = 0;

        // Fetch all pages of comments for this post
        while (hasNextPage && !shouldStopScraping && batchScrapeState.active) {
            pageNum++;
            let jobId = null;

            // If backend is available, get/update job
            if (settings.apiUrl && batchScrapeState.sessionId) {
                try {
                    // The backend auto-creates next-page jobs, but for first page we use the initial jobs
                    if (pageNum === 1) {
                        const headers = buildBackendHeaders(settings);
                        const nextRes = await fetch(
                            `${settings.apiUrl}/api/scrape/sessions/${batchScrapeState.sessionId}/next-job`,
                            { headers }
                        );
                        if (nextRes.ok) {
                            const nextData = await nextRes.json();
                            if (nextData.job) {
                                jobId = nextData.job.id;
                                endCursor = nextData.job.end_cursor || '';
                                // Mark job as running
                                await fetch(`${settings.apiUrl}/api/scrape/jobs/${jobId}`, {
                                    method: 'PATCH',
                                    headers,
                                    body: JSON.stringify({ status: 'running' }),
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[BATCH] Backend job fetch error:', err.message);
                }
            }

            try {
                const variables = JSON.stringify({
                    shortcode,
                    after: endCursor || '',
                    first: COMMENTS_PER_PAGE,
                });

                const url = `https://www.instagram.com/graphql/query/?query_hash=${GRAPHQL_QUERY_HASH}&variables=${encodeURIComponent(variables)}`;
                const res = await fetch(url, { headers: { 'x-ig-app-id': '936619743392459' } });
                apiCalls++;
                igApiCallsCount++;

                // Apply delay: 10 seconds every 4th API call
                if (igApiCallsCount > 0 && igApiCallsCount % 4 === 0) {
                    console.log(`[BATCH] Reached ${igApiCallsCount} API calls globally. Pausing for 10 seconds to prevent rate limits...`);
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }

                if (!res.ok) {
                    if (res.status === 429) {
                        console.warn('[BATCH] Rate limited! Pausing for 60 seconds...');
                        // Update backend job status
                        if (jobId && settings.apiUrl) {
                            await fetch(`${settings.apiUrl}/api/scrape/jobs/${jobId}`, {
                                method: 'PATCH',
                                headers: buildBackendHeaders(settings),
                                body: JSON.stringify({ status: 'failed', error_message: 'Rate limited (429)' }),
                            }).catch(() => {});
                        }
                        // Wait 60 seconds then retry
                        await new Promise(r => setTimeout(r, 60000));
                        pageNum--; // Retry this page
                        continue;
                    }
                    throw new Error(`HTTP ${res.status}`);
                }

                const json = await res.json();
                const commentData = json.data?.shortcode_media?.edge_media_to_comment;

                if (!commentData) {
                    console.warn(`[BATCH] No comment data for ${shortcode}`);
                    hasNextPage = false;
                    break;
                }

                // Parse comments
                const pageComments = (commentData.edges || []).map(edge => ({
                    id: edge.node.id,
                    username: edge.node.owner?.username,
                    userId: edge.node.owner?.id,
                    text: edge.node.text,
                    timestamp: edge.node.created_at ? new Date(edge.node.created_at * 1000).toISOString() : null,
                    likes: edge.node.edge_liked_by?.count || 0,
                    replyCount: edge.node.edge_threaded_comments?.count || 0,
                    profilePic: edge.node.owner?.profile_pic_url || null,
                    ownerId: edge.node.owner?.id,
                }));

                // Save to IndexedDB immediately (checkpoint)
                await CommentsDB.saveCommentsLocally(shortcode, pageComments);
                postComments += pageComments.length;
                batchScrapeState.totalComments += pageComments.length;

                // Live-update the on-page counter card (may double-count on re-scrape — accepted limitation)
                captureStats.commentsCaptured = (captureStats.commentsCaptured || 0) + pageComments.length;
                chrome.storage.local.set({ capture_stats: captureStats });

                // Update backend job
                hasNextPage = commentData.page_info?.has_next_page || false;
                const newCursor = commentData.page_info?.end_cursor || '';

                if (jobId && settings.apiUrl) {
                    try {
                        await fetch(`${settings.apiUrl}/api/scrape/jobs/${jobId}`, {
                            method: 'PATCH',
                            headers: buildBackendHeaders(settings),
                            body: JSON.stringify({
                                status: 'completed',
                                comments_scraped: pageComments.length,
                                end_cursor: newCursor,
                                has_next_page: hasNextPage,
                            }),
                        });
                    } catch (err) {
                        console.warn('[BATCH] Backend job update failed:', err.message);
                    }
                }

                // Send comments to backend for DB storage
                if (settings.apiUrl && pageComments.length > 0) {
                    sendCommentsToBackend(shortcode, pageComments, settings).catch(() => {});
                }

                endCursor = newCursor;

                console.log(`[BATCH] ${shortcode} page ${pageNum}: +${pageComments.length} (total: ${postComments})`);

                // Random delay between pages (2-4 seconds)
                if (hasNextPage && !shouldStopScraping) {
                    const delay = 2000 + Math.random() * 2000;
                    await new Promise(r => setTimeout(r, delay));
                }

            } catch (err) {
                console.error(`[BATCH] Error on ${shortcode} page ${pageNum}:`, err.message);
                // Mark job as failed on backend
                if (jobId && settings.apiUrl) {
                    await fetch(`${settings.apiUrl}/api/scrape/jobs/${jobId}`, {
                        method: 'PATCH',
                        headers: buildBackendHeaders(settings),
                        body: JSON.stringify({ status: 'failed', error_message: err.message }),
                    }).catch(() => {});
                }
                hasNextPage = false;
            }
        }

        // Log scrape stats for this post
        sendLogToBackend(shortcode, apiCalls, postComments, settings).catch(() => {});

        // Update progress
        batchScrapeState.completedJobs++;
        pendingShortcodes.shift();

        // Save checkpoint to IndexedDB
        await CommentsDB.saveScrapeState({
            sessionId: batchScrapeState.sessionId,
            totalJobs: batchScrapeState.totalJobs,
            completedJobs: batchScrapeState.completedJobs,
            totalComments: batchScrapeState.totalComments,
            pendingPosts: pendingShortcodes.slice(),
        });

        // Configurable random delay between posts (min ≥ 10s, random up to min+10s)
        if (i < posts.length - 1 && !shouldStopScraping && batchScrapeState.active) {
            const minMs = (batchScrapeState.postDelayMin || 10) * 1000;
            const delayMs = minMs + Math.random() * 10000; // random extra up to 10s on top of min
            batchScrapeState.nextDelayMs = Math.round(delayMs);
            console.log(`[BATCH] Waiting ${(delayMs / 1000).toFixed(1)}s before next post...`);
            await new Promise(r => setTimeout(r, delayMs));
            batchScrapeState.nextDelayMs = 0;
        }
    }

    // Finalize
    if (!shouldStopScraping && batchScrapeState.active) {
        batchScrapeState.status = 'completed';
        await CommentsDB.clearScrapeState();
    }

    batchScrapeState.active = false;
    batchScrapeState.currentPost = null;

    // Final sync to backend
    syncCommentsToBackend().catch(e => console.warn('[BATCH] Final sync error:', e.message));

    console.log(`[BATCH] Complete. ${batchScrapeState.completedJobs} posts, ${batchScrapeState.totalComments} comments.`);
  } finally {
    stopKeepAlive();
  }
}

/**
 * Send comments to backend (fire-and-forget)
 */
async function sendCommentsToBackend(postShortcode, comments, settings) {
    if (!settings?.apiUrl) return;

    try {
        const headers = buildBackendHeaders(settings);
        const res = await fetch(`${settings.apiUrl}/api/comments`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ post_shortcode: postShortcode, comments }),
        });

        if (res.ok) {
            const data = await res.json();
            console.log(`[SYNC] Sent ${data.total} comments for ${postShortcode} to backend`);
            // Mark as synced in IndexedDB
            const ids = comments.map(c => String(c.id));
            await CommentsDB.markCommentsSynced(ids);
        }
    } catch (err) {
        console.warn('[SYNC] Backend comment send failed:', err.message);
    }
}

/**
 * Sync all unsynced comments from IndexedDB to backend
 */
async function syncCommentsToBackend() {
    const settings = await getBackendSettings();
    if (!settings.apiUrl) return { success: false, reason: 'no_url' };

    try {
        const unsynced = await CommentsDB.getUnsyncedComments();
        const shortcodes = Object.keys(unsynced);

        if (shortcodes.length === 0) {
            return { success: true, synced: 0 };
        }

        let totalSynced = 0;
        for (const sc of shortcodes) {
            await sendCommentsToBackend(sc, unsynced[sc], settings);
            totalSynced += unsynced[sc].length;
        }

        console.log(`[SYNC] Synced ${totalSynced} comments across ${shortcodes.length} posts`);
        return { success: true, synced: totalSynced, posts: shortcodes.length };
    } catch (err) {
        console.warn('[SYNC] Background sync error:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Save batch scrape state to IndexedDB for crash recovery
 */
async function saveBatchScrapeStateLocally() {
    try {
        await CommentsDB.saveScrapeState({
            sessionId: batchScrapeState.sessionId,
            totalJobs: batchScrapeState.totalJobs,
            completedJobs: batchScrapeState.completedJobs,
            totalComments: batchScrapeState.totalComments,
            pendingPosts: [],
        });
    } catch (err) {
        console.warn('[BG] Failed to save scrape state:', err.message);
    }
}

/**
 * Pause session on backend
 */
async function pauseSessionOnBackend(sessionId) {
    if (!sessionId) return;
    try {
        const settings = await getBackendSettings();
        if (!settings.apiUrl) return;
        await fetch(`${settings.apiUrl}/api/scrape/sessions/${sessionId}/pause`, {
            method: 'POST',
            headers: buildBackendHeaders(settings),
        });
    } catch (err) {
        console.warn('[BG] Backend pause failed:', err.message);
    }
}

/**
 * Log api requests and scraped comments metrics
 */
async function sendLogToBackend(postShortcode, apiCalls, commentsScraped, settings) {
    if (!settings?.apiUrl) return;

    try {
        const headers = buildBackendHeaders(settings);
        const res = await fetch(`${settings.apiUrl}/api/comments/log`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ post_shortcode: postShortcode, api_calls: apiCalls, comments_scraped: commentsScraped }),
        });
        if (!res.ok) {
            console.warn('[LOG] Failed to log scrape stats to backend', res.status);
        }
    } catch (err) {
        console.warn('[LOG] Failed to log scrape stats:', err.message);
    }
}

// Background sync: periodically sync unsynced comments
setInterval(() => {
    syncCommentsToBackend().catch(() => {});
}, 5 * 60 * 1000); // Every 5 minutes

// ==================== Soft Update Notification System ====================

const UPDATE_CHECK_URL = "https://instasurf-website.vercel.app/update.json";
// const UPDATE_CHECK_URL = "http://localhost:8000/update_dev.json";
// const UPDATE_CHECK_URL = "https://nonevadingly-postcardinal-kaitlynn.ngrok-free.dev/update.json";
const CURRENT_VERSION = chrome.runtime.getManifest().version;

/**
 * Check for updates from GitHub
 */
async function checkForUpdates() {
    try {
        console.log("[BG] Checking for updates...");
        let response;
        try {
            response = await fetch(UPDATE_CHECK_URL + "?t=" + Date.now(), {
                headers: {
                    "ngrok-skip-browser-warning": "true",
                    "Accept": "application/json"
                }
            }); // Prevent caching and skip ngrok warning
            if (!response.ok) throw new Error("Update check failed: " + response.status);
        } catch (fetchErr) {
            const localFilename = UPDATE_CHECK_URL.split('/').pop().split('?')[0] || 'update.json';
            console.warn(`[BG] Remote update check failed, falling back to local ${localFilename}:`, fetchErr.message);
            const localUrl = chrome.runtime.getURL(localFilename);
            response = await fetch(localUrl);
            if (!response.ok) throw new Error("Local fallback failed: " + response.status);
        }
        
        const data = await response.json();
        
        // Always save remote configuration regardless of extension version
        const remoteConfig = {};
        if (data.global) remoteConfig.global = data.global;
        if (data.features) remoteConfig.features = data.features;
        if (data.ui) remoteConfig.ui = data.ui;
        
        if (Object.keys(remoteConfig).length > 0) {
            chrome.storage.local.set({ remoteConfig });
            console.log("[BG] Remote config updated:", remoteConfig);
        }

        const newVersion = data.version;

        if (isNewerVersion(newVersion, CURRENT_VERSION)) {
            console.log(`[BG] New version available: ${newVersion} (Current: ${CURRENT_VERSION})`);
            chrome.storage.local.set({ pendingUpdate: data });
            notifyUpdate(data);
        } else {
            console.log("[BG] Extension is up to date.");
            chrome.storage.local.remove(["pendingUpdate"]);
        }
    } catch (err) {
        console.warn("[BG] Update check error:", err.message);
    }
}

/**
 * Compare version strings (e.g. "1.2.0" > "1.0.5")
 */
function isNewerVersion(newV, oldV) {
    const newParts = newV.split('.').map(Number);
    const oldParts = oldV.split('.').map(Number);

    for (let i = 0; i < Math.max(newParts.length, oldParts.length); i++) {
        const n = newParts[i] || 0;
        const o = oldParts[i] || 0;
        if (n > o) return true;
        if (n < o) return false;
    }
    return false;
}

/**
 * Notify all Instagram tabs about the update
 */
function notifyUpdate(data) {
    chrome.tabs.query({ url: "https://*.instagram.com/*" }, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
                type: "UPDATE_AVAILABLE",
                payload: data
            }).catch(() => {}); // Ignore tabs where content script isn't ready
        });
    });

    // Notify extension pages (options, popup)
    chrome.runtime.sendMessage({
        type: "UPDATE_AVAILABLE",
        payload: data
    }).catch(() => {});
}

// Set up periodic checks via alarms
chrome.runtime.onInstalled.addListener(async () => {
    chrome.alarms.create("check_extension_update", { periodInMinutes: 60 });
    checkForUpdates(); // Check immediately on install/update

    // Migrate legacy posts_dataset to PostsStore on install/update
    try {
        const migration = await PostsStore.migrateFromLegacy();
        if (migration.migrated > 0) {
            console.log(`[BG] Migration: ${migration.migrated} posts migrated to PostsStore.`);
        }

        // Post-migration integrity check
        const integrity = await PostsStore.validateIntegrity();
        if (!integrity.valid) {
            console.warn('[BG] Post-migration integrity issues detected:', integrity.errors);
            const repair = await PostsStore.repairIntegrity();
            if (repair.repaired) {
                console.log(`[BG] Auto-repair applied ${repair.actions.length} fixes.`);
            }
        }
    } catch (err) {
        console.error("[BG] Migration error:", err);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    checkForUpdates(); // Check on browser startup

    // Warn if legacy posts_dataset is still lingering in storage
    try {
        const legacy = await chrome.storage.local.get(["posts_dataset"]);
        if (legacy.posts_dataset && legacy.posts_dataset.posts && legacy.posts_dataset.posts.length > 0) {
            console.warn(`[BG] LEGACY DATASET STILL IN STORAGE: ${legacy.posts_dataset.posts.length} posts in posts_dataset. PostsStore is the authoritative source.`);
        }
    } catch (e) { /* ignore */ }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "check_extension_update") {
        checkForUpdates();
    }
});


console.log("[BG] Insta Surfer background service worker started (V1 Comment Engine)");
