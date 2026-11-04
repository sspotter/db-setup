-- IP addresses refused at the login routes (POST /api/auth/login and POST /api/admin/login) only.
-- Every block expires: an office shares one address, so a block must not last forever.
-- Idempotent: safe to re-run. NOT applied automatically; run it once per database.

CREATE TABLE IF NOT EXISTS public.blocked_ips (
    ip         text PRIMARY KEY,
    reason     text,
    blocked_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocked_ips_expires_at ON public.blocked_ips (expires_at);
