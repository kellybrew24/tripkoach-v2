-- TRI-860 Phase 1 · Inventory — the no-oversell core (§2.x of the Phase 0 spec).
-- Seats are only ever counted against a DEPARTURE (a dated instance of a tour), never a tour.

CREATE TABLE departure (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id         uuid NOT NULL REFERENCES tour(id) ON DELETE CASCADE,
  package_id      uuid REFERENCES tour_package(id) ON DELETE SET NULL,
  guide_id        uuid,   -- FK to guide added in 004_people.sql
  depart_on       date,                       -- machine date when known
  date_label      text NOT NULL,              -- human label as authored, e.g. "Sat 15 Aug 2026"
  time_label      text,                       -- e.g. "09:00 · Hotel pickup, Accra"
  price_minor     integer CHECK (price_minor IS NULL OR price_minor >= 0),  -- NULL → fall back to tier
  currency        text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  seats_total     integer NOT NULL CHECK (seats_total >= 0),
  -- Denormalised cache of Σ party_size over seat-holding bookings; authoritative count is recomputed
  -- in the reserve transaction (Phase 2). The CHECK below is the seatbelt against negative availability.
  seats_reserved  integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','sold_out','completed','cancelled')),
  notes_internal  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- The no-oversell invariant, enforced by the database regardless of application logic:
  CONSTRAINT departure_no_oversell CHECK (seats_reserved BETWEEN 0 AND seats_total)
);
CREATE INDEX departure_tour_idx   ON departure(tour_id);
CREATE INDEX departure_status_idx ON departure(status);
CREATE INDEX departure_date_idx   ON departure(depart_on);
