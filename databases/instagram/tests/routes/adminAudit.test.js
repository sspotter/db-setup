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
const auditRouter = require('../../routes/adminAudit');
const projectsRouter = require('../../routes/adminProjects');
const { recordAdminAction, clean } = require('../../utils/adminAudit');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);
app.use('/api/admin', auditRouter);
app.use('/api/admin', projectsRouter);

const admin = (r) => r.set('x-admin-password', 'admin-test');
const auditCalls = () => pool.query.mock.calls.filter(([sql]) => /INSERT INTO admin_audit/.test(sql));
// [action, target_user_id, target_email, detailJson, ip]
const lastAudit = () => {
    const calls = auditCalls();
    expect(calls.length).toBeGreaterThan(0);
    const [, p] = calls[calls.length - 1];
    return { action: p[0], user: p[1], email: p[2], detail: JSON.parse(p[3]), detailRaw: p[3], ip: p[4] };
};

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
let client;

beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
});

describe('recordAdminAction', () => {
    const req = { headers: { 'x-forwarded-for': 'forged, 203.0.113.9' }, ip: '10.0.0.1', socket: { remoteAddress: '127.0.0.1' } };

    it('stores action, target and the proxy-appended client IP (last X-Forwarded-For entry)', async () => {
        await recordAdminAction(req, { action: 'user_delete', target_user_id: UUID, target_email: 'a@x.com', detail: { n: 1 } });
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO admin_audit');
        expect(params).toEqual(['user_delete', UUID, 'a@x.com', '{"n":1}', '203.0.113.9', 'unknown']);
    });

    it('drops secret-looking keys and token-looking values from detail', () => {
        const out = clean({ password: 'p', new_password: 'p', reset_token: 't', link: 'l', password_hash: 'h', ok: 'fine', nested: { token: 'x', keep: 1 }, url: 'https://x/reset.html?token=abc' });
        expect(out).toEqual({ ok: 'fine', nested: { keep: 1 }, url: '[redacted]' });
    });

    it('never throws when the insert fails, and tolerates a missing table', async () => {
        pool.query.mockRejectedValueOnce(Object.assign(new Error('relation "admin_audit" does not exist'), { code: '42P01' }));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(recordAdminAction(req, { action: 'user_delete' })).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        pool.query.mockRejectedValueOnce(new Error('connection lost'));
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(recordAdminAction(req, { action: 'user_delete' })).resolves.toBeUndefined();
        expect(err).toHaveBeenCalled();
        warn.mockRestore();
        err.mockRestore();
    });
});

