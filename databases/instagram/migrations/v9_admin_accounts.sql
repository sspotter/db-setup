-- Per-admin accounts, so the audit log can say which person acted. The shared ADMIN_PASSWORD
-- keeps working alongside them. Account login also needs ADMIN_JWT_SECRET in the environment.
-- Idempotent: safe to re-run. NOT applied automatically; run it once per database.

CREATE TABLE IF NOT EXISTS public.admin_accounts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    password_hash text NOT NULL,
    name          text,
    disabled_at   timestamptz,
    last_login    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_accounts_email_lower ON public.admin_accounts (lower(email));
