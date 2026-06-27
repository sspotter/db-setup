const express = require('express');
const router = express.Router();
const pool = require('../db');
const { checkProjectOwnership, checkKeywordOwnership, getOwnedKeyword } = require('../utils/ownership');

function normalizePostedAt(video) {
    if (video.posted_at) {
        const parsed = new Date(video.posted_at);
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
    }
    const rawTs = video.timestamp ?? video.createTime ?? null;
    if (rawTs == null || rawTs === '') return null;
    const ms = typeof rawTs === 'number'
        ? (rawTs > 10000000000 ? rawTs : rawTs * 1000)
        : new Date(rawTs).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * GET /api/tiktok/videos/hidden?project_id=...
 * List ALL hidden videos across all keywords for a project,
 * with keyword name, source_type, and creator username attached.
 */
router.get('/tiktok/videos/hidden', async (req, res) => {
    try {
        const { project_id } = req.query;
        if (!project_id) return res.status(400).json({ success: false, error: 'project_id is required' });

        if (!(await checkProjectOwnership(project_id, req.user.id))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await pool.query(
            `SELECT
                v.*,
                c.username  AS creator_username,
                c.avatar_url,
                sk.keyword  AS keyword_name,
                sk.source_type,
                sk.id       AS keyword_id
             FROM tiktok_videos v
             LEFT JOIN tiktok_creators c   ON v.creator_id  = c.id
             LEFT JOIN search_keywords sk  ON v.keyword_id  = sk.id
             WHERE v.project_id = $1
               AND v.is_hidden  = true
             ORDER BY v.updated_at DESC NULLS LAST`,
            [project_id]
        );
        res.json({ success: true, videos: result.rows });
    } catch (err) {
        console.error('[TIKTOK_VIDEOS HIDDEN] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/tiktok/videos?keyword_id=...
 * List videos for a keyword
 */
router.get('/tiktok/videos', async (req, res) => {
    try {
        const { keyword_id } = req.query;
        if (!keyword_id) return res.status(400).json({ success: false, error: 'keyword_id is required' });

        if (!(await checkKeywordOwnership(keyword_id, req.user.id))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await pool.query(
            `SELECT v.*, c.username as creator_username, c.avatar_url
             FROM tiktok_videos v
             LEFT JOIN tiktok_creators c ON v.creator_id = c.id
             WHERE v.keyword_id = $1
             ORDER BY v.views_count DESC NULLS LAST`,
            [keyword_id]
        );
        res.json({ success: true, videos: result.rows });
    } catch (err) {
        console.error('[TIKTOK_VIDEOS GET] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/tiktok/videos/batch
 * Batch upsert (deduplication handled server-side)
 */
router.post('/tiktok/videos/batch', async (req, res) => {
    const client = await pool.connect();
    try {
        const { videos, keyword_id, session_id } = req.body;
        if (!videos || !Array.isArray(videos)) {
            return res.status(400).json({ success: false, error: 'videos array is required' });
        }
        if (!keyword_id) {
            return res.status(400).json({ success: false, error: 'keyword_id is required' });
        }

        // Verify the keyword belongs to the caller, and use ITS project_id
        // rather than trusting a project_id from the request body.
        const ownedKeyword = await getOwnedKeyword(keyword_id, req.user.id);
        if (!ownedKeyword) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const project_id = ownedKeyword.project_id;

        await client.query('BEGIN');

        for (const v of videos) {
            // 1. Upsert Creator
            let creatorId = null;
            if (v.creator_username) {
                const creatorRes = await client.query(
                    `INSERT INTO tiktok_creators (tiktok_user_id, username, display_name, avatar_url)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (username) DO UPDATE SET 
                        display_name = COALESCE(EXCLUDED.display_name, tiktok_creators.display_name),
                        avatar_url = COALESCE(EXCLUDED.avatar_url, tiktok_creators.avatar_url),
                        last_updated_at = CURRENT_TIMESTAMP
                     RETURNING id`,
                    [
                        v.creator_id || v.creator_username, // tiktok_user_id fallback
                        v.creator_username,
                        v.creator_display_name || v.creator_username,
                        v.creator_avatar_url || null
                    ]
                );
                creatorId = creatorRes.rows[0].id;

                // Link creator to keyword
                if (keyword_id) {
                    await client.query(
                        `INSERT INTO tiktok_keyword_creators (keyword_id, creator_id, video_count, total_views)
                         VALUES ($1, $2, 1, $3)
                         ON CONFLICT (keyword_id, creator_id) DO UPDATE SET 
                            video_count = tiktok_keyword_creators.video_count + 1,
                            total_views = tiktok_keyword_creators.total_views + EXCLUDED.total_views,
                            last_seen_at = CURRENT_TIMESTAMP`,
                        [keyword_id, creatorId, v.views_count || 0]
                    );
                }
            }

            // 2. Upsert Video
            const postedAt = normalizePostedAt(v);
            await client.query(
                `INSERT INTO tiktok_videos (
                    video_id, keyword_id, session_id, creator_id, project_id,
                    caption, video_url, thumbnail_url, duration,
                    views_count, likes_count, comments_count, shares_count, bookmarks_count, reposts_count,
                    capture_status, posted_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                ON CONFLICT (video_id, keyword_id) DO UPDATE SET 
                    views_count = EXCLUDED.views_count,
                    likes_count = EXCLUDED.likes_count,
                    comments_count = EXCLUDED.comments_count,
                    shares_count = EXCLUDED.shares_count,
                    bookmarks_count = EXCLUDED.bookmarks_count,
                    reposts_count = EXCLUDED.reposts_count,
                    posted_at = COALESCE(EXCLUDED.posted_at, tiktok_videos.posted_at),
                    capture_status = CASE 
                        WHEN tiktok_videos.capture_status IN ('comments_done', 'failed') THEN tiktok_videos.capture_status
                        ELSE EXCLUDED.capture_status 
                    END,
                    updated_at = CURRENT_TIMESTAMP
                `,
                [
                    v.video_id,
                    keyword_id,
                    session_id || null,
                    creatorId,
                    project_id,
                    v.caption || null,
                    v.video_url || null,
                    v.thumbnail_url || null,
                    v.duration || 0,
                    v.views_count || 0,
                    v.likes_count || 0,
                    v.comments_count || 0,
                    v.shares_count || 0,
                    v.bookmarks_count || 0,
                    v.reposts_count || v.repost_count || 0,
                    'captured',
                    postedAt
                ]
            );
        }

        // 3. Update Keyword stats
        if (keyword_id) {
            await client.query(
                `UPDATE search_keywords 
                 SET total_videos = (SELECT COUNT(*) FROM tiktok_videos WHERE keyword_id = $1),
                     total_creators = (SELECT COUNT(DISTINCT creator_id) FROM tiktok_videos WHERE keyword_id = $1),
                     total_views = (SELECT COALESCE(SUM(views_count), 0) FROM tiktok_videos WHERE keyword_id = $1)
                 WHERE id = $1`,
                [keyword_id]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Processed ${videos.length} videos` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[TIKTOK_VIDEOS BATCH] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * PATCH /api/tiktok/videos/:video_id/qualify
 * Update analyst qualification flags
 */
router.patch('/tiktok/videos/:video_id/qualify', async (req, res) => {
    try {
        const { video_id } = req.params;
        const { included_in_reach, included_in_engagement, included_in_reporting, manual_reviewed, is_hidden } = req.body;

        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (included_in_reach !== undefined) {
            updates.push(`included_in_reach = $${paramIdx++}`);
            values.push(included_in_reach);
        }
        if (included_in_engagement !== undefined) {
            updates.push(`included_in_engagement = $${paramIdx++}`);
            values.push(included_in_engagement);
        }
        if (included_in_reporting !== undefined) {
            updates.push(`included_in_reporting = $${paramIdx++}`);
            values.push(included_in_reporting);
        }
        if (manual_reviewed !== undefined) {
            updates.push(`manual_reviewed = $${paramIdx++}`);
            values.push(manual_reviewed);
        }
        if (is_hidden !== undefined) {
            updates.push(`is_hidden = $${paramIdx++}`);
            values.push(is_hidden);
        }

        if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

        // Scope the update to rows the caller owns. A TikTok video_id is not
        // unique on its own (the same video can appear under other users'
        // keywords), so we join projects and filter by user_id to prevent a
        // cross-tenant write. An empty result means "not found or not yours".
        values.push(video_id);
        const videoIdParam = paramIdx++;
        values.push(req.user.id);
        const userIdParam = paramIdx;

        const result = await pool.query(
            `UPDATE tiktok_videos v
                SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
               FROM projects p
              WHERE v.project_id = p.id
                AND v.video_id = $${videoIdParam}
                AND p.user_id = $${userIdParam}
             RETURNING v.*`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Refresh keyword stats for every keyword whose video set changed.
        const affectedKeywordIds = [...new Set(result.rows.map(r => r.keyword_id).filter(Boolean))];
        for (const keywordId of affectedKeywordIds) {
            await pool.query(
                `UPDATE search_keywords
                 SET total_videos = (SELECT COUNT(*) FROM tiktok_videos WHERE keyword_id = $1 AND (is_hidden = false OR is_hidden IS NULL)),
                     total_creators = (SELECT COUNT(DISTINCT creator_id) FROM tiktok_videos WHERE keyword_id = $1 AND (is_hidden = false OR is_hidden IS NULL)),
                     total_views = (SELECT COALESCE(SUM(views_count), 0) FROM tiktok_videos WHERE keyword_id = $1 AND (is_hidden = false OR is_hidden IS NULL))
                 WHERE id = $1`,
                [keywordId]
            );
        }

        res.json({ success: true, video: result.rows[0] });
    } catch (err) {
        console.error('[TIKTOK_VIDEOS QUALIFY] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/keywords/:id/analytics
 * Aggregated analytics for the Analytics Tab in the dataset viewer
 */
router.get('/keywords/:id/analytics', async (req, res) => {
    try {
        const { id } = req.params;

        if (!(await checkKeywordOwnership(id, req.user.id))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // 1. Reach: selected videos + total/avg views
        const reachRes = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE included_in_reach = true)  AS selected_videos,
                COUNT(*)                                           AS total_videos,
                COALESCE(SUM(views_count) FILTER (WHERE included_in_reach = true), 0) AS potential_reach,
                COALESCE(AVG(views_count) FILTER (WHERE included_in_reach = true), 0) AS avg_views
             FROM tiktok_videos 
             WHERE keyword_id = $1 AND (is_hidden = false OR is_hidden IS NULL)`,
            [id]
        );

        // 2. Engagement totals
        const engRes = await pool.query(
            `SELECT
                COALESCE(SUM(likes_count), 0)    AS total_likes,
                COALESCE(SUM(comments_count), 0) AS total_comments,
                COALESCE(SUM(shares_count), 0)   AS total_shares,
                COALESCE(SUM(views_count), 0)    AS total_views
             FROM tiktok_videos 
             WHERE keyword_id = $1 AND (is_hidden = false OR is_hidden IS NULL)`,
            [id]
        );

        // 2b. Scraped comments count (joining tiktok_videos to filter out hidden posts)
        const scrapedCommentsRes = await pool.query(
            `SELECT COUNT(c.id) AS count 
             FROM tiktok_comments c
             JOIN tiktok_videos v ON c.video_id = v.video_id AND c.keyword_id = v.keyword_id
             WHERE c.keyword_id = $1 AND (v.is_hidden = false OR v.is_hidden IS NULL)`,
            [id]
        );
        const totalScrapedComments = parseInt(scrapedCommentsRes.rows[0].count) || 0;

        // 3. Top creators (join keyword_creators view via tiktok_videos)
        const creatorsRes = await pool.query(
            `SELECT
                c.username, c.display_name, c.avatar_url,
                c.follower_count,
                COUNT(v.id)         AS video_count,
                SUM(v.views_count)  AS total_views,
                SUM(v.likes_count)  AS total_likes,
                SUM(v.comments_count) AS total_comments,
                SUM(v.shares_count) AS total_shares
             FROM tiktok_videos v
             JOIN tiktok_creators c ON v.creator_id = c.id
             WHERE v.keyword_id = $1 AND (v.is_hidden = false OR v.is_hidden IS NULL)
             GROUP BY c.id, c.username, c.display_name, c.avatar_url, c.follower_count
             ORDER BY video_count DESC, total_views DESC
             LIMIT 10`,
            [id]
        );

        // 4. Capture status breakdown
        const statusRes = await pool.query(
            `SELECT capture_status, COUNT(*) AS count
             FROM tiktok_videos 
             WHERE keyword_id = $1 AND (is_hidden = false OR is_hidden IS NULL)
             GROUP BY capture_status`,
            [id]
        );

        // 5. Top hashtags (extracted inline from captions using regex_split)
        const hashtagRes = await pool.query(
            `SELECT tag, COUNT(*) AS count
             FROM (
                SELECT regexp_matches(caption, '#([A-Za-z0-9_]+)', 'g') AS m
                FROM tiktok_videos 
                WHERE keyword_id = $1 AND caption IS NOT NULL AND (is_hidden = false OR is_hidden IS NULL)
             ) t, LATERAL (SELECT '#' || lower(t.m[1]) AS tag) s
             GROUP BY tag
             ORDER BY count DESC
             LIMIT 15`,
            [id]
        );

        // Shape response
        const reach = reachRes.rows[0];
        const eng   = engRes.rows[0];
        const totalViews = parseInt(eng.total_views) || 1; // avoid /0
        const totalEngagement = (parseInt(eng.total_likes) || 0) + (parseInt(eng.total_comments) || 0);
        const engagementRate = ((totalEngagement / totalViews) * 100).toFixed(2);

        const captureBreakdown = {};
        for (const row of statusRes.rows) {
            captureBreakdown[row.capture_status] = parseInt(row.count);
        }

        res.json({
            success: true,
            analytics: {
                reach: {
                    selected_videos:   parseInt(reach.selected_videos) || 0,
                    total_videos:      parseInt(reach.total_videos)    || 0,
                    potential_reach:   parseInt(reach.potential_reach) || 0,
                    avg_views:         Math.round(parseFloat(reach.avg_views)) || 0
                },
                engagement: {
                    total_likes:    parseInt(eng.total_likes)    || 0,
                    total_comments: parseInt(eng.total_comments) || 0,
                    total_shares:   parseInt(eng.total_shares)   || 0,
                    total_views:    parseInt(eng.total_views)    || 0,
                    engagement_rate: parseFloat(engagementRate)
                },
                comments: {
                    scraped_count: totalScrapedComments,
                    total_in_videos: parseInt(eng.total_comments) || 0
                },
                top_creators: creatorsRes.rows.map(c => ({
                    username:      c.username,
                    display_name:  c.display_name,
                    avatar_url:    c.avatar_url,
                    follower_count: parseInt(c.follower_count) || 0,
                    video_count:   parseInt(c.video_count)    || 0,
                    total_views:   parseInt(c.total_views)    || 0,
                    total_likes:   parseInt(c.total_likes)    || 0,
                    total_comments: parseInt(c.total_comments) || 0,
                    total_shares:   parseInt(c.total_shares)   || 0
                })),
                top_hashtags: hashtagRes.rows.map(h => ({
                    tag:   h.tag,
                    count: parseInt(h.count)
                })),
                capture_breakdown: {
                    captured:         captureBreakdown['captured']         || 0,
                    comments_pending: captureBreakdown['comments_pending'] || 0,
                    comments_done:    captureBreakdown['comments_done']    || 0,
                    failed:           captureBreakdown['failed']           || 0
                }
            }
        });
    } catch (err) {
        console.error('[ANALYTICS] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/tiktok/videos/:video_id
 * Permanently delete a video from keyword dataset
 */
router.delete('/tiktok/videos/:video_id', async (req, res) => {
    try {
        const { video_id } = req.params;
        const { keyword_id } = req.query;
        if (!keyword_id) return res.status(400).json({ success: false, error: 'keyword_id is required' });

        if (!(await checkKeywordOwnership(keyword_id, req.user.id))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await pool.query(
            `DELETE FROM tiktok_videos WHERE video_id = $1 AND keyword_id = $2`,
            [video_id, keyword_id]
        );

        // Update Keyword stats after deletion
        await pool.query(
            `UPDATE search_keywords 
             SET total_videos = (SELECT COUNT(*) FROM tiktok_videos WHERE keyword_id = $1),
                 total_creators = (SELECT COUNT(DISTINCT creator_id) FROM tiktok_videos WHERE keyword_id = $1),
                 total_views = (SELECT COALESCE(SUM(views_count), 0) FROM tiktok_videos WHERE keyword_id = $1)
             WHERE id = $1`,
            [keyword_id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[TIKTOK_VIDEOS DELETE] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
