const request = require('supertest');
const { createApp, loadConfig, createLockout } = require('./server');

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
            body: {
                version: '1.0.0', node: 'v24.0.0', uptime_s: 90061, retention: { days: 90, last_run: null },
                events: { total: 1234, oldest: '2026-08-01T00:00:00Z' },
                db: { ok: true, latency_ms: 2 }, migrations: { api_events: true, password_resets: true, duration_ms: true, last_seen: true },
            },
        },
        '/api/admin/alerts': { body: { success: true, alerts: [] } },
        '/api/admin/insights': { body: { success: true, days: 7, latest_version: '1.2.0', slow: [{ method: 'GET', path: '/api/x', slow: 3, avg_ms: 2500, max_ms: 4000 }], versions: [{ ext_version: '1.2.0', users: 3, errors: 0, outdated: false, emails: ['v@secret.test'] }, { ext_version: '1.1.0', users: 1, errors: 4, outdated: true, emails: ['old@secret.test'] }], top_failing: [{ method: 'GET', path: '/api/projects/:id', failures: 6, server_errors: 2, last_seen: '2026-11-02T10:00:00Z' }], trend: [{ day: '2026-11-01T00:00:00Z', errors: 2, client_errors: 5 }] } },
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
            adminLinks: { tiktok: '', instagram: '' },
        });
    });

    test('keeps only http(s) admin page addresses and adds /admin.html', () => {
        const base = { PORT: '8444', DASHBOARD_PASSWORD: 'd', TIK_URL: 'http://a', TIK_ADMIN_PASSWORD: 't', INSTA_URL: 'http://b', INSTA_ADMIN_PASSWORD: 'i' };
        const c = loadConfig({ ...base, TIK_ADMIN_URL: ' https://tik.example:8443/ ', INSTA_ADMIN_URL: 'javascript:alert(1)' });
        expect(c.adminLinks).toEqual({ tiktok: 'https://tik.example:8443/admin.html', instagram: '' });
        expect(loadConfig({ ...base, TIK_ADMIN_URL: 'http://x/admin.html' }).adminLinks.tiktok).toBe('http://x/admin.html');
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
            health_details: { uptime_s: 90061, node: 'v24.0.0', retention: { days: 90, last_run: null }, events: { total: 1234, oldest: '2026-08-01T00:00:00Z' } },
            insights: {
                days: 7,
                latest_version: '1.2.0',
                versions: [{ ext_version: '1.2.0', users: 3, errors: 0, outdated: false }, { ext_version: '1.1.0', users: 1, errors: 4, outdated: true }],
                top_failing: [{ method: 'GET', path: '/api/projects/:id', failures: 6, server_errors: 2, last_seen: '2026-11-02T10:00:00Z' }],
                trend: [{ day: '2026-11-01T00:00:00Z', errors: 2, client_errors: 5 }],
            },
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
        expect(text).not.toMatch(/@|secret|admin/);
        expect(fetchedUrls()).toEqual(expect.arrayContaining([`${TIK}/api/admin/insights?days=1`, `${TIK}/api/admin/insights?days=7`]));

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

describe('GET /api/links', () => {
    test('needs the dashboard password', async () => {
        expect((await request(createApp(config)).get('/api/links')).status).toBe(401);
    });

    test('returns the configured admin page addresses, empty when none', async () => {
        const none = await authed(request(createApp(config)).get('/api/links'));
        expect(none.body).toEqual({ tiktok: '', instagram: '' });
        const links = { tiktok: 'https://t.example/admin.html', instagram: 'https://i.example/admin.html' };
        const set = await authed(request(createApp({ ...config, adminLinks: links })).get('/api/links'));
        expect(set.body).toEqual(links);
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

    test('passes whitelisted filters on, encoded, and nothing else', async () => {
        const since = '2026-11-02T09:00:00.000Z';
        const res = await authed(
            request(createApp(config)).get('/api/events').query({ platform: 'tiktok', result: 'failed', action: 'login', user: 'a b@x.test', q: '10.0.0.1&x=1', since, secret: 'nope' })
        );
        expect(res.status).toBe(200);
        const url = new URL(fetchedUrls()[0]);
        expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '100', result: 'failed', action: 'login', user: 'a b@x.test', q: '10.0.0.1&x=1', since });
        expect(fetchedUrls()[0]).toContain('q=10.0.0.1%26x%3D1');
    });

    test.each([
        ['result=bogus'], ['action=everything'], ['since=yesterday'], [`q=${'x'.repeat(201)}`], ['user[]=a'], ['result[]=failed'],
    ])('rejects bad filter %s with 400 and calls no backend', async (qs) => {
        const res = await authed(request(createApp(config)).get(`/api/events?${qs}`));
        expect(res.status).toBe(400);
        expect(fetchedUrls()).toEqual([]);
    });

    test('adds up the backends\' stats and keeps going when one has none', async () => {
        routes[TIK]['/api/admin/events'] = { body: { events: [], stats: { all_time: 10, today: 2, matching: 5, failed: 1, distinct_users: 3, extra: 'x' } } };
        routes[INSTA]['/api/admin/events'] = { body: { events: [], stats: { all_time: 4, today: 1, matching: 2, failed: 2, distinct_users: 1 } } };
        let res = await authed(request(createApp(config)).get('/api/events'));
        expect(res.body.stats).toEqual({ all_time: 14, today: 3, matching: 7, failed: 3, distinct_users: 4 });
        res = await authed(request(createApp(config)).get('/api/events?platform=instagram'));
        expect(res.body.stats).toEqual({ all_time: 4, today: 1, matching: 2, failed: 2, distinct_users: 1 });
        routes[TIK]['/api/admin/events'] = { body: { events: [] } };
        routes[INSTA]['/api/admin/events'] = { body: { events: [] } };
        res = await authed(request(createApp(config)).get('/api/events'));
        expect(res.body.stats).toBeNull();
    });

    test('event rows keep ip, user agent, extension version and server error', async () => {
        routes[TIK]['/api/admin/events'] = {
            body: { events: [{ id: 1, created_at: '2026-11-02T10:05:00.000Z', ip: '1.2.3.4', user_agent: 'UA', ext_version: '1.2.0', server_error: 'boom' }] },
        };
        const res = await authed(request(createApp(config)).get('/api/events?platform=tiktok'));
        expect(res.body.events[0]).toMatchObject({ ip: '1.2.3.4', user_agent: 'UA', ext_version: '1.2.0', server_error: 'boom', platform: 'tiktok' });
    });
});

describe('GET /api/users', () => {
    const row = {
        id: 7, email: 'a@tik.test', status: 'active', plan: 'pro', active_sessions: 2, max_devices: 3,
        last_login: '2026-11-01T00:00:00Z', last_seen: '2026-11-02T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
        ext_version: '1.2.0', recent_logins: 1, ghost_sessions: 1, password_hash: 'HASH',
        last_issue: { reason: 'bad', status: 401, path: '/api/x', error: 'nope', created_at: '2026-11-02T01:00:00Z', ip: '9.9.9.9' },
        reset_link: { status: 'pending', created_at: '2026-11-02T02:00:00Z', expires_at: '2026-11-03T02:00:00Z', url: 'https://x/reset?token=TOKEN', token: 'TOKEN' },
    };

    test('needs the dashboard password', async () => {
        expect((await request(createApp(config)).get('/api/users?platform=tiktok')).status).toBe(401);
        expect(fetchedUrls()).toEqual([]);
    });

    test.each([[''], ['?platform=all'], ['?platform=facebook'], ['?platform[]=tiktok']])('bad platform %s -> 400', async (qs) => {
        const res = await authed(request(createApp(config)).get(`/api/users${qs}`));
        expect(res.status).toBe(400);
        expect(fetchedUrls()).toEqual([]);
    });

    test('returns whitelisted fields only: no reset link URL or token, no other columns', async () => {
        routes[TIK]['/api/admin/users'] = { body: { success: true, users: [row] } };
        const res = await authed(request(createApp(config)).get('/api/users?platform=tiktok'));
        expect(res.status).toBe(200);
        expect(fetchedUrls()).toEqual([`${TIK}/api/admin/users`]);
        expect(res.body.platform).toBe('tiktok');
        expect(res.body.users).toEqual([{
            id: 7, email: 'a@tik.test', status: 'active', plan: 'pro', active_sessions: 2, max_devices: 3,
            last_login: '2026-11-01T00:00:00Z', last_seen: '2026-11-02T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
            ext_version: '1.2.0', recent_logins: 1, ghost_sessions: 1,
            last_issue: { reason: 'bad', status: 401, path: '/api/x', error: 'nope', created_at: '2026-11-02T01:00:00Z' },
            reset_link: { status: 'pending', created_at: '2026-11-02T02:00:00Z', expires_at: '2026-11-03T02:00:00Z' },
        }]);
        expect(JSON.stringify(res.body)).not.toMatch(/TOKEN|HASH|9\.9\.9\.9/);
    });

    test('users without issues or reset links come back with nulls; a string reset_link is dropped', async () => {
        routes[INSTA]['/api/admin/users'] = { body: { users: [{ id: 1, email: 'b@x', reset_link: 'https://x/reset?token=T' }] } };
        const res = await authed(request(createApp(config)).get('/api/users?platform=instagram'));
        expect(res.body.users[0]).toEqual({ id: 1, email: 'b@x', last_issue: null, reset_link: {} });
        expect(JSON.stringify(res.body)).not.toMatch(/token=T/);
    });

    test('a failing backend -> 502 with its reason', async () => {
        routes[TIK]['/api/admin/users'] = timeoutError();
        const res = await authed(request(createApp(config)).get('/api/users?platform=tiktok'));
        expect(res.status).toBe(502);
        expect(res.body).toEqual({ error: 'timeout after 3000 ms' });
    });
});

describe('GET /api/usage', () => {
    const body = {
        success: true, days: 30, stuck_after_minutes: 30, storage_basis: 'row_counts',
        users: [{ id: 1, email: 'a@tik.test', plan: 'pro', status: 'active', sessions: 2, jobs_total: 5, jobs_failed: 1, jobs_stuck: 1, api_calls: 9, comments_scraped: 7, saved_posts: 3, projects: 1, videos: 4, keywords: 2, tiktok_comments: 6, usage_score: 14, password_hash: 'HASH' }],
        top_users: [{ id: 1, email: 'a@tik.test', usage_score: 14, password_hash: 'HASH' }],
        failed_jobs: [{ id: 3, user_id: 1, email: 'a@tik.test', post_shortcode: 'abc', status: 'failed', retry_count: 2, max_retries: 3, error_message: 'boom', created_at: '2026-11-02T00:00:00Z', session_token: 'TOKEN' }],
    };

    test('needs the dashboard password', async () => {
        expect((await request(createApp(config)).get('/api/usage?platform=tiktok')).status).toBe(401);
        expect(fetchedUrls()).toEqual([]);
    });

    test.each([[''], ['platform=all'], ['platform[]=tiktok'], ['platform=tiktok&days=0'], ['platform=tiktok&days=91'], ['platform=tiktok&days=7x'], ['platform=tiktok&days[]=7']])(
        'bad query "%s" -> 400 and no backend call',
        async (qs) => {
            const res = await authed(request(createApp(config)).get(`/api/usage?${qs}`));
            expect(res.status).toBe(400);
            expect(fetchedUrls()).toEqual([]);
        }
    );

    test('builds the backend URL, defaults to 30 days and returns listed fields only', async () => {
        routes[TIK]['/api/admin/usage'] = { body };
        const res = await authed(request(createApp(config)).get('/api/usage?platform=tiktok'));
        expect(res.status).toBe(200);
        expect(fetchedUrls()).toEqual([`${TIK}/api/admin/usage?days=30`]);
        expect(res.body.users[0]).toMatchObject({ email: 'a@tik.test', jobs_stuck: 1, videos: 4, usage_score: 14 });
        expect(res.body.failed_jobs[0]).toEqual({ id: 3, email: 'a@tik.test', post_shortcode: 'abc', status: 'failed', retry_count: 2, max_retries: 3, error_message: 'boom', created_at: '2026-11-02T00:00:00Z' });
        expect(res.body.stuck_after_minutes).toBe(30);
        expect(JSON.stringify(res.body)).not.toMatch(/HASH|TOKEN/);
    });

    test('uses the longer timeout, for usage only', async () => {
        const spy = jest.spyOn(AbortSignal, 'timeout');
        routes[INSTA]['/api/admin/usage'] = { body };
        try {
            await authed(request(createApp(config)).get('/api/usage?platform=instagram&days=90'));
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith(15000);
            expect(fetchedUrls()).toEqual([`${INSTA}/api/admin/usage?days=90`]);
            spy.mockClear();
            await authed(request(createApp(config)).get('/api/users?platform=tiktok'));
            expect(spy).toHaveBeenCalledWith(3000);
        } finally {
            spy.mockRestore();
        }
    });

    test.each([
        ['timeout', timeoutError(), 'timeout after 15000 ms'],
        ['a backend without the route', { status: 404, body: null }, 'Usage is not available on this backend yet (it needs the update)'],
        ['HTTP 500', { status: 500, body: { error: 'Internal server error' } }, 'HTTP 500: Internal server error'],
    ])('%s -> 502 with a readable reason', async (_, answer, error) => {
        routes[TIK]['/api/admin/usage'] = answer;
        const res = await authed(request(createApp(config)).get('/api/usage?platform=tiktok'));
        expect(res.status).toBe(502);
        expect(res.body).toEqual({ error });
    });
});

describe('GET /api/audit', () => {
    const rowsOf = (...rows) => ({ body: { success: true, table_missing: false, actions: ['user_create', 'user_delete'], rows } });

    test('needs the dashboard password', async () => {
        expect((await request(createApp(config)).get('/api/audit')).status).toBe(401);
    });

    test.each([['platform=facebook'], ['action=DROP%20TABLE'], ['action[]=user_create'], ['since=yesterday'], [`q=${'x'.repeat(201)}`], ['q[]=a']])(
        'bad query "%s" -> 400 and no backend call',
        async (qs) => {
            const res = await authed(request(createApp(config)).get(`/api/audit?${qs}`));
            expect(res.status).toBe(400);
            expect(fetchedUrls()).toEqual([]);
        }
    );

    test('merges newest first, tags the platform, slices to limit and unions actions', async () => {
        routes[TIK]['/api/admin/audit'] = rowsOf({ id: 1, action: 'user_create', created_at: '2026-11-02T10:05:00Z' }, { id: 2, action: 'user_delete', created_at: '2026-11-02T10:01:00Z' });
        routes[INSTA]['/api/admin/audit'] = { body: { table_missing: false, actions: ['project_delete'], rows: [{ id: 1, action: 'project_delete', created_at: '2026-11-02T10:03:00Z' }] } };
        const res = await authed(request(createApp(config)).get('/api/audit?limit=2'));
        expect(res.status).toBe(200);
        expect(res.body.rows.map((r) => `${r.platform}:${r.id}`)).toEqual(['tiktok:1', 'instagram:1']);
        expect(res.body.actions.sort()).toEqual(['project_delete', 'user_create', 'user_delete']);
        expect(res.body.errors).toEqual({});
        expect(res.body.table_missing).toEqual([]);
    });

    test('forwards only the whitelisted filters, encoded', async () => {
        routes[TIK]['/api/admin/audit'] = rowsOf();
        const since = '2026-11-02T09:00:00.000Z';
        await authed(request(createApp(config)).get('/api/audit').query({ platform: 'tiktok', action: 'user_delete', q: 'a&b=1', since, limit: '9999', extra: 'nope' }));
        const url = new URL(fetchedUrls()[0]);
        expect(url.origin + url.pathname).toBe(`${TIK}/api/admin/audit`);
        expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '500', action: 'user_delete', q: 'a&b=1', since });
    });

    test('reports a failing backend in errors and a missing table by platform', async () => {
        routes[TIK]['/api/admin/audit'] = { body: { success: true, table_missing: true, actions: [], rows: [] } };
        routes[INSTA]['/api/admin/audit'] = { status: 404, body: null };
        const res = await authed(request(createApp(config)).get('/api/audit'));
        expect(res.status).toBe(200);
        expect(res.body.table_missing).toEqual(['tiktok']);
        expect(res.body.errors).toEqual({ instagram: 'The audit log is not available on this backend yet (it needs the update)' });
    });

    test('drops unlisted columns and any secret in detail', async () => {
        routes[TIK]['/api/admin/audit'] = rowsOf({
            id: 1, action: 'user_reset_link', created_at: '2026-11-02T10:05:00Z', ip: '1.2.3.4', internal: 'x',
            detail: { base: 'https://a.test', link: 'https://a.test/reset?token=T1', nested: { password: 'P1', note: 'see ?token=T2', kept: 1 }, list: ['Bearer T3'] },
        });
        const res = await authed(request(createApp(config)).get('/api/audit?platform=tiktok'));
        expect(res.body.rows[0]).toEqual({
            id: 1, action: 'user_reset_link', created_at: '2026-11-02T10:05:00Z', ip: '1.2.3.4', platform: 'tiktok',
            detail: { base: 'https://a.test', nested: { note: '[redacted]', kept: 1 }, list: ['[redacted]'] },
        });
    });
});

