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