describe('admin mutations are audited', () => {
    it('create user: logs plan/status, never the password or hash', async () => {
        client.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: UUID, email: 'new@x.com', plan: 'pro', status: 'active', max_devices: 3 }] });
        const res = await admin(request(app).post('/api/admin/users')).send({ email: 'new@x.com', password: 'S3cret-pass', plan: 'pro' });
        expect(res.status).toBe(201);
        const a = lastAudit();
        expect(a).toMatchObject({ action: 'user_create', user: UUID, email: 'new@x.com' });
        expect(a.detail).toEqual({ plan: 'pro', status: 'active', max_devices: 3 });
        expect(a.detailRaw).not.toContain('S3cret-pass');
    });

    it('update user: logs which fields changed, not the password or the new email', async () => {
        client.query
            .mockResolvedValueOnce({ rows: [{ id: UUID, password_hash: 'old' }] })
            .mockResolvedValueOnce({ rows: [{ id: UUID, email: 'renamed@x.com', status: 'active', plan: 'pro', max_devices: 5 }] });
        const res = await admin(request(app).put(`/api/admin/users/${UUID}`)).send({ email: 'renamed@x.com', password: 'N3w-secret!', max_devices: 5 });
        expect(res.status).toBe(200);
        const a = lastAudit();
        expect(a.action).toBe('user_update');
        expect(a.detail.fields).toEqual(['email', 'password', 'max_devices']);
        expect(a.detailRaw).not.toContain('N3w-secret!');
        expect(a.detailRaw).not.toMatch(/\$2[aby]\$/); // no bcrypt hash
    });

    it('force logout, delete user', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: UUID, email: 'a@x.com' }] });
        expect((await admin(request(app).post(`/api/admin/users/${UUID}/logout`))).status).toBe(200);
        expect(lastAudit()).toMatchObject({ action: 'user_logout', user: UUID, email: 'a@x.com' });

        pool.query.mockResolvedValueOnce({ rows: [{ id: UUID, email: 'a@x.com' }] });
        expect((await admin(request(app).delete(`/api/admin/users/${UUID}`))).status).toBe(200);
        expect(lastAudit()).toMatchObject({ action: 'user_delete', user: UUID, email: 'a@x.com' });
    });

    it('does not audit a request that failed (404)', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        expect((await admin(request(app).delete(`/api/admin/users/${UUID}`))).status).toBe(404);
        expect(auditCalls()).toHaveLength(0);
    });

    it('reset link: logs the base only, never the token or the link', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id: UUID, email: 'a@x.com' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ expires_at: '2026-11-05T00:00:00Z' }] });
        const res = await admin(request(app).post(`/api/admin/users/${UUID}/reset-link`)).send({ base: 'https://reset.example:9000' });
        expect(res.status).toBe(200);
        const token = res.body.links[0].split('token=')[1];
        const a = lastAudit();
        expect(a.action).toBe('user_reset_link');
        expect(a.detail).toEqual({ bases: ['https://reset.example:9000'] });
        expect(JSON.stringify(auditCalls()[0][1])).not.toContain(token);
    });

    it('delete project: logs project name and counts', async () => {
        client.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({ rows: [{ id: PROJ, name: 'Barbican' }] })
            .mockResolvedValueOnce({ rows: [{ post_shortcode: 'a' }, { post_shortcode: 'b' }] })
            .mockResolvedValueOnce({}) // delete project
            .mockResolvedValueOnce({ rows: [{ shortcode: 'a' }] }) // orphans
            .mockResolvedValueOnce({}); // COMMIT
        const res = await admin(request(app).delete(`/api/admin/users/${UUID}/projects/${PROJ}`)).send({ confirm_name: 'Barbican' });
        expect(res.status).toBe(200);
        expect(lastAudit()).toMatchObject({
            action: 'project_delete', user: UUID,
            detail: { project_id: PROJ, project_name: 'Barbican', links_removed: 2, posts_deleted: 1 },
        });
    });

    it('an audit failure (table missing, or the insert fails) never fails the admin action', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        pool.query.mockImplementation(async (sql) => {
            if (/admin_audit/.test(sql)) throw Object.assign(new Error('boom'), { code: '42P01' });
            return { rows: [{ id: UUID, email: 'a@x.com' }] };
        });
        expect((await admin(request(app).post(`/api/admin/users/${UUID}/logout`))).status).toBe(200);
        pool.query.mockImplementation(async (sql) => {
            if (/admin_audit/.test(sql)) throw new Error('disk full');
            return { rows: [{ id: UUID, email: 'a@x.com' }] };
        });
        expect((await admin(request(app).delete(`/api/admin/users/${UUID}`))).status).toBe(200);
        warn.mockRestore();
        err.mockRestore();
    });
});

