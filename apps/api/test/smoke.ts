// End-to-end local smoke: PGlite (in-process Postgres) → migrate → seed from the v2 fixtures →
// exercise all six read endpoints via Fastify inject → assert contract shapes + the no-oversell CHECK.
// Run: npm run smoke   (no Docker / external Postgres needed)

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { buildServer } from '../src/server.ts';
import type { PaystackClient, PaystackInitRequest } from '../src/paystack.ts';
import { upsertStaff } from '../src/admin-seed.ts';
import type { EmailTransport } from '../src/email.ts';
import { totp } from '../src/totp.ts';

let passed = 0;
function ok(name: string, cond: boolean, detail = '') {
  assert.ok(cond, `${name} ${detail}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

const base = loadConfig();
const WEBHOOK_SECRET = 'whsec_test_tripkoach';
const cfg = {
  ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'test',
  reservationHoldMinutes: 30,
  // The RBAC/CRUD block below logs in as a factor-less admin/operator and expects a full session; MFA
  // ENFORCEMENT (TRI-912) is exercised separately in its own block against an enforced app, so keep the
  // enforced-role set empty here to keep those login assertions about RBAC, not the enroll gate.
  mfaEnforcedRoles: [] as string[],
  paystack: {
    ...base.paystack, secretKey: 'sk_test_stub', publicKey: 'pk_test_stub',
    webhookSecret: WEBHOOK_SECRET, chargeRateOverride: undefined,
  },
  // A From is set (EMAIL_FROM always configured in prod) but no RESEND_API_KEY → transport stays
  // DISABLED (skipped, no network). Wired flows (TRI-889 booking-lifecycle, TRI-881 password reset,
  // TRI-892 review invites) still render + write their 'skipped' send-log rows without dispatching.
  email: { ...base.email, from: 'TripKoach <bookings@send.tripkoach.com>', apiKey: undefined, dryRun: false },
};
const db = await createDb(cfg);
const applied = await migrate(db);
console.log(`migrations applied: ${applied.length}`);
await seed(db, undefined, (m) => console.log(`  seed · ${m}`));

// Stub Paystack: no network. Records init calls; verify returns success unless overridden per reference.
const initCalls: PaystackInitRequest[] = [];
const refundCalls: { transaction: string; amountMinor?: number }[] = [];
const verifyStatus = new Map<string, string>();   // reference → status ('success' by default)
const paystackStub: PaystackClient = {
  async initialize(req) {
    initCalls.push(req);
    return { authorizationUrl: `https://checkout.paystack.com/stub/${req.reference}`,
             accessCode: `acc_${req.reference}`, reference: req.reference };
  },
  async verify(reference) {
    const status = verifyStatus.get(reference) ?? 'success';
    const last = initCalls.find((c) => c.reference === reference);
    return { status, reference, amountMinor: last?.amountMinor ?? 0, currency: 'GHS',
             providerRef: `pstk_${reference}`, raw: { reference, status } };
  },
  async refund(req) {
    refundCalls.push({ transaction: req.transaction, amountMinor: req.amountMinor });
    const amountMinor = req.amountMinor ?? 20000; // full refund of the stub charge when unspecified
    return { id: `rfnd_${req.transaction}`, status: 'processed', amountMinor,
             currency: req.currency ?? 'GHS', transactionRef: req.transaction,
             raw: { id: `rfnd_${req.transaction}`, status: 'processed', amount: amountMinor,
                    transaction: { reference: req.transaction } } };
  },
};

// TRI-918: stub R2 so the media-upload block exercises the full validate→address→publish→record path
// without network/credentials. Records every PUT so we can assert the key/content-type/cache-control.
const r2Puts: { key: string; contentType: string; cacheControl?: string; size: number }[] = [];
const storageStub = {
  enabled: true,
  async put(key: string, body: Uint8Array, opts: { contentType: string; cacheControl?: string }) {
    r2Puts.push({ key, contentType: opts.contentType, cacheControl: opts.cacheControl, size: body.length });
    return { etag: '"stub-etag"' };
  },
};

const app = buildServer(db, cfg, paystackStub, storageStub);
await app.ready();

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as any };
};
const post = async (url: string, payload?: any, headers?: Record<string, string>) => {
  const res = await app.inject({ method: 'POST', url, payload, headers });
  let body: any = undefined;
  try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};

console.log('\n[health]');
{
  const { status, body } = await get('/health');
  ok('GET /health 200', status === 200);
  ok('health status ok', body.status === 'ok', JSON.stringify(body));
  ok('health reports pglite driver', body.db === 'pglite');
  ok('GET /api/health 200 (proxy path, no strip)', (await get('/api/health')).status === 200);
}

console.log('\n[regions]');
{
  const { status, body } = await get('/api/v1/regions');
  ok('GET /regions 200', status === 200);
  ok('regions is array', Array.isArray(body.regions));
  const r0 = body.regions[0];
  ok('region shape {name,slug,tourCount,note}',
    r0 && 'name' in r0 && 'slug' in r0 && 'tourCount' in r0 && 'note' in r0, JSON.stringify(r0));
  const accra = body.regions.find((r: any) => r.name === 'Greater Accra');
  ok('Greater Accra tourCount=2', accra?.tourCount === 2, `got ${accra?.tourCount}`);
  const central = body.regions.find((r: any) => r.name === 'Central');
  ok('Central tourCount=3', central?.tourCount === 3, `got ${central?.tourCount}`);
}

console.log('\n[tours: browse]');
{
  const { status, body } = await get('/api/v1/tours');
  ok('GET /tours 200', status === 200);
  ok('total=11', body.total === 11, `got ${body.total}`);
  ok('page/pageSize/totalPages present', body.page === 1 && body.pageSize === 12 && body.totalPages === 1);
  const card = body.items[0];
  ok('card shape',
    card && 'id' in card && 'title' in card && 'region' in card && 'category' in card &&
    'price' in card && 'currency' in card && 'reviews' in card && 'spotsLeft' in card, JSON.stringify(card));
  const accra = body.items.find((t: any) => t.id === 'accra-city-tour');
  ok('accra price is whole USD 65', accra?.price === 65, `got ${accra?.price}`);
  ok('accra spotsLeft hint = 11', accra?.spotsLeft === 11, `got ${accra?.spotsLeft}`);
  ok('accra category label "City Tour"', accra?.category === 'City Tour', accra?.category);
}

console.log('\n[tours: filters]');
{
  ok('category=Adventure → 3', (await get('/api/v1/tours?category=Adventure')).body.total === 3);
  ok('category enum=adventure → 3', (await get('/api/v1/tours?category=adventure')).body.total === 3);
  ok('region=Central → 3', (await get('/api/v1/tours?region=Central')).body.total === 3);
  ok('price=Under $200 → 1', (await get('/api/v1/tours?price=' + encodeURIComponent('Under $200'))).body.total === 1);
  ok('duration=Multi-day → many', (await get('/api/v1/tours?duration=' + encodeURIComponent('Multi-day'))).body.total >= 8);
  const q = (await get('/api/v1/tours?q=accra')).body;
  ok('q=accra includes accra-city-tour', q.items.some((t: any) => t.id === 'accra-city-tour'), JSON.stringify(q.items.map((t:any)=>t.id)));
  const asc = (await get('/api/v1/tours?sort=price_asc')).body;
  ok('sort=price_asc → cheapest first (65)', asc.items[0].price === 65, `got ${asc.items[0].price}`);
  const page2 = (await get('/api/v1/tours?pageSize=5&page=2')).body;
  ok('pagination page2 pageSize5', page2.items.length === 5 && page2.page === 2 && page2.totalPages === 3);
}

console.log('\n[tour detail]');
{
  const { status, body } = await get('/api/v1/tours/accra-city-tour');
  ok('GET /tours/:slug 200', status === 200);
  ok('detail price 65', body.price === 65);
  ok('detail tiers length 3', body.tiers?.length === 3, JSON.stringify(body.tiers));
  ok('tier shape {minPax,price}', body.tiers[0].minPax === 1 && body.tiers[0].price === 100);
  ok('packages length 3', body.packages?.length === 3, `got ${body.packages?.length}`);
  ok('package tiers present', body.packages[0].tiers?.length === 3);
  ok('defaultPackage route1', body.defaultPackage === 'route1', body.defaultPackage);
  ok('detail departures length 4', body.departures?.length === 4, `got ${body.departures?.length}`);
  ok('detail reviewStats count 3 avg 4.7', body.reviewStats.count === 3 && body.reviewStats.avg === 4.7, JSON.stringify(body.reviewStats));
  ok('highlights/included/excluded arrays', Array.isArray(body.highlights) && Array.isArray(body.included) && Array.isArray(body.excluded));
  ok('itinerary + pricing preserved', Array.isArray(body.itinerary) && body.itinerary.length === 6 && Array.isArray(body.pricing));
}

console.log('\n[availability]');
{
  const { status, body } = await get('/api/v1/tours/accra-city-tour/availability');
  ok('GET availability 200', status === 200);
  ok('4 departures', body.departures.length === 4);
  const d = body.departures.find((x: any) => x.date === 'Sat 15 Aug 2026');
  ok('departure shape {id,date,time,price,spotsLeft,status}',
    d && 'id' in d && 'date' in d && 'time' in d && 'price' in d && 'spotsLeft' in d && 'status' in d, JSON.stringify(d));
  ok('d1 spotsLeft 9 price 75', d.spotsLeft === 9 && d.price === 75, JSON.stringify(d));
  const sold = body.departures.find((x: any) => x.spotsLeft === 0);
  ok('sold-out departure status sold_out', sold?.status === 'sold_out', JSON.stringify(sold));
  // availability by UUID also resolves
  const tid = (await get('/api/v1/tours/accra-city-tour/availability')).body.tourId;
  ok('availability by uuid resolves', (await get(`/api/v1/tours/${tid}/availability`)).status === 200);
}

console.log('\n[reviews]');
{
  const { status, body } = await get('/api/v1/tours/accra-city-tour/reviews');
  ok('GET reviews 200', status === 200);
  ok('only approved (3)', body.reviews.length === 3, `got ${body.reviews.length}`);
  ok('no spam/pending leaked', !body.reviews.some((r: any) => /example-spam/.test(r.text)));
  const rev = body.reviews[0];
  ok('review shape {id,author,initials,rating,date,verified,title,text,reply}',
    rev && 'author' in rev && 'initials' in rev && 'rating' in rev && 'date' in rev && 'verified' in rev, JSON.stringify(rev));
  ok('stats count 3 avg 4.7', body.stats.count === 3 && body.stats.avg === 4.7, JSON.stringify(body.stats));
}

console.log('\n[errors]');
{
  ok('unknown tour → 404', (await get('/api/v1/tours/does-not-exist')).status === 404);
  ok('unknown availability → 404', (await get('/api/v1/tours/does-not-exist/availability')).status === 404);
}

console.log('\n[no-oversell invariant]');
{
  const { rows } = await db.query('SELECT seats_total, seats_reserved FROM departure');
  ok('all departures satisfy 0<=reserved<=total',
    rows.every((r: any) => r.seats_reserved >= 0 && r.seats_reserved <= r.seats_total), JSON.stringify(rows));
  // Prove the DB CHECK actually rejects an oversell, not just the app.
  let rejected = false;
  try {
    await db.query('UPDATE departure SET seats_reserved = seats_total + 1');
  } catch { rejected = true; }
  ok('DB rejects seats_reserved > seats_total (departure_no_oversell CHECK)', rejected);
}

