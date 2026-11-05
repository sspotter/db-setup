const crypto = require('crypto');
const net = require('net');
const path = require('path');
const express = require('express');

const TIMEOUT_MS = 3000;
// /usage aggregates every user across many tables; 3 s is too tight for it.
const USAGE_TIMEOUT_MS = 15000;
const CHECK_COOLDOWN_MS = 120 * 1000;
const LOCK_MAX_GUESSES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MAX_IPS = 1000;
const PLATFORMS = ['tiktok', 'instagram'];
const REQUIRED = ['PORT', 'DASHBOARD_PASSWORD', 'TIK_URL', 'TIK_ADMIN_PASSWORD', 'INSTA_URL', 'INSTA_ADMIN_PASSWORD'];
// Fixed non-existent account so the check only ever produces no_such_user events.
const SMOKE_LOGIN = { email: 'smoke-check@dashboard.invalid', password: 'not-a-real-password' };

function loadConfig(env) {
    const missing = REQUIRED.filter((k) => !env[k] || !env[k].trim());
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    const url = (u) => u.trim().replace(/\/+$/, '');
    // Optional browser-facing address of each backend's admin page (the page the browser opens,
    // unlike TIK_URL/INSTA_URL, which only the dashboard server calls). Only http(s) is kept.
    const adminLink = (u) => {
        const t = String(u || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(t)) return '';
        return t.endsWith('.html') ? t : `${t}/admin.html`;
    };
    return {
        port: Number(env.PORT),
        host: (env.HOST || '').trim(),
        password: env.DASHBOARD_PASSWORD,
        backends: {
            tiktok: { url: url(env.TIK_URL), adminPassword: env.TIK_ADMIN_PASSWORD },
            instagram: { url: url(env.INSTA_URL), adminPassword: env.INSTA_ADMIN_PASSWORD },
        },
        adminLinks: { tiktok: adminLink(env.TIK_ADMIN_URL), instagram: adminLink(env.INSTA_ADMIN_URL) },
    };
}

