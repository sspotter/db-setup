const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../db');

jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn(), end: jest.fn() }));

process.env.ADMIN_PASSWORD = 'admin-test';
process.env.ADMIN_JWT_SECRET = 'admin-jwt-test-secret';
const verifyAdmin = require('../../middleware/adminAuth');
const adminRouter = require('../../routes/admin');
const accountsRouter = require('../../routes/adminAccounts');
const auditRouter = require('../../routes/adminAudit');
const { forgetBlocks } = require('../../middleware/ipBlock');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);
app.use('/api/admin', accountsRouter);
app.use('/api/admin', auditRouter);
app.get('/whoami', verifyAdmin, (req, res) => res.json(req.admin));

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'correct-horse-battery';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const account = { id: ID, email: 'lead@x.com', password_hash: HASH, disabled_at: null };
const missing = () => Object.assign(new Error('relation "admin_accounts" does not exist'), { code: '42P01' });
const auditCalls = () => pool.query.mock.calls.filter(([sql]) => /INSERT INTO admin_audit/.test(sql));

// `rows` answers both the login lookup and the session check; other queries get an empty result.
const accountsAre = (rows) => pool.query.mockImplementation(async (sql) => (/FROM admin_accounts/.test(sql) ? { rows } : { rows: [] }));
const failAccounts = (err) => pool.query.mockImplementation(async (sql) => { if (/admin_accounts/.test(sql)) throw err; return { rows: [] }; });

let n = 0;
const freshIp = () => `198.51.100.${(n = (n % 250) + 1)}`;
const shared = (r) => r.set('x-admin-password', 'admin-test').set('x-forwarded-for', freshIp());
const login = (body, ip = freshIp()) => request(app).post('/api/admin/login').set('x-forwarded-for', ip).send(body);
const freshEmail = () => `lead${++n}@x.com`;

beforeEach(() => {
    jest.clearAllMocks();
    forgetBlocks();
    verifyAdmin.forgetAccount(ID);
    process.env.ADMIN_JWT_SECRET = 'admin-jwt-test-secret';
    process.env.ADMIN_PASSWORD = 'admin-test';
    accountsAre([]);
});

const tokenFor = (acc = account) => verifyAdmin.signAdminToken(acc);
const withToken = (r, token = tokenFor()) => r.set('x-admin-token', token).set('x-forwarded-for', freshIp());
const whoami = (token) => withToken(request(app).get('/whoami'), token);

describe('shared password', () => {
    it('still works without touching the database, before the migration', async () => {
        pool.query.mockRejectedValue(missing());
        const res = await request(app).get('/whoami').set('x-admin-password', 'admin-test');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ shared: true });
        expect(pool.query).not.toHaveBeenCalled();
        pool.query.mockResolvedValue({ rows: [] });
        expect((await login({ password: 'admin-test' })).status).toBe(200);
    });

    it('is recorded in the audit log as shared-password', async () => {
        await login({ password: 'admin-test' });
        expect(auditCalls()[0][0]).toContain('INSERT INTO admin_audit');
        expect(auditCalls()[0][1][5]).toBe('shared-password');
    });

    it('rejects a wrong one', async () => {
        expect((await request(app).get('/whoami').set('x-admin-password', 'wrong')).status).toBe(401);
    });
});

