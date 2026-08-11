/*
 * TRI-1062 LIVE E2E against the running dev API (127.0.0.1:3020) + tripkoach_dev PG.
 * Proves webhook/gateway-driven money events now write audit_log rows:
 *   charge.success  -> payment.confirmed        (markPaid)
 *   charge.failed   -> payment.failed           (markPaymentFailed)
 *   refund.processed-> payment.refunded_webhook (applyRefund)
 * All emitted with actorType='system'. Run ON the dev host with node22 + the service env file sourced.
 */
import pg from 'pg';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Load the service env the way systemd EnvironmentFile does (literal KEY=VALUE, no shell) so `source`
// doesn't choke on unquoted values like `EMAIL_FROM=TripKoach <bookings@...>`.
for (const line of readFileSync('/etc/tripkoach/tripkoach-v2-dev.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const BASE = 'http://127.0.0.1:3020/api/v1';
const KEY = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.TRIPKOACH_PAYSTACK_WEBHOOK_SECRET
         || process.env.PAYSTACK_SECRET_KEY || process.env.TRIPKOACH_PAYSTACK_SECRET_KEY;
if (!KEY) { console.error('no signing key in env'); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

const sign = (body) => createHmac('sha512', KEY).update(body).digest('hex');
async function webhook(obj) {
  const body = JSON.stringify(obj);
  const r = await fetch(`${BASE}/payments/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(body) }, body });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function post(path, obj) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function auditRows(action, targetId) {
  const r = await pool.query(
    `SELECT actor_type, actor_id, action, target_type, target_id, after FROM audit_log
      WHERE action=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT 1`, [action, targetId]);
  return r.rows[0] ?? null;
}
const mkBooking = (dep) => ({
  tourSlug: dep.tour_slug, departureId: dep.departure_id, partySize: 1, agreedTerms: true,
  travellers: [{ name: 'TRI-1062 QA', email: 'qa-bot@tripkoach.dev', isLead: true }],
});

let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); ok ? pass++ : fail++; };

try {
  const dep = (await pool.query(
    `SELECT d.id AS departure_id, t.slug AS tour_slug FROM departure d JOIN tour t ON t.id=d.tour_id
      WHERE d.status='scheduled' AND t.published AND d.seats_reserved + 3 <= d.seats_total
      ORDER BY d.date_label LIMIT 1`)).rows[0];
  if (!dep) throw new Error('no bookable departure found');
  console.log('departure:', dep);

  // ── charge.success -> payment.confirmed ──────────────────────────────────────
  const b1 = await post('/bookings', mkBooking(dep));
  const ref1 = b1.json?.ref; check('create booking #1', b1.status === 201 && !!ref1, `ref=${ref1}`);
  const init1 = await post(`/bookings/${ref1}/payment/init`, {});
  const pref1 = init1.json?.reference; check('init payment #1', init1.status === 200 && !!pref1, `payRef=${pref1}`);
  const w1 = await webhook({ event: 'charge.success', data: { id: `e2e-succ-${pref1}`, reference: pref1, amount: 500000, currency: 'GHS', status: 'success' } });
  check('webhook charge.success accepted', w1.status === 200 && w1.json?.received === true, JSON.stringify(w1.json));
  const a1 = await auditRows('payment.confirmed', pref1);
  check('audit payment.confirmed written', !!a1, a1 ? `actor_type=${a1.actor_type} target=${a1.target_id}` : 'MISSING');
  check('  -> actorType=system', a1?.actor_type === 'system');
  check('  -> after has bookingRef+amount', !!a1?.after?.bookingRef && a1?.after?.amountMinor != null, JSON.stringify(a1?.after));
  // idempotent replay must NOT double-write (distinct event id, same charge)
  await webhook({ event: 'charge.success', data: { id: `e2e-succ2-${pref1}`, reference: pref1, amount: 500000, currency: 'GHS', status: 'success' } });
  const dupCount = (await pool.query(`SELECT count(*)::int n FROM audit_log WHERE action='payment.confirmed' AND target_id=$1`, [pref1])).rows[0].n;
  check('  -> idempotent (no double confirm audit)', dupCount === 1, `count=${dupCount}`);

  // ── refund.processed -> payment.refunded_webhook ─────────────────────────────
  const w2 = await webhook({ event: 'refund.processed', data: { id: `e2e-rfn-${pref1}`, transaction_reference: pref1, amount: 500000, currency: 'GHS', status: 'processed' } });
  check('webhook refund.processed accepted', w2.status === 200, JSON.stringify(w2.json));
  const a2 = await auditRows('payment.refunded_webhook', pref1);
  check('audit payment.refunded_webhook written', !!a2, a2 ? `actor_type=${a2.actor_type}` : 'MISSING');
  check('  -> actorType=system', a2?.actor_type === 'system');
  check('  -> after negative amount', a2?.after?.amountMinor < 0, JSON.stringify(a2?.after));

  // ── charge.failed -> payment.failed (fresh booking) ──────────────────────────
  const b2 = await post('/bookings', mkBooking(dep));
  const ref2 = b2.json?.ref; check('create booking #2', b2.status === 201 && !!ref2, ref2 ? `ref=${ref2}` : JSON.stringify(b2));
  const init2 = await post(`/bookings/${ref2}/payment/init`, {});
  const pref2 = init2.json?.reference; check('init payment #2', init2.status === 200 && !!pref2, `payRef=${pref2}`);
  const w3 = await webhook({ event: 'charge.failed', data: { id: `e2e-fail-${pref2}`, reference: pref2, amount: 500000, currency: 'GHS', status: 'failed' } });
  check('webhook charge.failed accepted', w3.status === 200, JSON.stringify(w3.json));
  const a3 = await auditRows('payment.failed', pref2);
  check('audit payment.failed written', !!a3, a3 ? `actor_type=${a3.actor_type}` : 'MISSING');
  check('  -> actorType=system', a3?.actor_type === 'system');

  console.log(`\n=== TRI-1062 E2E: ${pass} passed, ${fail} failed ===`);
} catch (e) {
  console.error('E2E ERROR:', e);
  fail++;
} finally {
  await pool.end();
  process.exit(fail ? 1 : 0);
}
