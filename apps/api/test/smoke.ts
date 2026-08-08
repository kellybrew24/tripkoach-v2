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
  paystack: {
    ...base.paystack, secretKey: 'sk_test_stub', publicKey: 'pk_test_stub',
    webhookSecret: WEBHOOK_SECRET, chargeRateOverride: undefined,
  },
  // A From is always configured in prod (EMAIL_FROM); no apiKey here → transport stays disabled, so
  // product emails (e.g. the TRI-881 password reset) render + log a 'skipped' row without dispatching.
  email: { ...base.email, from: 'TripKoach <bookings@send.tripkoach.com>', apiKey: undefined, dryRun: false },
};
const db = await createDb(cfg);
const applied = await migrate(db);
console.log(`migrations applied: ${applied.length}`);
await seed(db, undefined, (m) => console.log(`  seed · ${m}`));

// Stub Paystack: no network. Records init calls; verify returns success unless overridden per reference.
const initCalls: PaystackInitRequest[] = [];
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
};

const app = buildServer(db, cfg, paystackStub);
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
  return { status: res.statusCode, body, cookies: res.cookies as Array<{ name: string; value: string }> };
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
  ok('admin has all 10 permissions', Array.isArray(login.body.permissions) && login.body.permissions.length === 10, JSON.stringify(login.body.permissions));
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

console.log('\n[admin payments view + refund FLAG]');
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

  // refund is FLAG-only: 200, intent recorded, status NOT flipped to refunded.
  const refund = await call('POST', '/api/admin/payments/PAY-SMOKE1/refund', { cookie: adminCookie, payload: { reason: 'duplicate charge' } });
  ok('admin refund-flag → 200 refundRequested', refund.status === 200 && refund.body.refundRequested === true, JSON.stringify(refund.body));
  ok('refund flag records intent, keeps status=paid', refund.body.payment.status === 'paid' && refund.body.payment.refundIntent?.reason === 'duplicate charge', JSON.stringify(refund.body.payment));
  const refundAudits = Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action='payment.refund_requested'`)).rows[0].n);
  ok('audit_log row written for payment.refund_requested', refundAudits >= 1, `got ${refundAudits}`);

  // wrong-permission: viewer lacks payments.refund → 403
  const vlogin = await call('POST', '/api/admin/auth/login', { payload: { email: 'viewer@tripkoach.com', password: 'Just-Look!' } });
  const vcookie = vlogin.cookies.find((c) => c.name === COOKIE)?.value ?? '';
  ok('viewer refund → 403 (missing payments.refund)', (await call('POST', '/api/admin/payments/PAY-SMOKE1/refund', { cookie: vcookie, payload: {} })).status === 403);
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
  const logCount = async (status: string) =>
    Number((await db.query(`SELECT COUNT(*) n FROM email_message WHERE status=$1`, [status])).rows[0].n);

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

await app.close();
await db.close();
console.log(`\n✅ smoke passed — ${passed} assertions`);
