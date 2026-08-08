// TRI-866 Phase 2 · Booking + payment write service. All write logic lives here; routes parse/serialise.
// Concurrency-safe seat reservation (atomic guarded decrement + the departure_no_oversell DB CHECK as the
// final seatbelt), USD→GHS conversion at checkout, Paystack init/verify, and an idempotent webhook path.

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import type { PaystackClient } from './paystack.ts';
import type { NotificationService } from './notifications.ts';
import { fromMinor } from './util.ts';

// ── Typed errors (mapped to the {error:{code,message}} envelope + HTTP status by the route layer) ──
export class BookingError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'BookingError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ── Request/response types (mirror the DTOs published in-issue for the FE) ──
export interface TravellerInput {
  name: string; email?: string | null; phone?: string | null; idNumber?: string | null; isLead?: boolean;
}
export interface CreateBookingInput {
  tourSlug: string;
  departureId: string;
  packageSlug?: string | null;
  partySize: number;
  specialRequests?: string | null;
  agreedTerms?: boolean;
  promoCode?: string | null;
  travellers: TravellerInput[];
}

// A validated, priced promo redemption. discountMinor is already capped to the subtotal (never negative).
interface AppliedPromo {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;         // percent (0-100) or the fixed amount in whole currency units
  discountMinor: number;
}

// GHS pesewas = round(USD cents × GHS-per-USD). cents × (GHS/USD) = pesewas (both are ×100 minor units).
export function usdMinorToGhsMinor(usdMinor: number, rate: number): number {
  return Math.round(usdMinor * rate);
}

// ── Ref generation: TK-XXXXXX / PAY-XXXXXX from an unambiguous base32 alphabet ──
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
function randomCode(n: number): string {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += REF_ALPHABET[b[i] % 32];
  return s;
}

export interface BookingService {
  create(input: CreateBookingInput, opts?: { userId?: string | null }): Promise<any>;
  getByRef(ref: string): Promise<any | null>;
  initPayment(ref: string, opts?: { channel?: string }): Promise<any>;
  verifyPayment(ref: string, reference?: string): Promise<any>;
  handleWebhook(rawBody: string | Buffer, signature: string | undefined): Promise<{ received: boolean }>;
  expireHolds(now?: Date): Promise<{ released: number; refs: string[] }>;
  /** Resolve the USD→GHS charge rate: env override → settings.charge_rate → settings.display_rate. */
  resolveChargeRate(): Promise<number>;
  /** Same precedence as resolveChargeRate, plus the rate's provenance (source + when established),
   *  persisted per-payment for reconciliation (TRI-873). */
  resolveChargeRateDetail(): Promise<ChargeRate>;
}

// Resolved charge rate + provenance. `source` is one of: an FX provider name (e.g. 'open.er-api.com'),
// 'env_override', 'settings', 'settings_display', or 'fallback_default'. `at` is when that rate was
// established (fx_rate_history.fetched_at / settings.updated_at / charge time for the env override).
export interface ChargeRate {
  rate: number;
  source: string;
  at: Date;
}

