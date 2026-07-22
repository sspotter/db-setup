/**
 * Users routes — upsert Instagram profiles (with optional project linking)
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');

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

        for (const user of users) {
            if (!user.username) continue;

            const id = user.id || user.username;

            await pool.query(
                `INSERT INTO ig_users (id, username, follower_count, following_count, media_count, biography, external_url, is_verified, role, scraped_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                 ON CONFLICT (username)
                 DO UPDATE SET
                     follower_count = GREATEST(ig_users.follower_count, EXCLUDED.follower_count),
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
                    user.follower_count || 0,
                    user.following_count || 0,
                    user.media_count || 0,
                    user.biography || null,
                    user.external_url || null,
                    user.is_verified || false,
                    user.role || 'reference'
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

        res.json({ success: true, upserted });
    } catch (err) {
        console.error('[USERS] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
