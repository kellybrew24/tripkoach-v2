// TRI-1015 · Lead capture for the public Contact + Airport-pickup "Send inquiry" forms.
//
// Both forms used to only pop a toast and DISCARD the visitor's name/email/phone/message — every
// customer inquiry was lost. This module persists each submission into the `enquiry` table (scaffolded
// but unused since migration 007) and fires a best-effort ops notification email so a koach sees the
// lead. The email transport (src/email.ts) is inert in unconfigured environments — it renders + logs a
// 'skipped' row and never throws — so a mail-config gap can never lose an already-saved lead.
//
// The submit is unauthenticated (guests fill these forms) and validated conservatively: a known enquiry
// `type` and a syntactically-valid email are the only hard requirements; everything else is trimmed,
// length-capped, and stored in the flexible `payload` jsonb (pickup carries flight/party/drop-off there).

import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { sendEmail } from './email.ts';
import { BookingError } from './booking.ts';

// Mirrors the CHECK constraint on enquiry.type (migration 007; 'interest' added in 026).
export type EnquiryType = 'contact' | 'pickup' | 'esim' | 'club' | 'shop' | 'interest';
// Only these are accepted from the generic /enquiries form. 'interest' is written exclusively by the
// dedicated tour-interest route below (never trusted from the open enquiry payload).
const ENQUIRY_TYPES: readonly EnquiryType[] = ['contact', 'pickup', 'esim', 'club', 'shop'];

// Human labels for the ops notification. Keyed by type + by the structured payload fields the FE sends.
const TYPE_LABEL: Record<EnquiryType, string> = {
  contact: 'contact enquiry',
  pickup: 'airport-pickup request',
  esim: 'eSIM enquiry',
  club: 'Tourism Club enquiry',
  shop: 'marketplace enquiry',
  interest: 'tour date interest',
};
const FIELD_LABEL: Record<string, string> = {
  arrivalDate: 'Arrival date',
  arrivalTime: 'Arrival time',
  flightNumber: 'Flight number',
  partySize: 'Party size',
  dropoff: 'Drop-off area',
  specialRequests: 'Special requests',
  message: 'Message',
};

export interface EnquiryInput {
  type?: string;
  subject?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  consent?: boolean;
  /** Structured extras (pickup: arrivalDate/arrivalTime/flightNumber/partySize/dropoff/specialRequests). */
  payload?: Record<string, unknown> | null;
}

export interface EnquiryResult {
  id: string;
}

