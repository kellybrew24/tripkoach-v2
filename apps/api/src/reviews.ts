// TRI-892 P2 · Reviews write service. Two surfaces, one service:
//   1. Invite issuance (admin, A5 "End & request reviews") — end a departure and mint a one-time
//      `review_invite` token per eligible booking, emailing each traveller a personal review link.
//   2. Tokenized redeem→submit (consumer, C15) — a valid unredeemed token yields the tour + traveller
//      prefill; a POST creates a VERIFIED review (status=pending → visible only after admin moderation)
//      and atomically burns the token so it can never be redeemed twice.
//
// Schema is Phase-1 (005_reviews.sql: review + review_invite); 012 adds the one-invite-per-booking guard.
// Email goes through the shared transport (src/email.ts) using the `review_invite` template — when the
// transport is disabled (no key), sendEmail() logs a 'skipped' row and the invite still stands.

import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { audit } from './auth.ts';
import { sendEmail, type EmailTransport } from './email.ts';

// ── Typed error → { error: { code, message } } envelope + HTTP status (mapped by the route layer). ──
export class ReviewError extends Error {
  code: string;
  httpStatus: number;
  field?: string;
  constructor(code: string, message: string, httpStatus = 400, field?: string) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

export interface Actor { id: string; ip: string | null }

// A booking qualifies for a review invite once it's a paid, confirmed/completed seat on the departure.
// Cancelled/failed/unpaid holds never get invited.
const ELIGIBLE_SQL = `b.status IN ('confirmed','completed') AND b.payment_state = 'paid'`;

/** URL-safe one-time invite token (24 random bytes → 32-char base64url). */
function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n ? n.split(/\s+/)[0] : 'traveller';
}

/** Human departure label for email copy, mirroring the read DTO's `date` (+ optional time). */
function departureLabel(d: { date_label: string | null; time_label: string | null }): string {
  const date = (d.date_label ?? '').trim();
  const time = (d.time_label ?? '').trim();
  return time ? `${date} · ${time}` : date || 'your departure';
}

export interface ReviewsServiceOptions {
  /** Inject an email transport (smoke/tests). Ignored when the transport is disabled (no API key). */
  emailTransport?: EmailTransport;
  log?: (m: string) => void;
}

