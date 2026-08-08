-- TRI-880 P0 · Outbound email / notification transport (send-log).
-- Stands up the transport layer only — NO product email flows yet. Unblocks P1 (password reset),
-- P2 (review invites), P3 (staff invites), and P5 (booking/departure emails), which will each call
-- the shared sendEmail() lib (src/email.ts) and get an audit row here for free.
--
-- The API previously had NO email transport at all (see docs/ds-logic-gap-audit.md, gap G-Transport).
-- Provider is Resend (reusing the legacy stack's account/domain send.tripkoach.com — DKIM/SPF live).

-- ── email_message: one row per outbound email attempt (the send-log) ─────────────────────────
-- The mailer inserts a 'queued' row before dispatch, then updates it to a terminal status so a crash
-- mid-send still leaves a trace. Statuses:
--   queued  — row created, dispatch not yet completed (transient; a lingering 'queued' = a crash)
--   sent    — provider accepted the message (provider_message_id captured)
--   failed  — provider/network error; error captured; the caller decides whether to retry
--   skipped — transport disabled (no RESEND_API_KEY / EMAIL_DRY_RUN) — rendered but never dispatched
CREATE TABLE email_message (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email            text NOT NULL,
  from_email          text NOT NULL,
  reply_to            text,
  subject             text NOT NULL,
  template            text NOT NULL,                 -- registered template name (email-templates.ts)
  vars                jsonb,                          -- snapshot of the render vars (audit / re-render)
  provider            text NOT NULL DEFAULT 'resend',
  provider_message_id text,                           -- Resend message id on 'sent'
  status              text NOT NULL CHECK (status IN ('queued','sent','failed','skipped')),
  error               text,                           -- provider/network error message on 'failed'
  related_type        text,                           -- 'booking' | 'user' | 'staff_invite' | 'review_invite' | 'password_reset' | …
  related_id          text,                           -- free-form: booking ref / user id / token id — links the email to its cause
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,                    -- when the provider accepted it (status='sent')
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_message_created_at_idx ON email_message(created_at DESC);
CREATE INDEX email_message_status_idx     ON email_message(status);
CREATE INDEX email_message_related_idx    ON email_message(related_type, related_id);
CREATE INDEX email_message_to_idx         ON email_message(to_email);

COMMENT ON TABLE  email_message                     IS 'Outbound email send-log (TRI-880): one row per attempt, inserted queued then updated to sent/failed/skipped';
COMMENT ON COLUMN email_message.template            IS 'Registered template name rendered for this message (src/email-templates.ts)';
COMMENT ON COLUMN email_message.provider_message_id IS 'Provider-assigned message id (Resend) captured on status=sent';
COMMENT ON COLUMN email_message.related_type        IS 'What caused this email — booking | user | staff_invite | review_invite | password_reset | smoke';
COMMENT ON COLUMN email_message.related_id          IS 'Free-form id of the cause (booking ref / user id / token id) for tracing/resend';
COMMENT ON COLUMN email_message.status              IS 'queued (transient) | sent | failed | skipped (transport disabled — rendered, not dispatched)';
