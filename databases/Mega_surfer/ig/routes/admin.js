const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db');

// Basic middleware to ensure you can add an admin token later if needed
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
router.get('/users', verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, status, plan, active_sessions, max_devices, last_login, created_at FROM users ORDER BY created_at DESC'
        );
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('[ADMIN GET USERS] Error:', err.message);
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
