-- Hidden / soft-deleted state now belongs to the PROJECT (project_posts), not to the
-- shared posts row. Before this, posts.is_hidden / posts.deleted_at were global, so one
-- user's hide affected every user and project, and a user who deleted a project and
-- re-created it with the same name still saw the old posts as hidden.
--
-- After this migration a new project_posts row starts visible (is_hidden = false,
-- deleted_at NULL), so a re-created project treats re-scraped posts as new.
-- posts.is_hidden / hidden_at / deleted_at are NOT dropped; the application no longer
-- reads or writes them.
--
-- Idempotent: the columns and the one-time backfill run only when project_posts has no
-- is_hidden column yet, so re-running this file never re-hides something a user has since
-- unhidden. Indexes use IF NOT EXISTS.
-- Do not run against a live database without a backup (scripts/backup-db.sh).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'project_posts' AND column_name = 'is_hidden'
    ) THEN
        ALTER TABLE public.project_posts
            ADD COLUMN is_hidden  boolean     NOT NULL DEFAULT false,
            ADD COLUMN hidden_at  timestamptz,
            ADD COLUMN deleted_at timestamptz;

        -- Keep today's visible state: every project that links a currently hidden or
        -- soft-deleted post starts with that post hidden / deleted.
        UPDATE public.project_posts pp
           SET is_hidden  = COALESCE(p.is_hidden, false),
               hidden_at  = p.hidden_at,
               deleted_at = p.deleted_at
          FROM public.posts p
         WHERE p.shortcode = pp.post_shortcode
           AND (p.is_hidden = true OR p.deleted_at IS NOT NULL);
    END IF;
END $$;

-- Speeds up the "exclude hidden" filter on project listings and the Hidden Posts tab.
CREATE INDEX IF NOT EXISTS idx_project_posts_visible
    ON public.project_posts (project_id) WHERE is_hidden = false AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_posts_hidden
    ON public.project_posts (project_id) WHERE is_hidden = true;
