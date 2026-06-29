/**
 * Health check route
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS server_time');
        res.json({
            "Platform": "Instagram",
            status: 'ok',
            database: 'connected',
            serverTime: result.rows[0].server_time,
        });
    } catch (err) {
        res.status(500).json({
            status: 'error',
            database: 'disconnected',
            error: err.message,
        });
    }
});

module.exports = router;