// Resolves { ok, status, body } for any HTTP answer; rejects with the contract's error wording otherwise.
async function call(backend, pathname, { timeoutMs = TIMEOUT_MS, ...init } = {}) {
    try {
        const res = await fetch(backend.url + pathname, {
            ...init,
            headers: { 'x-admin-password': backend.adminPassword, ...init.headers },
            signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, body };
    } catch (err) {
        if (err.name === 'TimeoutError') throw new Error(`timeout after ${timeoutMs} ms`);
        // fetch reports "fetch failed"; the cause carries e.g. "connect ECONNREFUSED ...".
        throw new Error((err.cause && err.cause.message) || err.message);
    }
}

async function adminGet(backend, pathname) {
    const r = await call(backend, pathname);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.body;
}

// A backend that predates a feature answers Express's own 404 with no JSON body. A JSON 404 is
// the feature itself speaking (for example "no block for that IP"), so its wording is kept.
function backendError(r, feature) {
    const said = r.body && r.body.error;
    if (r.status === 404 && !said) return `${feature} is not available on this backend yet (it needs the update)`;
    if (r.status === 503) return said || `${feature} is not ready on this backend (its migration is not applied)`;
    return said ? `HTTP ${r.status}: ${said}` : `HTTP ${r.status}`;
}

async function featureGet(backend, pathname, feature, init) {
    const r = await call(backend, pathname, init);
    if (!r.ok) throw new Error(backendError(r, feature));
    return r.body || {};
}

// Calls every named backend; one failing never hides the others' answers.
async function fromBackends(backends, names, pathname, feature) {
    const bodies = {};
    const errors = {};
    await Promise.all(
        names.map((name) =>
            featureGet(backends[name], pathname, feature)
                .then((b) => { bodies[name] = b; })
                .catch((err) => { errors[name] = err.message; })
        )
    );
    return { bodies, errors };
}

const pick = (obj, keys) => {
    const out = {};
    for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
    return out;
};

// /insights lists the emails of each version's users; only counts leave this server.
function summariseInsights(b) {
    return {
        days: b.days,
        latest_version: b.latest_version || null,
        versions: (b.versions || []).map((v) => pick(v, ['ext_version', 'users', 'errors', 'outdated'])),
        top_failing: b.top_failing || [],
        trend: b.trend || [],
    };
}

// One user row for the Users panel. A whitelist, so a reset link or token the backend
// adds later never leaves this server; reset_link keeps its status and dates only.
const USER_FIELDS = [
    'id', 'email', 'status', 'plan', 'active_sessions', 'max_devices', 'last_login', 'last_seen',
    'created_at', 'ext_version', 'recent_logins', 'ghost_sessions',
];
function publicUser(u) {
    const row = pick(u, USER_FIELDS);
    row.last_issue = u.last_issue ? pick(u.last_issue, ['reason', 'status', 'path', 'error', 'created_at']) : null;
    row.reset_link = u.reset_link ? pick(u.reset_link, ['status', 'created_at', 'expires_at']) : null;
    return row;
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
    const [h, alerts, last15m, slow, insights, users] = await Promise.all([
        get('health', '/api/admin/health', (b) => b),
        get('alerts', '/api/admin/alerts', (b) => b.alerts),
        // ponytail: both counts are taken from at most 1000 failed events (the backend's events
        // limit), so a busy 15-minute window shows 1000 at most; use stats.matching from the
        // events endpoint instead if that ever becomes real.
        get('events', `/api/admin/events?result=failed&since=${encodeURIComponent(since)}&limit=1000`, (b) => ({
            failed_logins: b.events.filter((e) => e.path === '/api/auth/login').length,
            server_errors: b.events.filter((e) => e.status >= 500).length,
        })),
        get('insights', '/api/admin/insights?days=1', (b) => b.slow),
        // Full rows carry emails and reset links; only counts leave this server.
        get('insights7d', '/api/admin/insights?days=7', summariseInsights),
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
        health_details: h ? pick(h, ['uptime_s', 'node', 'retention', 'events']) : null,
        insights,
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

const EVENT_OPTIONS = { result: ['any', 'success', 'failed'], action: ['all', 'login', 'api'] };
const MAX_TEXT = 200;

// Validates the feed filters and builds the backend query string. Only known keys are
// forwarded, each encoded by URLSearchParams; the raw query string never reaches a backend.
function eventQuery(query, limit) {
    const params = new URLSearchParams({ limit: String(limit) });
    for (const [key, allowed] of Object.entries(EVENT_OPTIONS)) {
        const v = query[key];
        if (v === undefined || v === '') continue;
        if (typeof v !== 'string' || !allowed.includes(v)) return { error: `${key} must be one of ${allowed.join(', ')}` };
        params.set(key, v);
    }
    for (const key of ['user', 'q']) {
        const v = query[key];
        if (v === undefined || v === '') continue;
        if (typeof v !== 'string' || v.length > MAX_TEXT) return { error: `${key} must be text of at most ${MAX_TEXT} characters` };
        params.set(key, v);
    }
    if (query.since !== undefined && query.since !== '') {
        if (typeof query.since !== 'string' || isNaN(new Date(query.since))) return { error: 'since must be an ISO date' };
        params.set('since', query.since);
    }
    return { qs: params.toString() };
}

const STAT_KEYS = ['all_time', 'today', 'matching', 'failed', 'distinct_users'];

// Response whitelists, so anything a backend adds later stays on this server until it is listed here.
const USAGE_USER_FIELDS = [
    'id', 'email', 'plan', 'status', 'last_login', 'sessions', 'jobs_total', 'jobs_failed', 'jobs_stuck',
    'api_calls', 'comments_scraped', 'saved_posts', 'projects', 'usage_score',
    'videos', 'keywords', 'tiktok_comments', // TikTok only
];
const FAILED_JOB_FIELDS = ['id', 'email', 'post_shortcode', 'status', 'retry_count', 'max_retries', 'error_message', 'created_at'];
const AUDIT_FIELDS = ['id', 'created_at', 'actor', 'action', 'target_user_id', 'target_email', 'ip'];
const EXPIRING_FIELDS = ['id', 'email', 'plan', 'status', 'plan_expires_at', 'trial_ends_at', 'lapses_at', 'lapsed'];
const BLOCK_FIELDS = ['ip', 'reason', 'blocked_by', 'created_at', 'expires_at'];

// The backends already clean audit details before storing them; this keeps the same rule on the
// way out, so a row written by older code or by hand can't carry a secret to the browser.
const SECRET_KEY = /pass|token|secret|hash|authorization|cookie|^links?$|reset_?links?/i;
const SECRET_VALUE = /token=|bearer\s/i;
function safeDetail(value) {
    if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[redacted]' : value;
    if (Array.isArray(value)) return value.map(safeDetail);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, safeDetail(v)]));
}

// Whitelist for the user overview; sessions are passed through safeDetail separately.
const OVERVIEW_FIELDS = [
    'success', 'user', 'projects', 'selected_project_id', 'metrics', 'breakdowns', 'creators', 'posts',
    'save_history', 'warnings', 'browser_only',
];
const OVERVIEW_ID = /^[A-Za-z0-9_-]{1,64}$/; // integer or UUID ids
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Null when out of range or not a plain whole number.
function parseWhole(value, fallback, max) {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d{1,4}$/.test(value)) return null;
    const n = Number(value);
    return n >= 1 && n <= max ? n : null;
}

