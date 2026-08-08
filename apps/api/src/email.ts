// TRI-880 P0 · Outbound email transport — the shared sender library.
//
// This is the ONE place the app sends email. Every notify-shaped feature (P1 password reset, P2 review
// invites, P3 staff invites, P5 booking/departure emails) calls sendEmail(db, cfg, { to, template, vars })
// and gets: (1) the template rendered, (2) the message dispatched via the configured provider, and
// (3) an audit row written to `email_message` (the send-log, migration 011) — inserted 'queued', then
// updated to a terminal status. No product flow is wired here yet; this slice ships the transport only.
//
// Design (mirrors fx.ts): the provider is behind an injectable `EmailTransport` so smoke/tests never
// touch the network, and it's env-swappable. The default transport is Resend's HTTPS API (reusing the
// legacy stack's account/domain send.tripkoach.com — DKIM/SPF already live; see G-Transport in the
// audit). We use the HTTP API rather than SMTP+nodemailer to add ZERO dependencies and match the
// codebase's existing fetch-based integrations (FX provider, Paystack).
//
// GUARDS:
//   • disabled  — no API key (or EMAIL_DRY_RUN) → render + log a 'skipped' row, DON'T dispatch. Lets
//                 every non-prod environment exercise callers safely without sending real mail.
//   • failure   — provider/network error → record 'failed' + the error on the send-log row and RETURN
//                 (never throw for a dispatch failure); the caller decides whether to surface/retry.
//   • bad input — unknown template / missing var / missing recipient → throw (programmer error).

import type { Db } from './db.ts';
import type { Config, EmailConfig } from './config.ts';
import { renderTemplate, type RenderedEmail, type TemplateVars } from './email-templates.ts';

export type EmailStatus = 'sent' | 'failed' | 'skipped';

export interface SendEmailInput {
  to: string;
  template: string;
  vars?: TemplateVars;
  /** Override the default From (cfg.email.from). Rarely needed. */
  from?: string;
  /** Reply-To header; falls back to cfg.email.replyTo. */
  replyTo?: string;
  /** Send-log provenance: what caused this email + the id of that cause (booking ref / user id / token). */
  relatedType?: string;
  relatedId?: string;
}

export interface SendEmailResult {
  /** email_message.id (the send-log row). */
  id: string;
  status: EmailStatus;
  to: string;
  subject: string;
  template: string;
  /** Provider message id on 'sent', else null. */
  providerMessageId: string | null;
  /** Error message on 'failed', else null. */
  error: string | null;
}

// ── Transport seam ───────────────────────────────────────────────────────────────────────────
export interface OutboundMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  name: string;
  send(msg: OutboundMessage): Promise<{ providerMessageId: string }>;
}

/**
 * Default transport: Resend HTTPS API (POST {apiBase}/emails, Bearer apiKey). Injectable & env-swappable.
 * Never constructed when the transport is disabled (no apiKey) — sendEmail short-circuits to 'skipped'.
 */
export function createResendTransport(email: EmailConfig): EmailTransport {
  // One POST attempt with a per-attempt timeout. Separated out so send() can retry it on transient
  // network faults (Resend occasionally takes >timeoutMs to respond — a single slow call must not drop
  // an otherwise-deliverable email, which is exactly the "sent but never arrived" failure TRI-941 hit).
  async function attempt(msg: OutboundMessage): Promise<{ providerMessageId: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), email.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${email.apiBase}/emails`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${email.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          from: msg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        }),
      });
    } catch (e) {
      // Network fault / abort (timeout) → transient. Tag it so send() knows it may retry.
      throw Object.assign(new Error(`email provider network error: ${(e as Error).message}`), { transient: true });
    } finally {
      clearTimeout(timer);
    }
    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.message || body?.error || `HTTP ${res.status}`;
      // 5xx / 429 are transient (retry-worthy); 4xx (bad recipient, auth) are permanent.
      const transient = res.status >= 500 || res.status === 429;
      throw Object.assign(new Error(`email provider rejected: ${detail}`), { transient });
    }
    const id = body?.id;
    if (!id || typeof id !== 'string') {
      throw new Error('email provider returned no message id');
    }
    return { providerMessageId: id };
  }

  return {
    name: email.providerName,
    async send(msg) {
      const maxRetries = Math.max(0, email.maxRetries);
      let lastErr: unknown;
      for (let i = 0; i <= maxRetries; i++) {
        try {
          return await attempt(msg);
        } catch (e) {
          lastErr = e;
          if (!(e as any)?.transient || i === maxRetries) throw e;
          // Short linear backoff between attempts (250ms, 500ms, …). Bounded by maxRetries.
          await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        }
      }
      throw lastErr; // unreachable (loop either returns or throws), but keeps TS happy.
    },
  };
}

export interface SendOptions {
  /** Inject a transport (smoke/tests). Ignored when the transport is disabled. */
  transport?: EmailTransport;
  log?: (m: string) => void;
}

/** Transport is live only when a From address AND an API key are configured, and dry-run is off. */
export function isEmailEnabled(email: EmailConfig): boolean {
  return !email.dryRun && !!email.apiKey && !!email.from;
}

async function insertQueued(db: Db, row: {
  to: string; from: string; replyTo?: string; subject: string; template: string;
  vars: TemplateVars; provider: string; relatedType?: string; relatedId?: string;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO email_message (to_email, from_email, reply_to, subject, template, vars, provider,
       status, related_type, related_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9) RETURNING id`,
    [row.to, row.from, row.replyTo ?? null, row.subject, row.template, JSON.stringify(row.vars ?? {}),
     row.provider, row.relatedType ?? null, row.relatedId ?? null]);
  return rows[0].id;
}

