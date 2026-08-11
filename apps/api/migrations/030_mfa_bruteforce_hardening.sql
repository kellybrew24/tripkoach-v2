-- TRI-1061 [OWASP A07/A04-2] · MFA/OTP-verify brute-force hardening. The second-factor challenge
-- (POST /auth/mfa) had NO attempt cap and NO throttle in either realm: an attacker holding a victim's
-- password could flood 6-digit guesses against a live mfa_pending session and defeat 2FA in minutes.
-- Two persistent counters back the fix (the per-IP @fastify/rate-limit is registered in code):
--
--   • session.mfa_failed_count — per-pending-session attempt cap. Incremented on each wrong code;
--     at MFA_MAX_ATTEMPTS (auth.ts) the session is revoked, forcing a full re-login.
--   • user_account.failed_login_count / locked_until — the consumer analogue of the staff_user lockout
--     added in 029 (TRI-1054). MFA failures feed the SAME per-account counter as password failures, so
--     the account locks regardless of source IP (immune to IP rotation, which the per-IP limiter is not).
--     Admin already has these columns from 029; only the consumer side is new here.

ALTER TABLE session
  ADD COLUMN IF NOT EXISTS mfa_failed_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN session.mfa_failed_count IS 'TRI-1061: wrong /auth/mfa codes on this pending session; at MFA_MAX_ATTEMPTS (auth.ts) the session is revoked → full re-login required';

ALTER TABLE user_account
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until       timestamptz;

COMMENT ON COLUMN user_account.failed_login_count IS 'TRI-1061: consecutive failed password OR MFA attempts; cleared on a fully-completed login';
COMMENT ON COLUMN user_account.locked_until IS 'TRI-1061: account locked until this time after LOGIN_MAX_ATTEMPTS consecutive auth failures (password or MFA)';
