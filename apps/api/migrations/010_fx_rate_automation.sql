-- TRI-873 Phase 4 · Automated daily USD→GHS FX. Builds on 008 (payment FX/reconciliation cols +
-- settings.usd_to_ghs_charge_rate). The daily cron (`npm run fx-refresh`) fetches the mid-market
-- USD→GHS mid-rate, applies FX_BUFFER_PCT, and writes the effective rate into
-- settings.usd_to_ghs_charge_rate — so the payment path is UNCHANGED (charge-rate precedence stays
-- env PAYSTACK_USD_TO_GHS_RATE → settings.usd_to_ghs_charge_rate → settings.usd_to_ghs_display_rate).
-- This migration adds the audit trail for every refresh + per-transaction FX provenance.

-- ── fx_rate_history: one row per refresh attempt (success OR guard-tripped) ──────────────────
-- The cron writes here every run so ops can see exactly what rate was fetched, from which source,
-- what buffer was applied, the effective charge rate, and which guard (if any) tripped. On a tripped
-- guard the last-known-good stays in settings — history records that we DECLINED to apply, never 0.
CREATE TABLE fx_rate_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL,                 -- provider name (e.g. 'open.er-api.com') or 'env_override'
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  raw_rate       numeric(14,6),                 -- mid-market GHS-per-USD as fetched (null on fetch_failed)
  buffer_pct     numeric(6,3) NOT NULL DEFAULT 0,
  effective_rate numeric(14,6),                 -- raw_rate * (1 + buffer_pct/100); the applied charge rate
  status         text NOT NULL CHECK (status IN ('ok','out_of_bounds','fetch_failed','override')),
  note           text,                          -- human context: deviation %, error message, override note
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fx_rate_history_fetched_at_idx ON fx_rate_history(fetched_at DESC);
-- Fast "last-known-good" lookup: the most recent successfully-applied rate.
CREATE INDEX fx_rate_history_ok_idx ON fx_rate_history(fetched_at DESC) WHERE status = 'ok';

COMMENT ON TABLE  fx_rate_history            IS 'Audit trail of every daily FX refresh (TRI-873): fetched rate, buffer, effective rate, guard status';
COMMENT ON COLUMN fx_rate_history.effective_rate IS 'Charge rate applied to settings.usd_to_ghs_charge_rate on status=ok (raw_rate * (1 + buffer_pct/100))';
COMMENT ON COLUMN fx_rate_history.status     IS 'ok = applied; out_of_bounds/fetch_failed = kept last-known-good; override = env kill-switch pinned the rate';

-- ── payment: per-transaction FX provenance (extends the 008 reconciliation cols) ─────────────
-- 008 already persists usd_amount_minor / fx_rate_used / ghs_amount_minor. We add WHERE the rate came
-- from and WHEN it was established, so each charge is fully traceable to an fx_rate_history row / override.
-- Nullable adds only — no regression to existing rows or the write path.
ALTER TABLE payment
  ADD COLUMN fx_source  text,                    -- provenance of fx_rate_used: provider name | 'env_override' | 'settings' | 'settings_display' | 'fallback_default'
  ADD COLUMN fx_rate_at timestamptz;             -- when the applied rate was established (history.fetched_at / settings.updated_at / charge time for override)

COMMENT ON COLUMN payment.fx_source  IS 'Provenance of fx_rate_used (TRI-873): FX provider name, env_override, settings, settings_display, or fallback_default';
COMMENT ON COLUMN payment.fx_rate_at IS 'Timestamp the applied fx_rate_used was established (source fx_rate_history.fetched_at / settings.updated_at / charge time on override)';
