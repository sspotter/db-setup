const request = require('supertest');
const { createApp, loadConfig } = require('./server');

const TIK = 'http://tik.test';
const INSTA = 'http://insta.test';
const PW = 'dash-secret';
const config = {
    port: 0,
    host: '',
    password: PW,
    backends: {
        tiktok: { url: TIK, adminPassword: 'tik-admin' },
        instagram: { url: INSTA, adminPassword: 'insta-admin' },
    },
};

const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const refused = () => new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:8442') });

// A healthy backend keyed by path (query string ignored). Values: { status, body } or an Error to reject with.
function healthyBackend(name) {
    return {
        '/api/health': { body: { status: 'ok', database: 'connected' } },
        '/api/admin/health': {
            body: { version: '1.0.0', db: { ok: true, latency_ms: 2 }, migrations: { api_events: true, password_resets: true, duration_ms: true, last_seen: true } },
        },
        '/api/admin/alerts': { body: { success: true, alerts: [] } },
        '/api/admin/insights': { body: { success: true, slow: [{ method: 'GET', path: '/api/x', slow: 3, avg_ms: 2500, max_ms: 4000 }] } },
        '/api/admin/users': {
            body: { success: true, users: [{ id: 1, email: `a@${name}.test`, status: 'active', reset_link: 'secret-link' }] },
        },
        '/api/admin/events': { body: { success: true, events: [] } },
        '/api/auth/login': { status: 401, body: { error: 'Invalid credentials' } },
    };
}

let routes;
beforeEach(() => {
    routes = { [TIK]: healthyBackend('tik'), [INSTA]: healthyBackend('insta') };
    global.fetch = jest.fn(async (url) => {
        const u = new URL(url);
        const r = routes[u.origin][u.pathname];
        if (!r) throw new Error(`unmocked ${url}`);
        const v = typeof r === 'function' ? r(u) : r;
        if (v instanceof Error) throw v;
        return new Response(JSON.stringify(v.body), { status: v.status || 200 });
    });
});

const authed = (req) => req.set('x-dashboard-password', PW);
const fetchedUrls = () => global.fetch.mock.calls.map((c) => c[0]);

