require('dotenv').config();
const pool = require('../db');

async function migrate() {
    try {
        console.log("Running migration...");
        await pool.query(`ALTER TABLE ig_users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'reference';`);
        console.log("Added role to ig_users.");
        await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_reference BOOLEAN DEFAULT FALSE;`);
        console.log("Added is_reference to posts.");

        // Also update existing owner ig_users to root if they own any non-collab posts?
        // Or leave them as reference and they will upgrade on next capture.

        console.log("Migration complete.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        process.exit(0);
    }
}

migrate();
