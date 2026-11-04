const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn(), end: jest.fn() }));

process.env.ADMIN_PASSWORD = 'admin-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { activityLog } = require('../../middleware/activityLog');
const adminRouter = require('../../routes/admin');
const blocksRouter = require('../../routes/adminBlocks');
const authRouter = require('../../routes/auth');
const { normalizeIp, forgetBlocks } = require('../../middleware/ipBlock');

const app = express();
app.use('/api', activityLog);
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin', blocksRouter);

const BLOCKED = '203.0.113.50';
const admin = (r) => r.set('x-admin-password', 'admin-test').set('x-forwarded-for', '198.51.100.7');
const missing = () => Object.assign(new Error('relation "blocked_ips" does not exist'), { code: '42P01' });
const inFuture = () => new Date(Date.now() + 3600 * 1000).toISOString();
const sqlCalls = (re) => pool.query.mock.calls.filter(([sql]) => re.test(sql));

// Answers the block lookup from `rows`; every other query gets an empty result.
const blocksAre = (rows) => pool.query.mockImplementation(async (sql) => (/FROM blocked_ips/.test(sql) ? { rows } : { rows: [] }));

let client;
beforeEach(() => {
    jest.clearAllMocks();
    forgetBlocks();
    blocksAre([]);
    client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
});

const userLogin = (ip) => request(app).post('/api/auth/login').set('x-forwarded-for', ip).send({ email: 'a@x.com', password: 'whatever' });
const adminLogin = (ip) => request(app).post('/api/admin/login').set('x-forwarded-for', ip).send({ password: 'admin-test' });

describe('login block', () => {
    it('refuses a blocked address at both login routes before checking any credentials', async () => {
        blocksAre([{ ip: BLOCKED, expires_at: inFuture() }]);
        const user = await userLogin(BLOCKED);
        expect(user.status).toBe(403);
        expect(pool.connect).not.toHaveBeenCalled();
        const adm = await adminLogin(BLOCKED);
        expect(adm.status).toBe(403);
        expect(adm.body.message).toBeUndefined();
    });

    it('records the refused login as an ip_blocked event', async () => {
        blocksAre([{ ip: BLOCKED, expires_at: inFuture() }]);
        await userLogin(BLOCKED);
        await new Promise((r) => setImmediate(r));
        const [, params] = sqlCalls(/INSERT INTO api_events/)[0];
        expect(params[4]).toBe(403);
        expect(params[5]).toBe('ip_blocked');
        expect(params[7]).toBe(BLOCKED);
    });

    it('matches on the proxy-appended address, so a forged X-Forwarded-For entry changes nothing', async () => {
        blocksAre([{ ip: BLOCKED, expires_at: inFuture() }]);
        expect((await userLogin(`8.8.8.8, ${BLOCKED}`)).status).toBe(403);
        expect((await userLogin(`${BLOCKED}, 8.8.8.8`)).status).toBe(401);
    });

    it('does not cover any other route', async () => {
        blocksAre([{ ip: BLOCKED, expires_at: inFuture() }]);
        const res = await request(app).get('/api/admin/blocked-ips').set('x-admin-password', 'admin-test').set('x-forwarded-for', BLOCKED);
        expect(res.status).toBe(200);
    });

    it('ignores a block that has expired', async () => {
        blocksAre([{ ip: BLOCKED, expires_at: new Date(Date.now() - 1000).toISOString() }]);
        expect((await userLogin(BLOCKED)).status).toBe(401);
    });

    it('fails open when the table is missing or the database errors', async () => {
        pool.query.mockImplementation(async (sql) => { if (/FROM blocked_ips/.test(sql)) throw missing(); return { rows: [] }; });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect((await userLogin(BLOCKED)).status).toBe(401);
        warn.mockRestore();

        forgetBlocks();
        pool.query.mockImplementation(async (sql) => { if (/FROM blocked_ips/.test(sql)) throw new Error('db down'); return { rows: [] }; });
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await userLogin(BLOCKED)).status).toBe(401);
        err.mockRestore();
    });

    it('reads the list once per cache window, and a block made here applies at once', async () => {
        await userLogin(BLOCKED);
        await userLogin('192.0.2.1');
        expect(sqlCalls(/SELECT ip, expires_at FROM blocked_ips/)).toHaveLength(1);

        pool.query.mockImplementation(async (sql) => {
            if (/INSERT INTO blocked_ips/.test(sql)) return { rows: [{ ip: BLOCKED }] };
            if (/FROM blocked_ips/.test(sql)) return { rows: [{ ip: BLOCKED, expires_at: inFuture() }] };
            return { rows: [] };
        });
        expect((await admin(request(app).post('/api/admin/blocked-ips')).send({ ip: BLOCKED })).status).toBe(200);
        expect((await userLogin(BLOCKED)).status).toBe(403);

        pool.query.mockImplementation(async (sql) => {
            if (/DELETE FROM blocked_ips/.test(sql)) return { rows: [{ ip: BLOCKED }] };
            return { rows: [] };
        });
        expect((await admin(request(app).delete(`/api/admin/blocked-ips/${BLOCKED}`))).status).toBe(200);
        expect((await userLogin(BLOCKED)).status).toBe(401);
    });
});