describe('auth', () => {
    test('/api/health is open', async () => {
        const res = await request(createApp(config)).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok', database: 'none' });
    });

    test.each([
        ['missing', undefined],
        ['wrong', 'nope'],
    ])('%s dashboard password -> 401', async (_, pw) => {
        let req = request(createApp(config)).get('/api/overview');
        if (pw) req = req.set('x-dashboard-password', pw);
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Unauthorized' });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('loadConfig', () => {
    test('throws naming every missing var', () => {
        expect(() => loadConfig({ PORT: '8444', TIK_URL: 'http://x', INSTA_URL: ' ' })).toThrow(
            'DASHBOARD_PASSWORD, TIK_ADMIN_PASSWORD, INSTA_URL, INSTA_ADMIN_PASSWORD'
        );
    });

    test('builds config and strips trailing slashes', () => {
        const c = loadConfig({
            PORT: '8444',
            DASHBOARD_PASSWORD: 'd',
            TIK_URL: 'http://localhost:8443/',
            TIK_ADMIN_PASSWORD: 't',
            INSTA_URL: 'http://localhost:8442//',
            INSTA_ADMIN_PASSWORD: 'i',
        });
        expect(c).toEqual({
            port: 8444,
            host: '',
            password: 'd',
            backends: {
                tiktok: { url: 'http://localhost:8443', adminPassword: 't' },
                instagram: { url: 'http://localhost:8442', adminPassword: 'i' },
            },
        });
    });
});

describe('GET /api/overview', () => {
    test('merges both sides with derived fields and no user rows', async () => {
        routes[TIK]['/api/admin/users'] = {
            body: { users: [{ email: 'a@x', status: 'active' }, { email: 'b@x', status: 'active' }, { email: 'c@x', status: 'suspended' }] },
        };
        routes[TIK]['/api/admin/events'] = {
            body: {
                events: [
                    { path: '/api/auth/login', status: 401 },
                    { path: '/api/auth/login', status: 401 },
                    { path: '/api/projects', status: 500 },
                    { path: '/api/projects', status: 404 },
                ],
            },
        };
        routes[INSTA]['/api/admin/health'] = {
            body: { version: '2.0.0', db: { ok: true, latency_ms: 1 }, migrations: { api_events: true, password_resets: false } },
        };

        const res = await authed(request(createApp(config)).get('/api/overview'));
        expect(res.status).toBe(200);
        expect(res.body.tiktok).toEqual({
            up: true,
            latency_ms: expect.any(Number),
            version: '1.0.0',
            db: { ok: true, latency_ms: 2 },
            migrations_ok: true,
            alerts: [],
            last_15m: { failed_logins: 2, server_errors: 1 },
            slow: [{ method: 'GET', path: '/api/x', slow: 3, avg_ms: 2500, max_ms: 4000 }],
            users: { total: 3, by_status: { active: 2, suspended: 1 } },
            errors: [],
        });
        expect(res.body.instagram.version).toBe('2.0.0');
        expect(res.body.instagram.migrations_ok).toBe(false);
        expect(Date.parse(res.body.generated_at)).not.toBeNaN();

        const text = JSON.stringify(res.body);
        expect(text).not.toMatch(/@|secret-link|admin/);

        const eventsUrl = new URL(fetchedUrls().find((u) => u.startsWith(`${TIK}/api/admin/events`)));
        expect(eventsUrl.searchParams.get('result')).toBe('failed');
        expect(eventsUrl.searchParams.get('limit')).toBe('1000');
        expect(Date.now() - Date.parse(eventsUrl.searchParams.get('since'))).toBeGreaterThanOrEqual(15 * 60 * 1000);
        const tikCall = global.fetch.mock.calls.find((c) => c[0].startsWith(TIK));
        expect(tikCall[1].headers['x-admin-password']).toBe('tik-admin');
    });

    test.each([
        ['network error', refused(), 'connect ECONNREFUSED 127.0.0.1:8442'],
        ['timeout', timeoutError(), 'timeout after 3000 ms'],
        ['HTTP 500', { status: 500, body: { status: 'error', database: 'disconnected', error: 'db gone' } }, 'HTTP 500: db gone'],
    ])('one backend down (%s) leaves the other intact', async (_, health, error) => {
        routes[INSTA]['/api/health'] = health;
        const res = await authed(request(createApp(config)).get('/api/overview'));
        expect(res.status).toBe(200);
        expect(res.body.instagram).toEqual({ up: false, error });
        expect(res.body.tiktok.up).toBe(true);
        expect(res.body.tiktok.errors).toEqual([]);
        expect(fetchedUrls().filter((u) => u.startsWith(`${INSTA}/api/admin`))).toEqual([]);
    });

    test('a failed admin call nulls only its field', async () => {
        routes[TIK]['/api/admin/alerts'] = { status: 401, body: { error: 'Unauthorized' } };
        routes[TIK]['/api/admin/health'] = timeoutError();
        const res = await authed(request(createApp(config)).get('/api/overview'));
        const tik = res.body.tiktok;
        expect(tik.alerts).toBeNull();
        expect(tik.version).toBeNull();
        expect(tik.db).toBeNull();
        expect(tik.migrations_ok).toBeNull();
        expect(tik.errors.sort()).toEqual(['alerts: HTTP 401', 'health: timeout after 3000 ms']);
        expect(tik.users).toEqual({ total: 1, by_status: { active: 1 } });
        expect(res.body.instagram.errors).toEqual([]);
    });
});

describe('GET /api/events', () => {
    beforeEach(() => {
        routes[TIK]['/api/admin/events'] = {
            body: {
                events: [
                    { id: 1, created_at: '2026-11-02T10:05:00.000Z' },
                    { id: 2, created_at: '2026-11-02T10:01:00.000Z' },
                ],
            },
        };
        routes[INSTA]['/api/admin/events'] = {
            body: {
                events: [
                    { id: 1, created_at: '2026-11-02T10:03:00.000Z' },
                    { id: 2, created_at: '2026-11-02T10:00:00.000Z' },
                ],
            },
        };
    });

    test('merges newest first, tags platform, slices to limit', async () => {
        const res = await authed(request(createApp(config)).get('/api/events?limit=3'));
        expect(res.status).toBe(200);
        expect(res.body.events.map((e) => `${e.platform}:${e.id}`)).toEqual(['tiktok:1', 'instagram:1', 'tiktok:2']);
        expect(res.body.errors).toEqual({});
        expect(fetchedUrls().every((u) => u.endsWith('limit=3'))).toBe(true);
    });

    test('platform=tiktok only queries tiktok', async () => {
        const res = await authed(request(createApp(config)).get('/api/events?platform=tiktok'));
        expect(res.body.events.map((e) => e.platform)).toEqual(['tiktok', 'tiktok']);
        expect(fetchedUrls()).toEqual([`${TIK}/api/admin/events?limit=100`]);
    });

    test('a failing backend is reported in errors', async () => {
        routes[INSTA]['/api/admin/events'] = timeoutError();
        const res = await authed(request(createApp(config)).get('/api/events?limit=9999'));
        expect(res.body.events).toHaveLength(2);
        expect(res.body.errors).toEqual({ instagram: 'timeout after 3000 ms' });
        expect(fetchedUrls()).toContain(`${TIK}/api/admin/events?limit=500`);
    });

    test('unknown platform -> 400', async () => {
        const res = await authed(request(createApp(config)).get('/api/events?platform=facebook'));
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'platform must be all, tiktok or instagram' });
    });
});