// ── Phase 2 write paths (TRI-866): booking + Paystack payments ──
// Helper: create a controlled departure with a known capacity for deterministic reserve tests.
const { rows: tourRows } = await db.query(`SELECT id, currency FROM tour WHERE slug = 'accra-city-tour'`);
const accraTourId = tourRows[0].id;
async function makeDeparture(seatsTotal: number): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO departure (tour_id, date_label, time_label, price_minor, currency, seats_total, seats_reserved, status)
     VALUES ($1, 'Test Departure', '09:00 · Test', 7500, 'USD', $2, 0, 'scheduled') RETURNING id`,
    [accraTourId, seatsTotal]);
  return rows[0].id;
}
const leadTraveller = { name: 'Ama Mensah', email: 'ama@example.com', phone: '+233200000000', isLead: true };
const bookOne = (departureId: string, partySize = 1) => post('/api/v1/bookings', {
  tourSlug: 'accra-city-tour', departureId, partySize, agreedTerms: true,
  travellers: [{ ...leadTraveller }],
});

console.log('\n[booking: create + reserve]');
{
  const dep = await makeDeparture(5);
  const r = await bookOne(dep, 2);
  ok('POST /bookings 201', r.status === 201, JSON.stringify(r.body));
  ok('ref is TK-…', /^TK-[0-9A-Z]{6}$/.test(r.body.ref), r.body.ref);
  ok('status reserved / unpaid', r.body.status === 'reserved' && r.body.paymentState === 'unpaid');
  ok('quote unit 75 total 150 USD', r.body.quote.unitPrice === 75 && r.body.quote.total === 150 && r.body.quote.currency === 'USD', JSON.stringify(r.body.quote));
  ok('reservationExpiresAt set (future)', new Date(r.body.reservationExpiresAt).getTime() > Date.now());
  const { rows } = await db.query('SELECT seats_reserved FROM departure WHERE id = $1', [dep]);
  ok('seats_reserved incremented to 2', Number(rows[0].seats_reserved) === 2, JSON.stringify(rows[0]));
  // GET booking reflects it
  const g = await get(`/api/v1/bookings/${r.body.ref}`);
  ok('GET /bookings/:ref 200', g.status === 200);
  ok('GET booking travellers has lead', g.body.travellers?.some((t: any) => t.isLead && t.email === 'ama@example.com'), JSON.stringify(g.body.travellers));
  ok('GET booking payment null pre-init', g.body.payment === null);
}

console.log('\n[booking: validation]');
{
  const dep = await makeDeparture(5);
  ok('partySize<1 → 422', (await bookOne(dep, 0)).status === 422);
  ok('no terms → 422', (await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: dep, partySize: 1, travellers: [leadTraveller] })).status === 422);
  ok('no lead contact → 422', (await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: dep, partySize: 1, agreedTerms: true, travellers: [{ name: 'No Contact' }] })).status === 422);
  ok('unknown tour → 404', (await post('/api/v1/bookings', { tourSlug: 'nope', departureId: dep, partySize: 1, agreedTerms: true, travellers: [leadTraveller] })).status === 404);
  ok('unknown departure → 404', (await bookOne('00000000-0000-0000-0000-000000000000', 1)).status === 404);
}

console.log('\n[booking: sequential oversell → 409]');
{
  const dep = await makeDeparture(3);
  ok('fill 2 seats ok', (await bookOne(dep, 2)).status === 201);
  ok('fill last seat ok', (await bookOne(dep, 1)).status === 201);
  const over = await bookOne(dep, 1);
  ok('one seat over → 409 sold_out', over.status === 409 && over.body.error.code === 'sold_out', JSON.stringify(over.body));
  const { rows } = await db.query('SELECT seats_total, seats_reserved FROM departure WHERE id = $1', [dep]);
  ok('seats_reserved === seats_total (3), never over', Number(rows[0].seats_reserved) === 3, JSON.stringify(rows[0]));
}

console.log('\n[booking: concurrent burst never oversells]');
{
  const CAP = 5;
  const dep = await makeDeparture(CAP);
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => bookOne(dep, 1)));
  const statuses = results.map((r) => r.status === 'fulfilled' ? (r.value as any).status : 'rej');
  const successes = statuses.filter((s) => s === 201).length;
  const { rows } = await db.query('SELECT seats_total, seats_reserved FROM departure WHERE id = $1', [dep]);
  ok('no oversell: seats_reserved <= seats_total', Number(rows[0].seats_reserved) <= CAP, JSON.stringify(rows[0]));
  ok('successes never exceed capacity', successes <= CAP, `successes=${successes}`);
  // bookings that hold seats on this departure == seats_reserved (bookings⇄seats stay consistent)
  const held = await db.query(`SELECT COUNT(*)::int AS n FROM booking WHERE departure_id = $1 AND status IN ('reserved','pending','confirmed')`, [dep]);
  ok('reserved-booking count === seats_reserved', Number(held.rows[0].n) === Number(rows[0].seats_reserved), `bookings=${held.rows[0].n} seats=${rows[0].seats_reserved}`);
  // DB CHECK still rejects a forced oversell on this row
  let rejected = false;
  try { await db.query('UPDATE departure SET seats_reserved = seats_total + 1 WHERE id = $1', [dep]); } catch { rejected = true; }
  ok('DB CHECK rejects forced oversell', rejected);
}

console.log('\n[payment: init → USD→GHS conversion]');
let paidBookingRef = '';
let paidPaymentRef = '';
{
  const dep = await makeDeparture(5);
  const b = await bookOne(dep, 2);           // total USD 150
  paidBookingRef = b.body.ref;
  const init = await post(`/api/v1/bookings/${paidBookingRef}/payment/init`);
  ok('init 200', init.status === 200, JSON.stringify(init.body));
  ok('reference PAY-…', /^PAY-[0-9A-Z]{6}$/.test(init.body.reference), init.body.reference);
  paidPaymentRef = init.body.reference;
  ok('publicKey exposed for inline', init.body.publicKey === 'pk_test_stub');
  ok('authorizationUrl present', typeof init.body.authorizationUrl === 'string' && init.body.authorizationUrl.length > 0);
  // 150 USD × 15.6 = 2340 GHS = 234000 pesewas
  ok('fxRate 15.6 (settings default)', init.body.amount.fxRate === 15.6, JSON.stringify(init.body.amount));
  ok('ghs 2340 / pesewas 234000', init.body.amount.ghs === 2340 && init.body.amount.ghsPesewas === 234000, JSON.stringify(init.body.amount));
  ok('paystack.initialize called in GHS pesewas (integer)', initCalls.some((c) => c.reference === paidPaymentRef && c.amountMinor === 234000 && c.currency === 'GHS'));
  // payment row persisted with FX reconciliation
  const { rows } = await db.query('SELECT amount_minor, currency, usd_amount_minor, fx_rate_used, ghs_amount_minor, status, fx_source, fx_rate_at FROM payment WHERE ref = $1', [paidPaymentRef]);
  ok('payment row GHS + FX cols', rows[0].currency === 'GHS' && Number(rows[0].usd_amount_minor) === 15000 && Number(rows[0].ghs_amount_minor) === 234000 && Number(rows[0].fx_rate_used) === 15.6, JSON.stringify(rows[0]));
  // TRI-873 per-txn provenance: no FX refresh has run yet, so the rate came straight from settings.
  ok('payment row FX provenance persisted (source=settings, timestamp set)',
    rows[0].fx_source === 'settings' && rows[0].fx_rate_at != null, JSON.stringify({ s: rows[0].fx_source, at: rows[0].fx_rate_at }));
  // booking moved to pending, seat hold kept
  const g = await get(`/api/v1/bookings/${paidBookingRef}`);
  ok('booking pending after init, hold kept', g.body.status === 'pending' && g.body.paymentState === 'pending', JSON.stringify({ s: g.body.status, p: g.body.paymentState }));
  ok('GET booking now exposes payment', g.body.payment?.reference === paidPaymentRef && g.body.payment.currency === 'GHS');
}

console.log('\n[payment: webhook signature + idempotency + confirm]');
{
  const event = { event: 'charge.success', data: { id: 302012, reference: paidPaymentRef, status: 'success', amount: 234000, currency: 'GHS' } };
  const rawBody = JSON.stringify(event);
  const goodSig = createHmac('sha512', WEBHOOK_SECRET).update(rawBody).digest('hex');
  const jsonHdr = { 'content-type': 'application/json' };

  // Bad signature rejected
  const bad = await post('/api/v1/payments/webhook', rawBody, { ...jsonHdr, 'x-paystack-signature': 'deadbeef' });
  ok('bad signature → 401', bad.status === 401, JSON.stringify(bad.body));
  const stillPending = await get(`/api/v1/bookings/${paidBookingRef}`);
  ok('booking not confirmed by bad sig', stillPending.body.status === 'pending');

  // Missing signature rejected
  ok('missing signature → 401', (await post('/api/v1/payments/webhook', rawBody, jsonHdr)).status === 401);

  // Valid signature confirms
  const good = await post('/api/v1/payments/webhook', rawBody, { ...jsonHdr, 'x-paystack-signature': goodSig });
  ok('valid signature → 200 received', good.status === 200 && good.body.received === true, JSON.stringify(good.body));
  const conf = await get(`/api/v1/bookings/${paidBookingRef}`);
  ok('booking confirmed / paid after webhook', conf.body.status === 'confirmed' && conf.body.paymentState === 'paid', JSON.stringify({ s: conf.body.status, p: conf.body.paymentState }));
  ok('payment row paid + provider_ref persisted', (await db.query(`SELECT status, provider_ref FROM payment WHERE ref = $1`, [paidPaymentRef])).rows[0].status === 'paid');
  // TRI-889: the wired markPaid path fired a booking-confirmed notification. The server's default email
  // transport is unconfigured in smoke (no RESEND_API_KEY) → the send-log row lands 'skipped', proving the
  // flow is wired end-to-end without sending real mail.
  const confMail = (await db.query(`SELECT status, related_type FROM email_message WHERE template='booking_confirmed' AND related_id=$1`, [paidBookingRef])).rows[0];
  ok('webhook confirm fired booking_confirmed notification (skipped, transport off)', confMail && confMail.status === 'skipped' && confMail.related_type === 'booking', JSON.stringify(confMail));
  const seatsAfter = await db.query('SELECT seats_reserved FROM departure d JOIN booking b ON b.departure_id = d.id WHERE b.ref = $1', [paidBookingRef]);
  ok('seat hold retained on confirm (reserved+confirmed hold)', Number(seatsAfter.rows[0].seats_reserved) === 2, JSON.stringify(seatsAfter.rows[0]));

  // Idempotent replay: same event_id → no-op, single paystack_event row
  const replay = await post('/api/v1/payments/webhook', rawBody, { ...jsonHdr, 'x-paystack-signature': goodSig });
  ok('duplicate webhook → 200 no-op', replay.status === 200 && replay.body.received === true);
  const evCount = await db.query(`SELECT COUNT(*)::int AS n FROM paystack_event WHERE event_id = '302012'`);
  ok('paystack_event stored once (idempotent)', Number(evCount.rows[0].n) === 1, JSON.stringify(evCount.rows[0]));
}

console.log('\n[payment: server-side verify + already-paid init guard]');
{
  // verify on the already-confirmed booking is idempotent (verified:true, no double-charge)
  const v = await post(`/api/v1/bookings/${paidBookingRef}/payment/verify`);
  ok('verify already-paid → verified true', v.status === 200 && v.body.verified === true && v.body.paymentState === 'paid', JSON.stringify(v.body));
  // init on a paid booking is rejected
  const reinit = await post(`/api/v1/bookings/${paidBookingRef}/payment/init`);
  ok('init on paid booking → 409 not_payable', reinit.status === 409 && reinit.body.error.code === 'not_payable', JSON.stringify(reinit.body));

  // fresh booking → verify drives confirmation (webhook-independent path)
  const dep = await makeDeparture(5);
  const b = await bookOne(dep, 1);
  const init = await post(`/api/v1/bookings/${b.body.ref}/payment/init`);
  verifyStatus.set(init.body.reference, 'success');
  const v2 = await post(`/api/v1/bookings/${b.body.ref}/payment/verify`);
  ok('verify success confirms booking', v2.status === 200 && v2.body.status === 'confirmed' && v2.body.verified === true, JSON.stringify(v2.body));
}

console.log('\n[expiry sweep releases unpaid holds]');
{
  const dep = await makeDeparture(5);
  const b = await bookOne(dep, 3);
  // Force the hold into the past
  await db.query(`UPDATE booking SET reservation_expires_at = now() - interval '1 hour' WHERE ref = $1`, [b.body.ref]);
  const before = await db.query('SELECT seats_reserved FROM departure WHERE id = $1', [dep]);
  ok('held 3 before sweep', Number(before.rows[0].seats_reserved) === 3);
  const sweep = await post('/api/v1/internal/expire-holds');
  ok('sweep released the booking', sweep.status === 200 && sweep.body.refs.includes(b.body.ref), JSON.stringify(sweep.body));
  const after = await db.query('SELECT seats_reserved FROM departure WHERE id = $1', [dep]);
  ok('seats released to 0 after sweep', Number(after.rows[0].seats_reserved) === 0, JSON.stringify(after.rows[0]));
  const g = await get(`/api/v1/bookings/${b.body.ref}`);
  ok('expired booking cancelled', g.body.status === 'cancelled', JSON.stringify({ s: g.body.status }));
}

// ─────────────────────────────────────────────────────────────────────────────
// TRI-869 Phase 3 · admin realm: auth, RBAC, CRUD → consumer read, booking cancel releases seats.
// ─────────────────────────────────────────────────────────────────────────────
const COOKIE = cfg.adminCookieName;
const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { payload?: any; cookie?: string } = {}) => {
  const res = await app.inject({ method, url, payload: opts.payload, cookies: opts.cookie ? { [COOKIE]: opts.cookie } : undefined });
  let body: any; try { body = res.json(); } catch { body = res.body; }
  return { status: res.statusCode, body, raw: res.body as string, headers: res.headers as Record<string, string>, cookies: res.cookies as Array<{ name: string; value: string }> };
};

// Seed staff: an admin (full access) and a viewer (read-only → used for the 403 path).
await upsertStaff(db, { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!', name: 'Ada Admin', role: 'admin' });
await upsertStaff(db, { email: 'viewer@tripkoach.com', password: 'Just-Look!', name: 'Vic Viewer', role: 'viewer' });

console.log('\n[admin auth]');
let adminCookie = '';
{
  ok('unauthenticated write → 401', (await call('POST', '/api/admin/tours', { payload: {} })).status === 401);
  ok('bad password → 401', (await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'wrong' } })).status === 401);
  const login = await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  ok('login 200', login.status === 200, JSON.stringify(login.body));
  ok('login returns role admin', login.body.staff?.role === 'admin', JSON.stringify(login.body.staff));
  ok('admin has all 12 permissions', Array.isArray(login.body.permissions) && login.body.permissions.length === 12, JSON.stringify(login.body.permissions));
  ok('admin permissions include reviews.moderate', login.body.permissions.includes('reviews.moderate'));
  ok('admin permissions include content.manage', login.body.permissions.includes('content.manage'));
  adminCookie = login.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('login set session cookie', !!adminCookie);
  const me = await call('GET', '/api/admin/me', { cookie: adminCookie });
  ok('GET /me 200 with session', me.status === 200 && me.body.staff?.email === 'admin@tripkoach.com', JSON.stringify(me.body));
  ok('/me lists permissions incl tours.edit', me.body.permissions?.includes('tours.edit'));
}

console.log('\n[admin RBAC]');
{
  const login = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const viewerCookie = login.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer login 200', login.status === 200);
  ok('viewer permissions are read-only', !login.body.permissions.includes('tours.edit') && login.body.permissions.includes('tours.view'), JSON.stringify(login.body.permissions));
  ok('viewer CAN read tours (tours.view)', (await call('GET', '/api/admin/tours', { cookie: viewerCookie })).status === 200);
  ok('viewer create tour → 403 (missing tours.edit)', (await call('POST', '/api/admin/tours', { cookie: viewerCookie, payload: { title: 'x', region: 'Central', category: 'Adventure', duration: '1 day', price: 10 } })).status === 403);
}

console.log('\n[admin CRUD → consumer read]');
let createdSlug = '';
{
  const created = await call('POST', '/api/admin/tours', { cookie: adminCookie, payload: {
    title: 'Smoke Test Safari', region: 'Central', category: 'Adventure', duration: '2 days',
    blurb: 'A tour created by the admin smoke test.', highlights: ['One', 'Two'],
    tiers: [{ minPax: 1, price: 300 }, { minPax: 4, price: 250 }], published: true,
  } });
  ok('admin create tour → 201', created.status === 201, JSON.stringify(created.body));
  ok('created "from" price is cheapest tier (250)', created.body.price === 250, `got ${created.body.price}`);
  createdSlug = created.body.id;
  ok('created tour has a slug', !!createdSlug, createdSlug);

  // The freshly-created, published tour must appear via the untouched consumer read API.
  const pub = await call('GET', `/api/v1/tours/${createdSlug}`);
  ok('created tour visible on consumer /api/v1 read', pub.status === 200 && pub.body.title === 'Smoke Test Safari', JSON.stringify(pub.body?.title));
  ok('consumer read shows USD whole-currency price 250', pub.body.price === 250 && pub.body.currency === 'USD');

  // unpublish → drops out of the consumer read
  ok('unpublish → 200', (await call('POST', `/api/admin/tours/${createdSlug}/unpublish`, { cookie: adminCookie })).status === 200);
  ok('unpublished tour → 404 on consumer read', (await call('GET', `/api/v1/tours/${createdSlug}`)).status === 404);

  // validation: missing required field → 400
  ok('create tour missing title → 400 validation', (await call('POST', '/api/admin/tours', { cookie: adminCookie, payload: { region: 'Central', category: 'Adventure', duration: '1 day', price: 5 } })).status === 400);
}

console.log('\n[admin booking cancel releases seats]');
{
  // Build a seat-holding booking directly (Phase 1 seed has no bookings), then cancel via the admin API.
  const dep = (await db.query(`SELECT d.id, d.seats_total, d.seats_reserved, d.tour_id FROM departure d WHERE d.seats_total - d.seats_reserved >= 2 LIMIT 1`)).rows[0];
  const cust = (await db.query(`INSERT INTO customer (name, email) VALUES ('Cancel Tester','cancel@example.com') RETURNING id`)).rows[0];
  await db.query(`UPDATE departure SET seats_reserved = seats_reserved + 2 WHERE id = $1`, [dep.id]);
  const before = Number((await db.query(`SELECT seats_reserved FROM departure WHERE id=$1`, [dep.id])).rows[0].seats_reserved);
  await db.query(
    `INSERT INTO booking (ref, customer_id, tour_id, departure_id, party_size, unit_price_minor, total_minor, currency, status, payment_state)
     VALUES ('TK-SMOKE1', $1, $2, $3, 2, 10000, 20000, 'USD', 'confirmed', 'paid')`,
    [cust.id, dep.tour_id, dep.id]);

  const list = await call('GET', '/api/admin/bookings', { cookie: adminCookie });
  ok('admin bookings list includes TK-SMOKE1', list.status === 200 && list.body.items.some((b: any) => b.ref === 'TK-SMOKE1'), JSON.stringify(list.body.total));
  const detail = await call('GET', '/api/admin/bookings/TK-SMOKE1', { cookie: adminCookie });
  ok('admin booking detail 200 with travellers/payments arrays', detail.status === 200 && Array.isArray(detail.body.travellers) && Array.isArray(detail.body.payments));

  const cancel = await call('POST', '/api/admin/bookings/TK-SMOKE1/cancel', { cookie: adminCookie, payload: { reason: 'Customer request' } });
  ok('cancel booking → 200', cancel.status === 200, JSON.stringify(cancel.body));
  ok('cancel reports 2 seats released', cancel.body.seatsReleased === 2, `got ${cancel.body.seatsReleased}`);
  const after = Number((await db.query(`SELECT seats_reserved FROM departure WHERE id=$1`, [dep.id])).rows[0].seats_reserved);
  ok('departure seats_reserved dropped by 2', after === before - 2, `before ${before} after ${after}`);
  ok('booking now cancelled with cancel_reason', cancel.body.status === 'cancelled' && cancel.body.cancelReason === 'customer_request', JSON.stringify({ s: cancel.body.status, r: cancel.body.cancelReason }));

  // audit_log recorded the mutation
  const audits = Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action='booking.cancel'`)).rows[0].n);
  ok('audit_log row written for booking.cancel', audits >= 1, `got ${audits}`);
}

