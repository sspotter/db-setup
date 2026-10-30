const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db');

// hardening (B7): admin auth is a single shared plaintext password compared on
// every request, with no rate limiting and no per-admin accounts. Acceptable
// for an internal-only tool; before exposing this publicly, move to hashed
// per-admin credentials + rate limiting / lockout on the login route.
const verifyAdmin = (req, res, next) => {
    const adminPassword = req.headers['x-admin-password'];

    if (!adminPassword || adminPassword !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized: Invalid administrative password' });
    }
    next();
};

// POST /api/admin/login
router.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        res.json({ success: true, message: 'Authenticated successfully' });
    } else {
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

// GET /api/admin/users
// Each user also gets last_issue (newest >= 400 event) and ext_version (from the
// newest successful login), matched by user_id or case-insensitive email.
router.get('/users', verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.email, u.status, u.plan, u.active_sessions, u.max_devices, u.last_login, u.created_at,
                    li.last_issue, ev.ext_version
             FROM users u
             LEFT JOIN LATERAL (
                 SELECT json_build_object('reason', e.reason, 'status', e.status, 'path', e.path,
                                          'error', e.error, 'created_at', e.created_at) AS last_issue
                 FROM api_events e
                 WHERE e.status >= 400 AND (e.user_id = u.id OR lower(e.email) = lower(u.email))
                 ORDER BY e.created_at DESC LIMIT 1
             ) li ON true
             LEFT JOIN LATERAL (
                 SELECT e.ext_version
                 FROM api_events e
                 WHERE e.reason = 'success' AND (e.user_id = u.id OR lower(e.email) = lower(u.email))
                 ORDER BY e.created_at DESC LIMIT 1
             ) ev ON true
             ORDER BY u.created_at DESC`
        );
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('[ADMIN GET USERS] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Returns the value if allowed, the first (default) entry if absent, null if unknown.
const pickOption = (value, allowed) => (value === undefined || value === '' ? allowed[0] : allowed.includes(value) ? value : null);

// GET /api/admin/events?q=&user=&action=all|login|api&result=any|success|failed&since=&today_start=&limit=200
// Legacy params still honoured: email= (substring), kind=all|logins|errors.
// stats.all_time / stats.today ignore filters; matching / failed / distinct_users use them.
router.get('/events', verifyAdmin, async (req, res) => {
    try {
        const kind = pickOption(req.query.kind, ['all', 'logins', 'errors']);
        const action = pickOption(req.query.action, ['all', 'login', 'api']);
        const outcome = pickOption(req.query.result, ['any', 'success', 'failed']);
        if (!kind || !action || !outcome) {
            return res.status(400).json({ success: false, error: 'kind, action or result has an unknown value' });
        }
        const since = req.query.since ? new Date(req.query.since) : null;
        const todayStart = req.query.today_start ? new Date(req.query.today_start) : null;
        if ((since && isNaN(since)) || (todayStart && isNaN(todayStart))) {
            return res.status(400).json({ success: false, error: 'since and today_start must be ISO dates' });
        }
        const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 200));

        const where = [];
        const values = [];
        if (req.query.email) {
            values.push(String(req.query.email));
            where.push(`email ILIKE '%' || $${values.length} || '%'`);
        }
        if (req.query.user) {
            values.push(String(req.query.user));
            where.push(`lower(email) = lower($${values.length})`);
        }
        if (req.query.q) {
            values.push(String(req.query.q));
            where.push(`concat_ws(' ', email, path, error, reason, ip) ILIKE '%' || $${values.length} || '%'`);
        }
        if (since) {
            values.push(since);
            where.push(`created_at >= $${values.length}`);
        }
        if (kind === 'logins' || action === 'login') where.push(`path = '/api/auth/login'`);
        if (action === 'api') where.push(`path <> '/api/auth/login'`);
        if (kind === 'errors' || outcome === 'failed') where.push('status >= 400');
        if (outcome === 'success') where.push('status < 400');
        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const [events, stats] = await Promise.all([
            pool.query(
                `SELECT id, created_at, user_id, email, method, path, status, reason, error, ip, user_agent, ext_version
                 FROM api_events
                 ${whereSql}
                 ORDER BY created_at DESC
                 LIMIT $${values.length + 1}`,
                [...values, limit]
            ),
            pool.query(
                `SELECT (SELECT count(*) FROM api_events)::int AS all_time,
                        (SELECT count(*) FROM api_events
                         WHERE created_at >= coalesce($${values.length + 1}::timestamptz, date_trunc('day', now())))::int AS today,
                        count(*)::int AS matching,
                        (count(*) FILTER (WHERE status >= 400))::int AS failed,
                        count(DISTINCT coalesce(lower(email), user_id::text))::int AS distinct_users
                 FROM api_events
                 ${whereSql}`,
                [...values, todayStart]
            ),
        ]);
        res.json({ success: true, events: events.rows, stats: stats.rows[0] });
    } catch (err) {
        console.error('[ADMIN GET EVENTS] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/admin/users
router.post('/users', verifyAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { email, password, plan, status, max_devices } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Check if user exists
        const userExists = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(409).json({ error: 'User already exists' });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert new user
        const result = await client.query(
            `INSERT INTO users (email, password_hash, plan, status, max_devices) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id, email, status, plan, active_sessions, max_devices, created_at`,
            [email, passwordHash, plan || 'none', status || 'active', max_devices || 3]
        );

        res.status(201).json({
            success: true,
            user: result.rows[0]
        });
    } catch (err) {
        console.error('[ADMIN CREATE USER] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/users/:id
router.put('/users/:id', verifyAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { email, password, plan, status, max_devices } = req.body;

        // Check if user exists
        const userExists = await client.query('SELECT id, password_hash FROM users WHERE id = $1', [id]);
        if (userExists.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (email) {
            updates.push(`email = $${paramIdx++}`);
            values.push(email);
        }
        if (plan) {
            updates.push(`plan = $${paramIdx++}`);
            values.push(plan);
        }
        if (status) {
            updates.push(`status = $${paramIdx++}`);
            values.push(status);
        }
        if (max_devices !== undefined) {
            updates.push(`max_devices = $${paramIdx++}`);
            values.push(max_devices);
        }
        if (password) {
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            updates.push(`password_hash = $${paramIdx++}`);
            values.push(passwordHash);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(id);
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, email, status, plan, max_devices`;
        
        const result = await client.query(query, values);

        res.json({
            success: true,
            message: 'User updated successfully',
            user: result.rows[0]
        });
    } catch (err) {
        console.error('[ADMIN UPDATE USER] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/admin/users/:id/logout
router.post('/users/:id/logout', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'UPDATE users SET active_sessions = 0 WHERE id = $1 RETURNING id',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, message: 'User forced logged out successfully' });
    } catch (err) {
        console.error('[ADMIN LOGOUT USER] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, message: 'User deleted successfully', id: result.rows[0].id });
    } catch (err) {
        console.error('[ADMIN DELETE USER] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
