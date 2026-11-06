const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const overview = require('../../routes/adminUserOverview');

const app = express();
app.use(express.json());
app.use('/api/admin', overview);

const USER = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const url = (q = '') => `/api/admin/users/${USER}/overview${q}`;
const admin = (r) => r.set('x-admin-password', 'admin-test');

// Fixture: 3 posts (a: 10+2, b: 5+1 COAUTHOR with nadine, c: no metrics, paid).
const fixture = {
    user: [{ id: USER, email: 'nadine@x.com', status: 'active', plan: 'pro', plan_expires_at: null, trial_ends_at: null,
        max_devices: 3, active_sessions: 2, last_login: '2026-01-02T00:00:00Z', last_seen: null, created_at: '2025-01-01T00:00:00Z',
        password_hash: 'SHOULD-NEVER-LEAK' }],
    projects: [{ id: PROJ, name: 'Barbican', created_at: '2025-02-01T00:00:00Z', posts: 3, profiles: 1 }],
    totals: [{ posts: '3', likes: '15', comments: '3', no_metrics: '1' }],
    collab: [{ collab_posts: '2', collaborations: '1', paid: '1' }],
    comments: [{ n: '40' }],
    creators: [
        { username: 'moussyarabia', posts_involved: '3', adds: '1', follower_count: '12500', potential_impressions: '37500', scraped_at: '2026-01-01T00:00:00Z', observed_at: null, role: 'brand' },
        { username: 'nadine', posts_involved: '1', adds: '1', follower_count: '4321', potential_impressions: '4321', scraped_at: '2026-01-01T00:00:00Z', observed_at: '2026-01-01T00:00:00Z', role: 'collaborator' },
    ],
    posts: [
        { shortcode: 'a', owner_username: 'moussyarabia', posted_at: '2026-01-03T00:00:00Z', is_paid: false, type: 'normal', collective_reach: '0', likes: 10, comments: 2, metrics_observed_at: '2026-01-04T00:00:00Z', has_metrics: true, coauthors: 0 },
        { shortcode: 'b', owner_username: 'moussyarabia', posted_at: '2026-01-02T00:00:00Z', is_paid: false, type: 'normal', collective_reach: '0', likes: 5, comments: 1, metrics_observed_at: null, has_metrics: true, coauthors: 1 },
        { shortcode: 'c', owner_username: 'moussyarabia', posted_at: '2026-01-01T00:00:00Z', is_paid: true, type: 'normal', collective_reach: '0', likes: null, comments: null, metrics_observed_at: null, has_metrics: false, coauthors: 0 },
    ],
    guard: [],
};

