-- Admin can hide a profile inside one project (Overview > Profiles tab). The state lives on the
-- project's own project_profiles row, so other projects and users that follow the same
-- username are untouched. A hidden profile is left out of the user's profile list, profile
-- counts and partner/reach statistics for that project; the row itself is kept.
--
-- Idempotent: safe to run twice. Existing rows start visible.
-- Do not run against a live database without a backup (scripts/backup-db.sh).

ALTER TABLE public.project_profiles
    ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_project_profiles_hidden
    ON public.project_profiles (project_id) WHERE is_hidden = true;
