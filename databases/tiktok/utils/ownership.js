/**
 * Object-level authorization helpers.
 *
 * Every cross-tenant resource (keyword, video, session, scrape job) ultimately
 * belongs to a project, and every project belongs to a user. These helpers
 * resolve that chain and confirm the requesting user owns the resource, so
 * routes can enforce ownership before reading or mutating data.
 *
 * All return a boolean (or the matched row, for getOwnedKeyword). Routes should
 * respond 403 when the check fails.
 */
const pool = require('../db');

async function checkProjectOwnership(projectId, userId) {
    const result = await pool.query(
        'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, userId]
    );
    return result.rows.length > 0;
}

/**
 * Returns the owned keyword row ({ id, project_id }) or null.
 * Callers that need the keyword's project_id (e.g. batch upload) use this;
 * callers that only need a yes/no use checkKeywordOwnership below.
 */
async function getOwnedKeyword(keywordId, userId) {
    const result = await pool.query(
        `SELECT sk.id, sk.project_id
           FROM search_keywords sk
           JOIN projects p ON sk.project_id = p.id
          WHERE sk.id = $1 AND p.user_id = $2`,
        [keywordId, userId]
    );
    return result.rows[0] || null;
}

async function checkKeywordOwnership(keywordId, userId) {
    return (await getOwnedKeyword(keywordId, userId)) !== null;
}

/**
 * A TikTok video_id is NOT globally unique — the same video can appear under
 * multiple keywords (the unique key is (video_id, keyword_id)), including other
 * users' keywords. This confirms the user owns at least one row for the video;
 * any mutation must still be SCOPED to the user's rows (see the qualify route).
 */
async function checkVideoOwnership(videoId, userId) {
    const result = await pool.query(
        `SELECT v.id
           FROM tiktok_videos v
           JOIN projects p ON v.project_id = p.id
          WHERE v.video_id = $1 AND p.user_id = $2
          LIMIT 1`,
        [videoId, userId]
    );
    return result.rows.length > 0;
}

async function checkSessionOwnership(sessionId, userId) {
    const result = await pool.query(
        `SELECT kss.id
           FROM keyword_search_sessions kss
           JOIN projects p ON kss.project_id = p.id
          WHERE kss.id = $1 AND p.user_id = $2`,
        [sessionId, userId]
    );
    return result.rows.length > 0;
}

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

module.exports = {
    checkProjectOwnership,
    getOwnedKeyword,
    checkKeywordOwnership,
    checkVideoOwnership,
    checkSessionOwnership,
    checkScrapeJobOwnership,
};
