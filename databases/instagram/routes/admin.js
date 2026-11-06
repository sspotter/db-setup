const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { recordAdminAction, clientIp } = require('../utils/adminAudit');
const { ipBlockGuard } = require('../middleware/ipBlock');
const lockout = require('../utils/adminLockout');

// Login lockout: after ADMIN_LOGIN_MAX_FAILS wrong passwords from one IP (or for one account
// email) inside ADMIN_LOGIN_WINDOW_MIN minutes, /login answers 429 (see utils/adminLockout.js).
const lockedOut = (res, key) => {
    const retryAfter = lockout.retryAfterSeconds(key);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ success: false, error: 'Too many failed attempts. Try again later.', retry_after_s: retryAfter });
};

// Compared against when the email is unknown, so timing doesn't reveal which accounts exist.
let dummyHash = null;
const getDummyHash = () => {
    if (!dummyHash) dummyHash = bcrypt.hash(crypto.randomBytes(32).toString('hex'), verifyAdmin.ADMIN_BCRYPT_ROUNDS);
    return dummyHash;
};

async function accountLogin(req, res, ip) {
    if (!verifyAdmin.tokenSecret()) {
        return res.status(503).json({ success: false, error: 'Admin accounts are off: ADMIN_JWT_SECRET is not set. Use the shared password.' });
    }
    const { email, password } = req.body;
    const address = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
    const emailKey = `email:${address}`;
    if (lockout.isLocked(emailKey)) return lockedOut(res, emailKey);

    let account;
    try {
        const result = await pool.query('SELECT id, email, password_hash, disabled_at FROM admin_accounts WHERE lower(email) = $1', [address]);
        account = result.rows[0] || null;
    } catch (err) {
        if (err.code === '42P01') {
            return res.status(503).json({ success: false, error: 'Admin accounts are not set up yet: apply migrations/v9_admin_accounts.sql. Use the shared password.' });
        }
        console.error('[ADMIN LOGIN] Error:', err.message);
        logServerError(res, err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    // Count the attempt before the slow compare and undo it on success, so parallel guesses can't
    // all pass the check above while each compare is still running.
    if (lockout.isLocked(ip)) return lockedOut(res, ip);
    if (lockout.isLocked(emailKey)) return lockedOut(res, emailKey);
    lockout.addFail(ip);
    lockout.addFail(emailKey);

    const supplied = typeof password === 'string' ? password : '';
    const matched = await bcrypt.compare(supplied, account ? account.password_hash : await getDummyHash());
    if (account && matched && !account.disabled_at) {
        lockout.clear(ip);
        lockout.clear(emailKey);
        pool.query('UPDATE admin_accounts SET last_login = now() WHERE id = $1', [account.id])
            .catch((err) => console.error('[ADMIN LOGIN] last_login update failed:', err.message));
        req.admin = { id: account.id, email: account.email };
        await recordAdminAction(req, { action: 'admin_login', target_email: account.email });
        return res.json({
            success: true,
            message: 'Authenticated successfully',
            token: verifyAdmin.signAdminToken(account),
            email: account.email,
            expires_in_s: verifyAdmin.TOKEN_TTL_S,
        });
    }
    const locked = lockout.isLocked(ip) || lockout.isLocked(emailKey);
    // Only a real account's email is stored: what was typed for an unknown one could be a misplaced password.
    await recordAdminAction(req, {
        action: locked ? 'admin_login_locked' : 'admin_login_failed',
        target_email: account ? account.email : null,
        detail: { attempts: lockout.count(ip), account_login: true },
    });
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
}

// POST /api/admin/login with { password } (the shared password) or { email, password } (an account).
router.post('/login', ipBlockGuard, async (req, res) => {
    const ip = clientIp(req) || 'unknown';
    if (lockout.isLocked(ip)) return lockedOut(res, ip);
    const { email, password } = req.body || {};
    if (email !== undefined && email !== null && email !== '') return accountLogin(req, res, ip);
    const ok = typeof password === 'string' && !!process.env.ADMIN_PASSWORD && verifyAdmin.safeEqual(password, process.env.ADMIN_PASSWORD);
    if (ok) {
        lockout.clear(ip);
        req.admin = { shared: true };
        await recordAdminAction(req, { action: 'admin_login' });
        return res.json({ success: true, message: 'Authenticated successfully' });
    }
    lockout.addFail(ip);
    await recordAdminAction(req, { action: lockout.isLocked(ip) ? 'admin_login_locked' : 'admin_login_failed', detail: { attempts: lockout.count(ip) } });
    res.status(401).json({ success: false, error: 'Invalid password' });
});

// plan_expires_at / trial_ends_at come from migrations/v8_plan_expiry.sql. Until it is applied,
// the user list falls back to the old columns; the answer is re-checked after a minute.
let planColsMissingAt = 0;
const PLAN_COLS_MISSING = 'plan_expires_at / trial_ends_at do not exist yet: apply migrations/v8_plan_expiry.sql first';
// undefined = not sent, null or '' = clear, Date = set, false = not a valid date.
const parseDate = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v !== 'string') return false;
    const d = new Date(v);
    return isNaN(d) ? false : d;
};

