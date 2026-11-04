/**
 * Admin: block and unblock IP addresses at the login routes. Identical in the TikTok and
 * Instagram backends, each with its own list.
 * GET /api/admin/blocked-ips, POST /api/admin/blocked-ips, DELETE /api/admin/blocked-ips/:ip
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { recordAdminAction, adminActor, clientIp } = require('../utils/adminAudit');
const { normalizeIp, isLoopback, forgetBlocks } = require('../middleware/ipBlock');

const DEFAULT_HOURS = 24;
const MAX_HOURS = 720;
const MAX_REASON = 200;
const TABLE_MISSING = 'IP blocking is not set up yet: apply migrations/v10_blocked_ips.sql';
const COLUMNS = 'ip, reason, blocked_by, created_at, expires_at';

// undefined = the default, null = invalid.
function parseHours(value) {
    if (value === undefined) return DEFAULT_HOURS;
    const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    return Number.isInteger(n) && n >= 1 && n <= MAX_HOURS ? n : null;
}

function failed(res, err, label) {
    if (err.code === '42P01') return res.status(503).json({ success: false, error: TABLE_MISSING });
    console.error(`[ADMIN BLOCKS] ${label}:`, err.message);
    logServerError(res, err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

router.get('/blocked-ips', verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(`SELECT ${COLUMNS} FROM blocked_ips WHERE expires_at > now() ORDER BY created_at DESC`);
        res.json({ success: true, blocks: result.rows, table_missing: false });
    } catch (err) {
        if (err.code === '42P01') return res.json({ success: true, blocks: [], table_missing: true });
        failed(res, err, 'List failed');
    }
});

router.post('/blocked-ips', verifyAdmin, async (req, res) => {
    const body = req.body || {};
    const ip = normalizeIp(body.ip);
    if (!ip) return res.status(400).json({ success: false, error: 'ip must be a valid IPv4 or IPv6 address' });
    if (isLoopback(ip)) return res.status(400).json({ success: false, error: 'A loopback address cannot be blocked' });
    if (ip === normalizeIp(clientIp(req))) return res.status(400).json({ success: false, error: 'You cannot block your own address' });
    const hours = parseHours(body.hours);
    if (hours === null) return res.status(400).json({ success: false, error: `hours must be a whole number from 1 to ${MAX_HOURS}` });
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
        return res.status(400).json({ success: false, error: 'reason must be text' });
    }
    const reason = (body.reason || '').trim().slice(0, MAX_REASON) || null;
    try {
        const result = await pool.query(
            `INSERT INTO blocked_ips (ip, reason, blocked_by, expires_at)
             VALUES ($1, $2, $3, now() + make_interval(hours => $4))
             ON CONFLICT (ip) DO UPDATE
               SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by,
                   created_at = now(), expires_at = EXCLUDED.expires_at
             RETURNING ${COLUMNS}`,
            [ip, reason, adminActor(req), hours]
        );
        forgetBlocks();
        await recordAdminAction(req, { action: 'ip_block', detail: { blocked_ip: ip, hours, reason } });
        res.json({ success: true, block: result.rows[0] });
    } catch (err) {
        failed(res, err, 'Block failed');
    }
});

router.delete('/blocked-ips/:ip', verifyAdmin, async (req, res) => {
    const ip = normalizeIp(req.params.ip);
    if (!ip) return res.status(400).json({ success: false, error: 'ip must be a valid IPv4 or IPv6 address' });
    try {
        const result = await pool.query('DELETE FROM blocked_ips WHERE ip = $1 RETURNING ip', [ip]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'That address is not blocked' });
        forgetBlocks();
        await recordAdminAction(req, { action: 'ip_unblock', detail: { blocked_ip: ip } });
        res.json({ success: true });
    } catch (err) {
        failed(res, err, 'Unblock failed');
    }
});

module.exports = router;
