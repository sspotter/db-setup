/**
 * Health check route
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS server_time');
        // Append a trailing newline so the shell prompt starts on its own line
        // after `curl .../api/health`.
        res.type('json').send(JSON.stringify({
            "Platform": "TikTok",
            status: 'ok',
            database: 'connected',
            serverTime: result.rows[0].server_time,
        }) + '\n');
    } catch (err) {
        res.status(500).type('json').send(JSON.stringify({
            status: 'error',
            database: 'disconnected',
            error: err.message,
        }) + '\n');
    }
});

module.exports = router;
