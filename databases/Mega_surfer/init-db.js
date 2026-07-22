/**
 * Ensures the merged `mega_surfer` database exists and its schema is applied.
 * Runs once on server startup, or standalone via `node init-db.js`.
 *
 * The merged schema (mega-surferschema.sql) is the TikTok superset — it contains
 * every Instagram table plus the TikTok-specific ones, so both platforms share
 * one physical database.
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
    const isCloud = !localUrl && !!cloudUrl;

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

    const schemaPath = path.join(__dirname, 'mega-surferschema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error('[INIT] mega-surferschema.sql not found at', schemaPath);
        process.exit(1);
    }

    const sql = cleanSchema(fs.readFileSync(schemaPath, 'utf-8'));

    // Step 1: Ensure the database exists (connect to the standard 'postgres' db)
    if (dbName !== 'postgres') {
        const tempPool = new Pool({
            connectionString: baseUrl,
            ssl: isCloud ? { rejectUnauthorized: false } : false,
        });

        try {
            const res = await tempPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
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

    // Step 2: Connect to the target database and apply the schema
    const pool = new Pool({
        connectionString: databaseUrl,
        ssl: isCloud ? { rejectUnauthorized: false } : false,
    });

    try {
        await pool.query(sql);
        console.log('[INIT] Merged schema initialized successfully.');
    } catch (err) {
        if (isAlreadyAppliedError(err.message)) {
            console.log('[INIT] Schema already present — skipping (DB already initialized).');
        } else {
            console.error('[INIT] Failed to initialize database schema:', err.message);
            process.exit(1);
        }
    } finally {
        await pool.end();
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
