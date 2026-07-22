/**
 * Posts routes — upsert posts, metrics history, relations, and retrieval
 * Now with project-scoped data isolation via project_posts junction table.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * POST /api/posts
 * Body: { posts: [...], project_id? }
 *
 * For each post:
 *   1. Upsert owner into ig_users
 *   2. Upsert the post into posts table
 *   3. Insert a snapshot into post_metrics_history
 *   4. Upsert coauthors / sponsors / tagged users into ig_users + post_relations
 *   5. If project_id provided, link post + owner to project
 */
router.post('/posts', async (req, res) => {
    const client = await pool.connect();

    try {
        let posts = req.body.posts || [req.body];
        if (!Array.isArray(posts)) posts = [posts];
        const projectId = req.body.project_id || null;

        // Validate project ownership if project_id provided
        if (projectId) {
            const projCheck = await client.query(
                'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
                [projectId, req.user.id]
            );
            if (projCheck.rows.length === 0) {
                client.release();
                return res.status(403).json({ success: false, error: 'Project not found or access denied' });
            }
        }

        await client.query('BEGIN');

        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        const errors = [];

        for (let i = 0; i < posts.length; i++) {
            const post = posts[i];
            if (!post.shortcode) continue;

            // Per-post SAVEPOINT so one failure doesn't kill the whole batch
            const sp = `sp_post_${i}`;
            await client.query(`SAVEPOINT ${sp}`);

            try {

            // --- 1. Upsert owner ---
            const ownerUsername = post.owner?.username || post.caption_user?.username || post.username || null;
            const ownerFollowers = post.owner?.follower_count || post.owner?.edge_followed_by?.count || post.followers || 0;
            const ownerVerified = post.owner?.is_verified || false;
            const ownerId = post.owner?.pk || post.owner?.id || ownerUsername || 'unknown';

            if (ownerUsername) {
                await client.query(
                    `INSERT INTO ig_users (id, username, follower_count, is_verified, role, scraped_at)
                     VALUES ($1, $2, $3, $4, 'reference', NOW())
                     ON CONFLICT (username) DO UPDATE SET
                         follower_count = GREATEST(ig_users.follower_count, EXCLUDED.follower_count),
                         is_verified = COALESCE(EXCLUDED.is_verified, ig_users.is_verified),
                         scraped_at = NOW()`,
                    [String(ownerId), ownerUsername, ownerFollowers, ownerVerified]
                );
            }

            // --- 2. Upsert post ---
            const timestamp = post.timestamp || post.taken_at || null;
            let postedAt = null;
            if (timestamp) {
                const ms = timestamp > 10000000000 ? timestamp : timestamp * 1000;
                postedAt = new Date(ms).toISOString();
            }

            const result = await client.query(
                `INSERT INTO posts (
                    shortcode, owner_username, post_url, caption, image_url, video_url,
                    is_video, is_carousel, is_paid, classification, type,
                    collective_reach, reach_breakdown, scraped_from_profile, is_reference, posted_at, first_captured_at, last_updated_at
                 )
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW(), NOW())
                 ON CONFLICT (shortcode) DO UPDATE SET
                    caption = COALESCE(EXCLUDED.caption, posts.caption),
                    image_url = COALESCE(EXCLUDED.image_url, posts.image_url),
                    video_url = COALESCE(EXCLUDED.video_url, posts.video_url),
                    is_paid = EXCLUDED.is_paid OR posts.is_paid,
                    classification = EXCLUDED.classification,
                    type = EXCLUDED.type,
                    collective_reach = GREATEST(posts.collective_reach, EXCLUDED.collective_reach),
                    reach_breakdown = CASE
                        WHEN jsonb_array_length(COALESCE(EXCLUDED.reach_breakdown, '[]'::jsonb)) > jsonb_array_length(COALESCE(posts.reach_breakdown, '[]'::jsonb))
                        THEN EXCLUDED.reach_breakdown
                        ELSE COALESCE(posts.reach_breakdown, EXCLUDED.reach_breakdown)
                    END,
                    scraped_from_profile = COALESCE(EXCLUDED.scraped_from_profile, posts.scraped_from_profile),
                    is_reference = LEAST(posts.is_reference, EXCLUDED.is_reference),
                    last_updated_at = NOW()
                 RETURNING (xmax = 0) AS is_insert`,
                [
                    post.shortcode,
                    ownerUsername,
                    post.postUrl || null,
                    post.caption || null,
                    post.imageUrl || null,
                    post.videoUrl || null,
                    post.isVideo || false,
                    post.isCarousel || false,
                    post.isPaid || false,
                    post.classification || 'Normal Post',
                    post.type || 'normal',
                    post.collectiveReach || 0,
                    JSON.stringify(post.reachBreakdown || []),
                    post.scrapedFromProfile || null,
                    post.is_reference || false,
                    postedAt,
                ]
            );

            if (result.rows[0]?.is_insert) {
                inserted++;
            } else {
                updated++;
            }

            // --- 3. Insert metrics snapshot ---
            const likesCount = post.likes ?? post.like_count ?? 0;
            const commentsCount = post.comments ?? post.comment_count ?? 0;
            const viewCount = post.videoViewCount || post.video_view_count || 0;

            await client.query(
                `INSERT INTO post_metrics_history (post_shortcode, likes_count, comments_count, video_view_count, captured_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [post.shortcode, likesCount, commentsCount, viewCount]
            );

            // --- 4. Upsert relations ---
            const relations = [];

            if (post.coauthors && post.coauthors.length > 0) {
                for (const c of post.coauthors) {
                    const uname = c.username || c;
                    if (uname) relations.push({ username: uname, type: 'COAUTHOR', follower_count: c.follower_count || 0, is_verified: c.is_verified || false, id: c.pk || c.id || uname });
                }
            }

            if (post.sponsors && post.sponsors.length > 0) {
                for (const s of post.sponsors) {
                    const uname = s.username || s;
                    if (uname) relations.push({ username: uname, type: 'SPONSOR', follower_count: s.follower_count || 0, is_verified: s.is_verified || false, id: s.pk || s.id || uname });
                }
            }

            if (post.tagged_users && post.tagged_users.length > 0) {
                for (const t of post.tagged_users) {
                    const uname = t.username || t;
                    if (uname) relations.push({ username: uname, type: 'TAGGED', follower_count: t.follower_count || 0, is_verified: t.is_verified || false, id: t.pk || t.id || uname });
                }
            }

            if (post.caption_user && post.caption_user.username && post.caption_user.username !== ownerUsername) {
                relations.push({
                    username: post.caption_user.username,
                    type: 'CAPTION_USER',
                    follower_count: post.caption_user.follower_count || 0,
                    is_verified: post.caption_user.is_verified || false,
                    id: post.caption_user.pk || post.caption_user.id || post.caption_user.username,
                });
            }

            for (const rel of relations) {
                await client.query(
                    `INSERT INTO ig_users (id, username, follower_count, is_verified, role, scraped_at)
                     VALUES ($1, $2, $3, $4, 'reference', NOW())
                     ON CONFLICT (username) DO UPDATE SET
                         follower_count = GREATEST(ig_users.follower_count, EXCLUDED.follower_count),
                         is_verified = COALESCE(EXCLUDED.is_verified, ig_users.is_verified),
                         scraped_at = NOW()`,
                    [String(rel.id), rel.username, rel.follower_count, rel.is_verified]
                );

                await client.query(
                    `INSERT INTO post_relations (post_shortcode, username, relation_type)
                     SELECT CAST($1 as VARCHAR), CAST($2 as VARCHAR), CAST($3 as VARCHAR)
                     WHERE NOT EXISTS (
                         SELECT 1 FROM post_relations
                         WHERE post_shortcode = $1 AND username = $2 AND relation_type = $3
                     )`,
                    [post.shortcode, rel.username, rel.type]
                );
            }

            // --- 5. Link post + owner to project ---
            if (projectId) {
                await client.query(
                    `INSERT INTO project_posts (project_id, post_shortcode, added_at)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (project_id, post_shortcode) DO NOTHING`,
                    [projectId, post.shortcode]
                );

                // Also link owner profile to project
                if (ownerUsername) {
                    await client.query(
                        `INSERT INTO project_profiles (project_id, username)
                         VALUES ($1, $2)
                         ON CONFLICT (project_id, username) DO NOTHING`,
                        [projectId, ownerUsername]
                    );
                }

                // Link collaborator profiles to project
                for (const rel of relations) {
                    if (rel.type === 'COAUTHOR') {
                        await client.query(
                            `INSERT INTO project_profiles (project_id, username)
                             VALUES ($1, $2)
                             ON CONFLICT (project_id, username) DO NOTHING`,
                            [projectId, rel.username]
                        );
                    }
                }
            }

            // --- 6. Backward compat: also link to user_scraped_posts (if table exists) ---
            if (req.user && req.user.id) {
                try {
                    await client.query(
                        `INSERT INTO user_scraped_posts (user_id, post_shortcode, scraped_at)
                         VALUES ($1, $2, NOW())
                         ON CONFLICT (user_id, post_shortcode) DO UPDATE SET scraped_at = NOW()`,
                        [req.user.id, post.shortcode]
                    );
                } catch (_) {
                    // Table may not exist if already dropped — ignore
                }
            }
            } catch (postErr) {
                // Rollback just this post, continue with the rest
                await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                skipped++;
                errors.push({ shortcode: post.shortcode, error: postErr.message });
                console.warn(`[POSTS] Skipped post ${post.shortcode}: ${postErr.message}`);
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            inserted,
            updated,
            skipped,
            total: inserted + updated,
            ...(errors.length > 0 && { errors }),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[POSTS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * GET /api/posts
 * Query params: ?project_id=UUID&owner=username&type=paid&limit=50&offset=0
 *
 * If project_id is provided, returns posts scoped to that project.
 * Otherwise falls back to user_scraped_posts for backward compatibility.
 */
router.get('/posts', async (req, res) => {
    try {
        const { project_id, owner, type, classification, limit = 50, offset = 0 } = req.query;

        let query;
        const params = [];
        let paramIdx = 1;

        if (project_id) {
            // Project-scoped query
            query = `
                SELECT p.*,
                       (SELECT json_agg(json_build_object('likes', h.likes_count, 'comments', h.comments_count, 'views', h.video_view_count, 'at', h.captured_at))
                        FROM (SELECT * FROM post_metrics_history WHERE post_shortcode = p.shortcode ORDER BY captured_at DESC LIMIT 1) h
                       ) AS latest_metrics
                FROM posts p
                JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                JOIN projects proj ON ppo.project_id = proj.id
                WHERE ppo.project_id = $${paramIdx++} AND proj.user_id = $${paramIdx++}
            `;
            params.push(project_id, req.user.id);
        } else {
            // Backward compat: user-scoped via user_scraped_posts
            query = `
                SELECT p.*,
                       (SELECT json_agg(json_build_object('likes', h.likes_count, 'comments', h.comments_count, 'views', h.video_view_count, 'at', h.captured_at))
                        FROM (SELECT * FROM post_metrics_history WHERE post_shortcode = p.shortcode ORDER BY captured_at DESC LIMIT 1) h
                       ) AS latest_metrics
                FROM posts p
                JOIN user_scraped_posts up ON p.shortcode = up.post_shortcode
                WHERE up.user_id = $${paramIdx++}
            `;
            params.push(req.user.id);
        }

        if (owner) {
            query += ` AND p.owner_username = $${paramIdx++}`;
            params.push(owner);
        }
        if (type) {
            query += ` AND p.type = $${paramIdx++}`;
            params.push(type);
        }
        if (classification) {
            query += ` AND p.classification = $${paramIdx++}`;
            params.push(classification);
        }

        query += ` ORDER BY p.posted_at DESC NULLS LAST LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Get total count with same filters
        let countQuery;
        const countParams = [];
        let cIdx = 1;

        if (project_id) {
            countQuery = `SELECT COUNT(*) FROM posts p
                          JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                          JOIN projects proj ON ppo.project_id = proj.id
                          WHERE ppo.project_id = $${cIdx++} AND proj.user_id = $${cIdx++}`;
            countParams.push(project_id, req.user.id);
        } else {
            countQuery = 'SELECT COUNT(*) FROM posts p JOIN user_scraped_posts up ON p.shortcode = up.post_shortcode WHERE up.user_id = $1';
            countParams.push(req.user.id);
            cIdx = 2;
        }

        if (owner) { countQuery += ` AND p.owner_username = $${cIdx++}`; countParams.push(owner); }
        if (type) { countQuery += ` AND p.type = $${cIdx++}`; countParams.push(type); }
        if (classification) { countQuery += ` AND p.classification = $${cIdx++}`; countParams.push(classification); }

        const countResult = await pool.query(countQuery, countParams);

        res.json({
            success: true,
            posts: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (err) {
        console.error('[POSTS GET] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/posts/:shortcode/history
 * Returns the full metrics history for a specific post
 */
router.get('/posts/:shortcode/history', async (req, res) => {
    try {
        const { shortcode } = req.params;

        const result = await pool.query(
            `SELECT likes_count, comments_count, video_view_count, captured_at
             FROM post_metrics_history
             WHERE post_shortcode = $1
             ORDER BY captured_at ASC`,
            [shortcode]
        );

        res.json({
            success: true,
            shortcode,
            history: result.rows,
            snapshots: result.rows.length,
        });
    } catch (err) {
        console.error('[HISTORY] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
