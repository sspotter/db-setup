/**
 * Admin audit trail: who did what in the admin panel.
 * Identical in the TikTok and Instagram backends.
 *
 * recordAdminAction NEVER throws and never blocks or fails the admin action it
 * describes. If the admin_audit table does not exist yet (migration
 * v7_admin_audit.sql not applied) it logs one warning and carries on, so this
 * code is safe to deploy before the migration.
 *
 * The actor is the admin account's email, or 'shared-password' for anyone using the shared
 * password (the log cannot say which person that was), or 'unknown' for a failed login.
 */
const pool = require('../db');

const AUDIT_ACTIONS = [
    'admin_login', 'admin_login_failed', 'admin_login_locked',
    'user_create', 'user_update', 'user_logout', 'user_reset_link', 'user_delete',
    'project_delete',
    'admin_account_create', 'admin_account_update', 'admin_account_delete',
    'ip_block', 'ip_unblock',
];

// Keys that must never be stored, whatever the caller passes (defence in depth;
// callers should not pass secrets in the first place).
const SECRET_KEY = /pass|token|secret|hash|authorization|cookie|^links?$|reset_?links?/i;
const SECRET_VALUE = /token=|bearer\s/i;

function clean(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[redacted]' : value.slice(0, 300);
    if (typeof value !== 'object') return value;
    if (depth >= 3) return '[nested]';
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => clean(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (!SECRET_KEY.test(k)) out[k] = clean(v, depth + 1);
    }
    return out;
}

// Tailscale Funnel connects from localhost and appends the real client address to the END of
// X-Forwarded-For; anything before it can be forged by the caller. The apps also listen on the
// LAN, where the caller talks to the server directly and could send any header, so it only
// counts when the connection itself comes from loopback.
const LOOPBACK_PEER = /^(127\.|::1$|::ffff:127\.)/;

function clientIp(req) {
    const xff = req.headers && req.headers['x-forwarded-for'];
    const peer = String((req.socket && req.socket.remoteAddress) || req.ip || '');
    if (xff && LOOPBACK_PEER.test(peer)) {
        const last = String(xff).split(',').pop().trim();
        if (last) return last.slice(0, 100);
    }
    return String(req.ip || (req.socket && req.socket.remoteAddress) || '').slice(0, 100) || null;
}

// req.admin is set by middleware/adminAuth.js, or by the login route on success.
function adminActor(req) {
    const admin = (req && req.admin) || {};
    if (admin.email) return String(admin.email).slice(0, 255);
    return admin.shared ? 'shared-password' : 'unknown';
}

let warnedMissing = false;

async function recordAdminAction(req, { action, target_user_id = null, target_email = null, detail = {} }) {
    try {
        await pool.query(
            `INSERT INTO admin_audit (actor, action, target_user_id, target_email, detail, ip)
             VALUES ($6, $1, $2, $3, $4::jsonb, $5)`,
            [
                action,
                target_user_id || null,
                target_email ? String(target_email).slice(0, 255) : null,
                JSON.stringify(clean(detail) || {}),
                clientIp(req),
                adminActor(req),
            ]
        );
    } catch (err) {
        if (err && err.code === '42P01') {
            if (!warnedMissing) {
                warnedMissing = true;
                console.warn('[ADMIN AUDIT] admin_audit table missing; apply migrations/v7_admin_audit.sql. Actions are not being recorded.');
            }
        } else {
            console.error('[ADMIN AUDIT] Could not record action:', err && err.message);
        }
    }
}

module.exports = { recordAdminAction, adminActor, clientIp, clean, AUDIT_ACTIONS };
