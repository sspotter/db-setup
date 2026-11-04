/**
 * Admin: product usage per user. Identical in the TikTok and Instagram backends
 * except PLATFORM_EXTRAS (TikTok has videos/keywords/comments tables).
 * GET /api/admin/usage?days=30
 *
 * - Activity counts (sessions, jobs, api calls, comments) cover the last `days`.
 * - Totals (saved posts, projects, extras) are all-time.
 * - storage_basis is "row_counts": rows per user, not bytes.
 * - A job is "stuck" when it has been 'running' for longer than USAGE_STUCK_MINUTES
 *   (default 30), regardless of the window. 'pending' is not counted: a queued job
 *   of an idle session is normal.
 * - usage_score = jobs_total + api_calls; top_users ranks by it.
 * Every query is one GROUP BY over a user-owning column (no per-user queries).
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');

// Platform-specific all-time per-user row counts: each query returns (user_id, n).
const PLATFORM_EXTRAS = [
    { key: 'videos', sql: `SELECT p.user_id, count(*)::int AS n FROM tiktok_videos v JOIN projects p ON p.id = v.project_id GROUP BY p.user_id` },
    { key: 'keywords', sql: `SELECT p.user_id, count(*)::int AS n FROM search_keywords k JOIN projects p ON p.id = k.project_id GROUP BY p.user_id` },
    { key: 'tiktok_comments', sql: `SELECT p.user_id, count(*)::int AS n FROM tiktok_comments c JOIN search_keywords k ON k.id = c.keyword_id JOIN projects p ON p.id = k.project_id GROUP BY p.user_id` },
];

const WINDOW = (col) => `${col} >= now() - make_interval(days => $1)`;

router.get('/usage', verifyAdmin, async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const stuckMinutes = parseInt(process.env.USAGE_STUCK_MINUTES, 10) || 30;
    try {
        const [users, sessions, jobs, stuck, logs, saved, projects, failedJobs, ...extras] = await Promise.all([
            pool.query(`SELECT id, email, plan, status, last_login, created_at FROM users`),
            pool.query(`SELECT user_id, count(*)::int AS n FROM scrape_sessions WHERE ${WINDOW('created_at')} GROUP BY user_id`, [days]),
            pool.query(
                `SELECT s.user_id, count(*)::int AS total, (count(*) FILTER (WHERE j.status = 'failed'))::int AS failed
                 FROM scrape_jobs j JOIN scrape_sessions s ON s.id = j.session_id
                 WHERE ${WINDOW('j.created_at')} GROUP BY s.user_id`,
                [days]
            ),
            pool.query(
                `SELECT s.user_id, count(*)::int AS n
                 FROM scrape_jobs j JOIN scrape_sessions s ON s.id = j.session_id
                 WHERE j.status = 'running' AND coalesce(j.started_at, j.created_at) < now() - make_interval(mins => $1)
                 GROUP BY s.user_id`,
                [stuckMinutes]
            ),
            pool.query(
                `SELECT user_id, coalesce(sum(api_calls), 0)::int AS api_calls, coalesce(sum(comments_scraped), 0)::int AS comments
                 FROM comment_scrape_logs WHERE ${WINDOW('scraped_at')} GROUP BY user_id`,
                [days]
            ),
            pool.query(`SELECT user_id, count(*)::int AS n FROM user_scraped_posts GROUP BY user_id`),
            pool.query(`SELECT user_id, count(*)::int AS n FROM projects GROUP BY user_id`),
            pool.query(
                `SELECT j.id, s.user_id, u.email, j.post_shortcode, j.status, j.retry_count, j.max_retries,
                        left(j.error_message, 300) AS error_message, j.created_at
                 FROM scrape_jobs j JOIN scrape_sessions s ON s.id = j.session_id
                 LEFT JOIN users u ON u.id = s.user_id
                 WHERE j.status = 'failed' AND ${WINDOW('j.created_at')}
                 ORDER BY j.created_at DESC LIMIT 50`,
                [days]
            ),
            ...PLATFORM_EXTRAS.map((e) => pool.query(e.sql)),
        ]);

        const by = (result, pick) => new Map(result.rows.map((r) => [r.user_id, pick(r)]));
        const m = {
            sessions: by(sessions, (r) => r.n),
            jobs: by(jobs, (r) => r),
            stuck: by(stuck, (r) => r.n),
            logs: by(logs, (r) => r),
            saved: by(saved, (r) => r.n),
            projects: by(projects, (r) => r.n),
        };
        const extraMaps = PLATFORM_EXTRAS.map((e, i) => [e.key, by(extras[i], (r) => r.n)]);

        const rows = users.rows.map((u) => {
            const j = m.jobs.get(u.id) || {};
            const l = m.logs.get(u.id) || {};
            const row = {
                id: u.id, email: u.email, plan: u.plan, status: u.status, last_login: u.last_login,
                sessions: m.sessions.get(u.id) || 0,
                jobs_total: j.total || 0,
                jobs_failed: j.failed || 0,
                jobs_stuck: m.stuck.get(u.id) || 0,
                api_calls: l.api_calls || 0,
                comments_scraped: l.comments || 0,
                saved_posts: m.saved.get(u.id) || 0,
                projects: m.projects.get(u.id) || 0,
            };
            for (const [key, map] of extraMaps) row[key] = map.get(u.id) || 0;
            row.usage_score = row.jobs_total + row.api_calls;
            return row;
        });

        res.json({
            success: true,
            days,
            stuck_after_minutes: stuckMinutes,
            storage_basis: 'row_counts',
            users: rows.sort((a, b) => b.usage_score - a.usage_score || a.email.localeCompare(b.email)),
            top_users: rows.filter((r) => r.usage_score > 0).sort((a, b) => b.usage_score - a.usage_score).slice(0, 10),
            failed_jobs: failedJobs.rows,
        });
    } catch (err) {
        console.error('[ADMIN USAGE] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
