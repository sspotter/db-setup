/**
 * Admin: read the admin audit trail. Identical in the TikTok and Instagram backends.
 * GET /api/admin/audit?limit=100&action=&q=&since=
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { AUDIT_ACTIONS } = require('../utils/adminAudit');

router.get('/audit', verifyAdmin, async (req, res) => {
    const action = req.query.action ? String(req.query.action) : '';
    if (action && !AUDIT_ACTIONS.includes(action)) {
        return res.status(400).json({ success: false, error: 'Unknown action', actions: AUDIT_ACTIONS });
    }
    const since = req.query.since ? new Date(req.query.since) : null;
    if (since && isNaN(since)) return res.status(400).json({ success: false, error: 'since must be an ISO date' });
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));

    const where = [];
    const values = [];
    if (action) { values.push(action); where.push(`action = $${values.length}`); }
    if (since) { values.push(since); where.push(`created_at >= $${values.length}`); }
    if (req.query.q) {
        values.push(String(req.query.q).slice(0, 200));
        where.push(`concat_ws(' ', action, target_email, ip, actor) ILIKE '%' || $${values.length} || '%'`);
    }
    values.push(limit);
    try {
        const result = await pool.query(
            `SELECT id, created_at, actor, action, target_user_id, target_email, detail, ip
             FROM admin_audit
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY created_at DESC, id DESC
             LIMIT $${values.length}`,
            values
        );
        res.json({ success: true, table_missing: false, actions: AUDIT_ACTIONS, rows: result.rows });
    } catch (err) {
        if (err.code === '42P01') {
            // Migration v7 not applied yet: say so instead of failing the panel.
            return res.json({ success: true, table_missing: true, actions: AUDIT_ACTIONS, rows: [] });
        }
        console.error('[ADMIN AUDIT] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