// Deliberately permissive — rejects only what obviously isn't an address. Full validity is the
// deliverability check the reply exposes, not something to gate lead capture on.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, drop empties, and cap length. Returns null for absent/blank so callers can COALESCE to '—'. */
function clean(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** camelCase → "Title Case" fallback for any payload key without an explicit FIELD_LABEL. */
function deCamel(k: string): string {
  const s = k.replace(/([A-Z])/g, ' $1').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build the multi-line "label: value" details block for the ops email. '—' when there's nothing. */
function formatDetails(payload: Record<string, string>): string {
  const lines = Object.entries(payload).map(([k, v]) => `${FIELD_LABEL[k] ?? deCamel(k)}: ${v}`);
  return lines.length ? lines.join('\n') : '—';
}

/** Best-effort ops inbox for lead notifications. settings first, then env override, then the public address. */
async function resolveNotifyRecipient(db: Db, cfg: Config): Promise<string> {
  try {
    const { rows } = await db.query<{ e: string | null }>(
      `SELECT support_email AS e FROM settings WHERE singleton = true`);
    if (rows[0]?.e) return rows[0].e;
  } catch { /* settings unreadable → fall through to env / default */ }
  return process.env.ENQUIRY_NOTIFY_EMAIL || cfg.email.replyTo || 'services@tripkoach.com';
}

/**
 * Persist a lead and fire (best-effort) the ops notification. Throws a BookingError (422) on bad input —
 * mapped to the shared error envelope by the route. A notification failure NEVER fails the capture.
 */
export async function submitEnquiry(
  db: Db, cfg: Config, input: EnquiryInput, opts: { log?: (m: string) => void } = {},
): Promise<EnquiryResult> {
  const type = String(input.type ?? '').trim();
  if (!ENQUIRY_TYPES.includes(type as EnquiryType)) {
    throw new BookingError('validation', `Unknown enquiry type "${input.type ?? ''}"`, 422);
  }
  const email = clean(input.email, 320);
  if (!email || !EMAIL_RE.test(email)) {
    throw new BookingError('validation', 'A valid email address is required so we can reply', 422);
  }

  const name = clean(input.name, 200);
  const phone = clean(input.phone, 60);
  const subject = clean(input.subject, 200);
  const message = clean(input.message, 4000);
  const consent = input.consent === true;

  // Collapse the structured extras + message into one payload jsonb (matches migration 007's intent).
  const payload: Record<string, string> = {};
  if (input.payload && typeof input.payload === 'object') {
    for (const [k, v] of Object.entries(input.payload)) {
      const cv = clean(v, 500);
      if (cv != null) payload[k] = cv;
    }
  }
  if (message) payload.message = message;

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO enquiry (type, subject, name, email, phone, payload, consent)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [type, subject, name, email, phone, JSON.stringify(payload), consent]);
  const id = rows[0].id;

  // Notify ops. sendEmail never throws for a dispatch/disabled-transport issue (it logs a send-log row);
  // it only throws on programmer error (unknown template / missing var), which the try/catch also absorbs
  // so a notification bug can never 500 a lead that's already safely stored.
  try {
    const to = await resolveNotifyRecipient(db, cfg);
    await sendEmail(db, cfg, {
      to,
      replyTo: email, // a koach replies straight to the customer
      template: 'enquiry_received',
      vars: {
        enquiryType: TYPE_LABEL[type as EnquiryType],
        name: name ?? '—',
        email,
        phone: phone ?? '—',
        subject: subject ?? '—',
        details: formatDetails(payload),
      },
      relatedType: 'enquiry',
      relatedId: id,
    }, { log: opts.log });
  } catch (e) {
    opts.log?.(`[enquiry] ops notification failed for ${id}: ${(e as Error).message}`);
  }

  return { id };
}

// ── TRI-1018 / TRI-999 · Tour date-interest capture ─────────────────────────────────────────────────
// The empty-departures booking box ("No upcoming departures") collects an email-only signal that a
// traveller wants a departure scheduled for a specific tour. Persists as an 'interest' enquiry row and
// notifies ops so a koach can set a date up. Idempotent: re-submitting the same email/intent for the same
// tour returns the existing lead without inserting a duplicate or re-notifying (the empty-state form can
// be re-tapped without spamming ops).

export type InterestIntent = 'notify' | 'waitlist' | 'request';
const INTEREST_INTENTS: readonly InterestIntent[] = ['notify', 'waitlist', 'request'];

// TRI-1142 · Server-side min-lead floor for custom-date requests (CEO #1: 72h). Mirrors the value the
// /config route publishes as `minRequestLeadDays` (apps/api/src/server.ts) and the consumer FE's own
// `minRequestDate` guard in screens-web.jsx — kept in sync by hand. Until then this was ONLY enforced
// client-side, so a direct API call could create a sub-lead request; this constant makes it authoritative.
const MIN_REQUEST_LEAD_DAYS = 3;
// A syntactically well-formed calendar date the picker emits.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Earliest acceptable requested date as YYYY-MM-DD: server-local midnight today + leadDays. Matches the
 *  FE's minRequestDate() so the boundary the API enforces is exactly the one the date picker renders. */
function minRequestDate(leadDays: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + leadDays);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface InterestInput {
  intent?: string;
  email?: string | null;
  packageId?: string | null;
  /** TRI-1136: custom-date request fields (intent='request' only). */
  requestedDate?: string | null;
  partySize?: number | null;
  phone?: string | null;
  note?: string | null;
}

export interface InterestResult {
  id: string;
  /** true when this call created a new lead; false when it matched an existing one (idempotent hit). */
  created: boolean;
}

/**
 * Register interest in future dates for `tourIdOrSlug`. Throws BookingError(404) for an unknown tour and
 * BookingError(422) for a bad intent/email. A notification failure never fails the capture.
 */
export async function submitTourInterest(
  db: Db, cfg: Config, tourIdOrSlug: string, input: InterestInput, opts: { log?: (m: string) => void } = {},
): Promise<InterestResult> {
  const intent = String(input.intent ?? 'notify').trim() as InterestIntent;
  if (!INTEREST_INTENTS.includes(intent)) {
    throw new BookingError('validation', `Unknown interest intent "${input.intent ?? ''}"`, 422);
  }
  const email = clean(input.email, 320);
  if (!email || !EMAIL_RE.test(email)) {
    throw new BookingError('validation', 'A valid email address is required so we can reach you', 422);
  }

  // Resolve the tour by slug OR uuid (the FE passes the API tour id). Unknown ⇒ 404 rather than a silent
  // orphaned lead. tour.title is the display name (there is no `name` column).
  const tour = await db.query<{ id: string; title: string; slug: string }>(
    `SELECT id, title, slug FROM tour WHERE slug = $1 OR id::text = $1 LIMIT 1`, [tourIdOrSlug]);
  const row = tour.rows[0];
  if (!row) throw new BookingError('not_found', 'Tour not found', 404);

  const packageId = clean(input.packageId, 100);

  // TRI-1136: request intent has its own dedupe key — per (tour, email, requestedDate).
  // notify/waitlist still dedupe on (tour, email, intent) as before.
  const requestedDate = intent === 'request' ? clean(input.requestedDate, 20) : null;
  // TRI-1142: reject malformed / non-calendar dates and sub-lead picks server-side (CEO #1 72h floor).
  // The FE guards these client-side too (min= on the date input + dateOk), but a direct/tampered API call
  // must never create a request inside the lead window. Only enforced when a date is actually supplied —
  // a dateless 'request' remains a manual ops lead as before.
  if (intent === 'request' && requestedDate) {
    const iso = requestedDate.slice(0, 10);
    const asUtc = new Date(`${iso}T00:00:00Z`);
    if (!DATE_RE.test(iso) || Number.isNaN(asUtc.getTime()) || asUtc.toISOString().slice(0, 10) !== iso) {
      throw new BookingError('validation', 'A valid requested date (YYYY-MM-DD) is required', 422);
    }
    if (iso < minRequestDate(MIN_REQUEST_LEAD_DAYS)) {
      throw new BookingError(
        'validation',
        `Please choose a date at least ${MIN_REQUEST_LEAD_DAYS} days from now`, 422);
    }
  }
  const partySize = intent === 'request' && input.partySize != null ? Math.max(1, Math.min(99, Number(input.partySize) | 0)) : null;
  const phone = intent === 'request' ? clean(input.phone, 60) : null;
  const note = intent === 'request' ? clean(input.note, 2000) : null;

  const dedupeQuery = intent === 'request'
    ? db.query<{ id: string }>(
        `SELECT id FROM enquiry
          WHERE type = 'interest'
            AND lower(email) = lower($1)
            AND payload->>'tourId' = $2
            AND payload->>'intent' = 'request'
            AND payload->>'requestedDate' = $3
          ORDER BY created_at DESC LIMIT 1`,
        [email, row.id, requestedDate ?? ''])
    : db.query<{ id: string }>(
        `SELECT id FROM enquiry
          WHERE type = 'interest'
            AND lower(email) = lower($1)
            AND payload->>'tourId' = $2
            AND payload->>'intent' = $3
          ORDER BY created_at DESC LIMIT 1`,
        [email, row.id, intent]);

  const existing = await dedupeQuery;
  if (existing.rows[0]) {
    opts.log?.(`[interest] duplicate ${intent} for ${row.slug} <${email}> → ${existing.rows[0].id}`);
    return { id: existing.rows[0].id, created: false };
  }

  const payload: Record<string, string | number> = { tourId: row.id, tourSlug: row.slug, tourName: row.title, intent };
  if (packageId) payload.packageId = packageId;
  if (requestedDate) payload.requestedDate = requestedDate;
  if (partySize != null) payload.partySize = partySize;
  if (note) payload.note = note;

  let label: string;
  if (intent === 'waitlist') label = 'Waitlist';
  else if (intent === 'request') label = requestedDate ? `Date request — ${requestedDate}` : 'Date request';
  else label = 'Notify when dates open';

  const ins = await db.query<{ id: string }>(
    `INSERT INTO enquiry (type, subject, name, email, phone, payload, consent)
     VALUES ('interest', $1, NULL, $2, $3, $4, true) RETURNING id`,
    [`${label} — ${row.title}`, email, phone, JSON.stringify(payload)]);
  const id = ins.rows[0].id;

  try {
    const to = await resolveNotifyRecipient(db, cfg);
    const detailFields: Record<string, string> = { Tour: row.title, Request: label };
    if (requestedDate) detailFields['Requested date'] = requestedDate;
    if (partySize != null) detailFields['Group size'] = String(partySize);
    if (packageId) detailFields['Package'] = packageId;
    if (note) detailFields['Note'] = note;
    await sendEmail(db, cfg, {
      to,
      replyTo: email,
      template: 'enquiry_received',
      vars: {
        enquiryType: TYPE_LABEL.interest,
        name: '—',
        email,
        phone: phone ?? '—',
        subject: `${label} — ${row.title}`,
        details: formatDetails(detailFields),
      },
      relatedType: 'enquiry',
      relatedId: id,
    }, { log: opts.log });
  } catch (e) {
    opts.log?.(`[interest] ops notification failed for ${id}: ${(e as Error).message}`);
  }

  return { id, created: true };
}
