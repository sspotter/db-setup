/**
 * Projects routes — CRUD + statistics + profile management for project-based data isolation
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

// ======================== Helper: Ownership Check ========================

async function checkProjectOwnership(projectId, userId) {
    const result = await pool.query(
        'SELECT id, name FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, userId]
    );
    return result.rows[0] || null;
}

// ======================== Helper: Keyword Summary ========================

async function getProjectKeywordSummary(projectId) {
    const result = await pool.query(
        `SELECT
            COUNT(*)                                    AS total_keywords,
            COALESCE(SUM(total_videos), 0)              AS total_videos,
            COALESCE(SUM(total_creators), 0)            AS total_creators,
            COALESCE(SUM(total_views), 0)               AS total_views,
            COALESCE(SUM(total_engagement), 0)          AS total_engagement,
            COUNT(*) FILTER (WHERE status = 'active')   AS active_keywords,
            (
                SELECT COALESCE(SUM(views_count), 0)
                FROM tiktok_videos
                WHERE project_id = $1 AND included_in_reach = true
            ) AS potential_reach
         FROM search_keywords
         WHERE project_id = $1`,
        [projectId]
    );

    const row = result.rows[0];
    return {
        total_keywords:   parseInt(row.total_keywords)   || 0,
        active_keywords:  parseInt(row.active_keywords)  || 0,
        total_videos:     parseInt(row.total_videos)     || 0,
        total_creators:   parseInt(row.total_creators)   || 0,
        total_views:      parseInt(row.total_views)      || 0,
        total_engagement: parseInt(row.total_engagement) || 0,
        potential_reach:  parseInt(row.potential_reach)  || 0,
    };
}

// ======================== Helper: Reach Stats Calculation ========================

async function getProjectReachAndStats(projectId) {
    // Basic stats counts
    const basicStatsResult = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM project_profiles WHERE project_id = $1) AS profile_count,
            (SELECT COUNT(*) FROM project_posts WHERE project_id = $1) AS post_count,
            (SELECT COUNT(c.*)
             FROM comments c
             JOIN project_posts ppo ON c.post_shortcode = ppo.post_shortcode
             WHERE ppo.project_id = $1
            ) AS comment_count,
            (SELECT COUNT(DISTINCT sub.shortcode)
             FROM posts sub
             JOIN project_posts ppo ON sub.shortcode = ppo.post_shortcode
             WHERE ppo.project_id = $1
               AND (sub.is_paid = TRUE
                    OR EXISTS (SELECT 1 FROM post_relations pr WHERE pr.post_shortcode = sub.shortcode AND pr.relation_type = 'COAUTHOR'))
            ) AS collab_post_count`,
        [projectId]
    );

    // Partners reach calculation
    const partnersResult = await pool.query(
        `WITH project_posts_cte AS (
            SELECT p.shortcode, p.owner_username
            FROM posts p
            JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
            WHERE ppo.project_id = $1
        ),
        all_partners AS (
            SELECT owner_username AS username, shortcode AS post_shortcode
            FROM project_posts_cte
            UNION
            SELECT pr.username, pr.post_shortcode
            FROM post_relations pr
            JOIN project_posts_cte ppc ON pr.post_shortcode = ppc.shortcode
            WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
        ),
        partner_stats AS (
            SELECT 
                ap.username,
                COUNT(DISTINCT ap.post_shortcode) AS posts_involved
            FROM all_partners ap
            GROUP BY ap.username
        ),
        partner_details AS (
            SELECT 
                ps.username,
                ps.posts_involved,
                COALESCE(MAX(iu.follower_count), 0) AS follower_count,
                COALESCE(MAX(iu.follower_count), 0) * ps.posts_involved AS potential_impressions,
                COALESCE(pp.role, 'collaborator') AS role
            FROM partner_stats ps
            LEFT JOIN ig_users iu ON ps.username = iu.username
            LEFT JOIN project_profiles pp ON ps.username = pp.username AND pp.project_id = $1
            GROUP BY ps.username, ps.posts_involved, pp.role
        )
        SELECT * FROM partner_details ORDER BY potential_impressions DESC`,
        [projectId]
    );

    const partners = partnersResult.rows.map(r => ({
        username: r.username,
        follower_count: parseInt(r.follower_count),
        posts_involved: parseInt(r.posts_involved),
        potential_impressions: parseInt(r.potential_impressions),
        role: r.role
    }));

    const totalReach = partners.reduce((sum, p) => sum + p.potential_impressions, 0);

    const reachByRoleMap = {};
    for (const p of partners) {
        if (!reachByRoleMap[p.role]) {
            reachByRoleMap[p.role] = { count: 0, reach: 0 };
        }
        reachByRoleMap[p.role].count += 1;
        reachByRoleMap[p.role].reach += p.potential_impressions;
    }

    const reachByRole = Object.keys(reachByRoleMap).map(role => ({
        role,
        count: reachByRoleMap[role].count,
        reach: reachByRoleMap[role].reach
    })).sort((a, b) => b.reach - a.reach);

    const stats = basicStatsResult.rows[0];

    return {
        profiles: parseInt(stats.profile_count),
        posts: parseInt(stats.post_count),
        comments: parseInt(stats.comment_count),
        collabPosts: parseInt(stats.collab_post_count),
        reach: totalReach,
        partners: partners,
        reachByRole: reachByRole,
    };
}

// ======================== Project CRUD ========================

/**
 * POST /api/projects
 * Body: { name, description? }
 */
