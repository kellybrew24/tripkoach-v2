-- TRI-912 P3 · Admin MFA enforcement (optional → required for admin/operator).
-- Board approved the TRI-911 recommendation: MFA becomes mandatory for privileged staff roles.
-- Backend gate lives in auth.ts + admin-routes.ts; the enforced-role set is config (MFA_ENFORCED_ROLES,
-- default 'admin,operator'). This migration adds the one bit of session state the gate needs.
--
-- session.mfa_enroll_pending: a factor-less login by an enforced role issues a half-auth ENROLL-gated
-- session. Unlike session.mfa_pending (from 015 — an MFA-enabled login awaiting its /auth/mfa code), an
-- enroll-pending session belongs to a staffer who has NO factor yet: it may reach ONLY the /auth/mfa/*
-- enroll+verify endpoints, and is promoted to a full session the moment a factor is confirmed. The auth
-- guard (resolveSession) rejects it for every privileged route until then. Idempotent for re-runs.
ALTER TABLE session ADD COLUMN IF NOT EXISTS mfa_enroll_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN session.mfa_enroll_pending IS 'true = factor-less login by an MFA-enforced role (TRI-912); may reach only /auth/mfa/* enroll until a factor is confirmed, then promoted';
