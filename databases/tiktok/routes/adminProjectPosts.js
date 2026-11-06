/**
 * Admin: manage one user's scraped posts and creators inside one project, without logging in as
 * the user. Same paths, bodies and answers as the Instagram backend (shared contract).
 *
 *   GET  /api/admin/users/:userId/projects/:projectId/creators
 *   POST /api/admin/users/:userId/projects/:projectId/posts/action
 *   POST /api/admin/users/:userId/projects/:projectId/profiles/remove
 *
 * Same semantics as the user's own routes (routes/posts.js PATCH /posts/:shortcode/hide and
 * DELETE /posts/:shortcode): the state lives on the project_posts LINK of this project, never
 * on the shared posts row, so other projects and users that hold the same post are untouched.
 *   hide    link.is_hidden = true            (acts on visible links)
 *   unhide  link.is_hidden = false           (acts on hidden links that are not deleted)
 *   delete  soft delete: deleted_at = now() and hidden (acts on every non-deleted link)
 *   restore clears deleted_at and is_hidden  (acts on deleted links)
 * Rows of posts, post_metrics_history, comments and post_relations are never deleted here. The
 * matching tiktok_videos rows of the same project follow hide/delete/unhide/restore, as they do
 * for the user's own hide, so the keyword view stays in step.
 *
 * Every write is a dry run unless dry_run is false, and a real run must carry the expect_count
 * that the dry run returned: if the number changed meanwhile nothing is done (409).
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { recordAdminAction } = require('../utils/adminAudit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SHORTCODES = 5000;
const MAX_SHORTCODE_LENGTH = 255; // posts.shortcode is varchar(255)
const MAX_USERNAME_LENGTH = 255;
const SAMPLE_SIZE = 10;
const AUDIT_SHORTCODES = 20;

// Which links an action looks at (alias pp = project_posts), what it writes, and what the
// matching tiktok_videos rows become (null = leave them alone).
const ACTIONS = {
    hide: {
        where: 'pp.is_hidden = false AND pp.deleted_at IS NULL',
        set: 'is_hidden = true, hidden_at = CURRENT_TIMESTAMP',
        videoHidden: true,
    },
    unhide: {
        where: 'pp.is_hidden = true AND pp.deleted_at IS NULL',
        set: 'is_hidden = false, hidden_at = NULL',
        videoHidden: false,
    },
    delete: {
        where: 'pp.deleted_at IS NULL',
        set: 'is_hidden = true, hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP), deleted_at = CURRENT_TIMESTAMP',
        videoHidden: true,
    },
    restore: {
        where: 'pp.deleted_at IS NOT NULL',
        set: 'is_hidden = false, hidden_at = NULL, deleted_at = NULL',
        videoHidden: false,
    },
};

const bad = (res, error) => res.status(400).json({ success: false, error });

// dry_run defaults to true; anything but a boolean is refused so a typo can never act.
function readDryRun(body) {
    if (body.dry_run === undefined || body.dry_run === null) return { ok: true, value: true };
    if (typeof body.dry_run !== 'boolean') return { ok: false };
    return { ok: true, value: body.dry_run };
}

function readUsername(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim().replace(/^@/, '');
    return name && name.length <= MAX_USERNAME_LENGTH ? name : null;
}

// Returns { shortcodes } or { error }.
function readShortcodes(value) {
    if (!Array.isArray(value) || value.length === 0) return { error: 'shortcodes must be a non-empty array' };
    if (value.length > MAX_SHORTCODES) return { error: `At most ${MAX_SHORTCODES} shortcodes per request` };
    const seen = new Set();
    for (const s of value) {
        if (typeof s !== 'string' || s.length === 0 || s.length > MAX_SHORTCODE_LENGTH || /[\u0000-\u001f]/.test(s)) {
            return { error: `Each shortcode must be a string of 1 to ${MAX_SHORTCODE_LENGTH} characters` };
        }
        seen.add(s);
    }
    return { shortcodes: [...seen] };
}

// expect_count is required for a real run: a non-negative integer.
function readExpectCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

async function withTransaction(res, label, work) {
    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        console.error(`[${label}] Could not get a database connection:`, err.message);
        logServerError(res, err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    try {
        await client.query('BEGIN');
        const done = await work(client);
        if (done.rollback) {
            await client.query('ROLLBACK');
        } else {
            await client.query('COMMIT');
        }
        return done;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[${label}] Error:`, err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
        return null;
    } finally {
        client.release();
    }
}

// The project must belong to that user, so a mismatched pair changes nothing.
async function findProject(client, userId, projectId) {
    const found = await client.query(
        `SELECT p.id, p.name, u.email FROM projects p JOIN users u ON u.id = p.user_id
         WHERE p.id = $1 AND p.user_id = $2`,
        [projectId, userId]
    );
    return found.rows[0] || null;
}

// The links an action would change. lock=true takes row locks so nothing changes between the
// count check and the update.
async function selectLinks(client, projectId, where, selector, lock) {
    const byCreator = selector.creator !== undefined;
    const result = await client.query(
        `SELECT pp.post_shortcode
           FROM project_posts pp
           ${byCreator ? 'JOIN posts p ON p.shortcode = pp.post_shortcode' : ''}
          WHERE pp.project_id = $1 AND ${where}
            AND ${byCreator ? 'lower(p.owner_username) = lower($2)' : 'pp.post_shortcode = ANY($2::text[])'}
          ORDER BY pp.post_shortcode
          ${lock ? 'FOR UPDATE OF pp' : ''}`,
        [projectId, byCreator ? selector.creator : selector.shortcodes]
    );
    return result.rows.map((r) => r.post_shortcode);
}

async function applyAction(client, projectId, action, shortcodes) {
    const spec = ACTIONS[action];
    await client.query(
        `UPDATE project_posts pp SET ${spec.set}
          WHERE pp.project_id = $1 AND pp.post_shortcode = ANY($2::text[]) AND ${spec.where}`,
        [projectId, shortcodes]
    );
    await client.query(
        `UPDATE tiktok_videos SET is_hidden = $3::boolean, updated_at = CURRENT_TIMESTAMP
          WHERE project_id = $1 AND video_id = ANY($2::text[])`,
        [projectId, shortcodes, spec.videoHidden]
    );
}

// GET /api/admin/users/:userId/projects/:projectId/creators
router.get('/users/:userId/projects/:projectId/creators', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    try {
        const project = await pool.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
        if (project.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Project not found for this user' });
        }
        const result = await pool.query(
            `WITH owners AS (
                 SELECT lower(p.owner_username) AS key, min(p.owner_username) AS username,
                        count(*) FILTER (WHERE pp.is_hidden = false AND pp.deleted_at IS NULL) AS visible,
                        count(*) FILTER (WHERE pp.is_hidden = true AND pp.deleted_at IS NULL) AS hidden,
                        count(*) FILTER (WHERE pp.deleted_at IS NOT NULL) AS deleted
                   FROM project_posts pp
                   JOIN posts p ON p.shortcode = pp.post_shortcode
                  WHERE pp.project_id = $1 AND p.owner_username IS NOT NULL
                  GROUP BY lower(p.owner_username)
             ),
             profiles AS (
                 SELECT lower(username) AS key, min(username) AS username, min(role) AS role
                   FROM project_profiles WHERE project_id = $1
                  GROUP BY lower(username)
             )
             SELECT COALESCE(pf.username, o.username) AS username,
                    COALESCE(pf.role, 'collaborator') AS role,
                    COALESCE(o.visible, 0)::int AS visible,
                    COALESCE(o.hidden, 0)::int AS hidden,
                    COALESCE(o.deleted, 0)::int AS deleted
               FROM profiles pf
               FULL JOIN owners o ON o.key = pf.key
              ORDER BY (COALESCE(o.visible, 0) + COALESCE(o.hidden, 0) + COALESCE(o.deleted, 0)) DESC,
                       lower(COALESCE(pf.username, o.username))`,
            [projectId]
        );
        res.json({ success: true, creators: result.rows });
    } catch (err) {
        console.error('[ADMIN PROJECT CREATORS] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/admin/users/:userId/projects/:projectId/posts/action
router.post('/users/:userId/projects/:projectId/posts/action', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    const body = req.body || {};

    if (typeof body.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, body.action)) {
        return bad(res, 'action must be one of hide, unhide, delete, restore');
    }
    const action = body.action;
    const hasCreator = body.creator !== undefined && body.creator !== null;
    const hasShortcodes = body.shortcodes !== undefined && body.shortcodes !== null;
    if (hasCreator === hasShortcodes) return bad(res, 'Send exactly one of creator or shortcodes');

    let selector;
    let creator = null;
    if (hasCreator) {
        creator = readUsername(body.creator);
        if (!creator) return bad(res, 'creator must be a username');
        selector = { creator };
    } else {
        const parsed = readShortcodes(body.shortcodes);
        if (parsed.error) return bad(res, parsed.error);
        selector = { shortcodes: parsed.shortcodes };
    }
    const dry = readDryRun(body);
    if (!dry.ok) return bad(res, 'dry_run must be true or false');
    const dryRun = dry.value;
    let expectCount = null;
    if (!dryRun) {
        expectCount = readExpectCount(body.expect_count);
        if (expectCount === null) return bad(res, 'expect_count (from the dry run) is required');
    }

    const outcome = await withTransaction(res, 'ADMIN PROJECT POSTS', async (client) => {
        const project = await findProject(client, userId, projectId);
        if (!project) {
            res.status(404).json({ success: false, error: 'Project not found for this user' });
            return { rollback: true };
        }
        const links = await selectLinks(client, projectId, ACTIONS[action].where, selector, !dryRun);
        if (dryRun) {
            res.json({ success: true, dry_run: true, action, affected: links.length, creator, sample: links.slice(0, SAMPLE_SIZE) });
            return { rollback: true };
        }
        if (links.length !== expectCount) {
            res.status(409).json({ success: false, error: 'count changed', affected: links.length });
            return { rollback: true };
        }
        if (links.length > 0) await applyAction(client, projectId, action, links);
        return { project, links };
    });
    if (!outcome || outcome.rollback) return;

    const { project, links } = outcome;
    console.log(`[ADMIN PROJECT POSTS] ${action} user=${userId} project=${projectId} affected=${links.length}${creator ? ` creator=${creator}` : ''}`);
    await recordAdminAction(req, {
        action: `project_posts_${action}`, target_user_id: userId, target_email: project.email,
        detail: {
            project_id: projectId, project_name: project.name, creator,
            selection: creator ? 'creator' : 'shortcodes', affected: links.length,
            shortcodes: links.slice(0, AUDIT_SHORTCODES),
        },
    });
    res.json({ success: true, dry_run: false, action, affected: links.length });
});

// POST /api/admin/users/:userId/projects/:projectId/profiles/remove
router.post('/users/:userId/projects/:projectId/profiles/remove', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    const body = req.body || {};

    const username = readUsername(body.username);
    if (!username) return bad(res, 'username is required');
    if (body.with_posts !== undefined && typeof body.with_posts !== 'boolean') return bad(res, 'with_posts must be true or false');
    const withPosts = body.with_posts === true;
    const dry = readDryRun(body);
    if (!dry.ok) return bad(res, 'dry_run must be true or false');
    const dryRun = dry.value;
    let expectCount = null;
    if (!dryRun) {
        expectCount = readExpectCount(body.expect_count);
        if (expectCount === null) return bad(res, 'expect_count (from the dry run) is required');
    }

    const outcome = await withTransaction(res, 'ADMIN PROJECT PROFILE REMOVE', async (client) => {
        const project = await findProject(client, userId, projectId);
        if (!project) {
            res.status(404).json({ success: false, error: 'Project not found for this user' });
            return { rollback: true };
        }
        // affected = the posts that would be soft-deleted (0 when the posts are kept).
        const links = withPosts
            ? await selectLinks(client, projectId, ACTIONS.delete.where, { creator: username }, !dryRun)
            : [];
        const profileRows = (await client.query(
            `SELECT id FROM project_profiles WHERE project_id = $1 AND lower(username) = lower($2)
             ${dryRun ? '' : 'FOR UPDATE'}`,
            [projectId, username]
        )).rows.length;

        if (dryRun) {
            res.json({ success: true, dry_run: true, action: 'remove', affected: links.length, profile_rows: profileRows, creator: username, with_posts: withPosts, sample: links.slice(0, SAMPLE_SIZE) });
            return { rollback: true };
        }
        if (links.length !== expectCount) {
            res.status(409).json({ success: false, error: 'count changed', affected: links.length, profile_rows: profileRows });
            return { rollback: true };
        }
        if (links.length > 0) await applyAction(client, projectId, 'delete', links);
        await client.query(
            'DELETE FROM project_profiles WHERE project_id = $1 AND lower(username) = lower($2)',
            [projectId, username]
        );
        return { project, links, profileRows };
    });
    if (!outcome || outcome.rollback) return;

    const { project, links, profileRows } = outcome;
    console.log(`[ADMIN PROJECT PROFILE REMOVE] user=${userId} project=${projectId} creator=${username} posts_deleted=${links.length} profile_rows=${profileRows}`);
    await recordAdminAction(req, {
        action: 'project_creator_remove', target_user_id: userId, target_email: project.email,
        detail: {
            project_id: projectId, project_name: project.name, creator: username,
            with_posts: withPosts, affected: links.length, profile_rows: profileRows,
            shortcodes: links.slice(0, AUDIT_SHORTCODES),
        },
    });
    res.json({ success: true, dry_run: false, action: 'remove', affected: links.length, profile_rows: profileRows });
});

module.exports = router;
