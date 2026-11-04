/**
 * Object-level authorization helpers for the Instagram backend.
 * Each returns a boolean; routes answer 404 (not 403) when the check fails, so a
 * caller cannot tell "not yours" from "does not exist".
 */
const pool = require('../db');

/** The scrape session exists and belongs to the user. */
async function checkScrapeSessionOwnership(sessionId, userId) {
    const result = await pool.query(
        'SELECT id FROM scrape_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId]
    );
    return result.rows.length > 0;
}

/** The scrape job exists and its session belongs to the user. */
async function checkScrapeJobOwnership(jobId, userId) {
    const result = await pool.query(
        `SELECT sj.id
           FROM scrape_jobs sj
           JOIN scrape_sessions ss ON sj.session_id = ss.id
          WHERE sj.id = $1 AND ss.user_id = $2`,
        [jobId, userId]
    );
    return result.rows.length > 0;
}

/**
 * The user has this post: saved it (user_scraped_posts) or has it in one of
 * their own projects. Posts are shared rows, so merely existing is not enough.
 */
async function userHasPost(userId, shortcode) {
    const result = await pool.query(
        `SELECT 1 FROM user_scraped_posts WHERE user_id = $1 AND post_shortcode = $2
         UNION ALL
         SELECT 1 FROM project_posts pp
           JOIN projects pr ON pr.id = pp.project_id
          WHERE pr.user_id = $1 AND pp.post_shortcode = $2
         LIMIT 1`,
        [userId, shortcode]
    );
    return result.rows.length > 0;
}

module.exports = { checkScrapeSessionOwnership, checkScrapeJobOwnership, userHasPost };
