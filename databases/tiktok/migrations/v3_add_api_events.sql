-- Admin activity log: one row per login attempt and per failed /api request,
-- so the admin page can show why a user can't log in or why their calls fail.
-- user_id has no FK on purpose: history survives a user delete.
-- Never stores passwords, tokens or request bodies.
-- Idempotent: safe to re-run (startRetention() in middleware/activityLog.js runs it at boot).

CREATE TABLE IF NOT EXISTS public.api_events (
    id          bigserial PRIMARY KEY,
    created_at  timestamptz NOT NULL DEFAULT now(),
    user_id     uuid,
    email       varchar(255),
    method      varchar(10) NOT NULL,
    path        varchar(500) NOT NULL,
    status      integer NOT NULL,
    reason      varchar(50),
    error       varchar(500),
    ip          varchar(100),
    user_agent  varchar(500),
    ext_version varchar(50)
);

-- Newest-first listing, per-user history, and case-insensitive email lookup.
CREATE INDEX IF NOT EXISTS idx_api_events_created_at ON public.api_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_events_user_created ON public.api_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_events_email_created ON public.api_events (lower(email), created_at DESC);
