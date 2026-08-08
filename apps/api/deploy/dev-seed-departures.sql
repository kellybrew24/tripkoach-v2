-- TRI-930 · Dev seed: backfill scheduled departures for published tours that have none.
--
-- Context: the TRI-913/914 live-catalogue import created 11 published tours on
-- dev (tripkoach_dev) but only two of them (accra-city-tour,
-- discover-ghana-in-10-days) carried departures. The other nine were
-- un-bookable — no departure to select, so checkout/booking could not proceed
-- and the board saw the whole flow fall back to the lead tour. This backfills
-- three future scheduled departures per un-covered tour, priced at the tour's
-- base ("from") price so displayed == quoted == charged for every tour.
--
-- Idempotent: only inserts for published tours that currently have ZERO
-- departures, so re-running is a no-op once every tour is covered.
-- Applied to tripkoach_dev on 2026-08-08 (INSERT 0 27 → 9 tours × 3).
--
-- Run: sudo -u postgres psql -d tripkoach_dev -f dev-seed-departures.sql

BEGIN;

INSERT INTO departure
  (tour_id, depart_on, date_label, time_label, price_minor, currency, seats_total, seats_reserved, status)
SELECT
  t.id,
  (current_date + v.off),
  to_char((current_date + v.off), 'Dy FMDD Mon YYYY'),
  CASE WHEN t.duration ~* 'day' AND t.duration !~* '^1 day'
       THEN 'Airport pickup, KIA Accra'
       ELSE '09:00 · Hotel pickup, Accra' END,
  t.base_price_minor,       -- departure price = the tour's "from" price
  t.currency,
  12,
  v.seats_res,
  'scheduled'
FROM tour t
CROSS JOIN (VALUES (30, 3), (58, 5), (86, 2)) AS v(off, seats_res)
WHERE t.published = true
  AND NOT EXISTS (SELECT 1 FROM departure d WHERE d.tour_id = t.id);

COMMIT;
