/**
 * Replays the moussyarabia case against a REAL Postgres: a stale 12,500 stored, a real 6,296
 * captured on Instagram. Skipped unless TEST_DATABASE_URL points at a throwaway database whose
 * name contains "test" and which already has schema_latest.sql loaded.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/scratch_test npx jest users_followers
 */
const TEST_DB = process.env.TEST_DATABASE_URL;
const maybe = TEST_DB ? describe : describe.skip;

maybe('ig_users follower count from POST /api/users and /api/posts (real DB)', () => {
    let app, pool, request, userId, projectId;
    const NAME = 'followers_case';
    const captured = { id: '1', username: NAME, follower_count: 6296, following_count: 3, media_count: 225, latest_post_timestamp: 1790000000, role: 'root' };
    const echoed = (count) => ({ ...captured, follower_count: count, scraped_at: '2026-11-05T06:09:29Z', added_to_project: '2026-07-31T12:27:21Z', observed_at: null });
    const saveUsers = (users) => request(app).post('/api/users').send({ users, project_id: projectId });
    const savePost = (count) => request(app).post('/api/posts').send({
        project_id: projectId,
        posts: [{ shortcode: 'FOLLOW1', owner: { username: NAME, follower_count: count }, likes: 1, comments: 0, classification: 'Normal Post', type: 'normal', timestamp: 1790788541 }],
    });
    const followers = async () => Number((await pool.query('SELECT follower_count FROM ig_users WHERE username = $1', [NAME])).rows[0].follower_count);

    beforeAll(async () => {
        process.env.LOCAL_DATABASE_URL = TEST_DB; // db.js reads this first
        const express = require('express');
        request = require('supertest');
        pool = require('../db');
        const dbName = (await pool.query('SELECT current_database() AS d')).rows[0].d;
        if (!/test/i.test(dbName)) throw new Error(`Refusing to write to "${dbName}": name must contain "test"`);
        userId = (await pool.query(`INSERT INTO users (email, password_hash) VALUES ('followers-test@example.com', 'x') RETURNING id`)).rows[0].id;
        projectId = (await pool.query(`INSERT INTO projects (user_id, name) VALUES ($1, 'followers') RETURNING id`, [userId])).rows[0].id;
        app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.user = { id: userId }; next(); });
        app.use('/api', require('../routes/users'));
        app.use('/api', require('../routes/posts'));
        // The stale state on the live row: 12,500 with no observation time.
        await pool.query(`INSERT INTO ig_users (id, username, follower_count, role) VALUES ('1', $1, 12500, 'root')`, [NAME]);
    });

    afterAll(async () => { if (pool) await pool.end(); });

    test('a mixed post batch saves the Instagram posts and reports the TikTok ones as skipped', async () => {
        const owner = { username: 'mixed_owner', follower_count: 10 };
        const base = { owner, likes: 1, comments: 0, classification: 'Normal Post', type: 'normal', timestamp: 1790788541 };
        const res = await request(app).post('/api/posts').send({
            project_id: projectId,
            posts: [
                { ...base, shortcode: 'MIXIG1', postUrl: 'https://www.instagram.com/p/MIXIG1/' },
                { ...base, shortcode: '7657591518504439047', postUrl: 'https://www.tiktok.com/@mixed_owner/video/7657591518504439047' },
            ],
        });
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.skipped_other_platform).toBe(1);
        const saved = await pool.query(`SELECT shortcode FROM posts WHERE shortcode IN ('MIXIG1', '7657591518504439047')`);
        expect(saved.rows.map((r) => r.shortcode)).toEqual(['MIXIG1']);
    });

    test('a fresh capture replaces the stale higher count', async () => {
        expect(await followers()).toBe(12500);
        await saveUsers([captured]);
        expect(await followers()).toBe(6296);
    });

    test('posts still holding the old count cannot push it back', async () => {
        await savePost(12500);
        expect(await followers()).toBe(6296);
    });

    test('a row echoed from the backend with the old count cannot push it back', async () => {
        await saveUsers([echoed(12500)]);
        expect(await followers()).toBe(6296);
    });

    test('a later capture still moves it, up or down, and 0 is ignored', async () => {
        await saveUsers([{ ...captured, follower_count: 7000 }]);
        expect(await followers()).toBe(7000);
        await saveUsers([{ ...captured, follower_count: 6500 }]);
        expect(await followers()).toBe(6500);
        await saveUsers([{ ...captured, follower_count: 0 }]);
        expect(await followers()).toBe(6500);
    });
});