// A failed login arriving through a local proxy shows up as loopback, and blocking that
// would lock everyone out of the backend's login, including this dashboard's own checks.
const isLoopback = (ip) => /^(127\.|::1$|::ffff:127\.)/i.test(ip);

// Wrong dashboard passwords per IP, in memory, so a restart forgets them. Counts distinct wrong
// passwords: the page sends several requests at once and open tabs keep retrying, so after a
// password change one stale value would otherwise lock its owner out, while repeating a wrong
// password gives an attacker nothing. Oldest IP is dropped at the size limit: Map keeps insertion
// order and a record is re-inserted when its window restarts.
function createLockout({ maxIps = LOCK_MAX_IPS } = {}) {
    const byIp = new Map();
    const live = (ip) => {
        const rec = byIp.get(ip);
        if (rec && Date.now() - rec.first >= LOCK_WINDOW_MS) {
            byIp.delete(ip);
            return undefined;
        }
        return rec;
    };
    return {
        retryAfterS(ip) {
            const rec = live(ip);
            return rec && rec.guesses.size >= LOCK_MAX_GUESSES ? Math.ceil((rec.first + LOCK_WINDOW_MS - Date.now()) / 1000) : 0;
        },
        fail(ip, guess) {
            let rec = live(ip);
            if (!rec) {
                if (byIp.size >= maxIps) byIp.delete(byIp.keys().next().value);
                rec = { first: Date.now(), guesses: new Set() };
                byIp.set(ip, rec);
            }
            rec.guesses.add(guess);
        },
        clear(ip) {
            byIp.delete(ip);
        },
        size: () => byIp.size,
    };
}

