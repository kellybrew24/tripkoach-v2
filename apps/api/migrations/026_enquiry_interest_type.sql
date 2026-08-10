-- TRI-1018 · Allow tour date-interest leads in the shared enquiry table.
--
-- The empty-departures booking box ("No upcoming departures") lets a traveller register interest in a
-- future date for a specific tour (TRI-999 spec: POST /tours/:id/interest). These leads live in the same
-- `enquiry` table as contact/pickup (migration 007) but need their own `type` so ops can filter them and
-- so the ops-notification renders "date interest — <tour>" rather than a generic contact enquiry.
--
-- Widen the CHECK constraint to add 'interest'. Idempotent-ish: drop the old constraint if present, then
-- re-add the full set. No data migration — existing rows already satisfy the widened set.

ALTER TABLE enquiry DROP CONSTRAINT IF EXISTS enquiry_type_check;
ALTER TABLE enquiry ADD CONSTRAINT enquiry_type_check
  CHECK (type IN ('contact','pickup','esim','club','shop','interest'));
