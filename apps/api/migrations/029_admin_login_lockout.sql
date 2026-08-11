-- TRI-1054 [SEC-H2] · Admin login brute-force lockout. The console showed a cosmetic "N attempts left"
-- but the server enforced nothing. Back it with a per-account counter + lock window: after
-- LOGIN_MAX_ATTEMPTS (auth.ts) consecutive failed password attempts the account is locked until
-- locked_until; a successful login clears both. Complements the per-IP @fastify/rate-limit on the
-- login route (this counter is per-account and immune to IP rotation/spoofing).

ALTER TABLE staff_user
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until       timestamptz;
