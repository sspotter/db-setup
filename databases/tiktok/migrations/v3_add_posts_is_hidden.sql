-- Allow commentator/profile posts to be hidden from calculations & listings,
-- mirroring tiktok_videos.is_hidden used by the keyword dataset viewer.
-- Idempotent: safe to run against databases that already have the columns.

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS is_hidden boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

-- Speeds up the "exclude hidden" filter on the commentator/profile listings.
CREATE INDEX IF NOT EXISTS idx_posts_is_hidden ON public.posts (is_hidden);
