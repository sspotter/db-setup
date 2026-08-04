/**
 * Mirrors a hide/unhide state across the `posts` and `tiktok_videos` tables
 * for the same TikTok video id (posts.shortcode === tiktok_videos.video_id).
 *
 * Both tables are scoped to rows the caller owns:
 *   - posts:         via project_posts/projects or user_scraped_posts.
 *   - tiktok_videos:  via project_id -> projects.user_id (video_id is NOT
 *                      globally unique — the same id can exist under other
 *                      users' keywords, see utils/ownership.js).
 *
 * A row that doesn't exist for the caller in one table is silently a no-op
 * for that table (0 rows updated) — this is expected when a video was only
 * ever captured on one side.
 *
 * Pass a transaction client when the caller's own update must commit
 * atomically with this sync (see posts.js's hide/delete routes, which do —
 * they run this inside their own BEGIN/COMMIT). tiktok_videos.js's qualify
 * and delete routes pass the plain `pool` instead, matching those routes'
 * existing non-transactional style; this leaves a narrow partial-failure
 * window there (e.g. the tiktok_videos row is deleted, then this call
 * throws before the posts row is hidden) that pre-dates this helper and is
 * not introduced by it — the two prior statements in the pool.query case
 * simply commit independently rather than as one unit.
 */
async function syncHiddenAcrossTables(client, id, userId, isHidden) {
    await client.query(
        `UPDATE posts p
            SET is_hidden = $3,
                hidden_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END
           FROM (
                SELECT p2.shortcode
                  FROM posts p2
                  LEFT JOIN project_posts ppo ON p2.shortcode = ppo.post_shortcode
                  LEFT JOIN projects proj ON ppo.project_id = proj.id
                  LEFT JOIN user_scraped_posts up ON p2.shortcode = up.post_shortcode
                 WHERE p2.shortcode = $1 AND (proj.user_id = $2 OR up.user_id = $2)
           ) owned
          WHERE p.shortcode = owned.shortcode`,
        [id, userId, isHidden]
    );

    await client.query(
        `UPDATE tiktok_videos v
            SET is_hidden = $3, updated_at = CURRENT_TIMESTAMP
           FROM projects p
          WHERE v.project_id = p.id
            AND v.video_id = $1
            AND p.user_id = $2`,
        [id, userId, isHidden]
    );
}

module.exports = { syncHiddenAcrossTables };
