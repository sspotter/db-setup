const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const adminRouter = require('../../routes/admin');
const plansRouter = require('../../routes/adminPlans');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);
app.use('/api/admin', plansRouter);

const admin = (r) => r.set('x-admin-password', 'admin-test');
const UUID = '11111111-1111-4111-8111-111111111111';
const noColumn = () => Object.assign(new Error('column "plan_expires_at" does not exist'), { code: '42703' });
let client;

beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
});

describe('GET /api/admin/users keeps working before and after migration v8', () => {
    it('selects the expiry columns, falls back without them when they are missing, and re-checks after a minute', async () => {
        const now = jest.spyOn(Date, 'now');
        const t0 = 1_800_000_000_000;
        now.mockReturnValue(t0);

        // After the migration: one query, with the columns.
        pool.query.mockResolvedValueOnce({ rows: [{ id: UUID, plan_expires_at: '2026-12-01T00:00:00Z' }] });
        let res = await admin(request(app).get('/api/admin/users'));
        expect(res.status).toBe(200);
        expect(res.body.users[0].plan_expires_at).toBe('2026-12-01T00:00:00Z');
        expect(pool.query.mock.calls[0][0]).toContain('u.plan_expires_at, u.trial_ends_at');

        // Before the migration: the first query fails with undefined_column, the retry succeeds.
        pool.query.mockClear();
        pool.query.mockRejectedValueOnce(noColumn()).mockResolvedValueOnce({ rows: [{ id: UUID }] });
        res = await admin(request(app).get('/api/admin/users'));
        expect(res.status).toBe(200);
        expect(pool.query).toHaveBeenCalledTimes(2);
        expect(pool.query.mock.calls[1][0]).not.toContain('plan_expires_at');

        // Within the minute it does not retry the failing query.
        pool.query.mockClear();
        pool.query.mockResolvedValueOnce({ rows: [] });
        now.mockReturnValue(t0 + 30_000);
        await admin(request(app).get('/api/admin/users'));
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][0]).not.toContain('plan_expires_at');

        // After the minute it tries the columns again (migration may have been applied).
        pool.query.mockClear();
        pool.query.mockResolvedValueOnce({ rows: [] });
        now.mockReturnValue(t0 + 61_000);
        await admin(request(app).get('/api/admin/users'));
        expect(pool.query.mock.calls[0][0]).toContain('u.plan_expires_at');
        now.mockRestore();
    });

    it('still returns 500 for a different database error', async () => {
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        pool.query.mockRejectedValueOnce(new Error('connection lost'));
        expect((await admin(request(app).get('/api/admin/users'))).status).toBe(500);
        err.mockRestore();
    });
});

describe('plan expiry on create and update', () => {
    it('create: stores valid dates; plain create keeps the original columns', async () => {
        client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: UUID, email: 'a@x.com', plan: 'pro' }] });
        let res = await admin(request(app).post('/api/admin/users')).send({ email: 'a@x.com', password: 'pw12345', plan_expires_at: '2026-12-31T00:00:00Z', trial_ends_at: null });
        expect(res.status).toBe(201);
        let [sql, vals] = client.query.mock.calls[1];
        expect(sql).toContain('plan_expires_at, trial_ends_at');
        expect(vals.slice(-2)).toEqual([new Date('2026-12-31T00:00:00Z'), null]);

        client.query.mockClear();
        client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: UUID, email: 'b@x.com' }] });
        await admin(request(app).post('/api/admin/users')).send({ email: 'b@x.com', password: 'pw12345' });
        [sql, vals] = client.query.mock.calls[1];
        expect(sql).not.toContain('plan_expires_at');
        expect(vals).toHaveLength(5);
    });

    it('update: sets a date, clears with null or empty string, rejects junk before touching the database', async () => {
        client.query.mockResolvedValueOnce({ rows: [{ id: UUID, password_hash: 'h' }] }).mockResolvedValueOnce({ rows: [{ id: UUID, email: 'a@x.com' }] });
        let res = await admin(request(app).put(`/api/admin/users/${UUID}`)).send({ plan_expires_at: '2027-01-01', trial_ends_at: '' });
        expect(res.status).toBe(200);
        const [sql, vals] = client.query.mock.calls[1];
        expect(sql).toContain('plan_expires_at = $1');
        expect(sql).toContain('trial_ends_at = $2');
        expect(vals.slice(0, 2)).toEqual([new Date('2027-01-01'), null]);

        client.query.mockClear();
        for (const bad of ['next tuesday-ish', 12345, {}]) {
            res = await admin(request(app).put(`/api/admin/users/${UUID}`)).send({ plan_expires_at: bad });
            expect(res.status).toBe(400);
            res = await admin(request(app).post('/api/admin/users')).send({ email: 'c@x.com', password: 'pw12345', trial_ends_at: bad });
            expect(res.status).toBe(400);
        }
        expect(client.query).not.toHaveBeenCalled();
    });

    it('update/create answer 400 with a clear message when migration v8 is not applied', async () => {
        client.query.mockResolvedValueOnce({ rows: [{ id: UUID, password_hash: 'h' }] }).mockRejectedValueOnce(noColumn());
        let res = await admin(request(app).put(`/api/admin/users/${UUID}`)).send({ plan_expires_at: '2027-01-01' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('v8_plan_expiry.sql');

        client.query.mockReset();
        client.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(noColumn());
        res = await admin(request(app).post('/api/admin/users')).send({ email: 'd@x.com', password: 'pw12345', plan_expires_at: '2027-01-01' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('v8_plan_expiry.sql');
    });
});

describe('GET /api/admin/users/expiring', () => {
    it('requires the admin password', async () => {
        expect((await request(app).get('/api/admin/users/expiring')).status).toBe(401);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('defaults to 14 days, clamps to 1..365, and returns lapsed and upcoming users', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: UUID, email: 'a@x.com', lapsed: true }] });
        const res = await admin(request(app).get('/api/admin/users/expiring'));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ days: 14, columns_missing: false, users: [{ email: 'a@x.com', lapsed: true }] });
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('greatest(plan_expires_at, trial_ends_at)');
        expect(params).toEqual([14]);

        pool.query.mockResolvedValue({ rows: [] });
        await admin(request(app).get('/api/admin/users/expiring?days=99999'));
        await admin(request(app).get('/api/admin/users/expiring?days=-5'));
        expect(pool.query.mock.calls[1][1]).toEqual([365]);
        expect(pool.query.mock.calls[2][1]).toEqual([1]);
    });

    it('says columns_missing before the migration, 500 for other errors', async () => {
        pool.query.mockRejectedValueOnce(noColumn());
        const res = await admin(request(app).get('/api/admin/users/expiring'));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ columns_missing: true, users: [] });

        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        pool.query.mockRejectedValueOnce(new Error('connection lost'));
        expect((await admin(request(app).get('/api/admin/users/expiring'))).status).toBe(500);
        err.mockRestore();
    });
});
