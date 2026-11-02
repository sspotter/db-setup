-- Admin diagnostics: request duration, real server-side 5xx message, per-user last authenticated call.
-- Idempotent: safe to re-run (startRetention() in middleware/activityLog.js runs it at boot).

ALTER TABLE public.api_events ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE public.api_events ADD COLUMN IF NOT EXISTS server_error varchar(1000);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen timestamptz;

-- Slow-endpoint and per-path failure aggregates scan recent rows by path.
CREATE INDEX IF NOT EXISTS idx_api_events_path_created ON public.api_events (path, created_at DESC);
