/**
 * PostgreSQL connection pool
 */
const { Pool } = require('pg');

const localUrl = process.env.LOCAL_DATABASE_URL;

const databaseUrl = localUrl || cloudUrl;

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
