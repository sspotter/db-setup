/**
 * Admin: hide / unhide / soft-delete / restore a user's posts inside one project, and
 * remove a creator from a project (Instagram backend; the TikTok backend has the same
 * contract).
 *
 * State lives on the project link (project_posts.is_hidden / hidden_at / deleted_at, see
 * migrations/v11_project_post_hide.sql). "Delete" is a SOFT delete of that link only:
 * rows of the shared posts table, post_metrics_history and every other project's links are
 * never touched, because a post can belong to other projects and users.
 *
 * Every write is previewed first (dry_run defaults to true). A real run must repeat the
 * previewed count as expect_count and is refused with 409 when it changed in between.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { recordAdminAction } = require('../utils/adminAudit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SHORTCODES = 5000;
const MAX_SHORTCODE_LEN = 100;
const MAX_USERNAME_LEN = 255;
const SAMPLE_SIZE = 10;

// Fixed SQL fragments only; user input always travels as a bind parameter.
const ACTIONS = {
    hide: { audit: 'project_posts_hide', from: 'pp.is_hidden = false AND pp.deleted_at IS NULL', set: 'is_hidden = true, hidden_at = now()' },
    unhide: { audit: 'project_posts_unhide', from: 'pp.is_hidden = true AND pp.deleted_at IS NULL', set: 'is_hidden = false, hidden_at = NULL' },
    delete: { audit: 'project_posts_delete', from: 'pp.deleted_at IS NULL', set: 'deleted_at = now()' },
    restore: { audit: 'project_posts_restore', from: 'pp.deleted_at IS NOT NULL', set: 'deleted_at = NULL' },
};

class HttpError extends Error {
    constructor(status, body) {
        super(body.error);
        this.status = status;
        this.body = { success: false, ...body };
    }
}

const normUsername = (v) => (typeof v === 'string' ? v.trim().replace(/^@/, '') : '');

function parseDryRun(body) {
    if (body.dry_run === undefined) return true;
    if (typeof body.dry_run !== 'boolean') throw new HttpError(400, { error: 'dry_run must be true or false' });
    return body.dry_run;
}

function parseExpectCount(body, dryRun) {
    if (dryRun) return null;
    if (!Number.isInteger(body.expect_count) || body.expect_count < 0) {
        throw new HttpError(400, { error: 'expect_count (the count from the preview) is required when dry_run is false' });
    }
    return body.expect_count;
}

// Returns { creator, shortcodes } with exactly one of them set.
function parseTarget(body) {
    const hasCreator = body.creator !== undefined && body.creator !== null;
    const hasCodes = body.shortcodes !== undefined && body.shortcodes !== null;
    if (hasCreator === hasCodes) throw new HttpError(400, { error: 'Send exactly one of creator or shortcodes' });
    if (hasCreator) {
        const creator = normUsername(body.creator);
        if (!creator || creator.length > MAX_USERNAME_LEN) throw new HttpError(400, { error: 'Invalid creator' });
        if (body.include_tagged !== undefined && typeof body.include_tagged !== 'boolean') throw new HttpError(400, { error: 'include_tagged must be true or false' });
        return { creator, shortcodes: null, includeTagged: body.include_tagged === true };
    }
    const list = body.shortcodes;
    if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, { error: 'shortcodes must be a non-empty array' });
    if (list.length > MAX_SHORTCODES) throw new HttpError(400, { error: `At most ${MAX_SHORTCODES} shortcodes per request` });
    for (const s of list) {
        if (typeof s !== 'string' || s.length === 0 || s.length > MAX_SHORTCODE_LEN) {
            throw new HttpError(400, { error: 'Every shortcode must be a string of 1 to 100 characters' });
        }
    }
    return { creator: null, shortcodes: [...new Set(list)], includeTagged: false };
}

// Opens a transaction on a pooled client and checks the project belongs to the user.
async function begin(userId, projectId) {
    if (!UUID.test(userId) || !UUID.test(projectId)) throw new HttpError(400, { error: 'Invalid id' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const found = await client.query(
            `SELECT p.id, p.name, u.email FROM projects p JOIN users u ON u.id = p.user_id
             WHERE p.id = $1 AND p.user_id = $2`,
            [projectId, userId]
        );
        if (found.rows.length === 0) throw new HttpError(404, { error: 'Project not found for this user' });
        return { client, project: found.rows[0] };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        throw err;
    }
}

// WHERE clause (and params) selecting the project links an action would change.
function selection(spec, projectId, target) {
    const params = [projectId];
    let where = `pp.project_id = $1 AND ${spec.from}`;
    if (target.creator !== null) {
        params.push(target.creator);
        // include_tagged also matches posts where the account is a COAUTHOR or CAPTION_USER (a post
        // owned by someone else that features them); that is how the extension counts a profile.
        where += target.includeTagged
            ? ` AND (lower(p.owner_username) = lower($2) OR EXISTS (SELECT 1 FROM post_relations r
                    WHERE r.post_shortcode = p.shortcode AND r.relation_type IN ('COAUTHOR', 'CAPTION_USER') AND lower(r.username) = lower($2)))`
            : ' AND lower(p.owner_username) = lower($2)';
    } else {
        params.push(target.shortcodes);
        where += ' AND pp.post_shortcode = ANY($2::text[])';
    }
    return { where, params };
}

const PREVIEW_SQL = (where) =>
    `SELECT count(*)::int AS n, (array_agg(pp.post_shortcode ORDER BY pp.post_shortcode))[1:${SAMPLE_SIZE}] AS sample
     FROM project_posts pp JOIN posts p ON p.shortcode = pp.post_shortcode WHERE ${where}`;

// Locks and returns the ids of the links to change; only project_posts rows are written.
const LOCK_SQL = (where) =>
    `SELECT pp.id FROM project_posts pp JOIN posts p ON p.shortcode = pp.post_shortcode
     WHERE ${where} ORDER BY pp.id FOR UPDATE OF pp`;

const finish = (client, ok) => client.query(ok ? 'COMMIT' : 'ROLLBACK');

function fail(res, tag, err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    if (err && err.code === '42703') {
        console.error(`[${tag}] project_posts.is_hidden/deleted_at missing; apply migrations/v11_project_post_hide.sql`);
        return res.status(503).json({ success: false, error: 'Database migration v11_project_post_hide.sql has not been applied' });
    }
    console.error(`[${tag}] Error:`, err && err.message);
    logServerError(res, err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

// POST /api/admin/users/:userId/projects/:projectId/posts/action
router.post('/users/:userId/projects/:projectId/posts/action', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    const body = req.body || {};
    let ctx = null;
    let committed = false;
    try {
        const spec = typeof body.action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
        if (!spec) throw new HttpError(400, { error: 'action must be hide, unhide, delete or restore' });
        const target = parseTarget(body);
        const dryRun = parseDryRun(body);
        const expect = parseExpectCount(body, dryRun);
        ctx = await begin(userId, projectId);
        const { client, project } = ctx;
        const { where, params } = selection(spec, projectId, target);

        if (dryRun) {
            const r = await client.query(PREVIEW_SQL(where), params);
            await finish(client, false);
            return res.json({
                success: true, dry_run: true, action: body.action, affected: r.rows[0].n,
                creator: target.creator, include_tagged: target.includeTagged, sample: r.rows[0].sample || [],
            });
        }

        const locked = await client.query(LOCK_SQL(where), params);
        const ids = locked.rows.map((r) => r.id);
        if (ids.length !== expect) {
            await finish(client, false);
            return res.status(409).json({ success: false, error: 'count changed', affected: ids.length });
        }
        if (ids.length > 0) {
            await client.query(`UPDATE project_posts pp SET ${spec.set} WHERE pp.id = ANY($1::uuid[])`, [ids]);
        }
        await finish(client, true);
        committed = true;
        console.log(`[ADMIN POSTS ${body.action}] user=${userId} project=${projectId} creator=${target.creator || '-'} affected=${ids.length}`);
        await recordAdminAction(req, {
            action: spec.audit, target_user_id: userId, target_email: project.email,
            detail: {
                project_id: projectId, project_name: project.name, post_action: body.action,
                creator: target.creator, include_tagged: target.includeTagged, shortcodes: target.shortcodes ? target.shortcodes.length : null, affected: ids.length,
            },
        });
        res.json({ success: true, dry_run: false, action: body.action, affected: ids.length });
    } catch (err) {
        if (ctx && !committed) await ctx.client.query('ROLLBACK').catch(() => {});
        fail(res, 'ADMIN POSTS ACTION', err);
    } finally {
        if (ctx) ctx.client.release();
    }
});

// POST /api/admin/users/:userId/projects/:projectId/profiles/remove
router.post('/users/:userId/projects/:projectId/profiles/remove', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    const body = req.body || {};
    let ctx = null;
    let committed = false;
    try {
        const username = normUsername(body.username);
        if (!username || username.length > MAX_USERNAME_LEN) throw new HttpError(400, { error: 'Invalid username' });
        if (body.with_posts !== undefined && typeof body.with_posts !== 'boolean') throw new HttpError(400, { error: 'with_posts must be true or false' });
        const withPosts = body.with_posts === true;
        const dryRun = parseDryRun(body);
        const expect = parseExpectCount(body, dryRun);
        ctx = await begin(userId, projectId);
        const { client, project } = ctx;
        const { where, params } = selection(ACTIONS.delete, projectId, { creator: username, shortcodes: null });

        const profiles = await client.query(
            'SELECT id FROM project_profiles WHERE project_id = $1 AND lower(username) = lower($2) FOR UPDATE',
            [projectId, username]
        );
        const profileRows = profiles.rows.length;
        const postIds = withPosts ? (await client.query(LOCK_SQL(where), params)).rows.map((r) => r.id) : [];
        if (profileRows === 0 && postIds.length === 0) throw new HttpError(404, { error: 'Creator not found in this project' });

        if (dryRun) {
            const sample = withPosts ? (await client.query(PREVIEW_SQL(where), params)).rows[0].sample || [] : [];
            await finish(client, false);
            return res.json({
                success: true, dry_run: true, action: 'remove_creator', affected: postIds.length,
                creator: username, with_posts: withPosts, profile_rows: profileRows, sample,
            });
        }
        if (postIds.length !== expect) {
            await finish(client, false);
            return res.status(409).json({ success: false, error: 'count changed', affected: postIds.length });
        }
        if (postIds.length > 0) {
            await client.query(`UPDATE project_posts pp SET ${ACTIONS.delete.set} WHERE pp.id = ANY($1::uuid[])`, [postIds]);
        }
        const removed = await client.query(
            'DELETE FROM project_profiles WHERE project_id = $1 AND lower(username) = lower($2)',
            [projectId, username]
        );
        await finish(client, true);
        committed = true;
        console.log(`[ADMIN REMOVE CREATOR] user=${userId} project=${projectId} creator=${username} posts=${postIds.length} profile_rows=${removed.rowCount}`);
        await recordAdminAction(req, {
            action: 'project_profile_remove', target_user_id: userId, target_email: project.email,
            detail: {
                project_id: projectId, project_name: project.name, creator: username,
                with_posts: withPosts, affected: postIds.length, profile_rows: removed.rowCount,
            },
        });
        res.json({ success: true, dry_run: false, action: 'remove_creator', affected: postIds.length, profile_rows: removed.rowCount });
    } catch (err) {
        if (ctx && !committed) await ctx.client.query('ROLLBACK').catch(() => {});
        fail(res, 'ADMIN REMOVE CREATOR', err);
    } finally {
        if (ctx) ctx.client.release();
    }
});

// GET /api/admin/users/:userId/projects/:projectId/creators
router.get('/users/:userId/projects/:projectId/creators', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    try {
        if (!UUID.test(userId) || !UUID.test(projectId)) throw new HttpError(400, { error: 'Invalid id' });
        const found = await pool.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
        if (found.rows.length === 0) throw new HttpError(404, { error: 'Project not found for this user' });
        const result = await pool.query(
            `WITH appearances AS (
                 SELECT pp.id AS link_id, pp.is_hidden, pp.deleted_at, x.username, x.is_owner
                   FROM project_posts pp JOIN posts p ON p.shortcode = pp.post_shortcode
                  CROSS JOIN LATERAL (
                        SELECT p.owner_username AS username, true AS is_owner WHERE p.owner_username IS NOT NULL
                        UNION ALL
                        SELECT r.username, false FROM post_relations r
                         WHERE r.post_shortcode = p.shortcode AND r.relation_type IN ('COAUTHOR', 'CAPTION_USER') AND r.username IS NOT NULL
                  ) x
                  WHERE pp.project_id = $1
             ), counts AS (
                 SELECT lower(username) AS key, min(username) AS username,
                        count(DISTINCT link_id) FILTER (WHERE is_hidden = false AND deleted_at IS NULL)::int AS visible,
                        count(DISTINCT link_id) FILTER (WHERE is_hidden = true AND deleted_at IS NULL)::int AS hidden,
                        count(DISTINCT link_id) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
                        count(DISTINCT link_id) FILTER (WHERE is_owner)::int AS owned
                   FROM appearances GROUP BY lower(username)
             ), profiles AS (
                 SELECT lower(username) AS key, min(username) AS username, min(role) AS role
                   FROM project_profiles WHERE project_id = $1 GROUP BY lower(username)
             )
             SELECT COALESCE(c.username, f.username) AS username,
                    COALESCE(f.role, CASE WHEN COALESCE(c.owned, 0) > 0 THEN 'collaborator' ELSE 'tagged' END) AS role,
                    COALESCE(c.visible, 0) AS visible, COALESCE(c.hidden, 0) AS hidden, COALESCE(c.deleted, 0) AS deleted,
                    COALESCE(c.owned, 0) AS owned
               FROM counts c FULL JOIN profiles f ON f.key = c.key
              ORDER BY COALESCE(c.visible, 0) + COALESCE(c.hidden, 0) + COALESCE(c.deleted, 0) DESC, 1`,
            [projectId]
        );
        res.json({ success: true, creators: result.rows });
    } catch (err) {
        fail(res, 'ADMIN PROJECT CREATORS', err);
    }
});

module.exports = router;