router.post('/projects', async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Project name is required' });
        }

        const result = await pool.query(
            `INSERT INTO projects (user_id, name, description)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [req.user.id, name.trim(), description || null]
        );

        res.status(201).json({ success: true, project: result.rows[0] });
    } catch (err) {
        console.error('[PROJECTS CREATE] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/projects
 * Returns all projects for the logged-in user with basic stats.
 */
router.get('/projects', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*,
                    (SELECT COUNT(*) FROM project_profiles pp WHERE pp.project_id = p.id) AS profile_count,
                    (SELECT COUNT(*) FROM project_posts ppo WHERE ppo.project_id = p.id) AS post_count,
                    (SELECT COUNT(DISTINCT sub.shortcode)
                     FROM posts sub
                     JOIN project_posts ppo2 ON sub.shortcode = ppo2.post_shortcode
                     WHERE ppo2.project_id = p.id
                       AND (sub.is_paid = TRUE
                            OR EXISTS (SELECT 1 FROM post_relations pr WHERE pr.post_shortcode = sub.shortcode AND pr.relation_type = 'COAUTHOR'))
                    ) AS collab_post_count
             FROM projects p
             WHERE p.user_id = $1
             ORDER BY p.created_at DESC`,
            [req.user.id]
        );

        res.json({ success: true, projects: result.rows });
    } catch (err) {
        console.error('[PROJECTS LIST] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/projects/:id
 * Returns project details with full statistics.
 */
router.get('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        // Get full project row
        const projectResult = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);

        // Get stats (run in parallel)
        const [stats, keywordSummary] = await Promise.all([
            getProjectReachAndStats(id),
            getProjectKeywordSummary(id),
        ]);

        res.json({
            success: true,
            project: {
                ...projectResult.rows[0],
                stats,
                keyword_summary: keywordSummary,
            }
        });
    } catch (err) {
        console.error('[PROJECTS GET] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/projects/:id
 * Body: { name?, description? }
 */
router.put('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIdx++}`);
            values.push(name.trim());
        }
        if (description !== undefined) {
            updates.push(`description = $${paramIdx++}`);
            values.push(description);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        // Always update updated_at
        updates.push(`updated_at = NOW()`);

        values.push(id, req.user.id);
        const result = await pool.query(
            `UPDATE projects SET ${updates.join(', ')}
             WHERE id = $${paramIdx++} AND user_id = $${paramIdx}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        res.json({ success: true, project: result.rows[0] });
    } catch (err) {
        console.error('[PROJECTS UPDATE] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/projects/:id
 * Deletes a project (junction rows cascade, global data remains).
 */
router.delete('/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id, name',
            [id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        res.json({ success: true, message: `Project "${result.rows[0].name}" deleted`, id: result.rows[0].id });
    } catch (err) {
        console.error('[PROJECTS DELETE] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ======================== Profile Management ========================

/**
 * GET /api/projects/:id/profiles
 * Returns all profiles linked to a project with their ig_users data.
 */
router.get('/projects/:id/profiles', async (req, res) => {
    try {
        const { id } = req.params;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const result = await pool.query(
            `SELECT iu.*, pp.role AS project_role, pp.pinned, pp.added_at AS added_to_project,
                    (SELECT COUNT(*) FROM project_posts ppo
                     JOIN posts p ON ppo.post_shortcode = p.shortcode
                     WHERE ppo.project_id = $1 AND p.owner_username = iu.username
                    ) AS post_count
             FROM project_profiles pp
             JOIN ig_users iu ON pp.username = iu.username
             WHERE pp.project_id = $1
             ORDER BY pp.pinned DESC, iu.follower_count DESC`,
            [id]
        );

        res.json({ success: true, profiles: result.rows });
    } catch (err) {
        console.error('[PROJECT PROFILES] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/projects/:id/profiles/:username
 * Body: { role: 'brand' | 'competitor' | 'creator' | 'influencer' | 'tracked' }
 * Updates the role of a profile within a project.
 */
router.put('/projects/:id/profiles/:username', async (req, res) => {
    try {
        const { id, username } = req.params;
        const { role } = req.body;

        const validRoles = ['brand', 'competitor', 'creator', 'influencer', 'tracked'];
        if (!role || !validRoles.includes(role)) {
            return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const result = await pool.query(
            `UPDATE project_profiles SET role = $1
             WHERE project_id = $2 AND username = $3
             RETURNING *`,
            [role, id, username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Profile not found in project' });
        }

        // Also update projects.updated_at
        await pool.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);

        res.json({ success: true, profile: result.rows[0] });
    } catch (err) {
        console.error('[PROJECT PROFILE ROLE] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PATCH /api/projects/:id/profiles/:username/pin
 * Toggles pinned status of a profile within a project.
 */
router.patch('/projects/:id/profiles/:username/pin', async (req, res) => {
    try {
        const { id, username } = req.params;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const result = await pool.query(
            `UPDATE project_profiles SET pinned = NOT pinned
             WHERE project_id = $1 AND username = $2
             RETURNING *`,
            [id, username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Profile not found in project' });
        }

        res.json({ success: true, profile: result.rows[0], pinned: result.rows[0].pinned });
    } catch (err) {
        console.error('[PROJECT PROFILE PIN] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/projects/:id/profiles/:username
 * Removes a profile from a project (keeps global ig_users data).
 */
router.delete('/projects/:id/profiles/:username', async (req, res) => {
    try {
        const { id, username } = req.params;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const result = await pool.query(
            `DELETE FROM project_profiles WHERE project_id = $1 AND username = $2 RETURNING username`,
            [id, username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Profile not found in project' });
        }

        res.json({ success: true, message: `Profile @${username} removed from project` });
    } catch (err) {
        console.error('[PROJECT PROFILE REMOVE] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ======================== Project Posts ========================

/**
 * GET /api/projects/:id/posts
 * Returns posts scoped to a project with pagination.
 * Query params: ?owner=username&limit=24&offset=0
 */
router.get('/projects/:id/posts', async (req, res) => {
    try {
        const { id } = req.params;
        const { owner, limit = 24, offset = 0 } = req.query;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        let query = `
            SELECT p.*,
                   (SELECT json_agg(json_build_object('likes', h.likes_count, 'comments', h.comments_count, 'views', h.video_view_count, 'reposts', h.repost_count, 'shares', h.share_count, 'bookmarks', h.bookmark_count, 'at', h.captured_at))
                    FROM (SELECT * FROM post_metrics_history WHERE post_shortcode = p.shortcode ORDER BY captured_at DESC LIMIT 1) h
                   ) AS latest_metrics
            FROM posts p
            JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
            WHERE ppo.project_id = $1
        `;
        const params = [id];
        let paramIdx = 2;

        if (owner) {
            query += ` AND p.owner_username = $${paramIdx++}`;
            params.push(owner);
        }

        // Count query
        let countQuery = `SELECT COUNT(*) FROM posts p JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode WHERE ppo.project_id = $1`;
        const countParams = [id];
        let cIdx = 2;
        if (owner) {
            countQuery += ` AND p.owner_username = $${cIdx++}`;
            countParams.push(owner);
        }

        query += ` ORDER BY p.posted_at DESC NULLS LAST LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(parseInt(limit), parseInt(offset));

        const [postsResult, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, countParams)
        ]);

        // Fetch relations (coauthors, sponsors, tagged users) for all returned posts
        const shortcodes = postsResult.rows.map(p => p.shortcode);
        let relationsMap = {};
        if (shortcodes.length > 0) {
            const relResult = await pool.query(
                `SELECT pr.post_shortcode, pr.username, pr.relation_type,
                        COALESCE(iu.follower_count, 0) AS follower_count,
                        COALESCE(iu.is_verified, false) AS is_verified,
                        NULL AS full_name, iu.business_category AS category_name, iu.id AS user_id
                 FROM post_relations pr
                 LEFT JOIN ig_users iu ON pr.username = iu.username
                 WHERE pr.post_shortcode = ANY($1)`,
                [shortcodes]
            );
            for (const rel of relResult.rows) {
                if (!relationsMap[rel.post_shortcode]) {
                    relationsMap[rel.post_shortcode] = [];
                }
                relationsMap[rel.post_shortcode].push(rel);
            }
        }

        // Enrich posts with relation data
        const enrichedPosts = postsResult.rows.map(post => {
            const rels = relationsMap[post.shortcode] || [];
            const coauthors = rels
                .filter(r => r.relation_type === 'COAUTHOR')
                .map(r => ({ username: r.username, follower_count: parseInt(r.follower_count) || 0, is_verified: r.is_verified, full_name: r.full_name, pk: r.user_id }));
            const sponsors = rels
                .filter(r => r.relation_type === 'SPONSOR')
                .map(r => ({ username: r.username, follower_count: parseInt(r.follower_count) || 0, is_verified: r.is_verified }));
            const tagged_users = rels
                .filter(r => r.relation_type === 'TAGGED')
                .map(r => ({ username: r.username, follower_count: parseInt(r.follower_count) || 0, is_verified: r.is_verified }));
            const caption_user_rel = rels.find(r => r.relation_type === 'CAPTION_USER');
            const caption_user = caption_user_rel
                ? { username: caption_user_rel.username, follower_count: parseInt(caption_user_rel.follower_count) || 0, is_verified: caption_user_rel.is_verified }
                : null;

            return {
                ...post,
                coauthors,
                sponsors,
                tagged_users,
                caption_user,
            };
        });

        res.json({
            success: true,
            posts: enrichedPosts,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (err) {
        console.error('[PROJECT POSTS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ======================== Project Stats ========================

/**
 * GET /api/projects/:id/stats
 * Returns detailed stats with reach breakdown by role.
 */
router.get('/projects/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        // Aggregate base stats and reach breakdown by role
        const stats = await getProjectReachAndStats(id);

        // Collaboration count (posts with coauthors)
        const collabResult = await pool.query(
            `SELECT COUNT(DISTINCT pr.post_shortcode) AS collab_count
             FROM post_relations pr
             JOIN project_posts ppo ON pr.post_shortcode = ppo.post_shortcode
             WHERE ppo.project_id = $1 AND pr.relation_type = 'COAUTHOR'`,
            [id]
        );

        // Paid partnership count
        const paidResult = await pool.query(
            `SELECT COUNT(*) AS paid_count
             FROM posts p
             JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
             WHERE ppo.project_id = $1 AND p.is_paid = TRUE`,
            [id]
        );

        res.json({
            success: true,
            stats: {
                ...stats,
                collaborations: parseInt(collabResult.rows[0].collab_count),
                paidPartnerships: parseInt(paidResult.rows[0].paid_count),
            }
        });
    } catch (err) {
        console.error('[PROJECT STATS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ======================== Competitive Analysis Endpoints ========================

/**
 * GET /api/projects/:id/compare
 * Query: ?brand=username&competitors=user1,user2,user3
 * Returns aggregated metrics for brand vs competitors.
 */
router.get('/projects/:id/compare', async (req, res) => {
    try {
        const { id } = req.params;
        const { brand, competitors, start_date, end_date } = req.query;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        if (!brand) {
            return res.status(400).json({ success: false, error: 'brand parameter required' });
        }

        const competitorList = competitors ? competitors.split(',').map(c => c.trim()).filter(Boolean) : [];
        const allUsernames = [brand, ...competitorList];

        // Build date range filter
        let dateFilter = '';
        const metricsParams = [id, allUsernames];
        let paramIdx = 3;
        if (start_date) {
            dateFilter += ` AND p.posted_at >= $${paramIdx++}`;
            metricsParams.push(start_date);
        }
        if (end_date) {
            dateFilter += ` AND p.posted_at < $${paramIdx++}::date + interval '1 day'`;
            metricsParams.push(end_date);
        }

        // Get per-profile metrics
        const metricsResult = await pool.query(
            `WITH all_appearances AS (
                SELECT shortcode, owner_username AS username
                FROM posts
                UNION
                SELECT pr.post_shortcode AS shortcode, pr.username
                FROM post_relations pr
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
            ),
            profile_posts AS (
                SELECT
                    p.shortcode,
                    a.username AS target_username,
                    COALESCE((SELECT h.likes_count FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode ORDER BY h.captured_at DESC LIMIT 1), 0) AS likes,
                    COALESCE((SELECT h.comments_count FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode ORDER BY h.captured_at DESC LIMIT 1), 0) AS comments,
                    p.posted_at
                FROM posts p
                JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                JOIN all_appearances a ON p.shortcode = a.shortcode
                WHERE ppo.project_id = $1
                  AND a.username = ANY($2)
                  ${dateFilter}
            )
            SELECT
                pp.target_username AS username,
                COUNT(DISTINCT pp.shortcode) AS post_count,
                COALESCE(SUM(pp.likes), 0) AS total_likes,
                COALESCE(SUM(pp.comments), 0) AS total_comments,
                COALESCE(SUM(pp.likes) + SUM(pp.comments), 0) AS total_engagement,
                CASE WHEN COUNT(DISTINCT pp.shortcode) > 0 THEN ROUND((SUM(pp.likes) + SUM(pp.comments))::numeric / COUNT(DISTINCT pp.shortcode), 1) ELSE 0 END AS avg_engagement
            FROM profile_posts pp
            GROUP BY pp.target_username`,
            metricsParams
        );

        // Get follower counts
        const followersResult = await pool.query(
            `SELECT username, follower_count FROM ig_users WHERE username = ANY($1)`,
            [allUsernames]
        );
        const followersMap = {};
        followersResult.rows.forEach(r => { followersMap[r.username] = parseInt(r.follower_count) || 0; });

        // Build reach date filter (reuses same date params)
        let reachDateFilter = '';
        const reachParams = [id, allUsernames];
        let reachParamIdx = 3;
        if (start_date) {
            reachDateFilter += ` AND p.posted_at >= $${reachParamIdx++}`;
            reachParams.push(start_date);
        }
        if (end_date) {
            reachDateFilter += ` AND p.posted_at < $${reachParamIdx++}::date + interval '1 day'`;
            reachParams.push(end_date);
        }

        // Get reach per profile using the canonical formula
        const reachResult = await pool.query(
            `WITH project_posts_cte AS (
                SELECT p.shortcode, p.owner_username
                FROM posts p
                JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                WHERE ppo.project_id = $1
                  ${reachDateFilter}
            ),
            all_appearances AS (
                SELECT owner_username AS username, shortcode
                FROM project_posts_cte
                UNION
                SELECT pr.username, pr.post_shortcode
                FROM post_relations pr
                JOIN project_posts_cte ppc ON pr.post_shortcode = ppc.shortcode
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
            ),
            appearance_counts AS (
                SELECT username, COUNT(DISTINCT shortcode) AS posts_involved
                FROM all_appearances
                WHERE username = ANY($2)
                GROUP BY username
            )
            SELECT
                ac.username,
                ac.posts_involved,
                COALESCE(iu.follower_count, 0) AS follower_count,
                COALESCE(iu.follower_count, 0) * ac.posts_involved AS potential_reach
            FROM appearance_counts ac
            LEFT JOIN ig_users iu ON ac.username = iu.username`,
            reachParams
        );
        const reachMap = {};
        reachResult.rows.forEach(r => { reachMap[r.username] = parseInt(r.potential_reach) || 0; });

        // Build response
        const profiles = allUsernames.map(username => {
            const m = metricsResult.rows.find(r => r.username === username) || {};
            return {
                username,
                role: username === brand ? 'brand' : 'competitor',
                followers: followersMap[username] || 0,
                post_count: parseInt(m.post_count) || 0,
                total_likes: parseInt(m.total_likes) || 0,
                total_comments: parseInt(m.total_comments) || 0,
                total_engagement: parseInt(m.total_engagement) || 0,
                avg_engagement: parseFloat(m.avg_engagement) || 0,
                potential_reach: reachMap[username] || 0,
            };
        });

        res.json({ success: true, brand, competitors: competitorList, profiles });
    } catch (err) {
        console.error('[PROJECT COMPARE] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/projects/:id/timeseries
 * Query: ?brand=username&competitors=user1,user2&interval=week
 * Returns engagement data grouped by time period and profile.
 */
router.get('/projects/:id/timeseries', async (req, res) => {
    try {
        const { id } = req.params;
        const { brand, competitors, interval = 'week', start_date, end_date } = req.query;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const competitorList = competitors ? competitors.split(',').map(c => c.trim()).filter(Boolean) : [];
        const allUsernames = [brand, ...competitorList].filter(Boolean);

        const truncInterval = interval === 'day' ? 'day' : 'week';

        // Build date range filter
        let tsDateFilter = '';
        const tsParams = [id, allUsernames, truncInterval];
        let tsIdx = 4;
        if (start_date) {
            tsDateFilter += ` AND p.posted_at >= $${tsIdx++}`;
            tsParams.push(start_date);
        }
        if (end_date) {
            tsDateFilter += ` AND p.posted_at < $${tsIdx++}::date + interval '1 day'`;
            tsParams.push(end_date);
        }

        const result = await pool.query(
            `WITH all_appearances AS (
                SELECT shortcode, owner_username AS username
                FROM posts
                UNION
                SELECT pr.post_shortcode AS shortcode, pr.username
                FROM post_relations pr
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
            )
            SELECT
                date_trunc($3, p.posted_at) AS period,
                a.username AS username,
                COUNT(DISTINCT p.shortcode) AS post_count,
                COALESCE(SUM((SELECT h.likes_count FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode ORDER BY h.captured_at DESC LIMIT 1)), 0) AS total_likes,
                COALESCE(SUM((SELECT h.comments_count FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode ORDER BY h.captured_at DESC LIMIT 1)), 0) AS total_comments
            FROM posts p
            JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
            JOIN all_appearances a ON p.shortcode = a.shortcode
            WHERE ppo.project_id = $1
              AND a.username = ANY($2)
              AND p.posted_at IS NOT NULL
              ${tsDateFilter}
            GROUP BY period, a.username
            ORDER BY period ASC`,
            tsParams
        );

        // Follower counts for reach calculation
        const followersLookup = await pool.query(
            `SELECT username, COALESCE(follower_count, 0) AS follower_count FROM ig_users WHERE username = ANY($1)`,
            [allUsernames]
        );
        const followersMap = {};
        followersLookup.rows.forEach(r => { followersMap[r.username] = parseInt(r.follower_count) || 0; });

        // Group by period
        const periodsMap = {};
        for (const row of result.rows) {
            const periodKey = row.period ? new Date(row.period).toISOString().split('T')[0] : 'unknown';
            if (!periodsMap[periodKey]) periodsMap[periodKey] = { period: periodKey, profiles: {} };
            const postCount = parseInt(row.post_count);
            const likes = parseInt(row.total_likes);
            const comments = parseInt(row.total_comments);
            const followers = followersMap[row.username] || 0;
            const periodReach = followers * postCount;
            periodsMap[periodKey].profiles[row.username] = {
                posts: postCount,
                likes,
                comments,
                engagement: likes + comments,
                reach: periodReach,
                impressions: periodReach,
            };
        }

        const timeseries = Object.values(periodsMap).sort((a, b) => a.period.localeCompare(b.period));

        res.json({ success: true, interval: truncInterval, usernames: allUsernames, timeseries });
    } catch (err) {
        console.error('[PROJECT TIMESERIES] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/projects/:id/top-posts
 * Query: ?usernames=user1,user2&limit=3&sort_by=engagement
 * Returns top performing posts per profile.
 */
router.get('/projects/:id/top-posts', async (req, res) => {
    try {
        const { id } = req.params;
        const { usernames, limit = 3, sort_by = 'engagement', start_date, end_date } = req.query;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const usernameList = usernames ? usernames.split(',').map(c => c.trim()).filter(Boolean) : [];

        let orderClause = '(COALESCE(h.likes_count, 0) + COALESCE(h.comments_count, 0)) DESC';
        if (sort_by === 'likes') orderClause = 'COALESCE(h.likes_count, 0) DESC';
        else if (sort_by === 'comments') orderClause = 'COALESCE(h.comments_count, 0) DESC';

        // Build date range filter
        let tpDateFilter = '';
        const tpParams = [id, usernameList];
        let tpIdx = 3;
        if (start_date) {
            tpDateFilter += ` AND p.posted_at >= $${tpIdx++}`;
            tpParams.push(start_date);
        }
        if (end_date) {
            tpDateFilter += ` AND p.posted_at < $${tpIdx++}::date + interval '1 day'`;
            tpParams.push(end_date);
        }

        const result = await pool.query(
            `WITH all_appearances AS (
                SELECT shortcode, owner_username AS username
                FROM posts
                UNION
                SELECT pr.post_shortcode AS shortcode, pr.username
                FROM post_relations pr
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
            )
            SELECT DISTINCT ON (a.username, p.shortcode)
                p.shortcode, a.username AS owner_username, p.caption, p.image_url, p.posted_at,
                p.is_video, p.is_carousel, p.classification,
                COALESCE(h.likes_count, 0) AS likes,
                COALESCE(h.comments_count, 0) AS comments,
                COALESCE(h.likes_count, 0) + COALESCE(h.comments_count, 0) AS engagement
            FROM posts p
            JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
            JOIN all_appearances a ON p.shortcode = a.shortcode
            LEFT JOIN LATERAL (
                SELECT likes_count, comments_count
                FROM post_metrics_history
                WHERE post_shortcode = p.shortcode
                ORDER BY captured_at DESC LIMIT 1
            ) h ON true
            WHERE ppo.project_id = $1
              AND a.username = ANY($2)
              ${tpDateFilter}
            ORDER BY a.username, p.shortcode, engagement DESC`,
            tpParams
        );

        // Group by username and take top N
        const grouped = {};
        for (const row of result.rows) {
            if (!grouped[row.owner_username]) grouped[row.owner_username] = [];
            grouped[row.owner_username].push({
                shortcode: row.shortcode,
                owner: row.owner_username,
                caption: row.caption,
                image_url: row.image_url,
                posted_at: row.posted_at,
                is_video: row.is_video,
                is_carousel: row.is_carousel,
                classification: row.classification,
                likes: parseInt(row.likes),
                comments: parseInt(row.comments),
                engagement: parseInt(row.engagement),
            });
        }

        // Sort each group and limit
        const topPosts = {};
        for (const [username, posts] of Object.entries(grouped)) {
            posts.sort((a, b) => b.engagement - a.engagement);
            topPosts[username] = posts.slice(0, parseInt(limit));
        }

        res.json({ success: true, topPosts });
    } catch (err) {
        console.error('[PROJECT TOP POSTS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/projects/:id/collaborations
 * Returns collaboration insights per profile within the project.
 */
router.get('/projects/:id/collaborations', async (req, res) => {
    try {
        const { id } = req.params;
        const { start_date, end_date } = req.query;

        const project = await checkProjectOwnership(id, req.user.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        // Build date range filter
        let collabDateFilter = '';
        const collabParams = [id];
        let collabIdx = 2;
        if (start_date) {
            collabDateFilter += ` AND p.posted_at >= $${collabIdx++}`;
            collabParams.push(start_date);
        }
        if (end_date) {
            collabDateFilter += ` AND p.posted_at < $${collabIdx++}::date + interval '1 day'`;
            collabParams.push(end_date);
        }

        // Bidirectional collaboration query:
        // Direction 1: Profile owns the post, collaborator is a COAUTHOR/CAPTION_USER on it
        // Direction 2: Profile is a COAUTHOR/CAPTION_USER on someone else's post
        const result = await pool.query(
            `WITH project_post_set AS (
                SELECT p.shortcode, p.owner_username
                FROM posts p
                JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                WHERE ppo.project_id = $1
                  ${collabDateFilter}
            ),
            all_appearances AS (
                SELECT owner_username AS username, shortcode FROM project_post_set
                UNION
                SELECT pr.username, pr.post_shortcode AS shortcode
                FROM post_relations pr
                JOIN project_post_set pps ON pr.post_shortcode = pps.shortcode
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
            ),
            all_collabs AS (
                SELECT 
                    a1.username AS profile_username, 
                    a2.username AS collaborator_username, 
                    a1.shortcode
                FROM all_appearances a1
                JOIN all_appearances a2 ON a1.shortcode = a2.shortcode AND a1.username != a2.username
            ),
            aggregated AS (
                SELECT
                    ac.profile_username,
                    ac.collaborator_username,
                    COUNT(DISTINCT ac.shortcode) AS collab_count,
                    COALESCE(iu.follower_count, 0) AS collaborator_followers
                FROM all_collabs ac
                LEFT JOIN ig_users iu ON ac.collaborator_username = iu.username
                GROUP BY ac.profile_username, ac.collaborator_username, iu.follower_count
            )
            SELECT * FROM aggregated
            ORDER BY profile_username, collab_count DESC`,
            collabParams
        );

        // Group by profile
        const collaborations = {};
        for (const row of result.rows) {
            if (!collaborations[row.profile_username]) collaborations[row.profile_username] = [];
            collaborations[row.profile_username].push({
                collaborator: row.collaborator_username,
                type: 'COAUTHOR',
                post_count: parseInt(row.collab_count),
                followers: parseInt(row.collaborator_followers),
            });
        }

        res.json({ success: true, collaborations });
    } catch (err) {
        console.error('[PROJECT COLLABS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
