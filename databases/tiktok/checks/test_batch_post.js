require('dotenv').config();
const pool = require('../db');

async function testInsert() {
    const client = await pool.connect();
    try {
        console.log('Testing raw video insert...');
        
        // 1. Get an existing project and keyword
        const projects = await client.query('SELECT id FROM projects LIMIT 1;');
        if (projects.rows.length === 0) {
            console.error('No projects found to test with.');
            process.exit(1);
        }
        const projectId = projects.rows[0].id;
        
        const keywords = await client.query('SELECT id FROM search_keywords LIMIT 1;');
        if (keywords.rows.length === 0) {
            console.error('No keywords found to test with.');
            process.exit(1);
        }
        const keywordId = keywords.rows[0].id;

        console.log(`Using Project: ${projectId}, Keyword: ${keywordId}`);

        await client.query('BEGIN');

        // Upsert creator
        const creatorRes = await client.query(
            `INSERT INTO tiktok_creators (tiktok_user_id, username, display_name, avatar_url)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO UPDATE SET 
                display_name = COALESCE(EXCLUDED.display_name, tiktok_creators.display_name),
                last_updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            ['test_id', 'test_username', 'Test User', 'http://avatar']
        );
        const creatorId = creatorRes.rows[0].id;
        console.log('Creator upserted, ID:', creatorId);

        // Upsert video
        const videoRes = await client.query(
            `INSERT INTO tiktok_videos (
                video_id, keyword_id, session_id, creator_id, project_id,
                caption, video_url, thumbnail_url, duration,
                views_count, likes_count, comments_count, shares_count, bookmarks_count,
                capture_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (video_id, keyword_id) DO UPDATE SET 
                views_count = EXCLUDED.views_count,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *`,
            [
                'test_video_123',
                keywordId,
                null,
                creatorId,
                projectId,
                'Test Caption',
                'http://video',
                'http://thumb',
                15,
                100, 200, 300, 40, 50,
                'captured'
            ]
        );

        console.log('Inserted video:', videoRes.rows[0]);

        await client.query('ROLLBACK');
        console.log('Test complete (rolled back successfully).');
        process.exit(0);
    } catch (err) {
        console.error('Test failed with error:', err);
        await client.query('ROLLBACK').catch(() => {});
        process.exit(1);
    } finally {
        client.release();
    }
}

testInsert();
