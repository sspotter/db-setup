require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const alterUsersTable = `
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS active_sessions INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS max_devices INT DEFAULT 3;
`;

const alterIgUsersTable = `
    ALTER TABLE ig_users
    ADD COLUMN IF NOT EXISTS following_count BIGINT,
    ADD COLUMN IF NOT EXISTS media_count INT,
    ADD COLUMN IF NOT EXISTS biography TEXT,
    ADD COLUMN IF NOT EXISTS external_url TEXT,
    ADD COLUMN IF NOT EXISTS business_category VARCHAR(255);
`;

// 3. Add scraped_from_profile directly to posts (Insta Surfer)
const alterPostsTable = `
    ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS scraped_from_profile VARCHAR(255);
`;

async function runAlterations() {
    const client = await pool.connect();
    try {
        console.log('Applying alter scripts...');
        await client.query('BEGIN');
        
        await client.query(alterUsersTable);
        console.log('✓ users table updated.');

        await client.query(alterIgUsersTable);
        console.log('✓ ig_users table updated.');

        await client.query(alterPostsTable);
        console.log('✓ posts table updated with scraped_from_profile.');

        await client.query('COMMIT');
        console.log('All schema alterations applied successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error applying schema alterations:', err);
    } finally {
        client.release();
        pool.end();
    }
}
runAlterations();
