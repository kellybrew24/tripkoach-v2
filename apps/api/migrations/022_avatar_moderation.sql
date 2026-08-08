-- TRI-943 · Customer avatar upload + image moderation (parent TRI-942 → TRI-857). Board posture:
-- Option A "show-then-moderate" — an uploaded avatar goes live immediately once it clears the hardened
-- automated gate; a report or an admin action auto-hides it into a moderation queue. v1's gate is the
-- hardened validation in the upload path (magic-byte + type allow-list + size + dimension caps); the paid
-- image classifier is a fast-follow that plugs into the moderateImage() seam without touching this schema.
--
-- Storage rides the existing TRI-918 R2 pipeline (media_asset, migration 020) — no new object store. The
-- avatar is just a user_account pointer at a media_asset row plus a moderation status.

-- ── user_account: point at the chosen avatar + carry its moderation state ────────────────────────────────
-- avatar_media_id  → the published media_asset (null = no avatar / default placeholder).
-- avatar_status    → moderation lifecycle. NULL means "no avatar set". Once an avatar exists it is one of:
--                    pending  (awaiting review — reserved for when the classifier defers),
--                    approved (live / visible — the v1 auto-gate result),
--                    rejected (admin-declined; hidden from /me + public, default shown instead),
--                    hidden   (auto-hidden by a report or admin remove; in the queue for review).
-- avatar_updated_at→ when the avatar or its status last changed (queue ordering / audit).
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS avatar_media_id  uuid REFERENCES media_asset(id) ON DELETE SET NULL;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS avatar_status    text;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_account_avatar_status_check') THEN
    ALTER TABLE user_account ADD CONSTRAINT user_account_avatar_status_check
      CHECK (avatar_status IS NULL OR avatar_status IN ('pending','approved','rejected','hidden'));
  END IF;
END $$;

COMMENT ON COLUMN user_account.avatar_media_id IS 'TRI-943: FK to the published media_asset used as this account''s avatar (null = default placeholder).';
COMMENT ON COLUMN user_account.avatar_status   IS 'TRI-943: avatar moderation state — null(none)|pending|approved|rejected|hidden. rejected/hidden are never served publicly.';

-- ── avatar_moderation_action: append-only audit trail of every moderation event on an avatar ─────────────
-- One row per action so the admin queue can show "why is this hidden?" and finance/trust can reconstruct
-- the full history. actor_id is polymorphic (staff_user for admin, user_account for customer, null for
-- system) so it carries no FK; user_id (the avatar owner) does.
CREATE TABLE IF NOT EXISTS avatar_moderation_action (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,   -- the avatar's owner (target)
  media_id    uuid REFERENCES media_asset(id) ON DELETE SET NULL,            -- the avatar image acted on (nullable)
  action      text NOT NULL CHECK (action IN ('approve','reject','remove','report','auto_flag')),
  actor_type  text NOT NULL CHECK (actor_type IN ('admin','system','customer')),
  actor_id    uuid,                                                          -- staff_user / user_account id; null for system
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS avatar_moderation_action_user_idx    ON avatar_moderation_action(user_id);
CREATE INDEX IF NOT EXISTS avatar_moderation_action_actor_idx   ON avatar_moderation_action(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS avatar_moderation_action_created_idx ON avatar_moderation_action(created_at);

COMMENT ON TABLE avatar_moderation_action IS 'TRI-943: append-only audit of avatar moderation events (approve/reject/remove/report/auto_flag) by admin/system/customer.';
