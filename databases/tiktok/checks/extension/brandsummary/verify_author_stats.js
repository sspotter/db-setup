/**
 * Verifies that follower/following counts can be harvested from a TikTok
 * item_list response's authorStats — mirroring the extractPostData() logic in
 * extension/background.js. Run: node verify_author_stats.js
 */
const fs = require('fs');
const path = require('path');

function load(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
}

// Mirror of extension/background.js extractPostData() author-stats extraction.
function extractOwner(node) {
    const rawAuthor = node.author || {};
    const authorStats = node.authorStats || {};
    const authorStatsV2 = node.authorStatsV2 || {};
    const followerCount  = Number(authorStats.followerCount  ?? authorStatsV2.followerCount  ?? 0) || 0;
    const followingCount = Number(authorStats.followingCount ?? authorStatsV2.followingCount ?? 0) || 0;
    const videoCount     = Number(authorStats.videoCount     ?? authorStatsV2.videoCount     ?? 0) || 0;
    return {
        username: rawAuthor.uniqueId || null,
        nickname: rawAuthor.nickname || null,
        verified: rawAuthor.verified || false,
        follower_count: followerCount,
        following_count: followingCount,
        video_count: videoCount,
    };
}

let failures = 0;
function check(label, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '✅' : '❌'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

// ---- 1. chris.json: raw item_list API response ----
console.log('\n=== chris.json (raw item_list response) ===');
const chris = load('chris.json');
const chrisItems = chris.itemList || [];
console.log(`itemList length: ${chrisItems.length}`);

const owners = new Map();
for (const item of chrisItems) {
    const o = extractOwner(item);
    if (o.username && !owners.has(o.username)) owners.set(o.username, o);
}
for (const o of owners.values()) {
    console.log(`  @${o.username} → followers=${o.follower_count}, following=${o.following_count}, videos=${o.video_count}`);
}
const chrisOwner = owners.get('chris_mclean1fan');
check('chris_mclean1fan follower_count', chrisOwner?.follower_count, 297);
check('chris_mclean1fan following_count', chrisOwner?.following_count, 505);
check('every item yields a follower_count > 0',
    chrisItems.every(i => extractOwner(i).follower_count > 0), true);

// ---- 2. tiktok-collab.json: extension export (current state, pre-fix) ----
console.log('\n=== tiktok-collab.json (extension export) ===');
const collab = load('tiktok-collab.json');
console.log(`sourceUsername: ${collab.sourceUsername}, posts: ${(collab.posts || []).length}`);
const owner0 = (collab.posts || [])[0]?.owner;
console.log(`post[0].owner: ${JSON.stringify(owner0)}  ← follower_count "0" is the bug the fix addresses`);

console.log('\ncollabPartners follower data (what Potential Impressions reads):');
for (const cp of (collab.collabPartners || [])) {
    const known = Number(cp.followers) > 0;
    console.log(`  ${known ? '•' : '—'} @${cp.username}: followers=${cp.followers}, posts=${cp.postCount}, reach=${cp.calculated_reach}`);
}
console.log('\nAfter the fix, the owner (chris_mclean1fan) would carry follower_count=297 from authorStats,');
console.log('so its Potential Impressions = 297 × postCount instead of "—".');

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