describe('GET /api/expiring', () => {
    test('needs the dashboard password', async () => {
        expect((await request(createApp(config)).get('/api/expiring')).status).toBe(401);
    });

    test.each([['days=0'], ['days=366'], ['days=abc'], ['days[]=7']])('bad query "%s" -> 400 and no backend call', async (qs) => {
        const res = await authed(request(createApp(config)).get(`/api/expiring?${qs}`));
        expect(res.status).toBe(400);
        expect(fetchedUrls()).toEqual([]);
    });

    test('merges both platforms soonest first, listed fields only; a missing column is a note, not an error', async () => {
        routes[TIK]['/api/admin/users/expiring'] = { body: { days: 14, columns_missing: false, users: [{ id: 1, email: 'a@tik.test', plan: 'pro', status: 'active', plan_expires_at: '2026-11-10T00:00:00Z', trial_ends_at: null, lapses_at: '2026-11-10T00:00:00Z', lapsed: false, password_hash: 'HASH' }, { id: 2, email: 'b@tik.test', lapses_at: '2026-11-01T00:00:00Z', lapsed: true }] } };
        routes[INSTA]['/api/admin/users/expiring'] = { body: { days: 14, columns_missing: true, users: [] } };
        const res = await authed(request(createApp(config)).get('/api/expiring'));
        expect(res.status).toBe(200);
        expect(fetchedUrls().sort()).toEqual([`${INSTA}/api/admin/users/expiring?days=14`, `${TIK}/api/admin/users/expiring?days=14`]);
        expect(res.body.users.map((u) => u.email)).toEqual(['b@tik.test', 'a@tik.test']);
        expect(res.body.users[0].platform).toBe('tiktok');
        expect(res.body.columns_missing).toEqual(['instagram']);
        expect(res.body.errors).toEqual({});
        expect(JSON.stringify(res.body)).not.toMatch(/HASH/);
    });

    test('a failing backend is reported in errors and the other still answers', async () => {
        routes[TIK]['/api/admin/users/expiring'] = timeoutError();
        routes[INSTA]['/api/admin/users/expiring'] = { body: { users: [{ id: 1, email: 'c@i.test', lapses_at: '2026-11-01T00:00:00Z' }] } };
        const res = await authed(request(createApp(config)).get('/api/expiring?days=7'));
        expect(res.body.errors).toEqual({ tiktok: 'timeout after 3000 ms' });
        expect(res.body.users).toHaveLength(1);
    });
});

