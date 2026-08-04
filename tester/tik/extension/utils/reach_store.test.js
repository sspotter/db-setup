// Plain-node test for ReachStore. Run: node utils/reach_store.test.js
const assert = require('assert');

// --- Mock chrome.storage.local (in-memory) ---
let _data = {};
global.chrome = {
    storage: {
        local: {
            get: (keys, cb) => {
                const out = {};
                (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in _data) out[k] = _data[k]; });
                cb(out);
            },
            set: (obj, cb) => { Object.assign(_data, obj); if (cb) cb(); },
        },
    },
};

require('./reach_store.js');
const RS = globalThis.ReachStore;

// Sample calculateCollectiveReach-style partners list (uses a Set for `sources`)
const partnersList = [
    { username: 'ikeakuwait', followers: 803726, postCount: 948, is_verified: true, sources: new Set(['Owner']) },
    { username: 'vo_kuwait', followers: 110900, postCount: 12, is_verified: true, sources: new Set(['Co-author']) },
];

(async () => {
    // buildAggregate maps partners -> persisted shape
    const agg = RS.buildAggregate(partnersList, 'ikeakuwait', { projectId: 'proj1', collabCount: 98, paidCount: 5 });
    assert.strictEqual(agg.brand.username, 'ikeakuwait');
    assert.strictEqual(agg.brand.impressions, 803726 * 948);
    assert.strictEqual(agg.partners.length, 1);
    assert.strictEqual(agg.partners[0].collabCount, 12);
    assert.strictEqual(agg.totals.collabPosts, 98);
    assert.ok(typeof agg.computedAt === 'number');

    // save + get round-trip, scoped
    await RS.saveAggregate('proj1', agg);
    const got = await RS.getAggregate('proj1');
    assert.strictEqual(got.brand.username, 'ikeakuwait');
    assert.strictEqual(await RS.getAggregate('proj2'), null); // scope isolation

    // toPartnersList reconstructs a renderable list + stats
    const { partnersList: rebuilt, stats } = RS.toPartnersList(got);
    assert.strictEqual(rebuilt.length, 2);
    const brand = rebuilt.find(p => p.username === 'ikeakuwait');
    assert.strictEqual(brand.postCount, 948);
    assert.ok(brand.sources.has('Owner'));           // mainUser detection needs this
    assert.strictEqual(stats.collabCount, 98);

    // buildAggregate falls back to the Owner-tagged item when mainUsername is null
    const aggNoMain = RS.buildAggregate(partnersList, null, { projectId: 'proj1' });
    assert.strictEqual(aggNoMain.brand.username, 'ikeakuwait'); // recovered via sources.has('Owner')
    assert.strictEqual(aggNoMain.partners.length, 1);
    assert.strictEqual(aggNoMain.partners[0].username, 'vo_kuwait');

    // clearAggregate removes only that scope
    await RS.saveAggregate('proj2', agg);
    await RS.clearAggregate('proj1');
    assert.strictEqual(await RS.getAggregate('proj1'), null);
    assert.notStrictEqual(await RS.getAggregate('proj2'), null);

    // clear wipes everything
    await RS.clear();
    assert.strictEqual(await RS.getAggregate('proj2'), null);

    console.log('✅ reach_store.test.js passed');
})().catch(e => { console.error('❌', e); process.exit(1); });
