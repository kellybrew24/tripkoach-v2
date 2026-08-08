-- TRI-860 Phase 1 · Content, leads, org config. Tables scaffolded; content read endpoints are Phase 1.5+.

CREATE TABLE blog_post (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  tag           text,
  read_time     text,
  published_at  timestamptz,
  title         text NOT NULL,
  excerpt       text,
  hero_url      text,
  body          jsonb NOT NULL DEFAULT '[]',   -- block array
  canonical_url text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One table for all lead/enquiry forms (contact, pickup, esim, club, shop).
CREATE TABLE enquiry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('contact','pickup','esim','club','shop')),
  subject     text,
  name        text,
  email       text,
  phone       text,
  payload     jsonb NOT NULL DEFAULT '{}',   -- pickup adds arrival_date/time/flight/party/dropoff, etc.
  consent     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Singleton org config. Enforced single row via a fixed boolean PK.
CREATE TABLE settings (
  singleton                 boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  business_name             text,
  address                   text,
  support_phone             text,
  support_email             text,
  currency_of_record        text NOT NULL DEFAULT 'USD',
  secondary_display_currency text NOT NULL DEFAULT 'GHS',
  usd_to_ghs_display_rate   numeric(10,4) NOT NULL DEFAULT 15.6,
  cancellation_policy_text  text,
  payment_deadline_days     integer NOT NULL DEFAULT 5 CHECK (payment_deadline_days IN (3,5,7)),
  flags                     jsonb NOT NULL DEFAULT '{}',
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_preferences (
  staff_user_id  uuid PRIMARY KEY REFERENCES staff_user(id) ON DELETE CASCADE,
  theme          text,
  table_density  text,
  time_zone      text,
  start_page     text,
  flags          jsonb NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now()
);
