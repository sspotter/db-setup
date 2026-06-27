require('dotenv').config();
const pool = require('../db');

async function queryDB() {
    try {
        console.log('--- Keywords ---');
        const keywordsRes = await pool.query('SELECT * FROM search_keywords;');
        console.table(keywordsRes.rows);

        console.log('--- Keyword Search Sessions ---');
        const sessionsRes = await pool.query('SELECT * FROM keyword_search_sessions;');
        console.table(sessionsRes.rows);

        console.log('--- TikTok Videos ---');
        const videosRes = await pool.query('SELECT id, video_id, keyword_id, creator_id, project_id, views_count, capture_status FROM tiktok_videos;');
        console.table(videosRes.rows);

        console.log('--- TikTok Creators ---');
        const creatorsRes = await pool.query('SELECT id, username, follower_count FROM tiktok_creators;');
        console.table(creatorsRes.rows);

        console.log('--- TikTok Comments ---');
        const commentsRes = await pool.query('SELECT id, video_id, keyword_id, commenter_username FROM tiktok_comments LIMIT 10;');
        console.table(commentsRes.rows);

        process.exit(0);
    } catch (err) {
        console.error('Query failed:', err.message);
        process.exit(1);
    }
}

queryDB();
