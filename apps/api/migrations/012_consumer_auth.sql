-- TRI-881 P1 · Consumer accounts & auth. The account tables (user_account, notification_preference)
-- and the session table already exist from Phase 1 (migrations 004 / 006) — this migration adds ONLY
-- the greenfield password-reset token table (audit gap C10) and the indexes the consumer auth spine
-- needs. Session infra already permits subject_type='user' (006); the code path is enabled in Phase 2/
-- this slice (closes gap G-ConsumerSession).

-- ── password_reset_token: single-use, expiring token for the ForgotWeb 4-stage reset flow ─────────
-- We store only a SHA-256 hash of the opaque token (never the plaintext), so a DB read can't be used
-- to reset an account. A row is consumed exactly once (consumed_at set); expiry is enforced in SQL.
CREATE TABLE password_reset_token (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,          -- sha256(hex) of the emailed token; never the raw token
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,                    -- set when the token is redeemed (single-use)
  requested_ip  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_token_user_idx    ON password_reset_token(user_id);
CREATE INDEX password_reset_token_expires_idx ON password_reset_token(expires_at);

COMMENT ON TABLE  password_reset_token IS 'TRI-881: single-use consumer password-reset tokens (sha256-hashed); request/consume via /api/v1/auth/password-reset/*';
COMMENT ON COLUMN password_reset_token.token_hash IS 'sha256 hex of the opaque token emailed to the user; the plaintext is never stored';

-- Helpful lookups for the consumer account layer.
CREATE INDEX IF NOT EXISTS user_account_email_lower_idx ON user_account (lower(email));
CREATE INDEX IF NOT EXISTS booking_user_idx             ON booking (user_id);
CREATE INDEX IF NOT EXISTS notification_preference_user_idx ON notification_preference (user_id);
