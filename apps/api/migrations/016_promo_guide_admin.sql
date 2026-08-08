-- TRI-896 P3 · Wire promo redemption onto the booking row.
-- Guides (mig 004) and promo_code (mig 003, incl. used_count) are already fully featured, so the only
-- schema gap is linking a redeemed promo to the booking it discounted: needed to (a) reflect the discount
-- on read (getByRef / admin views), and (b) release the redemption when a promo-bearing hold is cancelled
-- or expires, so limited codes aren't permanently consumed by abandoned reservations.

ALTER TABLE booking
  ADD COLUMN promo_code_id  uuid REFERENCES promo_code(id),
  ADD COLUMN discount_minor integer NOT NULL DEFAULT 0 CHECK (discount_minor >= 0);

CREATE INDEX booking_promo_idx ON booking(promo_code_id) WHERE promo_code_id IS NOT NULL;
