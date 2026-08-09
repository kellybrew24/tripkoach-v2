-- TRI-1012 · Consumer "Delete my account" (privacy/GDPR). The web account screen offered a
-- "Delete my account" button whose handler only closed the modal and redirected — nothing was
-- deleted and no DELETE /me endpoint existed. This adds the soft-delete tombstone that DELETE /me
-- stamps: the row is RETAINED (booking + audit FKs reference it via ON DELETE SET NULL and would
-- orphan history otherwise) but every PII column is scrubbed by the service and the account can
-- never authenticate again — resolveUserSession() and login gate on deleted_at IS NULL.
--
-- We keep the tombstone row (rather than a hard DELETE) so past bookings/receipts still resolve an
-- anonymized "Deleted user" and the audit trail of the deletion itself stays intact. The email is
-- rewritten to a unique unusable address so the real address frees up for a fresh signup.

ALTER TABLE user_account ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN user_account.deleted_at IS
  'TRI-1012: soft-delete tombstone. Non-null → account was deleted/anonymized; cannot log in or hold a live session.';
