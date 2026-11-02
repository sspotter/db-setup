const crypto = require('crypto');
const path = require('path');
const express = require('express');

const TIMEOUT_MS = 3000;
const CHECK_COOLDOWN_MS = 120 * 1000;
const PLATFORMS = ['tiktok', 'instagram'];
const REQUIRED = ['PORT', 'DASHBOARD_PASSWORD', 'TIK_URL', 'TIK_ADMIN_PASSWORD', 'INSTA_URL', 'INSTA_ADMIN_PASSWORD'];
// Fixed non-existent account so the check only ever produces no_such_user events.
const SMOKE_LOGIN = { email: 'smoke-check@dashboard.invalid', password: 'not-a-real-password' };

function loadConfig(env) {
    const missing = REQUIRED.filter((k) => !env[k] || !env[k].trim());
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    const url = (u) => u.trim().replace(/\/+$/, '');
    return {
        port: Number(env.PORT),
        host: (env.HOST || '').trim(),
        password: env.DASHBOARD_PASSWORD,
        backends: {
            tiktok: { url: url(env.TIK_URL), adminPassword: env.TIK_ADMIN_PASSWORD },
            instagram: { url: url(env.INSTA_URL), adminPassword: env.INSTA_ADMIN_PASSWORD },
        },
    };
}