// GET /api/admin/users
// Each user also gets last_issue (newest >= 400 event) and ext_version (from the
// newest successful login), matched by user_id or case-insensitive email.
router.get('/users', verifyAdmin, async (req, res) => {
    try {
        const usersQuery = (withPlan) => pool.query(
            `SELECT u.id, u.email, u.status, u.plan, u.active_sessions, u.max_devices, u.last_login, u.last_seen, u.created_at,${withPlan ? ' u.plan_expires_at, u.trial_ends_at,' : ''}
                    li.last_issue, ev.ext_version, rl.recent_logins,
                    GREATEST(0, COALESCE(u.active_sessions, 0) - rl.recent_logins) AS ghost_sessions,
                    pr.reset_link
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
             -- JWTs last 7 d (config/jwt.js), so a session older than that cannot still be live.
             LEFT JOIN LATERAL (
                 SELECT count(*)::int AS recent_logins
                 FROM api_events e
                 WHERE e.reason = 'success' AND e.created_at >= now() - interval '7 days'
                   AND (e.user_id = u.id OR lower(e.email) = lower(u.email))
             ) rl ON true
             LEFT JOIN LATERAL (
                 SELECT json_build_object('created_at', r.created_at, 'expires_at', r.expires_at,
                        'status', CASE WHEN r.used_at IS NOT NULL THEN 'used'
                                       WHEN r.expires_at <= now() THEN 'expired'
                                       ELSE 'pending' END) AS reset_link
                 FROM password_resets r
                 WHERE r.user_id = u.id
                 ORDER BY r.created_at DESC LIMIT 1
             ) pr ON true
             ORDER BY u.created_at DESC`
        );
        let result;
        if (Date.now() - planColsMissingAt < 60000) {
            result = await usersQuery(false);
        } else {
            try {
                result = await usersQuery(true);
            } catch (err) {
                if (err.code !== '42703') throw err;
                planColsMissingAt = Date.now();
                result = await usersQuery(false);
            }
        }
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('[ADMIN GET USERS] Error:', err.message);
        logServerError(res, err);
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
                `SELECT id, created_at, user_id, email, method, path, status, reason, error, ip, user_agent, ext_version, duration_ms, server_error, detail,
                        COALESCE(detail->>'project_name',
                                 (SELECT pr.name FROM projects pr WHERE pr.id::text = lower(COALESCE(detail->>'project_id', substring(path from '/projects/([0-9a-fA-F-]{36})'))))) AS project_name
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
        res.json({ success: true, events: events.rows, stats: stats.rows[0], slow_ms: parseInt(process.env.SLOW_REQUEST_MS, 10) || 2000 });
    } catch (err) {
        console.error('[ADMIN GET EVENTS] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// A failed pool.connect() outside a try would be an unhandled rejection, which ends the process.
async function connectOr500(res) {
    try {
        return await pool.connect();
    } catch (err) {
        console.error('[ADMIN] Could not get a database connection:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
        return null;
    }
}

// POST /api/admin/users
router.post('/users', verifyAdmin, async (req, res) => {
    const client = await connectOr500(res);
    if (!client) return;
    try {
        const { email, password, plan, status, max_devices } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const planExpires = parseDate(req.body.plan_expires_at);
        const trialEnds = parseDate(req.body.trial_ends_at);
        if (planExpires === false || trialEnds === false) {
            return res.status(400).json({ error: 'plan_expires_at and trial_ends_at must be ISO dates or null' });
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
        const cols = ['email', 'password_hash', 'plan', 'status', 'max_devices'];
        const vals = [email, passwordHash, plan || 'none', status || 'active', max_devices || 3];
        if (planExpires !== undefined) { cols.push('plan_expires_at'); vals.push(planExpires); }
        if (trialEnds !== undefined) { cols.push('trial_ends_at'); vals.push(trialEnds); }
        const result = await client.query(
            `INSERT INTO users (${cols.join(', ')})
             VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id, email, status, plan, active_sessions, max_devices, created_at`,
            vals
        );
        await recordAdminAction(req, {
            action: 'user_create', target_user_id: result.rows[0].id, target_email: result.rows[0].email,
            detail: { plan: result.rows[0].plan, status: result.rows[0].status, max_devices: result.rows[0].max_devices },
        });

        res.status(201).json({
            success: true,
            user: result.rows[0]
        });
    } catch (err) {
        if (err.code === '42703') return res.status(400).json({ error: PLAN_COLS_MISSING });
        console.error('[ADMIN CREATE USER] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/users/:id
router.put('/users/:id', verifyAdmin, async (req, res) => {
    const client = await connectOr500(res);
    if (!client) return;
    try {
        const { id } = req.params;
        const { email, password, plan, status, max_devices } = req.body;
        const planExpires = parseDate(req.body.plan_expires_at);
        const trialEnds = parseDate(req.body.trial_ends_at);
        if (planExpires === false || trialEnds === false) {
            return res.status(400).json({ error: 'plan_expires_at and trial_ends_at must be ISO dates or null' });
        }

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
        if (planExpires !== undefined) {
            updates.push(`plan_expires_at = $${paramIdx++}`);
            values.push(planExpires);
        }
        if (trialEnds !== undefined) {
            updates.push(`trial_ends_at = $${paramIdx++}`);
            values.push(trialEnds);
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

        // Which fields changed; the password and the new email are never written to the log.
        const changed = ['email', 'password', 'plan', 'status'].filter((k) => req.body[k]);
        if (max_devices !== undefined) changed.push('max_devices');
        if (planExpires !== undefined) changed.push('plan_expires_at');
        if (trialEnds !== undefined) changed.push('trial_ends_at');
        await recordAdminAction(req, {
            action: 'user_update', target_user_id: id, target_email: result.rows[0].email,
            detail: { fields: changed, plan: result.rows[0].plan, status: result.rows[0].status, max_devices: result.rows[0].max_devices },
        });

        res.json({
            success: true,
            message: 'User updated successfully',
            user: result.rows[0]
        });
    } catch (err) {
        if (err.code === '42703') return res.status(400).json({ error: PLAN_COLS_MISSING });
        console.error('[ADMIN UPDATE USER] Error:', err.message);
        logServerError(res, err);
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
            'UPDATE users SET active_sessions = 0 WHERE id = $1 RETURNING id, email',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        await recordAdminAction(req, { action: 'user_logout', target_user_id: id, target_email: result.rows[0].email });
        res.json({ success: true, message: 'User forced logged out successfully' });
    } catch (err) {
        console.error('[ADMIN LOGOUT USER] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/admin/users/:id/reset-link
// Issues a single-use 24h link (one per RESET_BASE_URLS entry, comma-separated) and
// voids any earlier unused ones. The raw token is returned once; only its hash is stored.
const RESET_TTL_HOURS = 24;
const resetBases = () => (process.env.RESET_BASE_URLS || '').split(',').map(b => b.trim().replace(/\/+$/, '')).filter(Boolean);

// GET /api/admin/reset-bases — the connections an admin can send a reset link through.
router.get('/reset-bases', verifyAdmin, (req, res) => res.json({ success: true, bases: resetBases() }));

// Turns what an admin typed into a clean origin ("https://host[:port]"), or null when it is not a
// plain http(s) base: no credentials, path, query or fragment. The link is only ever shown to the
// admin, never sent anywhere, but a malformed base would still produce a broken or misleading link.
const normalizeResetBase = (value) => {
    const text = String(value || '').trim().replace(/\/+$/, '');
    if (!text || text.length > 200) return null;
    let u;
    try { u = new URL(text); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null;
    return `${u.protocol}//${u.host}`;
};

router.post('/users/:id/reset-link', verifyAdmin, async (req, res) => {
    try {
        const bases = resetBases();
        // Optional { base }: the admin types (or picks) the base URL the link should use, so one link is
        // issued for exactly that. Without it, one link per RESET_BASE_URLS entry.
        let chosen = bases;
        if (req.body && req.body.base) {
            const want = normalizeResetBase(req.body.base);
            if (!want) {
                return res.status(400).json({ success: false, error: 'Invalid base URL: use http:// or https:// with a host and optional port, and no path (for example https://example.com:8443)' });
            }
            if (!bases.includes(want)) console.log(`[ADMIN RESET LINK] custom base URL used: ${want}`);
            chosen = [want];
        } else if (bases.length === 0) {
            return res.status(500).json({ success: false, error: 'RESET_BASE_URLS is not configured; type a base URL instead' });
        }
        const user = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await pool.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [user.rows[0].id]);
        const saved = await pool.query(
            `INSERT INTO password_resets (token_hash, user_id, expires_at)
             VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING expires_at`,
            [tokenHash, user.rows[0].id, RESET_TTL_HOURS]
        );

        // Only the base URL(s) are logged: never the token or the link.
        await recordAdminAction(req, { action: 'user_reset_link', target_user_id: user.rows[0].id, target_email: user.rows[0].email, detail: { bases: chosen } });

        res.json({
            success: true,
            email: user.rows[0].email,
            expires_at: saved.rows[0].expires_at,
            links: chosen.map(b => `${b}/reset.html?token=${token}`),
        });
    } catch (err) {
        console.error('[ADMIN RESET LINK] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, email', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        await recordAdminAction(req, { action: 'user_delete', target_user_id: result.rows[0].id, target_email: result.rows[0].email });
        res.json({ success: true, message: 'User deleted successfully', id: result.rows[0].id });
    } catch (err) {
        console.error('[ADMIN DELETE USER] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
