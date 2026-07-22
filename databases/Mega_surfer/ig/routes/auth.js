const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_please_change';
const JWT_EXPIRES_IN = '7d';

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
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            console.log(`[AUTH LOGIN] User not found: ${email}`);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Check password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            console.log(`[AUTH LOGIN] Invalid password for user: ${email}`);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Account is disabled or suspended' });
        }

        // Check session limits
        const maxDevices = user.max_devices !== null ? user.max_devices : 3;
        const currentSessions = user.active_sessions || 0;
        
        if (currentSessions >= maxDevices) {
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

        res.json({
            success: true,
            user: userWithoutPassword,
            token
        });
    } catch (err) {
        console.error('[AUTH LOGIN] Error:', err.message);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
