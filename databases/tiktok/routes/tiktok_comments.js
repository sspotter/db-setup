const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/tiktok/comments?keyword_id=...
 * OR
 * GET /api/tiktok/comments?video_id=...
 * Get comments
 */
router.get('/tiktok/comments', async (req, res) => {
    try {
        const { keyword_id, video_id } = req.query;
        
        let query = `SELECT * FROM tiktok_comments`;
        const params = [];

        if (video_id) {
            query += ` WHERE video_id = $1 ORDER BY likes_count DESC, commented_at DESC`;
            params.push(video_id);
        } else if (keyword_id) {
            query += ` WHERE keyword_id = $1 ORDER BY likes_count DESC, commented_at DESC`;
            params.push(keyword_id);
        } else {
            return res.status(400).json({ success: false, error: 'keyword_id or video_id is required' });
        }

        const result = await pool.query(query, params);
        res.json({ success: true, comments: result.rows });
    } catch (err) {
        console.error('[TIKTOK_COMMENTS GET] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tiktok/comments/batch
 * Batch save comments
 */
router.post('/tiktok/comments/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        const { comments, keyword_id, video_id } = req.body;
        if (!comments || !Array.isArray(comments)) {
            return res.status(400).json({ success: false, error: 'comments array is required' });
        }
        if (!video_id) {
            return res.status(400).json({ success: false, error: 'video_id is required' });
        }

        await client.query('BEGIN');

        for (const c of comments) {
            await client.query(
                `INSERT INTO tiktok_comments (
                    id, video_id, keyword_id, commenter_username, commenter_user_id,
                    commenter_avatar_url, text, likes_count, reply_count,
                    is_reply, parent_comment_id, commented_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (id) DO UPDATE SET 
                    likes_count = EXCLUDED.likes_count,
                    reply_count = EXCLUDED.reply_count,
                    scraped_at = CURRENT_TIMESTAMP
                `,
                [
                    c.id || c.cid,
                    video_id,
                    keyword_id || null,
                    c.commenter_username || c.user?.unique_id || null,
                    c.commenter_user_id || c.user?.uid || null,
                    c.commenter_avatar_url || c.user?.avatar_thumb?.url_list?.[0] || null,
                    c.text || '',
                    c.likes_count || c.digg_count || 0,
                    c.reply_count || c.reply_comment_total || 0,
                    !!c.parent_comment_id || !!c.reply_id,
                    c.parent_comment_id || c.reply_id || null,
                    c.commented_at || (c.create_time ? new Date(c.create_time * 1000) : null)
                ]
            );
        }

        // Update video status to comments_done or partial
        if (video_id) {
            await client.query(
                `UPDATE tiktok_videos SET capture_status = 'comments_done', updated_at = CURRENT_TIMESTAMP WHERE video_id = $1`,
                [video_id]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Processed ${comments.length} comments` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[TIKTOK_COMMENTS BATCH] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/tiktok/graphql_captures
 * Log raw graphql request
 */
router.post('/tiktok/graphql_captures', async (req, res) => {
    try {
        const { session_id, keyword_id, video_id, url, method, capture_type, request_body, response_body } = req.body;
        
        await pool.query(
            `INSERT INTO tiktok_graphql_captures (
                session_id, keyword_id, video_id, url, method, capture_type, request_body, response_body
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                session_id || null,
                keyword_id || null,
                video_id || null,
                url,
                method || 'GET',
                capture_type || 'unknown',
                request_body ? JSON.stringify(request_body) : null,
                response_body ? JSON.stringify(response_body) : null
            ]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[TIKTOK_GRAPHQL POST] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
