-- TRI-892 P2 · Reviews write — additive constraints for the invite-issuance → tokenized redeem flow.
-- The `review` and `review_invite` tables already exist (005_reviews.sql, Phase 1). We add ONLY what the
-- write path needs; ships alongside 011 (email transport) which the invite email uses.
--
-- Idempotency guard: the admin "end departure & request reviews" action must not double-issue an invite
-- for the same booking. A partial UNIQUE index on booking_id (ignoring the nullable/SET NULL provenance
-- rows) enforces one-invite-per-booking at the DB level, backing the application's pre-insert check so a
-- concurrent double-click can never create two live tokens for one booking.
CREATE UNIQUE INDEX IF NOT EXISTS review_invite_booking_uniq
  ON review_invite (booking_id)
  WHERE booking_id IS NOT NULL;

-- Lookup by (unredeemed) token drives the consumer redeem context + submit; the UNIQUE(token) from 005
-- already indexes exact-token lookups. This partial index speeds "still-open invites" scans (admin/ops).
CREATE INDEX IF NOT EXISTS review_invite_open_idx
  ON review_invite (tour_id)
  WHERE redeemed_at IS NULL;
