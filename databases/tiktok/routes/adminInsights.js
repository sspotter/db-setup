const express = require('express');
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { retentionStatus, logServerError } = require('../middleware/activityLog');
const { version } = require('../package.json');

const router = express.Router();

// Collapses ids so /api/projects/12 and /api/projects/13 group together.
const NORM_PATH = `regexp_replace(path, '/([0-9]+|[0-9a-f]{8}-[0-9a-f-]{27})', '/:id', 'g')`;

const cmpVersions = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
};

// GET /api/admin/insights?days=7
router.get('/insights', verifyAdmin, async (req, res) => {
    try {
        const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
        const slowMs = parseInt(process.env.SLOW_REQUEST_MS, 10) || 2000;

        const [versions, topFailing, trend, slow] = await Promise.all([
            // One row per version: users whose newest successful login reported it, and
            // those users' non-login failures in the window.
            pool.query(
                `WITH latest AS (
                     SELECT DISTINCT ON (who) who, user_id, email, ext_version
                     FROM (SELECT coalesce(user_id::text, lower(email)) AS who, user_id, email, ext_version, created_at
                           FROM api_events WHERE reason = 'success' AND ext_version IS NOT NULL) s
                     WHERE who IS NOT NULL
                     ORDER BY who, created_at DESC
                 )
                 SELECT l.ext_version, count(*)::int AS users,
                        coalesce(sum(err.n), 0)::int AS errors,
                        array_agg(l.email ORDER BY l.email) FILTER (WHERE l.email IS NOT NULL) AS emails
                 FROM latest l
                 LEFT JOIN LATERAL (
                     SELECT count(*) AS n FROM api_events e
                     WHERE e.status >= 400 AND e.path <> '/api/auth/login'
                       AND e.created_at >= now() - make_interval(days => $1)
                       AND (e.user_id = l.user_id OR lower(e.email) = lower(l.email))
                 ) err ON true
                 GROUP BY l.ext_version`,
                [days]
            ),
            pool.query(
                `SELECT method, ${NORM_PATH} AS path, count(*)::int AS failures,
                        (count(*) FILTER (WHERE status >= 500))::int AS server_errors, max(created_at) AS last_seen
                 FROM api_events
                 WHERE status >= 400 AND path <> '/api/auth/login' AND created_at >= now() - make_interval(days => $1)
                 GROUP BY method, 2 ORDER BY failures DESC LIMIT 10`,
                [days]
            ),
            pool.query(
                `SELECT date_trunc('day', created_at) AS day,
                        (count(*) FILTER (WHERE status >= 500))::int AS errors,
                        (count(*) FILTER (WHERE status >= 400 AND status < 500))::int AS client_errors
                 FROM api_events WHERE created_at >= now() - make_interval(days => $1)
                 GROUP BY 1 ORDER BY 1`,
                [days]
            ),
            // ponytail: only slow rows are stored (see SLOW_REQUEST_MS), so this ranks paths by
            // how often they are slow, not by their true average latency.
            pool.query(
                `SELECT method, ${NORM_PATH} AS path, count(*)::int AS slow,
                        round(avg(duration_ms))::int AS avg_ms, max(duration_ms) AS max_ms
                 FROM api_events
                 WHERE duration_ms >= $2 AND created_at >= now() - make_interval(days => $1)
                 GROUP BY method, 2 ORDER BY slow DESC LIMIT 10`,
                [days, slowMs]
            ),
        ]);

        const latest = versions.rows.map((v) => v.ext_version).sort(cmpVersions).pop() || null;
        res.json({
            success: true,
            days,
            slow_ms: slowMs,
            latest_version: latest,
            versions: versions.rows
                .map((v) => ({ ...v, outdated: cmpVersions(v.ext_version, latest) < 0 }))
                .sort((a, b) => cmpVersions(b.ext_version, a.ext_version)),
            top_failing: topFailing.rows,
            trend: trend.rows,
            slow: slow.rows,
        });
    } catch (err) {
        console.error('[ADMIN INSIGHTS] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/admin/health — always 200 so the panel can show a dead database.
router.get('/health', verifyAdmin, async (req, res) => {
    const body = {
        success: true,
        version,
        node: process.version,
        uptime_s: Math.round(process.uptime()),
        retention: retentionStatus,
    };
    try {
        const t0 = Date.now();
        await pool.query('SELECT 1');
        body.db = { ok: true, latency_ms: Date.now() - t0 };

        const m = await pool.query(
            `SELECT to_regclass('public.api_events') IS NOT NULL AS api_events,
                    to_regclass('public.password_resets') IS NOT NULL AS password_resets,
                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_events' AND column_name = 'duration_ms') AS duration_ms,
                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_seen') AS last_seen,
                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_posts' AND column_name = 'is_hidden') AS project_post_hide,
                    to_regclass('public.admin_audit') IS NOT NULL AS admin_audit,
                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'plan_expires_at') AS plan_expiry,
                    to_regclass('public.admin_accounts') IS NOT NULL AS admin_accounts,
                    to_regclass('public.blocked_ips') IS NOT NULL AS blocked_ips`
        );
        body.migrations = m.rows[0];
        if (body.migrations.api_events) {
            const c = await pool.query('SELECT count(*)::int AS total, min(created_at) AS oldest FROM api_events');
            body.events = c.rows[0];
        }
    } catch (err) {
        body.db = { ok: false, error: err.message };
    }
    res.json(body);
});

// GET /api/admin/alerts — recomputed on every call from the last 15 minutes of api_events.
router.get('/alerts', verifyAdmin, async (req, res) => {
    try {
        const perIp = parseInt(process.env.ALERT_FAILED_LOGINS_PER_IP, 10) || 10;
        const perWindow5xx = parseInt(process.env.ALERT_5XX_PER_15MIN, 10) || 5;

        const [ips, errs] = await Promise.all([
            pool.query(
                `SELECT ip, count(*)::int AS n, count(DISTINCT lower(email))::int AS accounts
                 FROM api_events
                 WHERE ((path = '/api/auth/login' AND status >= 400) OR reason = 'bad_admin_password') AND ip IS NOT NULL
                   AND reason IS DISTINCT FROM 'ip_blocked'
                   AND created_at >= now() - interval '15 minutes'
                 GROUP BY ip HAVING count(*) >= $1 ORDER BY n DESC`,
                [perIp]
            ),
            pool.query(`SELECT count(*)::int AS n FROM api_events WHERE status >= 500 AND created_at >= now() - interval '15 minutes'`),
        ]);

        const alerts = ips.rows.map((r) => ({
            type: 'failed_logins_ip',
            severity: 'danger',
            message: `${r.n} failed logins from ${r.ip} in 15 min (${r.accounts} account${r.accounts === 1 ? '' : 's'})`,
            ip: r.ip,
            count: r.n,
            accounts: r.accounts,
        }));
        if (errs.rows[0].n >= perWindow5xx) {
            alerts.push({ type: 'server_errors', severity: 'danger', message: `${errs.rows[0].n} server errors (5xx) in the last 15 min` });
        }
        res.json({ success: true, alerts });
    } catch (err) {
        console.error('[ADMIN ALERTS] Error:', err.message);
        logServerError(res, err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
