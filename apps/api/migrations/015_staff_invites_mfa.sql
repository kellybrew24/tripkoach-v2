-- TRI-895 P3 · Staff management (invite→provision→accept) + admin MFA.
-- Wires audit item A4 (staff mgmt) and the admin-MFA-only board decision (TRI-878). The staff/RBAC/MFA
-- tables themselves already exist from Phase 1 migration 006_staff_rbac_auth.sql (staff_user with
-- status invited/active/disabled + mfa_enabled, role_permission, mfa_factor, recovery_code, session).
-- This migration adds only what the invite + MFA flows need on top of 006:
--   • staff_invite     — the opaque invite tokens (hashed) that redeem an 'invited' user to 'active'
--   • mfa_factor.confirmed_at — a TOTP factor is PENDING at enrollment, CONFIRMED once a code verifies
--   • session.mfa_pending     — a login by an MFA-enabled staff issues a half-auth session that only the
--                               /auth/mfa challenge can promote; the auth guard rejects it until then
--
-- Migration numbering: 011 = email transport (tri-880), 012 = reviews write (tri-892). 013 is ours.

-- ── staff_invite: one row per outstanding/redeemed invite ────────────────────────────────────
-- We store only a SHA-256 hash of the opaque token (never the raw token); the raw token travels once,
-- in the invite email link. Re-inviting a staff member issues a fresh row (the newest unaccepted,
-- unexpired row for a user is the live invite); older rows simply expire. accepted_at stamps redemption.
CREATE TABLE staff_invite (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id  uuid NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,                 -- sha256(raw token), hex
  invited_by     uuid REFERENCES staff_user(id) ON DELETE SET NULL,
  email          text NOT NULL,                 -- snapshot of the invited address (for the audit trail)
  expires_at     timestamptz NOT NULL,
  accepted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_invite_token_hash_idx ON staff_invite(token_hash);
CREATE INDEX staff_invite_user_idx ON staff_invite(staff_user_id);

-- ── mfa_factor: pending vs confirmed ─────────────────────────────────────────────────────────
-- Enrollment inserts a factor with confirmed_at = NULL (secret generated, not yet proven). The first
-- successful verify stamps confirmed_at and flips staff_user.mfa_enabled = true. Unconfirmed factors are
-- ignored by the login challenge and replaced on a fresh enroll.
ALTER TABLE mfa_factor ADD COLUMN confirmed_at timestamptz;

-- ── session.mfa_pending: the half-auth login state ───────────────────────────────────────────
-- Login by an MFA-enabled staff member creates a session with mfa_pending = true and sets the cookie,
-- but the auth guard treats a pending session as unauthenticated (resolveSession returns null). Only
-- POST /auth/mfa, on a valid TOTP/recovery code, clears the flag and completes the sign-in.
ALTER TABLE session ADD COLUMN mfa_pending boolean NOT NULL DEFAULT false;

COMMENT ON TABLE  staff_invite            IS 'Outstanding/redeemed staff invites (TRI-895): hashed opaque token → redeem invited→active';
COMMENT ON COLUMN mfa_factor.confirmed_at IS 'NULL = enrollment pending (secret issued, not proven); set on first verified code';
COMMENT ON COLUMN session.mfa_pending     IS 'true = MFA-enabled login awaiting the /auth/mfa second factor; auth guard rejects until cleared';