export function createBookingService(
  db: Db, cfg: Config, paystack: PaystackClient, notifier?: NotificationService,
): BookingService {
  // ── unique-ref insert helper: retries a few times on the UNIQUE collision ──
  async function insertUniqueRef<T>(
    prefix: string, len: number, run: (ref: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ref = `${prefix}-${randomCode(len)}`;
      try {
        return await run(ref);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (/unique|duplicate/i.test(msg)) continue; // ref collision → try another
        throw e;
      }
    }
    throw new BookingError('ref_collision', 'Could not allocate a unique reference', 500);
  }

  // Resolve the charge rate with provenance. Precedence is unchanged (env override → settings.charge →
  // settings.display → 15.6); we additionally attribute WHERE the rate came from and WHEN, so each
  // payment row is auditable. The automated FX cron (TRI-873) writes settings.usd_to_ghs_charge_rate,
  // so in prod (no env override) `source` reflects the FX provider + its fetch time.
  async function resolveChargeRateDetail(): Promise<ChargeRate> {
    // env override wins (ops kill-switch); provenance = the override, established now.
    if (cfg.paystack.chargeRateOverride != null) {
      return { rate: cfg.paystack.chargeRateOverride, source: 'env_override', at: new Date() };
    }
    const { rows } = await db.query<{ charge: string | null; display: string | null; updated_at: string | null }>(
      `SELECT usd_to_ghs_charge_rate AS charge, usd_to_ghs_display_rate AS display, updated_at
       FROM settings WHERE singleton = true`);
    const r = rows[0];
    const settingsAt = r?.updated_at ? new Date(r.updated_at) : new Date();
    const charge = r?.charge != null ? Number(r.charge) : NaN;
    if (Number.isFinite(charge) && charge > 0) {
      // Attribute to the FX refresh that produced this rate, if the latest applied effective rate matches.
      const hist = await db.query<{ source: string; fetched_at: string; effective_rate: string }>(
        `SELECT source, fetched_at, effective_rate FROM fx_rate_history WHERE status = 'ok'
         ORDER BY fetched_at DESC LIMIT 1`).catch(() => ({ rows: [] as any[] }));
      const h = hist.rows[0];
      if (h && Math.abs(Number(h.effective_rate) - charge) < 5e-5) {
        return { rate: charge, source: h.source, at: new Date(h.fetched_at) };
      }
      return { rate: charge, source: 'settings', at: settingsAt };
    }
    const display = r?.display != null ? Number(r.display) : NaN;
    if (Number.isFinite(display) && display > 0) {
      return { rate: display, source: 'settings_display', at: settingsAt };
    }
    return { rate: 15.6, source: 'fallback_default', at: new Date() }; // documented fallback
  }

  async function resolveChargeRate(): Promise<number> {
    return (await resolveChargeRateDetail()).rate;
  }

  // ── Pricing: departure price overrides; else the tour/package tier step-function on party size. ──
  async function unitPriceMinor(
    q: Db, tour: any, dep: any, packageId: string | null, partySize: number,
  ): Promise<number> {
    if (dep.price_minor != null) return Number(dep.price_minor);
    const parent = packageId
      ? { col: 'package_id', id: packageId }
      : { col: 'tour_id', id: tour.id };
    const { rows } = await q.query<{ price_minor: string }>(
      `SELECT price_minor FROM price_tier
       WHERE ${parent.col} = $1 AND min_pax <= $2
       ORDER BY min_pax DESC LIMIT 1`, [parent.id, partySize]);
    if (rows[0]) return Number(rows[0].price_minor);
    return Number(tour.base_price_minor); // fall back to the "from" price
  }

  // ── Promo redemption (C7). Validate a code against the booked tour + subtotal, then ATOMICALLY claim
  // one usage against the usage_limit. Runs inside the booking transaction (after the seat reserve) so a
  // rolled-back booking never leaks a redemption; the caller stores promo_code_id + discount on the row so
  // the redemption can be released again if the hold is cancelled or expires (see expireHolds / admin cancel).
  async function applyPromo(
    q: Db, rawCode: string, tour: any, subtotalMinor: number, currency: string,
  ): Promise<AppliedPromo> {
    const code = String(rawCode).trim().toUpperCase();
    if (!code) throw new BookingError('promo_invalid', 'Enter a promo code', 422);
    const { rows } = await q.query(`SELECT * FROM promo_code WHERE code = $1`, [code]);
    const p = rows[0];
    if (!p) throw new BookingError('promo_invalid', 'That promo code was not recognised', 422);
    if (!p.active) throw new BookingError('promo_inactive', 'That promo code is no longer active', 422);

    const now = Date.now();
    if (p.valid_from && new Date(p.valid_from).getTime() > now) {
      throw new BookingError('promo_not_started', 'That promo code is not valid yet', 422);
    }
    if (p.valid_to && new Date(p.valid_to).getTime() < now) {
      throw new BookingError('promo_expired', 'That promo code has expired', 422);
    }

    // Scope: all | category (matches tour category enum or its display label) | tour (matches slug or id).
    if (p.scope === 'tour') {
      if (p.scope_ref !== tour.slug && p.scope_ref !== tour.id) {
        throw new BookingError('promo_scope', 'That promo code does not apply to this tour', 422);
      }
    } else if (p.scope === 'category') {
      const ref = String(p.scope_ref ?? '').toLowerCase();
      const cat = String(tour.category ?? '').toLowerCase();
      const label = String(tour.category_label ?? '').toLowerCase();
      if (ref !== cat && ref !== label) {
        throw new BookingError('promo_scope', 'That promo code does not apply to this tour', 422);
      }
    }

    // Discount. percent → % of subtotal; fixed → promo.value minor units in promo.currency (must match the
    // booking currency — the discount is applied to the USD display quote; GHS is derived at charge time).
    let discountMinor: number;
    if (p.type === 'percent') {
      discountMinor = Math.round(subtotalMinor * Number(p.value) / 100);
    } else {
      const promoCurrency = (p.currency ?? currency).toUpperCase();
      if (promoCurrency !== currency.toUpperCase()) {
        throw new BookingError('promo_currency', 'That promo code cannot be applied to this booking', 422);
      }
      discountMinor = Number(p.value);
    }
    discountMinor = Math.max(0, Math.min(discountMinor, subtotalMinor)); // never drive the total negative

    // Atomically claim one redemption. Guard the usage_limit in the UPDATE so concurrent bookings can't
    // over-redeem — a 0-row result means the limit is exhausted.
    const claim = await q.query(
      `UPDATE promo_code SET used_count = used_count + 1, updated_at = now()
        WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit)
      RETURNING used_count`, [p.id]);
    if (claim.rowCount === 0) {
      throw new BookingError('promo_limit_reached', 'That promo code has reached its usage limit', 422);
    }

    const value = p.type === 'fixed' ? fromMinor(Number(p.value)) : Number(p.value);
    return { id: p.id, code, type: p.type, value, discountMinor };
  }

  // ── CREATE + RESERVE (single transaction) ──
  async function create(input: CreateBookingInput, opts?: { userId?: string | null }): Promise<any> {
    const partySize = Number(input.partySize);
    if (!Number.isInteger(partySize) || partySize < 1) {
      throw new BookingError('validation', 'partySize must be an integer >= 1', 422);
    }
    if (input.agreedTerms !== true) {
      throw new BookingError('validation', 'Terms must be agreed before booking', 422);
    }
    const travellers = Array.isArray(input.travellers) ? input.travellers : [];
    const lead = travellers.find((t) => t.isLead) ?? travellers[0];
    if (!lead || !lead.name) {
      throw new BookingError('validation', 'At least one (lead) traveller with a name is required', 422);
    }
    if (!lead.email && !lead.phone) {
      throw new BookingError('validation', 'The lead traveller must carry an email or phone', 422);
    }

    return db.tx(async (q) => {
      const tourRes = await q.query(
        `SELECT id, slug, title, currency, base_price_minor, category, category_label
           FROM tour WHERE slug = $1 AND published`,
        [input.tourSlug]);
      const tour = tourRes.rows[0];
      if (!tour) throw new BookingError('not_found', `tour "${input.tourSlug}" not found`, 404);

      let packageId: string | null = null;
      if (input.packageSlug) {
        const pkg = await q.query(`SELECT id FROM tour_package WHERE tour_id = $1 AND slug = $2`,
          [tour.id, input.packageSlug]);
        if (!pkg.rows[0]) throw new BookingError('not_found', `package "${input.packageSlug}" not found`, 404);
        packageId = pkg.rows[0].id;
      }

      // Load the departure to validate existence/status and to give a precise sold-out message.
      const depRes = await q.query(
        `SELECT id, tour_id, date_label, time_label, price_minor, currency, seats_total, seats_reserved, status
         FROM departure WHERE id = $1`, [input.departureId]);
      const dep = depRes.rows[0];
      if (!dep || dep.tour_id !== tour.id) {
        throw new BookingError('not_found', 'departure not found for this tour', 404);
      }
      if (dep.status !== 'scheduled') {
        throw new BookingError('not_bookable', `departure is ${dep.status}`, 409);
      }

      // Atomic guarded decrement — the real concurrency gate. The DB CHECK is the final seatbelt.
      const reserve = await q.query<{ seats_reserved: number }>(
        `UPDATE departure
            SET seats_reserved = seats_reserved + $2, updated_at = now()
          WHERE id = $1 AND status = 'scheduled' AND seats_reserved + $2 <= seats_total
        RETURNING seats_reserved, seats_total`, [dep.id, partySize]);
      if (reserve.rowCount === 0) {
        const left = Math.max(0, Number(dep.seats_total) - Number(dep.seats_reserved));
        throw new BookingError('sold_out', `Only ${left} seat(s) left on this departure`, 409);
      }

      const unit = await unitPriceMinor(q, tour, dep, packageId, partySize);
      const subtotal = unit * partySize;
      const currency = tour.currency || 'USD';

      // Promo (C7): validate + claim a redemption, then discount the subtotal. Runs after the seat reserve
      // so a sold-out booking never consumes a code; the tx rollback releases the claim if anything below fails.
      const promo = input.promoCode
        ? await applyPromo(q, input.promoCode, tour, subtotal, currency)
        : null;
      const total = subtotal - (promo?.discountMinor ?? 0);
      const expires = new Date(Date.now() + cfg.reservationHoldMinutes * 60_000);

      const bk = await insertUniqueRef('TK', 6, async (ref) => {
        const r = await q.query(
          `INSERT INTO booking
             (ref, tour_id, departure_id, package_id, party_size, unit_price_minor, total_minor,
              currency, status, payment_state, reservation_expires_at, special_requests, agreed_terms_at,
              promo_code_id, discount_minor, user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'reserved','unpaid',$9,$10, now(),$11,$12,$13)
           RETURNING id, ref`,
          [ref, tour.id, dep.id, packageId, partySize, unit, total, currency,
           expires.toISOString(), input.specialRequests ?? null,
           promo?.id ?? null, promo?.discountMinor ?? 0, opts?.userId ?? null]);
        return r.rows[0];
      });

      for (const t of travellers) {
        await q.query(
          `INSERT INTO booking_traveller (booking_id, is_lead, name, email, phone, id_number)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [bk.id, t === lead, t.name, t.email ?? null, t.phone ?? null, t.idNumber ?? null]);
      }

      return {
        ref: bk.ref,
        status: 'reserved',
        paymentState: 'unpaid',
        reservationExpiresAt: expires.toISOString(),
        quote: {
          unitPrice: fromMinor(unit), subtotal: fromMinor(subtotal),
          discount: fromMinor(promo?.discountMinor ?? 0), total: fromMinor(total),
          currency, partySize,
          promo: promo ? { code: promo.code, type: promo.type, value: promo.value, discount: fromMinor(promo.discountMinor) } : null,
        },
        tour: { slug: tour.slug, title: tour.title },
        departure: { id: dep.id, date: dep.date_label, time: dep.time_label ?? '' },
      };
    });
  }

  // ── Read a booking (+ payment) by ref for the FE polling / confirmation screen ──
  async function loadBooking(q: Db, ref: string): Promise<any | null> {
    const { rows } = await q.query(
      `SELECT b.*, t.slug AS tour_slug, t.title AS tour_title,
              d.date_label, d.time_label, pc.code AS promo_code, pc.type AS promo_type
       FROM booking b
       JOIN tour t ON t.id = b.tour_id
       JOIN departure d ON d.id = b.departure_id
       LEFT JOIN promo_code pc ON pc.id = b.promo_code_id
       WHERE b.ref = $1`, [ref]);
    return rows[0] ?? null;
  }

  async function latestPayment(q: Db, bookingId: string): Promise<any | null> {
    const { rows } = await q.query(
      `SELECT * FROM payment WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`, [bookingId]);
    return rows[0] ?? null;
  }

  function bookingDTO(b: any, travellers: any[], pay: any | null) {
    return {
      ref: b.ref,
      status: b.status,
      paymentState: b.payment_state,
      reservationExpiresAt: b.reservation_expires_at
        ? new Date(b.reservation_expires_at).toISOString() : null,
      quote: {
        unitPrice: fromMinor(Number(b.unit_price_minor)),
        subtotal: fromMinor(Number(b.total_minor) + Number(b.discount_minor ?? 0)),
        discount: fromMinor(Number(b.discount_minor ?? 0)),
        total: fromMinor(Number(b.total_minor)),
        currency: b.currency, partySize: Number(b.party_size),
        promo: b.promo_code ? {
          code: b.promo_code, type: b.promo_type, discount: fromMinor(Number(b.discount_minor ?? 0)),
        } : null,
      },
      tour: { slug: b.tour_slug, title: b.tour_title },
      departure: { id: b.departure_id, date: b.date_label, time: b.time_label ?? '' },
      travellers: travellers.map((t) => ({
        name: t.name, email: t.email ?? null, phone: t.phone ?? null, isLead: !!t.is_lead,
      })),
      payment: pay ? {
        reference: pay.ref,
        status: pay.status,
        currency: pay.currency,
        usd: fromMinor(pay.usd_amount_minor != null ? Number(pay.usd_amount_minor) : Number(pay.amount_minor)),
        ghs: pay.ghs_amount_minor != null ? fromMinor(Number(pay.ghs_amount_minor)) : null,
      } : null,
    };
  }

  async function getByRef(ref: string): Promise<any | null> {
    const b = await loadBooking(db, ref);
    if (!b) return null;
    const trav = await db.query(`SELECT name, email, phone, is_lead FROM booking_traveller
      WHERE booking_id = $1 ORDER BY is_lead DESC, created_at`, [b.id]);
    const pay = await latestPayment(db, b.id);
    return bookingDTO(b, trav.rows, pay);
  }

  // ── Initialise a Paystack transaction: create the payment row (GHS), call Paystack initialize ──
  async function initPayment(ref: string, opts?: { channel?: string }): Promise<any> {
    const b = await loadBooking(db, ref);
    if (!b) throw new BookingError('not_found', `booking "${ref}" not found`, 404);
    if (b.payment_state === 'paid' || b.status === 'confirmed') {
      throw new BookingError('not_payable', 'Booking is already paid', 409);
    }
    if (!['reserved', 'pending'].includes(b.status)) {
      throw new BookingError('not_payable', `Booking is ${b.status} and cannot be paid`, 409);
    }

    // Lead contact carries the payer email (Paystack requires an email).
    const leadRes = await db.query(
      `SELECT email FROM booking_traveller WHERE booking_id = $1 AND (is_lead OR email IS NOT NULL)
       ORDER BY is_lead DESC LIMIT 1`, [b.id]);
    const email = leadRes.rows[0]?.email;
    if (!email) throw new BookingError('validation', 'Booking has no contact email for payment', 422);

    const usdMinor = Number(b.total_minor);
    const rateInfo = await resolveChargeRateDetail();
    const rate = rateInfo.rate;
    const ghsMinor = usdMinorToGhsMinor(usdMinor, rate);
    const channel = opts?.channel;
    const channels = channel === 'mobile_money' ? ['mobile_money']
      : channel === 'card' ? ['card'] : undefined;

    // Persist a pending payment row first (GHS currency + full FX reconciliation), then call Paystack.
    const pay = await insertUniqueRef('PAY', 6, async (payRef) => {
      const r = await db.query(
        `INSERT INTO payment
           (ref, booking_id, amount_minor, currency, method, status,
            usd_amount_minor, fx_rate_used, ghs_amount_minor, fx_source, fx_rate_at)
         VALUES ($1,$2,$3,'GHS',$4,'pending',$5,$6,$7,$8,$9)
         RETURNING id, ref`,
        [payRef, b.id, usdMinor, channel === 'mobile_money' ? 'mobile_money' : 'paystack_card',
         usdMinor, rate, ghsMinor, rateInfo.source, rateInfo.at.toISOString()]);
      return r.rows[0];
    });

    let init;
    try {
      init = await paystack.initialize({
        email,
        amountMinor: ghsMinor,
        reference: pay.ref,
        currency: 'GHS',
        channels,
        // TRI-926: FE uses a full-page REDIRECT to Paystack's hosted checkout, so Paystack MUST know
        // where to send the payer back. Derive the return URL server-side from the configured web base
        // (never from client input) → no open-redirect surface. Paystack appends ?trxref=&reference= and
        // the /confirm page reconciles (server-side verify + poll). The booking ref is recovered from the
        // FE's sessionStorage (tk.lastBookingRef), so we intentionally send a query-less callback.
        callbackUrl: `${cfg.notify.webBaseUrl}/confirm`,
        metadata: { bookingRef: b.ref, usdMinor, fxRate: rate },
      });
    } catch (e) {
      // Mark the payment failed so it doesn't dangle as pending; surface the provider error.
      await db.query(`UPDATE payment SET status = 'failed' WHERE id = $1`, [pay.id]);
      if (e instanceof BookingError) throw e;
      const status = (e as any)?.status ?? 502;
      throw new BookingError('paystack_error', (e as Error).message, status);
    }

    // Move the booking to pending payment; keep the seat hold.
    await db.query(
      `UPDATE booking SET payment_state = 'pending', status = 'pending', updated_at = now()
       WHERE id = $1 AND status = 'reserved'`, [b.id]);

    return {
      reference: pay.ref,
      authorizationUrl: init.authorizationUrl,
      accessCode: init.accessCode,
      publicKey: cfg.paystack.publicKey ?? null,
      amount: {
        usd: fromMinor(usdMinor), ghs: fromMinor(ghsMinor), ghsPesewas: ghsMinor,
        fxRate: rate, currency: 'GHS',
      },
    };
  }

  // ── Confirm a booking from a paid transaction (idempotent; shared by verify + webhook) ──
  async function markPaid(reference: string, providerRef: string, raw: unknown): Promise<any | null> {
    const result = await db.tx(async (q) => {
      const payRes = await q.query(
        `SELECT p.*, b.ref AS booking_ref, b.status AS booking_status, b.payment_state
         FROM payment p JOIN booking b ON b.id = p.booking_id
         WHERE p.ref = $1 FOR UPDATE OF p`, [reference]);
      const pay = payRes.rows[0];
      if (!pay) return null; // unknown reference (e.g. webhook for a foreign txn) — caller no-ops

      if (pay.status === 'paid' && pay.payment_state === 'paid') {
        // Already confirmed — idempotent no-op; don't re-send the confirmation email.
        return { ref: pay.booking_ref, status: pay.booking_status, paymentState: pay.payment_state, justConfirmed: false };
      }
      await q.query(
        `UPDATE payment SET status = 'paid', provider_ref = $2, raw = $3 WHERE id = $1`,
        [pay.id, providerRef, JSON.stringify(raw)]);
      await q.query(
        `UPDATE booking SET status = 'confirmed', payment_state = 'paid', updated_at = now()
         WHERE id = $1`, [pay.booking_id]);
      return { ref: pay.booking_ref, status: 'confirmed', paymentState: 'paid', justConfirmed: true };
    });
    // Fire the booking-confirmed email AFTER the tx commits, and only on the fresh transition (never on
    // an idempotent replay). notifier calls never throw — a confirmed payment must not depend on email.
    if (result?.justConfirmed && notifier) {
      await notifier.bookingConfirmed(result.ref);
    }
    return result;
  }

  // ── Mark a payment failed from a webhook (idempotent). Returns the booking ref ONLY when it flipped a
  //    non-failed payment to failed, so the caller emails the payer exactly once. ──
  async function markPaymentFailed(reference: string, raw: unknown): Promise<string | null> {
    return db.tx(async (q) => {
      const payRes = await q.query(
        `SELECT p.id, p.status, b.ref AS booking_ref, b.payment_state
         FROM payment p JOIN booking b ON b.id = p.booking_id
         WHERE p.ref = $1 FOR UPDATE OF p`, [reference]);
      const pay = payRes.rows[0];
      if (!pay) return null;                               // unknown reference — no-op
      if (pay.payment_state === 'paid') return null;       // already paid — ignore a stray fail event
      if (pay.status === 'failed') return null;            // already failed — don't re-notify
      await q.query(`UPDATE payment SET status = 'failed', raw = $2 WHERE id = $1`,
        [pay.id, JSON.stringify(raw)]);
      return pay.booking_ref as string;
    });
  }

  // ── Server-side verify (FE calls after checkout; fallback to the webhook when it lands first) ──
  async function verifyPayment(ref: string, reference?: string): Promise<any> {
    const b = await loadBooking(db, ref);
    if (!b) throw new BookingError('not_found', `booking "${ref}" not found`, 404);

    const pay = await latestPayment(db, b.id);
    const payRef = reference || pay?.ref;
    if (!payRef) throw new BookingError('not_found', 'no payment to verify for this booking', 404);

    // Already confirmed (e.g. webhook beat us here) — report idempotently without re-hitting Paystack.
    if (b.status === 'confirmed' && b.payment_state === 'paid') {
      return { ref: b.ref, status: 'confirmed', paymentState: 'paid', verified: true };
    }

    const result = await paystack.verify(payRef);
    if (result.status === 'success') {
      const out = await markPaid(payRef, result.providerRef, result.raw);
      return { ref: b.ref, status: out?.status ?? 'confirmed', paymentState: 'paid', verified: true };
    }

    // Not paid (pending/failed/abandoned). Reflect a hard failure on the payment row; keep the hold.
    if (['failed', 'abandoned', 'reversed'].includes(result.status)) {
      await db.query(`UPDATE payment SET status = 'failed', raw = $2 WHERE ref = $1`,
        [payRef, JSON.stringify(result.raw)]);
      // Email the payer once on the transition into failed (not on repeated verify polls of an already
      // failed payment). Fire-and-forget: never let an email issue affect the verify response.
      if (notifier && pay?.status !== 'failed') {
        await notifier.paymentFailed(b.ref);
      }
    }
    const fresh = await loadBooking(db, ref);
    return { ref: b.ref, status: fresh.status, paymentState: fresh.payment_state, verified: false };
  }

  // ── Webhook: verify HMAC over the RAW body, dedup via paystack_event, apply charge.success ──
  function verifySignature(rawBody: string | Buffer, signature: string): boolean {
    const key = cfg.paystack.webhookSecret || cfg.paystack.secretKey;
    if (!key) return false;
    const expected = createHmac('sha512', key).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async function handleWebhook(rawBody: string | Buffer, signature: string | undefined): Promise<{ received: boolean }> {
    if (!signature || !verifySignature(rawBody, signature)) {
      throw new BookingError('invalid_signature', 'Invalid webhook signature', 401);
    }
    let event: any;
    try {
      event = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    } catch {
      throw new BookingError('bad_request', 'Malformed webhook payload', 400);
    }

    const data = event?.data ?? {};
    const type: string = event?.event ?? 'unknown';
    const isRefund = type.startsWith('refund.');
    // Charge events carry data.reference; refund events carry data.transaction_reference (the original
    // transaction). Normalise so both paths key off the transaction reference we stored as payment.ref.
    const reference: string | null =
      (isRefund ? (data?.transaction_reference ?? data?.transaction?.reference) : data?.reference) ?? null;
    // Dedup key: Paystack's data.id when present; else synthesise a stable key. Refund states (pending →
    // processed) are distinct deliveries, so the refund key includes the status to let each apply once.
    const eventId = data?.id != null ? String(data.id)
      : isRefund && reference ? `refund:${reference}:${data?.status ?? type}`
      : null;

    // Idempotency: insert-once on event_id. A duplicate delivery collides and is a no-op.
    if (eventId) {
      const ins = await db.query(
        `INSERT INTO paystack_event (event_id, reference, type, payload)
         VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING RETURNING id`,
        [eventId, reference, type, JSON.stringify(event)]);
      if (ins.rowCount === 0) return { received: true }; // already processed
    }

    if (type === 'charge.success' && reference) {
      await markPaid(reference, eventId ?? reference, data);
    } else if (type === 'refund.processed' && reference) {
      // A settled refund (may be admin-initiated or dashboard-initiated). Record + flip idempotently.
      await applyRefund(reference, data?.id != null ? String(data.id) : (eventId ?? reference), data);
    }
    // A failed/abandoned charge webhook: mark the payment failed (once) and email the payer. Keep the
    // seat hold — the expiry sweep releases it if they never pay. markFailed returns the booking ref
    // only when it actually transitioned a non-failed payment, so we email exactly once.
    if ((type === 'charge.failed' || type === 'charge.abandoned') && reference) {
      const bookingRef = await markPaymentFailed(reference, data);
      if (bookingRef && notifier) await notifier.paymentFailed(bookingRef);
    }
    if (eventId) {
      await db.query(`UPDATE paystack_event SET processed_at = now() WHERE event_id = $1`, [eventId]);
    }
    return { received: true };
  }

  // ── Apply a settled refund to the ledger (idempotent; shared by webhook; mirrors admin executeRefund) ──
  // Records a linked negative refund row keyed on the Paystack refund id (partial-unique), flips the
  // original charge to 'refunded', and marks the booking refunded. Safe if 013 hasn't landed (no-op).
  async function applyRefund(transactionRef: string, refundProviderId: string, data: any): Promise<void> {
    const hasCols = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='payment' AND column_name='refund_provider_id'`,
    ).then((r) => r.rows.length > 0);
    if (!hasCols) return; // DB predates migration 013 — nothing to reconcile against
    await db.tx(async (q) => {
      const pay = (await q.query(
        `SELECT id, booking_id, status, currency, method, amount_minor, ghs_amount_minor
           FROM payment WHERE ref=$1 OR provider_ref=$1 FOR UPDATE`, [transactionRef])).rows[0];
      if (!pay) return; // unknown transaction — foreign refund, no-op
      const refundedMinor = Number(data?.amount ?? pay.ghs_amount_minor ?? pay.amount_minor) || 0;
      await insertUniqueRef('RFN', 6, async (rfnRef) => {
        await q.query(
          `INSERT INTO payment (ref, booking_id, amount_minor, currency, method, status,
                                provider_ref, raw, refund_of, refund_provider_id)
           VALUES ($1,$2,$3,$4,$5,'refunded',$6,$7,$8,$9)
           ON CONFLICT (refund_provider_id) WHERE refund_provider_id IS NOT NULL DO NOTHING`,
          [rfnRef, pay.booking_id, -Math.abs(refundedMinor), data?.currency ?? pay.currency, pay.method,
           refundProviderId, JSON.stringify({ refund: data, via: 'webhook' }), pay.id, refundProviderId]);
      });
      await q.query(`UPDATE payment SET status='refunded' WHERE id=$1 AND status <> 'refunded'`, [pay.id]);
      await q.query(`UPDATE booking SET payment_state='refunded', updated_at=now() WHERE id=$1`, [pay.booking_id]);
    });
  }

  // ── Expiry sweep: release unpaid holds past reservation_expires_at (cron-callable) ──
  async function expireHolds(now: Date = new Date()): Promise<{ released: number; refs: string[] }> {
    return db.tx(async (q) => {
      const due = await q.query<{ id: string; ref: string; departure_id: string; party_size: number; promo_code_id: string | null }>(
        `SELECT id, ref, departure_id, party_size, promo_code_id FROM booking
          WHERE status IN ('reserved','pending')
            AND payment_state IN ('unpaid','pending')
            AND reservation_expires_at IS NOT NULL
            AND reservation_expires_at < $1
          FOR UPDATE`, [now.toISOString()]);
      const refs: string[] = [];
      for (const bk of due.rows) {
        // Release the held seats (guarded so we never drive seats_reserved below 0).
        await q.query(
          `UPDATE departure
              SET seats_reserved = GREATEST(0, seats_reserved - $2), updated_at = now()
            WHERE id = $1`, [bk.departure_id, bk.party_size]);
        // Release the promo redemption so a limited code isn't consumed by an abandoned hold.
        if (bk.promo_code_id) {
          await q.query(
            `UPDATE promo_code SET used_count = GREATEST(0, used_count - 1), updated_at = now() WHERE id = $1`,
            [bk.promo_code_id]);
        }
        await q.query(
          `UPDATE booking SET status = 'cancelled', payment_state = 'failed',
                  cancel_reason = 'non_payment', updated_at = now()
            WHERE id = $1`, [bk.id]);
        refs.push(bk.ref);
      }
      return { released: refs.length, refs };
    });
  }

  return { create, getByRef, initPayment, verifyPayment, handleWebhook, expireHolds, resolveChargeRate, resolveChargeRateDetail };
}
