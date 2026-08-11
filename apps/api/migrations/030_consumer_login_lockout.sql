-- TRI-1065 (item 3, A07) · Consumer login brute-force lockout. TRI-1055 added a per-IP throttle on the
-- consumer auth routes, but that does not slow a distributed / rotating-IP spray against a single account.
-- Back a per-account counter + lock window on user_account (mirrors the admin/staff lockout, migration 029
-- + auth.ts): after LOGIN_MAX_ATTEMPTS consecutive failed password attempts the account locks until
-- locked_until; a successful password verification clears both.

ALTER TABLE user_account
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until       timestamptz;
