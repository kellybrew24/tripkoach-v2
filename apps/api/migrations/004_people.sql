-- TRI-860 Phase 1 · People — consumer accounts, ops customers, guides, notification prefs.

CREATE TABLE user_account (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL UNIQUE,
  password_hash       text,                 -- argon2id (Phase 2 auth)
  name                text,
  phone               text,
  country             text,
  photo_url           text,
  emergency_name      text,
  emergency_phone     text,
  dietary_needs       text,
  language            text NOT NULL DEFAULT 'en',
  display_currency    text NOT NULL DEFAULT 'USD',
  data_saver          boolean NOT NULL DEFAULT false,
  two_factor_enabled  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Ops-side view of a booker. Phase 1 kickoff decision (§2): SPLIT — customer is a distinct row so
-- guest/offline bookings are representable; an optional user_id links it to a consumer account when one
-- exists. LTV/VIP/pending are derived at read time, never stored.
CREATE TABLE customer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES user_account(id) ON DELETE SET NULL,
  name        text NOT NULL,
  email       text,
  phone       text,
  country     text,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_email_idx ON customer(email);

-- Now wire the deferred booking FKs.
ALTER TABLE booking ADD CONSTRAINT booking_user_fk
  FOREIGN KEY (user_id) REFERENCES user_account(id) ON DELETE SET NULL;
ALTER TABLE booking ADD CONSTRAINT booking_customer_fk
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL;

CREATE TABLE guide (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text,
  phone       text,
  base        text,
  regions     text[] NOT NULL DEFAULT '{}',
  languages   text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','leave','disabled')),
  rating      numeric(2,1),
  trips_led   integer NOT NULL DEFAULT 0,
  bio         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE departure ADD CONSTRAINT departure_guide_fk
  FOREIGN KEY (guide_id) REFERENCES guide(id) ON DELETE SET NULL;

CREATE TABLE notification_preference (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  channel   text NOT NULL CHECK (channel IN ('email','whatsapp')),
  type      text NOT NULL CHECK (type IN
              ('booking_confirmations','payment_reminders','departure_reminders',
               'review_reminders','marketing_offers','urgent_updates','koach_messages')),
  enabled   boolean NOT NULL DEFAULT true,
  UNIQUE (user_id, channel, type)
);