function mockDb(over = {}) {
    const f = { ...fixture, ...over };
    pool.query.mockImplementation(async (sql, params) => {
        const s = String(sql);
        if (/^\s*(INSERT|UPDATE|DELETE)/i.test(s)) throw new Error('write attempted: ' + s);
        if (/FROM users WHERE id/.test(s)) return { rows: params[0] === USER ? f.user : [] };
        if (/FROM projects pr WHERE pr.user_id/.test(s)) return { rows: f.projects };
        if (/AS no_metrics/.test(s)) return { rows: f.totals };
        if (/AS collab_posts/.test(s)) return { rows: f.collab };
        if (/FROM comments c/.test(s)) return { rows: f.comments };
        if (/WITH project_posts_cte/.test(s)) return { rows: f.creators };
        if (/AS hidden_n/.test(s)) return { rows: f.offcount || [{ hidden_n: '0', deleted_n: '0' }] };
        if (/NOT \(ppo\.is_hidden = false/.test(s)) return { rows: f.offposts || [] };
        if (/AS metrics_observed_at/.test(s)) return { rows: f.posts };
        if (/FROM admin_audit/.test(s)) return { rows: f.audit || [] };
        if (/FROM user_scraped_posts/.test(s)) return { rows: f.saved || [] };
        if (/reason = 'foreign_posts_skipped'/.test(s)) return { rows: f.guard };
        if (/reason = 'success'/.test(s)) return { rows: f.sessions || [] };
        if (/FROM api_events/.test(s)) return { rows: f.events || [] };
        throw new Error('unexpected query: ' + s.slice(0, 80));
    });
}

describe('GET /users/:id/overview', () => {
    beforeEach(() => { jest.clearAllMocks(); mockDb(); });

    it('requires admin auth and touches no database', async () => {
        const res = await request(app).get(url());
        expect(res.status).toBe(401);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('404s for an unknown or malformed user', async () => {
        const unknown = await admin(request(app).get('/api/admin/users/99999999-9999-4999-8999-999999999999/overview'));
        expect(unknown.status).toBe(404);
        expect(unknown.body.success).toBe(false);
        const bad = await admin(request(app).get('/api/admin/users/nope/overview'));
        expect(bad.status).toBe(404);
    });

    it('404s when project_id is malformed or belongs to someone else', async () => {
        expect((await admin(request(app).get(url('?project_id=zzz')))).status).toBe(404);
        const res = await admin(request(app).get(url(`?project_id=${OTHER}`)));
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it('returns the contract keys and defaults to the first (most recently updated) project', async () => {
        const res = await admin(request(app).get(url()));
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(['breakdowns', 'browser_only', 'creators', 'metrics', 'platform', 'posts',
            'hidden_summary', 'projects', 'save_history', 'selected_project_id', 'sessions', 'success', 'user', 'warnings'].sort());
        expect(res.body.platform).toBe('instagram');
        expect(res.body.selected_project_id).toBe(PROJ);
        expect(res.body.user.email).toBe('nadine@x.com');
    });

    it('counts only visible links and lists hidden/deleted ones with a state', async () => {
        mockDb({
            offposts: [
                { shortcode: 'h1', owner_username: 'moussyarabia', posted_at: null, is_paid: false, type: 'normal', collective_reach: '0', is_hidden: true, deleted_at: null, likes: 1, comments: 0, metrics_observed_at: null, has_metrics: true, coauthors: 0 },
                { shortcode: 'd1', owner_username: 'moussyarabia', posted_at: null, is_paid: false, type: 'normal', collective_reach: '0', is_hidden: false, deleted_at: '2026-01-05T00:00:00Z', likes: 1, comments: 0, metrics_observed_at: null, has_metrics: true, coauthors: 0 },
            ],
            offcount: [{ hidden_n: '1', deleted_n: '1' }],
        });
        const res = await admin(request(app).get(url()));
        expect(res.body.hidden_summary).toEqual({ hidden: 1, deleted: 1 });
        expect(res.body.posts.map((p) => [p.shortcode, p.state])).toEqual([['a', 'visible'], ['b', 'visible'], ['c', 'visible'], ['h1', 'hidden'], ['d1', 'deleted']]);
        // numbers and breakdowns describe visible posts only
        expect(res.body.metrics.find((x) => x.key === 'posts').value).toBe(3);
        expect(res.body.breakdowns.total_likes.rows.map((r) => r.shortcode)).toEqual(['a', 'b', 'c']);
        expect(res.body.warnings.find((w) => w.code === 'POSTS_HIDDEN_DELETED').message).toMatch(/1 hidden and 1 deleted/);
        // every total/list query filters on the project link state
        const sqls = pool.query.mock.calls.map((c) => String(c[0]));
        for (const sql of sqls.filter((x) => /FROM project_posts ppo|JOIN project_posts ppo/.test(x) && !/AS hidden_n|NOT \(ppo/.test(x))) {
            expect(sql).toMatch(/ppo\.is_hidden = false AND ppo\.deleted_at IS NULL/);
        }
    });

    it('never leaks secrets', async () => {
        const res = await admin(request(app).get(url()));
        const text = JSON.stringify(res.body);
        expect(text).not.toMatch(/SHOULD-NEVER-LEAK|password|token|jwt/i);
        for (const call of pool.query.mock.calls) expect(String(call[0])).not.toMatch(/password_hash/);
    });

    it('computes the metrics from the fixture with their formulas', async () => {
        const res = await admin(request(app).get(url(`?project_id=${PROJ}`)));
        const m = Object.fromEntries(res.body.metrics.map((x) => [x.key, x]));
        expect(m.posts.value).toBe(3);
        expect(m.total_likes.value).toBe(15);
        expect(m.total_comments.value).toBe(3);
        expect(m.engagement.value).toBe(18);
        expect(m.avg_epm.value).toBe(6);
        expect(m.potential_impressions.value).toBe(12500 * 3 + 4321 * 1);
        expect(m.collab_posts.value).toBe(2);
        expect(m.collaborations.value).toBe(1);
        expect(m.paid.value).toBe(1);
        for (const x of res.body.metrics) {
            expect(x.formula).toBeTruthy();
            expect(Array.isArray(x.inputs)).toBe(true);
            if (x.breakdown) expect(res.body.breakdowns[x.breakdown]).toBeDefined();
        }
        const pi = res.body.breakdowns.potential_impressions;
        expect(pi.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['username', 'follower_count', 'posts', 'adds', 'scraped_at', 'observed_at']));
        expect(pi.total.impressions).toBe(41821);
        expect(res.body.breakdowns.total_likes.rows.find((r) => r.shortcode === 'c').metrics_observed_at).toBe('NO METRICS ROW');
        expect(res.body.posts).toHaveLength(3);
        expect(res.body.creators[0]).toMatchObject({ username: 'moussyarabia', follower_count: 12500, posts: 3, adds: 1 });
    });

    it('avg EPM is 0 for a project with no posts', async () => {
        mockDb({ totals: [{ posts: '0', likes: '0', comments: '0', no_metrics: '0' }], creators: [], posts: [] });
        const res = await admin(request(app).get(url()));
        expect(res.body.metrics.find((x) => x.key === 'avg_epm').value).toBe(0);
    });

    it('raises data warnings and the fixed info notes', async () => {
        const res = await admin(request(app).get(url()));
        const codes = res.body.warnings.map((w) => w.code);
        expect(codes).toEqual(expect.arrayContaining(['FOLLOWERS_UNSTAMPED', 'FOLLOWERS_ROUND', 'POSTS_NO_METRICS', 'SENTIMENT_HARDCODED', 'CAPTION_USER_REACH']));
        const round = res.body.warnings.filter((w) => w.code === 'FOLLOWERS_ROUND');
        expect(round).toHaveLength(1);
        expect(round[0].message).toMatch(/moussyarabia/);
        expect(res.body.warnings.find((w) => w.code === 'SENTIMENT_HARDCODED').severity).toBe('info');
    });

    it('reports platform-guard skips and refusals from the activity log', async () => {
        mockDb({ guard: [
            { created_at: '2026-01-05T00:00:00Z', status: 200, reason: 'foreign_posts_skipped', error: null },
            { created_at: '2026-01-04T00:00:00Z', status: 400, reason: null, error: 'This is the Instagram backend, but none of the 2 post(s) are from instagram.com.' },
        ] });
        const res = await admin(request(app).get(url()));
        const byCode = Object.fromEntries(res.body.warnings.map((w) => [w.code, w]));
        expect(byCode.FOREIGN_POSTS_SKIPPED.severity).toBe('warn');
        expect(byCode.WRONG_PLATFORM.severity).toBe('bad');
    });

    it('lists save history with its source and tolerates missing tables', async () => {
        mockDb({ saved: [{ post_shortcode: 'a', scraped_at: '2026-01-03T00:00:00Z' }],
            audit: [{ created_at: '2026-01-04T00:00:00Z', action: 'user_update', actor: 'shared-password', detail: { fields: ['plan'], password: 'x' } }] });
        const res = await admin(request(app).get(url()));
        expect(res.body.save_history.map((h) => h.source)).toEqual(['admin_audit', 'user_scraped_posts']);

        const real = pool.query.getMockImplementation();
        pool.query.mockImplementation(async (sql, p) => {
            if (/FROM (admin_audit|api_events|user_scraped_posts)/.test(String(sql))) { const e = new Error('no table'); e.code = '42P01'; throw e; }
            return real(sql, p);
        });
        const res2 = await admin(request(app).get(url()));
        expect(res2.status).toBe(200);
        expect(res2.body.save_history).toEqual([]);
        expect(res2.body.sessions).toEqual([]);
    });

    it('only ever issues SELECTs', async () => {
        await admin(request(app).get(url()));
        for (const call of pool.query.mock.calls) expect(String(call[0])).toMatch(/^\s*(SELECT|WITH)/i);
    });
});