describe('POST /login with an email', () => {
    it('returns a 12-hour token and records the account as the actor', async () => {
        accountsAre([account]);
        const res = await login({ email: ' LEAD@x.com ', password: PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('lead@x.com');
        expect(res.body.password_hash).toBeUndefined();
        const claims = jwt.verify(res.body.token, 'admin-jwt-test-secret', { audience: 'surfer-admin' });
        expect(claims.sub).toBe(ID);
        expect(claims.exp - claims.iat).toBe(12 * 60 * 60);
        expect(pool.query.mock.calls.find(([sql]) => /FROM admin_accounts/.test(sql))[1]).toEqual(['lead@x.com']);
        const audit = auditCalls()[0][1];
        expect(audit[0]).toBe('admin_login');
        expect(audit[5]).toBe('lead@x.com');
    });

    it('answers identically for an unknown email, a wrong password and a disabled account', async () => {
        accountsAre([]);
        const unknown = await login({ email: freshEmail(), password: PASSWORD });
        accountsAre([account]);
        const wrong = await login({ email: 'lead@x.com', password: 'not-the-password' });
        accountsAre([{ ...account, disabled_at: '2026-01-01' }]);
        const disabled = await login({ email: 'lead@x.com', password: PASSWORD });
        expect(unknown.status).toBe(401);
        expect(wrong.status).toBe(401);
        expect(disabled.status).toBe(401);
        expect(wrong.body).toEqual(unknown.body);
        expect(disabled.body).toEqual(unknown.body);
    });

    it('still runs a bcrypt compare for an unknown email', async () => {
        const compare = jest.spyOn(bcrypt, 'compare');
        accountsAre([]);
        await login({ email: freshEmail(), password: PASSWORD });
        expect(compare).toHaveBeenCalledTimes(1);
        compare.mockRestore();
    });

    it('does not store what was typed as an unknown email, in case it was a password', async () => {
        accountsAre([]);
        await login({ email: 'my-password-typed-here', password: 'x' });
        expect(JSON.stringify(auditCalls())).not.toContain('my-password-typed-here');
    });

    it('locks an email after repeated failures from different addresses', async () => {
        accountsAre([account]);
        const email = freshEmail();
        for (let i = 0; i < 5; i++) expect((await login({ email, password: 'wrong-guess' })).status).toBe(401);
        expect((await login({ email, password: PASSWORD })).status).toBe(429);
    });

    it('counts parallel guesses one by one instead of letting them all through', async () => {
        accountsAre([account]);
        const email = freshEmail();
        const statuses = (await Promise.all(Array.from({ length: 20 }, () => login({ email, password: 'wrong-guess' })))).map((r) => r.status);
        expect(statuses.filter((s) => s === 401)).toHaveLength(5);
        expect(statuses.filter((s) => s === 429)).toHaveLength(15);
    });

    it('applies the per-IP lockout too', async () => {
        accountsAre([]);
        const ip = '192.0.2.77';
        for (let i = 0; i < 5; i++) await login({ email: freshEmail(), password: 'wrong-guess' }, ip);
        expect((await login({ email: 'lead@x.com', password: PASSWORD }, ip)).status).toBe(429);
    });

    it('answers 503 without ADMIN_JWT_SECRET, and the shared password keeps working', async () => {
        delete process.env.ADMIN_JWT_SECRET;
        const res = await login({ email: 'lead@x.com', password: PASSWORD });
        expect(res.status).toBe(503);
        expect(res.body.error).toContain('ADMIN_JWT_SECRET');
        expect((await login({ password: 'admin-test' })).status).toBe(200);
    });

    it('answers 503 before the migration', async () => {
        failAccounts(missing());
        const res = await login({ email: 'lead@x.com', password: PASSWORD });
        expect(res.status).toBe(503);
        expect(res.body.error).toContain('v9_admin_accounts.sql');
    });
});

describe('x-admin-token', () => {
    it('authenticates as the account', async () => {
        accountsAre([account]);
        const res = await whoami();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: ID, email: 'lead@x.com' });
    });

    it('rejects a disabled or deleted account, which the query filters out', async () => {
        accountsAre([]);
        expect((await whoami()).status).toBe(401);
        expect(pool.query.mock.calls[0][0]).toContain('disabled_at IS NULL');
    });

    it('fails closed when the database errors', async () => {
        failAccounts(new Error('db down'));
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = await whoami();
        err.mockRestore();
        expect(res.status).toBe(503);
        expect(res.body.error).not.toContain('db down');
    });

    it('fails closed before the migration', async () => {
        failAccounts(missing());
        expect((await whoami()).status).toBe(401);
    });

    it('rejects a forged, expired, wrong-audience or malformed token', async () => {
        accountsAre([account]);
        const claims = { sub: ID, email: account.email };
        const secret = 'admin-jwt-test-secret';
        for (const token of [
            jwt.sign(claims, 'some-other-secret', { audience: 'surfer-admin' }),
            jwt.sign(claims, secret, { audience: 'surfer-admin', expiresIn: -1 }),
            jwt.sign(claims, secret), // for example a user's JWT signed with the same secret
            jwt.sign(claims, secret, { audience: 'surfer-admin', algorithm: 'HS512' }),
            'garbage',
        ]) {
            expect((await whoami(token)).status).toBe(401);
        }
    });

    it('rejects every token when ADMIN_JWT_SECRET is unset', async () => {
        const token = tokenFor();
        delete process.env.ADMIN_JWT_SECRET;
        accountsAre([account]);
        expect((await whoami(token)).status).toBe(401);
    });

    it('does not fall back to a good shared password when a bad token is sent', async () => {
        const res = await request(app).get('/whoami').set('x-admin-token', 'garbage').set('x-admin-password', 'admin-test');
        expect(res.status).toBe(401);
    });

    it('stops working as soon as the account is disabled here, despite the cache', async () => {
        accountsAre([account]);
        const token = tokenFor();
        expect((await whoami(token)).status).toBe(200);
        pool.query.mockClear();
        expect((await whoami(token)).status).toBe(200);
        expect(pool.query).not.toHaveBeenCalled(); // served from the cache

        pool.query.mockImplementation(async (sql) => (/UPDATE admin_accounts/.test(sql) ? { rows: [{ id: ID, email: account.email }] } : { rows: [] }));
        expect((await shared(request(app).patch(`/api/admin/accounts/${ID}`)).send({ disabled: true })).status).toBe(200);
        expect((await whoami(token)).status).toBe(401);
    });

    it('stops working after a password change, because the token carries the old password version', async () => {
        const token = tokenFor();
        accountsAre([{ ...account, password_hash: 'a-new-hash' }]);
        expect((await whoami(token)).status).toBe(401);
    });

    it('makes the audit actor the account email', async () => {
        pool.query.mockImplementation(async (sql) => {
            if (/SELECT email, password_hash FROM admin_accounts/.test(sql)) return { rows: [account] };
            if (/DELETE FROM admin_accounts/.test(sql)) return { rows: [{ email: 'old@x.com' }] };
            return { rows: [] };
        });
        await withToken(request(app).delete(`/api/admin/accounts/${OTHER}`));
        expect(auditCalls()[0][1][5]).toBe('lead@x.com');
    });
});

