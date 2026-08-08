-- TRI-869 Phase 3 · Admin write realm — RBAC seed + admin deltas.
--
-- COORDINATION (critical): Phase 2 (TRI-866) owns 008_write_path_payments_fx.sql. This file is 009 and
-- MUST apply after 008 (guaranteed by the migration runner's lexical file sort). It does NOT redefine any
-- 008 column — the admin payment views read the FX columns (usd_amount_minor / fx_rate_used /
-- ghs_amount_minor) *defensively at runtime* (see src/admin.ts), so this branch migrates & smoke-tests
-- standalone (008 absent) yet needs no edit once 008 lands. Keep the sequence monotonic on merge.
--
-- The staff/RBAC tables themselves already exist from Phase 1 migration 006_staff_rbac_auth.sql. This
-- migration only SEEDS the default role × permission matrix and ensures the singleton settings row.

-- ── Default role_permission matrix ──────────────────────────────────────────
-- admin is additionally all-locked-on in the application layer (see src/auth.ts); we still seed its rows
-- true for a truthful admin UI. operator = ops-scoped (no refunds / users / settings). viewer = read-only.
-- ON CONFLICT DO NOTHING keeps this idempotent and never clobbers later admin edits to the matrix.
INSERT INTO role_permission (role, permission, allowed) VALUES
  -- admin: everything
  ('admin','tours.view',true),   ('admin','tours.edit',true),
  ('admin','bookings.view',true),('admin','bookings.manage',true),('admin','bookings.cancel',true),
  ('admin','payments.refund',true),('admin','customers.view',true),
  ('admin','promos.manage',true),('admin','users.manage',true),('admin','settings.manage',true),
  -- operator: run the operation, but not money-out / staff / org settings
  ('operator','tours.view',true),   ('operator','tours.edit',true),
  ('operator','bookings.view',true),('operator','bookings.manage',true),('operator','bookings.cancel',true),
  ('operator','payments.refund',false),('operator','customers.view',true),
  ('operator','promos.manage',true),('operator','users.manage',false),('operator','settings.manage',false),
  -- viewer: read-only across the console
  ('viewer','tours.view',true),   ('viewer','tours.edit',false),
  ('viewer','bookings.view',true),('viewer','bookings.manage',false),('viewer','bookings.cancel',false),
  ('viewer','payments.refund',false),('viewer','customers.view',true),
  ('viewer','promos.manage',false),('viewer','users.manage',false),('viewer','settings.manage',false)
ON CONFLICT (role, permission) DO NOTHING;

-- Ensure the singleton org-settings row exists (006/007 created the table but seeded no row). All defaults.
-- (008 also does this; ON CONFLICT makes both safe in either order.)
INSERT INTO settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;