console.log('\n[admin payments view + REAL refund execution (TRI-897)]');
{
  // Attach a paid payment to the cancelled smoke booking so the payment views have a row to return.
  const bk = (await db.query(`SELECT id FROM booking WHERE ref='TK-SMOKE1'`)).rows[0];
  await db.query(
    `INSERT INTO payment (ref, booking_id, amount_minor, currency, method, status, provider_ref)
     VALUES ('PAY-SMOKE1', $1, 20000, 'USD', 'paystack_card', 'paid', 'ps_ref_smoke')`, [bk.id]);

  const list = await call('GET', '/api/admin/payments', { cookie: adminCookie });
  ok('admin payments list 200 incl PAY-SMOKE1', list.status === 200 && list.body.items.some((p: any) => p.ref === 'PAY-SMOKE1'), JSON.stringify(list.body.total));
  const one = list.body.items.find((p: any) => p.ref === 'PAY-SMOKE1');
  ok('payment DTO exposes usd/fx/ghs fields (null pre-008)', one && 'usdAmount' in one && 'fxRate' in one && 'ghsAmount' in one, JSON.stringify(one));

  // wrong-permission first (before the refund lands): viewer lacks payments.refund → 403
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer refund → 403 (missing payments.refund)', (await call('POST', '/api/admin/payments/PAY-SMOKE1/refund', { cookie: vcookie, payload: {} })).status === 403);

  // REAL refund: hits Paystack (stub), flips original to refunded, records a linked negative row, audits.
  const refund = await call('POST', '/api/admin/payments/PAY-SMOKE1/refund', { cookie: adminCookie, payload: { reason: 'duplicate charge' } });
  ok('admin refund → 200 refunded=true', refund.status === 200 && refund.body.refunded === true, JSON.stringify(refund.body));
  ok('refund returned Paystack refund id + status', refund.body.refundId === 'rfnd_ps_ref_smoke' && refund.body.paystackStatus === 'processed', JSON.stringify(refund.body));
  ok('paystack.refund called against provider_ref', refundCalls.some((c) => c.transaction === 'ps_ref_smoke'), JSON.stringify(refundCalls));
  ok('original payment flipped to refunded', refund.body.payment.status === 'refunded', JSON.stringify(refund.body.payment));
  const refundRow = (await db.query(`SELECT amount_minor, currency, status, refund_of, refund_provider_id FROM payment WHERE refund_provider_id='rfnd_ps_ref_smoke'`)).rows[0];
  ok('linked negative refund row recorded', refundRow && Number(refundRow.amount_minor) === -20000 && refundRow.status === 'refunded' && refundRow.refund_of != null, JSON.stringify(refundRow));
  ok('booking payment_state → refunded', (await db.query(`SELECT payment_state FROM booking WHERE ref='TK-SMOKE1'`)).rows[0].payment_state === 'refunded');
  ok('audit_log payment.refunded written', Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action='payment.refunded'`)).rows[0].n) >= 1);

  // Idempotent repeat: original is already refunded → 409, no second refund row.
  const again = await call('POST', '/api/admin/payments/PAY-SMOKE1/refund', { cookie: adminCookie, payload: {} });
  ok('repeat refund → 409 already refunded', again.status === 409, JSON.stringify(again.body));
  ok('exactly one refund row for the txn', Number((await db.query(`SELECT COUNT(*)::int AS n FROM payment WHERE refund_provider_id='rfnd_ps_ref_smoke'`)).rows[0].n) === 1);
}

console.log('\n[admin manual mark-paid (offline settlement)]');
{
  const bk = (await db.query(`SELECT id FROM booking WHERE ref='TK-SMOKE1'`)).rows[0];
  await db.query(
    `INSERT INTO payment (ref, booking_id, amount_minor, currency, method, status)
     VALUES ('PAY-MANUAL1', $1, 30000, 'USD', 'bank', 'pending')`, [bk.id]);
  const mp = await call('POST', '/api/admin/payments/PAY-MANUAL1/mark-paid', { cookie: adminCookie, payload: { note: 'bank transfer #778' } });
  ok('mark-paid → 200 markedPaid', mp.status === 200 && mp.body.markedPaid === true, JSON.stringify(mp.body));
  ok('payment flipped to paid', mp.body.payment.status === 'paid', JSON.stringify(mp.body.payment));
  ok('booking confirmed + paid', (await db.query(`SELECT status, payment_state FROM booking WHERE ref='TK-SMOKE1'`)).rows[0].payment_state === 'paid');
  ok('audit_log payment.mark_paid written', Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action='payment.mark_paid'`)).rows[0].n) >= 1);
  ok('mark-paid on already-paid → 409', (await call('POST', '/api/admin/payments/PAY-MANUAL1/mark-paid', { cookie: adminCookie, payload: {} })).status === 409);
}

console.log('\n[admin reconciliation export (payments + refunds)]');
{
  const rep = await call('GET', '/api/admin/reports/reconciliation', { cookie: adminCookie });
  ok('reconciliation JSON 200 with items + summary', rep.status === 200 && Array.isArray(rep.body.items) && Array.isArray(rep.body.summary), JSON.stringify({ n: rep.body?.count }));
  ok('report includes the refund row typed refund', rep.body.items.some((r: any) => r.type === 'refund' && Number(r.amount) === -200), JSON.stringify(rep.body.items.find((r: any) => r.type === 'refund')));
  ok('report includes charge rows typed charge', rep.body.items.some((r: any) => r.type === 'charge'));
  const usd = rep.body.summary.find((s: any) => s.currency === 'USD');
  ok('USD summary net = gross − refunded', usd && Math.abs(usd.net - (usd.grossPaid + usd.refunded)) < 1e-9, JSON.stringify(usd));

  const csv = await call('GET', '/api/admin/reports/reconciliation.csv', { cookie: adminCookie });
  ok('reconciliation.csv 200', csv.status === 200);
  ok('csv is text/csv attachment', String(csv.headers?.['content-type'] || '').includes('text/csv') && String(csv.headers?.['content-disposition'] || '').includes('attachment'), JSON.stringify(csv.headers?.['content-type']));
  ok('csv has header + summary sections', typeof csv.raw === 'string' && csv.raw.includes('ref,bookingRef') && csv.raw.includes('summary_currency'), (csv.raw || '').slice(0, 60));

  // finance report is guarded too: viewer (no payments.refund) → 403
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer reconciliation → 403', (await call('GET', '/api/admin/reports/reconciliation', { cookie: vcookie })).status === 403);
}

console.log('\n[webhook refund reconciliation (idempotent, dashboard-initiated)]');
{
  // A paid Paystack payment that a refund webhook then settles (no prior admin call → dashboard refund).
  const dep = await makeDeparture(3);
  const b = await bookOne(dep, 1);
  const init = await post(`/api/v1/bookings/${b.body.ref}/payment/init`);
  const payRef = init.body.reference;
  const chargeEvt = { event: 'charge.success', data: { id: 990001, reference: payRef, status: 'success', amount: init.body.amount.ghsPesewas, currency: 'GHS' } };
  const chargeRaw = JSON.stringify(chargeEvt);
  await post('/api/v1/payments/webhook', chargeRaw, { 'content-type': 'application/json', 'x-paystack-signature': createHmac('sha512', WEBHOOK_SECRET).update(chargeRaw).digest('hex') });
  ok('setup: booking paid before refund', (await get(`/api/v1/bookings/${b.body.ref}`)).body.paymentState === 'paid');

  const refundEvt = { event: 'refund.processed', data: { id: 990002, status: 'processed', transaction_reference: payRef, amount: init.body.amount.ghsPesewas, currency: 'GHS' } };
  const refundRaw = JSON.stringify(refundEvt);
  const sig = createHmac('sha512', WEBHOOK_SECRET).update(refundRaw).digest('hex');
  const r1 = await post('/api/v1/payments/webhook', refundRaw, { 'content-type': 'application/json', 'x-paystack-signature': sig });
  ok('refund webhook → 200 received', r1.status === 200 && r1.body.received === true, JSON.stringify(r1.body));
  ok('original payment refunded via webhook', (await db.query(`SELECT status FROM payment WHERE ref=$1`, [payRef])).rows[0].status === 'refunded');
  ok('booking payment_state refunded via webhook', (await get(`/api/v1/bookings/${b.body.ref}`)).body.paymentState === 'refunded');
  ok('linked refund row from webhook (keyed on refund id 990002)', Number((await db.query(`SELECT COUNT(*)::int AS n FROM payment WHERE refund_provider_id='990002'`)).rows[0].n) === 1);

  // Idempotent replay: same event id → no-op, still exactly one refund row.
  const r2 = await post('/api/v1/payments/webhook', refundRaw, { 'content-type': 'application/json', 'x-paystack-signature': sig });
  ok('duplicate refund webhook → 200 no-op', r2.status === 200 && r2.body.received === true);
  ok('still exactly one refund row after replay', Number((await db.query(`SELECT COUNT(*)::int AS n FROM payment WHERE refund_provider_id='990002'`)).rows[0].n) === 1);
}

// TRI-892 P2 · Reviews write: admin invite issuance (A5) → consumer tokenized redeem→submit (C15).
console.log('\n[reviews: invite issuance → redeem → submit (TRI-892)]');
{
  // Build a paid, confirmed booking on a fresh departure with a lead traveller who carries an email.
  const dep = (await db.query(`SELECT id, tour_id FROM departure WHERE seats_total - seats_reserved >= 2 LIMIT 1`)).rows[0];
  const cust = (await db.query(`INSERT INTO customer (name, email) VALUES ('Reviewer One','rev1@example.com') RETURNING id`)).rows[0];
  const bk = (await db.query(
    `INSERT INTO booking (ref, customer_id, tour_id, departure_id, party_size, unit_price_minor, total_minor, currency, status, payment_state)
     VALUES ('TK-REVIEW1', $1, $2, $3, 1, 10000, 10000, 'USD', 'confirmed', 'paid') RETURNING id`,
    [cust.id, dep.tour_id, dep.id]).then((r) => r.rows[0]));
  await db.query(
    `INSERT INTO booking_traveller (booking_id, is_lead, name, email) VALUES ($1, true, 'Kofi Reviewer', 'kofi.review@example.com')`,
    [bk.id]);
  // A cancelled booking on the same departure must NOT be invited.
  await db.query(
    `INSERT INTO booking (ref, customer_id, tour_id, departure_id, party_size, unit_price_minor, total_minor, currency, status, payment_state)
     VALUES ('TK-REVIEWX', $1, $2, $3, 1, 10000, 10000, 'USD', 'cancelled', 'unpaid')`,
    [cust.id, dep.tour_id, dep.id]);

  // Admin issues invites (email transport disabled in smoke → 'skipped', invite still created).
  const issue = await call('POST', `/api/admin/departures/${dep.id}/request-reviews`, { cookie: adminCookie });
  ok('request-reviews → 200', issue.status === 200, JSON.stringify(issue.body));
  ok('exactly 1 invite issued (cancelled booking excluded)', issue.body.issued?.length === 1, JSON.stringify(issue.body));
  ok('invite email logged skipped (transport off)', issue.body.issued?.[0]?.emailStatus === 'skipped', JSON.stringify(issue.body.issued));
  ok('departure ended → completed', issue.body.departureStatus === 'completed', JSON.stringify(issue.body.departureStatus));
  ok('unauthenticated request-reviews → 401', (await call('POST', `/api/admin/departures/${dep.id}/request-reviews`)).status === 401);

  // Idempotent: re-running issues nothing new, reports the booking as already invited.
  const again = await call('POST', `/api/admin/departures/${dep.id}/request-reviews`, { cookie: adminCookie });
  ok('re-request issues 0, marks already_invited', again.body.issued?.length === 0 && again.body.skipped?.some((s: any) => s.reason === 'already_invited'), JSON.stringify(again.body));
  const inviteCount = Number((await db.query(`SELECT COUNT(*)::int n FROM review_invite WHERE booking_id=$1`, [bk.id])).rows[0].n);
  ok('only one invite row exists for the booking', inviteCount === 1, `got ${inviteCount}`);

  const token = (await db.query(`SELECT token FROM review_invite WHERE booking_id=$1`, [bk.id])).rows[0].token;

  // Redeem context: valid unredeemed token → tour + traveller prefill.
  const ctx = await get(`/api/v1/reviews/redeem/${token}`);
  ok('GET redeem context → 200 with tour + prefill', ctx.status === 200 && !!ctx.body.tour?.slug && ctx.body.prefill?.name === 'Kofi Reviewer', JSON.stringify(ctx.body));
  ok('GET redeem unknown token → 404', (await get('/api/v1/reviews/redeem/nope-not-a-token')).status === 404);

  // Submit: bad ratings rejected 422; a valid submit creates a verified pending review + burns the token.
  ok('submit rating=6 → 422', (await post(`/api/v1/reviews/redeem/${token}`, { rating: 6, text: 'x' })).status === 422);
  ok('submit rating=0 → 422', (await post(`/api/v1/reviews/redeem/${token}`, { rating: 0, text: 'x' })).status === 422);
  ok('submit missing rating → 422', (await post(`/api/v1/reviews/redeem/${token}`, { text: 'no rating' })).status === 422);

  const submit = await post(`/api/v1/reviews/redeem/${token}`, { rating: 5, title: 'A trip to remember (TRI-892)', text: 'Best day in Ghana.' });
  ok('submit → 200 pending verified review', submit.status === 200 && submit.body.status === 'pending' && submit.body.verified === true, JSON.stringify(submit.body));
  const rev = (await db.query(`SELECT r.rating, r.status, r.verified, r.author_name, r.booking_id, r.title FROM review r WHERE r.booking_id=$1`, [bk.id])).rows[0];
  ok('review row: pending, verified, rating 5, author + booking linked', rev && rev.status === 'pending' && rev.verified === true && Number(rev.rating) === 5 && rev.author_name === 'Kofi Reviewer' && rev.booking_id === bk.id, JSON.stringify(rev));

  // Double-redeem is impossible: token burned → 410 on both submit and context.
  ok('second submit on burned token → 410', (await post(`/api/v1/reviews/redeem/${token}`, { rating: 4, text: 'again' })).status === 410);
  ok('GET redeem on burned token → 410', (await get(`/api/v1/reviews/redeem/${token}`)).status === 410);

  // Pending review is invisible to the public read endpoint until moderation approves it.
  const tourSlug = ctx.body.tour.slug;
  const pub = await get(`/api/v1/tours/${tourSlug}/reviews`);
  ok('pending review NOT in public approved-only read', pub.status === 200 && !pub.body.reviews.some((r: any) => r.title === 'A trip to remember (TRI-892)'), JSON.stringify(pub.body.reviews?.length));

  // audit trail recorded the issuance.
  const revAudits = Number((await db.query(`SELECT COUNT(*)::int n FROM audit_log WHERE action='departure.request_reviews'`)).rows[0].n);
  ok('audit_log row written for departure.request_reviews', revAudits >= 1, `got ${revAudits}`);
}

