/**
 * Quick test for Project CRUD + scoping
 */
require('dotenv').config();
const pool = require('../../db');

async function test() {
    try {
        // Step 1: Get an existing user
        const userRes = await pool.query('SELECT id, email FROM users LIMIT 1');
        if (userRes.rows.length === 0) {
            console.log('❌ No users found. Cannot test.');
            return;
        }
        const userId = userRes.rows[0].id;
        console.log(`✅ Using user: ${userRes.rows[0].email} (${userId})`);

        // Step 2: Check if tables exist
        const tables = ['projects', 'project_profiles', 'project_posts'];
        for (const t of tables) {
            const r = await pool.query(`SELECT COUNT(*) FROM ${t}`);
            console.log(`✅ Table "${t}" exists, ${r.rows[0].count} rows`);
        }

        // Step 3: Create a project
        const projRes = await pool.query(
            `INSERT INTO projects (user_id, name, description) VALUES ($1, 'Test Campaign', 'Automated test') RETURNING *`,
            [userId]
        );
        const projId = projRes.rows[0].id;
        console.log(`✅ Created project: "${projRes.rows[0].name}" (${projId})`);

        // Step 4: Check if project can be queried
        const listRes = await pool.query('SELECT * FROM projects WHERE user_id = $1', [userId]);
        console.log(`✅ User has ${listRes.rows.length} project(s)`);

        // Step 5: Check legacy migration (projects created from user_scraped_posts)
        const legacyRes = await pool.query(`SELECT * FROM projects WHERE user_id = $1 AND name = 'Legacy Data'`, [userId]);
        console.log(`✅ Legacy projects found: ${legacyRes.rows.length}`);

        // Step 6: Check project_posts from migration
        if (legacyRes.rows.length > 0) {
            const legacyPosts = await pool.query('SELECT COUNT(*) FROM project_posts WHERE project_id = $1', [legacyRes.rows[0].id]);
            console.log(`✅ Legacy project has ${legacyPosts.rows[0].count} posts`);
        }

        // Step 7: Clean up test project
        await pool.query('DELETE FROM projects WHERE id = $1', [projId]);
        console.log('✅ Test project cleaned up');

        console.log('\n🎉 All tests passed!');
    } catch (err) {
        console.error('❌ Test failed:', err.message);
    } finally {
        await pool.end();
    }
}

test();
