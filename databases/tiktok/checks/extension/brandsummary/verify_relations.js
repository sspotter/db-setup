/**
 * Verifies mention/hashtag extraction from textExtra — mirroring the updated
 * extractPostData() logic in extension/background.js. Run: node verify_relations.js
 */
const fs = require('fs');
const path = require('path');
const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, n), 'utf8'));

// Mirror of extension/background.js textExtra parsing.
function extractRelations(node) {
    const username = node.author?.uniqueId || null;
    const hashtags = [], mentions = [], taggedUsers = [];
    if (Array.isArray(node.textExtra)) {
        for (const extra of node.textExtra) {
            if (extra.hashtagName) {
                if (!hashtags.includes(extra.hashtagName)) hashtags.push(extra.hashtagName);
            } else if (extra.userUniqueId && extra.userUniqueId !== username) {
                if (!mentions.includes(extra.userUniqueId)) {
                    mentions.push(extra.userUniqueId);
                    taggedUsers.push({ username: extra.userUniqueId, id: extra.userId || extra.userUniqueId, sec_uid: extra.secUid || null });
                }
            }
        }
    }
    return { hashtags, mentions, taggedUsers };
}

let failures = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    const ok = a === e;
    if (!ok) failures++;
    console.log(`  ${ok ? '✅' : '❌'} ${label}: ${a}${ok ? '' : ` (expected ${e})`}`);
};

// ---- 1. Real item from chris.json with a mention + hashtags ----
console.log('\n=== chris.json: mention + hashtags from textExtra ===');
const chris = load('chris.json');
const mentionItem = chris.itemList.find(it => (it.textExtra || []).some(t => t.userUniqueId));
const r1 = extractRelations(mentionItem);
console.log(`  desc: ${mentionItem.desc.slice(0, 50)}`);
console.log(`  → mentions=${JSON.stringify(r1.mentions)}, hashtags=${JSON.stringify(r1.hashtags)}`);
check('mention captured as tagged_user', r1.taggedUsers[0]?.username, 'its_just_zoe13');
check('hashtags include disventurecamp', r1.hashtags.includes('disventurecamp'), true);

// ---- 2. Synthetic item mirroring the @elyalwaal collab post (Arabic) ----
console.log('\n=== synthetic: @elyalwaal collab post (Arabic mention + hashtag) ===');
const elyalwaal = {
    author: { uniqueId: 'elyalwaal' },
    desc: '@Drink Rani جاهزين نرج العالم؟ #بنرج_العالم',
    textExtra: [
        { type: 0, userUniqueId: 'drinkrani', userId: '6811830447887352837', secUid: 'MS4wAbc', hashtagName: '' },
        { type: 1, hashtagName: 'بنرج_العالم' },
    ],
};
const r2 = extractRelations(elyalwaal);
console.log(`  → mentions=${JSON.stringify(r2.mentions)}, hashtags=${JSON.stringify(r2.hashtags)}`);
check('collab @drinkrani captured', r2.taggedUsers[0]?.username, 'drinkrani');
check('Arabic hashtag captured', r2.hashtags[0], 'بنرج_العالم');
check('post classified as collab (hasTags)', r2.taggedUsers.length > 0, true);

// ---- 3. Unicode-aware caption hashtag regex (content.js card scraper) ----
console.log('\n=== Unicode caption hashtag regex ===');
const caption = 'check this #بنرج_العالم #fyp #diaryofawimpykid';
const tags = (caption.match(/#([\p{L}\p{N}_]+)/gu) || []).map(t => t.slice(1).toLowerCase());
console.log(`  → ${JSON.stringify(tags)}`);
check('regex captures Arabic + Latin tags', tags, ['بنرج_العالم', 'fyp', 'diaryofawimpykid']);

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
