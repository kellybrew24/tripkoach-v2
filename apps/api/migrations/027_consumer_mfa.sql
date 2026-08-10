-- TRI-1029 · Consumer two-factor authentication (TOTP).
--
-- Backs real customer-facing 2FA — the account "Turn on two-factor" toggle (previously inert, then an
-- honest "Coming soon" per TRI-1018) now enrolls a real authenticator factor and challenges it at login.
-- Mirrors the admin MFA spine (migrations 006 + 015: mfa_factor / recovery_code, staff_user.mfa_enabled)
-- but on user_account. Two things differ from the staff side and are reused, not duplicated:
--   • user_account.two_factor_enabled ALREADY exists (migration 004) — it is the consumer analogue of
--     staff_user.mfa_enabled, so no new "enabled" flag is added here.
--   • session.mfa_pending ALREADY exists (migration 015) and the session table is shared across
--     subject_type IN ('user','staff') — so the consumer login challenge reuses it directly: a login by a
--     2FA-enabled customer mints a half-auth session (mfa_pending=true) that resolves to NO context until
--     POST /auth/mfa clears it. No schema change needed for the gate.
--
-- New here: the per-user factor + recovery-code tables (FK'd to user_account, cascade on account delete).

CREATE TABLE user_mfa_factor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'totp' CHECK (type IN ('totp')),
  secret        text NOT NULL,          -- base32 TOTP shared secret (encrypt-at-rest is a later hardening)
  confirmed_at  timestamptz,            -- NULL = enrollment pending (secret issued, not yet proven)
  added_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_mfa_factor_user_idx ON user_mfa_factor(user_id);

CREATE TABLE user_recovery_code (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  code_hash     text NOT NULL,          -- argon2id hash of the normalized single-use code
  used_at       timestamptz
);
CREATE INDEX user_recovery_code_user_idx ON user_recovery_code(user_id);

COMMENT ON COLUMN user_mfa_factor.confirmed_at IS 'NULL = enrollment pending (secret issued, not proven); set on first verified code';
