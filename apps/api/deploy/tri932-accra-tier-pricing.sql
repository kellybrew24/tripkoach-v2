-- TRI-932: accra-city-tour advertised "from $65" but cheapest bookable departure was $75.
--
-- Root cause: the tour's price_tier table already mirrors production exactly
--   (min_pax 1 -> $100 solo, 2 -> $75 small group, 6 -> $65 group) and
--   base_price_minor = 6500 ($65) = the group tier = the advertised "from" price.
-- But all 4 departures hard-coded price_minor = 7500 ($75). booking.ts unitPriceMinor()
-- returns the departure-price override AHEAD of the tier step-function, so the tiers
-- were dead: every party size was charged a flat $75, the advertised $65 group rate
-- was unreachable, and solo was under-charged ($75 vs production $100).
--
-- Fix: null the flat departure overrides so tier pricing (which matches production)
-- drives the charge. Advertised "from $65" is then reachable (party of 6+), solo pays
-- $100, small groups $75 — exactly production's priceTable. departureDTO passes the
-- null through and the DeparturePicker hides the (now tier-based) per-departure price.
--
-- Idempotent. Dev only.
UPDATE departure
   SET price_minor = NULL, updated_at = now()
 WHERE tour_id = (SELECT id FROM tour WHERE slug = 'accra-city-tour')
   AND price_minor IS NOT NULL;
