const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logServerError } = require('../middleware/activityLog');
const { checkKeywordOwnership } = require('../utils/ownership');

/**
 * GET /api/tiktok/creators?keyword_id=...
 * Get creators discovered via a specific keyword
 */
router.get('/tiktok/creators', async (req, res) => {
    try {
        const { keyword_id } = req.query;
        if (!keyword_id) return res.status(400).json({ success: false, error: 'keyword_id is required' });
        if (!(await checkKeywordOwnership(keyword_id, req.user.id))) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }

        const result = await pool.query(
            `SELECT c.*, kc.video_count, kc.total_views, kc.first_seen_at as association_date
             FROM tiktok_creators c
             JOIN tiktok_keyword_creators kc ON c.id = kc.creator_id
             WHERE kc.keyword_id = $1
             ORDER BY kc.total_views DESC`,
            [keyword_id]
        );
        res.json({ success: true, creators: result.rows });
    } catch (err) {
        console.error('[TIKTOK_CREATORS GET] Error:', err);
        logServerError(res, err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