// Resolves { ok, status, body } for any HTTP answer; rejects with the contract's error wording otherwise.
async function call(backend, pathname, init = {}) {
    try {
        const res = await fetch(backend.url + pathname, {
            ...init,
            headers: { 'x-admin-password': backend.adminPassword, ...init.headers },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, body };
    } catch (err) {
        if (err.name === 'TimeoutError') throw new Error(`timeout after ${TIMEOUT_MS} ms`);
        // fetch reports "fetch failed"; the cause carries e.g. "connect ECONNREFUSED ...".
        throw new Error((err.cause && err.cause.message) || err.message);
    }
}

async function adminGet(backend, pathname) {
    const r = await call(backend, pathname);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.body;
}

async function overviewSide(backend) {
    const t0 = Date.now();
    let health;
    try {
        health = await call(backend, '/api/health');
    } catch (err) {
        return { up: false, error: err.message };
    }
    if (!health.ok) {
        const reason = health.body && health.body.error;
        return { up: false, error: reason ? `HTTP ${health.status}: ${reason}` : `HTTP ${health.status}` };
    }
    const latency = Date.now() - t0;

    const errors = [];
    const get = (name, pathname, pick) =>
        adminGet(backend, pathname)
            .then(pick)
            .catch((err) => {
                errors.push(`${name}: ${err.message}`);
                return null;
            });

    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [h, alerts, last15m, slow, users] = await Promise.all([
        get('health', '/api/admin/health', (b) => b),
        get('alerts', '/api/admin/alerts', (b) => b.alerts),
        // ponytail: both counts cap at 1000 rows (the events limit); add a status filter or a
        // count endpoint to the backends if a 15-minute window can ever exceed that.
        get('events', `/api/admin/events?result=failed&since=${encodeURIComponent(since)}&limit=1000`, (b) => ({
            failed_logins: b.events.filter((e) => e.path === '/api/auth/login').length,
            server_errors: b.events.filter((e) => e.status >= 500).length,
        })),
        get('insights', '/api/admin/insights?days=1', (b) => b.slow),
        // Full rows carry emails and reset links; only counts leave this server.
        get('users', '/api/admin/users', (b) => {
            const byStatus = {};
            for (const u of b.users) byStatus[u.status || 'unknown'] = (byStatus[u.status || 'unknown'] || 0) + 1;
            return { total: b.users.length, by_status: byStatus };
        }),
    ]);

    return {
        up: true,
        latency_ms: latency,
        version: (h && h.version) || null,
        db: (h && h.db) || null,
        migrations_ok: h && h.migrations ? Object.values(h.migrations).every((v) => v === true) : null,
        alerts,
        last_15m: last15m,
        slow,
        users,
        errors,
    };
}

async function runCheck(platform, name, backend, pathname, init, judge) {
    const t0 = Date.now();
    try {
        const r = await call(backend, pathname, init);
        const [ok, detail] = judge(r);
        return { platform, name, ok, status: r.status, ms: Date.now() - t0, detail };
    } catch (err) {
        return { platform, name, ok: false, status: null, ms: Date.now() - t0, detail: err.message };
    }
}

const judgeHealth = (r) => {
    const db = r.body && r.body.database;
    return [r.ok && db === 'connected', db ? `database ${db}` : `HTTP ${r.status}`];
};

// 200 means the fake account logged in, which is a failure.
const judgeLogin = (r) =>
    r.status === 401 ? [true, 'rejected as expected'] : [false, r.ok ? 'login accepted (expected 401)' : `unexpected HTTP ${r.status}`];

function createApp(config) {
    const { backends } = config;
    const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
    const expected = digest(config.password);
    // Per-app so each test gets a fresh cooldown.
    let lastCheckAt = 0;

    const app = express();
    app.use(express.static(path.join(__dirname, 'public')));

    // Registered before the auth guard: the ops scripts curl it without a password.
    app.get('/api/health', (req, res) => res.json({ status: 'ok', database: 'none' }));

    app.use('/api', (req, res, next) => {
        if (crypto.timingSafeEqual(digest(req.get('x-dashboard-password') || ''), expected)) return next();
        res.status(401).json({ error: 'Unauthorized' });
    });

    app.get('/api/overview', async (req, res) => {
        const [tiktok, instagram] = await Promise.all(PLATFORMS.map((p) => overviewSide(backends[p])));
        res.json({ generated_at: new Date().toISOString(), tiktok, instagram });
    });

    app.get('/api/events', async (req, res) => {
        const platform = req.query.platform || 'all';
        if (platform !== 'all' && !PLATFORMS.includes(platform)) {
            return res.status(400).json({ error: 'platform must be all, tiktok or instagram' });
        }
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const names = platform === 'all' ? PLATFORMS : [platform];
        const errors = {};
        const lists = await Promise.all(
            names.map((name) =>
                adminGet(backends[name], `/api/admin/events?limit=${limit}`)
                    .then((b) => b.events.map((e) => ({ ...e, platform: name })))
                    .catch((err) => {
                        errors[name] = err.message;
                        return [];
                    })
            )
        );
        const events = lists
            .flat()
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            .slice(0, limit);
        res.json({ events, errors });
    });

    // Cooldown: 10 failed logins per IP in 15 min fires the backends' own failed_logins_ip
    // alert, so repeated checks would make the dashboard alarm on itself.
    app.post('/api/check', async (req, res) => {
        const wait = lastCheckAt + CHECK_COOLDOWN_MS - Date.now();
        if (wait > 0) return res.status(429).json({ error: 'Checks ran recently', retry_after_s: Math.ceil(wait / 1000) });
        lastCheckAt = Date.now();

        const login = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SMOKE_LOGIN) };
        const checks = (
            await Promise.all(
                PLATFORMS.map((p) =>
                    Promise.all([
                        runCheck(p, 'health', backends[p], '/api/health', {}, judgeHealth),
                        runCheck(p, 'failed_login', backends[p], '/api/auth/login', login, judgeLogin),
                    ])
                )
            )
        ).flat();
        res.json({ ok: checks.every((c) => c.ok), ran_at: new Date().toISOString(), checks });
    });

    return app;
}

module.exports = { createApp, loadConfig };

if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    let config;
    try {
        config = loadConfig(process.env);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
    createApp(config).listen(config.port, config.host || undefined, () => {
        console.log(`Dashboard listening on ${config.host || '*'}:${config.port}`);
    });
}
