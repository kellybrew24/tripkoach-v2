-- TRI-941 · Customer account email verification (email-first). Adds a nullable verification stamp on the
-- account and a single-use, expiring verification token — mirroring the password-reset token pattern from
-- migration 012 (sha256-hashed, consumed-once, SQL-enforced expiry). ~24h TTL by default (cfg.consumer).
--
-- Enforcement is SOFT (board decision, TRI-941): guest checkout and bookings are NEVER gated on
-- verification. This schema only records "has this account confirmed its email?" for a badge + nudge and
-- for admin visibility; there is no gate.

-- ── user_account.email_verified_at: null until the account confirms its email; stamped once, then sticky ──
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
COMMENT ON COLUMN user_account.email_verified_at IS 'TRI-941: when the account confirmed its email (null = unverified). Soft signal — never gates checkout.';

-- ── email_verification_token: single-use, expiring token for the "verify your email" flow ───────────────
-- Same posture as password_reset_token (012): we store only the sha256 of the emailed token (never the
-- plaintext), a row is consumed exactly once (consumed_at set), and expiry is enforced in SQL.
CREATE TABLE IF NOT EXISTS email_verification_token (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,          -- sha256(hex) of the emailed token; never the raw token
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,                    -- set when the token is redeemed (single-use)
  requested_ip  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verification_token_user_idx    ON email_verification_token(user_id);
CREATE INDEX IF NOT EXISTS email_verification_token_expires_idx ON email_verification_token(expires_at);

COMMENT ON TABLE  email_verification_token IS 'TRI-941: single-use consumer email-verification tokens (sha256-hashed); issued on signup + resend, consumed via /api/v1/auth/verify-email';
COMMENT ON COLUMN email_verification_token.token_hash IS 'sha256 hex of the opaque token emailed to the user; the plaintext is never stored';
