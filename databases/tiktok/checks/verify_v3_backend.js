require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db');

async function verifyDatabase() {
    console.log('[VERIFY] Starting database schema verification...');
    const tablesToCheck = [
        'search_keywords',
        'keyword_search_sessions',
        'tiktok_creators',
        'tiktok_videos',
        'tiktok_comments',
        'tiktok_hashtags',
        'tiktok_graphql_captures',
        'tiktok_keyword_creators'
    ];

    try {
        const query = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
              AND table_name = ANY($1)
            ORDER BY table_name;
        `;
        const res = await pool.query(query, [tablesToCheck]);
        const existingTables = res.rows.map(r => r.table_name);
        
        console.log('[VERIFY] Checking existence of tables...');
        let allExist = true;
        for (const table of tablesToCheck) {
            if (existingTables.includes(table)) {
                console.log(`  ✅ Table exists: ${table}`);
            } else {
                console.error(`  ❌ Table MISSING: ${table}`);
                allExist = false;
            }
        }

        if (allExist) {
            console.log('[VERIFY] Database verification SUCCESSFUL. All V3 tables are present.');
            process.exit(0);
        } else {
            console.error('[VERIFY] Database verification FAILED. Some tables are missing.');
            process.exit(1);
        }
    } catch (err) {
        console.error('[VERIFY] Error during verification:', err.message);
        process.exit(1);
    }
}

verifyDatabase();
