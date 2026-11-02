const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({ query: jest.fn(), end: jest.fn() }));
process.env.ADMIN_PASSWORD = 'admin-test';
const router = require('../../routes/adminInsights');

const app = express();
app.use('/api/admin', router);
const asAdmin = (url) => request(app).get(url).set('x-admin-password', 'admin-test');

describe('GET /api/admin/insights', () => {
    beforeEach(() => jest.clearAllMocks());

    it('requires the admin password', async () => {
        expect((await request(app).get('/api/admin/insights')).status).toBe(401);
    });

    it('marks versions older than the newest seen as outdated, comparing numerically', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [
                { ext_version: '1.2.0', users: 2, errors: 5, emails: ['a@x.com', 'b@x.com'] },
                { ext_version: '1.10.0', users: 1, errors: 0, emails: ['c@x.com'] },
            ] })
            .mockResolvedValueOnce({ rows: [{ method: 'GET', path: '/api/projects/:id', failures: 4, server_errors: 1 }] })
            .mockResolvedValueOnce({ rows: [{ day: '2026-10-30', errors: 1, client_errors: 3 }] })
            .mockResolvedValueOnce({ rows: [{ method: 'POST', path: '/api/posts', slow: 3, avg_ms: 2500, max_ms: 4000 }] });

        const res = await asAdmin('/api/admin/insights?days=7');

        expect(res.status).toBe(200);
        expect(res.body.latest_version).toBe('1.10.0');
        expect(res.body.versions.find((v) => v.ext_version === '1.2.0').outdated).toBe(true);
        expect(res.body.versions.find((v) => v.ext_version === '1.10.0').outdated).toBe(false);
        expect(res.body.top_failing[0].path).toBe('/api/projects/:id');
        expect(res.body.trend[0].errors).toBe(1);
        expect(res.body.slow[0].slow).toBe(3);
    });

    it('clamps days to 1..30 and passes it to every query', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        await asAdmin('/api/admin/insights?days=999');
        expect(pool.query.mock.calls[0][1][0]).toBe(30);
    });
});

describe('GET /api/admin/health', () => {
    beforeEach(() => jest.clearAllMocks());

    it('reports db ok, migrations and row counts', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // SELECT 1
            .mockResolvedValueOnce({ rows: [{ api_events: true, password_resets: true, duration_ms: true, last_seen: false }] })
            .mockResolvedValueOnce({ rows: [{ total: 42, oldest: '2026-09-01T00:00:00Z' }] });

        const res = await asAdmin('/api/admin/health');

        expect(res.status).toBe(200);
        expect(res.body.db.ok).toBe(true);
        expect(res.body.migrations.last_seen).toBe(false);
        expect(res.body.events.total).toBe(42);
        expect(typeof res.body.uptime_s).toBe('number');
        expect(res.body.version).toBeDefined();
    });

    it('still answers 200 with db.ok=false when the database is down', async () => {
        pool.query.mockRejectedValueOnce(new Error('connection refused'));
        const res = await asAdmin('/api/admin/health');
        expect(res.status).toBe(200);
        expect(res.body.db).toEqual({ ok: false, error: 'connection refused' });
    });
});

describe('GET /api/admin/alerts', () => {
    beforeEach(() => jest.clearAllMocks());

    it('raises an alert per noisy IP and for a 5xx spike', async () => {
        process.env.ALERT_5XX_PER_15MIN = '5';
        pool.query
            .mockResolvedValueOnce({ rows: [{ ip: '9.9.9.9', n: 12, accounts: 3 }] })
            .mockResolvedValueOnce({ rows: [{ n: 7 }] });

        const res = await asAdmin('/api/admin/alerts');

        expect(res.body.alerts.map((a) => a.type)).toEqual(['failed_logins_ip', 'server_errors']);
        expect(res.body.alerts[0].message).toContain('9.9.9.9');
    });

    it('returns no alerts below the thresholds', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ n: 1 }] });
        expect((await asAdmin('/api/admin/alerts')).body.alerts).toEqual([]);
    });
});
