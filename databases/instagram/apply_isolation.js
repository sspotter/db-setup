require('dotenv').config();
const { Pool } = require('pg');

async function migrate() {
    console.log(`[MIGRATE] Connecting to ${process.env.DATABASE_URL.split('@')[1] || 'database'}...`);
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: false
    });

    try {
        const client = await pool.connect();

        console.log('[MIGRATE] Adding user_id to scrape_sessions...');
        await client.query(`ALTER TABLE scrape_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;`);

        console.log('[MIGRATE] Creating user_scraped_posts table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_scraped_posts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                post_shortcode VARCHAR(255) REFERENCES posts(shortcode) ON DELETE CASCADE,
                scraped_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, post_shortcode)
            );
        `);

        console.log('[MIGRATE] Creating indexes...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_scraped_posts_user ON user_scraped_posts(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_scraped_posts_post ON user_scraped_posts(post_shortcode);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_scrape_sessions_user ON scrape_sessions(user_id);`);

        console.log('[MIGRATE] Migration completed successfully.');
        client.release();
    } catch (err) {
        console.error('[MIGRATE ERROR]:', err);
    } finally {
        await pool.end();
    }
}

migrate();