describe('POST /api/admin/login', () => {
    let n = 0;
    const ip = () => `198.51.100.${++n}`;
    const login = (password, address) => request(app).post('/api/admin/login').set('x-forwarded-for', address).send(password === undefined ? {} : { password });

    it('accepts the right password and audits it', async () => {
        const res = await login('admin-test', ip());
        expect(res.status).toBe(200);
        expect(lastAudit().action).toBe('admin_login');
    });

    it('rejects a wrong or missing password and audits the failure without the attempted value', async () => {
        const a = ip();
        expect((await login('wrong-guess-123', a)).status).toBe(401);
        const rec = lastAudit();
        expect(rec).toMatchObject({ action: 'admin_login_failed', ip: a, detail: { attempts: 1 } });
        expect(rec.detailRaw).not.toContain('wrong-guess-123');
        expect((await login(undefined, a)).status).toBe(401);
        expect((await request(app).post('/api/admin/login').set('x-forwarded-for', a).send({ password: 12345 })).status).toBe(401);
    });

    it('is not open when ADMIN_PASSWORD is unset and no password is sent', async () => {
        const saved = process.env.ADMIN_PASSWORD;
        delete process.env.ADMIN_PASSWORD;
        try {
            expect((await login(undefined, ip())).status).toBe(401);
        } finally {
            process.env.ADMIN_PASSWORD = saved;
        }
    });

    it('locks an IP out after 5 failures (429 + Retry-After, even for the right password) without affecting other IPs', async () => {
        const a = ip();
        for (let i = 0; i < 5; i++) expect((await login('nope', a)).status).toBe(401);
        expect(lastAudit()).toMatchObject({ action: 'admin_login_locked', detail: { attempts: 5 } });
        const before = auditCalls().length;
        const locked = await login('admin-test', a);
        expect(locked.status).toBe(429);
        expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
        expect(auditCalls().length).toBe(before); // a locked-out request is not recorded again
        expect((await login('admin-test', ip())).status).toBe(200);
    });

    it('a successful login clears earlier failures', async () => {
        const a = ip();
        for (let i = 0; i < 4; i++) await login('nope', a);
        expect((await login('admin-test', a)).status).toBe(200);
        for (let i = 0; i < 4; i++) expect((await login('nope', a)).status).toBe(401);
    });

    it('keys the lockout on the proxy-appended address, so a forged first entry does not dodge it', async () => {
        const real = ip();
        for (let i = 0; i < 5; i++) await request(app).post('/api/admin/login').set('x-forwarded-for', `fake-${i}, ${real}`).send({ password: 'nope' });
        expect((await request(app).post('/api/admin/login').set('x-forwarded-for', `another, ${real}`).send({ password: 'admin-test' })).status).toBe(429);
    });
});

describe('GET /api/admin/audit', () => {
    it('requires the admin password', async () => {
        expect((await request(app).get('/api/admin/audit')).status).toBe(401);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('lists rows newest first with a default limit of 100 and caps the limit at 500', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: 1, action: 'user_delete' }] });
        const res = await admin(request(app).get('/api/admin/audit'));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, table_missing: false, rows: [{ id: 1, action: 'user_delete' }] });
        expect(res.body.actions).toContain('project_delete');
        let [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('ORDER BY created_at DESC');
        expect(params).toEqual([100]);

        pool.query.mockResolvedValueOnce({ rows: [] });
        await admin(request(app).get('/api/admin/audit?limit=99999'));
        [, params] = pool.query.mock.calls[1];
        expect(params).toEqual([500]);
    });

    it('filters by action, since and q with bound parameters', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const res = await admin(request(app).get("/api/admin/audit?action=user_delete&since=2026-11-01T00:00:00Z&q=bob'; DROP TABLE users;--"));
        expect(res.status).toBe(200);
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('action = $1');
        expect(sql).toContain('created_at >= $2');
        expect(sql).toContain('ILIKE');
        expect(sql).not.toContain('DROP TABLE');
        expect(params).toEqual(['user_delete', new Date('2026-11-01T00:00:00Z'), "bob'; DROP TABLE users;--", 100]);
    });

    it('rejects an unknown action or a bad date without querying', async () => {
        expect((await admin(request(app).get('/api/admin/audit?action=drop_everything'))).status).toBe(400);
        expect((await admin(request(app).get('/api/admin/audit?since=not-a-date'))).status).toBe(400);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('reports table_missing instead of a 500 when the migration is not applied', async () => {
        pool.query.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
        const res = await admin(request(app).get('/api/admin/audit'));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, table_missing: true, rows: [] });
    });

    it('returns 500 for other database errors', async () => {
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        pool.query.mockRejectedValueOnce(new Error('connection lost'));
        expect((await admin(request(app).get('/api/admin/audit'))).status).toBe(500);
        err.mockRestore();
    });
});
