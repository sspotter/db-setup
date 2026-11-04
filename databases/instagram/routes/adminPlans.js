/**
 * Admin: users whose plan or trial is about to lapse (or already has).
 * Identical in the TikTok and Instagram backends.
 * GET /api/admin/users/expiring?days=14
 *
 * Needs migrations/v8_plan_expiry.sql. Before it is applied the route answers
 * with columns_missing: true instead of failing. Expiry is informational only:
 * login does not check it.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');

router.get('/users/expiring', verifyAdmin, async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 14));
    try {
        // A user lapses when the later of the two dates passes: an old trial must not flag someone
        // with a paid plan still running. greatest() ignores NULLs, so one date alone still counts.
        const result = await pool.query(
            `SELECT id, email, plan, status, plan_expires_at, trial_ends_at,
                    greatest(plan_expires_at, trial_ends_at) AS lapses_at,
                    (greatest(plan_expires_at, trial_ends_at) < now()) AS lapsed
             FROM users
             WHERE greatest(plan_expires_at, trial_ends_at) <= now() + make_interval(days => $1)
             ORDER BY lapses_at ASC
             LIMIT 500`,
            [days]
        );
        res.json({ success: true, days, columns_missing: false, users: result.rows });
    } catch (err) {
        if (err.code === '42703') {
            return res.json({ success: true, days, columns_missing: true, users: [] });
        }
        console.error('[ADMIN EXPIRING] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
