const express = require('express');
const router = express.Router();
const pool = require('../db');
const { checkProjectOwnership, checkSessionOwnership } = require('../utils/ownership');

/** Normalize hashtag slug: strip #, lowercase, remove spaces */
function normalizeHashtagSlug(raw) {
    if (!raw) return '';
    return raw.replace(/^#/, '').toLowerCase().replace(/\s+/g, '');
}

function normalizeKeyword(raw, sourceType) {
    const trimmed = (raw || '').trim();
    return sourceType === 'hashtag' ? normalizeHashtagSlug(trimmed) : trimmed.toLowerCase();
}

/**
 * GET /api/keywords?project_id=...
 * List all keywords for a project
 */
router.get('/keywords', async (req, res) => {
    try {
        const { project_id, source_type = 'all' } = req.query;
        if (!project_id) return res.status(400).json({ success: false, error: 'project_id is required' });

        const owns = await checkProjectOwnership(project_id, req.user.id);
        if (!owns) return res.status(403).json({ success: false, error: 'Access denied' });

        const params = [project_id];
        let sourceFilter = '';
        if (source_type && source_type !== 'all') {
            if (!['search', 'hashtag'].includes(source_type)) {
                return res.status(400).json({ success: false, error: 'source_type must be search, hashtag, or all' });
            }
            params.push(source_type);
            sourceFilter = ` AND sk.source_type = $${params.length}`;
        }

        const result = await pool.query(
            `SELECT sk.*,
                    COALESCE(vc.live_count, 0) AS total_videos,
                    COALESCE(vc.creators_count, 0) AS total_creators,
                    COALESCE(vc.views_sum, 0) AS total_views,
                    COALESCE(vc.comments_sum, 0) AS total_comments,
                    COALESCE(vc.likes_sum, 0) AS total_likes,
                    COALESCE(vc.shares_sum, 0) AS total_shares,
                    COALESCE(vc.saves_sum, 0) AS total_saves
             FROM search_keywords sk
             LEFT JOIN (
                 SELECT keyword_id,
                        COUNT(*) AS live_count,
                        COUNT(DISTINCT creator_id) AS creators_count,
                        SUM(views_count) AS views_sum,
                        SUM(comments_count) AS comments_sum,
                        SUM(likes_count) AS likes_sum,
                        SUM(shares_count) AS shares_sum,
                        SUM(bookmarks_count) AS saves_sum
                 FROM tiktok_videos
                 WHERE (is_hidden = false OR is_hidden IS NULL)
                 GROUP BY keyword_id
             ) vc ON vc.keyword_id = sk.id
             WHERE sk.project_id = $1${sourceFilter}
             ORDER BY COALESCE(vc.live_count, 0) DESC, sk.created_at DESC`,
            params
        );
        res.json({ success: true, keywords: result.rows });
    } catch (err) {
        console.error('[KEYWORDS GET] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/keywords
 * Create a new keyword
 */
router.post('/keywords', async (req, res) => {
    try {
        const {
            project_id,
            keyword,
            platform = 'tiktok',
            source_type = 'search',
            tiktok_challenge_id = null,
        } = req.body;
        if (!project_id || !keyword) {
            return res.status(400).json({ success: false, error: 'project_id and keyword are required' });
        }
        if (!['search', 'hashtag'].includes(source_type)) {
            return res.status(400).json({ success: false, error: 'source_type must be search or hashtag' });
        }

        const owns = await checkProjectOwnership(project_id, req.user.id);
        if (!owns) return res.status(403).json({ success: false, error: 'Access denied' });

        const normalizedKeyword = normalizeKeyword(keyword, source_type);
        if (!normalizedKeyword) {
            return res.status(400).json({ success: false, error: 'keyword is required' });
        }

        const result = await pool.query(
            `INSERT INTO search_keywords (project_id, keyword, platform, source_type, tiktok_challenge_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (project_id, keyword, source_type)
             DO UPDATE SET
                updated_at = CURRENT_TIMESTAMP,
                tiktok_challenge_id = COALESCE(EXCLUDED.tiktok_challenge_id, search_keywords.tiktok_challenge_id)
             RETURNING *`,
            [project_id, normalizedKeyword, platform, source_type, tiktok_challenge_id || null]
        );

        res.json({ success: true, keyword: result.rows[0] });
    } catch (err) {
        console.error('[KEYWORDS POST] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/keywords/resolve-hashtag
 * Upsert a hashtag keyword and start a capture session (used by extension on tag-page load)
 */
router.post('/keywords/resolve-hashtag', async (req, res) => {
    try {
        const { project_id, hashtag, challenge_id } = req.body;
        if (!project_id || !hashtag) {
            return res.status(400).json({ success: false, error: 'project_id and hashtag are required' });
        }

        const owns = await checkProjectOwnership(project_id, req.user.id);
        if (!owns) return res.status(403).json({ success: false, error: 'Access denied' });

        const normalizedHashtag = normalizeHashtagSlug(hashtag);
        if (!normalizedHashtag) {
            return res.status(400).json({ success: false, error: 'hashtag is required' });
        }

        const keywordResult = await pool.query(
            `INSERT INTO search_keywords (project_id, keyword, platform, source_type, tiktok_challenge_id)
             VALUES ($1, $2, 'tiktok', 'hashtag', $3)
             ON CONFLICT (project_id, keyword, source_type)
             DO UPDATE SET
                updated_at = CURRENT_TIMESTAMP,
                tiktok_challenge_id = COALESCE(EXCLUDED.tiktok_challenge_id, search_keywords.tiktok_challenge_id)
             RETURNING *`,
            [project_id, normalizedHashtag, challenge_id || null]
        );

        const keyword = keywordResult.rows[0];

        const sessionResult = await pool.query(
            `INSERT INTO keyword_search_sessions (keyword_id, project_id, status)
             VALUES ($1, $2, 'active')
             RETURNING *`,
            [keyword.id, project_id]
        );

        const session = sessionResult.rows[0];

        res.json({
            success: true,
            keyword,
            session,
            keywordId: keyword.id,
            sessionId: session.id,
        });
    } catch (err) {
        console.error('[KEYWORDS resolve-hashtag] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/keywords/:id
 * Get keyword details + aggregate stats
 */
router.get('/keywords/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT sk.*, p.user_id 
             FROM search_keywords sk
             JOIN projects p ON sk.project_id = p.id
             WHERE sk.id = $1`,
            [id]
        );

        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Keyword not found' });
        
        if (result.rows[0].user_id !== req.user.id) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        res.json({ success: true, keyword: result.rows[0] });
    } catch (err) {
        console.error('[KEYWORDS GET/:id] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/keywords/:id
 * Delete a keyword and cascade delete all its data
 */
router.delete('/keywords/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const check = await pool.query(
            `SELECT p.user_id FROM search_keywords sk JOIN projects p ON sk.project_id = p.id WHERE sk.id = $1`,
            [id]
        );
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        if (check.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, error: 'Access denied' });

        await pool.query(`DELETE FROM search_keywords WHERE id = $1`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('[KEYWORDS DELETE] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/keywords/:id/sessions
 * List all search sessions for a keyword
 */
router.get('/keywords/:id/sessions', async (req, res) => {
    try {
        const { id } = req.params;
        const check = await pool.query(
            `SELECT p.user_id FROM search_keywords sk JOIN projects p ON sk.project_id = p.id WHERE sk.id = $1`,
            [id]
        );
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Keyword not found' });
        if (check.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, error: 'Access denied' });

        const result = await pool.query(
            `SELECT * FROM keyword_search_sessions WHERE keyword_id = $1 ORDER BY started_at DESC`,
            [id]
        );
        res.json({ success: true, sessions: result.rows });
    } catch (err) {
        console.error('[SESSIONS GET] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/keywords/:id/sessions
 * Start a new search session
 */
router.post('/keywords/:id/sessions', async (req, res) => {
    try {
        const { id } = req.params;
        const check = await pool.query(
            `SELECT project_id, p.user_id FROM search_keywords sk JOIN projects p ON sk.project_id = p.id WHERE sk.id = $1`,
            [id]
        );
        if (check.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        if (check.rows[0].user_id !== req.user.id) return res.status(403).json({ success: false, error: 'Access denied' });

        const result = await pool.query(
            `INSERT INTO keyword_search_sessions (keyword_id, project_id, status)
             VALUES ($1, $2, 'active')
             RETURNING *`,
            [id, check.rows[0].project_id]
        );

        res.json({ success: true, session: result.rows[0] });
    } catch (err) {
        console.error('[SESSIONS POST] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PATCH /api/keywords/:id/sessions/:sid
 * Update session status
 */
router.patch('/keywords/:id/sessions/:sid', async (req, res) => {
    try {
        const { sid } = req.params;
        const { status, scroll_position, videos_captured } = req.body;

        if (!(await checkSessionOwnership(sid, req.user.id))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (status !== undefined) {
            updates.push(`status = $${paramIdx++}`);
            values.push(status);
            if (status === 'completed' || status === 'failed') {
                updates.push(`ended_at = CURRENT_TIMESTAMP`);
            }
        }
        if (scroll_position !== undefined) {
            updates.push(`scroll_position = $${paramIdx++}`);
            values.push(scroll_position);
        }
        if (videos_captured !== undefined) {
            updates.push(`videos_captured = $${paramIdx++}`);
            values.push(videos_captured);
        }

        if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

        values.push(sid);
        const result = await pool.query(
            `UPDATE keyword_search_sessions SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            values
        );

        res.json({ success: true, session: result.rows[0] });
    } catch (err) {
        console.error('[SESSIONS PATCH] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
