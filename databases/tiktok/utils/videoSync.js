/**
 * Mirrors a hide/unhide for one TikTok video id onto the PER-PROJECT state:
 *   - project_posts: the hidden state lives on the project's own link row, so a hide
 *     in one project (or by one user) never touches another project or user.
 *   - tiktok_videos: the keyword view's row for the same video id, in the same projects.
 * Both are limited to projects the caller owns (projects.user_id = userId).
 *
 * projectIds (optional): limit the sync to these projects. Omitted / null means every
 * project the caller owns that has the video (the old "hide it everywhere I have it"
 * behaviour, but never anybody else's). An empty array touches nothing.
 *
 * A project that has the video in only one of the two tables is silently a no-op for
 * the other table (expected when a video was only ever captured on one side).
 *
 * Returns { posts, videos, projectIds }: the number of project_posts / tiktok_videos
 * rows changed and the ids of the projects whose project_posts row changed, so a
 * caller can answer 404 when nothing matched or apply a further per-project change.
 *
 * Pass a transaction client when the caller's own update must commit atomically with
 * this sync (posts.js's hide/delete routes do). tiktok_videos.js passes the plain
 * `pool`, matching those routes' existing non-transactional style.
 */
async function syncHiddenAcrossTables(client, id, userId, isHidden, projectIds = null) {
    const scope = Array.isArray(projectIds) ? projectIds : null;
    if (scope && scope.length === 0) return { posts: 0, videos: 0, projectIds: [] };

    const posts = await client.query(
        `UPDATE project_posts ppo
            SET is_hidden = $3::boolean,
                hidden_at = CASE WHEN $3::boolean THEN CURRENT_TIMESTAMP ELSE NULL END,
                deleted_at = CASE WHEN $3::boolean THEN ppo.deleted_at ELSE NULL END
           FROM projects proj
          WHERE ppo.project_id = proj.id
            AND ppo.post_shortcode = $1
            AND proj.user_id = $2
            AND ($4::uuid[] IS NULL OR ppo.project_id = ANY($4::uuid[]))
        RETURNING ppo.project_id`,
        [id, userId, isHidden, scope]
    );

    const videos = await client.query(
        `UPDATE tiktok_videos v
            SET is_hidden = $3::boolean, updated_at = CURRENT_TIMESTAMP
           FROM projects p
          WHERE v.project_id = p.id
            AND v.video_id = $1
            AND p.user_id = $2
            AND ($4::uuid[] IS NULL OR v.project_id = ANY($4::uuid[]))`,
        [id, userId, isHidden, scope]
    );

    const postRows = (posts && posts.rows) || [];
    return {
        posts: postRows.length,
        videos: (videos && videos.rowCount) || 0,
        projectIds: postRows.map((r) => r.project_id),
    };
}

module.exports = { syncHiddenAcrossTables };