function createApp(config) {
    const { backends } = config;
    const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
    const expected = digest(config.password);
    // Per-app so each test gets a fresh cooldown.
    let lastCheckAt = 0;
    const lockout = createLockout();

    const app = express();
    app.use(express.static(path.join(__dirname, 'public')));

    // Registered before the auth guard: the ops scripts curl it without a password.
    app.get('/api/health', (req, res) => res.json({ status: 'ok', database: 'none' }));

    // req.ip is the socket address: trust proxy stays off because this service has no proxy in
    // front of it (scripts/setup.md: opened directly over Tailscale, not on the Funnel), so an
    // X-Forwarded-For header could only be a forgery. Set trust proxy if that ever changes.
    app.use('/api', (req, res, next) => {
        const wait = lockout.retryAfterS(req.ip);
        if (wait > 0) {
            res.set('Retry-After', String(wait));
            return res.status(429).json({ error: 'Too many wrong passwords', locked: true, retry_after_s: wait });
        }
        const given = digest(req.get('x-dashboard-password') || '');
        if (crypto.timingSafeEqual(given, expected)) {
            lockout.clear(req.ip);
            return next();
        }
        lockout.fail(req.ip, given.toString('hex'));
        res.status(401).json({ error: 'Unauthorized' });
    });

    app.get('/api/overview', async (req, res) => {
        const [tiktok, instagram] = await Promise.all(PLATFORMS.map((p) => overviewSide(backends[p])));
        res.json({ generated_at: new Date().toISOString(), tiktok, instagram });
    });

    // Where the browser should open each backend's admin page; empty = the page works it out from its own host.
    app.get('/api/links', (req, res) => res.json({ tiktok: (config.adminLinks || {}).tiktok || '', instagram: (config.adminLinks || {}).instagram || '' }));

    app.get('/api/events', async (req, res) => {
        const platform = req.query.platform || 'all';
        if (platform !== 'all' && !PLATFORMS.includes(platform)) {
            return res.status(400).json({ error: 'platform must be all, tiktok or instagram' });
        }
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const filter = eventQuery(req.query, limit);
        if (filter.error) return res.status(400).json({ error: filter.error });
        const names = platform === 'all' ? PLATFORMS : [platform];
        const errors = {};
        const stats = {};
        const lists = await Promise.all(
            names.map((name) =>
                adminGet(backends[name], `/api/admin/events?${filter.qs}`)
                    .then((b) => {
                        stats[name] = b.stats ? pick(b.stats, STAT_KEYS) : null;
                        return b.events.map((e) => ({ ...e, platform: name }));
                    })
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
        // distinct_users is a sum, so a person active on both platforms counts twice.
        const have = names.map((n) => stats[n]).filter(Boolean);
        const total = have.length ? Object.fromEntries(STAT_KEYS.map((k) => [k, have.reduce((a, s) => a + (s[k] || 0), 0)])) : null;
        res.json({ events, errors, stats: total });
    });

    // On demand only (not part of /api/overview): the user rows of one backend, whitelisted.
    app.get('/api/users', async (req, res) => {
        const platform = req.query.platform;
        if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'platform must be tiktok or instagram' });
        try {
            const body = await adminGet(backends[platform], '/api/admin/users');
            res.json({ platform, users: (body.users || []).map(publicUser) });
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
    });

    // One user's overview: who they are and how each number they see in a project was built.
    // Only the validated id/project_id are put into the backend path (no caller-chosen paths).
    app.get('/api/users/:platform/:id/overview', async (req, res) => {
        const { platform, id } = req.params;
        if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'platform must be tiktok or instagram' });
        if (!OVERVIEW_ID.test(id)) return res.status(400).json({ error: 'id has an invalid format' });
        const projectId = req.query.project_id;
        if (projectId !== undefined && projectId !== '' && (typeof projectId !== 'string' || !UUID.test(projectId))) {
            return res.status(400).json({ error: 'project_id must be a UUID' });
        }
        const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
        try {
            const r = await call(backends[platform], `/api/admin/users/${encodeURIComponent(id)}/overview${qs}`, { timeoutMs: USAGE_TIMEOUT_MS });
            if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ error: backendError(r, 'The user overview') });
            if (!r.body || typeof r.body !== 'object') return res.status(502).json({ error: 'The backend sent an unreadable answer' });
            res.json({ ...pick(r.body, OVERVIEW_FIELDS), sessions: safeDetail(r.body.sessions || []), platform });
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
    });

    // The panels below load when opened, never on the 30 s refresh.
    app.get('/api/usage', async (req, res) => {
        const platform = req.query.platform;
        if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'platform must be tiktok or instagram' });
        const days = parseWhole(req.query.days, 30, 90);
        if (days === null) return res.status(400).json({ error: 'days must be a whole number from 1 to 90' });
        try {
            const b = await featureGet(backends[platform], `/api/admin/usage?days=${days}`, 'Usage', { timeoutMs: USAGE_TIMEOUT_MS });
            res.json({
                platform,
                days: b.days,
                stuck_after_minutes: b.stuck_after_minutes,
                storage_basis: b.storage_basis,
                users: (b.users || []).map((u) => pick(u, USAGE_USER_FIELDS)),
                top_users: (b.top_users || []).map((u) => pick(u, USAGE_USER_FIELDS)),
                failed_jobs: (b.failed_jobs || []).map((j) => pick(j, FAILED_JOB_FIELDS)),
            });
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
    });

    app.get('/api/audit', async (req, res) => {
        const platform = req.query.platform || 'all';
        if (platform !== 'all' && !PLATFORMS.includes(platform)) {
            return res.status(400).json({ error: 'platform must be all, tiktok or instagram' });
        }
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const params = new URLSearchParams({ limit: String(limit) });
        const { action, q, since } = req.query;
        // Only the shape is checked here: each backend owns its action list and rejects unknown ones.
        if (action !== undefined && action !== '') {
            if (typeof action !== 'string' || !/^[a-z_]{1,40}$/.test(action)) return res.status(400).json({ error: 'action has an invalid format' });
            params.set('action', action);
        }
        if (q !== undefined && q !== '') {
            if (typeof q !== 'string' || q.length > MAX_TEXT) return res.status(400).json({ error: `q must be text of at most ${MAX_TEXT} characters` });
            params.set('q', q);
        }
        if (since !== undefined && since !== '') {
            if (typeof since !== 'string' || isNaN(new Date(since))) return res.status(400).json({ error: 'since must be an ISO date' });
            params.set('since', since);
        }
        const names = platform === 'all' ? PLATFORMS : [platform];
        const { bodies, errors } = await fromBackends(backends, names, `/api/admin/audit?${params}`, 'The audit log');
        const rows = Object.entries(bodies)
            .flatMap(([name, b]) => (b.rows || []).map((r) => ({ ...pick(r, AUDIT_FIELDS), detail: safeDetail(r.detail), platform: name })))
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            .slice(0, limit);
        res.json({
            rows,
            errors,
            table_missing: Object.keys(bodies).filter((n) => bodies[n].table_missing === true),
            actions: [...new Set(Object.values(bodies).flatMap((b) => b.actions || []))],
        });
    });

    app.get('/api/expiring', async (req, res) => {
        const days = parseWhole(req.query.days, 14, 365);
        if (days === null) return res.status(400).json({ error: 'days must be a whole number from 1 to 365' });
        const { bodies, errors } = await fromBackends(backends, PLATFORMS, `/api/admin/users/expiring?days=${days}`, 'Plan expiry');
        const users = Object.entries(bodies)
            .flatMap(([name, b]) => (b.users || []).map((u) => ({ ...pick(u, EXPIRING_FIELDS), platform: name })))
            .sort((a, b) => Date.parse(a.lapses_at) - Date.parse(b.lapses_at));
        res.json({ days, users, errors, columns_missing: Object.keys(bodies).filter((n) => bodies[n].columns_missing === true) });
    });

    app.get('/api/blocked-ips', async (req, res) => {
        const platform = req.query.platform || 'all';
        if (platform !== 'all' && !PLATFORMS.includes(platform)) {
            return res.status(400).json({ error: 'platform must be all, tiktok or instagram' });
        }
        const names = platform === 'all' ? PLATFORMS : [platform];
        const { bodies, errors } = await fromBackends(backends, names, '/api/admin/blocked-ips', 'IP blocking');
        const blocks = Object.entries(bodies)
            .flatMap(([name, b]) => (b.blocks || []).map((x) => ({ ...pick(x, BLOCK_FIELDS), platform: name })))
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        res.json({ blocks, errors, table_missing: Object.keys(bodies).filter((n) => bodies[n].table_missing === true) });
    });

    app.post('/api/blocked-ips', express.json({ limit: '10kb' }), async (req, res) => {
        const { platform, ip, reason } = req.body || {};
        if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'platform must be tiktok or instagram' });
        if (typeof ip !== 'string' || !net.isIP(ip)) return res.status(400).json({ error: 'ip must be a valid IP address' });
        if (isLoopback(ip)) return res.status(400).json({ error: 'Refusing to block a loopback address: it can be the proxy every login comes through' });
        if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_TEXT)) {
            return res.status(400).json({ error: `reason must be text of at most ${MAX_TEXT} characters` });
        }
        const hours = req.body.hours === undefined ? 24 : req.body.hours;
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) return res.status(400).json({ error: 'hours must be a whole number from 1 to 720' });
        try {
            const r = await call(backends[platform], '/api/admin/blocked-ips', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ip, hours, ...(reason ? { reason } : {}) }),
            });
            if (!r.ok) return res.status(r.status === 400 ? 400 : 502).json({ error: backendError(r, 'IP blocking') });
            res.json({ ok: true, platform, ip, hours });
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
    });

    app.delete('/api/blocked-ips/:platform/:ip', async (req, res) => {
        const { platform, ip } = req.params;
        if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'platform must be tiktok or instagram' });
        if (!net.isIP(ip)) return res.status(400).json({ error: 'ip must be a valid IP address' });
        try {
            const r = await call(backends[platform], `/api/admin/blocked-ips/${encodeURIComponent(ip)}`, { method: 'DELETE' });
            if (!r.ok) return res.status(r.status === 400 ? 400 : 502).json({ error: backendError(r, 'IP blocking') });
            res.json({ ok: true, platform, ip });
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
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

    // Malformed or oversized JSON bodies; the default handler would answer with an HTML stack trace.
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Invalid request body' });
        console.error(err.message);
        res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

module.exports = { createApp, loadConfig, createLockout };

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
