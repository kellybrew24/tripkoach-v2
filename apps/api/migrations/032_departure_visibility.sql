-- TRI-1136 / TRI-1137: private/unlisted departures for custom-date requests.
-- Adds a visibility column so admin-created departures for a specific customer
-- can be excluded from public listing while still being bookable via ?t= link.
-- 'public' keeps all existing rows unchanged (CHECK + DEFAULT, zero-downtime additive).

ALTER TABLE departure
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted'));
