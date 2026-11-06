-- Admin-side hide / soft-delete of a project's posts (Instagram), same design as the
-- TikTok v6_project_post_hide.sql: the state belongs to the project link (project_posts),
-- never to the shared posts row, so hiding or deleting in one project/user does not touch
-- any other project or user.
--
-- A new project_posts row starts visible (is_hidden = false, deleted_at NULL).
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS, safe to re-run.
-- Apply this BEFORE deploying the code that reads these columns.
-- Do not run against a live database without a backup (scripts/backup-db.sh).

ALTER TABLE public.project_posts
    ADD COLUMN IF NOT EXISTS is_hidden  boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS hidden_at  timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_project_posts_visible
    ON public.project_posts (project_id) WHERE is_hidden = false AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_posts_hidden
    ON public.project_posts (project_id) WHERE is_hidden = true;