describe('POST /api/check', () => {
    test('reports per check; 401 passes, 200 fails, unreachable is status null; then cools down', async () => {
        routes[INSTA]['/api/auth/login'] = { status: 200, body: { token: 'x' } };
        routes[INSTA]['/api/health'] = refused();
        const app = createApp(config);

        const res = await authed(request(app).post('/api/check'));
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(false);
        expect(Date.parse(res.body.ran_at)).not.toBeNaN();
        expect(res.body.checks).toEqual([
            { platform: 'tiktok', name: 'health', ok: true, status: 200, ms: expect.any(Number), detail: 'database connected' },
            { platform: 'tiktok', name: 'failed_login', ok: true, status: 401, ms: expect.any(Number), detail: 'rejected as expected' },
            { platform: 'instagram', name: 'health', ok: false, status: null, ms: expect.any(Number), detail: 'connect ECONNREFUSED 127.0.0.1:8442' },
            { platform: 'instagram', name: 'failed_login', ok: false, status: 200, ms: expect.any(Number), detail: expect.any(String) },
        ]);
        const login = global.fetch.mock.calls.find((c) => c[0] === `${TIK}/api/auth/login`)[1];
        expect(login.method).toBe('POST');
        expect(JSON.parse(login.body)).toEqual({ email: 'smoke-check@dashboard.invalid', password: 'not-a-real-password' });

        const again = await authed(request(app).post('/api/check'));
        expect(again.status).toBe(429);
        expect(again.body.error).toBe('Checks ran recently');
        expect(again.body.retry_after_s).toBeGreaterThan(110);
        expect(again.body.retry_after_s).toBeLessThanOrEqual(120);
    });

    test('all passing -> ok true (fresh app has no cooldown)', async () => {
        const res = await authed(request(createApp(config)).post('/api/check'));
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.checks).toHaveLength(4);
    });

    test('health with disconnected database fails', async () => {
        routes[TIK]['/api/health'] = { status: 500, body: { status: 'error', database: 'disconnected' } };
        const res = await authed(request(createApp(config)).post('/api/check'));
        expect(res.body.checks[0]).toMatchObject({ ok: false, status: 500, detail: 'database disconnected' });
    });
});
