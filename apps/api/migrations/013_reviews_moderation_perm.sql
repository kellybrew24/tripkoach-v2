-- TRI-893 P2 · Admin reviews moderation — RBAC permission for the moderation endpoints.
--
-- Reviews use the existing status vocabulary from 005_reviews.sql (pending/approved/rejected) and the
-- existing `reply` column, so this branch adds NO schema to the review table. The only new thing is a
-- dedicated `reviews.moderate` permission guarding GET /admin/reviews + approve/reject/reply/unpublish.
--
-- MIGRATION NUMBERING: 011 is TRI-880 (email transport), 012 is TRI-892 (reviews write). This file takes
-- 013 to stay collision-free on merge. It only touches the 006 role_permission table + seeds — no cross
-- dependency on 011/012 — so it applies standalone off `main` and remains monotonic once the siblings land.

-- Extend the permission CHECK to admit the new value. Inline single-column checks are auto-named
-- `<table>_<column>_check`; IF EXISTS keeps this safe if a prior branch already renamed/replaced it.
ALTER TABLE role_permission DROP CONSTRAINT IF EXISTS role_permission_permission_check;
ALTER TABLE role_permission ADD CONSTRAINT role_permission_permission_check
  CHECK (permission IN
    ('tours.view','tours.edit','bookings.view','bookings.manage','bookings.cancel',
     'payments.refund','customers.view','promos.manage','users.manage','settings.manage',
     'reviews.moderate'));

-- Seed the matrix. admin is all-locked-on in the app layer (auth.ts), but we seed its row true for a
-- truthful admin UI. operator moderates content (has tours.edit); viewer is read-only. ON CONFLICT keeps
-- this idempotent and never clobbers later admin edits to the matrix.
INSERT INTO role_permission (role, permission, allowed) VALUES
  ('admin','reviews.moderate',true),
  ('operator','reviews.moderate',true),
  ('viewer','reviews.moderate',false)
ON CONFLICT (role, permission) DO NOTHING;
