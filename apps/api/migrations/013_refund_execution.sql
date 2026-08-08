-- TRI-897 P3 · Refund EXECUTION (Paystack) — upgrades admin refund from flag-only to a real refund.
-- Builds on 003 (payment allows negative/linked refund rows + status 'refunded') and 008 (paystack_event
-- idempotency). No redesign: a refund is a linked, negative payment row plus a status flip on the original.
--
-- (011 = email transport, 012 = reviews/consumer-auth are claimed on sibling branches; this is 013.)

ALTER TABLE payment
  -- Links a refund row back to the payment it reverses (the original charge). NULL on charge rows.
  ADD COLUMN refund_of          uuid REFERENCES payment(id),
  -- Paystack refund id (data.id from /refund and the refund.* webhooks). Idempotency key: the same
  -- Paystack refund is recorded at most once, whether it arrives via the admin call or the webhook.
  ADD COLUMN refund_provider_id text;

COMMENT ON COLUMN payment.refund_of          IS 'FK to the original charge payment this row refunds (refund rows only)';
COMMENT ON COLUMN payment.refund_provider_id IS 'Paystack refund id (dedup key across admin-initiated + webhook refund events)';

-- One row per Paystack refund. Partial-unique so charge rows (NULL) are unconstrained; a duplicate
-- refund delivery (admin retry / webhook echo) collides here and is a no-op via ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX payment_refund_provider_id_uidx
  ON payment(refund_provider_id) WHERE refund_provider_id IS NOT NULL;
