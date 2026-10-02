/**
 * Integration test for "newest observation wins" + honest sync results, against
 * a REAL Postgres. Skipped unless TEST_DATABASE_URL points at a throwaway DB —
 * it applies schema.sql and writes rows there.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/scratch_db npx jest observed
 */
const TEST_DB = process.env.TEST_DATABASE_URL;
const maybe = TEST_DB ? describe : describe.skip;

maybe('POST /api/posts — observed_at merge rules (real DB)', () => {
    let app, pool, request, userId, projectId;

    const T1 = Date.parse('2026-09-01T10:00:00Z');
    const T2 = Date.parse('2026-10-01T10:00:00Z');
    const T3 = Date.parse('2026-10-02T10:00:00Z');

    const post = (extra = {}) => ({
        shortcode: 'OBS1',
        owner: { username: 'obs_brand', follower_count: 806481 },
        likes: 63, comments: 4, views: 100,
        classification: 'Normal Post', type: 'normal',
        timestamp: 1790788541,
        ...extra,
    });
    const sync = (posts) => request(app).post('/api/posts').send({ posts, project_id: projectId });
    const latest = async () => (await pool.query(
        `SELECT likes_count, video_view_count FROM post_metrics_history WHERE post_shortcode = 'OBS1'
         ORDER BY observed_at DESC NULLS LAST, captured_at DESC LIMIT 1`)).rows[0];
    const followers = async () => Number((await pool.query(
        `SELECT follower_count FROM ig_users WHERE username = 'obs_brand'`)).rows[0].follower_count);

    beforeAll(async () => {
        process.env.LOCAL_DATABASE_URL = TEST_DB; // db.js reads this first
        const fs = require('fs');
        const path = require('path');
        const express = require('express');
        request = require('supertest');
        pool = require('../db');

        // Start from an empty schema every run. Guard: this wipes the database.
        const dbName = (await pool.query('SELECT current_database() AS d')).rows[0].d;
        if (!/test/i.test(dbName)) throw new Error(`Refusing to reset "${dbName}": name must contain "test"`);
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

        await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));
        userId = (await pool.query(
            `INSERT INTO users (email, password_hash) VALUES ('obs-test@example.com', 'x') RETURNING id`)).rows[0].id;
        projectId = (await pool.query(
            `INSERT INTO projects (user_id, name) VALUES ($1, 'obs') RETURNING id`, [userId])).rows[0].id;

        app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.user = { id: userId }; next(); });
        app.use('/api', require('../routes/posts'));
    });

    afterAll(async () => { if (pool) await pool.end(); });

    test('an older copy synced later does not become the latest metrics', async () => {
        expect((await sync([post({ observedAt: T2 })])).body.success).toBe(true);
        await sync([post({ observedAt: T1, likes: 54 })]);           // stale copy, synced after
        expect((await latest()).likes_count).toBe(63);
        expect((await latest()).video_view_count).toBe(100);         // `views` is stored now
    });

    test('an unstamped (old client) copy never beats a stamped one', async () => {
        await sync([post({ likes: 10 })]);
        expect((await latest()).likes_count).toBe(63);
    });

    test('re-syncing the same observation adds no history row', async () => {
        const count = async () => Number((await pool.query(
            `SELECT COUNT(*) FROM post_metrics_history WHERE post_shortcode = 'OBS1' AND observed_at IS NOT NULL`)).rows[0].count);
        const before = await count();
        await sync([post({ observedAt: T2 })]);
        expect(await count()).toBe(before);
    });

    test('follower count: newest wins, so it can go DOWN; stale and 0 never overwrite', async () => {
        expect(await followers()).toBe(806481);
        await sync([post({ observedAt: T1, owner: { username: 'obs_brand', follower_count: 900000 } })]);
        expect(await followers()).toBe(806481);                      // older observation ignored
        await sync([post({ observedAt: T3, owner: { username: 'obs_brand', follower_count: 800000 } })]);
        expect(await followers()).toBe(800000);                      // brand lost followers
        await sync([post({ observedAt: T3 + 1000, owner: { username: 'obs_brand', follower_count: 0 } })]);
        expect(await followers()).toBe(800000);                      // 0 = unknown
    });

    test('concatenated reach is never stored; newer reach replaces older', async () => {
        await sync([post({ shortcode: 'OBS2', observedAt: T1, collectiveReach: '0828654806440' })]);
        const reach = async () => Number((await pool.query(
            `SELECT collective_reach FROM posts WHERE shortcode = 'OBS2'`)).rows[0].collective_reach);
        expect(await reach()).toBe(0);
        await sync([post({ shortcode: 'OBS2', observedAt: T2, collectiveReach: 1635135 })]);
        expect(await reach()).toBe(1635135);
        await sync([post({ shortcode: 'OBS2', observedAt: T1, collectiveReach: 999 })]);
        expect(await reach()).toBe(1635135);
    });

    test('a post that fails is reported in errors[] by shortcode, the rest are stored', async () => {
        // Same pk as an existing account under a new username (an Instagram rename)
        // violates the ig_users primary key — the known #4 failure.
        // NOTE: when todo step 3 fixes renames, swap this for another per-post
        // failure trigger (e.g. a value that overflows an int column).
        await pool.query(`INSERT INTO ig_users (id, username) VALUES ('pk-777', 'old_name') ON CONFLICT DO NOTHING`);
        const res = await sync([
            post({ shortcode: 'OBS3', observedAt: T2 }),
            post({ shortcode: 'OBS4', observedAt: T2, owner: { pk: 'pk-777', username: 'new_name', follower_count: 5 } }),
        ]);
        expect(res.body.success).toBe(true);
        expect(res.body.skipped).toBe(1);
        expect(res.body.errors.map(e => e.shortcode)).toEqual(['OBS4']);
    });
});
