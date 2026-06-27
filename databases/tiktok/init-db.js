/**
 * Runs schema.sql against PostgreSQL to ensure all tables exist.
 * Called once on server startup, or can be run standalone.
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { cleanSchema, isAlreadyAppliedError } = require('../clean-schema');

async function initDatabase() {
    const localUrl = process.env.LOCAL_DATABASE_URL;
    const cloudUrl = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;
    const databaseUrl = localUrl || cloudUrl;

    if (!databaseUrl) {
        console.error('[INIT] CRITICAL: No database connection string found');
        process.exit(1);
    }

    let dbName = 'postgres';
    let baseUrl = databaseUrl;
    try {
        const url = new URL(databaseUrl);
        dbName = url.pathname.slice(1) || 'postgres';
        url.pathname = '/postgres';
        baseUrl = url.toString();
    } catch (e) {
        console.warn('[INIT] Could not parse database URL, assuming standard setup');
    }

    const schemaPath = path.join(__dirname, '..', 'tiksurferschema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error('[INIT] schema.sql not found at', schemaPath);
        process.exit(1);
    }

    const sql = cleanSchema(fs.readFileSync(schemaPath, 'utf-8'));

    // Step 1: Ensure the database exists by connecting to standard 'postgres' db
    if (dbName !== 'postgres') {
        const tempPool = new Pool({
            connectionString: baseUrl,
            ssl: !localUrl && !!cloudUrl ? { rejectUnauthorized: false } : false
        });

        try {
            const res = await tempPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
            if (res.rowCount === 0) {
                console.log(`[INIT] Database "${dbName}" does not exist. Creating...`);
                await tempPool.query(`CREATE DATABASE "${dbName}"`);
                console.log(`[INIT] Database "${dbName}" created successfully.`);
            }
        } catch (err) {
            console.log(`[INIT] DB pre-check failed (might already exist or permission denied): ${err.message}`);
        } finally {
            await tempPool.end();
        }
    }

    // Step 2: Connect to the actual database using the regular pool and run schema
    const pool = require('./db');
    try {
        await pool.query(sql);
        console.log('[INIT] Database schema initialized successfully.');
    } catch (err) {
        if (isAlreadyAppliedError(err.message)) {
            console.log('[INIT] Schema already present — skipping (DB already initialized).');
        } else {
            console.error('[INIT] Failed to initialize database schema:', err.message);
            process.exit(1);
        }
    }
}

// Support standalone execution
if (require.main === module) {
    initDatabase()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = initDatabase;
