/**
 * Admin: read-only "User overview" debug view (Instagram backend).
 *
 * GET /api/admin/users/:id/overview?project_id=<uuid>
 * Shows what a user sees in one project: every number, the formula behind it and the rows
 * that feed it, so a wrong number (for example a stale ig_users.follower_count) can be
 * traced to its source. SELECT only; it never writes. Never returns password hashes,
 * tokens or other secrets (explicit column lists only).
 *
 * The SQL mirrors routes/projects.js (getProjectReachAndStats, /stats, /compare).
 * The TikTok backend has its own copy of this shared contract.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_LIMIT = 200;
const HISTORY_LIMIT = 60;
const SESSION_LIMIT = 30;

// Newest metrics row per post (same order as routes/projects.js and observed.js LATEST_METRICS_ORDER).
const LATEST = (col) =>
    `(SELECT h.${col} FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode ` +
    `ORDER BY h.observed_at DESC NULLS LAST, h.captured_at DESC LIMIT 1)`;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// Runs a query for an optional table/column; a missing one (42P01/42703) yields no rows.
async function optional(sql, params) {
    try {
        return await pool.query(sql, params);
    } catch (err) {
        if (err && (err.code === '42P01' || err.code === '42703')) return { rows: [], missing: true };
        throw err;
    }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

const BROWSER_ONLY = [
    'Positive Sentiment shown in the extension is a hardcoded 78%; the server computes no sentiment.',
    "The extension's own local copy of posts and follower counts (browser storage) can differ from the server until it syncs.",
    'Charts, date-range filters and number formatting (e.g. 12.5K) are computed in the browser from the API responses.',
    'Anything the extension scraped but has not yet uploaded is invisible here.',
];

router.get('/users/:id/overview', verifyAdmin, async (req, res) => {
    const userId = req.params.id;
    const wanted = req.query.project_id;
    if (!UUID.test(userId)) return res.status(404).json({ success: false, error: 'User not found' });
    if (wanted !== undefined && !UUID.test(String(wanted))) {
        return res.status(404).json({ success: false, error: 'Project not found for this user' });
    }

    try {
        // Explicit columns only: never password_hash. Plan dates need migrations/v8_plan_expiry.sql.
        let userRes = await optional(
            `SELECT id, email, status, plan, plan_expires_at, trial_ends_at, max_devices, active_sessions, last_login, last_seen, created_at
             FROM users WHERE id = $1`, [userId]);
        if (userRes.missing) {
            userRes = await pool.query(
                `SELECT id, email, status, plan, max_devices, active_sessions, last_login, created_at
                 FROM users WHERE id = $1`, [userId]);
        }
        if (!userRes.rows.length) return res.status(404).json({ success: false, error: 'User not found' });
        const u = userRes.rows[0];

        const projRes = await pool.query(
            `SELECT pr.id, pr.name, pr.created_at,
                    (SELECT count(*) FROM project_posts pp WHERE pp.project_id = pr.id)::int AS posts,
                    (SELECT count(*) FROM project_profiles pf WHERE pf.project_id = pr.id)::int AS profiles
             FROM projects pr WHERE pr.user_id = $1
             ORDER BY pr.updated_at DESC NULLS LAST, pr.created_at DESC`, [userId]);
        const projects = projRes.rows.map((p) => ({
            id: p.id, name: p.name, created_at: iso(p.created_at), posts: num(p.posts), profiles: num(p.profiles),
        }));

        let selected;
        if (wanted !== undefined) {
            selected = projects.find((p) => p.id.toLowerCase() === String(wanted).toLowerCase());
            if (!selected) return res.status(404).json({ success: false, error: 'Project not found for this user' });
        } else {
            selected = projects.find((p) => Number(p.posts) > 0) || projects[0] || null; // newest project that has posts
        }

        const user = {
            id: u.id, email: u.email, status: u.status, plan: u.plan,
            plan_expires_at: iso(u.plan_expires_at), trial_ends_at: iso(u.trial_ends_at),
            max_devices: u.max_devices, active_sessions: u.active_sessions || 0,
            last_login: iso(u.last_login), created_at: iso(u.created_at),
        };

        const [history, sessions, guard] = await Promise.all([
            loadSaveHistory(userId), loadSessions(userId), loadGuardEvents(userId),
        ]);

        const body = {
            success: true, platform: 'instagram', user, projects,
            selected_project_id: selected ? selected.id : null,
            metrics: [], breakdowns: {}, creators: [], posts: [],
            save_history: history, sessions, warnings: [], browser_only: BROWSER_ONLY,
        };

        if (selected) await fillProject(body, selected.id);
        addUserWarnings(body, u, guard);
        res.json(body);
    } catch (err) {
        console.error('[ADMIN USER OVERVIEW] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

async function loadSaveHistory(userId) {
    const out = [];
    const audit = await optional(
        'SELECT created_at, action, actor, detail FROM admin_audit WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, HISTORY_LIMIT]);
    for (const r of audit.rows) {
        out.push({ at: iso(r.created_at), action: r.action, source: 'admin_audit',
            detail: `by ${r.actor || 'unknown'}: ${JSON.stringify(r.detail || {}).slice(0, 300)}` });
    }
    const saved = await optional(
        'SELECT post_shortcode, scraped_at FROM user_scraped_posts WHERE user_id = $1 ORDER BY scraped_at DESC LIMIT $2',
        [userId, HISTORY_LIMIT]);
    for (const r of saved.rows) {
        out.push({ at: iso(r.scraped_at), action: 'post_saved', source: 'user_scraped_posts', detail: `shortcode ${r.post_shortcode}` });
    }
    // Writes and failures only; successful reads are noise here.
    const events = await optional(
        `SELECT created_at, method, path, status, reason, error FROM api_events
         WHERE user_id = $1 AND (method <> 'GET' OR status >= 400)
         ORDER BY created_at DESC LIMIT $2`, [userId, HISTORY_LIMIT]);
    for (const r of events.rows) {
        out.push({ at: iso(r.created_at), action: `${r.method} ${r.path} -> ${r.status}`, source: 'api_events',
            detail: [r.reason, r.error].filter(Boolean).join(' | ') });
    }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return out.slice(0, HISTORY_LIMIT * 2);
}

// There is no per-device table; recent successful logins from api_events are the closest record.
async function loadSessions(userId) {
    const r = await optional(
        `SELECT created_at, ip, user_agent, ext_version FROM api_events
         WHERE user_id = $1 AND reason = 'success' AND created_at >= now() - interval '7 days'
         ORDER BY created_at DESC LIMIT $2`, [userId, SESSION_LIMIT]);
    return r.rows.map((x) => ({
        at: iso(x.created_at), kind: 'login (api_events, last 7 days)', ip: x.ip,
        user_agent: x.user_agent, ext_version: x.ext_version,
    }));
}

// Platform-guard refusals/skips recorded in api_events (middleware/platformGuard.js).
async function loadGuardEvents(userId) {
    const r = await optional(
        `SELECT created_at, status, reason, error FROM api_events
         WHERE user_id = $1 AND created_at >= now() - interval '30 days'
           AND (reason = 'foreign_posts_skipped' OR error LIKE 'This is the % backend, but none of%' OR error LIKE '%WRONG_PLATFORM%')
         ORDER BY created_at DESC LIMIT 50`, [userId]);
    return r.rows;
}

async function fillProject(body, projectId) {
    const q = (sql) => pool.query(sql, [projectId]);

    const [totalsRes, collabRes, commentsRes, creatorsRes, postsRes] = await Promise.all([
        q(`SELECT count(*) AS posts,
                  COALESCE(sum(m.likes), 0) AS likes, COALESCE(sum(m.comments), 0) AS comments,
                  count(*) FILTER (WHERE NOT m.has_metrics) AS no_metrics
           FROM project_posts ppo
           JOIN posts p ON p.shortcode = ppo.post_shortcode
           CROSS JOIN LATERAL (SELECT
                COALESCE(${LATEST('likes_count')}, 0) AS likes,
                COALESCE(${LATEST('comments_count')}, 0) AS comments,
                EXISTS (SELECT 1 FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode) AS has_metrics) m
           WHERE ppo.project_id = $1`),
        q(`SELECT
              (SELECT COUNT(DISTINCT sub.shortcode) FROM posts sub JOIN project_posts ppo ON sub.shortcode = ppo.post_shortcode
                WHERE ppo.project_id = $1 AND (sub.is_paid = TRUE
                   OR EXISTS (SELECT 1 FROM post_relations pr WHERE pr.post_shortcode = sub.shortcode AND pr.relation_type = 'COAUTHOR'))) AS collab_posts,
              (SELECT COUNT(DISTINCT pr.post_shortcode) FROM post_relations pr JOIN project_posts ppo ON pr.post_shortcode = ppo.post_shortcode
                WHERE ppo.project_id = $1 AND pr.relation_type = 'COAUTHOR') AS collaborations,
              (SELECT COUNT(*) FROM posts p JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                WHERE ppo.project_id = $1 AND p.is_paid = TRUE) AS paid`),
        optional('SELECT COUNT(c.*) AS n FROM comments c JOIN project_posts ppo ON c.post_shortcode = ppo.post_shortcode WHERE ppo.project_id = $1', [projectId]),
        // Same CTEs as getProjectReachAndStats, plus the follower provenance columns.
        q(`WITH project_posts_cte AS (
                SELECT p.shortcode, p.owner_username FROM posts p JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                WHERE ppo.project_id = $1
           ),
           all_partners AS (
                SELECT owner_username AS username, shortcode AS post_shortcode, 'OWNER' AS how FROM project_posts_cte
                UNION
                SELECT pr.username, pr.post_shortcode, pr.relation_type FROM post_relations pr
                JOIN project_posts_cte ppc ON pr.post_shortcode = ppc.shortcode
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
           ),
           partner_stats AS (
                SELECT username, COUNT(DISTINCT post_shortcode) AS posts_involved,
                       COUNT(DISTINCT post_shortcode) FILTER (WHERE how <> 'OWNER') AS adds
                FROM all_partners GROUP BY username
           )
           SELECT ps.username, ps.posts_involved, ps.adds,
                  COALESCE(MAX(iu.follower_count), 0) AS follower_count,
                  COALESCE(MAX(iu.follower_count), 0) * ps.posts_involved AS potential_impressions,
                  MAX(iu.scraped_at) AS scraped_at, MAX(iu.observed_at) AS observed_at,
                  COALESCE(pp.role, 'collaborator') AS role
           FROM partner_stats ps
           LEFT JOIN ig_users iu ON ps.username = iu.username
           LEFT JOIN project_profiles pp ON ps.username = pp.username AND pp.project_id = $1
           GROUP BY ps.username, ps.posts_involved, ps.adds, pp.role
           ORDER BY potential_impressions DESC, ps.username`),
        pool.query(
            `SELECT p.shortcode, p.owner_username, p.posted_at, p.is_paid, p.type, p.collective_reach,
                    ${LATEST('likes_count')} AS likes, ${LATEST('comments_count')} AS comments,
                    ${LATEST('observed_at')} AS metrics_observed_at,
                    EXISTS (SELECT 1 FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode) AS has_metrics,
                    (SELECT COUNT(*) FROM post_relations r WHERE r.post_shortcode = p.shortcode AND r.relation_type = 'COAUTHOR')::int AS coauthors
             FROM project_posts ppo JOIN posts p ON p.shortcode = ppo.post_shortcode
             WHERE ppo.project_id = $1
             ORDER BY p.posted_at DESC NULLS LAST, p.shortcode
             LIMIT ${POST_LIMIT}`, [projectId]),
    ]);

    const t = totalsRes.rows[0] || {};
    const c = collabRes.rows[0] || {};
    const posts = num(t.posts), likes = num(t.likes), comments = num(t.comments), noMetrics = num(t.no_metrics);
    const engagement = likes + comments;
    const avgEpm = posts > 0 ? Math.round((engagement / posts) * 10) / 10 : 0;

    const creators = creatorsRes.rows.map((r) => ({
        username: r.username, role: r.role, follower_count: num(r.follower_count),
        scraped_at: iso(r.scraped_at), observed_at: iso(r.observed_at),
        posts: num(r.posts_involved), adds: num(r.adds),
    }));
    const reach = creators.reduce((s, r) => s + r.follower_count * r.posts, 0);

    body.creators = creators;
    body.posts = postsRes.rows.map((r) => ({
        shortcode: r.shortcode, owner: r.owner_username,
        likes: r.has_metrics ? num(r.likes) : 0, comments: r.has_metrics ? num(r.comments) : 0,
        posted_at: iso(r.posted_at), is_paid: r.is_paid === true, type: r.type,
        collective_reach: num(r.collective_reach),
        has_metrics: !!r.has_metrics, metrics_observed_at: iso(r.metrics_observed_at), coauthors: num(r.coauthors),
    }));
    const trunc = posts > body.posts.length
        ? ` Only the newest ${POST_LIMIT} of ${posts} posts are listed; the total is over all posts.` : '';

    const col = (key, label, numeric = false) => ({ key, label, numeric });
    const metricRows = body.posts.map((p) => ({
        shortcode: p.shortcode, owner: p.owner, likes: p.likes, comments: p.comments,
        engagement: p.likes + p.comments,
        metrics_observed_at: p.has_metrics ? p.metrics_observed_at : 'NO METRICS ROW',
    }));
    const base = [col('shortcode', 'Post'), col('owner', 'Owner')];
    const collabRow = (p) => ({ shortcode: p.shortcode, owner: p.owner, is_paid: p.is_paid ? 'yes' : 'no', coauthors: p.coauthors });
    const collabCols = [...base, col('is_paid', 'Paid'), col('coauthors', 'COAUTHOR relations', true)];
    const B = body.breakdowns;
    B.posts = {
        title: 'Posts in this project', explain: 'Rows of project_posts for this project (newest first).' + trunc,
        columns: [...base, col('posted_at', 'Posted at')],
        rows: body.posts.map((p) => ({ shortcode: p.shortcode, owner: p.owner, posted_at: p.posted_at })),
        total: { shortcode: 'Count (all posts)', posted_at: String(posts) },
    };
    B.total_likes = {
        title: 'Latest likes per post',
        explain: 'Each post contributes the likes_count of its newest post_metrics_history row (observed_at DESC NULLS LAST, captured_at DESC). A post with no row counts 0.' + trunc,
        columns: [...base, col('likes', 'Latest likes', true), col('metrics_observed_at', 'Metrics observed at')],
        rows: metricRows, total: { shortcode: 'Total (all posts)', likes },
    };
    B.total_comments = {
        title: 'Latest comments_count per post',
        explain: 'Each post contributes the comments_count of its newest post_metrics_history row. This is the Instagram-reported count, not the scraped comments table.' + trunc,
        columns: [...base, col('comments', 'Latest comments', true), col('metrics_observed_at', 'Metrics observed at')],
        rows: metricRows, total: { shortcode: 'Total (all posts)', comments },
    };
    B.engagement = {
        title: 'Engagement per post', explain: 'likes + comments of the newest metrics row, per post.' + trunc,
        columns: [...base, col('likes', 'Likes', true), col('comments', 'Comments', true), col('engagement', 'Engagement', true)],
        rows: metricRows, total: { shortcode: 'Total (all posts)', likes, comments, engagement },
    };
    B.avg_epm = {
        title: 'Average engagement per post (EPM)',
        explain: 'Total engagement divided by the number of project posts, rounded to 1 decimal.',
        columns: [col('part', 'Part'), col('value', 'Value', true)],
        rows: [{ part: 'Total engagement (likes + comments)', value: engagement }, { part: 'Posts in project', value: posts }],
        total: { part: 'engagement / posts', value: avgEpm },
    };
    B.potential_impressions = {
        title: 'Potential Impressions per creator',
        explain: 'For every owner, COAUTHOR and CAPTION_USER of a project post: MAX(ig_users.follower_count) x distinct posts they appear on; the total is the sum of the last numeric column. ' +
            'follower_count only changes through IG_USERS_FOLLOWERS_SET (observed.js): a 0 never overwrites; a newer observed_at wins; an unstamped value never beats a stamped one; when both are unstamped the GREATEST of the two is kept. ' +
            'An observed_at of NULL therefore means the number may be an old maximum.',
        columns: [col('username', 'Creator'), col('role', 'Role'), col('follower_count', 'follower_count', true), col('posts', 'Posts', true),
            col('adds', 'Adds (COAUTHOR/CAPTION_USER)', true), col('impressions', 'Followers x posts', true),
            col('scraped_at', 'scraped_at'), col('observed_at', 'observed_at')],
        rows: creators.map((r) => ({ ...r, impressions: r.follower_count * r.posts })),
        total: { username: 'Total', impressions: reach },
    };
    B.collab_posts = {
        title: 'Collab posts', explain: 'Distinct project posts that are paid (posts.is_paid) OR have a COAUTHOR row in post_relations.' + trunc,
        columns: collabCols, rows: body.posts.filter((p) => p.is_paid || p.coauthors > 0).map(collabRow),
        total: { shortcode: 'Count (all posts)', coauthors: num(c.collab_posts) },
    };
    B.collaborations = {
        title: 'Collaborations', explain: 'Distinct project posts with at least one COAUTHOR row in post_relations (paid-only posts are not counted here).' + trunc,
        columns: collabCols, rows: body.posts.filter((p) => p.coauthors > 0).map(collabRow),
        total: { shortcode: 'Count (all posts)', coauthors: num(c.collaborations) },
    };
    B.paid = {
        title: 'Paid partnerships', explain: 'Project posts with posts.is_paid = TRUE.' + trunc,
        columns: collabCols, rows: body.posts.filter((p) => p.is_paid).map(collabRow),
        total: { shortcode: 'Count (all posts)', coauthors: num(c.paid) },
    };

    const commentsMissing = commentsRes.missing ? ' (comments table missing)' : '';
    body.metrics = [
        { key: 'posts', label: 'Posts', value: posts, formula: 'COUNT(project_posts WHERE project_id = selected project)', inputs: ['project_posts.project_id', 'project_posts.post_shortcode'], breakdown: 'posts' },
        { key: 'total_likes', label: 'Total Likes', value: likes, formula: 'SUM over project posts of the latest post_metrics_history.likes_count (ORDER BY observed_at DESC NULLS LAST, captured_at DESC); 0 when no row', inputs: ['post_metrics_history.likes_count', 'post_metrics_history.observed_at', 'post_metrics_history.captured_at'], breakdown: 'total_likes' },
        { key: 'total_comments', label: 'Total Comments', value: comments, formula: 'SUM over project posts of the latest post_metrics_history.comments_count', inputs: ['post_metrics_history.comments_count', 'post_metrics_history.observed_at'], breakdown: 'total_comments' },
        { key: 'engagement', label: 'Total Engagement', value: engagement, formula: 'Total Likes + Total Comments', inputs: ['post_metrics_history.likes_count', 'post_metrics_history.comments_count'], breakdown: 'engagement' },
        { key: 'avg_epm', label: 'Avg EPM', value: avgEpm, formula: 'ROUND(Total Engagement / Posts, 1); 0 when there are no posts', inputs: ['post_metrics_history.likes_count', 'post_metrics_history.comments_count', 'project_posts.post_shortcode'], breakdown: 'avg_epm' },
        { key: 'potential_impressions', label: 'Potential Impressions', value: reach, formula: 'SUM over owner/COAUTHOR/CAPTION_USER of MAX(ig_users.follower_count) x COUNT(DISTINCT posts they appear on in the project)', inputs: ['ig_users.follower_count', 'ig_users.observed_at', 'posts.owner_username', 'post_relations.username', 'post_relations.relation_type'], breakdown: 'potential_impressions' },
        { key: 'collab_posts', label: 'Collab Posts', value: num(c.collab_posts), formula: 'COUNT(DISTINCT project posts WHERE posts.is_paid OR a COAUTHOR relation exists)', inputs: ['posts.is_paid', 'post_relations.relation_type'], breakdown: 'collab_posts' },
        { key: 'collaborations', label: 'Collaborations', value: num(c.collaborations), formula: "COUNT(DISTINCT post_relations.post_shortcode WHERE relation_type = 'COAUTHOR' on project posts)", inputs: ['post_relations.post_shortcode', 'post_relations.relation_type'], breakdown: 'collaborations' },
        { key: 'paid', label: 'Paid', value: num(c.paid), formula: 'COUNT(project posts WHERE posts.is_paid = TRUE)', inputs: ['posts.is_paid'], breakdown: 'paid' },
        { key: 'scraped_comments', label: 'Scraped comments (stats.comments)', value: num((commentsRes.rows[0] || {}).n), formula: "COUNT(comments rows joined to project posts); the scraped comments table, not Instagram's comments_count" + commentsMissing, inputs: ['comments.post_shortcode'], breakdown: null },
    ];

    const w = body.warnings;
    for (const r of creators) {
        if (r.observed_at === null && r.follower_count > 0) {
            w.push({ severity: 'warn', code: 'FOLLOWERS_UNSTAMPED', message: `${r.username}: follower_count ${r.follower_count} has observed_at NULL (never stamped), so it may be a stale maximum.` });
        }
        if (r.follower_count >= 1000 && r.follower_count % 500 === 0) {
            w.push({ severity: 'warn', code: 'FOLLOWERS_ROUND', message: `${r.username}: follower_count ${r.follower_count} is a round number (multiple of 500), which often means an abbreviated value like 12.5K was stored.` });
        }
        if (r.follower_count === 0) {
            w.push({ severity: 'info', code: 'FOLLOWERS_ZERO', message: `${r.username}: no follower_count (0), so it adds nothing to Potential Impressions.` });
        }
    }
    if (noMetrics > 0) {
        w.push({ severity: 'warn', code: 'POSTS_NO_METRICS', message: `${noMetrics} of ${posts} posts have no post_metrics_history row; they count as 0 likes and 0 comments.` });
    }
}

function addUserWarnings(body, u, guardRows) {
    const w = body.warnings;
    const skipped = guardRows.filter((r) => r.reason === 'foreign_posts_skipped');
    const refused = guardRows.filter((r) => r.reason !== 'foreign_posts_skipped');
    if (skipped.length) {
        w.push({ severity: 'warn', code: 'FOREIGN_POSTS_SKIPPED', message: `${skipped.length} save(s) in the last 30 days had posts from another platform skipped (reason foreign_posts_skipped); latest ${iso(skipped[0].created_at)}.` });
    }
    if (refused.length) {
        w.push({ severity: 'bad', code: 'WRONG_PLATFORM', message: `${refused.length} save(s) in the last 30 days were refused as WRONG_PLATFORM (the extension API URL points at the wrong backend); latest ${iso(refused[0].created_at)}.` });
    }
    if (body.sessions.length < (u.active_sessions || 0)) {
        w.push({ severity: 'info', code: 'SESSIONS_EXCEED_LOGINS', message: `active_sessions is ${u.active_sessions} but only ${body.sessions.length} successful login(s) were logged in the last 7 days; the rest may be ghost sessions.` });
    }
    w.push({ severity: 'info', code: 'SENTIMENT_HARDCODED', message: 'Positive Sentiment shown in the extension is hardcoded at 78%; it is not computed from data.' });
    w.push({ severity: 'info', code: 'CAPTION_USER_REACH', message: "The server counts CAPTION_USER relations in Potential Impressions, but the extension's options page does not, so the two totals can differ." });
}

module.exports = router;
