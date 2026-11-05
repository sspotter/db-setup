const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const adminUserOverview = require('../../routes/adminUserOverview');

const app = express();
app.use(express.json());
app.use('/api/admin', adminUserOverview);

const USER = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJ = '33333333-3333-4333-8333-333333333333';
const url = (q = '') => `/api/admin/users/${USER}/overview${q}`;
const admin = (r) => r.set('x-admin-password', 'admin-test');

// Fixture: 3 project posts. p3 is hidden, p4 is soft-deleted; p1 is the only plain one.
// Likes 10 + 5 + 100 (hidden) ; comments 1 + 2 + 20 (hidden); p4 has 7 likes (deleted).
const POSTS = [
    { shortcode: 'p1', post_row: 'p1', owner_username: 'alice', posted_at: '2026-01-03T00:00:00Z', likes: '10', comments: '1', views: '100', reposts: 0, shares: 2, bookmarks: 3, post_view_count: '0', pp_hidden: false, pp_deleted_at: null, post_deleted_at: null, foreign_url: false },
    { shortcode: 'p2', post_row: 'p2', owner_username: 'bob', posted_at: '2026-01-02T00:00:00Z', likes: '5', comments: '2', views: '50', reposts: 1, shares: 0, bookmarks: 0, post_view_count: '0', pp_hidden: false, pp_deleted_at: null, post_deleted_at: null, foreign_url: false },
    { shortcode: 'p3', post_row: 'p3', owner_username: 'alice', posted_at: '2026-01-01T00:00:00Z', likes: '100', comments: '20', views: '1000', reposts: 0, shares: 0, bookmarks: 0, post_view_count: '0', pp_hidden: true, pp_deleted_at: null, post_deleted_at: null, foreign_url: false },
    { shortcode: 'p4', post_row: 'p4', owner_username: 'bob', posted_at: null, likes: '7', comments: '0', views: '0', reposts: 0, shares: 0, bookmarks: 0, post_view_count: '0', pp_hidden: false, pp_deleted_at: '2026-02-01T00:00:00Z', post_deleted_at: null, foreign_url: false },
];
const CREATORS = [
    { username: 'alice', posts_involved: '2', follower_count: '1000', scraped_at: '2026-01-05T00:00:00Z', role: 'brand', adds: '2' },
    { username: 'bob', posts_involved: '2', follower_count: '1234', scraped_at: null, role: 'competitor', adds: '2' },
];

function dbError(code) { const e = new Error(code); e.code = code; return e; }