console.log('\n[admin reviews moderation → public visibility]');
{
  // Baseline: public accra reviews (approved only) — captured before we moderate.
  const pubBefore = (await call('GET', '/api/v1/tours/accra-city-tour/reviews')).body.reviews.length;

  const list = await call('GET', '/api/admin/reviews', { cookie: adminCookie });
  ok('GET /admin/reviews 200', list.status === 200, JSON.stringify(list.body).slice(0, 200));
  // 8 seeded + 1 pending review the TRI-892 write-test submits earlier in this consolidated suite (TRI-901).
  ok('reviews list returns all statuses (8 seeded + 1 from TRI-892)', list.body.reviews.length === 9, `got ${list.body.reviews.length}`);
  ok('counts stat present {pending:4,approved:4,rejected:1}',
    list.body.counts?.pending === 4 && list.body.counts?.approved === 4 && list.body.counts?.rejected === 1, JSON.stringify(list.body.counts));
  const rev = list.body.reviews[0];
  ok('review DTO shape {id,author,tour,tourSlug,initials,rating,date,verified,status,title,text,reply}',
    ['id','author','tour','tourSlug','initials','rating','date','verified','status','title','text','reply'].every((k) => k in rev), JSON.stringify(rev));

  // status filter narrows the list without altering the counts.
  const pendingOnly = await call('GET', '/api/admin/reviews?status=pending', { cookie: adminCookie });
  ok('?status=pending → only pending rows', pendingOnly.body.reviews.length === 4 && pendingOnly.body.reviews.every((r: any) => r.status === 'pending'), `got ${pendingOnly.body.reviews.length}`);

  // A pending accra review (Kojo Danso) to approve → must appear on the public tour page.
  const pending = list.body.reviews.find((r: any) => r.author === 'Kojo Danso' && r.status === 'pending');
  ok('found a pending accra review to moderate', !!pending, JSON.stringify(pending));

  // wrong-permission: viewer lacks reviews.moderate → 403
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer moderate → 403 (missing reviews.moderate)', (await call('POST', `/api/admin/reviews/${pending.id}/approve`, { cookie: vcookie })).status === 403);

  const approved = await call('POST', `/api/admin/reviews/${pending.id}/approve`, { cookie: adminCookie });
  ok('approve → 200 status=approved', approved.status === 200 && approved.body.review.status === 'approved', JSON.stringify(approved.body));
  const pubAfter = await call('GET', '/api/v1/tours/accra-city-tour/reviews');
  ok('approved review now visible on public tour page (+1)', pubAfter.body.reviews.length === pubBefore + 1, `before ${pubBefore} after ${pubAfter.body.reviews.length}`);
  ok('public reviewStats recomputed to include it', pubAfter.body.stats.count === pubBefore + 1, JSON.stringify(pubAfter.body.stats));

  // unpublish (approved → pending) hides it again.
  const unpub = await call('POST', `/api/admin/reviews/${pending.id}/unpublish`, { cookie: adminCookie });
  ok('unpublish → 200 status=pending', unpub.status === 200 && unpub.body.review.status === 'pending', JSON.stringify(unpub.body.review?.status));
  ok('unpublished review drops off the public tour page', (await call('GET', '/api/v1/tours/accra-city-tour/reviews')).body.reviews.length === pubBefore, `expected ${pubBefore}`);

  // reject a pending spam review → stays hidden, status=rejected.
  const spam = list.body.reviews.find((r: any) => r.author === 'anon' && r.status === 'pending');
  const rejected = await call('POST', `/api/admin/reviews/${spam.id}/reject`, { cookie: adminCookie });
  ok('reject spam → 200 status=rejected', rejected.status === 200 && rejected.body.review.status === 'rejected', JSON.stringify(rejected.body.review?.status));
  ok('rejected review never appears publicly', !(await call('GET', '/api/v1/tours/accra-city-tour/reviews')).body.reviews.some((r: any) => /example-spam/.test(r.text)));

  // reply on an approved review → shown publicly under the review.
  const approvedAccra = list.body.reviews.find((r: any) => r.author === 'Marcus Bell' && r.status === 'approved');
  const replied = await call('POST', `/api/admin/reviews/${approvedAccra.id}/reply`, { cookie: adminCookie, payload: { reply: 'Thanks Marcus — noted on the Du Bois timing!' } });
  ok('reply → 200 sets reply text', replied.status === 200 && /Du Bois timing/.test(replied.body.review.reply), JSON.stringify(replied.body.review?.reply));
  const pubReply = (await call('GET', '/api/v1/tours/accra-city-tour/reviews')).body.reviews.find((r: any) => r.author === 'Marcus Bell');
  ok('reply visible on public tour page', /Du Bois timing/.test(pubReply?.reply || ''), JSON.stringify(pubReply?.reply));

  // moderation is audited.
  const modAudits = Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action LIKE 'review.%'`)).rows[0].n);
  ok('audit_log rows written for review.* actions', modAudits >= 4, `got ${modAudits}`);

  // unknown review id → 404
  ok('moderate unknown review → 404', (await call('POST', '/api/admin/reviews/00000000-0000-0000-0000-000000000000/approve', { cookie: adminCookie })).status === 404);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[blog / CMS (TRI-917)]');
{
  // Consumer read starts empty (Phase 1 seed doesn't populate blog_post).
  const empty = await call('GET', '/api/v1/blog');
  ok('consumer GET /blog 200 (empty catalogue ok)', empty.status === 200 && Array.isArray(empty.body.posts), JSON.stringify(empty.body).slice(0, 80));

  // RBAC: viewer lacks content.manage.
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer create post → 403 (missing content.manage)', (await call('POST', '/api/admin/blog', { cookie: vcookie, payload: { title: 'x' } })).status === 403);
  ok('unauthenticated /admin/blog → 401', (await call('GET', '/api/admin/blog', { payload: {} })).status === 401);

  // Create a draft with the plain-text body editor form.
  const created = await call('POST', '/api/admin/blog', { cookie: adminCookie, payload: {
    title: 'Smoke Story: A Night in Osu', tag: 'Practical', excerpt: 'A quick after-dark guide.',
    hero: 'https://cdn.tripkoach.com/img/posts/osu-hero.jpg', readTime: 4, author: 'TripKoach',
    bodyText: '## Where to start\n\nOsu comes alive after dark.\n\n- Eat first.\n- Then wander.\n\n> Photo: TripKoach.',
  } });
  ok('admin create draft → 201', created.status === 201 && created.body.status === 'draft', JSON.stringify(created.body).slice(0, 120));
  const slug = created.body.slug;
  ok('slug auto-derived from title', slug === 'smoke-story-a-night-in-osu', slug);
  ok('bodyText parsed into blocks (h2/p/ul/credit)', created.body.body.length === 4 && created.body.body[0].t === 'h2' && created.body.body[3].t === 'credit', JSON.stringify(created.body.body.map((b: any) => b.t)));

  // A draft is invisible to the consumer read.
  ok('draft NOT visible on consumer /blog', !(await call('GET', '/api/v1/blog')).body.posts.some((p: any) => p.slug === slug));
  ok('consumer GET draft detail → 404', (await call('GET', `/api/v1/blog/${slug}`)).status === 404);

  // Publish → now on the consumer read with a real body.
  const pub = await call('POST', `/api/admin/blog/${slug}/publish`, { cookie: adminCookie });
  ok('publish → 200 status=published + published_at stamped', pub.status === 200 && pub.body.status === 'published' && !!pub.body.date, JSON.stringify(pub.body).slice(0, 100));
  const consumerList = await call('GET', '/api/v1/blog');
  ok('published post visible on consumer /blog', consumerList.body.posts.some((p: any) => p.slug === slug));
  ok('consumer list exposes the Practical tag', consumerList.body.tags.includes('Practical'), JSON.stringify(consumerList.body.tags));
  const detail = await call('GET', `/api/v1/blog/${slug}`);
  ok('consumer detail 200 with body blocks + readTime', detail.status === 200 && detail.body.body.length === 4 && detail.body.readTime === 4, JSON.stringify({ n: detail.body.body?.length, rt: detail.body.readTime }));

  // Edit: retitle + rewrite body; round-trips through bodyText.
  const edited = await call('PATCH', `/api/admin/blog/${slug}`, { cookie: adminCookie, payload: { title: 'Osu After Dark', bodyText: 'A single new paragraph about the night.' } });
  ok('edit → 200 new title + single-block body', edited.status === 200 && edited.body.title === 'Osu After Dark' && edited.body.body.length === 1, JSON.stringify(edited.body).slice(0, 100));
  ok('admin getBlog exposes bodyText projection', /single new paragraph/.test(edited.body.bodyText || ''), edited.body.bodyText);

  // Slug conflict is rejected.
  const dup = await call('POST', '/api/admin/blog', { cookie: adminCookie, payload: { title: 'dup', slug } });
  ok('duplicate slug → 409', dup.status === 409, JSON.stringify(dup.body));

  // Unpublish hides it again.
  const unpub = await call('POST', `/api/admin/blog/${slug}/unpublish`, { cookie: adminCookie });
  ok('unpublish → 200 status=draft', unpub.status === 200 && unpub.body.status === 'draft');
  ok('unpublished post drops off consumer /blog', !(await call('GET', '/api/v1/blog')).body.posts.some((p: any) => p.slug === slug));

  // Blog actions are audited.
  const blogAudits = Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action LIKE 'blog.%'`)).rows[0].n);
  ok('audit_log rows written for blog.* actions', blogAudits >= 4, `got ${blogAudits}`);

  // Delete → gone.
  ok('delete → 200', (await call('DELETE', `/api/admin/blog/${slug}`, { cookie: adminCookie })).status === 200);
  ok('deleted post → admin getBlog 404', (await call('GET', `/api/admin/blog/${slug}`, { cookie: adminCookie })).status === 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRI-918 · Admin image upload → validation → R2 (cdn.tripkoach.com) publish pipeline.
// Raw-bytes upload under /api/admin/media, guarded by content.manage. Storage is stubbed above.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[admin media upload (TRI-918)]');
{
  // Smallest valid images (real magic bytes) so the sniffer accepts them.
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const putImg = async (bytes: Buffer, contentType: string, opts: { cookie?: string; query?: string } = {}) =>
    app.inject({ method: 'POST', url: `/api/admin/media${opts.query ?? ''}`, payload: bytes,
      headers: { 'content-type': contentType, ...(opts.cookie ? { cookie: `${COOKIE}=${opts.cookie}` } : {}) } });

  // AuthZ: unauthenticated + viewer are rejected.
  ok('media upload without session → 401', (await putImg(PNG_1x1, 'image/png')).statusCode === 401);
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer upload → 403 (no content.manage)', (await putImg(PNG_1x1, 'image/png', { cookie: vcookie })).statusCode === 403);

  // Happy path: a valid PNG publishes and returns a canonical cdn.tripkoach.com URL.
  const putsBefore = r2Puts.length;
  const up = await putImg(PNG_1x1, 'image/png', { cookie: adminCookie, query: '?filename=hero.png&alt=A%20hero' });
  ok('upload PNG → 201 created', up.statusCode === 201);
  const asset = up.json().asset;
  ok('asset URL is under cdn.tripkoach.com/media', /^https:\/\/cdn\.tripkoach\.com\/media\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/.test(asset.url), asset.url);
  ok('asset sniffed content-type png', asset.contentType === 'image/png');
  ok('asset parsed 1x1 dimensions', asset.width === 1 && asset.height === 1);
  ok('asset carries filename + alt', asset.filename === 'hero.png' && asset.altText === 'A hero');
  ok('one object PUT to R2', r2Puts.length === putsBefore + 1);
  ok('R2 PUT used immutable cache-control', /immutable/.test(r2Puts[r2Puts.length - 1].cacheControl || ''));
  ok('R2 key matches asset storageKey', r2Puts[r2Puts.length - 1].key === asset.storageKey);

  // Dedupe: identical bytes re-uploaded → 200, same asset, NO second PUT.
  const dupPuts = r2Puts.length;
  const dup = await putImg(PNG_1x1, 'image/png', { cookie: adminCookie });
  ok('re-upload identical bytes → 200 deduped', dup.statusCode === 200 && dup.json().deduped === true);
  ok('dedupe returns same asset id', dup.json().asset.id === asset.id);
  ok('dedupe made no new R2 PUT', r2Puts.length === dupPuts);

  // A second distinct format publishes independently.
  ok('upload GIF → 201', (await putImg(GIF_1x1, 'image/gif', { cookie: adminCookie })).statusCode === 201);

  // Validation: a non-image body is rejected by the magic-byte sniff even with an image Content-Type.
  const bogus = await putImg(Buffer.from('this is definitely not an image'), 'image/png', { cookie: adminCookie });
  ok('non-image bytes → 415 unsupported_type', bogus.statusCode === 415 && bogus.json().error.code === 'unsupported_type');

  // Library list returns the ready assets, newest-first.
  const lib = await call('GET', '/api/admin/media', { cookie: adminCookie });
  ok('media list → 200 with assets', lib.status === 200 && lib.body.total >= 2 && Array.isArray(lib.body.assets));
  ok('list is ready-only', lib.body.assets.every((a: any) => a.status === 'ready'));

  // The upload is audited.
  const audited = (await call('GET', '/api/admin/audit-log', { cookie: adminCookie })).body;
  const rows = Array.isArray(audited) ? audited : (audited.entries ?? audited.items ?? audited.rows ?? []);
  ok('media.upload is audited', rows.some((r: any) => r.action === 'media.upload'));
}

// ─────────────────────────────────────────────────────────────────────────────
// TRI-896 P3 · Guides CRUD (A12) + Promo codes (A13, admin) + consumer promo apply (C7).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[admin guides CRUD (A12)]');
let smokeGuideId = '';
{
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer CAN list guides (tours.view)', (await call('GET', '/api/admin/guides', { cookie: vcookie })).status === 200);
  ok('viewer create guide → 403 (missing tours.edit)', (await call('POST', '/api/admin/guides', { cookie: vcookie, payload: { name: 'X' } })).status === 403);

  const created = await call('POST', '/api/admin/guides', { cookie: adminCookie, payload: {
    name: 'Kojo Guide', email: 'kojo@tripkoach.com', base: 'Accra', regions: ['Greater Accra', 'Eastern'],
    languages: ['English', 'Twi'], status: 'active', rating: 4.8, trips: 42, bio: 'Seasoned lead.',
  } });
  ok('admin create guide → 201', created.status === 201, JSON.stringify(created.body));
  smokeGuideId = created.body.id;
  ok('guide DTO shape (regions/rating/trips)', created.body.regions.length === 2 && created.body.rating === 4.8 && created.body.trips === 42, JSON.stringify(created.body));

  const list = await call('GET', '/api/admin/guides', { cookie: adminCookie });
  ok('admin guides list includes new guide', list.status === 200 && list.body.guides.some((g: any) => g.id === smokeGuideId), JSON.stringify(list.body.guides?.length));

  const patch = await call('PATCH', `/api/admin/guides/${smokeGuideId}`, { cookie: adminCookie, payload: { status: 'leave', regions: ['Volta'] } });
  ok('admin patch guide → 200 (status/regions updated)', patch.status === 200 && patch.body.status === 'leave' && patch.body.regions[0] === 'Volta', JSON.stringify(patch.body));
  ok('create guide missing name → 400', (await call('POST', '/api/admin/guides', { cookie: adminCookie, payload: {} })).status === 400);
  ok('rating out of range → 400', (await call('POST', '/api/admin/guides', { cookie: adminCookie, payload: { name: 'Bad', rating: 9 } })).status === 400);
}

console.log('\n[admin assign guide to departure]');
let guidedDepId = '';
{
  const created = await call('POST', '/api/admin/departures', { cookie: adminCookie, payload: {
    tourId: 'accra-city-tour', date: '2026-12-01', capacity: 10, guideId: smokeGuideId,
  } });
  ok('create departure with guideId → 201', created.status === 201, JSON.stringify(created.body));
  guidedDepId = created.body.id;
  ok('departure DTO carries guideId + guide name', created.body.guideId === smokeGuideId && created.body.guide === 'Kojo Guide', JSON.stringify({ id: created.body.guideId, g: created.body.guide }));
  ok('create departure with unknown guideId → 400', (await call('POST', '/api/admin/departures', { cookie: adminCookie, payload: { tourId: 'accra-city-tour', date: '2026-12-02', capacity: 5, guideId: '00000000-0000-0000-0000-000000000000' } })).status === 400);
  // clear the assignment
  const cleared = await call('PATCH', `/api/admin/departures/${guidedDepId}`, { cookie: adminCookie, payload: { guideId: null } });
  ok('patch departure guideId=null clears assignment', cleared.status === 200 && cleared.body.guideId === null, JSON.stringify(cleared.body.guideId));
  // reassign for the delete-nulls test below
  await call('PATCH', `/api/admin/departures/${guidedDepId}`, { cookie: adminCookie, payload: { guideId: smokeGuideId } });
}

console.log('\n[admin promos CRUD (A13)]');
{
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer list promos → 403 (missing promos.manage)', (await call('GET', '/api/admin/promos', { cookie: vcookie })).status === 403);

  const pct = await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'harmattan10', type: 'percent', value: 10, tours: 'All tours', limit: 100, active: true } });
  ok('admin create percent promo → 201 (code upper-cased)', pct.status === 201 && pct.body.code === 'HARMATTAN10', JSON.stringify(pct.body));
  ok('percent promo DTO: value 10, scope all, used 0', pct.body.value === 10 && pct.body.scope === 'all' && pct.body.used === 0, JSON.stringify(pct.body));

  // fixed amount is spoken in whole currency at the boundary, stored minor internally.
  const fix = await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'FLAT20', type: 'fixed', value: 20, currency: 'USD', active: true } });
  ok('admin create fixed promo → 201 value 20 (round-trips major↔minor)', fix.status === 201 && fix.body.value === 20 && fix.body.type === 'fixed', JSON.stringify(fix.body));
  const fixMinor = Number((await db.query(`SELECT value FROM promo_code WHERE code='FLAT20'`)).rows[0].value);
  ok('fixed promo stored as minor units (2000)', fixMinor === 2000, `got ${fixMinor}`);

  const dup = await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'HARMATTAN10', type: 'percent', value: 5 } });
  ok('duplicate promo code → 409', dup.status === 409, JSON.stringify(dup.body));
  ok('percent value > 100 → 400', (await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'TOOMUCH', type: 'percent', value: 150 } })).status === 400);
  ok('bad code format → 400', (await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'has spaces', type: 'percent', value: 5 } })).status === 400);

  const list = await call('GET', '/api/admin/promos', { cookie: adminCookie });
  ok('admin promos list includes both', list.status === 200 && list.body.promos.some((p: any) => p.code === 'HARMATTAN10') && list.body.promos.some((p: any) => p.code === 'FLAT20'), JSON.stringify(list.body.promos?.length));

  const patch = await call('PATCH', '/api/admin/promos/HARMATTAN10', { cookie: adminCookie, payload: { value: 15, limit: 50 } });
  ok('admin patch promo (value/limit) → 200', patch.status === 200 && patch.body.value === 15 && patch.body.limit === 50, JSON.stringify(patch.body));

  const deact = await call('DELETE', '/api/admin/promos/FLAT20', { cookie: adminCookie });
  ok('admin deactivate promo (DELETE) → active false', deact.status === 200 && deact.body.promo.active === false, JSON.stringify(deact.body));
}

