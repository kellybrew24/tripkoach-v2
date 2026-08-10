// TRI-1015 E2E: POST /api/v1/enquiries persists the lead + queues an ops notification, and rejects
// bad input. In-process PGlite + Fastify inject (no network), mirroring test/smoke.ts's harness.
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { buildServer } from '../src/server.ts';

const base = loadConfig();
const cfg = {
  ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'test',
  // From set but no API key → transport DISABLED: sends render + log a 'skipped' send-log row, no network.
  email: { ...base.email, from: 'TripKoach <bookings@send.tripkoach.com>', apiKey: undefined, dryRun: false },
};
const db = await createDb(cfg);
await migrate(db);
const app = buildServer(db, cfg);
await app.ready();

let passed = 0;
const ok = (name: string, cond: boolean, detail = '') => { assert.ok(cond, `${name} ${detail}`); passed++; console.log(`  ✓ ${name}`); };

const post = async (payload: any) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/enquiries', payload });
  let body: any = null; try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};

// 1. Contact enquiry — happy path.
const c = await post({
  type: 'contact', subject: 'plan', name: 'Ama Mensah', email: 'ama@example.com',
  phone: '+233 24 123 4567', message: 'Family of 4, Cape Coast in December.', consent: true,
});
ok('contact returns 201 + id', c.status === 201 && typeof c.body?.id === 'string', JSON.stringify(c.body));

const crow = (await db.query(
  `SELECT type, subject, name, email, phone, consent, payload FROM enquiry WHERE id = $1`, [c.body.id])).rows[0] as any;
ok('contact row persisted', !!crow);
ok('contact type/email/subject stored', crow.type === 'contact' && crow.email === 'ama@example.com' && crow.subject === 'plan');
ok('contact consent + message in payload', crow.consent === true && crow.payload?.message?.includes('Cape Coast'));

// 2. Pickup enquiry — structured payload.
const p = await post({
  type: 'pickup', name: 'John Doe', email: 'john@example.com', consent: true,
  payload: { arrivalDate: '2026-09-01', arrivalTime: '14:30', flightNumber: 'KP 052',
             partySize: '2', dropoff: 'East Legon, Accra', specialRequests: 'Child seat' },
});
ok('pickup returns 201', p.status === 201 && !!p.body?.id, JSON.stringify(p.body));
const prow = (await db.query(`SELECT type, payload FROM enquiry WHERE id = $1`, [p.body.id])).rows[0] as any;
ok('pickup flight/party/dropoff persisted in payload',
  prow.payload?.flightNumber === 'KP 052' && prow.payload?.partySize === '2' && prow.payload?.dropoff === 'East Legon, Accra');

// 3. Ops notification queued (rendered + logged 'skipped' since transport is disabled).
const mail = (await db.query(
  `SELECT to_email, reply_to, subject, template, status, related_type, related_id
     FROM email_message WHERE template = 'enquiry_received' ORDER BY created_at`)).rows as any[];
ok('two enquiry_received emails logged', mail.length === 2, `got ${mail.length}`);
ok('notify reply_to = customer email', mail[0].reply_to === 'ama@example.com' && mail[1].reply_to === 'john@example.com');
ok('notify related to the enquiry row', mail[0].related_type === 'enquiry' && mail[0].related_id === c.body.id);
ok('notify subject renders label', mail[1].subject === 'New airport-pickup request — john@example.com', mail[1].subject);
ok('notify skipped (no network in test)', mail.every((m) => m.status === 'skipped'));

// 4. Validation — bad email → 422, nothing stored.
const badEmail = await post({ type: 'contact', email: 'not-an-email', consent: true });
ok('bad email → 422', badEmail.status === 422 && badEmail.body?.error?.code === 'validation', JSON.stringify(badEmail.body));

// 5. Validation — unknown type → 422.
const badType = await post({ type: 'spam', email: 'x@y.com', consent: true });
ok('unknown type → 422', badType.status === 422, JSON.stringify(badType.body));

// 6. Only the two valid leads exist; the invalid ones wrote no rows.
const count = (await db.query(`SELECT count(*)::int AS n FROM enquiry`)).rows[0] as any;
ok('exactly 2 enquiry rows persisted', count.n === 2, `got ${count.n}`);

console.log(`\nTRI-1015 E2E: ${passed}/${passed} checks passed`);
await app.close();
process.exit(0);
