-- Activity log: what a request did (project, rows written per table). Filled by the routes through
-- res.locals.activity.detail; never holds request bodies, tokens or passwords.
-- Idempotent: safe to re-run (startRetention() in middleware/activityLog.js runs it at boot).
ALTER TABLE public.api_events ADD COLUMN IF NOT EXISTS detail jsonb;