async function finalize(db: Db, id: string, status: EmailStatus, fields: {
  providerMessageId?: string | null; error?: string | null;
}): Promise<void> {
  await db.query(
    `UPDATE email_message
        SET status = $2, provider_message_id = $3, error = $4, updated_at = now(),
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
      WHERE id = $1`,
    [id, status, fields.providerMessageId ?? null, fields.error ?? null]);
}

/**
 * Render + dispatch one email, always writing an audit row to the send-log.
 *
 * Returns the outcome; NEVER throws for a dispatch failure or a disabled transport (the send-log
 * captures it). Throws only on caller/programmer error: unknown template, missing render var, or a
 * missing recipient — surfaced before any row is written.
 */
export async function sendEmail(
  db: Db, cfg: Config, input: SendEmailInput, opts: SendOptions = {},
): Promise<SendEmailResult> {
  const email = cfg.email;
  const log = opts.log ?? (() => {});
  const vars: TemplateVars = input.vars ?? {};

  // ── Validate + render up front (throws on programmer error, before touching the DB). ──
  const to = (input.to ?? '').trim();
  if (!to) throw new Error('sendEmail: missing recipient (to)');
  const replyTo = input.replyTo ?? email.replyTo;
  const rendered: RenderedEmail = renderTemplate(input.template, vars);

  // A From is required to actually DISPATCH, but not to record a 'skipped' row: isEmailEnabled() already
  // requires a From, so a missing From means the transport is disabled anyway. In that case we log the
  // skip against a placeholder sender rather than throwing — so a dev/unconfigured environment can still
  // exercise every caller (e.g. staff invites) and get a send-log row, never a 500.
  const enabled = isEmailEnabled(email);
  const from = input.from ?? email.from;
  if (enabled && !from) throw new Error('sendEmail: no From address configured (set EMAIL_FROM)');
  const fromForLog = from ?? '(unconfigured)';

  const id = await insertQueued(db, {
    to, from: fromForLog, replyTo, subject: rendered.subject, template: input.template, vars,
    provider: email.providerName, relatedType: input.relatedType, relatedId: input.relatedId,
  });

  const base = { id, to, subject: rendered.subject, template: input.template };

  // ── GUARD: disabled transport → skip dispatch, record 'skipped'. ──
  if (!enabled) {
    const reason = email.dryRun ? 'EMAIL_DRY_RUN set' : 'no RESEND_API_KEY / From configured';
    await finalize(db, id, 'skipped', { error: `transport disabled (${reason})` });
    log(`[email] SKIPPED template=${input.template} to=${to} — ${reason}`);
    return { ...base, status: 'skipped', providerMessageId: null, error: null };
  }

  const transport = opts.transport ?? createResendTransport(email);

  // ── Dispatch. On failure: record 'failed' + error, never throw. ──
  try {
    const { providerMessageId } = await transport.send({
      to, from: from!, replyTo, subject: rendered.subject, html: rendered.html, text: rendered.text,
    });
    await finalize(db, id, 'sent', { providerMessageId });
    log(`[email] SENT template=${input.template} to=${to} via ${transport.name} id=${providerMessageId}`);
    return { ...base, status: 'sent', providerMessageId, error: null };
  } catch (e) {
    const error = (e as Error).message;
    await finalize(db, id, 'failed', { error });
    log(`[email] FAILED template=${input.template} to=${to} via ${transport.name} — ${error}. ALERT.`);
    return { ...base, status: 'failed', providerMessageId: null, error };
  }
}
