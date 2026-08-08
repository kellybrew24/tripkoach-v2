-- TRI-860 Phase 1 · Reviews + one-time review invitations.

CREATE TABLE review (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id      uuid NOT NULL REFERENCES tour(id) ON DELETE CASCADE,
  booking_id   uuid REFERENCES booking(id) ON DELETE SET NULL,  -- provenance
  author_name  text NOT NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text,
  text         text NOT NULL DEFAULT '',
  verified     boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reply        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_tour_idx        ON review(tour_id);
CREATE INDEX review_tour_status_idx ON review(tour_id, status);  -- public read filters status=approved

CREATE TABLE review_invite (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text NOT NULL UNIQUE,             -- one-time
  booking_id      uuid REFERENCES booking(id) ON DELETE SET NULL,
  tour_id         uuid NOT NULL REFERENCES tour(id) ON DELETE CASCADE,
  traveller_name  text,
  traveller_email text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  redeemed_at     timestamptz
);
