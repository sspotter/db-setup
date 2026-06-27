/**
 * TikSurfur v3 — Migration Runner
 * Runs v3_keyword_schema.sql against the configured database.
 *
 * Usage:
 *   node migrations/run_v3_migration.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const pool = require('../db');

const SQL_FILE = path.join(__dirname, 'v3_keyword_schema.sql');

async function runMigration() {
    const sql = fs.readFileSync(SQL_FILE, 'utf8');

    console.log('\n═══════════════════════════════════════════');
    console.log('  TikSurfur v3 — DB Migration');
    console.log('═══════════════════════════════════════════');
    console.log(`  File  : ${SQL_FILE}`);
    console.log(`  DB    : ${process.env.LOCAL_DATABASE_URL?.replace(/:([^:@]+)@/, ':****@')}`);
    console.log('───────────────────────────────────────────\n');

    const client = await pool.connect();
    try {
        await client.query(sql);
        console.log('✅  Migration completed successfully.\n');

        // Verify tables were created
        const { rows } = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN (
                'search_keywords',
                'keyword_search_sessions',
                'tiktok_creators',
                'tiktok_videos',
                'tiktok_comments',
                'tiktok_hashtags',
                'tiktok_graphql_captures',
                'tiktok_keyword_creators'
              )
            ORDER BY table_name;
        `);

        console.log(`  Tables verified (${rows.length}/8):\n`);
        rows.forEach(r => console.log(`    ✓  ${r.table_name}`));

        if (rows.length < 8) {
            const found    = rows.map(r => r.table_name);
            const expected = [
                'keyword_search_sessions', 'search_keywords',
                'tiktok_comments', 'tiktok_creators',
                'tiktok_graphql_captures', 'tiktok_hashtags',
                'tiktok_keyword_creators', 'tiktok_videos'
            ];
            const missing = expected.filter(t => !found.includes(t));
            console.warn('\n  ⚠️  Missing tables:');
            missing.forEach(t => console.warn(`       ✗  ${t}`));
        } else {
            console.log('\n  🎉  All 8 tables are present and ready.\n');
        }

    } catch (err) {
        console.error('\n❌  Migration FAILED:\n');
        console.error('  ', err.message);
        if (err.detail) console.error('  Detail:', err.detail);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
