-- TRI-917 · Blog / CMS. The blog_post table itself was scaffolded in Phase 1 (007_content_leads_config.sql)
-- but never had a draft/published workflow, an author byline, or a hero alt-text — nor a permission guarding
-- an admin editor. This migration adds those columns + the `content.manage` permission, so the console can
-- author/edit stories and the consumer web can render only what's published.
--
-- MIGRATION NUMBERING: 018 is TRI-912 (admin MFA enforcement). This file takes 019. It only touches
-- blog_post + the 006 role_permission table/seed — no cross-dependency on any sibling branch — so it applies
-- standalone and stays monotonic on merge.

-- ── blog_post: authoring workflow columns ───────────────────────────────────
-- `status` mirrors tour.published as an explicit draft/published lifecycle (a story can exist unpublished
-- while an editor works on it). Existing rows (none in prod yet) default to 'draft'; the TRI-917 import
-- seeds live stories as 'published'. `author` is the byline the consumer post header shows ("TripKoach").
-- `hero_alt` carries the hero image's alt text (accessibility) alongside the existing hero_url.
ALTER TABLE blog_post ADD COLUMN IF NOT EXISTS status   text NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','published'));
ALTER TABLE blog_post ADD COLUMN IF NOT EXISTS author   text;
ALTER TABLE blog_post ADD COLUMN IF NOT EXISTS hero_alt text;

-- Any pre-existing row that already carried a published_at is treated as published (defensive; the table is
-- empty in every environment today, so this is a no-op in practice).
UPDATE blog_post SET status = 'published' WHERE published_at IS NOT NULL AND status = 'draft';

-- Consumer list/detail read filters on status='published' ordered by published_at DESC — index both.
CREATE INDEX IF NOT EXISTS blog_post_status_published_idx ON blog_post (status, published_at DESC);

-- ── content.manage permission ───────────────────────────────────────────────
-- Guards the admin /blog CRUD endpoints. admin is all-locked-on in the app layer (auth.ts) but we seed its
-- row true for a truthful admin UI; operator authors content (like tours.edit/reviews.moderate); viewer is
-- read-only. Extend the role_permission CHECK to admit the new value, then seed the default matrix.
ALTER TABLE role_permission DROP CONSTRAINT IF EXISTS role_permission_permission_check;
ALTER TABLE role_permission ADD CONSTRAINT role_permission_permission_check
  CHECK (permission IN
    ('tours.view','tours.edit','bookings.view','bookings.manage','bookings.cancel',
     'payments.refund','customers.view','promos.manage','users.manage','settings.manage',
     'reviews.moderate','content.manage'));

INSERT INTO role_permission (role, permission, allowed) VALUES
  ('admin','content.manage',true),
  ('operator','content.manage',true),
  ('viewer','content.manage',false)
ON CONFLICT (role, permission) DO NOTHING;
