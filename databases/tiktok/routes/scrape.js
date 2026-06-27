/**
 * Scrape routes — session management, job queue, and resume support
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { checkProjectOwnership, checkScrapeJobOwnership } = require('../utils/ownership');

/**
 * POST /api/scrape/sessions
 * Body: { profile_username, posts: [{ shortcode, comments_count }] }
 * 
 * Creates a new scraping session and generates initial jobs (one per post).
 * Each job represents the first page of comments for a post.
 */
router.post('/scrape/sessions', async (req, res) => {
    const client = await pool.connect();

    try {
        const { profile_username, posts, project_id } = req.body;

        if (!profile_username || !Array.isArray(posts) || posts.length === 0) {
            return res.status(400).json({ success: false, error: 'profile_username and posts array required' });
        }

        // Validate project ownership if provided. This runs BEFORE BEGIN, so a
        // failure must simply return — there is no transaction to roll back yet.
        if (project_id && !(await checkProjectOwnership(project_id, req.user.id))) {
            return res.status(403).json({ success: false, error: 'Project not found or access denied' });
        }

        await client.query('BEGIN');

        // Create session (with optional project_id)
        const sessionResult = await client.query(
            `INSERT INTO scrape_sessions (user_id, project_id, profile_username, status, total_posts, total_jobs, started_at)
             VALUES ($1, $2, $3, 'running', $4, $5, NOW())
             RETURNING *`,
            [req.user.id, project_id || null, profile_username, posts.length, posts.length]
        );

        const session = sessionResult.rows[0];

        // Create one initial job per post (page 1, empty cursor)
        let jobsCreated = 0;
        for (const post of posts) {
            if (!post.shortcode) continue;

            await client.query(
                `INSERT INTO scrape_jobs (session_id, post_shortcode, page_number, status, end_cursor)
                 VALUES ($1, $2, 1, 'pending', '')`,
                [session.id, post.shortcode]
            );
            jobsCreated++;
        }

        // Update total_jobs with actual count
        await client.query(
            `UPDATE scrape_sessions SET total_jobs = $1 WHERE id = $2`,
            [jobsCreated, session.id]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            session: { ...session, total_jobs: jobsCreated },
            jobsCreated,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[SCRAPE SESSION] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * GET /api/scrape/sessions/:id
 * Returns session status with job progress breakdown.
 */
router.get('/scrape/sessions/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const sessionResult = await pool.query(
            'SELECT * FROM scrape_sessions WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        const session = sessionResult.rows[0];

        // Job status breakdown
        const jobStats = await pool.query(
            `SELECT status, COUNT(*) as count, SUM(comments_scraped) as total_comments
             FROM scrape_jobs WHERE session_id = $1
             GROUP BY status`,
            [id]
        );

        const jobs = {};
        let totalComments = 0;
        jobStats.rows.forEach(row => {
            jobs[row.status] = parseInt(row.count);
            totalComments += parseInt(row.total_comments || 0);
        });

        res.json({
            success: true,
            session,
            jobs,
            totalComments,
            progress: session.total_jobs > 0
                ? Math.round(((jobs.completed || 0) / session.total_jobs) * 100)
                : 0,
        });
    } catch (err) {
        console.error('[SCRAPE SESSION GET] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/scrape/sessions
 * Returns all sessions, newest first.
 * Query: ?status=running&limit=10
 */
router.get('/scrape/sessions', async (req, res) => {
    try {
        const { status, project_id, limit = 20 } = req.query;

        let query = 'SELECT * FROM scrape_sessions WHERE user_id = $1';
        const params = [req.user.id];
        let idx = 2;

        if (project_id) {
            query += ` AND project_id = $${idx++}`;
            params.push(project_id);
        }

        if (status) {
            query += ` AND status = $${idx++}`;
            params.push(status);
        }

        query += ` ORDER BY created_at DESC LIMIT $${idx++}`;
        params.push(parseInt(limit));

        const result = await pool.query(query, params);

        res.json({
            success: true,
            sessions: result.rows,
            count: result.rows.length,
        });
    } catch (err) {
        console.error('[SCRAPE SESSIONS LIST] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/scrape/sessions/:id/next-job
 * Returns the next pending job for this session.
 * Jobs are shuffled (random order) to avoid sequential scraping of the same post.
 */
router.get('/scrape/sessions/:id/next-job', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `SELECT * FROM scrape_jobs
             WHERE session_id = $1 AND status = 'pending'
             ORDER BY RANDOM()
             LIMIT 1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.json({ success: true, job: null, message: 'No pending jobs' });
        }

        res.json({
            success: true,
            job: result.rows[0],
        });
    } catch (err) {
        console.error('[SCRAPE NEXT JOB] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PATCH /api/scrape/jobs/:id
 * Body: { status, end_cursor, comments_scraped, error_message, has_next_page }
 * 
 * Updates a job's status. If 'completed' with has_next_page=true,
 * creates a new job for the next page.
 */
router.patch('/scrape/jobs/:id', async (req, res) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;
        const { status, end_cursor, comments_scraped, error_message, has_next_page } = req.body;

        // Verify the job's session belongs to the caller before touching it.
        if (!(await checkScrapeJobOwnership(id, req.user.id))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await client.query('BEGIN');

        // Get current job
        const jobResult = await client.query(
            'SELECT * FROM scrape_jobs WHERE id = $1',
            [id]
        );

        if (jobResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        const job = jobResult.rows[0];

        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (status) {
            updates.push(`status = $${paramIdx++}`);
            values.push(status);
        }
        if (end_cursor !== undefined) {
            updates.push(`end_cursor = $${paramIdx++}`);
            values.push(end_cursor);
        }
        if (comments_scraped !== undefined) {
            updates.push(`comments_scraped = $${paramIdx++}`);
            values.push(comments_scraped);
        }
        if (error_message !== undefined) {
            updates.push(`error_message = $${paramIdx++}`);
            values.push(error_message);
        }

        if (status === 'running') {
            updates.push(`started_at = NOW()`);
        }
        if (status === 'completed' || status === 'failed') {
            updates.push(`completed_at = NOW()`);
        }
        if (status === 'failed') {
            updates.push(`retry_count = retry_count + 1`);
        }

        if (updates.length > 0) {
            values.push(id);
            await client.query(
                `UPDATE scrape_jobs SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
                values
            );
        }

        let newJob = null;

        // If completed with more pages, create next page job
        if (status === 'completed' && has_next_page && end_cursor) {
            const newJobResult = await client.query(
                `INSERT INTO scrape_jobs (session_id, post_shortcode, page_number, status, end_cursor)
                 VALUES ($1, $2, $3, 'pending', $4)
                 RETURNING *`,
                [job.session_id, job.post_shortcode, job.page_number + 1, end_cursor]
            );
            newJob = newJobResult.rows[0];

            // Update session total_jobs
            await client.query(
                `UPDATE scrape_sessions SET total_jobs = total_jobs + 1 WHERE id = $1`,
                [job.session_id]
            );
        }

        // Update session progress counters
        if (status === 'completed') {
            await client.query(
                `UPDATE scrape_sessions SET
                    completed_jobs = completed_jobs + 1,
                    total_comments_scraped = total_comments_scraped + $1
                 WHERE id = $2`,
                [comments_scraped || 0, job.session_id]
            );

            // Check if all jobs are done (no pending/running)
            const pendingCheck = await client.query(
                `SELECT COUNT(*) FROM scrape_jobs
                 WHERE session_id = $1 AND status IN ('pending', 'running')`,
                [job.session_id]
            );

            if (parseInt(pendingCheck.rows[0].count) === 0) {
                await client.query(
                    `UPDATE scrape_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
                    [job.session_id]
                );
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            updatedJob: id,
            newJob,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[SCRAPE JOB PATCH] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/scrape/sessions/:id/resume
 * Resume a paused or failed session.
 * Re-queues failed jobs (resets status to 'pending' if under max retries).
 */
router.post('/scrape/sessions/:id/resume', async (req, res) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;

        await client.query('BEGIN');

        // Update session status
        const sessionUpdate = await client.query(
            `UPDATE scrape_sessions SET status = 'running', started_at = COALESCE(started_at, NOW()) WHERE id = $1 AND user_id = $2 RETURNING id`,
            [id, req.user.id]
        );

        if (sessionUpdate.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Session not found or unauthorized' });
        }

        // Re-queue failed jobs that haven't exceeded max retries
        const requeued = await client.query(
            `UPDATE scrape_jobs SET status = 'pending', error_message = NULL
             WHERE session_id = $1 AND status = 'failed' AND retry_count < max_retries
             RETURNING id`,
            [id]
        );

        // Also reset any 'running' jobs (stale from a previous crash)
        const reset = await client.query(
            `UPDATE scrape_jobs SET status = 'pending'
             WHERE session_id = $1 AND status = 'running'
             RETURNING id`,
            [id]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            requeuedFailed: requeued.rows.length,
            resetStale: reset.rows.length,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[SCRAPE RESUME] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/scrape/sessions/:id/pause
 * Pause a running session.
 */
router.post('/scrape/sessions/:id/pause', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `UPDATE scrape_sessions SET status = 'paused' WHERE id = $1 AND user_id = $2 AND status = 'running'`,
            [id, req.user.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Session not found, unauthorized, or not running' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[SCRAPE PAUSE] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
