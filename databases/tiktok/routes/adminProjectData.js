/**
 * Admin: the keyword side of one user's project (search_keywords / tiktok_videos) and the
 * profiles of the project (project_profiles), without logging in as the user. Companion of
 * routes/adminProjectPosts.js (same contract: preview first, expect_count, one transaction,
 * audited, soft state only; nothing here deletes a row; profile removal stays in that file).
 *
 *   GET  /api/admin/users/:userId/projects/:projectId/keywords
 *   GET  /api/admin/users/:userId/projects/:projectId/videos?keyword_id=&limit=
 *   POST /api/admin/users/:userId/projects/:projectId/videos/action     { action: hide|unhide, video_ids?, keyword_id? }
 *   GET  /api/admin/users/:userId/projects/:projectId/profiles
 *   POST /api/admin/users/:userId/projects/:projectId/profiles/action   { action: hide|unhide, usernames, with_posts? }
 *
 * Hiding a video sets tiktok_videos.is_hidden for THIS project's rows (as PATCH
 * /tiktok/videos/:id/qualify does for the user), mirrors the state onto this project's
 * project_posts links with the same id, then refreshes the keyword counters the user's app
 * reads. Hiding a profile sets project_profiles.is_hidden (migrations/v12_project_profile_hide.sql);
 * with_posts also hides that username's project_posts links and tiktok_videos in this project.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { recordAdminAction } = require('../utils/adminAudit');
const {
    ACTIONS: POST_ACTIONS, UUID, SAMPLE_SIZE, AUDIT_SHORTCODES, bad, readDryRun, readUsername,
    readExpectCount, withTransaction, findProject,
} = require('./adminProjectPosts').helpers;

const MAX_VIDEO_IDS = 5000;
const MAX_VIDEO_ID_LENGTH = 255; // tiktok_videos.video_id is varchar(255)
const MAX_USERNAMES = 1000;
const LISTED_ROWS = 500;
const CAPTION_CHARS = 160;
const HIDE_MISSING = 'project_profiles.is_hidden is missing: apply migrations/v12_project_profile_hide.sql';

const num = (v) => Number(v) || 0;
const iso = (v) => (v ? new Date(v).toISOString() : null);
const NOT_HIDDEN = '(v.is_hidden = false OR v.is_hidden IS NULL)';

// Which videos an action looks at (alias v) and what they become.
const VIDEO_ACTIONS = {
    hide: { where: NOT_HIDDEN, hidden: true },
    unhide: { where: 'v.is_hidden = true', hidden: false },
};
// Which profile rows an action looks at (alias pf).
const PROFILE_ACTIONS = {
    hide: { where: 'pf.is_hidden = false', hidden: true },
    unhide: { where: 'pf.is_hidden = true', hidden: false },
};

const notFound = (res) => res.status(404).json({ success: false, error: 'Project not found for this user' });

function readAction(body, table) {
    return typeof body.action === 'string' && Object.prototype.hasOwnProperty.call(table, body.action) ? body.action : null;
}

// Returns { ids } or { error }.
function readVideoIds(value) {
    if (!Array.isArray(value) || value.length === 0) return { error: 'video_ids must be a non-empty array' };
    if (value.length > MAX_VIDEO_IDS) return { error: `At most ${MAX_VIDEO_IDS} video_ids per request` };
    const seen = new Set();
    for (const s of value) {
        if (typeof s !== 'string' || s.length === 0 || s.length > MAX_VIDEO_ID_LENGTH || /[\u0000-\u001f]/.test(s)) {
            return { error: `Each video id must be a string of 1 to ${MAX_VIDEO_ID_LENGTH} characters` };
        }
        seen.add(s);
    }
    return { ids: [...seen] };
}

// Returns { keys } (distinct lower-case usernames) or { error }.
function readUsernames(value) {
    if (!Array.isArray(value) || value.length === 0) return { error: 'usernames must be a non-empty array' };
    if (value.length > MAX_USERNAMES) return { error: `At most ${MAX_USERNAMES} usernames per request` };
    const keys = new Set();
    for (const raw of value) {
        const name = readUsername(raw);
        if (!name) return { error: 'Each username must be a non-empty string' };
        keys.add(name.toLowerCase());
    }
    return { keys: [...keys] };
}

// The same three counters the user's own hide refreshes (routes/tiktok_videos.js).
async function refreshKeywordCounters(client, projectId, keywordIds) {
    if (keywordIds.length === 0) return;
    await client.query(
        `UPDATE search_keywords sk
            SET total_videos = (SELECT COUNT(*) FROM tiktok_videos v WHERE v.keyword_id = sk.id AND ${NOT_HIDDEN}),
                total_creators = (SELECT COUNT(DISTINCT v.creator_id) FROM tiktok_videos v WHERE v.keyword_id = sk.id AND ${NOT_HIDDEN}),
                total_views = (SELECT COALESCE(SUM(v.views_count), 0) FROM tiktok_videos v WHERE v.keyword_id = sk.id AND ${NOT_HIDDEN})
          WHERE sk.project_id = $1 AND sk.id = ANY($2::uuid[])`,
        [projectId, keywordIds]
    );
}

// This project's project_posts links with the given ids that the action would change.
function linkSelectSql(action, lock) {
    return `SELECT pp.post_shortcode FROM project_posts pp
             WHERE pp.project_id = $1 AND pp.post_shortcode = ANY($2::text[]) AND ${POST_ACTIONS[action].where}
             ORDER BY pp.post_shortcode ${lock ? 'FOR UPDATE OF pp' : ''}`;
}
async function applyLinks(client, projectId, action, shortcodes) {
    if (shortcodes.length === 0) return;
    await client.query(
        `UPDATE project_posts pp SET ${POST_ACTIONS[action].set}
          WHERE pp.project_id = $1 AND pp.post_shortcode = ANY($2::text[]) AND ${POST_ACTIONS[action].where}`,
        [projectId, shortcodes]
    );
}

async function ownedProject(res, userId, projectId) {
    const found = await pool.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
    if (found.rows.length === 0) { notFound(res); return false; }
    return true;
}

function fail(res, label, err) {
    console.error(`[${label}] Error:`, err.message);
    logServerError(res, err);
    res.status(500).json({ success: false, error: 'Internal server error' });
}

// GET .../keywords
router.get('/users/:userId/projects/:projectId/keywords', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    try {
        if (!(await ownedProject(res, userId, projectId))) return;
        const result = await pool.query(
            `SELECT sk.id, sk.keyword, sk.status, sk.source_type, sk.created_at,
                    sk.total_videos AS stored_videos,
                    COALESCE(a.videos, 0) AS videos, COALESCE(a.hidden_videos, 0) AS hidden_videos,
                    COALESCE(a.creators, 0) AS creators, COALESCE(a.views, 0) AS views,
                    COALESCE(a.engagement, 0) AS engagement
               FROM search_keywords sk
               LEFT JOIN (
                   SELECT v.keyword_id,
                          COUNT(*) FILTER (WHERE ${NOT_HIDDEN}) AS videos,
                          COUNT(*) FILTER (WHERE v.is_hidden = true) AS hidden_videos,
                          COUNT(DISTINCT v.creator_id) FILTER (WHERE ${NOT_HIDDEN}) AS creators,
                          COALESCE(SUM(v.views_count) FILTER (WHERE ${NOT_HIDDEN}), 0) AS views,
                          COALESCE(SUM(v.likes_count + v.comments_count) FILTER (WHERE ${NOT_HIDDEN}), 0) AS engagement
                     FROM tiktok_videos v WHERE v.project_id = $1 GROUP BY v.keyword_id
               ) a ON a.keyword_id = sk.id
              WHERE sk.project_id = $1
              ORDER BY COALESCE(a.videos, 0) DESC, sk.created_at DESC`,
            [projectId]
        );
        res.json({
            success: true,
            keywords: result.rows.map((r) => ({
                id: r.id, keyword: r.keyword, status: r.status, source_type: r.source_type,
                videos: num(r.videos), stored_videos: num(r.stored_videos), hidden_videos: num(r.hidden_videos),
                creators: num(r.creators), views: num(r.views), engagement: num(r.engagement),
                created_at: iso(r.created_at),
            })),
        });
    } catch (err) {
        fail(res, 'ADMIN PROJECT KEYWORDS', err);
    }
});

// GET .../videos?keyword_id=&limit=
router.get('/users/:userId/projects/:projectId/videos', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    const keywordId = req.query.keyword_id === undefined || req.query.keyword_id === '' ? null : String(req.query.keyword_id);
    if (keywordId !== null && !UUID.test(keywordId)) return bad(res, 'Invalid keyword_id');
    let limit = LISTED_ROWS;
    if (req.query.limit !== undefined) {
        limit = Number.parseInt(String(req.query.limit), 10);
        if (!Number.isInteger(limit) || limit < 1) return bad(res, 'limit must be a positive integer');
        limit = Math.min(limit, LISTED_ROWS);
    }
    try {
        if (!(await ownedProject(res, userId, projectId))) return;
        const [totalRes, rowsRes] = await Promise.all([
            pool.query(
                `SELECT COUNT(*) AS total FROM tiktok_videos v
                  WHERE v.project_id = $1 AND ($2::uuid IS NULL OR v.keyword_id = $2::uuid)`,
                [projectId, keywordId]
            ),
            pool.query(
                `SELECT v.id, v.video_id, v.keyword_id, sk.keyword, c.username, LEFT(v.caption, ${CAPTION_CHARS}) AS caption,
                        v.views_count, v.likes_count, v.comments_count, v.shares_count, v.posted_at,
                        v.included_in_reach, v.is_hidden
                   FROM tiktok_videos v
                   LEFT JOIN tiktok_creators c ON c.id = v.creator_id
                   LEFT JOIN search_keywords sk ON sk.id = v.keyword_id
                  WHERE v.project_id = $1 AND ($2::uuid IS NULL OR v.keyword_id = $2::uuid)
                  ORDER BY v.posted_at DESC NULLS LAST, v.captured_at DESC NULLS LAST, v.id
                  LIMIT $3`,
                [projectId, keywordId, limit]
            ),
        ]);
        res.json({
            success: true,
            total: num(totalRes.rows[0] && totalRes.rows[0].total),
            videos: rowsRes.rows.map((r) => ({
                id: r.id, video_id: r.video_id, keyword_id: r.keyword_id, keyword: r.keyword || null,
                username: r.username || null, caption: r.caption || '',
                views: num(r.views_count), likes: num(r.likes_count), comments: num(r.comments_count), shares: num(r.shares_count),
                posted_at: iso(r.posted_at), included_in_reach: r.included_in_reach === true,
                state: r.is_hidden === true ? 'hidden' : 'visible',
            })),
        });
    } catch (err) {
        fail(res, 'ADMIN PROJECT VIDEOS', err);
    }
});

// POST .../videos/action
router.post('/users/:userId/projects/:projectId/videos/action', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    const body = req.body || {};

    const action = readAction(body, VIDEO_ACTIONS);
    if (!action) return bad(res, 'action must be one of hide, unhide');
    const hasIds = body.video_ids !== undefined && body.video_ids !== null;
    const hasKeyword = body.keyword_id !== undefined && body.keyword_id !== null;
    if (!hasIds && !hasKeyword) return bad(res, 'Send video_ids, keyword_id or both');
    let videoIds = null;
    if (hasIds) {
        const parsed = readVideoIds(body.video_ids);
        if (parsed.error) return bad(res, parsed.error);
        videoIds = parsed.ids;
    }
    let keywordId = null;
    if (hasKeyword) {
        if (typeof body.keyword_id !== 'string' || !UUID.test(body.keyword_id)) return bad(res, 'Invalid keyword_id');
        keywordId = body.keyword_id;
    }
    const dry = readDryRun(body);
    if (!dry.ok) return bad(res, 'dry_run must be true or false');
    const dryRun = dry.value;
    let expectCount = null;
    if (!dryRun) {
        expectCount = readExpectCount(body.expect_count);
        if (expectCount === null) return bad(res, 'expect_count (from the dry run) is required');
    }

    const spec = VIDEO_ACTIONS[action];
    const outcome = await withTransaction(res, 'ADMIN PROJECT VIDEOS ACTION', async (client) => {
        const project = await findProject(client, userId, projectId);
        if (!project) { notFound(res); return { rollback: true }; }

        const videos = (await client.query(
            `SELECT v.id, v.video_id, v.keyword_id FROM tiktok_videos v
              WHERE v.project_id = $1 AND ${spec.where}
                AND ($2::text[] IS NULL OR v.video_id = ANY($2::text[]))
                AND ($3::uuid IS NULL OR v.keyword_id = $3::uuid)
              ORDER BY v.id ${dryRun ? '' : 'FOR UPDATE OF v'}`,
            [projectId, videoIds, keywordId]
        )).rows;
        const shortcodes = [...new Set(videos.map((v) => v.video_id))];
        const links = (await client.query(linkSelectSql(action, !dryRun), [projectId, shortcodes])).rows.map((r) => r.post_shortcode);

        if (dryRun) {
            res.json({
                success: true, dry_run: true, action, affected: videos.length, posts_affected: links.length,
                keyword_id: keywordId, sample: shortcodes.slice(0, SAMPLE_SIZE),
            });
            return { rollback: true };
        }
        if (videos.length !== expectCount) {
            res.status(409).json({ success: false, error: 'count changed', affected: videos.length, posts_affected: links.length });
            return { rollback: true };
        }
        if (videos.length > 0) {
            await client.query(
                `UPDATE tiktok_videos SET is_hidden = $2::boolean, updated_at = CURRENT_TIMESTAMP
                  WHERE project_id = $1 AND id = ANY($3::uuid[])`,
                [projectId, spec.hidden, videos.map((v) => v.id)]
            );
            await applyLinks(client, projectId, action, links);
            await refreshKeywordCounters(client, projectId, [...new Set(videos.map((v) => v.keyword_id))]);
        }
        return { project, videos, links, shortcodes };
    });
    if (!outcome || outcome.rollback) return;

    const { project, videos, links, shortcodes } = outcome;
    console.log(`[ADMIN PROJECT VIDEOS] ${action} user=${userId} project=${projectId} affected=${videos.length}`);
    await recordAdminAction(req, {
        action: `project_videos_${action}`, target_user_id: userId, target_email: project.email,
        detail: {
            project_id: projectId, project_name: project.name, keyword_id: keywordId,
            selection: hasIds ? 'video_ids' : 'keyword', affected: videos.length, posts_affected: links.length,
            video_ids: shortcodes.slice(0, AUDIT_SHORTCODES),
        },
    });
    res.json({ success: true, dry_run: false, action, affected: videos.length, posts_affected: links.length });
});

// GET .../profiles
router.get('/users/:userId/projects/:projectId/profiles', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    try {
        if (!(await ownedProject(res, userId, projectId))) return;
        const [totalRes, rowsRes] = await Promise.all([
            pool.query('SELECT COUNT(*) AS total FROM project_profiles WHERE project_id = $1', [projectId]),
            pool.query(
                `SELECT pf.username, pf.role, pf.pinned, pf.is_hidden,
                        (SELECT COUNT(*) FROM project_posts pp JOIN posts p ON p.shortcode = pp.post_shortcode
                          WHERE pp.project_id = $1 AND pp.is_hidden = false AND pp.deleted_at IS NULL
                            AND lower(p.owner_username) = lower(pf.username)) AS posts,
                        (SELECT COUNT(*) FROM tiktok_videos v JOIN tiktok_creators c ON c.id = v.creator_id
                          WHERE v.project_id = $1 AND ${NOT_HIDDEN}
                            AND lower(c.username) = lower(pf.username)) AS videos
                   FROM project_profiles pf
                  WHERE pf.project_id = $1
                  ORDER BY pf.is_hidden ASC, pf.pinned DESC NULLS LAST, lower(pf.username)
                  LIMIT ${LISTED_ROWS}`,
                [projectId]
            ),
        ]);
        res.json({
            success: true,
            total: num(totalRes.rows[0] && totalRes.rows[0].total),
            profiles: rowsRes.rows.map((r) => ({
                username: r.username, role: r.role || 'tracked', pinned: r.pinned === true,
                state: r.is_hidden === true ? 'hidden' : 'visible', posts: num(r.posts), videos: num(r.videos),
            })),
        });
    } catch (err) {
        if (err.code === '42703') return res.status(503).json({ success: false, error: HIDE_MISSING });
        fail(res, 'ADMIN PROJECT PROFILES', err);
    }
});

// POST .../profiles/action
router.post('/users/:userId/projects/:projectId/profiles/action', verifyAdmin, async (req, res) => {
    const { userId, projectId } = req.params;
    if (!UUID.test(userId) || !UUID.test(projectId)) return bad(res, 'Invalid id');
    const body = req.body || {};

    const action = readAction(body, PROFILE_ACTIONS);
    if (!action) return bad(res, 'action must be one of hide, unhide');
    const parsed = readUsernames(body.usernames);
    if (parsed.error) return bad(res, parsed.error);
    if (body.with_posts !== undefined && typeof body.with_posts !== 'boolean') return bad(res, 'with_posts must be true or false');
    const withPosts = body.with_posts === true;
    const dry = readDryRun(body);
    if (!dry.ok) return bad(res, 'dry_run must be true or false');
    const dryRun = dry.value;
    let expectCount = null;
    if (!dryRun) {
        expectCount = readExpectCount(body.expect_count);
        if (expectCount === null) return bad(res, 'expect_count (from the dry run) is required');
        // Optional: the preview's other two numbers, when the caller wants them guarded too.
        for (const key of ['expect_posts', 'expect_videos']) {
            if (body[key] !== undefined && readExpectCount(body[key]) === null) return bad(res, `${key} must be a non-negative integer`);
        }
    }

    const profileSpec = PROFILE_ACTIONS[action];
    const outcome = await withTransaction(res, 'ADMIN PROJECT PROFILES ACTION', async (client) => {
        const project = await findProject(client, userId, projectId);
        if (!project) { notFound(res); return { rollback: true }; }

        let profiles;
        try {
            profiles = (await client.query(
                `SELECT pf.id, pf.username FROM project_profiles pf
                  WHERE pf.project_id = $1 AND lower(pf.username) = ANY($2::text[]) AND ${profileSpec.where}
                  ORDER BY pf.id ${dryRun ? '' : 'FOR UPDATE OF pf'}`,
                [projectId, parsed.keys]
            )).rows;
        } catch (err) {
            if (err.code !== '42703') throw err;
            res.status(503).json({ success: false, error: HIDE_MISSING });
            return { rollback: true };
        }

        let links = [];
        let videos = [];
        if (withPosts) {
            links = (await client.query(
                `SELECT pp.post_shortcode FROM project_posts pp
                   JOIN posts p ON p.shortcode = pp.post_shortcode
                  WHERE pp.project_id = $1 AND ${POST_ACTIONS[action].where} AND lower(p.owner_username) = ANY($2::text[])
                  ORDER BY pp.post_shortcode ${dryRun ? '' : 'FOR UPDATE OF pp'}`,
                [projectId, parsed.keys]
            )).rows.map((r) => r.post_shortcode);
            videos = (await client.query(
                `SELECT v.id, v.keyword_id FROM tiktok_videos v
                   LEFT JOIN tiktok_creators c ON c.id = v.creator_id
                  WHERE v.project_id = $1 AND ${VIDEO_ACTIONS[action].where}
                    AND (lower(c.username) = ANY($2::text[]) OR v.video_id = ANY($3::text[]))
                  ORDER BY v.id ${dryRun ? '' : 'FOR UPDATE OF v'}`,
                [projectId, parsed.keys, links]
            )).rows;
        }
        const counts = { affected: profiles.length, posts_affected: links.length, videos_affected: videos.length };

        if (dryRun) {
            res.json({
                success: true, dry_run: true, action, ...counts, with_posts: withPosts,
                sample: profiles.slice(0, SAMPLE_SIZE).map((p) => p.username),
            });
            return { rollback: true };
        }
        const changed = profiles.length !== expectCount
            || (body.expect_posts !== undefined && links.length !== body.expect_posts)
            || (body.expect_videos !== undefined && videos.length !== body.expect_videos);
        if (changed) {
            res.status(409).json({ success: false, error: 'count changed', ...counts });
            return { rollback: true };
        }
        if (profiles.length > 0) {
            await client.query(
                `UPDATE project_profiles
                    SET is_hidden = $2::boolean, hidden_at = CASE WHEN $2::boolean THEN CURRENT_TIMESTAMP ELSE NULL END
                  WHERE project_id = $1 AND id = ANY($3::uuid[])`,
                [projectId, profileSpec.hidden, profiles.map((p) => p.id)]
            );
        }
        await applyLinks(client, projectId, action, links);
        if (videos.length > 0) {
            await client.query(
                `UPDATE tiktok_videos SET is_hidden = $2::boolean, updated_at = CURRENT_TIMESTAMP
                  WHERE project_id = $1 AND id = ANY($3::uuid[])`,
                [projectId, VIDEO_ACTIONS[action].hidden, videos.map((v) => v.id)]
            );
            await refreshKeywordCounters(client, projectId, [...new Set(videos.map((v) => v.keyword_id))]);
        }
        return { project, profiles, links, counts };
    });
    if (!outcome || outcome.rollback) return;

    const { project, profiles, links, counts } = outcome;
    console.log(`[ADMIN PROJECT PROFILES] ${action} user=${userId} project=${projectId} profiles=${counts.affected} posts=${counts.posts_affected} videos=${counts.videos_affected}`);
    await recordAdminAction(req, {
        action: `project_profiles_${action}`, target_user_id: userId, target_email: project.email,
        detail: {
            project_id: projectId, project_name: project.name, with_posts: withPosts, ...counts,
            usernames: profiles.slice(0, AUDIT_SHORTCODES).map((p) => p.username),
            shortcodes: links.slice(0, AUDIT_SHORTCODES),
        },
    });
    res.json({ success: true, dry_run: false, action, ...counts });
});

module.exports = router;