describe('blocked IPs', () => {
    const postBlock = (app, body) => authed(request(app).post('/api/blocked-ips')).send(body);
    const callTo = (url) => global.fetch.mock.calls.find((c) => c[0] === url);

    test('all three routes need the dashboard password', async () => {
        const app = createApp(config);
        expect((await request(app).get('/api/blocked-ips')).status).toBe(401);
        expect((await request(app).post('/api/blocked-ips').send({ platform: 'tiktok', ip: '1.2.3.4' })).status).toBe(401);
        expect((await request(app).delete('/api/blocked-ips/tiktok/1.2.3.4')).status).toBe(401);
        expect(fetchedUrls()).toEqual([]);
    });

    test('GET merges both platforms, keeps listed fields, and reports missing tables and old backends', async () => {
        routes[TIK]['/api/admin/blocked-ips'] = { body: { success: true, table_missing: false, blocks: [{ ip: '1.2.3.4', reason: 'r', blocked_by: 'admin', created_at: '2026-11-02T00:00:00Z', expires_at: '2026-11-03T00:00:00Z', internal: 'x' }] } };
        routes[INSTA]['/api/admin/blocked-ips'] = { status: 404, body: null };
        const res = await authed(request(createApp(config)).get('/api/blocked-ips'));
        expect(res.status).toBe(200);
        expect(res.body.blocks).toEqual([{ ip: '1.2.3.4', reason: 'r', blocked_by: 'admin', created_at: '2026-11-02T00:00:00Z', expires_at: '2026-11-03T00:00:00Z', platform: 'tiktok' }]);
        expect(res.body.errors).toEqual({ instagram: 'IP blocking is not available on this backend yet (it needs the update)' });

        routes[INSTA]['/api/admin/blocked-ips'] = { body: { table_missing: true, blocks: [] } };
        const again = await authed(request(createApp(config)).get('/api/blocked-ips?platform=instagram'));
        expect(again.body.table_missing).toEqual(['instagram']);
        expect(fetchedUrls().at(-1)).toBe(`${INSTA}/api/admin/blocked-ips`);
    });

    test('GET rejects an unknown platform', async () => {
        const res = await authed(request(createApp(config)).get('/api/blocked-ips?platform=facebook'));
        expect(res.status).toBe(400);
        expect(fetchedUrls()).toEqual([]);
    });

    test.each([
        ['bad platform', { platform: 'all', ip: '1.2.3.4' }],
        ['missing platform', { ip: '1.2.3.4' }],
        ['not an IP', { platform: 'tiktok', ip: '1.2.3.4/24' }],
        ['a host name', { platform: 'tiktok', ip: 'evil.example' }],
        ['ip not a string', { platform: 'tiktok', ip: ['1.2.3.4'] }],
        ['loopback v4', { platform: 'tiktok', ip: '127.0.0.1' }],
        ['loopback v6', { platform: 'tiktok', ip: '::1' }],
        ['mapped loopback', { platform: 'tiktok', ip: '::ffff:127.0.0.1' }],
        ['hours too low', { platform: 'tiktok', ip: '1.2.3.4', hours: 0 }],
        ['hours too high', { platform: 'tiktok', ip: '1.2.3.4', hours: 721 }],
        ['hours fractional', { platform: 'tiktok', ip: '1.2.3.4', hours: 1.5 }],
        ['hours as text', { platform: 'tiktok', ip: '1.2.3.4', hours: '24' }],
        ['reason too long', { platform: 'tiktok', ip: '1.2.3.4', reason: 'x'.repeat(201) }],
        ['reason not text', { platform: 'tiktok', ip: '1.2.3.4', reason: { a: 1 } }],
    ])('POST rejects %s with no backend call', async (_, body) => {
        const res = await postBlock(createApp(config), body);
        expect(res.status).toBe(400);
        expect(fetchedUrls()).toEqual([]);
    });

    test('POST with broken JSON -> 400 as JSON, no stack trace', async () => {
        const res = await authed(request(createApp(config)).post('/api/blocked-ips')).set('content-type', 'application/json').send('{not json');
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid request body' });
    });

    test('POST sends only ip, hours and reason to the chosen backend, with its admin password', async () => {
        routes[INSTA]['/api/admin/blocked-ips'] = { status: 201, body: { success: true } };
        const res = await postBlock(createApp(config), { platform: 'instagram', ip: '2001:db8::1', hours: 168, reason: 'guessing', extra: 'nope' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, platform: 'instagram', ip: '2001:db8::1', hours: 168 });
        const [url, init] = callTo(`${INSTA}/api/admin/blocked-ips`);
        expect(url).toBe(`${INSTA}/api/admin/blocked-ips`);
        expect(init.method).toBe('POST');
        expect(init.headers['x-admin-password']).toBe('insta-admin');
        expect(JSON.parse(init.body)).toEqual({ ip: '2001:db8::1', hours: 168, reason: 'guessing' });
        expect(fetchedUrls()).toHaveLength(1);
    });

    test('POST defaults to 24 hours', async () => {
        routes[TIK]['/api/admin/blocked-ips'] = { body: { success: true } };
        await postBlock(createApp(config), { platform: 'tiktok', ip: '1.2.3.4' });
        expect(JSON.parse(callTo(`${TIK}/api/admin/blocked-ips`)[1].body)).toEqual({ ip: '1.2.3.4', hours: 24 });
    });

    test.each([
        ['route missing', { status: 404, body: null }, 502, 'IP blocking is not available on this backend yet (it needs the update)'],
        ['503 with no wording', { status: 503, body: null }, 502, 'IP blocking is not ready on this backend (its migration is not applied)'],
        ['503 with wording', { status: 503, body: { error: 'Apply migration v9' } }, 502, 'Apply migration v9'],
        ['backend validation', { status: 400, body: { error: 'Invalid IP' } }, 400, 'HTTP 400: Invalid IP'],
        ['unreachable', refused(), 502, 'connect ECONNREFUSED 127.0.0.1:8442'],
    ])('POST: %s renders as a readable message', async (_, answer, status, error) => {
        routes[TIK]['/api/admin/blocked-ips'] = answer;
        const res = await postBlock(createApp(config), { platform: 'tiktok', ip: '1.2.3.4' });
        expect(res.status).toBe(status);
        expect(res.body).toEqual({ error });
    });

    test.each([['/api/blocked-ips/facebook/1.2.3.4'], ['/api/blocked-ips/all/1.2.3.4'], ['/api/blocked-ips/tiktok/not-an-ip'], ['/api/blocked-ips/tiktok/..%2Fusers']])(
        'DELETE %s -> 400 and no backend call',
        async (path) => {
            const res = await authed(request(createApp(config)).delete(path));
            expect(res.status).toBe(400);
            expect(fetchedUrls()).toEqual([]);
        }
    );

    test('DELETE encodes the IP and uses the chosen backend; loopback can still be unblocked', async () => {
        routes[TIK]['/api/admin/blocked-ips/2001%3Adb8%3A%3A1'] = { body: { success: true } };
        routes[INSTA]['/api/admin/blocked-ips/127.0.0.1'] = { body: { success: true } };
        const app = createApp(config);
        const res = await authed(request(app).delete(`/api/blocked-ips/tiktok/${encodeURIComponent('2001:db8::1')}`));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, platform: 'tiktok', ip: '2001:db8::1' });
        expect(global.fetch.mock.calls[0][1].method).toBe('DELETE');
        expect(fetchedUrls()).toEqual([`${TIK}/api/admin/blocked-ips/2001%3Adb8%3A%3A1`]);
        expect((await authed(request(app).delete('/api/blocked-ips/instagram/127.0.0.1'))).status).toBe(200);
    });

    test('DELETE keeps the wording of a JSON 404 from a backend that has the feature', async () => {
        routes[TIK]['/api/admin/blocked-ips/1.2.3.4'] = { status: 404, body: { error: 'No block for that IP' } };
        const res = await authed(request(createApp(config)).delete('/api/blocked-ips/tiktok/1.2.3.4'));
        expect(res.status).toBe(502);
        expect(res.body).toEqual({ error: 'HTTP 404: No block for that IP' });
    });

    test('/api/overview passes the alert count, accounts and IP through', async () => {
        routes[TIK]['/api/admin/alerts'] = { body: { alerts: [{ type: 'failed_logins_ip', severity: 'danger', message: 'm', ip: '1.2.3.4', count: 12, accounts: 3 }] } };
        const res = await authed(request(createApp(config)).get('/api/overview'));
        expect(res.body.tiktok.alerts[0]).toMatchObject({ ip: '1.2.3.4', count: 12, accounts: 3 });
    });
});