console.log('\n[consumer promo apply (C7)]');
{
  const usedCount = async (code: string) => Number((await db.query(`SELECT used_count FROM promo_code WHERE code=$1`, [code])).rows[0].used_count);
  // A valid all-scope percent code discounts the USD quote and claims exactly one redemption.
  await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'SAVE10', type: 'percent', value: 10, tours: 'All tours', limit: 2, active: true } });
  const dep = await makeDeparture(5);
  const booked = await post('/api/v1/bookings', {
    tourSlug: 'accra-city-tour', departureId: dep, partySize: 2, agreedTerms: true,
    promoCode: 'save10', travellers: [{ ...leadTraveller }],
  });
  ok('POST /bookings with promo → 201', booked.status === 201, JSON.stringify(booked.body));
  ok('quote: subtotal 150, discount 15, total 135', booked.body.quote.subtotal === 150 && booked.body.quote.discount === 15 && booked.body.quote.total === 135, JSON.stringify(booked.body.quote));
  ok('quote.promo echoes code SAVE10', booked.body.quote.promo?.code === 'SAVE10' && booked.body.quote.promo.discount === 15, JSON.stringify(booked.body.quote.promo));
  ok('promo used_count incremented to 1', (await usedCount('SAVE10')) === 1);
  const g = await get(`/api/v1/bookings/${booked.body.ref}`);
  ok('GET booking reflects discount + promo', g.body.quote.discount === 15 && g.body.quote.total === 135 && g.body.quote.promo?.code === 'SAVE10', JSON.stringify(g.body.quote));

  // Fixed-amount code applies a flat discount in the booking currency.
  await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'FLAT25', type: 'fixed', value: 25, currency: 'USD', active: true } });
  const fixBooked = await post('/api/v1/bookings', {
    tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 2, agreedTerms: true,
    promoCode: 'FLAT25', travellers: [{ ...leadTraveller }],
  });
  ok('fixed promo discounts 25 → total 125', fixBooked.body.quote.discount === 25 && fixBooked.body.quote.total === 125, JSON.stringify(fixBooked.body.quote));

  // Rejections — each returns 422 and must NOT reserve a seat or claim a redemption.
  const unknown = await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 1, agreedTerms: true, promoCode: 'NOPE', travellers: [{ ...leadTraveller }] });
  ok('unknown promo → 422', unknown.status === 422 && unknown.body.error?.code === 'promo_invalid', JSON.stringify(unknown.body));

  await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'EXPIRED1', type: 'percent', value: 10, from: '2020-01-01', to: '2020-02-01', active: true } });
  ok('expired promo → 422', (await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 1, agreedTerms: true, promoCode: 'EXPIRED1', travellers: [{ ...leadTraveller }] })).body.error?.code === 'promo_expired');

  await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'INACTIVE1', type: 'percent', value: 10, active: false } });
  ok('inactive promo → 422', (await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 1, agreedTerms: true, promoCode: 'INACTIVE1', travellers: [{ ...leadTraveller }] })).body.error?.code === 'promo_inactive');

  // Scope mismatch: a luxury-category code cannot apply to a city tour.
  await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'LUXONLY', type: 'percent', value: 10, tours: 'Luxury', active: true } });
  ok('category-scope mismatch → 422', (await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 1, agreedTerms: true, promoCode: 'LUXONLY', travellers: [{ ...leadTraveller }] })).body.error?.code === 'promo_scope');

  // Usage limit: a limit-1 code redeems once, then the second attempt is rejected and used_count stays 1.
  await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'ONCE', type: 'percent', value: 10, limit: 1, active: true } });
  const first = await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 1, agreedTerms: true, promoCode: 'ONCE', travellers: [{ ...leadTraveller }] });
  ok('limit-1 promo: first booking ok', first.status === 201);
  const second = await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 1, agreedTerms: true, promoCode: 'ONCE', travellers: [{ ...leadTraveller }] });
  ok('limit-1 promo: second booking → 422 limit reached', second.status === 422 && second.body.error?.code === 'promo_limit_reached', JSON.stringify(second.body));
  ok('over-limit attempt did not double-claim (used_count = 1)', (await usedCount('ONCE')) === 1);

  // Cancelling a promo-bearing booking releases the redemption so the code frees up again.
  await call('POST', '/api/admin/promos', { cookie: adminCookie, payload: { code: 'REL1', type: 'percent', value: 10, limit: 1, active: true } });
  const relBooked = await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: await makeDeparture(5), partySize: 1, agreedTerms: true, promoCode: 'REL1', travellers: [{ ...leadTraveller }] });
  ok('promo REL1 claimed (used_count 1)', (await usedCount('REL1')) === 1);
  const rel = await call('POST', `/api/admin/bookings/${relBooked.body.ref}/cancel`, { cookie: adminCookie, payload: { reason: 'customer_request' } });
  ok('cancel promo booking → 200', rel.status === 200, JSON.stringify(rel.body));
  ok('cancel released the redemption (used_count back to 0)', (await usedCount('REL1')) === 0);
}

console.log('\n[admin delete guide nulls departure assignment]');
{
  const del = await call('DELETE', `/api/admin/guides/${smokeGuideId}`, { cookie: adminCookie });
  ok('delete guide → 200 (reports departures unassigned)', del.status === 200 && del.body.departuresUnassigned >= 1, JSON.stringify(del.body));
  const dep = await call('GET', `/api/admin/departures?tourId=accra-city-tour`, { cookie: adminCookie });
  const row = dep.body.departures.find((d: any) => d.id === guidedDepId);
  ok('departure guide_id nulled by FK on guide delete', row && row.guideId === null, JSON.stringify(row));
}

