// Plain-node test for PostIndex. Run from extension/: node utils/post_index.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('./post_index.js');
const PI = globalThis.PostIndex;

const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'posts_sample.json'), 'utf8')
);
const POSTS = fixture.posts;
const byCode = (code) => POSTS.filter(p => p.shortcode === code)[0];

// --- getOwner ---
assert.strictEqual(PI.getOwner(byCode('P1')), 'barbicanworld');
assert.strictEqual(PI.getOwner(byCode('P2')), 'kooora');
assert.strictEqual(PI.getOwner({}), null, 'empty post has no owner');
assert.strictEqual(
    PI.getOwner({ caption_user: { username: 'fallbackuser' } }),
    'fallbackuser',
    'falls back to caption_user'
);

// --- getCoauthors ---
assert.deepStrictEqual(PI.getCoauthors(byCode('P2')), ['barbicanworld', 'goalarabia']);
assert.deepStrictEqual(PI.getCoauthors(byCode('P1')), []);
assert.deepStrictEqual(PI.getCoauthors({}), [], 'missing post fields do not throw');
assert.deepStrictEqual(
    PI.getCoauthors({ coauthor_producers: [{ username: 'aliasonly' }] }),
    ['aliasonly'],
    'reads the coauthor_producers alias'
);
assert.deepStrictEqual(
    PI.getCoauthors({ coauthors: ['stringform'] }),
    ['stringform'],
    'accepts bare strings'
);

// --- postProfiles: owner OR coauthor, never scrapedFromProfile ---
assert.deepStrictEqual([...PI.postProfiles(byCode('P2'))].sort(),
    ['barbicanworld', 'goalarabia', 'kooora']);
assert.deepStrictEqual([...PI.postProfiles(byCode('P3'))], ['moussyofficial'],
    'a mistagged reference post does NOT belong to its scrapedFromProfile');
assert.deepStrictEqual([...PI.postProfiles(byCode('P4'))].sort(),
    ['barbicanworld', 'moussyarabia'], 'a collab post belongs to both parties');

// --- getSearchIndex ---
const idx2 = PI.getSearchIndex(byCode('P2'));
assert.deepStrictEqual(idx2.usernames.sort(), ['barbicanworld', 'goalarabia', 'kooora']);
assert.deepStrictEqual(idx2.tags, []);
assert.strictEqual(idx2.caption, 'match highlights');
assert.strictEqual(idx2.shortcode, 'p2', 'index is lowercased');

const idx1 = PI.getSearchIndex(byCode('P1'));
assert.deepStrictEqual(idx1.tags.sort(), ['football', 'ماتش'],
    'hashtags are parsed from the caption, including non-Latin scripts');

const idx6 = PI.getSearchIndex(byCode('P6'));
assert.deepStrictEqual(idx6.tags, ['goalarabia'], 'tagged_users land in the tag scope');

// --- matchesQuery: the reported bug ---
const match = (post, q, scope) => PI.matchesQuery(post, q, scope);

assert.strictEqual(match(byCode('P2'), 'goalarabia', 'all'), true,
    'REGRESSION: a post is findable by its 2nd/3rd collaborator');
assert.strictEqual(match(byCode('P2'), 'goal', 'username'), true);
assert.strictEqual(match(byCode('P2'), 'goal', 'tag'), false,
    'a coauthor is not a tag');
assert.strictEqual(match(byCode('P6'), 'goal', 'tag'), true,
    'a tagged user is a tag');
assert.strictEqual(match(byCode('P6'), 'goal', 'username'), false,
    'a tagged user is not a username');
assert.strictEqual(match(byCode('P1'), 'ماتش', 'tag'), true,
    'caption hashtags are searchable in tag scope');
assert.strictEqual(match(byCode('P2'), 'highlights', 'caption'), true);
assert.strictEqual(match(byCode('P2'), 'highlights', 'username'), false);
assert.strictEqual(match(byCode('P2'), 'p2', 'all'), true, 'shortcode is in All');
assert.strictEqual(match(byCode('P2'), 'p2', 'caption'), false,
    'shortcode is NOT in the narrow scopes');

// query normalisation
assert.strictEqual(match(byCode('P2'), '@goalarabia', 'username'), true, 'leading @ is stripped');
assert.strictEqual(match(byCode('P1'), '#football', 'tag'), true, 'leading # is stripped');
assert.strictEqual(match(byCode('P2'), '  GOAL  ', 'all'), true, 'trimmed + case-insensitive');
assert.strictEqual(match(byCode('P2'), '', 'username'), true, 'empty query matches everything');

// invariant: anything the card renders is findable in All scope
POSTS.forEach(p => {
    [...PI.postProfiles(p)].forEach(u => {
        assert.strictEqual(match(p, u, 'all'), true,
            `card renders @${u} on ${p.shortcode} but All scope cannot find it`);
    });
});

// --- buildProfileRoster ---
const roster = PI.buildProfileRoster(POSTS);
assert.deepStrictEqual(roster.sort(), ['barbicanworld', 'moussyarabia', 'moussyofficial'].sort(),
    'browsed profiles, plus moussyofficial rescued from being unattributed');
assert.strictEqual(roster.includes('goalarabia'), false,
    'coauthor-only profiles do not get their own chip');
assert.strictEqual(roster.includes('kooora'), false,
    'an owner already covered by a coauthor chip does not get its own');

// --- countByProfile ---
const counts = PI.countByProfile(POSTS, roster);
assert.strictEqual(counts.barbicanworld, 6, 'P1,P2,P4,P6,P7 + the P1 duplicate');
assert.strictEqual(counts.moussyarabia, 2, 'P4,P5');
assert.strictEqual(counts.moussyofficial, 1, 'P3');

// every post reachable from at least one chip
POSTS.forEach(p => {
    const profs = [...PI.postProfiles(p)];
    assert.ok(profs.some(u => roster.includes(u)),
        `post ${p.shortcode} is not reachable from any chip`);
});

// overlap is intended: P4 belongs to two chips, so counts exceed the post count
const sum = Object.values(counts).reduce((a, b) => a + b, 0);
assert.strictEqual(sum, POSTS.length + 1, 'exactly one post (P4) is double-counted');

console.log('post_index: all assertions passed');
