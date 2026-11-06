/**
 * Admin: read-only "User overview" debug view for the TikTok backend.
 *
 * GET /api/admin/users/:id/overview?project_id=<uuid, optional>
 *
 * Shows what a user sees in one project: every number, the formula behind it and the rows that
 * feed it, so a wrong number can be traced to its source. The formulas MIRROR routes/projects.js
 * (/stats, /compare, /top-posts and the keyword summary) on purpose, so every number here equals
 * what the user's app shows. Like the app, all post totals exclude project_posts links that are
 * hidden (is_hidden) or soft-deleted (deleted_at); the posts list keeps them, with a state, so an
 * admin can unhide or restore them (see routes/adminProjectPosts.js).
 *
 * SELECT only. Never selects password hashes, tokens or secrets.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { clean } = require('../utils/adminAudit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTS_SHOWN = 200;
const BREAKDOWN_ROWS = 500;
const HISTORY_ROWS = 200;
const ROUND_FOLLOWERS_LISTED = 10;

const num = (v) => Number(v) || 0;
const iso = (v) => (v ? new Date(v).toISOString() : null);
const isMissing = (err) => err && (err.code === '42P01' || err.code === '42703');

// ---- SQL ---------------------------------------------------------------------------------

const USER_COLS = 'id, email, status, plan, active_sessions, last_login, max_devices, created_at';

// project_posts.is_hidden / deleted_at come from migrations/v6_project_post_hide.sql.
const postsSql = (withHide) => `
    SELECT ppo.post_shortcode AS shortcode, p.shortcode AS post_row, p.owner_username, p.posted_at,
           p.post_url ILIKE '%instagram.com%' AS foreign_url, p.view_count AS post_view_count,
           ${withHide
        ? 'ppo.is_hidden AS pp_hidden, ppo.deleted_at AS pp_deleted_at,'
        : 'false AS pp_hidden, NULL::timestamptz AS pp_deleted_at,'}
           COALESCE(h.likes_count, 0) AS likes, COALESCE(h.comments_count, 0) AS comments,
           COALESCE(h.video_view_count, 0) AS views, COALESCE(h.repost_count, 0) AS reposts,
           COALESCE(h.share_count, 0) AS shares, COALESCE(h.bookmark_count, 0) AS bookmarks
    FROM project_posts ppo
    LEFT JOIN posts p ON p.shortcode = ppo.post_shortcode
    LEFT JOIN LATERAL (
        SELECT likes_count, comments_count, video_view_count, repost_count, share_count, bookmark_count
        FROM post_metrics_history WHERE post_shortcode = ppo.post_shortcode
        ORDER BY captured_at DESC LIMIT 1
    ) h ON true
    WHERE ppo.project_id = $1`;

// Same CTEs as getProjectReachAndStats() in routes/projects.js, plus scraped_at and adds.
// Hidden and soft-deleted project links are excluded, as in the app (skipped only while the
// project_posts hide columns do not exist yet). Profiles hidden for the project
// (project_profiles.is_hidden, migrations/v12_project_profile_hide.sql) are left out too.
const creatorsSql = (excludeHidden, excludeHiddenProfiles) => `
    WITH project_posts_cte AS (
        SELECT p.shortcode, p.owner_username
        FROM posts p
        JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
        WHERE ppo.project_id = $1
        ${excludeHidden ? 'AND ppo.is_hidden = false AND ppo.deleted_at IS NULL' : ''}
    ),
    all_partners AS (
        SELECT owner_username AS username, shortcode AS post_shortcode FROM project_posts_cte
        UNION
        SELECT pr.username, pr.post_shortcode
        FROM post_relations pr
        JOIN project_posts_cte ppc ON pr.post_shortcode = ppc.shortcode
        WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
    ),
    partner_stats AS (
        SELECT ap.username, COUNT(DISTINCT ap.post_shortcode) AS posts_involved
        FROM all_partners ap
        ${excludeHiddenProfiles ? `WHERE NOT EXISTS (SELECT 1 FROM project_profiles hp
                           WHERE hp.project_id = $1 AND hp.username = ap.username AND hp.is_hidden = true)` : ''}
        GROUP BY ap.username
    )
    SELECT ps.username, ps.posts_involved,
           COALESCE(MAX(iu.follower_count), 0) AS follower_count,
           MAX(iu.scraped_at) AS scraped_at,
           COALESCE(pp.role, 'collaborator') AS role,
           (SELECT COUNT(*) FROM project_posts ppo2 JOIN posts p2 ON p2.shortcode = ppo2.post_shortcode
             WHERE ppo2.project_id = $1 AND p2.owner_username = ps.username
               ${excludeHidden ? 'AND ppo2.is_hidden = false AND ppo2.deleted_at IS NULL' : ''}) AS adds
    FROM partner_stats ps
    LEFT JOIN ig_users iu ON ps.username = iu.username
    LEFT JOIN project_profiles pp ON ps.username = pp.username AND pp.project_id = $1
    GROUP BY ps.username, ps.posts_involved, pp.role
    ORDER BY COALESCE(MAX(iu.follower_count), 0) * ps.posts_involved DESC`;

// Exactly getProjectKeywordSummary() in routes/projects.js (potential_reach skips hidden videos).
const KEYWORD_SUMMARY_SQL = `
    SELECT COUNT(*) AS total_keywords,
           COALESCE(SUM(total_videos), 0) AS total_videos,
           COALESCE(SUM(total_creators), 0) AS total_creators,
           COALESCE(SUM(total_views), 0) AS total_views,
           COALESCE(SUM(total_engagement), 0) AS total_engagement,
           COUNT(*) FILTER (WHERE status = 'active') AS active_keywords,
           (SELECT COALESCE(SUM(views_count), 0) FROM tiktok_videos
             WHERE project_id = $1 AND included_in_reach = true
               AND (is_hidden = false OR is_hidden IS NULL)) AS potential_reach
    FROM search_keywords WHERE project_id = $1`;

const KEYWORD_ROWS_SQL = `
    SELECT COALESCE(sk.keyword, '(no keyword)') AS keyword,
           COUNT(*) FILTER (WHERE tv.is_hidden = false OR tv.is_hidden IS NULL) AS videos,
           COALESCE(SUM(tv.views_count) FILTER (WHERE tv.is_hidden = false OR tv.is_hidden IS NULL), 0) AS views,
           COUNT(*) FILTER (WHERE tv.included_in_reach AND (tv.is_hidden = false OR tv.is_hidden IS NULL)) AS reach_videos,
           COALESCE(SUM(tv.views_count) FILTER (WHERE tv.included_in_reach AND (tv.is_hidden = false OR tv.is_hidden IS NULL)), 0) AS reach_views,
           COUNT(*) FILTER (WHERE tv.is_hidden = true) AS hidden_videos
    FROM tiktok_videos tv
    LEFT JOIN search_keywords sk ON sk.id = tv.keyword_id
    WHERE tv.project_id = $1
    GROUP BY sk.keyword
    ORDER BY reach_views DESC`;

// Same query for the project list, with and without the profile hide column (migration v12).
const projectsSql = (profileHide) => `
    SELECT pr.id, pr.name, pr.created_at,
           (SELECT count(*) FROM project_posts pp WHERE pp.project_id = pr.id AND pp.is_hidden = false AND pp.deleted_at IS NULL)::int AS posts,
           (SELECT count(*) FROM project_profiles pf WHERE pf.project_id = pr.id${profileHide ? ' AND pf.is_hidden = false' : ''})::int AS profiles
    FROM projects pr
    WHERE pr.user_id = $1
    ORDER BY pr.updated_at DESC NULLS LAST, pr.created_at DESC`;

const commentRowsSql = (excludeHidden) => `
    SELECT ppo.post_shortcode AS shortcode, COUNT(c.id) AS stored
    FROM comments c
    JOIN project_posts ppo ON c.post_shortcode = ppo.post_shortcode
    WHERE ppo.project_id = $1
    ${excludeHidden ? 'AND ppo.is_hidden = false AND ppo.deleted_at IS NULL' : ''}
    GROUP BY ppo.post_shortcode
    ORDER BY stored DESC`;

// ---- helpers -----------------------------------------------------------------------------

function stateOf(r) {
    const parts = [];
    if (r.hidden) parts.push('hidden');
    if (r.deleted) parts.push('deleted');
    return parts.length ? parts.join(' + ') : 'ok';
}

function normalizePost(r) {
    return {
        shortcode: r.shortcode,
        owner: r.owner_username || null,
        posted_at: iso(r.posted_at),
        likes: num(r.likes), comments: num(r.comments), views: num(r.views),
        reposts: num(r.reposts), shares: num(r.shares), bookmarks: num(r.bookmarks),
        post_view_count: num(r.post_view_count),
        hidden: r.pp_hidden === true,
        deleted: !!r.pp_deleted_at,
        deleted_at: iso(r.pp_deleted_at),
        orphan: !r.post_row,
        foreign_url: r.foreign_url === true,
    };
}

const isExcluded = (p) => p.hidden || p.deleted;
const postState = (p) => (p.deleted ? 'deleted' : p.hidden ? 'hidden' : 'visible');
const sum = (rows, f) => rows.reduce((s, r) => s + (typeof f === 'function' ? f(r) : r[f]), 0);

// Breakdown with one row per post for a single counter column.
function perPostBreakdown(title, explain, field, label, posts) {
    const sorted = [...posts].sort((a, b) => b[field] - a[field]);
    return {
        title,
        explain: sorted.length > BREAKDOWN_ROWS
            ? `${explain} Showing the ${BREAKDOWN_ROWS} largest of ${sorted.length} rows; the total covers all rows.`
            : explain,
        columns: [
            { key: 'shortcode', label: 'Post', numeric: false },
            { key: 'owner', label: 'Owner', numeric: false },
            { key: field, label, numeric: true },
            { key: 'state', label: 'State', numeric: false },
        ],
        rows: sorted.slice(0, BREAKDOWN_ROWS).map((p) => ({
            shortcode: p.shortcode, owner: p.owner, [field]: p[field], state: stateOf(p),
        })),
        total: { shortcode: `Total (${posts.length} posts)`, owner: null, [field]: sum(posts, field), state: null },
    };
}

// ---- route -------------------------------------------------------------------------------

router.get('/users/:id/overview', verifyAdmin, async (req, res) => {
    const userId = req.params.id;
    const notFound = (error) => res.status(404).json({ success: false, error });
    if (!UUID.test(userId)) return notFound('User not found');

    try {
        const warnings = [];
        const warn = (severity, code, message) => warnings.push({ severity, code, message });

        // ---- user -------------------------------------------------------------------
        let userRow;
        try {
            const r = await pool.query(
                `SELECT ${USER_COLS}, plan_expires_at, trial_ends_at FROM users WHERE id = $1`, [userId]);
            userRow = r.rows[0];
        } catch (err) {
            if (err.code !== '42703') throw err; // migrations/v8_plan_expiry.sql not applied
            const r = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [userId]);
            userRow = r.rows[0];
            warn('info', 'plan_columns_missing', 'users.plan_expires_at / trial_ends_at do not exist yet (apply migrations/v8_plan_expiry.sql).');
        }
        if (!userRow) return notFound('User not found');

        // ---- projects ---------------------------------------------------------------
        let profileHide = true;
        let projectsResult;
        try {
            projectsResult = await pool.query(projectsSql(true), [userId]);
        } catch (err) {
            if (err.code !== '42703') throw err;
            profileHide = false; // migrations/v12_project_profile_hide.sql not applied
            projectsResult = await pool.query(projectsSql(false), [userId]);
            warn('warn', 'profile_hide_missing',
                'project_profiles.is_hidden does not exist (apply migrations/v12_project_profile_hide.sql): no profile can be hidden yet.');
        }
        const projects = projectsResult.rows.map((p) => ({
            id: p.id, name: p.name, created_at: iso(p.created_at), posts: num(p.posts), profiles: num(p.profiles),
        }));

        let selected = null;
        if (req.query.project_id !== undefined && req.query.project_id !== '') {
            const wanted = String(req.query.project_id);
            selected = UUID.test(wanted) ? projects.find((p) => p.id.toLowerCase() === wanted.toLowerCase()) : null;
            if (!selected) return notFound('Project not found for this user');
        } else {
            selected = projects.find((p) => Number(p.posts) > 0) || projects[0] || null; // newest project that has posts
        }

        const user = {
            id: userRow.id,
            email: userRow.email,
            status: userRow.status,
            plan: userRow.plan,
            plan_expires_at: iso(userRow.plan_expires_at),
            trial_ends_at: iso(userRow.trial_ends_at),
            max_devices: userRow.max_devices,
            active_sessions: num(userRow.active_sessions),
            last_login: iso(userRow.last_login),
            created_at: iso(userRow.created_at),
        };

        const body = {
            success: true, platform: 'tiktok', user, projects,
            selected_project_id: selected ? selected.id : null,
            metrics: [], breakdowns: {}, creators: [], posts: [],
            save_history: [], sessions: [], warnings, browser_only: [
                'Which project is open in the extension/dashboard (kept in the browser).',
                'The date range and creator filters on the dashboard; the server numbers here are unfiltered.',
                'Number formatting and rounding on screen (for example 1.2M); the exact values are shown here.',
                'Any list the dashboard sorts, limits or caches locally (including offline copies of saved posts).',
                'Per-profile "Avg EPM" shown per creator in the dashboard: the browser derives it from /compare results.',
            ],
        };

        if (user.status && user.status !== 'active') warn('warn', 'user_not_active', `User status is "${user.status}".`);
        const now = Date.now();
        if (user.plan_expires_at && new Date(user.plan_expires_at).getTime() < now && user.plan !== 'none') {
            warn('warn', 'plan_expired', `Plan "${user.plan}" expired on ${user.plan_expires_at.slice(0, 10)}.`);
        }
        if (user.trial_ends_at && new Date(user.trial_ends_at).getTime() < now && user.plan === 'none') {
            warn('info', 'trial_ended', `Trial ended on ${user.trial_ends_at.slice(0, 10)}.`);
        }

        // ---- activity sources (not project specific) ---------------------------------
        const sources = [];
        const optional = async (name, fn) => {
            try { return await fn(); } catch (err) {
                if (!isMissing(err)) throw err;
                warn('info', 'source_missing', `${name} is not available in this database (${err.code}).`);
                return null;
            }
        };

        const [auditRes, eventsRes, savedRes, guardRes, loginsRes] = await Promise.all([
            optional('admin_audit', () => pool.query(
                `SELECT created_at, actor, action, detail FROM admin_audit
                 WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId])),
            optional('api_events', () => pool.query(
                `SELECT created_at, method, path, status, reason, error FROM api_events
                 WHERE (user_id = $1 OR lower(email) = lower($2))
                   AND (method NOT IN ('GET', 'HEAD') OR status >= 400 OR reason IS NOT NULL)
                 ORDER BY created_at DESC LIMIT 100`, [userId, user.email])),
            optional('user_scraped_posts', () => pool.query(
                `SELECT scraped_at, post_shortcode FROM user_scraped_posts
                 WHERE user_id = $1 ORDER BY scraped_at DESC LIMIT 50`, [userId])),
            optional('api_events (platform guard)', () => pool.query(
                `SELECT count(*) FILTER (WHERE reason = 'foreign_posts_skipped') AS skipped,
                        count(*) FILTER (WHERE status = 400 AND error ILIKE '%Check the API URL in the extension settings%') AS refused,
                        max(created_at) FILTER (WHERE reason = 'foreign_posts_skipped'
                            OR (status = 400 AND error ILIKE '%Check the API URL in the extension settings%')) AS last_at
                 FROM api_events WHERE (user_id = $1 OR lower(email) = lower($2))`, [userId, user.email])),
            optional('api_events (logins)', () => pool.query(
                `SELECT created_at, ip, user_agent, ext_version FROM api_events
                 WHERE reason = 'success' AND created_at >= now() - interval '7 days'
                   AND (user_id = $1 OR lower(email) = lower($2))
                 ORDER BY created_at DESC LIMIT 50`, [userId, user.email])),
        ]);

        const history = [];
        if (auditRes) {
            sources.push('admin_audit');
            for (const r of auditRes.rows) {
                history.push({ at: iso(r.created_at), action: r.action, source: 'admin_audit',
                    detail: `by ${r.actor}: ${JSON.stringify(clean(r.detail || {}))}`.slice(0, 500) });
            }
        }
        if (eventsRes) {
            sources.push('api_events (writes, failures and flagged calls)');
            for (const r of eventsRes.rows) {
                const note = [r.reason, r.error].filter(Boolean).join(' - ');
                history.push({ at: iso(r.created_at), action: `${r.method} ${r.path} -> ${r.status}`, source: 'api_events',
                    detail: String(clean(note) || '') });
            }
        }
        if (savedRes) {
            sources.push('user_scraped_posts (saved posts)');
            for (const r of savedRes.rows) {
                history.push({ at: iso(r.scraped_at), action: 'post_saved', source: 'user_scraped_posts', detail: r.post_shortcode });
            }
        }
        body.save_history = history.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, HISTORY_ROWS);
        warn('info', 'save_history_sources',
            `Save history merges: ${sources.length ? sources.join('; ') : 'no source available'}. A save that succeeded and was not flagged is only visible as a saved post.`);

        if (guardRes && guardRes.rows[0]) {
            const skipped = num(guardRes.rows[0].skipped);
            const refused = num(guardRes.rows[0].refused);
            if (skipped > 0) {
                warn('warn', 'foreign_posts_skipped',
                    `Platform guard skipped other-platform posts in ${skipped} save(s) (reason foreign_posts_skipped); last event ${iso(guardRes.rows[0].last_at)}. The extension is sending Instagram posts to the TikTok backend.`);
            }
            if (refused > 0) {
                warn('warn', 'WRONG_PLATFORM',
                    `Platform guard refused ${refused} batch(es) with nothing from tiktok.com (code WRONG_PLATFORM); the API URL in the extension is probably wrong.`);
            }
        }

        if (loginsRes) {
            body.sessions = loginsRes.rows.map((r) => ({
                at: iso(r.created_at), ip: r.ip || null, user_agent: r.user_agent || null, ext_version: r.ext_version || null,
                source: 'api_events: successful logins in the last 7 days (no sessions table exists; JWTs last 7 days)',
            }));
            if (user.active_sessions > loginsRes.rows.length) {
                warn('warn', 'ghost_sessions',
                    `users.active_sessions is ${user.active_sessions} but only ${loginsRes.rows.length} login(s) in the last 7 days were logged; the counter drifts up when users never log out.`);
            }
        }

        if (!selected) {
            warn('info', 'no_projects', 'This user has no projects.');
            return res.json(body);
        }

        // ---- project data -------------------------------------------------------------
        let hideColumns = true;
        let postsResult;
        try {
            postsResult = await pool.query(postsSql(true), [selected.id]);
        } catch (err) {
            if (err.code !== '42703') throw err;
            hideColumns = false;
            postsResult = await pool.query(postsSql(false), [selected.id]);
            warn('warn', 'hide_columns_missing',
                'project_posts.is_hidden / deleted_at or posts.deleted_at do not exist (apply migrations/v6_project_post_hide.sql): no post can be hidden or deleted here.');
        }
        const listedPosts = postsResult.rows.map(normalizePost); // every link, for the posts tab
        const excluded = listedPosts.filter(isExcluded);
        const allPosts = listedPosts.filter((p) => !isExcluded(p)); // what every total below counts

        const [creatorsRes, kwSummaryRes, kwRowsRes, commentRowsRes] = await Promise.all([
            pool.query(creatorsSql(hideColumns, profileHide), [selected.id]),
            optional('search_keywords / tiktok_videos', () => pool.query(KEYWORD_SUMMARY_SQL, [selected.id])),
            optional('tiktok_videos', () => pool.query(KEYWORD_ROWS_SQL, [selected.id])),
            optional('comments', () => pool.query(commentRowsSql(hideColumns), [selected.id])),
        ]);

        // ---- posts tab ----------------------------------------------------------------
        body.posts = [...listedPosts]
            .sort((a, b) => (b.posted_at ? 1 : 0) - (a.posted_at ? 1 : 0) || String(b.posted_at).localeCompare(String(a.posted_at)))
            .slice(0, POSTS_SHOWN)
            .map((p) => ({
                shortcode: p.shortcode, owner: p.owner, likes: p.likes, comments: p.comments, views: p.views,
                posted_at: p.posted_at, is_hidden: p.hidden, deleted_at: p.deleted_at, state: postState(p),
            }));

        // ---- creators -----------------------------------------------------------------
        const creators = creatorsRes.rows.map((r) => ({
            username: r.username, role: r.role, follower_count: num(r.follower_count),
            scraped_at: iso(r.scraped_at),
            observed_at: null, // the TikTok schema has no per-creator "observed" timestamp (only ig_users.scraped_at)
            posts: num(r.posts_involved), adds: num(r.adds),
        }));
        body.creators = creators;
        const reach = sum(creators, (c) => c.follower_count * c.posts);

        // ---- metrics ------------------------------------------------------------------
        const B = body.breakdowns;
        const HIDE_NOTE = ' Hidden and soft-deleted project links (is_hidden / deleted_at) are excluded, as in the app.';
        if (excluded.length > 0) {
            warn('info', 'hidden_excluded', `${excluded.length} hidden/deleted posts are excluded from the totals (the user's app excludes them too).`);
        }
        const N = allPosts.length;
        const likes = sum(allPosts, 'likes');
        const comments = sum(allPosts, 'comments');
        const engagement = likes + comments;
        const avgEpm = N > 0 ? Math.round((engagement / N) * 10) / 10 : 0;
        const LATEST = 'the latest post_metrics_history row per post (ORDER BY captured_at DESC LIMIT 1)';

        const metric = (key, label, value, formula, inputs, breakdown, extra = {}) =>
            body.metrics.push({ key, label, value, formula, inputs, breakdown, ...extra });

        const counterMetric = (key, label, field, histColumn, breakdownKey, note) => {
            const value = sum(allPosts, field);
            B[breakdownKey] = perPostBreakdown(label, `Per post: ${histColumn} of ${LATEST}, as /compare and /top-posts read it.${HIDE_NOTE}${note || ''}`, field, label, allPosts);
            metric(key, label, value,
                `SUM(post_metrics_history.${histColumn}) over every project_posts row of the project, latest history row per post`,
                [`post_metrics_history.${histColumn}`, 'post_metrics_history.captured_at', 'project_posts.post_shortcode'],
                breakdownKey);
        };

        // Posts
        B.posts = {
            title: 'Posts',
            explain: `stats.posts = COUNT(*) FROM project_posts WHERE project_id = this project AND is_hidden = false AND deleted_at IS NULL (the same number admin post_count and the app's posts listing show).`,
            columns: [
                { key: 'shortcode', label: 'Post', numeric: false }, { key: 'owner', label: 'Owner', numeric: false },
                { key: 'posted_at', label: 'Posted', numeric: false }, { key: 'state', label: 'State', numeric: false },
            ],
            rows: allPosts.slice(0, BREAKDOWN_ROWS).map((p) => ({ shortcode: p.shortcode, owner: p.owner, posted_at: p.posted_at, state: stateOf(p) })),
            total: { shortcode: `Total (${N} posts)`, owner: null, posted_at: null, state: null },
        };
        metric('posts', 'Posts', N, 'COUNT(*) FROM project_posts WHERE project_id = :project AND is_hidden = false AND deleted_at IS NULL (as /stats and admin post_count)',
            ['project_posts.project_id', 'project_posts.post_shortcode', 'project_posts.is_hidden', 'project_posts.deleted_at'], 'posts');

        counterMetric('likes', 'Likes', 'likes', 'likes_count', 'likes');
        counterMetric('comments', 'Comments', 'comments', 'comments_count', 'comments');
        counterMetric('views', 'Views', 'views', 'video_view_count', 'views',
            ' posts.view_count is a separate sticky (GREATEST) counter that the dashboard routes do not read.');
        counterMetric('shares', 'Shares', 'shares', 'share_count', 'shares');
        counterMetric('reposts', 'Reposts', 'reposts', 'repost_count', 'reposts');
        counterMetric('bookmarks', 'Bookmarks', 'bookmarks', 'bookmark_count', 'bookmarks');

        const viewsHist = sum(allPosts, 'views');
        const viewsPosts = sum(allPosts, 'post_view_count');
        if (viewsHist === 0 && viewsPosts > 0) {
            warn('warn', 'views_source_mismatch',
                `post_metrics_history.video_view_count sums to 0 but posts.view_count sums to ${viewsPosts}: Views shows 0 because the app reads the history column.`);
        }

        // Engagement and Avg EPM
        B.engagement = {
            title: 'Total Engagement',
            explain: `Per post: likes + comments from ${LATEST}.${HIDE_NOTE}`,
            columns: [
                { key: 'shortcode', label: 'Post', numeric: false }, { key: 'owner', label: 'Owner', numeric: false },
                { key: 'likes', label: 'Likes', numeric: true }, { key: 'comments', label: 'Comments', numeric: true },
                { key: 'engagement', label: 'Engagement', numeric: true }, { key: 'state', label: 'State', numeric: false },
            ],
            rows: [...allPosts].sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments)).slice(0, BREAKDOWN_ROWS)
                .map((p) => ({ shortcode: p.shortcode, owner: p.owner, likes: p.likes, comments: p.comments, engagement: p.likes + p.comments, state: stateOf(p) })),
            total: { shortcode: `Total (${N} posts)`, owner: null, likes, comments, engagement, state: null },
        };
        metric('engagement', 'Total Engagement', engagement, 'SUM(likes) + SUM(comments) (as /compare total_engagement)',
            ['post_metrics_history.likes_count', 'post_metrics_history.comments_count'], 'engagement');

        B.epm = {
            title: 'Avg EPM',
            explain: 'The server computes avg_engagement = ROUND((SUM(likes) + SUM(comments)) / COUNT(DISTINCT posts), 1) (/compare). The dashboard labels it EPM (engagement per post).',
            columns: [{ key: 'part', label: 'Part', numeric: false }, { key: 'value', label: 'Value', numeric: true }],
            rows: [{ part: 'Total Engagement', value: engagement }, { part: 'Posts', value: N }],
            total: { part: 'Avg EPM = Total Engagement / Posts', value: avgEpm },
        };
        metric('avg_epm', 'Avg EPM', avgEpm, 'ROUND((SUM(likes) + SUM(comments)) / COUNT(DISTINCT shortcode), 1), 0 when there are no posts',
            ['post_metrics_history.likes_count', 'post_metrics_history.comments_count', 'project_posts.post_shortcode'], 'epm');

        // Potential Impressions (reach by creator)
        B.reach = {
            title: 'Potential Impressions (reach)',
            explain: `For every creator (post owner, COAUTHOR or CAPTION_USER of a project post): follower_count x posts they appear in; reach is the sum. follower_count comes from ig_users (TikTok profiles live in the table named ig_users; tiktok_users is a view of it). It is sticky: upserts in routes/posts.js (upsertIgUser) and routes/users.js use follower_count = GREATEST(ig_users.follower_count, EXCLUDED.follower_count), so it never goes down, even if the creator really lost followers or a bad capture was too high.${HIDE_NOTE}`,
            columns: [
                { key: 'username', label: 'Creator', numeric: false }, { key: 'role', label: 'Role', numeric: false },
                { key: 'follower_count', label: 'Followers', numeric: true }, { key: 'posts', label: 'Posts', numeric: true },
                { key: 'impressions', label: 'Followers x posts', numeric: true },
                { key: 'adds', label: 'Adds', numeric: true }, { key: 'scraped_at', label: 'Last seen', numeric: false },
            ],
            rows: creators.slice(0, BREAKDOWN_ROWS).map((c) => ({
                username: c.username, role: c.role, follower_count: c.follower_count, posts: c.posts,
                impressions: c.follower_count * c.posts, adds: c.adds, scraped_at: c.scraped_at,
            })),
            total: { username: `Total (${creators.length} creators)`, role: null, follower_count: null, posts: null, impressions: reach, adds: null, scraped_at: null },
        };
        metric('potential_impressions', 'Potential Impressions', reach,
            'SUM over creators of ig_users.follower_count x COUNT(DISTINCT project posts they own, co-author or are caption_user on) (as /stats reach)',
            ['ig_users.follower_count', 'posts.owner_username', 'post_relations.username', 'post_relations.relation_type', 'project_posts.post_shortcode'],
            'reach');

        // Comments stored
        if (commentRowsRes) {
            const stored = sum(commentRowsRes.rows, (r) => num(r.stored));
            B.comment_rows = {
                title: 'Comments stored',
                explain: 'Rows of the comments table linked to the project posts (stats.comments). This is the scraped comment text, not the post counter above.',
                columns: [{ key: 'shortcode', label: 'Post', numeric: false }, { key: 'stored', label: 'Stored comments', numeric: true }],
                rows: commentRowsRes.rows.slice(0, BREAKDOWN_ROWS).map((r) => ({ shortcode: r.shortcode, stored: num(r.stored) })),
                total: { shortcode: 'Total', stored },
            };
            metric('comments_stored', 'Comments stored', stored,
                'COUNT(comments.*) joined to project_posts on post_shortcode (as /stats comments)',
                ['comments.post_shortcode', 'project_posts.post_shortcode'], 'comment_rows');
        }

        // Keyword (tiktok_videos) side. Hidden videos (tiktok_videos.is_hidden) are excluded from
        // reach, as in the app (getProjectKeywordSummary and the keyword list both skip them).
        if (kwSummaryRes && kwSummaryRes.rows[0]) {
            const s = kwSummaryRes.rows[0];
            const kwRows = kwRowsRes ? kwRowsRes.rows : [];
            const liveVideos = sum(kwRows, (r) => num(r.videos));
            const liveViews = sum(kwRows, (r) => num(r.views));
            const hiddenKwVideos = sum(kwRows, (r) => num(r.hidden_videos));
            B.keyword_reach = {
                title: 'Keywords (visible videos)',
                explain: 'Per keyword, over the tiktok_videos of the project that are NOT hidden (is_hidden). Reach = SUM(views_count) WHERE included_in_reach = true, as getProjectKeywordSummary does. Hide or unhide videos in the Videos tab.',
                columns: [
                    { key: 'keyword', label: 'Keyword', numeric: false }, { key: 'videos', label: 'Videos (visible)', numeric: true },
                    { key: 'views', label: 'Views', numeric: true },
                    { key: 'reach_videos', label: 'Included in reach', numeric: true }, { key: 'reach_views', label: 'Reach views', numeric: true },
                    { key: 'hidden_videos', label: 'Hidden', numeric: true },
                ],
                rows: kwRows.slice(0, BREAKDOWN_ROWS).map((r) => ({
                    keyword: r.keyword, videos: num(r.videos), views: num(r.views), reach_videos: num(r.reach_videos),
                    reach_views: num(r.reach_views), hidden_videos: num(r.hidden_videos),
                })),
                total: { keyword: 'Total', videos: liveVideos, views: liveViews, reach_videos: sum(kwRows, (r) => num(r.reach_videos)), reach_views: sum(kwRows, (r) => num(r.reach_views)), hidden_videos: hiddenKwVideos },
            };
            metric('keyword_videos_live', 'Keyword videos (visible)', liveVideos,
                'COUNT(*) FROM tiktok_videos WHERE project_id = :project AND is_hidden is not true (live count)',
                ['tiktok_videos.project_id', 'tiktok_videos.is_hidden'], 'keyword_reach');
            metric('keyword_views_live', 'Keyword views', liveViews,
                'SUM(tiktok_videos.views_count) WHERE project_id = :project AND is_hidden is not true',
                ['tiktok_videos.views_count', 'tiktok_videos.is_hidden'], 'keyword_reach');
            metric('keyword_potential_reach', 'Keyword potential reach (visible, included_in_reach)', num(s.potential_reach),
                'SUM(tiktok_videos.views_count) WHERE project_id = :project AND included_in_reach = true AND is_hidden is not true (as getProjectKeywordSummary)',
                ['tiktok_videos.views_count', 'tiktok_videos.included_in_reach', 'tiktok_videos.is_hidden'], 'keyword_reach');
            metric('keyword_videos', 'Keyword videos (stored counter)', num(s.total_videos),
                'SUM(search_keywords.total_videos) (a stored counter per keyword, not a live count; refreshed when a video is hidden)',
                ['search_keywords.total_videos'], 'keyword_reach');
            metric('keyword_views', 'Keyword views (stored counter)', num(s.total_views),
                'SUM(search_keywords.total_views) (a stored counter per keyword)', ['search_keywords.total_views'], 'keyword_reach');
            if (hiddenKwVideos > 0) {
                warn('info', 'hidden_keyword_videos', `${hiddenKwVideos} hidden keyword video(s) are excluded from the keyword totals (the user's app excludes them too).`);
            }
            if (kwRowsRes && liveVideos !== num(s.total_videos)) {
                warn('warn', 'keyword_counter_drift',
                    `search_keywords.total_videos sums to ${num(s.total_videos)} but the project has ${liveVideos} visible keyword video(s).`);
            }
        }

        // ---- warnings that are not tied to one metric ---------------------------------
        const orphans = allPosts.filter((p) => p.orphan);
        if (orphans.length > 0) {
            warn('warn', 'orphan_project_posts', `${orphans.length} project_posts row(s) point at a post that no longer exists (they still count in Posts, with 0 metrics).`);
        }
        const foreign = listedPosts.filter((p) => p.foreign_url);
        if (foreign.length > 0) {
            warn('bad', 'instagram_posts_in_tiktok_db',
                `${foreign.length} post(s) of this project have an instagram.com post_url: Instagram data reached the TikTok database (first: ${foreign.slice(0, 3).map((p) => p.shortcode).join(', ')}).`);
        }
        const round = creators.filter((c) => c.follower_count >= 1000 && c.follower_count % 500 === 0);
        if (round.length > 0) {
            warn('warn', 'round_follower_counts',
                `${round.length} creator(s) have a round follower_count (multiple of 500, >= 1000), which usually means a rounded on-screen value was saved: ${round.slice(0, ROUND_FOLLOWERS_LISTED).map((c) => `${c.username} (${c.follower_count})`).join(', ')}${round.length > ROUND_FOLLOWERS_LISTED ? ', ...' : ''}. Because follower_count only goes up (GREATEST), a too-high value stays.`);
        }
        if (creators.length > 0) {
            warn('info', 'follower_count_sticky',
                'ig_users.follower_count is updated with GREATEST(old, new) (routes/posts.js upsertIgUser and routes/users.js), so it never decreases. Potential Impressions inherits that.');
        }
        warn('info', 'ig_users_is_tiktok_table',
            'In this TikTok database the table named ig_users holds TikTok creators (tiktok_users is a view over it); the name is historical, not contamination. Real Instagram data is flagged only when a post has an instagram.com post_url.');

        return res.json(body);
    } catch (err) {
        console.error('[ADMIN USER OVERVIEW] Error:', err.message);
        logServerError(res, err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
