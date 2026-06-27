/**
 * Users routes — upsert TikTok creator profiles (with optional project linking)
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * POST /api/users
 * Body: { users: [{ id, username, follower_count, is_verified, display_name, video_count, ... }], project_id? }
 */
router.post('/users', async (req, res) => {
    try {
        let users = req.body.users || [req.body];
        if (!Array.isArray(users)) users = [users];
        const projectId = req.body.project_id || null;

        // Validate project ownership if provided
        if (projectId) {
            const projCheck = await pool.query(
                'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
                [projectId, req.user.id]
            );
            if (projCheck.rows.length === 0) {
                return res.status(403).json({ success: false, error: 'Project not found or access denied' });
            }
        }

        let upserted = 0;

        for (const user of users) {
            if (!user.username) continue;

            const id = user.id || user.username;

            // Resolve TikTok-specific field aliases
            const displayName  = user.display_name  || user.displayName  || user.nickname || null;
            const videoCount   = user.video_count   || user.videoCount   || user.media_count || 0;
            const signature    = user.signature     || user.biography    || null;
            const bioLink      = user.bio_link      || user.external_url || null;
            const region       = user.region        || null;
            const avatarUrl    = user.avatar_url    || user.avatarUrl    || user.profile_pic_url || null;
            const category     = user.business_category || user.category_name || user.category || null;

            const userUpsertSql =
                `INSERT INTO ig_users (
                    id, username, follower_count, following_count, media_count,
                    biography, external_url, is_verified, role, scraped_at,
                    display_name, video_count, signature, bio_link, region, avatar_url,
                    business_category
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12, $13, $14, $15, $16)
                 ON CONFLICT (username)
                 DO UPDATE SET
                     follower_count  = GREATEST(ig_users.follower_count, EXCLUDED.follower_count),
                     following_count = EXCLUDED.following_count,
                     media_count     = EXCLUDED.media_count,
                     biography       = COALESCE(EXCLUDED.biography, ig_users.biography),
                     external_url    = COALESCE(EXCLUDED.external_url, ig_users.external_url),
                     is_verified     = COALESCE(EXCLUDED.is_verified, ig_users.is_verified),
                     role = CASE
                         WHEN ig_users.role = 'root' THEN 'root'
                         ELSE COALESCE(EXCLUDED.role, ig_users.role)
                     END,
                     display_name  = COALESCE(EXCLUDED.display_name,  ig_users.display_name),
                     video_count   = GREATEST(ig_users.video_count,   EXCLUDED.video_count),
                     signature     = COALESCE(EXCLUDED.signature,     ig_users.signature),
                     bio_link      = COALESCE(EXCLUDED.bio_link,      ig_users.bio_link),
                     region        = COALESCE(EXCLUDED.region,        ig_users.region),
                     avatar_url    = COALESCE(EXCLUDED.avatar_url,    ig_users.avatar_url),
                     business_category = COALESCE(EXCLUDED.business_category, ig_users.business_category),
                     scraped_at    = NOW()`;
            const userUpsertParams = [
                id,
                user.username,
                user.follower_count || 0,
                user.following_count || 0,
                videoCount,
                signature,
                bioLink,
                user.is_verified || false,
                user.role || 'reference',
                displayName,
                videoCount,
                signature,
                bioLink,
                region,
                avatarUrl,
                category,
            ];
            try {
                await pool.query(userUpsertSql, userUpsertParams);
            } catch (err) {
                // The `id` primary key can collide when the captured id is shared
                // across username variants (ON CONFLICT only arbitrates username).
                // Retry with a username-derived id, which cannot collide.
                if (err.code === '23505') {
                    userUpsertParams[0] = `u_${user.username}`;
                    await pool.query(userUpsertSql, userUpsertParams);
                } else {
                    throw err;
                }
            }

            // Link profile to project
            if (projectId) {
                await pool.query(
                    `INSERT INTO project_profiles (project_id, username, role)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (project_id, username) DO NOTHING`,
                    [projectId, user.username, user.role || 'tracked']
                );
            }

            upserted++;
        }

        res.json({ success: true, upserted });
    } catch (err) {
        console.error('[USERS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