// Routes each query by its SQL text, so the order of the route's queries does not matter.
function mockDb(over = {}) {
    const handlers = {
        user: () => ({ rows: [{ id: USER, email: 'nadine@example.com', status: 'active', plan: 'pro', active_sessions: 1, last_login: '2026-03-01T00:00:00Z', max_devices: 3, created_at: '2025-01-01T00:00:00Z', plan_expires_at: null, trial_ends_at: null, password_hash: 'HASH-MUST-NOT-LEAK' }] }),
        projects: () => ({ rows: [{ id: PROJ, name: 'Barbican', created_at: '2025-02-01T00:00:00Z', posts: 4, profiles: 2 }] }),
        posts: () => ({ rows: POSTS }),
        creators: () => ({ rows: CREATORS }),
        creatorsClean: () => ({ rows: [{ follower_count: '1000', posts_involved: '1' }, { follower_count: '1234', posts_involved: '1' }] }),
        kwSummary: () => ({ rows: [{ total_videos: '5', total_views: '900', potential_reach: '400' }] }),
        kwRows: () => ({ rows: [{ keyword: 'tea', videos: '5', reach_videos: '4', reach_views: '400', hidden_reach_videos: '1', hidden_reach_views: '150' }] }),
        comments: () => ({ rows: [{ shortcode: 'p1', stored: '3' }] }),
        audit: () => ({ rows: [{ created_at: '2026-03-02T00:00:00Z', actor: 'shared-password', action: 'user_update', detail: { plan: 'pro', token: 'SECRET-TOKEN' } }] }),
        events: () => ({ rows: [{ created_at: '2026-03-03T00:00:00Z', method: 'POST', path: '/api/posts', status: 200, reason: 'foreign_posts_skipped', error: null }] }),
        saved: () => ({ rows: [] }),
        guard: () => ({ rows: [{ skipped: '2', refused: '1', last_at: '2026-03-03T00:00:00Z' }] }),
        logins: () => ({ rows: [{ created_at: '2026-03-04T00:00:00Z', ip: '1.2.3.4', user_agent: 'UA', ext_version: '1.0' }] }),
        ...over,
    };
    pool.query.mockImplementation(async (sql) => {
        const s = String(sql);
        let key;
        if (/FROM users WHERE id/.test(s)) key = 'user';
        else if (/FROM projects pr/.test(s)) key = 'projects';
        else if (/FROM project_posts ppo\s+LEFT JOIN posts p/.test(s)) key = 'posts';
        else if (/WITH project_posts_cte/.test(s)) key = /ppo\.is_hidden = false/.test(s) ? 'creatorsClean' : 'creators';
        else if (/FROM search_keywords WHERE/.test(s)) key = 'kwSummary';
        else if (/FROM tiktok_videos tv/.test(s)) key = 'kwRows';
        else if (/FROM comments c/.test(s)) key = 'comments';
        else if (/FROM admin_audit/.test(s)) key = 'audit';
        else if (/FROM user_scraped_posts/.test(s)) key = 'saved';
        else if (/foreign_posts_skipped'\) AS skipped/.test(s)) key = 'guard';
        else if (/reason = 'success'/.test(s)) key = 'logins';
        else if (/FROM api_events/.test(s)) key = 'events';
        else throw new Error(`unexpected query: ${s.slice(0, 80)}`);
        const h = handlers[key];
        if (h instanceof Error) throw h;
        return h(s);
    });
}

const metricOf = (body, key) => body.metrics.find((m) => m.key === key);
const warningCodes = (body) => body.warnings.map((w) => w.code);

describe('GET /api/admin/users/:id/overview', () => {
    beforeEach(() => { jest.clearAllMocks(); mockDb(); });

    it('requires the admin password and touches no database', async () => {
        const res = await request(app).get(url());
        expect(res.status).toBe(401);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('404s for an unknown user', async () => {
        mockDb({ user: () => ({ rows: [] }) });
        const res = await admin(request(app).get(url()));
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'User not found' });
    });

    it('404s for a malformed user id without querying', async () => {
        const res = await admin(request(app).get('/api/admin/users/nope/overview'));
        expect(res.status).toBe(404);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('404s when project_id is not one of this user\'s projects, or is malformed', async () => {
        const other = await admin(request(app).get(url(`?project_id=${OTHER_PROJ}`)));
        expect(other.status).toBe(404);
        const bad = await admin(request(app).get(url('?project_id=nope')));
        expect(bad.status).toBe(404);
    });

    it('returns the agreed top-level shape and defaults to the first project', async () => {
        const res = await admin(request(app).get(url()));
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual([
            'breakdowns', 'browser_only', 'creators', 'metrics', 'platform', 'posts', 'projects',
            'save_history', 'selected_project_id', 'sessions', 'success', 'user', 'warnings',
        ]);
        expect(res.body.platform).toBe('tiktok');
        expect(res.body.selected_project_id).toBe(PROJ);
        expect(res.body.user.email).toBe('nadine@example.com');
        for (const m of res.body.metrics) {
            expect(m.breakdown === null || res.body.breakdowns[m.breakdown]).toBeTruthy();
        }
    });

    it('never includes password hashes, tokens or secrets', async () => {
        const res = await admin(request(app).get(url(`?project_id=${PROJ}`)));
        const text = JSON.stringify(res.body);
        expect(text).not.toMatch(/HASH-MUST-NOT-LEAK|SECRET-TOKEN|password_hash/);
        expect(res.body.user).not.toHaveProperty('password_hash');
    });

    it('only issues SELECT statements', async () => {
        await admin(request(app).get(url()));
        for (const [sql] of pool.query.mock.calls) {
            expect(String(sql).trim()).toMatch(/^(SELECT|WITH)\b/i);
            expect(String(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
        }
    });

    it('computes the metrics with the app formulas on the fixture', async () => {
        const { body } = await admin(request(app).get(url()));
        expect(metricOf(body, 'posts').value).toBe(4);
        expect(metricOf(body, 'likes').value).toBe(122);
        expect(metricOf(body, 'comments').value).toBe(23);
        expect(metricOf(body, 'views').value).toBe(1150);
        expect(metricOf(body, 'shares').value).toBe(2);
        expect(metricOf(body, 'reposts').value).toBe(1);
        expect(metricOf(body, 'bookmarks').value).toBe(3);
        expect(metricOf(body, 'engagement').value).toBe(145);
        expect(metricOf(body, 'avg_epm').value).toBe(36.3); // ROUND(145 / 4, 1)
        // followers x posts: 1000 x 2 + 1234 x 2
        expect(metricOf(body, 'potential_impressions').value).toBe(4468);
        expect(metricOf(body, 'keyword_potential_reach').value).toBe(400);
        expect(metricOf(body, 'comments_stored').value).toBe(3);
        expect(body.breakdowns.likes.total.likes).toBe(122);
        expect(body.breakdowns.reach.rows.map((r) => r.impressions)).toEqual([2000, 2468]);
    });

    it('also reports the value without hidden/deleted rows', async () => {
        const { body } = await admin(request(app).get(url()));
        const likes = metricOf(body, 'likes');
        expect(likes.hidden_included).toBe(2);
        expect(likes.value_without_hidden).toBe(15);
        expect(metricOf(body, 'potential_impressions').value_without_hidden).toBe(2234);
        expect(metricOf(body, 'avg_epm').value_without_hidden).toBe(9); // (15 + 3) / 2
    });

    it('warns that hidden/deleted posts are counted, with numbers', async () => {
        const { body } = await admin(request(app).get(url()));
        const w = body.warnings.find((x) => x.code === 'hidden_counted_likes');
        expect(w.severity).toBe('warn');
        expect(w.message).toMatch(/2 hidden\/deleted post\(s\) are counted in Likes \(107 of 122\)/);
        expect(warningCodes(body)).toEqual(expect.arrayContaining(['hidden_counted_posts', 'hidden_counted_potential_impressions']));
        // The posts tab keeps them but flags them.
        const p3 = body.posts.find((p) => p.shortcode === 'p3');
        const p4 = body.posts.find((p) => p.shortcode === 'p4');
        expect(p3.is_hidden).toBe(true);
        expect(p4.deleted_at).toBe('2026-02-01T00:00:00.000Z');
        expect(body.breakdowns.likes.rows.find((r) => r.shortcode === 'p3').state).toBe('hidden');
    });

    it('does not warn about hidden posts when there are none', async () => {
        mockDb({ posts: () => ({ rows: [POSTS[0], POSTS[1]] }) });
        const { body } = await admin(request(app).get(url()));
        expect(warningCodes(body).filter((c) => c.startsWith('hidden_counted_') && !c.includes('keyword'))).toEqual([]);
    });

    it('warns about round follower counts, the sticky rule and platform guard events', async () => {
        const { body } = await admin(request(app).get(url()));
        const round = body.warnings.find((w) => w.code === 'round_follower_counts');
        expect(round.message).toMatch(/alice \(1000\)/);
        expect(round.message).not.toMatch(/bob/);
        expect(warningCodes(body)).toEqual(expect.arrayContaining(['follower_count_sticky', 'foreign_posts_skipped', 'WRONG_PLATFORM']));
        expect(body.warnings.find((w) => w.code === 'follower_count_sticky').message).toMatch(/GREATEST/);
    });

    it('flags Instagram post urls inside the TikTok data as bad', async () => {
        mockDb({ posts: () => ({ rows: [{ ...POSTS[0], foreign_url: true }] }) });
        const { body } = await admin(request(app).get(url()));
        expect(body.warnings.find((w) => w.code === 'instagram_posts_in_tiktok_db').severity).toBe('bad');
    });

    it('merges save history from the available sources and redacts secrets', async () => {
        const { body } = await admin(request(app).get(url()));
        expect(body.save_history.map((h) => h.source).sort()).toEqual(['admin_audit', 'api_events']);
        expect(body.save_history[0].at >= body.save_history[1].at).toBe(true);
        expect(warningCodes(body)).toContain('save_history_sources');
        expect(body.sessions).toHaveLength(1);
    });

    it('degrades to info warnings when optional tables are missing', async () => {
        mockDb({ audit: dbError('42P01'), events: dbError('42P01'), logins: dbError('42P01'), guard: dbError('42P01') });
        const res = await admin(request(app).get(url()));
        expect(res.status).toBe(200);
        expect(res.body.sessions).toEqual([]);
        expect(res.body.warnings.filter((w) => w.code === 'source_missing').length).toBeGreaterThan(0);
    });

    it('works for a user without projects', async () => {
        mockDb({ projects: () => ({ rows: [] }) });
        const res = await admin(request(app).get(url()));
        expect(res.status).toBe(200);
        expect(res.body.selected_project_id).toBeNull();
        expect(res.body.metrics).toEqual([]);
    });

    it('answers 500 without leaking the error text', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockDb({ posts: new Error('boom: secret detail') });
        const res = await admin(request(app).get(url()));
        spy.mockRestore();
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/secret detail/);
    });
});
