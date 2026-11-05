/**
 * Users routes — upsert Instagram profiles (with optional project linking)
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logServerError } = require('../middleware/activityLog');
const { toObservedAt, IG_USERS_FOLLOWERS_SET } = require('../observed');

// The TikTok extension's profile rows carry these; Instagram captures never do. Without this
// check a mis-set API URL would write TikTok counts over Instagram profiles.
const isTikTokProfile = (user) => 'heart_count' in user || 'video_count' in user || 'signature' in user;

// The extension sends no observation time, so a count with none could only ever go up
// (see IG_USERS_FOLLOWERS_SET), and a stale high count would stay forever. A fresh capture is
// treated as seen now. The dashboard copies the backend's rows into the same browser list, and
// those rows carry scraped_at or added_to_project: they repeat what is stored, so they get no
// time and can't beat a real capture.
const observedAtFor = (user) => {
    const sent = toObservedAt(user.observedAt);
    if (sent) return sent;
    const echoedFromBackend = 'scraped_at' in user || 'added_to_project' in user;
    return echoedFromBackend ? null : new Date().toISOString();
};

/**
 * POST /api/users
 * Body: { users: [{ id, username, follower_count, is_verified }], project_id? }
 *   OR: { id, username, follower_count, is_verified, project_id? }  (single user)
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
        let skipped = 0;

        for (const user of users) {
            if (!user.username) continue;
            if (isTikTokProfile(user)) {
                skipped++;
                continue;
            }

            const id = user.id || user.username;

            await pool.query(
                `INSERT INTO ig_users (id, username, follower_count, following_count, media_count, biography, external_url, is_verified, role, scraped_at, observed_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
                 ON CONFLICT (username)
                 DO UPDATE SET
                     ${IG_USERS_FOLLOWERS_SET},
                     following_count = EXCLUDED.following_count,
                     media_count = EXCLUDED.media_count,
                     biography = EXCLUDED.biography,
                     external_url = EXCLUDED.external_url,
                     is_verified = COALESCE(EXCLUDED.is_verified, ig_users.is_verified),
                     role = CASE 
                         WHEN ig_users.role = 'root' THEN 'root' 
                         ELSE COALESCE(EXCLUDED.role, ig_users.role)
                     END,
                     scraped_at = NOW()`,
                [
                    id, 
                    user.username, 
                    Number(user.follower_count) || 0,
                    user.following_count || 0,
                    user.media_count || 0,
                    user.biography || null,
                    user.external_url || null,
                    user.is_verified || false,
                    user.role || 'reference',
                    observedAtFor(user), // profile-page counts: newest observation wins
                ]
            );

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

        res.json({ success: true, upserted, skipped });
    } catch (err) {
        console.error('[USERS] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