export function createReviewsService(db: Db, cfg: Config, opts: ReviewsServiceOptions = {}) {
  const emailOpts = { transport: opts.emailTransport, log: opts.log };

  // ── 1. Invite issuance (admin) ──────────────────────────────────────────────
  // Ends the departure (scheduled/sold_out → completed) and issues one invite per eligible booking.
  // Idempotent: bookings that already have an invite are skipped; re-running is safe (no double-issue).
  async function requestReviews(departureId: string, actor: Actor) {
    const dep = (await db.query(
      `SELECT d.id, d.tour_id, d.status, d.date_label, d.time_label, t.title AS tour_title, t.slug AS tour_slug
         FROM departure d JOIN tour t ON t.id = d.tour_id WHERE d.id = $1`, [departureId])).rows[0];
    if (!dep) throw new ReviewError('not_found', 'departure not found', 404);
    if (dep.status === 'cancelled') {
      throw new ReviewError('conflict', 'cannot request reviews for a cancelled departure', 409);
    }

    // "End" the departure — idempotent transition; leave an already-completed departure untouched.
    let departureStatus = dep.status;
    if (dep.status === 'scheduled' || dep.status === 'sold_out') {
      await db.query(`UPDATE departure SET status='completed', updated_at=now() WHERE id=$1`, [departureId]);
      departureStatus = 'completed';
    }

    const label = departureLabel(dep);
    const bookings = (await db.query(
      `SELECT b.id, b.ref FROM booking b WHERE b.departure_id = $1 AND ${ELIGIBLE_SQL} ORDER BY b.created_at`,
      [departureId])).rows;

    const issued: Array<{ ref: string; email: string; emailStatus: string }> = [];
    const skipped: Array<{ ref: string; reason: string }> = [];

    for (const b of bookings) {
      // Lead traveller carries the contact; fall back to any traveller with an email.
      const trav = (await db.query(
        `SELECT name, email FROM booking_traveller
          WHERE booking_id = $1 AND email IS NOT NULL AND email <> ''
          ORDER BY is_lead DESC, created_at LIMIT 1`, [b.id])).rows[0];
      if (!trav) { skipped.push({ ref: b.ref, reason: 'no_contact_email' }); continue; }

      // Idempotency: one invite per booking (also DB-guarded by review_invite_booking_uniq, 012).
      const existing = (await db.query(
        `SELECT token FROM review_invite WHERE booking_id = $1`, [b.id])).rows[0];
      if (existing) { skipped.push({ ref: b.ref, reason: 'already_invited' }); continue; }

      const token = newToken();
      try {
        await db.query(
          `INSERT INTO review_invite (token, booking_id, tour_id, traveller_name, traveller_email, sent_at)
           VALUES ($1,$2,$3,$4,$5, now())`,
          [token, b.id, dep.tour_id, trav.name ?? null, trav.email]);
      } catch (e) {
        // Concurrent double-issue lost the race to the unique index → treat as already-invited.
        skipped.push({ ref: b.ref, reason: 'already_invited' });
        continue;
      }

      // Email is best-effort: the invite row is already committed above. sendEmail() never throws for a
      // dispatch failure/disabled transport (it logs the send-log row), but it DOES throw on a config
      // error (e.g. EMAIL_FROM unset). Catch that so a mis-set mailer can't abort issuance / lose the
      // token — the traveller can still redeem a link surfaced elsewhere and ops sees emailStatus.
      const reviewUrl = `${cfg.webUrl}/reviews/redeem/${token}`;
      let emailStatus = 'error';
      try {
        const send = await sendEmail(db, cfg, {
          to: trav.email,
          template: 'review_invite',
          vars: { firstName: firstName(trav.name), tourTitle: dep.tour_title, departureLabel: label, reviewUrl },
          relatedType: 'review_invite',
          relatedId: token,
        }, emailOpts);
        emailStatus = send.status;
      } catch (e) {
        (opts.log ?? (() => {}))(`[reviews] invite email failed to build for ${b.ref}: ${(e as Error).message}`);
      }
      issued.push({ ref: b.ref, email: trav.email, emailStatus });
    }

    await audit(db, {
      actorId: actor.id, action: 'departure.request_reviews', targetType: 'departure', targetId: departureId,
      after: { departureStatus, issued: issued.length, skipped: skipped.length }, ip: actor.ip,
    });

    return { departureId, departureStatus, eligible: bookings.length, issued, skipped };
  }

  // ── 2a. Redeem context (consumer) ────────────────────────────────────────────
  async function getRedeemContext(token: string) {
    const inv = (await db.query(
      `SELECT ri.token, ri.tour_id, ri.traveller_name, ri.traveller_email, ri.redeemed_at,
              t.slug AS tour_slug, t.title AS tour_title, t.image AS tour_image
         FROM review_invite ri JOIN tour t ON t.id = ri.tour_id WHERE ri.token = $1`, [token])).rows[0];
    if (!inv) throw new ReviewError('not_found', 'invalid or unknown review link', 404);
    if (inv.redeemed_at) throw new ReviewError('gone', 'this review link has already been used', 410);
    return {
      token: inv.token,
      tour: { slug: inv.tour_slug, title: inv.tour_title, image: inv.tour_image ?? null },
      prefill: { name: inv.traveller_name ?? '', email: inv.traveller_email ?? '' },
    };
  }

  // ── 2b. Submit (consumer) ────────────────────────────────────────────────────
  // Validates the payload, then atomically burns the token + writes a verified pending review.
  async function submitReview(token: string, body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;

    const ratingRaw = b.rating;
    const rating = typeof ratingRaw === 'number' ? ratingRaw : Number(ratingRaw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ReviewError('validation', 'rating must be an integer from 1 to 5', 422, 'rating');
    }
    let title: string | null = null;
    if (b.title != null && b.title !== '') {
      if (typeof b.title !== 'string') throw new ReviewError('validation', '"title" must be a string', 422, 'title');
      if (b.title.length > 200) throw new ReviewError('validation', '"title" is too long', 422, 'title');
      title = b.title.trim();
    }
    let text = '';
    if (b.text != null) {
      if (typeof b.text !== 'string') throw new ReviewError('validation', '"text" must be a string', 422, 'text');
      if (b.text.length > 5000) throw new ReviewError('validation', '"text" is too long', 422, 'text');
      text = b.text.trim();
    }

    // Atomic redeem: lock the invite row, reject a missing/spent token, insert + burn in one transaction.
    return db.tx(async (q) => {
      const inv = (await q.query(
        `SELECT id, tour_id, booking_id, traveller_name, redeemed_at
           FROM review_invite WHERE token = $1 FOR UPDATE`, [token])).rows[0];
      if (!inv) throw new ReviewError('not_found', 'invalid or unknown review link', 404);
      if (inv.redeemed_at) throw new ReviewError('gone', 'this review link has already been used', 410);

      const authorName = (inv.traveller_name ?? '').trim() || 'TripKoach traveller';
      const row = (await q.query(
        `INSERT INTO review (tour_id, booking_id, author_name, rating, title, text, verified, status)
         VALUES ($1,$2,$3,$4,$5,$6,true,'pending') RETURNING id, created_at`,
        [inv.tour_id, inv.booking_id, authorName, rating, title, text])).rows[0];
      await q.query(`UPDATE review_invite SET redeemed_at = now() WHERE id = $1`, [inv.id]);

      return {
        id: row.id,
        status: 'pending' as const,
        rating,
        title: title ?? '',
        text,
        verified: true,
        message: 'Thank you! Your review has been submitted and will appear once approved.',
      };
    });
  }

  return { requestReviews, getRedeemContext, submitReview };
}

export type ReviewsService = ReturnType<typeof createReviewsService>;
