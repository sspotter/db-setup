/**
 * Admin: list a user's projects and delete one of them.
 * Identical in the TikTok and Instagram backends (both have the same projects /
 * project_posts / user_scraped_posts tables).
 *
 * Deleting a project removes the project and its links (project_posts,
 * project_profiles, and on TikTok its keywords/videos, all ON DELETE CASCADE).
 * Posts are shared between users, so a post row is deleted ONLY when nothing
 * else uses it: no other project links it and no user has it in their saved
 * posts (user_scraped_posts). Everything else stays.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { recordAdminAction } = require('../utils/adminAudit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/users/:userId/projects
router.get('/users/:userId/projects', verifyAdmin, async (req, res) => {
    const { userId } = req.params;
    if (!UUID.test(userId)) return res.status(400).json({ success: false, error: 'Invalid user id' });
    try {
        const result = await pool.query(
            `SELECT pr.id, pr.name, pr.created_at,
                    (SELECT count(*) FROM project_posts pp WHERE pp.project_id = pr.id)::int AS post_count,
                    (SELECT count(*) FROM project_profiles pf WHERE pf.project_id = pr.id)::int AS profile_count
             FROM projects pr
             WHERE pr.user_id = $1
             ORDER BY pr.created_at DESC`,
            [userId]
        );
        res.json({ success: true, projects: result.rows });
    } catch (err) {
        console.error('[ADMIN LIST PROJECTS] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/admin/users/:userId/projects/:projectId
// Body: { confirm_name } — must equal the project's name exactly, so a wrong click cannot delete.
router.delete('/users/:userId/projects/:projectId', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
    }

    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        console.error('[ADMIN DELETE PROJECT] Could not get a database connection:', err.message);
        logServerError(res, err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    try {
        await client.query('BEGIN');

        // The project must belong to the selected user, so a mismatched pair deletes nothing.
        const found = await client.query(
            `SELECT p.id, p.name, u.email FROM projects p JOIN users u ON u.id = p.user_id
             WHERE p.id = $1 AND p.user_id = $2 FOR UPDATE OF p`,
            [projectId, userId]
        );
        if (found.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Project not found for this user' });
        }
        const project = found.rows[0];

        if (req.body?.confirm_name !== project.name) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'confirm_name does not match the project name' });
        }

        const linked = await client.query(
            'SELECT post_shortcode FROM project_posts WHERE project_id = $1',
            [projectId]
        );
        const shortcodes = linked.rows.map((r) => r.post_shortcode);

        await client.query('DELETE FROM projects WHERE id = $1', [projectId]);

        // Posts nobody else uses any more.
        let postsDeleted = 0;
        if (shortcodes.length > 0) {
            const orphans = await client.query(
                `DELETE FROM posts p
                  WHERE p.shortcode = ANY($1::text[])
                    AND NOT EXISTS (SELECT 1 FROM project_posts pp WHERE pp.post_shortcode = p.shortcode)
                    AND NOT EXISTS (SELECT 1 FROM user_scraped_posts s WHERE s.post_shortcode = p.shortcode)
                  RETURNING p.shortcode`,
                [shortcodes]
            );
            postsDeleted = orphans.rows.length;
        }

        await client.query('COMMIT');
        console.log(`[ADMIN DELETE PROJECT] user=${userId} project=${projectId} "${project.name}" links=${shortcodes.length} posts_deleted=${postsDeleted}`);
        await recordAdminAction(req, {
            action: 'project_delete', target_user_id: userId, target_email: project.email,
            detail: { project_id: projectId, project_name: project.name, links_removed: shortcodes.length, posts_deleted: postsDeleted },
        });
        res.json({
            success: true,
            project: { id: project.id, name: project.name },
            links_removed: shortcodes.length,
            posts_deleted: postsDeleted,
            posts_kept: shortcodes.length - postsDeleted,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[ADMIN DELETE PROJECT] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
