-- TRI-860 Phase 1 · Booking, travellers, payments, promos.
-- Schema is created now (Phase 1) so migrations are complete; WRITE paths land in Phase 2 (TRI booking+Paystack).

CREATE TABLE booking (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                  text NOT NULL UNIQUE,             -- human ref TK-####
  user_id              uuid,                             -- FK to user_account (004); nullable for guest
  customer_id          uuid,                             -- FK to customer (004)
  tour_id              uuid NOT NULL REFERENCES tour(id),
  departure_id         uuid NOT NULL REFERENCES departure(id),
  package_id           uuid REFERENCES tour_package(id),
  party_size           integer NOT NULL CHECK (party_size >= 1),
  unit_price_minor     integer NOT NULL CHECK (unit_price_minor >= 0),
  total_minor          integer NOT NULL CHECK (total_minor >= 0),
  currency             text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  status               text NOT NULL DEFAULT 'reserved'
                         CHECK (status IN ('reserved','pending','confirmed','cancelled','completed','failed')),
  payment_state        text NOT NULL DEFAULT 'unpaid'
                         CHECK (payment_state IN ('unpaid','pending','paid','refunded','failed')),
  reservation_expires_at timestamptz,
  special_requests     text,
  agreed_terms_at      timestamptz,
  cancel_reason        text CHECK (cancel_reason IS NULL OR cancel_reason IN
                         ('customer_request','non_payment','departure_cancelled','duplicate')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_departure_idx ON booking(departure_id);
CREATE INDEX booking_tour_idx      ON booking(tour_id);
CREATE INDEX booking_status_idx    ON booking(status);
-- Seat-holding bookings (reserved|confirmed) are the authoritative source for departure.seats_reserved.

CREATE TABLE booking_traveller (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  is_lead     boolean NOT NULL DEFAULT false,
  name        text NOT NULL,
  email       text,         -- lead carries contact
  phone       text,
  id_number   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_traveller_booking_idx ON booking_traveller(booking_id);

CREATE TABLE payment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE,             -- human ref PAY-####
  booking_id    uuid NOT NULL REFERENCES booking(id),
  amount_minor  integer NOT NULL,                 -- refunds may be negative/linked rows
  currency      text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  method        text NOT NULL CHECK (method IN ('paystack_card','mobile_money','bank','manual')),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','refunded','failed')),
  provider_ref  text,                             -- Paystack txn id / reference
  raw           jsonb,                            -- provider payload
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_booking_idx ON payment(booking_id);

CREATE TABLE promo_code (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,             -- stored upper-case
  type         text NOT NULL CHECK (type IN ('percent','fixed')),
  value        integer NOT NULL CHECK (value >= 0),  -- percent (0-100) or fixed minor units
  currency     text CHECK (currency IS NULL OR char_length(currency) = 3),  -- fixed only
  scope        text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','category','tour')),
  scope_ref    text,
  valid_from   timestamptz,
  valid_to     timestamptz,
  usage_limit  integer,
  used_count   integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_code_upper CHECK (code = upper(code))
);
