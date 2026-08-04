// Plain-node test for DataAudit. Run from extension/: node utils/data_audit.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('./post_index.js');
require('./data_audit.js');
const DA = globalThis.DataAudit;

const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'posts_sample.json'), 'utf8')
);
const POSTS = fixture.posts;
const PROFILES = fixture.scrapedProfiles;

// A partners list matching what calculateCollectiveReach produces for this
// fixture (owner + coauthors, one increment per post per profile).
const GOOD_PARTNERS = [
    { username: 'barbicanworld', postCount: 6 },
    { username: 'moussyarabia', postCount: 2 },
    { username: 'moussyofficial', postCount: 1 },
    { username: 'kooora', postCount: 1 },
    { username: 'goalarabia', postCount: 1 },
    { username: 'theafchub', postCount: 1 },
    { username: 'alayyadah', postCount: 1 },
];

const report = DA.runAudit(POSTS, PROFILES, GOOD_PARTNERS);
const find = (id) => report.checks.find(c => c.id === id);

assert.strictEqual(find('attribution').count, 2, 'P3 and P5 are mis-bucketed');
assert.deepStrictEqual(find('attribution').items.map(i => i.shortcode).sort(), ['P3', 'P5']);

assert.strictEqual(find('missing_followers').count, 4,
    'kooora, goalarabia, theafchub, alayyadah have no follower data');
assert.deepStrictEqual(find('missing_followers').items.map(i => i.username).sort(),
    ['alayyadah', 'goalarabia', 'kooora', 'theafchub']);

assert.strictEqual(find('collab_untyped').count, 1, 'P7 has a coauthor but type "normal"');
assert.strictEqual(find('collab_empty').count, 0);
assert.strictEqual(find('alias_drift').count, 4,
    'P2,P4,P6,P7 carry coauthors but no coauthor_producers alias');
assert.strictEqual(find('multi_collab').count, 1, 'P2 has 2 coauthors');
assert.strictEqual(find('duplicates').count, 1, 'P1 appears twice');
assert.strictEqual(find('missing_fields').count, 0);
assert.strictEqual(find('invariant').count, 0, 'chip count === reach postCount for all');

// The invariant check must be able to FAIL — otherwise it proves nothing.
const skewed = GOOD_PARTNERS.map(p =>
    p.username === 'barbicanworld' ? { ...p, postCount: 316 } : p);
const skewedReport = DA.runAudit(POSTS, PROFILES, skewed);
const skewedInvariant = skewedReport.checks.find(c => c.id === 'invariant');
assert.strictEqual(skewedInvariant.count, 1, 'a reach/chip disagreement is detected');
assert.deepStrictEqual(skewedInvariant.items[0],
    { username: 'barbicanworld', chipCount: 6, reachPostCount: 316 });

// Without a partners list the check reports itself skipped, not passing.
assert.ok(DA.runAudit(POSTS, PROFILES).checks
    .find(c => c.id === 'invariant').note.includes('Skipped'));

// a check that throws is reported, not fatal
const bad = DA.runAudit([null, undefined], PROFILES, []);
assert.ok(Array.isArray(bad.checks), 'audit survives garbage input');

// summary
assert.strictEqual(report.totalPosts, 8);
assert.strictEqual(report.issueCount, 2 + 4 + 1 + 4 + 1,
    'attribution + followers + untyped + alias + dupes; multi_collab is info, not an issue');

// --- invariant: the partners list is scoped to the FILTERED posts ---
// options.js calls calculateCollectiveReach(filteredPosts), so postCount is
// per-filter while the chip bar counts over every post. Comparing the two
// directly reports a false failure whenever a filter is active, so the basis
// the partners list was built from must be passed in.
const SUBSET = POSTS.filter(p => p.shortcode === 'P1' || p.shortcode === 'P2');
const SUBSET_PARTNERS = [
    { username: 'barbicanworld', postCount: 3 }, // P1, P2, and the P1 duplicate
    { username: 'kooora', postCount: 1 },
    { username: 'goalarabia', postCount: 1 },
];

const filteredOk = DA.runAudit(POSTS, PROFILES, SUBSET_PARTNERS, SUBSET);
assert.strictEqual(filteredOk.checks.find(c => c.id === 'invariant').count, 0,
    'a filter-scoped partners list is compared against the same scoped posts');

const filteredWrong = DA.runAudit(POSTS, PROFILES, SUBSET_PARTNERS);
assert.ok(filteredWrong.checks.find(c => c.id === 'invariant').count > 0,
    'without the basis, a scoped partners list is wrongly compared to all posts');

// The basis defaults to the audited posts, so the unscoped call is unchanged.
assert.strictEqual(
    DA.runAudit(POSTS, PROFILES, GOOD_PARTNERS, POSTS).checks
        .find(c => c.id === 'invariant').count, 0);

// --- applyFixes ---
const clone = JSON.parse(JSON.stringify(POSTS));
// P2 gets a genuinely drifted alias (1 entry vs the 2 in coauthors);
// P4, P6 and P7 are missing the alias entirely.
clone[1].coauthor_producers = [{ username: 'barbicanworld' }];
const summary = DA.applyFixes(clone, PROFILES);

assert.strictEqual(summary.aliasesSynced, 4,
    'P2 drifted; P4, P6, P7 had no coauthor_producers alias at all');
assert.deepStrictEqual(
    clone[1].coauthor_producers.map(c => c.username),
    ['barbicanworld', 'goalarabia'],
    'coauthor_producers is rebuilt from coauthors'
);

assert.ok(summary.followersBackfilled >= 1, 'known follower counts are backfilled');
const p2 = clone.find(p => p.shortcode === 'P2');
const bw = (p2.coauthors || []).find(c => c.username === 'barbicanworld');
assert.strictEqual(bw.follower_count, 37597, 'backfilled from scrapedProfiles');

assert.deepStrictEqual(summary.changed.sort(), ['P2', 'P4', 'P6', 'P7'],
    'only posts whose stored fields changed are queued for persisting');
assert.strictEqual(summary.changed.includes('P1'), false,
    'a post with nothing to fix is never written back');

assert.ok(summary.reachRecomputed > 0, 'per-post reach is recomputed');
assert.ok(Array.isArray(p2.reachBreakdown), 'reachBreakdown is written back');
assert.strictEqual(typeof p2.collectiveReach, 'number');

// applyFixes must never invent follower counts it does not have
const stillMissing = DA.runAudit(clone, PROFILES).checks
    .find(c => c.id === 'missing_followers');
assert.deepStrictEqual(stillMissing.items.map(i => i.username).sort(),
    ['alayyadah', 'goalarabia', 'kooora', 'theafchub'],
    'unknown profiles stay unknown — no fabricated numbers');

console.log('data_audit: all assertions passed');
