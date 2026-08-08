-- TRI-866 Phase 2 · Write-path additions: payment FX/reconciliation, configurable charge rate,
-- webhook idempotency. Builds on the Phase-1 schema (003 booking/payment, 007 settings) — no redesign.
--
-- CURRENCY MODEL (board decision, TRI-864/866):
--   Prices are displayed & stored in USD (the currency of record). Paystack charges in GHS.
--   `payment.amount_minor` / `payment.currency` keep their Phase-1 USD-of-record meaning for the
--   booking's money-of-record. The columns added below reconcile that USD amount against the actual
--   GHS charge sent to Paystack, so every transaction is auditable (what USD, what rate, what GHS).

-- ── payment: FX / reconciliation columns ───────────────────────────────────
-- On a Paystack row we set currency='GHS' (the charged currency) and record the USD source amount,
-- the rate used, and the derived GHS amount (pesewas = GHS minor units). USD amounts stay in cents.
ALTER TABLE payment
  ADD COLUMN usd_amount_minor integer,                 -- USD source amount in cents (of record)
  ADD COLUMN fx_rate_used     numeric(12,6),           -- GHS-per-USD rate applied at charge time
  ADD COLUMN ghs_amount_minor integer;                 -- charged amount in GHS pesewas (integer)

COMMENT ON COLUMN payment.usd_amount_minor IS 'USD source amount (cents) reconciled against the GHS charge';
COMMENT ON COLUMN payment.fx_rate_used     IS 'GHS-per-USD rate used at charge time (see settings.usd_to_ghs_charge_rate / env override)';
COMMENT ON COLUMN payment.ghs_amount_minor IS 'Amount actually charged in GHS pesewas (integer) — ghs_amount_minor = round(usd_amount_minor * fx_rate_used)';

-- ── settings: configurable CHARGE rate (distinct from the display rate) ─────
-- charge≠display is allowed. Application precedence (env wins): PAYSTACK_USD_TO_GHS_RATE env →
-- settings.usd_to_ghs_charge_rate → settings.usd_to_ghs_display_rate (15.6). Never hardcoded.
ALTER TABLE settings
  ADD COLUMN usd_to_ghs_charge_rate numeric(10,4) NOT NULL DEFAULT 15.6;
COMMENT ON COLUMN settings.usd_to_ghs_charge_rate IS 'GHS-per-USD rate used to build Paystack charges; env PAYSTACK_USD_TO_GHS_RATE overrides this at runtime';

-- Ensure the singleton settings row exists (Phase 1 created the table but seeded no row). All defaults.
INSERT INTO settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

-- ── Paystack webhook idempotency ────────────────────────────────────────────
-- Signature-verified events are inserted exactly once; duplicate deliveries collide on event_id and
-- are treated as no-ops. `reference`/`type` are denormalised for cheap lookups; full body kept in raw.
CREATE TABLE paystack_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      text UNIQUE,                    -- Paystack event id (data.id / dedup key); UNIQUE guard
  reference     text,                           -- transaction reference (data.reference)
  type          text,                           -- event type, e.g. 'charge.success'
  payload       jsonb NOT NULL DEFAULT '{}',
  processed_at  timestamptz,                    -- set once the event has been applied to booking/payment
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paystack_event_reference_idx ON paystack_event(reference);

-- Promo usage (promo_code.used_count) increment is DEFERRED for this slice (promos are not yet in the
-- consumer booking flow). When promos are wired, increment used_count inside the reserve transaction.
