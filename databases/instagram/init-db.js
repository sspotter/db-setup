/**
 * Runs schema.sql against PostgreSQL to ensure all tables exist.
 * Called once on server startup.
 */
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function initDatabase() {
    const schemaPath = path.join(__dirname, '..', 'schema.sql');

    if (!fs.existsSync(schemaPath)) {
        console.error('[INIT] schema.sql not found at', schemaPath);
        process.exit(1);
    }

    const sql = fs.readFileSync(schemaPath, 'utf-8');

    try {
        await pool.query(sql);
        console.log('[INIT] Database schema initialized successfully.');
    } catch (err) {
        console.error('[INIT] Failed to initialize database:', err.message);
        process.exit(1);
    }
}

module.exports = initDatabase;
