/**
 * Posts routes — upsert posts, metrics history, relations, and retrieval
 * Now with project-scoped data isolation via project_posts junction table.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * Upsert a row into ig_users keyed by username.
 *
 * ig_users has TWO unique constraints: the primary key on `id` and a UNIQUE on
 * `username`. The captured `id` is unreliable for TikTok (it can be missing, a
 * placeholder, or shared across username variants like "Alice" vs "alice"), so
 * an INSERT can collide on the `id` primary key even though we only conflict-
 * handle `username`. That raises `ig_users_pkey` and, inside a transaction,
 * aborts the whole batch ("duplicate key value violates unique constraint").
 *
 * Since nothing joins on `id` (every relation keys off `username`), we wrap the
 * upsert in a SAVEPOINT: on a PK collision we roll back just this statement and
 * retry using the username as the id, which cannot collide with another row.
 */
async function upsertIgUser(client, { id, username, follower_count = 0, is_verified = false }) {
    if (!username) return;
    const sql = `INSERT INTO ig_users (id, username, follower_count, is_verified, role, scraped_at)
                 VALUES ($1, $2, $3, $4, 'reference', NOW())
                 ON CONFLICT (username) DO UPDATE SET
                     follower_count = GREATEST(ig_users.follower_count, EXCLUDED.follower_count),
                     is_verified = COALESCE(EXCLUDED.is_verified, ig_users.is_verified),
                     scraped_at = NOW()`;
    try {
        await client.query('SAVEPOINT iguser_upsert');
        await client.query(sql, [String(id || username), username, follower_count, is_verified]);
        await client.query('RELEASE SAVEPOINT iguser_upsert');
    } catch (err) {
        // Most likely an `id` (primary key) collision — recover and retry with a
        // username-derived id so the surrounding transaction keeps going.
        await client.query('ROLLBACK TO SAVEPOINT iguser_upsert');
        await client.query(sql, [`u_${username}`, username, follower_count, is_verified]);
        await client.query('RELEASE SAVEPOINT iguser_upsert');
    }
}

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
                return res.status(403).json({ success: false, error: 'Project not found or access denied' });
            }
        }

        await client.query('BEGIN');

        let inserted = 0;
        let updated = 0;

        for (const post of posts) {
            if (!post.shortcode) continue;

            // --- 1. Upsert owner ---
            const ownerUsername = post.owner?.username || post.caption_user?.username || post.username || null;
            const ownerFollowers = post.owner?.follower_count || post.owner?.edge_followed_by?.count || post.followers || 0;
            const ownerVerified = post.owner?.is_verified || false;
            const ownerId = post.owner?.pk || post.owner?.id || ownerUsername || 'unknown';

            if (ownerUsername) {
                await upsertIgUser(client, {
                    id: ownerId,
                    username: ownerUsername,
                    follower_count: ownerFollowers,
                    is_verified: ownerVerified,
                });
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
                    collective_reach, reach_breakdown, scraped_from_profile, is_reference, posted_at,
                    view_count, repost_count, share_count, bookmark_count,
                    hashtags, mentions, music_title, music_author, duet_from, stitch_from,
                    first_captured_at, last_updated_at
                 )
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26, NOW(), NOW())
                 ON CONFLICT (shortcode) DO UPDATE SET
                    caption = COALESCE(EXCLUDED.caption, posts.caption),
                    image_url = COALESCE(EXCLUDED.image_url, posts.image_url),
                    video_url = COALESCE(EXCLUDED.video_url, posts.video_url),
                    is_paid = EXCLUDED.is_paid OR posts.is_paid,
                    classification = EXCLUDED.classification,
                    type = EXCLUDED.type,
                    collective_reach = GREATEST(posts.collective_reach, EXCLUDED.collective_reach),
                    reach_breakdown = CASE
                        WHEN jsonb_array_length(EXCLUDED.reach_breakdown) > jsonb_array_length(posts.reach_breakdown)
                        THEN EXCLUDED.reach_breakdown
                        ELSE posts.reach_breakdown
                    END,
                    scraped_from_profile = COALESCE(EXCLUDED.scraped_from_profile, posts.scraped_from_profile),
                    is_reference = LEAST(posts.is_reference, EXCLUDED.is_reference),
                    view_count     = GREATEST(posts.view_count,     EXCLUDED.view_count),
                    repost_count   = GREATEST(posts.repost_count,   EXCLUDED.repost_count),
                    share_count    = GREATEST(posts.share_count,    EXCLUDED.share_count),
                    bookmark_count = GREATEST(posts.bookmark_count, EXCLUDED.bookmark_count),
                    hashtags   = CASE WHEN jsonb_array_length(EXCLUDED.hashtags)  > jsonb_array_length(posts.hashtags)  THEN EXCLUDED.hashtags  ELSE posts.hashtags  END,
                    mentions   = CASE WHEN jsonb_array_length(EXCLUDED.mentions)  > jsonb_array_length(posts.mentions)  THEN EXCLUDED.mentions  ELSE posts.mentions  END,
                    music_title  = COALESCE(EXCLUDED.music_title,  posts.music_title),
                    music_author = COALESCE(EXCLUDED.music_author, posts.music_author),
                    duet_from    = COALESCE(EXCLUDED.duet_from,    posts.duet_from),
                    stitch_from  = COALESCE(EXCLUDED.stitch_from,  posts.stitch_from),
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
                    // TikTok engagement
                    post.views ?? post.videoViewCount ?? post.video_view_count ?? 0,
                    post.reposts ?? post.repost_count ?? 0,
                    post.shares ?? post.share_count ?? 0,
                    post.bookmarks ?? post.bookmark_count ?? 0,
                    JSON.stringify(post.hashtags || []),
                    JSON.stringify(post.mentions || []),
                    post.musicTitle || post.music_title || null,
                    post.musicAuthor || post.music_author || null,
                    post.duetFrom || post.duet_from || null,
                    post.stitchFrom || post.stitch_from || null,
                ]
            );

            if (result.rows[0]?.is_insert) {
                inserted++;
            } else {
                updated++;
            }

            // --- 3. Insert metrics snapshot (TikTok engagement) ---
            const likesCount    = post.likes    ?? post.like_count    ?? 0;
            const commentsCount = post.comments ?? post.comment_count ?? 0;
            const viewCount     = post.views    ?? post.videoViewCount ?? post.video_view_count ?? 0;
            const repostCount   = post.reposts  ?? post.repost_count  ?? 0;
            const shareCount    = post.shares   ?? post.share_count   ?? 0;
            const bookmarkCount = post.bookmarks ?? post.bookmark_count ?? 0;

            await client.query(
                `INSERT INTO post_metrics_history
                 (post_shortcode, likes_count, comments_count, video_view_count, view_count, repost_count, share_count, bookmark_count, captured_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                [post.shortcode, likesCount, commentsCount, viewCount, viewCount, repostCount, shareCount, bookmarkCount]
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
                await upsertIgUser(client, {
                    id: rel.id,
                    username: rel.username,
                    follower_count: rel.follower_count,
                    is_verified: rel.is_verified,
                });

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
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            inserted,
            updated,
            total: inserted + updated,
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
                       (SELECT json_agg(json_build_object('likes', h.likes_count, 'comments', h.comments_count, 'views', h.video_view_count, 'reposts', h.repost_count, 'shares', h.share_count, 'bookmarks', h.bookmark_count, 'at', h.captured_at))
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
                       (SELECT json_agg(json_build_object('likes', h.likes_count, 'comments', h.comments_count, 'views', h.video_view_count, 'reposts', h.repost_count, 'shares', h.share_count, 'bookmarks', h.bookmark_count, 'at', h.captured_at))
                        FROM (SELECT * FROM post_metrics_history WHERE post_shortcode = p.shortcode ORDER BY captured_at DESC LIMIT 1) h
                       ) AS latest_metrics
                FROM posts p
                JOIN user_scraped_posts up ON p.shortcode = up.post_shortcode
                WHERE up.user_id = $${paramIdx++}
            `;
            params.push(req.user.id);
        }

        // Exclude hidden posts from standard listings (commentator/profiles)
        query += ` AND (p.is_hidden = false OR p.is_hidden IS NULL)`;

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

        countQuery += ` AND (p.is_hidden = false OR p.is_hidden IS NULL)`;

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
 * GET /api/posts/hidden?project_id=...
 * List hidden commentator/profile posts for the project (or user, backward compat).
 * Defined before the :shortcode routes so "hidden" isn't captured as a shortcode.
 */