describe('dashboard password lockout', () => {
    const guess = (app, pw) => request(app).get('/api/links').set('x-dashboard-password', pw);
    const lockOut = async (app) => {
        for (let i = 1; i <= 5; i++) expect((await guess(app, `wrong-${i}`)).status).toBe(401);
    };
    afterEach(() => jest.restoreAllMocks());

    test('five different wrong passwords lock the IP, even the right password gets 429 and no backend is called', async () => {
        const app = createApp(config);
        await lockOut(app);
        const res = await authed(request(app).get('/api/overview'));
        expect(res.status).toBe(429);
        expect(res.body).toEqual({ error: 'Too many wrong passwords', locked: true, retry_after_s: expect.any(Number) });
        expect(res.body.retry_after_s).toBeGreaterThan(890);
        expect(res.body.retry_after_s).toBeLessThanOrEqual(900);
        expect(res.headers['retry-after']).toBe(String(res.body.retry_after_s));
        expect(fetchedUrls()).toEqual([]);
    });

    test('wrong passwords on any route count, and /api/health stays open', async () => {
        const app = createApp(config);
        const paths = ['/api/overview', '/api/events', '/api/users', '/api/usage', '/api/audit'];
        for (const [i, path] of paths.entries()) {
            expect((await request(app).get(path).set('x-dashboard-password', `wrong-${i}`)).status).toBe(401);
        }
        expect((await authed(request(app).get('/api/links'))).status).toBe(429);
        expect((await request(app).get('/api/health')).status).toBe(200);
    });

    test('one stale password resent many times does not lock its owner out', async () => {
        const app = createApp(config);
        for (let i = 0; i < 20; i++) expect((await guess(app, 'stale')).status).toBe(401);
        expect((await authed(request(app).get('/api/links'))).status).toBe(200);
    });

    test('the right password clears the count', async () => {
        const app = createApp(config);
        for (let i = 1; i <= 4; i++) await guess(app, `wrong-${i}`);
        expect((await authed(request(app).get('/api/links'))).status).toBe(200);
        for (let i = 5; i <= 8; i++) expect((await guess(app, `wrong-${i}`)).status).toBe(401);
        expect((await authed(request(app).get('/api/links'))).status).toBe(200);
    });

    test('the lock ends when the 15 minutes are up', async () => {
        const start = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
        const app = createApp(config);
        await lockOut(app);
        clock.mockReturnValue(start + 15 * 60 * 1000 - 1000);
        expect((await authed(request(app).get('/api/links'))).status).toBe(429);
        clock.mockReturnValue(start + 15 * 60 * 1000);
        expect((await authed(request(app).get('/api/links'))).status).toBe(200);
    });

    test('a forged X-Forwarded-For does not get around the lock', async () => {
        const app = createApp(config);
        for (let i = 1; i <= 5; i++) {
            await request(app).get('/api/links').set('x-dashboard-password', `wrong-${i}`).set('x-forwarded-for', `10.0.0.${i}`);
        }
        const res = await authed(request(app).get('/api/links')).set('x-forwarded-for', '10.9.9.9');
        expect(res.status).toBe(429);
    });

    test('apps do not share a counter', async () => {
        await lockOut(createApp(config));
        expect((await authed(request(createApp(config)).get('/api/links'))).status).toBe(200);
    });

    test('the cooldown 429 from /api/check is not reported as a lock', async () => {
        const app = createApp(config);
        await authed(request(app).post('/api/check'));
        const res = await authed(request(app).post('/api/check'));
        expect(res.status).toBe(429);
        expect(res.body.locked).toBeUndefined();
    });

    test('the map stays within its size limit by dropping the oldest IP', () => {
        const lockout = createLockout({ maxIps: 3 });
        for (let i = 1; i <= 5; i++) lockout.fail('first', `g${i}`);
        expect(lockout.retryAfterS('first')).toBeGreaterThan(0);
        ['b', 'c', 'd'].forEach((ip) => lockout.fail(ip, 'g'));
        expect(lockout.size()).toBe(3);
        expect(lockout.retryAfterS('first')).toBe(0);
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

describe('GET /api/users/:platform/:id/overview', () => {
    const PID = '3f2b8c1e-5a4d-4e6f-9a1b-0c2d3e4f5a6b';
    const overview = { success: true, user: { id: 7, email: 'u@x.test' }, projects: [{ id: PID, name: 'P', posts: 1, profiles: 1 }], selected_project_id: PID, metrics: [], breakdowns: {}, creators: [], posts: [], save_history: [], sessions: [{ device: 'd1', refresh_token: 'secret-token' }], warnings: [], browser_only: ['x'], internal_secret: 'nope' };

    test('requires the dashboard password', async () => {
        const res = await request(createApp(config)).get('/api/users/instagram/7/overview');
        expect(res.status).toBe(401);
    });

    test('proxies to the right backend with its admin password and passes project_id', async () => {
        routes[INSTA]['/api/admin/users/7/overview'] = { body: overview };
        const res = await authed(request(createApp(config)).get(`/api/users/instagram/7/overview?project_id=${PID}`));
        expect(res.status).toBe(200);
        expect(res.body.platform).toBe('instagram');
        expect(res.body.metrics).toEqual([]);
        expect(res.body.browser_only).toEqual(['x']);
        expect(res.body.internal_secret).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain('secret-token');
        const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/overview'));
        expect(call[0]).toBe(`${INSTA}/api/admin/users/7/overview?project_id=${PID}`);
        expect(call[1].headers['x-admin-password']).toBe('insta-admin');
        expect(fetchedUrls().some((u) => u.startsWith(TIK))).toBe(false);
    });

    test('rejects a bad platform, id or project_id without calling a backend', async () => {
        const app = createApp(config);
        expect((await authed(request(app).get('/api/users/mastodon/7/overview'))).status).toBe(400);
        expect((await authed(request(app).get('/api/users/tiktok/..%2Fhealth/overview'))).status).toBe(400);
        expect((await authed(request(app).get('/api/users/tiktok/7%3Fx=1/overview'))).status).toBe(400);
        expect((await authed(request(app).get('/api/users/tiktok/7/overview?project_id=../x'))).status).toBe(400);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('a backend without the endpoint gives a clear message', async () => {
        routes[TIK]['/api/admin/users/7/overview'] = { status: 404, body: null };
        const res = await authed(request(createApp(config)).get('/api/users/tiktok/7/overview'));
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/not available on this backend yet/);
    });

    test('an unreachable backend is a 502 with the reason', async () => {
        routes[TIK]['/api/admin/users/7/overview'] = refused();
        const res = await authed(request(createApp(config)).get('/api/users/tiktok/7/overview'));
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/ECONNREFUSED/);
    });
});
