-- Admin audit trail: one row per admin action (create/update/delete user, force logout,
-- reset link, delete project, admin login success/failure/lockout).
-- Idempotent: safe to re-run. NOT applied automatically; run it once per database.
-- Never store passwords, reset tokens or links in detail.

CREATE TABLE IF NOT EXISTS public.admin_audit (
    id             bigserial PRIMARY KEY,
    created_at     timestamptz NOT NULL DEFAULT now(),
    actor          text NOT NULL DEFAULT 'admin',
    action         text NOT NULL,
    target_user_id uuid,
    target_email   varchar(255),
    detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip             varchar(100)
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON public.admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_created ON public.admin_audit (action, created_at DESC);
