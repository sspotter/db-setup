const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const adminRouter = require('../../routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

describe('GET /api/admin/events', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rows: [] });
    });

    it('filters logins by email and clamps the limit to 1000', async () => {
        const res = await request(app)
            .get('/api/admin/events?kind=logins&email=bob&limit=99999')
            .set('x-admin-password', 'admin-test');

        expect(res.status).toBe(200);
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain("path = '/api/auth/login'");
        expect(sql).toContain('ILIKE');
        expect(params).toEqual(['bob', 1000]);
    });

    it('applies q/user/action/result/since filters to both the list and the stats', async () => {
        const stats = { all_time: 9, today: 3, matching: 2, failed: 2, distinct_users: 1 };
        pool.query
            .mockResolvedValueOnce({ rows: [] })        // events
            .mockResolvedValueOnce({ rows: [stats] });  // stats

        const res = await request(app)
            .get('/api/admin/events?q=expired&user=Bob@X.com&action=api&result=failed&since=2026-10-01T00:00:00Z&today_start=2026-10-28T00:00:00Z')
            .set('x-admin-password', 'admin-test');

        expect(res.status).toBe(200);
        expect(res.body.stats).toEqual(stats);
        const [listSql, listParams] = pool.query.mock.calls[0];
        expect(listSql).toContain('lower(email) = lower($1)');
        expect(listSql).toContain('concat_ws');
        expect(listSql).toContain("path <> '/api/auth/login'");
        expect(listSql).toContain('status >= 400');
        expect(listParams.slice(0, 2)).toEqual(['Bob@X.com', 'expired']);
        expect(listParams[3]).toBe(200);
        const [statsSql, statsParams] = pool.query.mock.calls[1];
        expect(statsSql).toContain('distinct_users');
        expect(statsParams[3]).toEqual(new Date('2026-10-28T00:00:00Z'));
    });

    it('rejects a bad since date without querying', async () => {
        const res = await request(app)
            .get('/api/admin/events?since=yesterday-ish')
            .set('x-admin-password', 'admin-test');

        expect(res.status).toBe(400);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects an unknown kind without querying', async () => {
        const res = await request(app)
            .get('/api/admin/events?kind=bogus')
            .set('x-admin-password', 'admin-test');

        expect(res.status).toBe(400);
        expect(pool.query).not.toHaveBeenCalled();
    });
});

describe('POST /api/admin/users/:id/reset-link', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.RESET_BASE_URLS = 'https://a.example:8443/, https://b.example';
    });

    it('stores only the token hash and returns one link per base URL', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'bob@x.com' }] }) // user lookup
            .mockResolvedValueOnce({ rows: [] })                                  // void old links
            .mockResolvedValueOnce({ rows: [{ expires_at: '2026-10-31T00:00:00Z' }] });

        const res = await request(app).post('/api/admin/users/u1/reset-link').set('x-admin-password', 'admin-test');

        expect(res.status).toBe(200);
        expect(res.body.links).toHaveLength(2);
        const token = res.body.links[0].split('token=')[1];
        expect(res.body.links[0]).toMatch(/^https:\/\/a\.example:8443\/reset\.html\?token=[0-9a-f]{64}$/);
        expect(res.body.links[1].startsWith('https://b.example/reset.html?')).toBe(true);
        const storedHash = pool.query.mock.calls[2][1][0];
        expect(storedHash).not.toBe(token);
        expect(storedHash).toHaveLength(64);
    });

    it('404s for an unknown user and 401s without the admin password', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        expect((await request(app).post('/api/admin/users/nope/reset-link').set('x-admin-password', 'admin-test')).status).toBe(404);
        expect((await request(app).post('/api/admin/users/u1/reset-link')).status).toBe(401);
    });
});

describe('GET /api/admin/users diagnostics', () => {
    beforeEach(() => { jest.clearAllMocks(); pool.query.mockResolvedValue({ rows: [] }); });

    it('selects ghost sessions, last_seen and the latest reset link', async () => {
        const res = await request(app).get('/api/admin/users').set('x-admin-password', 'admin-test');

        expect(res.status).toBe(200);
        const [sql] = pool.query.mock.calls[0];
        expect(sql).toContain('GREATEST(0, COALESCE(u.active_sessions, 0) - rl.recent_logins) AS ghost_sessions');
        expect(sql).toContain('u.last_seen');
        expect(sql).toContain('FROM password_resets r');
        expect(sql).toContain("interval '7 days'");
    });
});
