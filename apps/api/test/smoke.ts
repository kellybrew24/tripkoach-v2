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

await app.close();
await db.close();
console.log(`\n✅ smoke passed — ${passed} assertions`);
