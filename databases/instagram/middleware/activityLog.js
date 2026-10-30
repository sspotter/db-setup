/**
 * Activity log — records every /api/auth/login attempt and every other /api
 * request that ends with status >= 400 into public.api_events.
 * Never stores passwords, tokens or request bodies. Nothing runs at require time.
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const LOGIN_PATH = '/api/auth/login';
const RETENTION_SQL = "DELETE FROM api_events WHERE created_at < now() - interval '90 days'";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Truncate to the column size; null/undefined/'' stay null.
const cut = (v, n) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, n));

// Unverified decode — only used to label 401/403 rows with whose token it was.
function decodeBearer(req) {
    const auth = req.headers['authorization'];
    const token = auth && auth.split(' ')[1];
    if (!token) return null;
    try { return jwt.decode(token); } catch { return null; }
}

function activityLog(req, res, next) {
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
        if (!isLogin && res.statusCode < 400) return;

        const act = res.locals.activity || {};
        const token = req.user ? null : decodeBearer(req);
        const userId = (req.user && req.user.id) || act.userId || (token && token.id) || null;
        const email = (req.user && req.user.email) || act.email || (token && token.email) || null;
        const xff = req.headers['x-forwarded-for'];
        const ip = xff ? String(xff).split(',')[0].trim() : req.ip;
        // A route may set res.locals.activity.error to log more detail than the client sees.
        const error = res.statusCode >= 400 ? (act.error || errorText) : null;

        pool.query(
            `INSERT INTO api_events (user_id, email, method, path, status, reason, error, ip, user_agent, ext_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
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
            ]
        ).catch((err) => console.error('[ACTIVITY] Insert failed:', err.message));
    });

    next();
}

// Applies the migration (so a VM that skipped it still gets the table), prunes
// rows older than 90 days, then prunes again every 24h.
function startRetention() {
    const prune = () => pool.query(RETENTION_SQL)
        .catch((err) => console.error('[ACTIVITY] Retention delete failed:', err.message));

    (async () => {
        try {
            const sql = fs.readFileSync(path.join(__dirname, '../migrations/v3_add_api_events.sql'), 'utf8');
            await pool.query(sql);
        } catch (err) {
            console.error('[ACTIVITY] Migration failed:', err.message);
        }
        await prune();
    })();

    setInterval(prune, 24 * 60 * 60 * 1000).unref();
}

module.exports = { activityLog, startRetention };
