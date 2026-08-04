/**
 * PostIndex — pure helpers for post attribution and search.
 *
 * Single source of truth for two questions, so that chip counts, the post
 * filter, reach attribution and the audit can never disagree:
 *   1. Which profiles does this post belong to?   -> postProfiles()
 *   2. Does this post match this query?           -> matchesQuery()
 *
 * No chrome.* access, no DOM. Safe to require() from a plain-node test.
 */

/**
 * Canonical owner resolution. Mirrors the order already used by
 * calculateCollectiveReach (options.js:1769) so attribution stays consistent
 * with the existing reach code.
 */
function getOwner(post) {
    if (!post) return null;
    return (
        (post.owner && post.owner.username) ||
        (post.user && post.user.username) ||
        post.username ||
        (post.caption_user && post.caption_user.username) ||
        null
    );
}

/**
 * Coauthor usernames. Reads the codebase's established alias pair
 * (`coauthors` || `coauthor_producers`, as at options.js:1038/1744/2206) and
 * tolerates entries that are bare strings rather than objects.
 */
function getCoauthors(post) {
    if (!post) return [];
    const list = post.coauthors || post.coauthor_producers || [];
    if (!Array.isArray(list)) return [];
    return list
        .map(c => (typeof c === 'string' ? c : c && c.username))
        .filter(Boolean);
}

/**
 * Profiles a post is attributed to: its owner, plus every coauthor.
 *
 * Deliberately EXCLUDES scrapedFromProfile. That field records which profile
 * was being browsed at capture time (background.js:878), not whose post this
 * is — and it is wrong for 24 of the 528 posts in the reference dataset.
 *
 * A genuine brand-x-brand collab returns two profiles. Callers must expect
 * membership counts to sum to more than the post count.
 */
function postProfiles(post) {
    const out = new Set();
    const owner = getOwner(post);
    if (owner) out.add(owner);
    getCoauthors(post).forEach(u => out.add(u));
    return out;
}

/** Unicode-aware hashtag parser. 413 of 528 reference posts carry hashtags, many Arabic. */
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

function _hashtags(caption) {
    if (!caption) return [];
    const found = String(caption).match(HASHTAG_RE);
    return found ? found.map(h => h.slice(1).toLowerCase()) : [];
}

function _taggedUsers(post) {
    const list = (post && post.tagged_users) || [];
    if (!Array.isArray(list)) return [];
    return list
        .map(t => (typeof t === 'string' ? t : t && t.username))
        .filter(Boolean);
}

/**
 * Grouped, lowercased searchable text for one post.
 *
 * Invariant: anything rendered on the post card (owner + coauthors) or in its
 * modal (tagged users) must be reachable from the 'all' scope.
 *
 * scrapedFromProfile is intentionally absent — see postProfiles().
 * sponsors / sponsor_tags exist on the schema but are empty across the whole
 * reference dataset, so they are not indexed.
 */
function getSearchIndex(post) {
    const usernames = new Set();
    const owner = getOwner(post);
    if (owner) usernames.add(owner.toLowerCase());
    getCoauthors(post).forEach(u => usernames.add(String(u).toLowerCase()));

    const tags = new Set();
    _taggedUsers(post).forEach(u => tags.add(String(u).toLowerCase()));
    _hashtags(post && post.caption).forEach(h => tags.add(h));

    return {
        usernames: [...usernames],
        tags: [...tags],
        caption: ((post && post.caption) || '').toLowerCase(),
        shortcode: ((post && post.shortcode) || '').toLowerCase(),
    };
}

/** Strip a leading @ or # so "@goalarabia", "goalarabia", "#goal" and "goal" all work. */
function normalizeQuery(query) {
    return String(query || '').trim().toLowerCase().replace(/^[@#]+/, '');
}

const SEARCH_SCOPES = ['all', 'username', 'tag', 'caption'];

/**
 * @param {object} post
 * @param {string} query    raw user input
 * @param {string} scope    one of SEARCH_SCOPES; anything else is treated as 'all'
 */
function matchesQuery(post, query, scope) {
    const q = normalizeQuery(query);
    if (!q) return true;

    const idx = getSearchIndex(post);
    const inUsernames = () => idx.usernames.some(u => u.includes(q));
    const inTags = () => idx.tags.some(t => t.includes(q));
    const inCaption = () => idx.caption.includes(q);

    switch (scope) {
        case 'username': return inUsernames();
        case 'tag':      return inTags();
        case 'caption':  return inCaption();
        default:
            return inUsernames() || inTags() || inCaption() || idx.shortcode.includes(q);
    }
}

/**
 * The set of profiles that get a campaign chip.
 *
 * Pass 1: every distinct scrapedFromProfile — the profiles actually browsed.
 * Pass 2: any post OWNER whose post is claimed by no pass-1 profile. This
 *         rescues competitor timelines captured during a campaign (e.g. the 12
 *         @moussyofficial posts mistagged as @barbicanworld) into their own
 *         chip instead of polluting the brand's, and guarantees every post is
 *         reachable from the chip bar.
 *
 * Profiles that only ever appear as coauthors do not get a chip — their posts
 * are already reachable via the brand they collaborated with.
 */
function buildProfileRoster(posts) {
    const roster = new Set();
    (posts || []).forEach(p => {
        if (p && p.scrapedFromProfile) roster.add(p.scrapedFromProfile);
    });

    (posts || []).forEach(p => {
        const profs = [...postProfiles(p)];
        if (profs.some(u => roster.has(u))) return;
        const owner = getOwner(p);
        if (owner) roster.add(owner);
    });

    return [...roster];
}

/**
 * Posts per profile, by the same membership rule the filter uses. A post with
 * two collaborators increments both, so the values can sum above posts.length.
 */
function countByProfile(posts, roster) {
    const counts = {};
    (roster || []).forEach(u => { counts[u] = 0; });
    (posts || []).forEach(p => {
        const profs = postProfiles(p);
        (roster || []).forEach(u => { if (profs.has(u)) counts[u]++; });
    });
    return counts;
}

const PostIndex = {
    getOwner, getCoauthors, postProfiles,
    getSearchIndex, matchesQuery, normalizeQuery, SEARCH_SCOPES,
    buildProfileRoster, countByProfile,
};

if (typeof globalThis !== 'undefined') {
    globalThis.PostIndex = PostIndex;
}
