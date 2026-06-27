require('dotenv').config();
const pool = require('../../../db');

async function verifyMetrics(brand) {
    console.log(`============= VERIFY METRICS FOR @${brand} =============\n`);
    
    try {
        // 1. Get the most recent project containing this brand
        const { rows: projRows } = await pool.query(
            `SELECT project_id FROM project_profiles WHERE username = $1 ORDER BY added_at DESC LIMIT 1`,
            [brand]
        );

        if (projRows.length === 0) {
            console.log(`No project found with profile @${brand}`);
            process.exit(0);
        }

        const projectId = projRows[0].project_id;
        console.log(`Found Project ID: ${projectId}\n`);

        // 2. Metrics Query (exactly as updated in projects.js GET /compare)
        const metricsResult = await pool.query(
            `WITH all_appearances AS (
                SELECT shortcode, owner_username AS username
                FROM posts
                UNION
                SELECT pr.post_shortcode AS shortcode, pr.username
                FROM post_relations pr
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
            ),
            profile_posts AS (
                SELECT
                    p.shortcode,
                    a.username AS target_username,
                    COALESCE((SELECT h.likes_count FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode ORDER BY h.captured_at DESC LIMIT 1), 0) AS likes,
                    COALESCE((SELECT h.comments_count FROM post_metrics_history h WHERE h.post_shortcode = p.shortcode ORDER BY h.captured_at DESC LIMIT 1), 0) AS comments,
                    p.posted_at
                FROM posts p
                JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                JOIN all_appearances a ON p.shortcode = a.shortcode
                WHERE ppo.project_id = $1
                  AND a.username = ANY($2)
            )
            SELECT
                pp.target_username AS username,
                COUNT(DISTINCT pp.shortcode) AS post_count,
                COALESCE(SUM(pp.likes), 0) AS total_likes,
                COALESCE(SUM(pp.comments), 0) AS total_comments,
                COALESCE(SUM(pp.likes) + SUM(pp.comments), 0) AS total_engagement,
                CASE WHEN COUNT(DISTINCT pp.shortcode) > 0 THEN ROUND((SUM(pp.likes) + SUM(pp.comments))::numeric / COUNT(DISTINCT pp.shortcode), 1) ELSE 0 END AS avg_engagement
            FROM profile_posts pp
            GROUP BY pp.target_username`,
            [projectId, [brand]]
        );

        const m = metricsResult.rows[0] || {
            post_count: 0,
            total_engagement: 0,
            avg_engagement: 0
        };

        // 3. Reach Query
        const reachResult = await pool.query(
            `WITH project_posts_cte AS (
                SELECT p.shortcode, p.owner_username
                FROM posts p
                JOIN project_posts ppo ON p.shortcode = ppo.post_shortcode
                WHERE ppo.project_id = $1
            ),
            all_appearances AS (
                SELECT owner_username AS username, shortcode
                FROM project_posts_cte
                UNION
                SELECT pr.username, pr.post_shortcode
                FROM post_relations pr
                JOIN project_posts_cte ppc ON pr.post_shortcode = ppc.shortcode
                WHERE pr.relation_type IN ('COAUTHOR', 'CAPTION_USER')
            ),
            appearance_counts AS (
                SELECT username, COUNT(DISTINCT shortcode) AS posts_involved
                FROM all_appearances
                WHERE username = ANY($2)
                GROUP BY username
            )
            SELECT
                ac.username,
                ac.posts_involved,
                COALESCE(iu.follower_count, 0) AS follower_count,
                COALESCE(iu.follower_count, 0) * ac.posts_involved AS potential_reach
            FROM appearance_counts ac
            LEFT JOIN ig_users iu ON ac.username = iu.username`,
            [projectId, [brand]]
        );

        const reachMap = {};
        reachResult.rows.forEach(r => { reachMap[r.username] = parseInt(r.potential_reach) || 0; });
        const potentialReach = reachMap[brand] || 0;
        
        // Follower formatting helper
        const formatNumber = num => (num || 0).toLocaleString();

        const output = {
            brand: brand,
            totalPosts: m.post_count || 0,
            totalEngagement: m.total_engagement,
            avgEPM: m.avg_engagement || 0,
            totalPotentialImpressions: potentialReach,
            brandImpressions: potentialReach
        };
        const fs = require('fs');
        fs.writeFileSync('test_output.json', JSON.stringify(output, null, 2));
        console.log("Successfully wrote output to test_output.json");
    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        pool.end();
    }
}

verifyMetrics("parimatch");
