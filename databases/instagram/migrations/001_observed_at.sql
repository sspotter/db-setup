-- "Newest observation wins": record when a number was seen on Instagram,
-- separately from when we stored it. See observed.js.
--
-- Nullable with NO default on purpose: rows written without an explicit
-- observation time (old clients, coauthor backfills) must land as NULL so the
-- merge rules in observed.js treat them as unstamped and never let them
-- overwrite a genuinely observed value.

ALTER TABLE ig_users             ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE posts                ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE post_metrics_history ADD COLUMN IF NOT EXISTS observed_at timestamptz;

-- Serves LATEST_METRICS_ORDER(): the per-post "current metrics" lookup.
CREATE INDEX IF NOT EXISTS idx_pmh_shortcode_observed
    ON post_metrics_history (post_shortcode, observed_at DESC NULLS LAST, captured_at DESC);

-- One history row per real observation. Partial so the unstamped rows that
-- old clients still write stay exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pmh_shortcode_observed
    ON post_metrics_history (post_shortcode, observed_at)
    WHERE observed_at IS NOT NULL;