describe('POST /api/admin/blocked-ips', () => {
    const post = (body) => admin(request(app).post('/api/admin/blocked-ips')).send(body);

    it('requires admin auth', async () => {
        expect((await request(app).post('/api/admin/blocked-ips').send({ ip: BLOCKED })).status).toBe(401);
    });

    it('defaults to a 24-hour block, stores who did it and audits it', async () => {
        pool.query.mockImplementation(async (sql) => (/INSERT INTO blocked_ips/.test(sql) ? { rows: [{ ip: BLOCKED }] } : { rows: [] }));
        const res = await post({ ip: BLOCKED, reason: '  guessing  ' });
        expect(res.status).toBe(200);
        expect(sqlCalls(/INSERT INTO blocked_ips/)[0][1]).toEqual([BLOCKED, 'guessing', 'shared-password', 24]);
        const [, audit] = sqlCalls(/INSERT INTO admin_audit/)[0];
        expect(audit[0]).toBe('ip_block');
        expect(JSON.parse(audit[3])).toEqual({ blocked_ip: BLOCKED, hours: 24, reason: 'guessing' });
    });

    it('caps the reason at 200 characters', async () => {
        pool.query.mockImplementation(async (sql) => (/INSERT INTO blocked_ips/.test(sql) ? { rows: [{}] } : { rows: [] }));
        await post({ ip: BLOCKED, reason: 'x'.repeat(500), hours: 720 });
        const [, params] = sqlCalls(/INSERT INTO blocked_ips/)[0];
        expect(params[1]).toHaveLength(200);
        expect(params[3]).toBe(720);
    });

    it.each(['not-an-ip', '', undefined, '999.1.1.1', 'fe80::1%eth0', 12345])('rejects ip %p', async (ip) => {
        expect((await post({ ip })).status).toBe(400);
        expect(sqlCalls(/INSERT INTO blocked_ips/)).toHaveLength(0);
    });

    it.each([0, 721, 1.5, -1, 'abc', null, true])('rejects hours %p, so no block can be permanent', async (hours) => {
        expect((await post({ ip: BLOCKED, hours })).status).toBe(400);
        expect(sqlCalls(/INSERT INTO blocked_ips/)).toHaveLength(0);
    });

    it.each(['127.0.0.1', '127.8.8.8', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0.0.0.0', '::'])('refuses to block loopback %s', async (ip) => {
        expect((await post({ ip })).status).toBe(400);
        expect(sqlCalls(/INSERT INTO blocked_ips/)).toHaveLength(0);
    });

    it("refuses to block the caller's own address, in any spelling", async () => {
        expect((await post({ ip: '198.51.100.7' })).status).toBe(400);
        expect((await post({ ip: '::ffff:198.51.100.7' })).status).toBe(400);
        expect(sqlCalls(/INSERT INTO blocked_ips/)).toHaveLength(0);
    });

    it('answers 503 when the migration is not applied', async () => {
        pool.query.mockImplementation(async (sql) => { if (/INSERT INTO blocked_ips/.test(sql)) throw missing(); return { rows: [] }; });
        const res = await post({ ip: BLOCKED });
        expect(res.status).toBe(503);
        expect(res.body.error).toContain('v10_blocked_ips.sql');
    });
});

describe('GET and DELETE /api/admin/blocked-ips', () => {
    it('lists active blocks only', async () => {
        const row = { ip: BLOCKED, reason: 'r', blocked_by: 'shared-password', created_at: 'c', expires_at: 'e' };
        blocksAre([row]);
        const res = await admin(request(app).get('/api/admin/blocked-ips'));
        expect(res.body).toEqual({ success: true, blocks: [row], table_missing: false });
        expect(sqlCalls(/FROM blocked_ips/)[0][0]).toContain('expires_at > now()');
    });

    it('reports table_missing instead of failing before the migration', async () => {
        pool.query.mockRejectedValue(missing());
        const res = await admin(request(app).get('/api/admin/blocked-ips'));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, blocks: [], table_missing: true });
    });

    it('answers 404 when the address is not blocked and 400 when it is not an address', async () => {
        expect((await admin(request(app).delete(`/api/admin/blocked-ips/${BLOCKED}`))).status).toBe(404);
        expect((await admin(request(app).delete('/api/admin/blocked-ips/nope'))).status).toBe(400);
    });

    it('audits an unblock', async () => {
        pool.query.mockImplementation(async (sql) => (/DELETE FROM blocked_ips/.test(sql) ? { rows: [{ ip: BLOCKED }] } : { rows: [] }));
        await admin(request(app).delete(`/api/admin/blocked-ips/${BLOCKED}`));
        expect(sqlCalls(/INSERT INTO admin_audit/)[0][1][0]).toBe('ip_unblock');
    });
});

describe('normalizeIp', () => {
    it('gives one spelling per address', () => {
        expect(normalizeIp('2001:DB8:0::1')).toBe('2001:db8::1');
        expect(normalizeIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
        expect(normalizeIp(' 192.0.2.1 ')).toBe('192.0.2.1');
        expect(normalizeIp('nope')).toBeNull();
        expect(normalizeIp(undefined)).toBeNull();
    });
});
