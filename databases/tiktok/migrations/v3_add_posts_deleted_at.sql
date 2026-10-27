-- Soft-delete support for posts (Dataset Viewer), mirroring the deleted_at-less
-- hard delete on tiktok_videos, but recoverable — deleting a post here must
-- not destroy history the Keywords/Hashtag view still owns.
-- Idempotent: safe to run against databases that already have the column.

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON public.posts (deleted_at);