router.get('/posts/hidden', async (req, res) => {
    try {
        const { project_id } = req.query;
        let query, params;
        if (project_id) {
            query = `SELECT p.* FROM posts p
                     JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                     JOIN projects proj ON ppo.project_id = proj.id
                     WHERE ppo.project_id = $1 AND proj.user_id = $2 AND p.is_hidden = true
                     ORDER BY p.hidden_at DESC NULLS LAST, p.posted_at DESC NULLS LAST`;
            params = [project_id, req.user.id];
        } else {
            query = `SELECT p.* FROM posts p
                     JOIN user_scraped_posts up ON p.shortcode = up.post_shortcode
                     WHERE up.user_id = $1 AND p.is_hidden = true
                     ORDER BY p.hidden_at DESC NULLS LAST, p.posted_at DESC NULLS LAST`;
            params = [req.user.id];
        }
        const result = await pool.query(query, params);
        res.json({ success: true, posts: result.rows });
    } catch (err) {
        console.error('[POSTS HIDDEN GET] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PATCH /api/posts/:shortcode/hide
 * Body: { is_hidden?: boolean }  (defaults to true)
 * Hide/unhide a post from commentator/profile listings & calculations.
 */
router.patch('/posts/:shortcode/hide', async (req, res) => {
    try {
        const { shortcode } = req.params;
        const is_hidden = req.body?.is_hidden !== false; // default true

        // Verify the user owns this post via project or legacy user-scrape link
        const own = await pool.query(
            `SELECT 1 FROM posts p
             LEFT JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
             LEFT JOIN projects proj ON ppo.project_id = proj.id
             LEFT JOIN user_scraped_posts up ON p.shortcode = up.post_shortcode
             WHERE p.shortcode = $1 AND (proj.user_id = $2 OR up.user_id = $2)
             LIMIT 1`,
            [shortcode, req.user.id]
        );
        if (own.rows.length === 0) return res.status(404).json({ success: false, error: 'Post not found' });

        await pool.query(
            `UPDATE posts
             SET is_hidden = $2,
                 hidden_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE NULL END
             WHERE shortcode = $1`,
            [shortcode, is_hidden]
        );
        res.json({ success: true, shortcode, is_hidden });
    } catch (err) {
        console.error('[POSTS HIDE] Error:', err.message);
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
