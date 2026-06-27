-- Backfill posted_at for TikTok videos that were captured before posted_at
-- was persisted (e.g. via the DOM search-card scraper, which never sent a date).
--
-- TikTok video IDs are 64-bit snowflakes whose top 32 bits encode the creation
-- time in Unix seconds, so the real post date is recoverable from the ID alone:
--     posted_at = to_timestamp(floor(video_id / 2^32))
--
-- We use numeric division (not a ::bigint bit-shift) because some 19-20 digit
-- IDs exceed the signed bigint max and would overflow on cast.
--
-- Only touches rows where posted_at IS NULL. Idempotent: re-running is a no-op
-- once the dates are filled. The numeric-ID filter happens in the CTE WHERE so
-- the ::numeric cast never runs against a non-numeric video_id.

WITH numeric_videos AS (
    SELECT id, floor((video_id)::numeric / 4294967296) AS posted_epoch  -- 4294967296 = 2^32
    FROM public.tiktok_videos
    WHERE posted_at IS NULL
      AND video_id ~ '^\d{15,20}$'
)
UPDATE public.tiktok_videos v
SET posted_at = to_timestamp(nv.posted_epoch)
FROM numeric_videos nv
WHERE v.id = nv.id
  AND nv.posted_epoch BETWEEN 1451606400                                 -- 2016-01-01
                          AND (extract(epoch FROM now())::bigint + 86400); -- now + 1d
