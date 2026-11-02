-- Admin-generated password reset links. Only the sha256 of the token is stored.
-- Idempotent: safe to re-run (startRetention() in middleware/activityLog.js runs it at boot).

CREATE TABLE IF NOT EXISTS public.password_resets (
    token_hash  char(64) PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON public.password_resets (user_id);
