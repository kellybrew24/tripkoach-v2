// TRI-889 P5.2 · Transactional booking-lifecycle notifications + the departure-reminder cron.
//
// This is the ONE place the booking lifecycle turns into email. It sits on top of the P0 transport
// (TRI-880): it resolves the recipient + renders the right template + calls sendEmail(), which handles
// dispatch, the disabled-transport auto-skip, and the email_message send-log. Four moments:
//   • bookingConfirmed(ref)      — payment succeeded (webhook verify → paid)
//   • bookingCancelled(ref,…)    — admin/booking cancel
//   • paymentFailed(ref)         — a Paystack charge failed / was abandoned
//   • sendDepartureReminders(…)  — cron (daily): paid bookings departing N days out
//
// RECIPIENT (task rule): honour notification_preference where an ACCOUNT exists; guest bookings fall
// back to the booking contact (lead traveller) email. Consumer notification toggles (C17) land with P1 —
// we do NOT block on them: default is to SEND for booking-lifecycle mail, and we suppress only when an
// explicit `enabled=false` preference row exists for the account + this notification type.
//
// DECOUPLING: every method swallows its own errors and NEVER throws to the caller. A booking must never
// fail (or a payment roll back) because an email bug/misconfig — the send-log captures failures for ops.

import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { sendEmail, type SendOptions, type SendEmailResult } from './email.ts';
import { fromMinor } from './util.ts';

// Lifecycle event → the notification_preference.type honoured for account holders (channel = 'email').
const PREF_TYPE = {
  booking_confirmed: 'booking_confirmations',
  booking_cancelled: 'urgent_updates',
  booking_rescheduled: 'urgent_updates',
  payment_failed: 'payment_reminders',
  departure_reminder: 'departure_reminders',
} as const;
type NotifyEvent = keyof typeof PREF_TYPE;

// cancel_reason enum → a human clause appended to the cancellation email ('' when unknown/absent).
const CANCEL_REASON_PHRASE: Record<string, string> = {
  customer_request: ' This was cancelled at your request.',
  non_payment: ' This was cancelled because payment wasn’t completed in time.',
  departure_cancelled: ' This departure was cancelled by TripKoach.',
  duplicate: ' This was a duplicate booking.',
};

export interface NotificationService {
  bookingConfirmed(ref: string): Promise<SendEmailResult | null>;
  /**
   * Re-send the booking confirmation on operator demand (TRI-1007). Picks the template that matches
   * the booking's current lifecycle — a confirmed/completed booking gets the "you're going"
   * confirmation, a still-held (reserved/pending) booking gets the "spot reserved / total due"
   * receipt. Honours the same booking_confirmations preference + guest-fallback as the automatic send.
   */
  resendConfirmation(ref: string): Promise<SendEmailResult | null>;
  bookingCancelled(ref: string, opts?: { reason?: string | null }): Promise<SendEmailResult | null>;
  /** Admin moved this booking to a new departure. `previousDepartureLabel` is the old date (booking already carries the new one). */
  bookingRescheduled(ref: string, opts?: { previousDepartureLabel?: string | null }): Promise<SendEmailResult | null>;
  paymentFailed(ref: string): Promise<SendEmailResult | null>;
  /** Daily cron: email a departure reminder to every paid booking departing `daysBefore` days out. */
  sendDepartureReminders(opts?: { daysBefore?: number; now?: Date; log?: (m: string) => void }):
    Promise<{ target: string | null; matched: number; sent: number; skipped: number; failed: number; refs: string[] }>;
}

// Booking context assembled for rendering + recipient resolution.
interface BookingCtx {
  bookingId: string;
  ref: string;
  currency: string;
  totalMinor: number;
  partySize: number;
  tourTitle: string;
  departureLabel: string;
  status: string;                // booking.status — picks the resend template
  cancelReason: string | null;
  userId: string | null;         // account link (booking.user_id) — null for guest bookings
  accountEmail: string | null;   // user_account.email when linked
  leadName: string | null;
  leadEmail: string | null;      // booking contact (lead traveller) — guest fallback recipient
  publicToken: string | null;    // TRI-1095: 128-bit lookup token for the ?t= guest link
  tokenRequired: boolean;        // TRI-1095: true ⇒ the manage link MUST carry ?t=
}

