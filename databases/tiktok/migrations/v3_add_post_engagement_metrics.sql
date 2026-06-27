-- TikTok engagement metrics (views/reposts/shares/bookmarks).
-- The posts batch route (routes/posts.js) reads & writes these columns, but the
-- original schema only stored likes/comments/video_view_count. Without them the
-- reposts/shares/bookmarks values are dropped on save and always render as 0.
-- Idempotent: safe to run against databases that already have the columns.

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS view_count     bigint  DEFAULT 0,
    ADD COLUMN IF NOT EXISTS repost_count   integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS share_count    integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bookmark_count integer DEFAULT 0;

ALTER TABLE public.post_metrics_history
    ADD COLUMN IF NOT EXISTS view_count     bigint  DEFAULT 0,
    ADD COLUMN IF NOT EXISTS repost_count   integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS share_count    integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bookmark_count integer DEFAULT 0;
