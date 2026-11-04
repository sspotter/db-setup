const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logServerError } = require('../middleware/activityLog');
const { getOwnedKeyword, checkKeywordOwnership, checkVideoOwnership, checkSessionOwnership } = require('../utils/ownership');

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
            if (!(await checkVideoOwnership(video_id, req.user.id))) {
                return res.status(404).json({ success: false, error: 'Not found' });
            }
            // A video_id is not globally unique: also leave out comments captured under other users' keywords.
            query += ` WHERE video_id = $1
                         AND (keyword_id IS NULL OR EXISTS (
                                SELECT 1 FROM search_keywords k JOIN projects p ON k.project_id = p.id
                                 WHERE k.id = tiktok_comments.keyword_id AND p.user_id = $2))
                       ORDER BY likes_count DESC, commented_at DESC`;
            params.push(video_id, req.user.id);
        } else if (keyword_id) {
            if (!(await checkKeywordOwnership(keyword_id, req.user.id))) {
                return res.status(404).json({ success: false, error: 'Not found' });
            }
            query += ` WHERE keyword_id = $1 ORDER BY likes_count DESC, commented_at DESC`;
            params.push(keyword_id);
        } else {
            return res.status(400).json({ success: false, error: 'keyword_id or video_id is required' });
        }

        const result = await pool.query(query, params);
        res.json({ success: true, comments: result.rows });
    } catch (err) {
        console.error('[TIKTOK_COMMENTS GET] Error:', err);
        logServerError(res, err);
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

        // The caller must own the keyword and the video before anything is written.
        let keywordId = null;
        if (keyword_id) {
            const owned = await getOwnedKeyword(keyword_id, req.user.id);
            if (!owned) return res.status(404).json({ success: false, error: 'Not found' });
            keywordId = owned.id;
        }
        if (!(await checkVideoOwnership(video_id, req.user.id))) {
            return res.status(404).json({ success: false, error: 'Not found' });
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
                `UPDATE tiktok_videos v
                    SET capture_status = 'comments_done', updated_at = CURRENT_TIMESTAMP
                   FROM projects p
                  WHERE v.project_id = p.id AND p.user_id = $2 AND v.video_id = $1
                    AND ($3::uuid IS NULL OR v.keyword_id = $3::uuid)`,
                [video_id, req.user.id, keywordId]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Processed ${comments.length} comments` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[TIKTOK_COMMENTS BATCH] Error:', err);
        logServerError(res, err);
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

        // Anything the capture is tagged with must belong to the caller.
        if ((keyword_id && !(await checkKeywordOwnership(keyword_id, req.user.id)))
            || (video_id && !(await checkVideoOwnership(video_id, req.user.id)))
            || (session_id && !(await checkSessionOwnership(session_id, req.user.id)))) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        
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
        logServerError(res, err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
