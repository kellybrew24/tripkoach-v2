-- TRI-983 · "Trust this device for 30 days" (admin login). Parent TRI-977.
--
-- BEFORE this migration the login checkbox was a NO-OP: it wrote session.trusted_device (migration 006)
-- but nothing ever read that flag, so an MFA-enabled staffer was TOTP-challenged on every login regardless
-- of the box. The session row is also short-lived (30-min sliding idle) — the wrong place to remember a
-- device for 30 days.
--
-- This table backs a proper trusted-device credential: when a staffer completes MFA with the box checked,
-- the API mints a random token, stores only its SHA-256 hash here with a 30-day TTL, and sets a separate
-- long-lived httpOnly cookie (tk_admin_trust) on the device. On a later login the API hashes the presented
-- cookie, matches a live row FOR THAT STAFF USER, and skips the TOTP step. Scoping the match to staff_id
-- means a trusted cookie can never let a different account skip MFA. Only the hash is stored, so a DB read
-- cannot reconstruct a usable cookie.
CREATE TABLE trusted_device (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,          -- SHA-256 hex of the opaque cookie token (never the token itself)
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,          -- created_at + 30 days; a fixed window, honest to the UI copy
  last_used_at timestamptz,                   -- stamped each time the token skips a challenge
  ip           text,
  user_agent   text,
  revoked_at   timestamptz                    -- set to forget a device (e.g. on MFA disable) without deleting the row
);
CREATE INDEX trusted_device_staff_idx ON trusted_device(staff_id);