describe('/accounts', () => {
    const row = { id: OTHER, email: 'new@x.com', name: 'New', disabled_at: null, last_login: null, created_at: 'c', created_by: 'shared-password' };

    it('needs admin auth', async () => {
        expect((await request(app).get('/api/admin/accounts')).status).toBe(401);
        expect((await request(app).post('/api/admin/accounts').send({})).status).toBe(401);
    });

    it('GET never selects the hash and reports table_missing before the migration', async () => {
        accountsAre([row]);
        const ok = await shared(request(app).get('/api/admin/accounts'));
        expect(ok.body).toEqual({ success: true, accounts: [row], table_missing: false, me: null });
        expect(pool.query.mock.calls[0][0]).not.toContain('password_hash');
        failAccounts(missing());
        const none = await shared(request(app).get('/api/admin/accounts'));
        expect(none.status).toBe(200);
        expect(none.body).toEqual({ success: true, accounts: [], table_missing: true, me: null });
    });

    it('POST hashes the password and keeps it out of the response and the audit log', async () => {
        pool.query.mockImplementation(async (sql) => (/INSERT INTO admin_accounts/.test(sql) ? { rows: [row] } : { rows: [] }));
        const res = await shared(request(app).post('/api/admin/accounts')).send({ email: ' New@X.com ', password: PASSWORD, name: 'New' });
        expect(res.status).toBe(201);
        const params = pool.query.mock.calls.find(([sql]) => /INSERT INTO admin_accounts/.test(sql))[1];
        expect(params[0]).toBe('new@x.com');
        expect(params[1]).not.toBe(PASSWORD);
        expect(await bcrypt.compare(PASSWORD, params[1])).toBe(true);
        expect(params[3]).toBe('shared-password');
        expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[aby]\$/);
        expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
        expect(JSON.stringify(auditCalls())).not.toContain(PASSWORD);
        expect(JSON.stringify(auditCalls())).not.toMatch(/\$2[aby]\$/);
        expect(auditCalls()[0][1][0]).toBe('admin_account_create');
    });

    it.each([
        [{ email: 'bad', password: PASSWORD }],
        [{ email: 'a@x.com', password: 'short' }],
        [{ email: 'a@x.com', password: 'x'.repeat(73) }],
        [{ email: 'a@x.com' }],
        [{ email: 'a@x.com', password: PASSWORD, name: 5 }],
    ])('POST rejects %j', async (body) => {
        expect((await shared(request(app).post('/api/admin/accounts')).send(body)).status).toBe(400);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('POST answers 409 for a duplicate and 503 before the migration', async () => {
        failAccounts(Object.assign(new Error('dup'), { code: '23505' }));
        expect((await shared(request(app).post('/api/admin/accounts')).send({ email: 'a@x.com', password: PASSWORD })).status).toBe(409);
        failAccounts(missing());
        expect((await shared(request(app).post('/api/admin/accounts')).send({ email: 'a@x.com', password: PASSWORD })).status).toBe(503);
    });

    it('PATCH changes the password without logging it', async () => {
        pool.query.mockImplementation(async (sql) => (/UPDATE admin_accounts/.test(sql) ? { rows: [row] } : { rows: [] }));
        const res = await shared(request(app).patch(`/api/admin/accounts/${OTHER}`)).send({ password: PASSWORD, name: 'Renamed' });
        expect(res.status).toBe(200);
        const [sql, params] = pool.query.mock.calls.find(([s]) => /UPDATE admin_accounts/.test(s));
        expect(sql).toContain('password_hash = $2');
        expect(params[0]).toBe('Renamed');
        expect(await bcrypt.compare(PASSWORD, params[1])).toBe(true);
        expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
        expect(JSON.parse(auditCalls()[0][1][3])).toEqual({ account_id: OTHER, changed: ['name', 'password'] });
        expect(JSON.stringify(auditCalls())).not.toContain(PASSWORD);
    });

    it.each([
        ['a bad id', 'nope', { name: 'x' }],
        ['nothing to change', OTHER, {}],
        ['a short password', OTHER, { password: 'short' }],
        ['a non-boolean disabled', OTHER, { disabled: 'yes' }],
    ])('PATCH rejects %s', async (_, id, body) => {
        expect((await shared(request(app).patch(`/api/admin/accounts/${id}`)).send(body)).status).toBe(400);
    });

    it('PATCH answers 404 and 503 where it should', async () => {
        expect((await shared(request(app).patch(`/api/admin/accounts/${OTHER}`)).send({ name: 'x' })).status).toBe(404);
        failAccounts(missing());
        expect((await shared(request(app).patch(`/api/admin/accounts/${OTHER}`)).send({ name: 'x' })).status).toBe(503);
    });

    it('an admin cannot disable or delete their own account, but can rename it', async () => {
        accountsAre([account]);
        const token = tokenFor();
        expect((await withToken(request(app).patch(`/api/admin/accounts/${ID}`), token).send({ disabled: true })).status).toBe(400);
        expect((await withToken(request(app).delete(`/api/admin/accounts/${ID}`), token)).status).toBe(400);
        pool.query.mockImplementation(async (sql) => {
            if (/SELECT email, password_hash FROM admin_accounts/.test(sql)) return { rows: [account] };
            if (/UPDATE admin_accounts/.test(sql)) return { rows: [{ id: ID, email: account.email }] };
            return { rows: [] };
        });
        expect((await withToken(request(app).patch(`/api/admin/accounts/${ID}`), token).send({ name: 'Me' })).status).toBe(200);
    });

    it('DELETE removes the account, audits it and answers 404 and 503 where it should', async () => {
        pool.query.mockImplementation(async (sql) => (/DELETE FROM admin_accounts/.test(sql) ? { rows: [{ email: 'old@x.com' }] } : { rows: [] }));
        expect((await shared(request(app).delete(`/api/admin/accounts/${OTHER}`))).status).toBe(200);
        expect(auditCalls()[0][1][0]).toBe('admin_account_delete');
        expect(auditCalls()[0][1][2]).toBe('old@x.com');
        accountsAre([]);
        expect((await shared(request(app).delete(`/api/admin/accounts/${OTHER}`))).status).toBe(404);
        failAccounts(missing());
        expect((await shared(request(app).delete(`/api/admin/accounts/${OTHER}`))).status).toBe(503);
        expect((await shared(request(app).delete('/api/admin/accounts/nope'))).status).toBe(400);
    });

    it('a failed audit write does not break the action', async () => {
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        pool.query.mockImplementation(async (sql) => {
            if (/INSERT INTO admin_audit/.test(sql)) throw new Error('audit down');
            if (/DELETE FROM admin_accounts/.test(sql)) return { rows: [{ email: 'old@x.com' }] };
            return { rows: [] };
        });
        expect((await shared(request(app).delete(`/api/admin/accounts/${OTHER}`))).status).toBe(200);
        err.mockRestore();
    });
});

describe('GET /audit actions', () => {
    it('accepts the new action names', async () => {
        for (const action of ['admin_account_create', 'admin_account_update', 'admin_account_delete', 'ip_block', 'ip_unblock']) {
            expect((await shared(request(app).get(`/api/admin/audit?action=${action}`))).status).toBe(200);
        }
    });
});