// TRI-898 Phase 3 · admin read/reporting cluster: settings (display vs charge rate), customers, audit-log, dashboard.
console.log('\n[admin settings: display rate vs charge rate (TRI-898)]');
{
  const get1 = await call('GET', '/api/admin/settings', { cookie: adminCookie });
  ok('GET /settings 200', get1.status === 200, JSON.stringify(get1.body));
  ok('settings surfaces display rate (default 15.6)', get1.body.usdToGhsDisplayRate === 15.6, JSON.stringify(get1.body.usdToGhsDisplayRate));
  ok('settings.fx labels display + charge rates distinctly',
    get1.body.fx?.displayRate?.editable === true && get1.body.fx?.chargeRate?.editable === false,
    JSON.stringify(get1.body.fx));
  // Charge rate is whatever the settings row currently holds (cron-driven, read dynamically — the FX
  // convergence section runs later in this smoke); the display-rate edit below must never move it.
  const chargeBefore = Number((await db.query(`SELECT usd_to_ghs_charge_rate AS r FROM settings WHERE singleton=true`)).rows[0].r);
  ok('charge rate exposed read-only from settings', get1.body.fx.chargeRate.value === chargeBefore, `${get1.body.fx.chargeRate.value} vs ${chargeBefore}`);

  // PATCH the DISPLAY rate — must round-trip WITHOUT touching the charge rate.
  const patch = await call('PATCH', '/api/admin/settings', { cookie: adminCookie, payload: { usdToGhsDisplayRate: 12.5, businessName: 'TripKoach Ltd', paymentDeadlineDays: 7 } });
  ok('PATCH /settings 200', patch.status === 200, JSON.stringify(patch.body));
  ok('display rate updated to 12.5', patch.body.usdToGhsDisplayRate === 12.5, JSON.stringify(patch.body.usdToGhsDisplayRate));
  ok('businessName + paymentDeadlineDays saved', patch.body.businessName === 'TripKoach Ltd' && patch.body.paymentDeadlineDays === 7, JSON.stringify(patch.body));
  const chargeAfter = Number((await db.query(`SELECT usd_to_ghs_charge_rate AS r FROM settings WHERE singleton=true`)).rows[0].r);
  ok('charge rate UNCHANGED by display-rate edit', chargeAfter === chargeBefore, `before ${chargeBefore} after ${chargeAfter}`);

  // Attempting to edit the charge rate is rejected (resolves the FX-doc discrepancy).
  const bad = await call('PATCH', '/api/admin/settings', { cookie: adminCookie, payload: { usdToGhsChargeRate: 9.0 } });
  ok('PATCH charge rate → 400 rejected', bad.status === 400 && bad.body.error?.field === 'usdToGhsChargeRate', JSON.stringify(bad.body));
  const chargeStill = Number((await db.query(`SELECT usd_to_ghs_charge_rate AS r FROM settings WHERE singleton=true`)).rows[0].r);
  ok('charge rate still untouched after rejected edit', chargeStill === chargeBefore, `${chargeStill}`);

  // Validation + audit + RBAC.
  ok('PATCH invalid paymentDeadlineDays → 400', (await call('PATCH', '/api/admin/settings', { cookie: adminCookie, payload: { paymentDeadlineDays: 4 } })).status === 400);
  const settingsAudits = Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action='settings.update'`)).rows[0].n);
  ok('audit_log row written for settings.update', settingsAudits >= 1, `got ${settingsAudits}`);
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer GET /settings → 403 (missing settings.manage)', (await call('GET', '/api/admin/settings', { cookie: vcookie })).status === 403);
}

console.log('\n[admin customers view (TRI-898)]');
{
  const list = await call('GET', '/api/admin/customers', { cookie: adminCookie });
  ok('GET /customers 200 paginated', list.status === 200 && Array.isArray(list.body.items) && typeof list.body.total === 'number', JSON.stringify({ total: list.body.total }));
  // The cancel-seat section created a "Cancel Tester" customer with one booking (TK-SMOKE1).
  const cancelTester = list.body.items.find((c: any) => c.email === 'cancel@example.com');
  ok('customers list includes Cancel Tester', !!cancelTester, JSON.stringify(list.body.items.map((c: any) => c.email)));
  ok('customer row exposes name/email/bookings count', cancelTester && cancelTester.name === 'Cancel Tester' && cancelTester.bookings === 1, JSON.stringify(cancelTester));
  const detail = await call('GET', `/api/admin/customers/${cancelTester.id}`, { cookie: adminCookie });
  ok('GET /customers/:id 200 with bookings array', detail.status === 200 && Array.isArray(detail.body.bookings), JSON.stringify(detail.body.bookings?.length));
  ok('customer detail booking references TK-SMOKE1', detail.body.bookings.some((b: any) => b.ref === 'TK-SMOKE1'), JSON.stringify(detail.body.bookings));
  ok('GET /customers/:id unknown → 404', (await call('GET', '/api/admin/customers/00000000-0000-0000-0000-000000000000', { cookie: adminCookie })).status === 404);
  const q = await call('GET', '/api/admin/customers?q=Cancel', { cookie: adminCookie });
  ok('customers search q=Cancel matches', q.status === 200 && q.body.items.some((c: any) => c.email === 'cancel@example.com'), JSON.stringify(q.body.total));
}

console.log('\n[admin audit-log read (TRI-898)]');
{
  const log = await call('GET', '/api/admin/audit-log', { cookie: adminCookie });
  ok('GET /audit-log 200 paginated', log.status === 200 && Array.isArray(log.body.items) && typeof log.body.total === 'number', JSON.stringify({ total: log.body.total }));
  ok('audit-log entries carry action/actor/createdAt', log.body.items[0] && 'action' in log.body.items[0] && 'actor' in log.body.items[0] && 'createdAt' in log.body.items[0], JSON.stringify(log.body.items[0]));
  ok('audit-log resolves staff actor name', log.body.items.some((e: any) => e.actor === 'Ada Admin'), JSON.stringify(log.body.items.map((e: any) => e.actor)));
  const filtered = await call('GET', '/api/admin/audit-log?action=settings.update', { cookie: adminCookie });
  ok('audit-log action filter works', filtered.status === 200 && filtered.body.items.length >= 1 && filtered.body.items.every((e: any) => e.action === 'settings.update'), JSON.stringify(filtered.body.total));
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer GET /audit-log → 403', (await call('GET', '/api/admin/audit-log', { cookie: vcookie })).status === 403);
}

console.log('\n[admin dashboard aggregates (TRI-898)]');
{
  const dash = await call('GET', '/api/admin/dashboard', { cookie: adminCookie });
  ok('GET /dashboard 200', dash.status === 200, JSON.stringify(dash.body));
  ok('dashboard has bookings/revenue/departures/occupancy sections',
    dash.body.bookings && dash.body.revenue && dash.body.departures && dash.body.occupancy, JSON.stringify(Object.keys(dash.body)));
  ok('dashboard revenue exposes USD + GHS', typeof dash.body.revenue.usd === 'number' && 'ghs' in dash.body.revenue, JSON.stringify(dash.body.revenue));
  ok('dashboard occupancy has utilizationPct', typeof dash.body.occupancy.utilizationPct === 'number' && dash.body.occupancy.seatsTotal >= 0, JSON.stringify(dash.body.occupancy));
  ok('dashboard upcoming departures counted', typeof dash.body.departures.upcoming === 'number' && Array.isArray(dash.body.departures.next), JSON.stringify(dash.body.departures.upcoming));
  ok('dashboard default range 30d, honours ?range=all', dash.body.range === '30d' && (await call('GET', '/api/admin/dashboard?range=all', { cookie: adminCookie })).body.range === 'all');
  // viewer has bookings.view → dashboard is visible to all console roles.
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer CAN read /dashboard (bookings.view)', (await call('GET', '/api/admin/dashboard', { cookie: vcookie })).status === 200);
}

console.log('\n[admin session revocation]');
{
  const logout = await call('POST', '/api/admin/auth/logout', { cookie: adminCookie });
  ok('logout → 200', logout.status === 200);
  ok('revoked session → /me 401', (await call('GET', '/api/admin/me', { cookie: adminCookie })).status === 401);
}

console.log('\n[consumer read paths still intact]');
{
  ok('consumer /api/v1/tours still 200, total 11 (created tour left unpublished)', (await call('GET', '/api/v1/tours?pageSize=60')).body.total === 11, 'created tour was unpublished so total stays 11');
}

console.log('\n[fx: automated daily refresh + guards (TRI-873)]');
{
  const { refreshFxRate } = await import('../src/fx.ts');
  const { createBookingService } = await import('../src/booking.ts');
  // Stub providers — no network. `rate(n)` returns a mid-market rate; `failing` simulates an outage.
  const rate = (r: number) => ({ async fetchRate() { return { rate: r, source: 'stub-provider' }; } });
  const failing = { async fetchRate() { throw new Error('simulated network down'); } };
  const settingsRate = async () =>
    Number((await db.query(`SELECT usd_to_ghs_charge_rate AS r FROM settings WHERE singleton=true`)).rows[0].r);
  const histCount = async (status: string) =>
    Number((await db.query(`SELECT COUNT(*) n FROM fx_rate_history WHERE status=$1`, [status])).rows[0].n);

  ok('fx: settings starts at default 15.6', (await settingsRate()) === 15.6);

  // A. first-run happy fetch — no history yet; last-known-good seeded from settings default 15.6.
  const a = await refreshFxRate(db, cfg, { provider: rate(15.0) });
  ok('fx: first-run status ok', a.status === 'ok', a.note);
  ok('fx: effective = mid × (1 + 1.75%) = 15.2625', a.effectiveRate === 15.2625, `${a.effectiveRate}`);
  ok('fx: settings updated to effective rate', (await settingsRate()) === 15.2625);
  ok('fx: ok history row recorded from provider', (await histCount('ok')) === 1 && a.source === 'stub-provider');

  // B. subsequent in-bounds fetch — applies again.
  const b2 = await refreshFxRate(db, cfg, { provider: rate(15.2) });
  ok('fx: second refresh ok → 15.466', b2.status === 'ok' && (await settingsRate()) === 15.466, `${b2.effectiveRate}`);

  // C. out-of-bounds (>5% deviation) — keep last-known-good, settings untouched, alert status.
  const c = await refreshFxRate(db, cfg, { provider: rate(20.0) });
  ok('fx: out_of_bounds detected', c.status === 'out_of_bounds', c.note);
  ok('fx: settings unchanged on out_of_bounds', (await settingsRate()) === 15.466);
  ok('fx: appliedRate stays last-known-good', c.appliedRate === 15.466);
  ok('fx: out_of_bounds history row recorded', (await histCount('out_of_bounds')) === 1);

  // D. fetch failure — fallback to last-known-good; never write 0, never throw.
  const d = await refreshFxRate(db, cfg, { provider: failing });
  ok('fx: fetch_failed status, raw null', d.status === 'fetch_failed' && d.rawRate === null, d.note);
  ok('fx: settings unchanged on fetch_failed', (await settingsRate()) === 15.466);
  ok('fx: fetch_failed history row recorded', (await histCount('fetch_failed')) === 1);

  // E. override kill-switch — env pins the rate; refresh records 'override' and never touches settings.
  const ovCfg = { ...cfg, paystack: { ...cfg.paystack, chargeRateOverride: 18.0 } };
  const e = await refreshFxRate(db, ovCfg, { provider: rate(15.5) });
  ok('fx: override status, no fetch applied', e.status === 'override' && e.effectiveRate === 18.0, e.note);
  ok('fx: settings untouched under override', (await settingsRate()) === 15.466);
  ok('fx: override history row recorded', (await histCount('override')) === 1);

  // Charge-rate precedence end-to-end (unchanged payment path): env override wins over settings.
  const ovDetail = await createBookingService(db, ovCfg, paystackStub).resolveChargeRateDetail();
  ok('fx: env override wins precedence', ovDetail.rate === 18.0 && ovDetail.source === 'env_override', JSON.stringify(ovDetail));
  // With no override, settings.usd_to_ghs_charge_rate drives charges and attributes to the FX provider.
  const setDetail = await createBookingService(db, cfg, paystackStub).resolveChargeRateDetail();
  ok('fx: settings-driven rate attributes to FX provider', setDetail.rate === 15.466 && setDetail.source === 'stub-provider', JSON.stringify(setDetail));
}

console.log('\n[email: transport + template renderer (TRI-880)]');
{
  const { renderTemplate, interpolate, listTemplates, isTemplate } = await import('../src/email-templates.ts');
  const { sendEmail, isEmailEnabled } = await import('../src/email.ts');

  // ── Template renderer ──
  ok('email: smoke_test + booking_pending registered', isTemplate('smoke_test') && isTemplate('booking_pending') && listTemplates().length >= 2);
  const r = renderTemplate('smoke_test', { ref: 'SMOKE-1', to: 'ops@tripkoach.com', env: 'test' });
  ok('email: render returns {subject,html,text}', typeof r.subject === 'string' && typeof r.html === 'string' && typeof r.text === 'string');
  ok('email: subject interpolated', r.subject === 'TripKoach email transport check — SMOKE-1', r.subject);
  ok('email: html + text carry vars', r.html.includes('SMOKE-1') && r.text.includes('ops@tripkoach.com'));
  // HTML-escaping: a value with markup is neutralised in the html body, raw in text.
  const esc = renderTemplate('smoke_test', { ref: '<b>x</b>', to: 'a@b.c', env: 'test' });
  ok('email: html-escapes interpolated values', esc.html.includes('&lt;b&gt;x&lt;/b&gt;') && !esc.html.includes('<b>x</b>'), 'html must escape');
  ok('email: text leaves values raw', esc.text.includes('<b>x</b>'));
  // Guards: missing var + unknown template both throw.
  let threwMissing = false;
  try { renderTemplate('smoke_test', { ref: 'x', to: 'a@b.c' }); } catch { threwMissing = true; }
  ok('email: missing var throws', threwMissing);
  let threwUnknown = false;
  try { renderTemplate('does_not_exist', {}); } catch { threwUnknown = true; }
  ok('email: unknown template throws', threwUnknown);
  ok('email: interpolate is escape-aware', interpolate('{{x}}', { x: '<i>' }, { escape: true }) === '&lt;i&gt;');
  // booking_pending renders with real vars (registered but not wired to any flow).
  const bp = renderTemplate('booking_pending', {
    firstName: 'Ama', travellers: 4, tourTitle: 'Accra City Tour',
    departureLabel: 'Sat 22 Aug 2026', totalDisplay: '$300 USD', ref: 'TK-4821',
    manageUrl: 'https://app.tripkoach.com/bookings/TK-4821',
  });
  ok('email: booking_pending renders full transactional template', bp.html.includes('TK-4821') && bp.html.includes('Accra City Tour') && bp.subject.includes('TK-4821'));

  // ── Send path (stub transport — no network) ──
  const sent: any[] = [];
  const stubTransport: EmailTransport = {
    name: 'stub',
    async send(msg) { sent.push(msg); return { providerMessageId: `resend_${sent.length}` }; },
  };
  const failTransport: EmailTransport = {
    name: 'stub-fail',
    async send() { throw new Error('simulated provider 5xx'); },
  };
  const enabledCfg = { ...cfg, email: { ...cfg.email, apiKey: 're_test_stub', from: 'TripKoach <bookings@send.tripkoach.com>', dryRun: false } };
  const disabledCfg = { ...cfg, email: { ...cfg.email, apiKey: undefined, from: 'TripKoach <bookings@send.tripkoach.com>', dryRun: false } };
  // Scope to the smoke_test template so unrelated send-log rows (TRI-889 booking-lifecycle,
  // TRI-892 review invites) don't perturb the exact counts asserted below.
  const logCount = async (status: string) =>
    Number((await db.query(`SELECT COUNT(*) n FROM email_message WHERE status=$1 AND template='smoke_test'`, [status])).rows[0].n);

  ok('email: transport enabled only with key+from', isEmailEnabled(enabledCfg.email) && !isEmailEnabled(disabledCfg.email));

  // A. happy path → 'sent', provider id captured, send-log row written + linked to its cause.
  const a = await sendEmail(db, enabledCfg, { to: 'ama@example.com', template: 'smoke_test',
    vars: { ref: 'SMOKE-A', to: 'ama@example.com', env: 'test' }, relatedType: 'smoke', relatedId: 'SMOKE-A' },
    { transport: stubTransport });
  ok('email: send status sent + provider id', a.status === 'sent' && a.providerMessageId === 'resend_1', JSON.stringify(a));
  ok('email: transport actually invoked with rendered html', sent.length === 1 && sent[0].to === 'ama@example.com' && sent[0].html.includes('SMOKE-A'));
  const aRow = (await db.query(`SELECT * FROM email_message WHERE id=$1`, [a.id])).rows[0];
  ok('email: send-log row sent, linked, sent_at set', aRow.status === 'sent' && aRow.provider_message_id === 'resend_1' && aRow.related_id === 'SMOKE-A' && aRow.sent_at != null, JSON.stringify(aRow));
  ok('email: send-log captured template + from', aRow.template === 'smoke_test' && aRow.from_email.includes('send.tripkoach.com'));

  // B. transport failure → 'failed', error recorded, NO throw.
  const b2 = await sendEmail(db, enabledCfg, { to: 'x@y.z', template: 'smoke_test',
    vars: { ref: 'SMOKE-B', to: 'x@y.z', env: 'test' } }, { transport: failTransport });
  ok('email: failure returns failed (no throw) + error', b2.status === 'failed' && /simulated provider 5xx/.test(b2.error ?? ''), JSON.stringify(b2));
  ok('email: failed row recorded', (await logCount('failed')) === 1);

  // C. disabled transport → 'skipped', dispatch not attempted.
  const before = sent.length;
  const c = await sendEmail(db, disabledCfg, { to: 'x@y.z', template: 'smoke_test',
    vars: { ref: 'SMOKE-C', to: 'x@y.z', env: 'test' } }, { transport: stubTransport });
  ok('email: disabled transport → skipped, not dispatched', c.status === 'skipped' && sent.length === before, JSON.stringify(c));
  ok('email: skipped row recorded', (await logCount('skipped')) === 1);

  // D. bad input throws before writing a row (unknown template, missing recipient).
  let threwSendUnknown = false, threwNoTo = false;
  const rowsBefore = Number((await db.query(`SELECT COUNT(*) n FROM email_message`)).rows[0].n);
  try { await sendEmail(db, enabledCfg, { to: 'a@b.c', template: 'nope', vars: {} }, { transport: stubTransport }); } catch { threwSendUnknown = true; }
  try { await sendEmail(db, enabledCfg, { to: '', template: 'smoke_test', vars: { ref: 'x', to: 'a', env: 't' } }, { transport: stubTransport }); } catch { threwNoTo = true; }
  ok('email: unknown template + missing recipient throw', threwSendUnknown && threwNoTo);
  ok('email: no send-log rows written on bad input', Number((await db.query(`SELECT COUNT(*) n FROM email_message`)).rows[0].n) === rowsBefore);
}

console.log('\n[notifications: booking-lifecycle variants + reminder cron (TRI-889)]');
{
  const { renderTemplate, isTemplate } = await import('../src/email-templates.ts');
  const { createNotificationService } = await import('../src/notifications.ts');

  // ── Templates registered + render with real vars ──
  const VARIANTS = ['booking_confirmed', 'booking_cancelled', 'payment_failed', 'departure_reminder'];
  ok('notify: all 4 lifecycle templates registered', VARIANTS.every((t) => isTemplate(t)));
  const cv = { firstName: 'Ama', ref: 'TK-TEST', tourTitle: 'Accra City Tour',
    departureLabel: 'Sat 22 Aug 2026, 09:00', travellers: 2, totalDisplay: '$150 USD',
    manageUrl: 'https://app.tripkoach.com/bookings/TK-TEST' };
  ok('notify: booking_confirmed renders + carries ref/total', (() => { const r = renderTemplate('booking_confirmed', cv); return r.subject.includes('Accra City Tour') && r.html.includes('TK-TEST') && r.html.includes('$150 USD'); })());
  ok('notify: payment_failed renders', renderTemplate('payment_failed', cv).subject.includes('TK-TEST'));
  ok('notify: departure_reminder renders daysLabel', renderTemplate('departure_reminder', { ...cv, daysLabel: 'in 3 days' }).html.includes('in 3 days'));
  ok('notify: booking_cancelled renders with empty reason', renderTemplate('booking_cancelled', { ...cv, reason: '' }).html.includes('TK-TEST'));

  // ── Wired service against a stub transport (no network) ──
  const sent: any[] = [];
  const stub: EmailTransport = { name: 'stub', async send(m) { sent.push(m); return { providerMessageId: `nid_${sent.length}` }; } };
  const enCfg = { ...cfg,
    email: { ...cfg.email, apiKey: 're_test_stub', from: 'TripKoach <bookings@send.tripkoach.com>', dryRun: false },
    notify: { webBaseUrl: 'https://app.tripkoach.com', reminderDaysBefore: 3 } };
  const notifier = createNotificationService(db, enCfg, { transport: stub, log: () => {} });

  // A guest booking → booking-confirmed to the lead (contact) email + a linked send-log row.
  const dep = await makeDeparture(5);
  const bk = (await bookOne(dep, 2)).body;
  const rc = await notifier.bookingConfirmed(bk.ref);
  ok('notify: bookingConfirmed → sent to lead contact email', rc?.status === 'sent' && sent.at(-1).to === 'ama@example.com' && sent.at(-1).subject.includes('Accra City Tour'), JSON.stringify(rc));
  const cRow = (await db.query(`SELECT * FROM email_message WHERE template='booking_confirmed' AND related_id=$1`, [bk.ref])).rows[0];
  ok('notify: confirmed send-log linked to booking', cRow && cRow.status === 'sent' && cRow.related_type === 'booking', JSON.stringify(cRow));

  // booking-cancelled carries the reason clause.
  await db.query(`UPDATE booking SET status='cancelled', cancel_reason='customer_request' WHERE ref=$1`, [bk.ref]);
  const rcx = await notifier.bookingCancelled(bk.ref, { reason: 'customer_request' });
  ok('notify: bookingCancelled → sent with reason clause', rcx?.status === 'sent' && sent.at(-1).text.includes('at your request'), JSON.stringify(rcx));

  // payment-failed variant sends.
  const rpf = await notifier.paymentFailed(bk.ref);
  ok('notify: paymentFailed → sent', rpf?.status === 'sent' && sent.at(-1).subject.includes(bk.ref), JSON.stringify(rpf));

  // ── Account preference honouring ──
  const acct = (await db.query(`INSERT INTO user_account (email, name) VALUES ('holder@example.com','Acc Holder') RETURNING id`)).rows[0];
  const dep2 = await makeDeparture(5);
  const bk2 = (await bookOne(dep2, 1)).body;
  await db.query(`UPDATE booking SET user_id=$1 WHERE ref=$2`, [acct.id, bk2.ref]);
  // Default (no pref row) → send to the ACCOUNT email.
  const rAcc = await notifier.bookingConfirmed(bk2.ref);
  ok('notify: account booking defaults to send → account email', rAcc?.status === 'sent' && sent.at(-1).to === 'holder@example.com', JSON.stringify(rAcc));
  // Explicit opt-out row → suppressed (no send, null result).
  await db.query(`INSERT INTO notification_preference (user_id, channel, type, enabled) VALUES ($1,'email','booking_confirmations',false)`, [acct.id]);
  const nBefore = sent.length;
  const rOff = await notifier.bookingConfirmed(bk2.ref);
  ok('notify: opted-out account → suppressed (no send)', rOff === null && sent.length === nBefore);

  // Guest with no contact email → suppressed.
  const dep3 = await makeDeparture(5);
  const g3 = (await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: dep3, partySize: 1, agreedTerms: true, travellers: [{ name: 'Phone Only', phone: '+233200000009', isLead: true }] })).body;
  const gBefore = sent.length;
  const rGuest = await notifier.bookingConfirmed(g3.ref);
  ok('notify: guest with no email → suppressed', rGuest === null && sent.length === gBefore);

  // Disabled transport (no key) → 'skipped' send-log row, dispatch not attempted.
  const disNotifier = createNotificationService(db, { ...enCfg, email: { ...enCfg.email, apiKey: undefined } }, { transport: stub, log: () => {} });
  const dBefore = sent.length;
  const rDis = await disNotifier.bookingConfirmed(bk.ref);
  ok('notify: disabled transport → skipped, not dispatched', rDis?.status === 'skipped' && sent.length === dBefore, JSON.stringify(rDis));

  // ── Departure-reminder cron ── (real now so the intra-day dedup compares like-for-like dates)
  const nowReal = new Date();
  const t = new Date(Date.UTC(nowReal.getUTCFullYear(), nowReal.getUTCMonth(), nowReal.getUTCDate() + 3));
  const targetStr = t.toISOString().slice(0, 10);
  const remDep = (await db.query(
    `INSERT INTO departure (tour_id, date_label, time_label, depart_on, price_minor, currency, seats_total, seats_reserved, status)
     VALUES ($1, 'Reminder Departure', '09:00 · Test', $2::date, 7500, 'USD', 5, 0, 'scheduled') RETURNING id`,
    [accraTourId, targetStr])).rows[0];
  const remBk = (await bookOne(remDep.id, 1)).body;
  await db.query(`UPDATE booking SET status='confirmed', payment_state='paid' WHERE ref=$1`, [remBk.ref]);
  // A same-date UNPAID booking must NOT be reminded.
  const remUnpaid = (await bookOne(remDep.id, 1)).body;
  const remBefore = sent.length;
  const rr = await notifier.sendDepartureReminders({ log: () => {} });
  ok('notify: reminder targets depart_on = today+N', rr.target === targetStr && rr.matched >= 1, JSON.stringify(rr));
  ok('notify: reminder emailed the paid booking only', rr.sent >= 1 && sent.slice(remBefore).some((m) => m.to === 'ama@example.com' && m.subject.includes('Accra City Tour')));
  ok('notify: reminder did not email the unpaid same-date booking', !rr.refs.includes(remUnpaid.ref));
  // Second run same day → deduped (already-sent guard) → nothing new.
  const rr2 = await notifier.sendDepartureReminders({ log: () => {} });
  ok('notify: reminder idempotent within a day', rr2.matched === 0 && rr2.sent === 0, JSON.stringify(rr2));
}

// ─────────────────────────────────────────────────────────────────────────────
// TRI-881 P1 · consumer accounts & auth: signup/login/session, profile, notification prefs,
// link guest bookings, password reset (request/consume). Consumer realm mounts under /api/v1.
// ─────────────────────────────────────────────────────────────────────────────
const UCOOKIE = cfg.consumer.cookieName;
const ucall = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, opts: { payload?: any; cookie?: string } = {}) => {
  const res = await app.inject({ method, url, payload: opts.payload, cookies: opts.cookie ? { [UCOOKIE]: opts.cookie } : undefined });
  let body: any; try { body = res.json(); } catch { body = res.body; }
  const cookie = (res.cookies as Array<{ name: string; value: string }>).find((c) => c.name === UCOOKIE)?.value ?? '';
  return { status: res.statusCode, body, cookie };
};

console.log('\n[consumer: signup + session]');
let userCookie = '';
{
  ok('signup weak password → 400', (await ucall('POST', '/api/v1/auth/signup', { payload: { email: 'kofi@example.com', password: 'short' } })).status === 400);
  ok('signup bad email → 400', (await ucall('POST', '/api/v1/auth/signup', { payload: { email: 'not-an-email', password: 'longenough1' } })).status === 400);
  const s = await ucall('POST', '/api/v1/auth/signup', { payload: { email: 'Kofi@Example.com', password: 'Str0ng-Pass!', name: 'Kofi Owusu', phone: '+233201111111', country: 'Ghana' } });
  ok('signup → 201', s.status === 201, JSON.stringify(s.body));
  ok('signup returns profile (email lowercased)', s.body.user?.email === 'kofi@example.com' && s.body.user?.name === 'Kofi Owusu', JSON.stringify(s.body.user));
  ok('signup sets session cookie', !!s.cookie);
  userCookie = s.cookie;
  ok('signup duplicate email → 409', (await ucall('POST', '/api/v1/auth/signup', { payload: { email: 'kofi@example.com', password: 'Another-Pass1' } })).status === 409);
  // session is subject_type='user'
  const sess = await db.query(`SELECT COUNT(*)::int n FROM session WHERE subject_type='user'`);
  ok('user session row created (subject_type=user)', Number(sess.rows[0].n) >= 1, JSON.stringify(sess.rows[0]));
  // default notification prefs seeded (2 channels × 7 types = 14)
  const np = await db.query(`SELECT COUNT(*)::int n FROM notification_preference np JOIN user_account u ON u.id=np.user_id WHERE u.email='kofi@example.com'`);
  ok('signup seeds 14 notification prefs', Number(np.rows[0].n) === 14, JSON.stringify(np.rows[0]));
}

console.log('\n[consumer: /me profile read/write]');
{
  ok('GET /me without session → 401', (await ucall('GET', '/api/v1/me')).status === 401);
  const me = await ucall('GET', '/api/v1/me', { cookie: userCookie });
  ok('GET /me 200 with session', me.status === 200 && me.body.user?.email === 'kofi@example.com', JSON.stringify(me.body));
  ok('/me profile defaults language=en currency=USD', me.body.user.language === 'en' && me.body.user.displayCurrency === 'USD', JSON.stringify(me.body.user));
  const upd = await ucall('PATCH', '/api/v1/me', { cookie: userCookie, payload: { phone: '+233209999999', country: 'Ghana', dietaryNeeds: 'Vegetarian', displayCurrency: 'ghs', dataSaver: true, emergencyName: 'Ama', emergencyPhone: '+233555' } });
  ok('PATCH /me 200', upd.status === 200, JSON.stringify(upd.body));
  ok('PATCH /me applied (currency upper, dietary, dataSaver)', upd.body.user.displayCurrency === 'GHS' && upd.body.user.dietaryNeeds === 'Vegetarian' && upd.body.user.dataSaver === true && upd.body.user.emergencyName === 'Ama', JSON.stringify(upd.body.user));
}

console.log('\n[consumer: notification preferences]');
{
  const n = await ucall('GET', '/api/v1/me/notifications', { cookie: userCookie });
  ok('GET /me/notifications 200', n.status === 200, JSON.stringify(n.body));
  ok('defaults: booking_confirmations on, marketing_offers off', n.body.notifications.email.booking_confirmations === true && n.body.notifications.email.marketing_offers === false, JSON.stringify(n.body.notifications.email));
  ok('both channels present with 7 types', Object.keys(n.body.notifications.whatsapp).length === 7, JSON.stringify(Object.keys(n.body.notifications.whatsapp)));
  const put = await ucall('PUT', '/api/v1/me/notifications', { cookie: userCookie, payload: { email: { marketing_offers: true }, whatsapp: { booking_confirmations: false } } });
  ok('PUT /me/notifications 200', put.status === 200, JSON.stringify(put.body));
  ok('toggles persisted', put.body.notifications.email.marketing_offers === true && put.body.notifications.whatsapp.booking_confirmations === false, JSON.stringify(put.body.notifications));
  ok('PUT unknown type → 400', (await ucall('PUT', '/api/v1/me/notifications', { cookie: userCookie, payload: { email: { not_a_type: true } } })).status === 400);
}

console.log('\n[consumer: change password + login/logout]');
{
  ok('change password wrong current → 401', (await ucall('POST', '/api/v1/me/password', { cookie: userCookie, payload: { currentPassword: 'nope', newPassword: 'Brand-New-Pass1' } })).status === 401);
  const ch = await ucall('POST', '/api/v1/me/password', { cookie: userCookie, payload: { currentPassword: 'Str0ng-Pass!', newPassword: 'Brand-New-Pass1' } });
  ok('change password → 200', ch.status === 200 && ch.body.ok === true, JSON.stringify(ch.body));
  ok('login old password → 401', (await ucall('POST', '/api/v1/auth/login', { payload: { email: 'kofi@example.com', password: 'Str0ng-Pass!' } })).status === 401);
  const li = await ucall('POST', '/api/v1/auth/login', { payload: { email: 'kofi@example.com', password: 'Brand-New-Pass1' } });
  ok('login new password → 200 + cookie', li.status === 200 && !!li.cookie, JSON.stringify(li.body));
  userCookie = li.cookie;
  const lo = await ucall('POST', '/api/v1/auth/logout', { cookie: userCookie });
  ok('logout → 200', lo.status === 200);
  ok('revoked session → /me 401', (await ucall('GET', '/api/v1/me', { cookie: userCookie })).status === 401);
}

console.log('\n[consumer: link guest bookings → /me/bookings]');
{
  // A guest books with a unique contact email, then creates an account with that same email.
  const dep = await makeDeparture(5);
  const guest = await post('/api/v1/bookings', { tourSlug: 'accra-city-tour', departureId: dep, partySize: 2, agreedTerms: true,
    travellers: [{ name: 'Esi Guest', email: 'esi@example.com', phone: '+233204444444', isLead: true }] });
  ok('guest booking created', guest.status === 201, JSON.stringify(guest.body));
  const guestRef = guest.body.ref;
  const s = await ucall('POST', '/api/v1/auth/signup', { payload: { email: 'esi@example.com', password: 'Esi-Str0ng!' } });
  ok('signup links the guest booking', s.status === 201 && s.body.linkedBookings >= 1, JSON.stringify({ linked: s.body.linkedBookings }));
  const mine = await ucall('GET', '/api/v1/me/bookings', { cookie: s.cookie });
  ok('GET /me/bookings 200 includes linked booking', mine.status === 200 && mine.body.bookings.some((b: any) => b.ref === guestRef), JSON.stringify(mine.body.bookings?.map((b: any) => b.ref)));
  const linkedRow = await db.query(`SELECT user_id FROM booking WHERE ref=$1`, [guestRef]);
  ok('booking.user_id set on link', linkedRow.rows[0].user_id != null, JSON.stringify(linkedRow.rows[0]));
}

console.log('\n[consumer: password reset request + consume]');
{
  // Unknown email → 200 no-op, no email row created (no user enumeration).
  const before = Number((await db.query(`SELECT COUNT(*) n FROM email_message WHERE related_type='password_reset'`)).rows[0].n);
  const unknown = await ucall('POST', '/api/v1/auth/password-reset/request', { payload: { email: 'nobody@example.com' } });
  ok('reset request unknown email → 200 (no enumeration)', unknown.status === 200 && unknown.body.ok === true, JSON.stringify(unknown.body));
  ok('no reset email queued for unknown user', Number((await db.query(`SELECT COUNT(*) n FROM email_message WHERE related_type='password_reset'`)).rows[0].n) === before);

  // Known email → 200; a password_reset email row is written (skipped: transport disabled in smoke).
  const req = await ucall('POST', '/api/v1/auth/password-reset/request', { payload: { email: 'kofi@example.com' } });
  ok('reset request known email → 200', req.status === 200 && req.body.ok === true, JSON.stringify(req.body));
  const emailRow = (await db.query(`SELECT template, status, vars, related_id FROM email_message WHERE related_type='password_reset' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  ok('reset email logged (template password_reset)', emailRow.template === 'password_reset' && emailRow.related_id != null, JSON.stringify({ t: emailRow.template, s: emailRow.status }));
  // Extract the single-use token from the rendered reset link (vars snapshot).
  const resetUrl: string = (typeof emailRow.vars === 'string' ? JSON.parse(emailRow.vars) : emailRow.vars).resetUrl;
  const token = new URL(resetUrl).searchParams.get('token')!;
  ok('reset link carries a token', !!token && token.length >= 32, resetUrl);
  // token stored only as a hash (plaintext never persisted)
  const rawInDb = await db.query(`SELECT COUNT(*)::int n FROM password_reset_token WHERE token_hash = $1`, [token]);
  ok('token stored hashed, not raw', Number(rawInDb.rows[0].n) === 0, 'raw token must not match a stored hash');

  ok('consume weak password → 400', (await ucall('POST', '/api/v1/auth/password-reset/consume', { payload: { token, password: 'weak' } })).status === 400);
  ok('consume bad token → 400', (await ucall('POST', '/api/v1/auth/password-reset/consume', { payload: { token: 'deadbeef', password: 'Reset-Pass-99' } })).status === 400);
  const consume = await ucall('POST', '/api/v1/auth/password-reset/consume', { payload: { token, password: 'Reset-Pass-99' } });
  ok('consume valid token → 200', consume.status === 200 && consume.body.ok === true, JSON.stringify(consume.body));
  ok('login with reset password → 200', (await ucall('POST', '/api/v1/auth/login', { payload: { email: 'kofi@example.com', password: 'Reset-Pass-99' } })).status === 200);
  ok('login with old (pre-reset) password → 401', (await ucall('POST', '/api/v1/auth/login', { payload: { email: 'kofi@example.com', password: 'Brand-New-Pass1' } })).status === 401);
  ok('token is single-use (reuse → 400)', (await ucall('POST', '/api/v1/auth/password-reset/consume', { payload: { token, password: 'Yet-Another-1' } })).status === 400);
  // reset revoked all prior sessions for the user
  const live = await db.query(`SELECT COUNT(*)::int n FROM session s JOIN user_account u ON u.id=s.subject_id WHERE u.email='kofi@example.com' AND s.subject_type='user' AND s.revoked_at IS NULL AND s.expires_at > now()`);
  // (a fresh login above created one new live session; the reset revoked the ones that existed before it)
  ok('reset revoked pre-existing sessions (audit recorded)', Number((await db.query(`SELECT COUNT(*) n FROM audit_log WHERE action='user.password_reset'`)).rows[0].n) >= 1, JSON.stringify(live.rows[0]));
}

