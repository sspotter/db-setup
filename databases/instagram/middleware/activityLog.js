/**
 * Activity log — records every /api/auth/login attempt and every other /api
 * request that ends with status >= 400 into public.api_events.
 * Never stores passwords, tokens or request bodies. Nothing runs at require time.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { clientIp } = require('../utils/adminAudit');

const LOGIN_PATH = '/api/auth/login';
const RETENTION_SQL = "DELETE FROM api_events WHERE created_at < now() - interval '90 days'";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Truncate to the column size; null/undefined/'' stay null.
const cut = (v, n) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, n));

const slowMs = () => parseInt(process.env.SLOW_REQUEST_MS, 10) || 2000;

// Which successful (<400) requests are recorded so the admin can see what users actually do
// (fetching posts, saving captures, ...): ACTIVITY_LOG_SUCCESS = all (default) | writes | none.
// The health check, CORS preflights and the admin panel's own GET polling are never recorded.
const wantsSuccess = (req, urlPath) => {
    const mode = String(process.env.ACTIVITY_LOG_SUCCESS || 'all').toLowerCase();
    if (mode === 'none') return false;
    if (req.method === 'OPTIONS' || urlPath === '/api/health') return false;
    if (req.method === 'GET' && urlPath.startsWith('/api/admin/')) return false;
    return mode === 'all' || (req.method !== 'GET' && req.method !== 'HEAD');
};

// Routes call this in their catch block so the log keeps the real cause of a 5xx.
// The client-facing body is unchanged.
function logServerError(res, err) {
    res.locals.activity = { ...res.locals.activity, serverError: String((err && err.message) || err) };
}

// users.last_seen = last authenticated call that succeeded; written at most once per window per user.
const SEEN_EVERY_MS = 5 * 60 * 1000;
const seenWrittenAt = new Map();
function touchLastSeen(userId) {
    const now = Date.now();
    if (now - (seenWrittenAt.get(userId) || 0) < SEEN_EVERY_MS) return;
    seenWrittenAt.set(userId, now);
    pool.query('UPDATE users SET last_seen = now() WHERE id = $1', [userId])
        .catch((err) => console.error('[ACTIVITY] last_seen update failed:', err.message));
}

// Read by GET /api/admin/health.
const retentionStatus = { lastRunAt: null, lastDeleted: null, lastError: null };

// Unverified decode — only used to label 401/403 rows with whose token it was.
function decodeBearer(req) {
    const auth = req.headers['authorization'];
    const token = auth && auth.split(' ')[1];
    if (!token) return null;
    try { return jwt.decode(token); } catch { return null; }
}

function activityLog(req, res, next) {
    const startedAt = Date.now();
    // Remember the error text the route sends back; never keep the whole body.
    let errorText = null;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        if (body && body.error) {
            errorText = body.message ? `${body.error} — ${body.message}` : String(body.error);
        }
        return originalJson(body);
    };

    res.on('finish', () => {
        const urlPath = req.originalUrl.split('?')[0];
        const isLogin = urlPath === LOGIN_PATH;
        const durationMs = Date.now() - startedAt;
        if (req.user && UUID_RE.test(String(req.user.id)) && res.statusCode < 400) touchLastSeen(String(req.user.id));
        // A route that sets an explicit reason on success (e.g. reset_success) wants it recorded.
        const flagged = !!(res.locals.activity && res.locals.activity.reason);
        if (!isLogin && res.statusCode < 400 && durationMs < slowMs() && !flagged && !wantsSuccess(req, urlPath)) return;

        const act = res.locals.activity || {};
        const token = req.user ? null : decodeBearer(req);
        const userId = (req.user && req.user.id) || act.userId || (token && token.id) || null;
        const email = (req.user && req.user.email) || act.email || (token && token.email) || null;
        const ip = clientIp(req);
        // A route may set res.locals.activity.error to log more detail than the client sees.
        const error = res.statusCode >= 400 ? (act.error || errorText) : null;

        const detail = act.detail ? JSON.stringify(act.detail).slice(0, 4000) : null;
        const baseValues = [
                UUID_RE.test(String(userId)) ? String(userId) : null, // bad decoded ids would fail the uuid cast
                cut(email, 255),
                cut(req.method, 10),
                cut(urlPath, 500),
                res.statusCode,
                cut(act.reason, 50),
                cut(error, 500),
                cut(ip, 100),
                cut(req.headers['user-agent'], 500),
                cut(req.headers['x-extension-version'], 50),
                durationMs,
                res.statusCode >= 500 ? cut(act.serverError, 1000) : null,
        ];
        const cols = 'user_id, email, method, path, status, reason, error, ip, user_agent, ext_version, duration_ms, server_error';
        const ph = '$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12';
        // A truncated detail is not valid JSON; drop it instead of failing the whole row.
        let detailJson = null;
        if (detail) { try { JSON.parse(detail); detailJson = detail; } catch { detailJson = null; } }
        pool.query(`INSERT INTO api_events (${cols}, detail) VALUES (${ph}, $13::jsonb)`, [...baseValues, detailJson])
            .catch((err) => {
                if (err.code !== '42703') throw err; // detail column not migrated yet: log without it
                return pool.query(`INSERT INTO api_events (${cols}) VALUES (${ph})`, baseValues);
            })
            .catch((err) => console.error('[ACTIVITY] Insert failed:', err.message));
    });

    next();
}

// Applies the migration (so a VM that skipped it still gets the table), prunes
// rows older than 90 days, then prunes again every 24h.
function startRetention() {
    const prune = () => pool.query(RETENTION_SQL)
        .then((r) => { retentionStatus.lastRunAt = new Date(); retentionStatus.lastDeleted = r.rowCount; retentionStatus.lastError = null; })
        .catch((err) => { retentionStatus.lastError = err.message; console.error('[ACTIVITY] Retention delete failed:', err.message); });

    (async () => {
        try {
            for (const f of ['004_add_api_events.sql', '005_add_password_resets.sql', '006_add_diagnostics.sql', '007_add_event_detail.sql']) {
                await pool.query(fs.readFileSync(path.join(__dirname, '../migrations', f), 'utf8'));
            }
        } catch (err) {
            console.error('[ACTIVITY] Migration failed:', err.message);
        }
        await prune();
    })();

    setInterval(prune, 24 * 60 * 60 * 1000).unref();
}

module.exports = { activityLog, startRetention, logServerError, retentionStatus };
