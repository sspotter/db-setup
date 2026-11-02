const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_please_change';
const JWT_EXPIRES_IN = '7d';
const { logServerError } = require('../middleware/activityLog');

// POST /api/auth/register
router.post('/register', async (req, res) => {
    const client = await pool.connect();
    try {
        const { email, password } = req.body;
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
            `INSERT INTO users (email, password_hash) 
             VALUES ($1, $2) RETURNING id, email, status, plan, created_at`,
            [email, passwordHash]
        );

        const user = result.rows[0];

        // Generate JWT
        const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN,
        });

        res.status(201).json({
            success: true,
            user,
            token
        });
    } catch (err) {
        console.error('[AUTH REGISTER] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const client = await pool.connect();
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.locals.activity = { reason: 'missing_fields', email };
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            console.log(`[AUTH LOGIN] User not found: ${email}`);
            res.locals.activity = { reason: 'no_such_user', email };
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Check password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            console.log(`[AUTH LOGIN] Invalid password for user: ${email}`);
            res.locals.activity = { reason: 'wrong_password', userId: user.id, email };
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Check if user is active
        if (user.status !== 'active') {
            // `error` overrides the logged text only; the client body is unchanged.
            res.locals.activity = { reason: 'disabled', userId: user.id, email, error: `Account is disabled or suspended (status: ${user.status})` };
            return res.status(403).json({ error: 'Account is disabled or suspended' });
        }

        // Check session limits
        const maxDevices = user.max_devices !== null ? user.max_devices : 3;
        const currentSessions = user.active_sessions || 0;
        
        if (currentSessions >= maxDevices) {
            res.locals.activity = { reason: 'device_limit', userId: user.id, email };
            return res.status(403).json({ 
                error: 'Device limit reached', 
                message: `You are already logged in on ${currentSessions} devices.` 
            });
        }

        // Update active_sessions and last_login
        await client.query(
            'UPDATE users SET active_sessions = active_sessions + 1, last_login = NOW() WHERE id = $1',
            [user.id]
        );

        // Generate JWT
        const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN,
        });

        // Omit password hash from response
        const { password_hash, ...userWithoutPassword } = user;

        res.locals.activity = { reason: 'success', userId: user.id, email };
        res.json({
            success: true,
            user: userWithoutPassword,
            token
        });
    } catch (err) {
        console.error('[AUTH LOGIN] Error:', err.message);
        res.locals.activity = { ...res.locals.activity, reason: 'server_error', email: req.body && req.body.email };
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/auth/reset-password  { token, password } — consumes an admin-issued link
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || typeof password !== 'string' || password.length < 8) {
        res.locals.activity = { reason: 'reset_invalid_input' };
        return res.status(400).json({ error: 'A token and a password of at least 8 characters are required' });
    }
    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const passwordHash = await bcrypt.hash(password, 10);
        // One statement: claim the token, then set the password for its user.
        const result = await pool.query(
            `WITH claimed AS (
                 UPDATE password_resets SET used_at = now()
                 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
                 RETURNING user_id
             )
             UPDATE users SET password_hash = $2, active_sessions = 0
             WHERE id IN (SELECT user_id FROM claimed) RETURNING id, email`,
            [tokenHash, passwordHash]
        );
        if (result.rows.length === 0) {
            res.locals.activity = { reason: 'reset_invalid_token' };
            return res.status(400).json({ error: 'This reset link is invalid or has expired' });
        }
        res.locals.activity = { reason: 'reset_success', userId: result.rows[0].id, email: result.rows[0].email };
        res.json({ success: true });
    } catch (err) {
        console.error('[AUTH RESET] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/auth/logout
const authenticateToken = require('../middleware/auth');
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'UPDATE users SET active_sessions = GREATEST(0, active_sessions - 1) WHERE id = $1',
            [req.user.id]
        );
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        console.error('[AUTH LOGOUT] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/auth/me (Get current user)
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, status, plan, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('[AUTH ME] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