console.log('\n[consumer: read paths + admin realm still intact]');
{
  ok('consumer /api/v1/tours still 200 total 11', (await get('/api/v1/tours?pageSize=60')).body.total === 11);
  ok('admin realm login still 200 (no cross-realm cookie bleed)', (await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } })).status === 200);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRI-895 P3 · Staff management (invite→provision→accept) + admin MFA (TOTP).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[staff mgmt: invite → accept → login]');
{
  // Fresh admin session (the earlier one was revoked in the session-revocation test).
  const adminLogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  const admin = adminLogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('staff: re-login admin 200', adminLogin.status === 200 && !!admin);

  // RBAC: viewer lacks users.manage → 403 on the staff list.
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('staff: viewer list staff → 403 (missing users.manage)', (await call('GET', '/api/admin/staff', { cookie: vcookie })).status === 403);
  ok('staff: unauthenticated invite → 401', (await call('POST', '/api/admin/staff', { payload: { email: 'x@y.z' } })).status === 401);

  // Invite a new operator. Email transport is disabled in smoke → 'skipped', so the accept token is
  // surfaced in the response for manual/testing redemption.
  const invited = await call('POST', '/api/admin/staff', { cookie: admin, payload: { email: 'Nana@tripkoach.com', name: 'Nana Kwabena', role: 'operator' } });
  ok('staff: invite → 201', invited.status === 201, JSON.stringify(invited.body));
  ok('staff: invited user is status=invited operator', invited.body.staff?.status === 'invited' && invited.body.staff?.role === 'operator', JSON.stringify(invited.body.staff));
  ok('staff: invite email skipped (no key) + token surfaced', invited.body.invite?.emailStatus === 'skipped' && typeof invited.body.invite?.token === 'string', JSON.stringify(invited.body.invite));
  ok('staff: email lower-cased', invited.body.staff?.email === 'nana@tripkoach.com', invited.body.staff?.email);
  const inviteToken = invited.body.invite.token as string;
  const newStaffId = invited.body.staff.id as string;
  // A send-log row was written for the invite (template staff_invite, related_type staff_invite).
  const inviteLog = (await db.query(`SELECT * FROM email_message WHERE template='staff_invite' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  ok('staff: invite wrote a send-log row', !!inviteLog && inviteLog.related_type === 'staff_invite' && inviteLog.to_email === 'nana@tripkoach.com', JSON.stringify(inviteLog?.status));

  ok('staff: list shows the invited user', (await call('GET', '/api/admin/staff', { cookie: admin })).body.staff.some((s: any) => s.email === 'nana@tripkoach.com'));

  // Duplicate invite of an active member is a conflict; re-inviting the pending one is allowed (resend).
  ok('staff: invite existing active admin → 409', (await call('POST', '/api/admin/staff', { cookie: admin, payload: { email: 'admin@tripkoach.com' } })).status === 409);

  // Accept preview (public): valid before redemption.
  const preview = await call('GET', `/api/admin/staff/accept?token=${encodeURIComponent(inviteToken)}`);
  ok('staff: accept preview valid', preview.status === 200 && preview.body.invite?.valid === true && preview.body.invite?.email === 'nana@tripkoach.com', JSON.stringify(preview.body));

  // Redeem with a weak password → 400; then a strong one → activated.
  ok('staff: accept weak password → 400', (await call('POST', '/api/admin/staff/accept', { payload: { token: inviteToken, password: 'short' } })).status === 400);
  const accept = await call('POST', '/api/admin/staff/accept', { payload: { token: inviteToken, password: 'Nana-Str0ng-Pass!' } });
  ok('staff: accept → 200 ok', accept.status === 200 && accept.body.ok === true, JSON.stringify(accept.body));
  // Token is single-use: a second redemption is rejected.
  ok('staff: accept reused token → 409', (await call('POST', '/api/admin/staff/accept', { payload: { token: inviteToken, password: 'Another-Pass-1!' } })).status === 409);

  // The provisioned staff can now log in and is active.
  const newLogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'nana@tripkoach.com', password: 'Nana-Str0ng-Pass!' } });
  ok('staff: provisioned user can log in', newLogin.status === 200 && newLogin.body.staff?.role === 'operator', JSON.stringify(newLogin.body));
  const nanaCookie = newLogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';

  // PATCH role, then disable / re-enable.
  ok('staff: PATCH role → viewer', (await call('PATCH', `/api/admin/staff/${newStaffId}`, { cookie: admin, payload: { role: 'viewer' } })).body.role === 'viewer');
  const disabled = await call('POST', `/api/admin/staff/${newStaffId}/disable`, { cookie: admin });
  ok('staff: disable → status disabled', disabled.status === 200 && disabled.body.status === 'disabled');
  ok('staff: disabled user session revoked → /me 401', (await call('GET', '/api/admin/me', { cookie: nanaCookie })).status === 401);
  ok('staff: disabled user cannot log in → 401', (await call('POST', '/api/admin/auth/login', { payload: { email: 'nana@tripkoach.com', password: 'Nana-Str0ng-Pass!' } })).status === 401);
  ok('staff: re-enable → active', (await call('POST', `/api/admin/staff/${newStaffId}/enable`, { cookie: admin })).body.status === 'active');

  // Last-admin guard: cannot demote/disable the only active admin.
  const adminRow = (await db.query(`SELECT id FROM staff_user WHERE email='admin@tripkoach.com'`)).rows[0];
  ok('staff: cannot demote the last active admin → 409', (await call('PATCH', `/api/admin/staff/${adminRow.id}`, { cookie: admin, payload: { role: 'operator' } })).status === 409);
  ok('staff: cannot disable the last active admin → 409', (await call('POST', `/api/admin/staff/${adminRow.id}/disable`, { cookie: admin })).status === 409);
}

console.log('\n[admin MFA: enroll → verify → login challenge → recovery]');
{
  const adminLogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  const admin = adminLogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';

  const status0 = await call('GET', '/api/admin/auth/mfa/status', { cookie: admin });
  ok('mfa: initial status disabled', status0.status === 200 && status0.body.enabled === false);

  // Enroll → secret + otpauth URI.
  const enroll = await call('POST', '/api/admin/auth/mfa/enroll', { cookie: admin });
  ok('mfa: enroll returns secret + otpauth URI', enroll.status === 200 && typeof enroll.body.secret === 'string' && /^otpauth:\/\/totp\//.test(enroll.body.otpauthUri || ''), JSON.stringify(enroll.body));
  const secret = enroll.body.secret as string;

  // Verify with a wrong code → 400; then a real code → enabled + one-time recovery codes.
  ok('mfa: verify wrong code → 400', (await call('POST', '/api/admin/auth/mfa/verify', { cookie: admin, payload: { code: '000000' } })).status === 400);
  const verify = await call('POST', '/api/admin/auth/mfa/verify', { cookie: admin, payload: { code: totp(secret) } });
  ok('mfa: verify → enabled + 10 recovery codes', verify.status === 200 && verify.body.enabled === true && Array.isArray(verify.body.recoveryCodes) && verify.body.recoveryCodes.length === 10, JSON.stringify(verify.body?.enabled));
  const recoveryCodes = verify.body.recoveryCodes as string[];

  // Now a fresh login must challenge for MFA (returns mfaRequired, no staff payload yet).
  const login2 = await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  ok('mfa: login now returns mfaRequired', login2.status === 200 && login2.body.mfaRequired === true && !login2.body.staff, JSON.stringify(login2.body));
  const pendingCookie = login2.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  // The half-auth session cannot touch protected routes yet.
  ok('mfa: pending session → /me 401 (half-auth)', (await call('GET', '/api/admin/me', { cookie: pendingCookie })).status === 401);
  ok('mfa: pending session write → 401', (await call('GET', '/api/admin/staff', { cookie: pendingCookie })).status === 401);
  // Wrong challenge code → 401; correct TOTP → promoted to full session with staff+permissions.
  ok('mfa: challenge wrong code → 401', (await call('POST', '/api/admin/auth/mfa', { cookie: pendingCookie, payload: { code: '111111' } })).status === 401);
  const challenge = await call('POST', '/api/admin/auth/mfa', { cookie: pendingCookie, payload: { code: totp(secret) } });
  ok('mfa: challenge TOTP → full session', challenge.status === 200 && challenge.body.staff?.role === 'admin' && Array.isArray(challenge.body.permissions), JSON.stringify(challenge.body?.staff));
  ok('mfa: promoted session → /me 200', (await call('GET', '/api/admin/me', { cookie: pendingCookie })).status === 200);

  // Recovery code path: a fresh login, then complete the challenge with a single-use recovery code.
  const login3 = await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  const pending3 = login3.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  const rc = recoveryCodes[0];
  const recover = await call('POST', '/api/admin/auth/mfa', { cookie: pending3, payload: { code: rc } });
  ok('mfa: challenge with recovery code → full session', recover.status === 200 && recover.body.staff?.role === 'admin');
  // The same recovery code cannot be reused.
  const login4 = await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  const pending4 = login4.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('mfa: recovery code is single-use → 401 on reuse', (await call('POST', '/api/admin/auth/mfa', { cookie: pending4, payload: { code: rc } })).status === 401);

  // Complete pending4 with TOTP so we hold a full session, then disable MFA (requires a live code).
  const promote4 = await call('POST', '/api/admin/auth/mfa', { cookie: pending4, payload: { code: totp(secret) } });
  ok('mfa: pending4 promoted via TOTP', promote4.status === 200);
  ok('mfa: disable without code → 400', (await call('POST', '/api/admin/auth/mfa/disable', { cookie: pending4, payload: {} })).status === 400);
  const disable = await call('POST', '/api/admin/auth/mfa/disable', { cookie: pending4, payload: { code: totp(secret) } });
  ok('mfa: disable with TOTP → enabled false', disable.status === 200 && disable.body.enabled === false, JSON.stringify(disable.body));
  // After disabling, login no longer challenges.
  const login5 = await call('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  ok('mfa: after disable, login returns full session (no challenge)', login5.status === 200 && !!login5.body.staff && !login5.body.mfaRequired, JSON.stringify(login5.body));
}

// ─────────────────────────────────────────────────────────────────────────────
// TRI-912 · Admin MFA ENFORCEMENT: a factor-less login by an enforced role (admin/operator) is issued an
// ENROLL-gated half-auth session — blocked from every privileged route until it enrolls a factor, then
// promoted in place. Roles outside the enforced set (viewer) keep MFA optional. Exercised against a second
// app with enforcement ON; the admin is factor-less again here (the block above disabled its MFA).
console.log('\n[admin MFA enforcement: enroll gate (TRI-912)]');
{
  const appEnf = buildServer(db, { ...cfg, mfaEnforcedRoles: ['admin', 'operator'] }, paystackStub);
  await appEnf.ready();
  const callE = async (method: 'GET' | 'POST', url: string, opts: { payload?: any; cookie?: string } = {}) => {
    const res = await appEnf.inject({ method, url, payload: opts.payload, cookies: opts.cookie ? { [COOKIE]: opts.cookie } : undefined });
    let body: any; try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body, cookies: res.cookies as Array<{ name: string; value: string }> };
  };

  // Factor-less admin (enforced role) → login is gated, NOT a full session.
  const gated = await callE('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  ok('enforce: factor-less admin login → mfaEnrollmentRequired', gated.status === 200 && gated.body.mfaEnrollmentRequired === true, JSON.stringify(gated.body));
  ok('enforce: gated login exposes no permissions', gated.body.permissions === undefined);
  const gcookie = gated.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('enforce: gated login set a session cookie', !!gcookie);

  // The enroll-gated cookie is blocked from privileged routes and from /me (strict auth) until promoted.
  ok('enforce: gated cookie → privileged route 401', (await callE('GET', '/api/admin/tours', { cookie: gcookie })).status === 401);
  ok('enforce: gated cookie → /me 401 (not yet authed)', (await callE('GET', '/api/admin/me', { cookie: gcookie })).status === 401);

  // …but it CAN reach the MFA enroll endpoints to close the gate.
  const enroll = await callE('POST', '/api/admin/auth/mfa/enroll', { cookie: gcookie });
  ok('enforce: gated cookie → enroll 200 with secret', enroll.status === 200 && typeof enroll.body.secret === 'string', JSON.stringify(enroll.body).slice(0, 120));
  const esecret = enroll.body.secret as string;

  // Verifying a live code confirms the factor, issues recovery codes, AND promotes the session in place.
  const verified = await callE('POST', '/api/admin/auth/mfa/verify', { cookie: gcookie, payload: { code: totp(esecret) } });
  ok('enforce: verify → recovery codes + promoted session', verified.status === 200
    && Array.isArray(verified.body.recoveryCodes) && verified.body.recoveryCodes.length > 0
    && verified.body.staff?.role === 'admin' && Array.isArray(verified.body.permissions), JSON.stringify(verified.body).slice(0, 160));

  // The SAME cookie now clears strict auth — the gate is closed.
  ok('enforce: promoted cookie → privileged route 200', (await callE('GET', '/api/admin/tours', { cookie: gcookie })).status === 200);
  ok('enforce: promoted cookie → /me 200', (await callE('GET', '/api/admin/me', { cookie: gcookie })).status === 200);

  // A now-enrolled admin logs in via the normal 2FA challenge (mfaRequired), not the enroll gate.
  const relog = await callE('POST', '/api/admin/auth/login', { payload: { email: 'admin@tripkoach.com', password: 'Sup3r-Secret!' } });
  ok('enforce: enrolled admin login → mfaRequired (challenge, not enroll)', relog.status === 200 && relog.body.mfaRequired === true && !relog.body.mfaEnrollmentRequired, JSON.stringify(relog.body));

  // A non-enforced role (viewer) keeps MFA optional → still a full session, no gate.
  const vlogin = await callE('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  ok('enforce: non-enforced viewer → full session (no gate)', vlogin.status === 200 && !!vlogin.body.staff && !vlogin.body.mfaEnrollmentRequired && Array.isArray(vlogin.body.permissions), JSON.stringify(vlogin.body));

  await appEnf.close();
}

await app.close();
await db.close();
console.log(`\n✅ smoke passed — ${passed} assertions`);