/** First name for the greeting (first whitespace token), or a neutral fallback. */
function firstName(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || 'traveller';
}

/** "$300 USD" for USD, else "300 GHS" — mirrors the DS confirmation-email money style. */
function money(minor: number, currency: string): string {
  const amt = fromMinor(minor);
  return currency === 'USD' ? `$${amt} USD` : `${amt} ${currency}`;
}

export function createNotificationService(
  db: Db, cfg: Config, defaultSendOpts: SendOptions = {},
): NotificationService {
  const baseLog = defaultSendOpts.log ?? (() => {});

  function manageUrl(ctx: { ref: string; publicToken?: string | null; tokenRequired?: boolean }): string {
    // Ref-addressable booking view is the SPA's SINGULAR /booking/:ref route
    // (TRI-938, guest-public receipt). The plural /bookings/:ref does NOT match
    // any client route and falls through to the home page — stranding guest-
    // checkout customers, whose only path back to their receipt is this email
    // link (TRI-1035). Plural /bookings is the auth-gated My-bookings LIST.
    //
    // TRI-1095: for token_required bookings the guest can only load the view WITH
    // the 128-bit capability token, so it MUST ride the emailed link as ?t=.
    const base = `${cfg.notify.webBaseUrl}/booking/${ctx.ref}`;
    return ctx.tokenRequired && ctx.publicToken ? `${base}?t=${ctx.publicToken}` : base;
  }

  // Load everything the templates + recipient resolution need in one round-trip-ish shot.
  async function loadCtx(ref: string): Promise<BookingCtx | null> {
    const { rows } = await db.query(
      `SELECT b.id, b.ref, b.currency, b.total_minor, b.party_size, b.user_id, b.status, b.cancel_reason,
              b.public_token, b.token_required,
              t.title AS tour_title,
              d.date_label, d.time_label,
              ua.email AS account_email
         FROM booking b
         JOIN tour t ON t.id = b.tour_id
         JOIN departure d ON d.id = b.departure_id
         LEFT JOIN user_account ua ON ua.id = b.user_id
        WHERE b.ref = $1`, [ref]);
    const b = rows[0];
    if (!b) return null;
    const lead = (await db.query(
      `SELECT name, email FROM booking_traveller
        WHERE booking_id = $1 ORDER BY is_lead DESC, (email IS NULL), created_at LIMIT 1`, [b.id])).rows[0];
    return {
      bookingId: b.id, ref: b.ref, currency: b.currency, totalMinor: Number(b.total_minor),
      partySize: Number(b.party_size), tourTitle: b.tour_title,
      departureLabel: [b.date_label, b.time_label].filter(Boolean).join(', '),
      status: b.status,
      cancelReason: b.cancel_reason ?? null,
      userId: b.user_id ?? null, accountEmail: b.account_email ?? null,
      leadName: lead?.name ?? null, leadEmail: lead?.email ?? null,
      publicToken: b.public_token ?? null, tokenRequired: !!b.token_required,
    };
  }

  // Resolve the recipient for an event, honouring account preferences. Returns null to SKIP:
  //   • guest booking with no contact email, or
  //   • an account holder who has explicitly disabled this notification type (enabled=false row).
  // Absence of a preference row = default SEND (C17 toggles seed rows under P1).
  async function recipientFor(ctx: BookingCtx, event: NotifyEvent): Promise<{ email: string; reason?: string } | null> {
    if (ctx.userId) {
      const pref = (await db.query<{ enabled: boolean }>(
        `SELECT enabled FROM notification_preference
          WHERE user_id = $1 AND channel = 'email' AND type = $2 LIMIT 1`,
        [ctx.userId, PREF_TYPE[event]])).rows[0];
      if (pref && pref.enabled === false) return null; // explicitly opted out
      const email = ctx.accountEmail || ctx.leadEmail;
      return email ? { email } : null;
    }
    return ctx.leadEmail ? { email: ctx.leadEmail } : null; // guest → booking contact
  }

  // Shared send wrapper: resolve recipient → sendEmail() → never throw. Logs a skip when there's no
  // deliverable recipient (distinct from the transport-disabled 'skipped' send-log row).
  async function dispatch(
    ctx: BookingCtx, event: NotifyEvent, template: string, vars: Record<string, unknown>,
    log: (m: string) => void,
  ): Promise<SendEmailResult | null> {
    const rcpt = await recipientFor(ctx, event);
    if (!rcpt) {
      log(`[notify] ${event} booking=${ctx.ref} — no recipient (opted out / no contact email), not sending`);
      return null;
    }
    try {
      return await sendEmail(db, cfg, {
        to: rcpt.email, template, vars, relatedType: 'booking', relatedId: ctx.ref,
      }, defaultSendOpts);
    } catch (e) {
      // sendEmail only throws on programmer error (unknown template / missing var). Never propagate.
      log(`[notify] ${event} booking=${ctx.ref} — send error (swallowed): ${(e as Error).message}`);
      return null;
    }
  }

  async function bookingConfirmed(ref: string): Promise<SendEmailResult | null> {
    try {
      const ctx = await loadCtx(ref);
      if (!ctx) return null;
      return await dispatch(ctx, 'booking_confirmed', 'booking_confirmed', {
        firstName: firstName(ctx.leadName), ref: ctx.ref, tourTitle: ctx.tourTitle,
        departureLabel: ctx.departureLabel, travellers: ctx.partySize,
        totalDisplay: money(ctx.totalMinor, ctx.currency), manageUrl: manageUrl(ctx),
      }, baseLog);
    } catch (e) {
      baseLog(`[notify] bookingConfirmed ${ref} failed (swallowed): ${(e as Error).message}`);
      return null;
    }
  }

  async function resendConfirmation(ref: string): Promise<SendEmailResult | null> {
    try {
      const ctx = await loadCtx(ref);
      if (!ctx) return null;
      // Match the confirmation to the booking's lifecycle: paid/confirmed → the "you're going"
      // receipt; still held (reserved/pending) → the "spot reserved / total due" email. Both carry
      // the same vars and both honour the booking_confirmations preference (event key below).
      const template = ['confirmed', 'completed'].includes(ctx.status) ? 'booking_confirmed' : 'booking_pending';
      return await dispatch(ctx, 'booking_confirmed', template, {
        firstName: firstName(ctx.leadName), ref: ctx.ref, tourTitle: ctx.tourTitle,
        departureLabel: ctx.departureLabel, travellers: ctx.partySize,
        totalDisplay: money(ctx.totalMinor, ctx.currency), manageUrl: manageUrl(ctx),
      }, baseLog);
    } catch (e) {
      baseLog(`[notify] resendConfirmation ${ref} failed (swallowed): ${(e as Error).message}`);
      return null;
    }
  }

  async function bookingCancelled(ref: string, opts: { reason?: string | null } = {}): Promise<SendEmailResult | null> {
    try {
      const ctx = await loadCtx(ref);
      if (!ctx) return null;
      const reasonKey = opts.reason ?? ctx.cancelReason ?? '';
      const reason = CANCEL_REASON_PHRASE[reasonKey] ?? '';
      return await dispatch(ctx, 'booking_cancelled', 'booking_cancelled', {
        firstName: firstName(ctx.leadName), ref: ctx.ref, tourTitle: ctx.tourTitle,
        departureLabel: ctx.departureLabel, reason, manageUrl: manageUrl(ctx),
      }, baseLog);
    } catch (e) {
      baseLog(`[notify] bookingCancelled ${ref} failed (swallowed): ${(e as Error).message}`);
      return null;
    }
  }

  async function bookingRescheduled(
    ref: string, opts: { previousDepartureLabel?: string | null } = {},
  ): Promise<SendEmailResult | null> {
    try {
      const ctx = await loadCtx(ref); // ctx.departureLabel is the NEW departure (booking already moved)
      if (!ctx) return null;
      return await dispatch(ctx, 'booking_rescheduled', 'booking_rescheduled', {
        firstName: firstName(ctx.leadName), ref: ctx.ref, tourTitle: ctx.tourTitle,
        previousDepartureLabel: opts.previousDepartureLabel || '—',
        departureLabel: ctx.departureLabel, travellers: ctx.partySize, manageUrl: manageUrl(ctx),
      }, baseLog);
    } catch (e) {
      baseLog(`[notify] bookingRescheduled ${ref} failed (swallowed): ${(e as Error).message}`);
      return null;
    }
  }

  async function paymentFailed(ref: string): Promise<SendEmailResult | null> {
    try {
      const ctx = await loadCtx(ref);
      if (!ctx) return null;
      return await dispatch(ctx, 'payment_failed', 'payment_failed', {
        firstName: firstName(ctx.leadName), ref: ctx.ref, tourTitle: ctx.tourTitle,
        departureLabel: ctx.departureLabel, totalDisplay: money(ctx.totalMinor, ctx.currency),
        manageUrl: manageUrl(ctx),
      }, baseLog);
    } catch (e) {
      baseLog(`[notify] paymentFailed ${ref} failed (swallowed): ${(e as Error).message}`);
      return null;
    }
  }

  async function sendDepartureReminders(
    opts: { daysBefore?: number; now?: Date; log?: (m: string) => void } = {},
  ) {
    const log = opts.log ?? baseLog;
    const daysBefore = opts.daysBefore ?? cfg.notify.reminderDaysBefore;
    const now = opts.now ?? new Date();
    const out = { target: null as string | null, matched: 0, sent: 0, skipped: 0, failed: 0, refs: [] as string[] };
    try {
      // Target date = today (UTC) + daysBefore, compared against departure.depart_on (a DATE).
      const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysBefore));
      const target = t.toISOString().slice(0, 10); // YYYY-MM-DD
      out.target = target;

      // Paid, still-scheduled departures on the target date. Dedup: skip any booking that already has a
      // 'sent' departure_reminder logged TODAY (guards against a second cron run the same day).
      const { rows } = await db.query<{ ref: string }>(
        `SELECT b.ref
           FROM booking b
           JOIN departure d ON d.id = b.departure_id
          WHERE b.status = 'confirmed' AND b.payment_state = 'paid'
            AND d.status = 'scheduled' AND d.depart_on = $1
            AND NOT EXISTS (
              SELECT 1 FROM email_message em
               WHERE em.template = 'departure_reminder' AND em.related_id = b.ref
                 AND em.status = 'sent' AND em.created_at::date = $2::date)
          ORDER BY b.ref`, [target, now.toISOString().slice(0, 10)]);
      out.matched = rows.length;
      log(`[reminders] target=${target} (${daysBefore}d out) matched=${rows.length} paid booking(s)`);

      for (const { ref } of rows) {
        const ctx = await loadCtx(ref);
        if (!ctx) continue;
        const daysLabel = daysBefore <= 0 ? 'today' : daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`;
        const res = await dispatch(ctx, 'departure_reminder', 'departure_reminder', {
          firstName: firstName(ctx.leadName), ref: ctx.ref, tourTitle: ctx.tourTitle,
          departureLabel: ctx.departureLabel, travellers: ctx.partySize,
          daysLabel, manageUrl: manageUrl(ctx),
        }, log);
        out.refs.push(ref);
        if (!res) { out.skipped++; continue; }
        if (res.status === 'sent') out.sent++;
        else if (res.status === 'failed') out.failed++;
        else out.skipped++; // 'skipped' (transport disabled)
      }
      log(`[reminders] done sent=${out.sent} skipped=${out.skipped} failed=${out.failed}`);
    } catch (e) {
      log(`[reminders] FATAL (swallowed): ${(e as Error).message}`);
    }
    return out;
  }

  return { bookingConfirmed, resendConfirmation, bookingCancelled, bookingRescheduled, paymentFailed, sendDepartureReminders };
}
