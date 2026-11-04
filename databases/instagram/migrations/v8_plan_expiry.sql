-- Plan / trial expiry dates (informational: login does not enforce them).
-- Idempotent: safe to re-run. NOT applied automatically; run it once per database.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
