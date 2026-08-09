-- TRI-1000 · Staff (admin console) password reset. The consumer realm already has password_reset_token
-- (012) for user_account; the admin realm had NO forgot-password backend at all (the console's "Forgot
-- password?" and in-app "Change password" were front-end-only fakes). This adds the staff equivalent:
-- a single-use, expiring, sha256-hashed token keyed to staff_user, redeemed via /api/admin/auth/
-- password-reset/{request,consume}. Same posture as 012: we store ONLY the sha256 of the emailed token
-- (never the plaintext), a row is consumed exactly once (consumed_at), and expiry is enforced in SQL.

CREATE TABLE IF NOT EXISTS staff_password_reset (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,          -- sha256(hex) of the emailed token; never the raw token
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,                    -- set when the token is redeemed (single-use)
  requested_ip  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_password_reset_staff_idx   ON staff_password_reset(staff_user_id);
CREATE INDEX IF NOT EXISTS staff_password_reset_expires_idx ON staff_password_reset(expires_at);

COMMENT ON TABLE  staff_password_reset IS 'TRI-1000: single-use staff password-reset tokens (sha256-hashed); request/consume via /api/admin/auth/password-reset/*';
COMMENT ON COLUMN staff_password_reset.token_hash IS 'sha256 hex of the opaque token emailed to the staff member; the plaintext is never stored';
