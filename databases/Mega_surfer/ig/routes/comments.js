/**
 * Comments routes — bulk upsert, query, and deduplication check
 * Now supports project-scoped queries via project_posts junction table.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * POST /api/comments
 * Body: { post_shortcode, comments: [...] }
 * 
 * Bulk upserts comments for a specific post.
 * Uses ON CONFLICT to avoid duplicates.
 */
router.post('/comments', async (req, res) => {
    const client = await pool.connect();

    try {
        const { post_shortcode, comments } = req.body;

        if (!post_shortcode || !Array.isArray(comments) || comments.length === 0) {
            return res.status(400).json({ success: false, error: 'post_shortcode and comments array required' });
        }

        await client.query('BEGIN');

        let inserted = 0;
        let updated = 0;

        for (const comment of comments) {
            if (!comment.id) continue;

            let commentedAt = null;
            if (comment.timestamp) {
                if (typeof comment.timestamp === 'string') {
                    commentedAt = comment.timestamp;
                } else {
                    const ms = comment.timestamp > 10000000000 ? comment.timestamp : comment.timestamp * 1000;
                    commentedAt = new Date(ms).toISOString();
                }
            }

            const result = await client.query(
                `INSERT INTO comments (id, post_shortcode, username, user_id, text, likes_count, reply_count, profile_pic_url, commented_at, scraped_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    text = COALESCE(EXCLUDED.text, comments.text),
                    likes_count = GREATEST(comments.likes_count, EXCLUDED.likes_count),
                    reply_count = GREATEST(comments.reply_count, EXCLUDED.reply_count),
                    profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, comments.profile_pic_url),
                    scraped_at = NOW()
                 RETURNING (xmax = 0) AS is_insert`,
                [
                    comment.id,
                    post_shortcode,
                    comment.username || null,
                    comment.userId || comment.user_id || comment.ownerId || null,
                    comment.text || null,
                    comment.likes || comment.likes_count || 0,
                    comment.replyCount || comment.reply_count || 0,
                    comment.profilePic || comment.profile_pic_url || null,
                    commentedAt,
                ]
            );

            if (result.rows[0]?.is_insert) inserted++;
            else updated++;
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            post_shortcode,
            inserted,
            updated,
            total: inserted + updated,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[COMMENTS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * GET /api/comments
 * Query params: ?project_id=UUID&post=shortcode&limit=100&offset=0
 * 
 * If project_id provided, scopes to project's posts.
 * Otherwise falls back to user_scraped_posts.
 */
router.get('/comments', async (req, res) => {
    try {
        const { project_id, post, username, limit = 100, offset = 0 } = req.query;

        let query;
        const params = [];
        let paramIdx = 1;

        if (project_id) {
            query = `SELECT c.* FROM comments c
                     JOIN project_posts ppo ON c.post_shortcode = ppo.post_shortcode
                     JOIN projects proj ON ppo.project_id = proj.id
                     WHERE ppo.project_id = $${paramIdx++} AND proj.user_id = $${paramIdx++}`;
            params.push(project_id, req.user.id);
        } else {
            query = 'SELECT c.* FROM comments c JOIN user_scraped_posts up ON c.post_shortcode = up.post_shortcode WHERE up.user_id = $1';
            params.push(req.user.id);
            paramIdx = 2;
        }

        if (post) {
            query += ` AND c.post_shortcode = $${paramIdx++}`;
            params.push(post);
        }
        if (username) {
            query += ` AND c.username = $${paramIdx++}`;
            params.push(username);
        }

        query += ` ORDER BY c.commented_at DESC NULLS LAST LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Count total
        let countQuery;
        const countParams = [];
        let cIdx = 1;

        if (project_id) {
            countQuery = `SELECT COUNT(c.*) FROM comments c
                          JOIN project_posts ppo ON c.post_shortcode = ppo.post_shortcode
                          JOIN projects proj ON ppo.project_id = proj.id
                          WHERE ppo.project_id = $${cIdx++} AND proj.user_id = $${cIdx++}`;
            countParams.push(project_id, req.user.id);
        } else {
            countQuery = 'SELECT COUNT(c.*) FROM comments c JOIN user_scraped_posts up ON c.post_shortcode = up.post_shortcode WHERE up.user_id = $1';
            countParams.push(req.user.id);
            cIdx = 2;
        }

        if (post) { countQuery += ` AND c.post_shortcode = $${cIdx++}`; countParams.push(post); }
        if (username) { countQuery += ` AND c.username = $${cIdx++}`; countParams.push(username); }

        const countResult = await pool.query(countQuery, countParams);

        res.json({
            success: true,
            comments: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (err) {
        console.error('[COMMENTS GET] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/comments/check
 * Body: { shortcodes: [...], project_id? }
 * 
 * Returns which shortcodes already have scraped comments.
 * If project_id provided, checks scoped to project's posts.
 */
router.post('/comments/check', async (req, res) => {
    try {
        const { shortcodes, project_id } = req.body;

        if (!Array.isArray(shortcodes) || shortcodes.length === 0) {
            return res.status(400).json({ success: false, error: 'shortcodes array required' });
        }

        let result;

        if (project_id) {
            result = await pool.query(
                `SELECT c.post_shortcode, COUNT(c.*) as comment_count
                 FROM comments c
                 JOIN project_posts ppo ON c.post_shortcode = ppo.post_shortcode
                 JOIN projects proj ON ppo.project_id = proj.id
                 WHERE c.post_shortcode = ANY($1) AND ppo.project_id = $2 AND proj.user_id = $3
                 GROUP BY c.post_shortcode`,
                [shortcodes, project_id, req.user.id]
            );
        } else {
            result = await pool.query(
                `SELECT c.post_shortcode, COUNT(c.*) as comment_count
                 FROM comments c
                 JOIN user_scraped_posts up ON c.post_shortcode = up.post_shortcode
                 WHERE c.post_shortcode = ANY($1) AND up.user_id = $2
                 GROUP BY c.post_shortcode`,
                [shortcodes, req.user.id]
            );
        }

        const scraped = {};
        result.rows.forEach(row => {
            scraped[row.post_shortcode] = parseInt(row.comment_count);
        });

        const alreadyScraped = shortcodes.filter(sc => scraped[sc] > 0);
        const needsScraping = shortcodes.filter(sc => !scraped[sc]);

        res.json({
            success: true,
            scraped,
            alreadyScraped,
            needsScraping,
            totalChecked: shortcodes.length,
            totalScraped: alreadyScraped.length,
            totalPending: needsScraping.length,
        });
    } catch (err) {
        console.error('[COMMENTS CHECK] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/comments/log
 * Body: { post_shortcode, api_calls, comments_scraped }
 * 
 * Logs a completed comment scrape job for tracking API usage.
 */
router.post('/comments/log', async (req, res) => {
    try {
        const { post_shortcode, api_calls, comments_scraped } = req.body;

        if (!post_shortcode) {
            return res.status(400).json({ success: false, error: 'post_shortcode required' });
        }

        const result = await pool.query(
            `INSERT INTO comment_scrape_logs (user_id, post_shortcode, api_calls, comments_scraped, scraped_at)
             VALUES ($1, $2, $3, $4, NOW())
             RETURNING *`,
            [req.user.id, post_shortcode, api_calls || 0, comments_scraped || 0]
        );

        res.json({ success: true, log: result.rows[0] });
    } catch (err) {
        console.error('[COMMENTS LOG] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/comments/logs
 * Retrieves the comment scrape logs for the user
 */
router.get('/comments/logs', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;

        const result = await pool.query(
            `SELECT * FROM comment_scrape_logs 
             WHERE user_id = $1 
             ORDER BY scraped_at DESC 
             LIMIT $2 OFFSET $3`,
            [req.user.id, parseInt(limit), parseInt(offset)]
        );

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM comment_scrape_logs WHERE user_id = $1`,
            [req.user.id]
        );

        res.json({
            success: true,
            logs: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (err) {
        console.error('[COMMENTS LOG GET] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
