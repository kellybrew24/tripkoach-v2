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

// Mirrors the CHECK constraint on enquiry.type (migration 007).
export type EnquiryType = 'contact' | 'pickup' | 'esim' | 'club' | 'shop';
const ENQUIRY_TYPES: readonly EnquiryType[] = ['contact', 'pickup', 'esim', 'club', 'shop'];

// Human labels for the ops notification. Keyed by type + by the structured payload fields the FE sends.
const TYPE_LABEL: Record<EnquiryType, string> = {
  contact: 'contact enquiry',
  pickup: 'airport-pickup request',
  esim: 'eSIM enquiry',
  club: 'Tourism Club enquiry',
  shop: 'marketplace enquiry',
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
