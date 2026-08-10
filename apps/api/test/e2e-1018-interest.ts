// TRI-1018 / TRI-999 E2E: POST /api/v1/tours/:id/interest persists a date-interest lead, queues an ops
// notification, is idempotent per (tour,email,intent), and validates input. In-process PGlite + Fastify
// inject (no network), mirroring test/e2e-1015-enquiries.ts.
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { buildServer } from '../src/server.ts';

const base = loadConfig();
const cfg = {
  ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'test',
  email: { ...base.email, from: 'TripKoach <bookings@send.tripkoach.com>', apiKey: undefined, dryRun: false },
};
const db = await createDb(cfg);
await migrate(db);
await seed(db);
const app = buildServer(db, cfg);
await app.ready();

let passed = 0;
const ok = (name: string, cond: boolean, detail = '') => { assert.ok(cond, `${name} ${detail}`); passed++; console.log(`  ✓ ${name}`); };

// A real seeded tour (by id + slug both resolve).
const tour = (await db.query<{ id: string; slug: string; title: string }>(
  `SELECT id, slug, title FROM tour ORDER BY title LIMIT 1`)).rows[0];
assert.ok(tour, 'seed produced at least one tour');

const post = async (idOrSlug: string, payload: any) => {
  const res = await app.inject({ method: 'POST', url: `/api/v1/tours/${encodeURIComponent(idOrSlug)}/interest`, payload });
  let body: any = null; try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};

// 1. Happy path by UUID → 201 created.
const a = await post(tour.id, { intent: 'notify', email: 'traveller@example.com' });
ok('interest by id → 201 created', a.status === 201 && a.body?.created === true && typeof a.body?.id === 'string', JSON.stringify(a.body));

const row = (await db.query<any>(
  `SELECT type, email, subject, consent, payload FROM enquiry WHERE id = $1`, [a.body.id])).rows[0];
ok('row is an interest enquiry', row?.type === 'interest' && row.email === 'traveller@example.com');
ok('payload carries tour + intent', row.payload?.tourId === tour.id && row.payload?.tourSlug === tour.slug
  && row.payload?.tourName === tour.title && row.payload?.intent === 'notify');
ok('subject renders "Notify — <tour>"', row.subject === `Notify when dates open — ${tour.title}`, row.subject);

// 2. Idempotent — same tour/email/intent again → 200, NOT created, same id, no new row.
const dup = await post(tour.slug, { intent: 'notify', email: 'Traveller@Example.com' }); // case-insensitive email
ok('duplicate interest → 200 not created', dup.status === 200 && dup.body?.created === false, JSON.stringify(dup.body));
ok('duplicate returns the same lead id', dup.body?.id === a.body.id, `${dup.body?.id} vs ${a.body.id}`);
const cnt = (await db.query<{ n: string }>(
  `SELECT count(*) AS n FROM enquiry WHERE type='interest' AND payload->>'tourId'=$1`, [tour.id])).rows[0];
ok('still exactly one interest row for this tour', Number(cnt.n) === 1, `got ${cnt.n}`);

// 3. Ops notification queued (rendered + logged 'skipped' — transport disabled), only for the created one.
const mail = (await db.query<any>(
  `SELECT reply_to, template, status, related_id FROM email_message WHERE template='enquiry_received' ORDER BY created_at`)).rows;
ok('one interest notification queued', mail.length === 1 && mail[0].related_id === a.body.id, `got ${mail.length}`);
ok('notify reply_to = customer', mail[0].reply_to === 'traveller@example.com' && mail[0].status === 'skipped');

// 4. Waitlist intent is a distinct lead.
const w = await post(tour.id, { intent: 'waitlist', email: 'traveller@example.com' });
ok('waitlist intent → 201 (separate lead)', w.status === 201 && w.body?.created === true && w.body?.id !== a.body.id);

// 5. Unknown tour → 404.
const nf = await post('00000000-0000-0000-0000-000000000000', { intent: 'notify', email: 'x@y.com' });
ok('unknown tour → 404', nf.status === 404, JSON.stringify(nf.body));

// 6. Bad email → 422, nothing stored.
const be = await post(tour.id, { intent: 'notify', email: 'not-an-email' });
ok('bad email → 422', be.status === 422 && be.body?.error?.code === 'validation', JSON.stringify(be.body));

// 7. Bad intent → 422.
const bi = await post(tour.id, { intent: 'spam', email: 'x@y.com' });
ok('unknown intent → 422', bi.status === 422, JSON.stringify(bi.body));

// 8. Default intent = notify when omitted (but different email → new lead).
const di = await post(tour.id, { email: 'someone-else@example.com' });
ok('omitted intent defaults to notify → 201', di.status === 201 && di.body?.created === true);
const dirow = (await db.query<any>(`SELECT payload FROM enquiry WHERE id=$1`, [di.body.id])).rows[0];
ok('defaulted intent stored as notify', dirow.payload?.intent === 'notify');

console.log(`\n${passed} checks passed`);
await app.close();
await db.close?.();
