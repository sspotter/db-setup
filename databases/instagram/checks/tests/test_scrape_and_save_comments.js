
const { Pool } = require('pg');


// Target settings
const TARGET_SHORTCODE = 'DUc_OxgDG-F';
const DATABASE_URL = process.env.LOCAL_DATABASE_URL || 'postgresql://devuser:%26Pf56ngsrkk@localhost:5432/insta_surf_multi_prisma';

// Use same query hash from extension
const GRAPHQL_QUERY_HASH = '33ba35852cb50da46f5b5e889df7d159';

console.log(`[TEST] Database URL: ${DATABASE_URL}`);
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: false
});

/**
 * Scrapes comments for a given media ID
 */
async function scrapeComments(shortcode) {
    // We will use the direct v1 API approach explicitly provided by the user snippet
    // For the specific post DUc_OxgDG-F, the media ID is 3827211875511988101
    const MEDIA_ID = '3827211875511988101';
    
    console.log(`\n[SCRAPE] Fetching comment data from Instagram V1 API for media: ${MEDIA_ID}...`);
    
    const url = `https://www.instagram.com/api/v1/media/${MEDIA_ID}/comments/?can_support_threading=true&permalink_enabled=false`;

    // Exact headers from the provided Node fetch request
    const headers = {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "priority": "u=1, i",
        "sec-ch-prefers-color-scheme": "dark",
        "sec-ch-ua": "\"Chromium\";v=\"146\", \"Not-A.Brand\";v=\"24\", \"Google Chrome\";v=\"146\"",
        "sec-ch-ua-full-version-list": "\"Chromium\";v=\"146.0.7680.178\", \"Not-A.Brand\";v=\"24.0.0.0\", \"Google Chrome\";v=\"146.0.7680.178\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-model": "\"\"",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-ch-ua-platform-version": "\"19.0.0\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-asbd-id": "359341",
        "x-csrftoken": "omla7CoY2LRabslwaS3YfnX3RcSUnsrs",
        "x-ig-app-id": "936619743392459",
        "x-ig-www-claim": "hmac.AR3J_ep934lkVnUZeF4uT6yvbu5ftfiyrW1LxvceQu33BXzh",
        "x-requested-with": "XMLHttpRequest",
        "x-web-session-id": "s7rrpi:bc2756:jhekxh",
        "cookie": "datr=bC6PaRjfzKIEfUYRa3u84NsV; ig_did=39A29E86-B5F0-48F1-AFFA-67D1B46FB19F; mid=aY8ubAALAAGTKu0EaOOXcESPssp5; ps_l=1; ps_n=1; csrftoken=omla7CoY2LRabslwaS3YfnX3RcSUnsrs; ds_user_id=80777667665; dpr=1.2400000095367432; sessionid=80777667665%3A0Vo3t8vO5ZCNRk%3A14%3AAYhRT1NkPKdXmjs28VTYEhkt-AWHmGyl9AbLHaAYIBQ; rur=\"NCG\\05480777667665\\0541807388145:01fe8f73edfb9843b58ba1c69642a065ad95e67eac16a3bef73392dbc3660d6f4ea28963\"; wd=1154x1036",
        "Referer": "https://www.instagram.com/p/DUc_OxgDG-F/"
    };

    try {
        const fetch = globalThis.fetch || require('node-fetch'); // compat with older node versions if needed
        const res = await fetch(url, { method: "GET", headers });
        
        if (!res.ok) {
            console.error(`[SCRAPE ERROR] HTTP ${res.status} - ${res.statusText}`);
            return [];
        }

        const json = await res.json();
        
        if (!json.comments) {
            console.warn("[SCRAPE] No comment data found in V1 API response.");
            return [];
        }

        const parsedComments = json.comments.map(comment => ({
            id: comment.pk,
            username: comment.user?.username,
            userId: comment.user?.pk,
            text: comment.text,
            timestamp: comment.created_at ? new Date(comment.created_at * 1000).toISOString() : null,
            likes: comment.comment_like_count || 0,
            replyCount: comment.child_comment_count || 0,
            profilePic: comment.user?.profile_pic_url || null
        }));

        console.log(`[SCRAPE] Successfully fetched ${parsedComments.length} comments using V1 API.`);
        return parsedComments;

    } catch (err) {
        console.error(`[SCRAPE ERROR] Failed to hit V1 API: ${err.message}`);
        return [];
    }
}

/**
 * Saves generic comment objects to PostgreSQL safely
 */
async function saveCommentsToDB(shortcode, comments) {
    if (comments.length === 0) {
        console.log("[DB] No comments to save.");
        return;
    }

    console.log(`\n[DB] Saving ${comments.length} comments to PostgreSQL Database...`);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        let inserted = 0;
        let updated = 0;

        for (const comment of comments) {
            const result = await client.query(
                `INSERT INTO comments (id, post_shortcode, username, user_id, text, likes_count, reply_count, profile_pic_url, commented_at, scraped_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    text = COALESCE(EXCLUDED.text, comments.text),
                    likes_count = GREATEST(comments.likes_count, EXCLUDED.likes_count),
                    reply_count = GREATEST(comments.reply_count, EXCLUDED.reply_count),
                    profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, comments.profile_pic_url),
                    scraped_at = NOW()
                 RETURNING (xmax = 0) AS is_insert`,
                [
                    comment.id,
                    shortcode,
                    comment.username,
                    comment.userId,
                    comment.text,
                    comment.likes,
                    comment.replyCount,
                    comment.profilePic,
                    comment.timestamp,
                ]
            );

            if (result.rows[0]?.is_insert) inserted++;
            else updated++;
        }

        await client.query('COMMIT');
        console.log(`[DB] Operation complete! -> Inserted: ${inserted} | Updated: ${updated} (Total processed: ${inserted + updated})`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[DB ERROR] Failed to save comments, transaction rolled back:', err.message);
    } finally {
        client.release();
    }
}

/**
 * Entrypoint
 */
async function runTest() {
    try {
        console.log("=========================================");
        console.log("  COMMENT SCRAPE & SAVE TEST INITIALIZED");
        console.log("=========================================\n");
        
        // 1. Scrape the data
        const comments = await scrapeComments(TARGET_SHORTCODE);
        
        // 2. Save to DataBase
        await saveCommentsToDB(TARGET_SHORTCODE, comments);

    } finally {
        // Close db pool so script can exit gracefully
        await pool.end();
        console.log("\n[TEST] Shutdown complete.");
    }
}

// Ensure execution
runTest();
