/**
 * PostgreSQL connection pool
 */
const { Pool, types } = require('pg');

// Return bigint (int8) as a number, not a string — follower counts and reach
// fit well inside 2^53, and strings made the client concatenate instead of add.
types.setTypeParser(20, Number);

const localUrl = process.env.LOCAL_DATABASE_URL;
const cloudUrl = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

const databaseUrl = localUrl || cloudUrl;
const isCloud = !localUrl && !!cloudUrl;

if (!databaseUrl) {
    console.error('[DB] CRITICAL: No database connection string found (LOCAL_DATABASE_URL or RAILWAY_DATABASE_URL)');
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isCloud ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = pool;
