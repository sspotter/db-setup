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

// Fixture: 4 project links. p3 is hidden, p4 is soft-deleted; p1 and p2 are the visible ones.
// Likes 10 + 5 (visible) + 100 (hidden) + 7 (deleted); comments 1 + 2 + 20 (hidden).
const POSTS = [
    { shortcode: 'p1', post_row: 'p1', owner_username: 'alice', posted_at: '2026-01-03T00:00:00Z', likes: '10', comments: '1', views: '100', reposts: 0, shares: 2, bookmarks: 3, post_view_count: '0', pp_hidden: false, pp_deleted_at: null, post_deleted_at: null, foreign_url: false },
    { shortcode: 'p2', post_row: 'p2', owner_username: 'bob', posted_at: '2026-01-02T00:00:00Z', likes: '5', comments: '2', views: '50', reposts: 1, shares: 0, bookmarks: 0, post_view_count: '0', pp_hidden: false, pp_deleted_at: null, post_deleted_at: null, foreign_url: false },
    { shortcode: 'p3', post_row: 'p3', owner_username: 'alice', posted_at: '2026-01-01T00:00:00Z', likes: '100', comments: '20', views: '1000', reposts: 0, shares: 0, bookmarks: 0, post_view_count: '0', pp_hidden: true, pp_deleted_at: null, post_deleted_at: null, foreign_url: false },
    { shortcode: 'p4', post_row: 'p4', owner_username: 'bob', posted_at: null, likes: '7', comments: '0', views: '0', reposts: 0, shares: 0, bookmarks: 0, post_view_count: '0', pp_hidden: false, pp_deleted_at: '2026-02-01T00:00:00Z', post_deleted_at: null, foreign_url: false },
];
// What the creators query returns when it excludes hidden/deleted links (as the app does).
const CREATORS = [
    { username: 'alice', posts_involved: '1', follower_count: '1000', scraped_at: '2026-01-05T00:00:00Z', role: 'brand', adds: '1' },
    { username: 'bob', posts_involved: '1', follower_count: '1234', scraped_at: null, role: 'competitor', adds: '1' },
];

function dbError(code) { const e = new Error(code); e.code = code; return e; }

// Routes each query by its SQL text, so the order of the route's queries does not matter.
function mockDb(over = {}) {
    const handlers = {
        user: () => ({ rows: [{ id: USER, email: 'nadine@example.com', status: 'active', plan: 'pro', active_sessions: 1, last_login: '2026-03-01T00:00:00Z', max_devices: 3, created_at: '2025-01-01T00:00:00Z', plan_expires_at: null, trial_ends_at: null, password_hash: 'HASH-MUST-NOT-LEAK' }] }),
        projects: () => ({ rows: [{ id: PROJ, name: 'Barbican', created_at: '2025-02-01T00:00:00Z', posts: 4, profiles: 2 }] }),
        posts: () => ({ rows: POSTS }),
        creators: () => ({ rows: CREATORS }),
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
        else if (/WITH project_posts_cte/.test(s)) key = 'creators';
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
        // Hidden p3 and deleted p4 are excluded, exactly as the app's /stats and /compare do.
        expect(metricOf(body, 'posts').value).toBe(2);
        expect(metricOf(body, 'likes').value).toBe(15);
        expect(metricOf(body, 'comments').value).toBe(3);
        expect(metricOf(body, 'views').value).toBe(150);
        expect(metricOf(body, 'shares').value).toBe(2);
        expect(metricOf(body, 'reposts').value).toBe(1);
        expect(metricOf(body, 'bookmarks').value).toBe(3);
        expect(metricOf(body, 'engagement').value).toBe(18);
        expect(metricOf(body, 'avg_epm').value).toBe(9); // ROUND(18 / 2, 1)
        // followers x posts: 1000 x 1 + 1234 x 1
        expect(metricOf(body, 'potential_impressions').value).toBe(2234);
        expect(metricOf(body, 'keyword_potential_reach').value).toBe(400);
        expect(metricOf(body, 'comments_stored').value).toBe(3);
        expect(body.breakdowns.likes.total.likes).toBe(15);
        expect(body.breakdowns.likes.rows.map((r) => r.shortcode).sort()).toEqual(['p1', 'p2']);
        expect(body.breakdowns.reach.rows.map((r) => r.impressions)).toEqual([1000, 1234]);
    });

    it('uses the same visibility filter as the app in every project_posts query', async () => {
        await admin(request(app).get(url()));
        const sqls = pool.query.mock.calls.map((c) => String(c[0]));
        const creators = sqls.find((s) => /WITH project_posts_cte/.test(s));
        expect(creators).toMatch(/WHERE ppo\.project_id = \$1\s+AND ppo\.is_hidden = false AND ppo\.deleted_at IS NULL/);
        expect(creators).toMatch(/ppo2\.is_hidden = false AND ppo2\.deleted_at IS NULL/);
        expect(sqls.find((s) => /FROM comments c/.test(s))).toMatch(/ppo\.is_hidden = false AND ppo\.deleted_at IS NULL/);
        expect(sqls.find((s) => /FROM projects pr/.test(s))).toMatch(/pp\.is_hidden = false AND pp\.deleted_at IS NULL/);
        // The posts list keeps every link (so an admin can unhide / restore it).
        expect(sqls.find((s) => /FROM project_posts ppo\s+LEFT JOIN posts p/.test(s))).not.toMatch(/is_hidden = false/);
    });

    it('says in one info line how many hidden/deleted posts are excluded', async () => {
        const { body } = await admin(request(app).get(url()));
        const w = body.warnings.filter((x) => x.code === 'hidden_excluded');
        expect(w).toHaveLength(1);
        expect(w[0].severity).toBe('info');
        expect(w[0].message).toMatch(/^2 hidden\/deleted posts are excluded/);
        expect(warningCodes(body).filter((c) => /^hidden_counted_(?!keyword)/.test(c))).toEqual([]);
        // The old "included" fields are gone from the post totals (they stay on the keyword reach, which the app still counts).
        for (const key of ['posts', 'likes', 'comments', 'views', 'engagement', 'avg_epm', 'potential_impressions']) {
            expect(metricOf(body, key)).not.toHaveProperty('hidden_included');
            expect(metricOf(body, key)).not.toHaveProperty('value_without_hidden');
        }
    });

    it('lists hidden and deleted links in the posts tab with a state', async () => {
        const { body } = await admin(request(app).get(url()));
        expect(body.posts).toHaveLength(4);
        const find = (sc) => body.posts.find((p) => p.shortcode === sc);
        expect(find('p1').state).toBe('visible');
        expect(find('p3')).toMatchObject({ is_hidden: true, state: 'hidden' });
        expect(find('p4')).toMatchObject({ deleted_at: '2026-02-01T00:00:00.000Z', state: 'deleted' });
    });

    it('does not add the excluded line when nothing is hidden', async () => {
        mockDb({ posts: () => ({ rows: [POSTS[0], POSTS[1]] }) });
        const { body } = await admin(request(app).get(url()));
        expect(warningCodes(body)).not.toContain('hidden_excluded');
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
