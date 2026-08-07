-- TRI-860 Phase 1 · Catalogue (clean-room; derived from the v2 SPA fixtures, zero v1 assets)
-- Money is stored as integer MINOR units (USD cents) + an explicit currency. Never floats.

CREATE TABLE region (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  note        text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tour (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE,
  title               text NOT NULL,
  region_id           uuid NOT NULL REFERENCES region(id),
  category            text NOT NULL CHECK (category IN ('cultural','adventure','city','luxury')),
  category_label      text NOT NULL,           -- display label as authored (e.g. "Cultural Discovery")
  duration            text NOT NULL,           -- human string, e.g. "10 days", "3 to 4 hrs · Half day"
  blurb               text NOT NULL DEFAULT '',
  highlights          text[] NOT NULL DEFAULT '{}',
  included            text[] NOT NULL DEFAULT '{}',
  excluded            text[] NOT NULL DEFAULT '{}',
  itinerary           jsonb NOT NULL DEFAULT '[]',   -- array of [label, text] pairs
  pricing_display     jsonb NOT NULL DEFAULT '[]',   -- array of [label, priceText] pairs as authored
  images              text[] NOT NULL DEFAULT '{}',
  image               text,                          -- primary/hero image url
  currency            text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  base_price_minor    integer NOT NULL CHECK (base_price_minor >= 0),  -- the "from" (cheapest tier) price
  tag                 text,                          -- marketing badge e.g. "Best seller"
  spots_left_hint     integer,                       -- authored card scarcity badge; real inventory is per-departure
  default_package_id  uuid,                          -- FK added after tour_package exists
  rating_cached       numeric(2,1),                  -- recomputed from approved reviews
  review_count_cached integer NOT NULL DEFAULT 0,
  published           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tour_region_idx   ON tour(region_id);
CREATE INDEX tour_category_idx ON tour(category);

CREATE TABLE tour_package (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     uuid NOT NULL REFERENCES tour(id) ON DELETE CASCADE,
  slug        text NOT NULL,             -- package-local id e.g. "route1"
  name        text NOT NULL,
  tag         text,
  blurb       text NOT NULL DEFAULT '',
  duration    text,
  stops       text[] NOT NULL DEFAULT '{}',
  includes    text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour_id, slug)
);
CREATE INDEX tour_package_tour_idx ON tour_package(tour_id);

ALTER TABLE tour
  ADD CONSTRAINT tour_default_package_fk
  FOREIGN KEY (default_package_id) REFERENCES tour_package(id) ON DELETE SET NULL;

-- Per-person price is a step function of party size; the largest min_pax is the "from" price.
CREATE TABLE price_tier (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     uuid REFERENCES tour(id) ON DELETE CASCADE,
  package_id  uuid REFERENCES tour_package(id) ON DELETE CASCADE,
  min_pax     integer NOT NULL CHECK (min_pax >= 1),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- exactly one parent
  CONSTRAINT price_tier_one_parent CHECK (
    (tour_id IS NOT NULL)::int + (package_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX price_tier_tour_idx    ON price_tier(tour_id);
CREATE INDEX price_tier_package_idx ON price_tier(package_id);
