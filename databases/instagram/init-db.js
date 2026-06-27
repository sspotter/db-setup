/**
 * Runs schema.sql against PostgreSQL to ensure all tables exist.
 * Called once on server startup.
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { cleanSchema, isAlreadyAppliedError } = require('../clean-schema');

async function initDatabase() {
    const schemaPath = path.join(__dirname, '..', 'insta-surferschema.sql');

    if (!fs.existsSync(schemaPath)) {
        console.error('[INIT] schema.sql not found at', schemaPath);
        process.exit(1);
    }

    const sql = cleanSchema(fs.readFileSync(schemaPath, 'utf-8'));

    try {
        await pool.query(sql);
        console.log('[INIT] Database schema initialized successfully.');
    } catch (err) {
        if (isAlreadyAppliedError(err.message)) {
            console.log('[INIT] Schema already present — skipping (DB already initialized).');
        } else {
            console.error('[INIT] Failed to initialize database:', err.message);
            process.exit(1);
        }
    }
}

module.exports = initDatabase;
