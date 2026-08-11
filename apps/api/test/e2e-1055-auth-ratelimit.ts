// TRI-1055 [SEC-H3] E2E: per-IP rate limit (10 / minute) on the unauthenticated consumer auth routes —
// POST /api/v1/auth/login, /auth/signup (+ /auth/register alias), /auth/password-reset/request.
// In-process PGlite + Fastify inject, mirroring test/smoke.ts. The limiter is opt-in per route and is
// disabled under env:test (so the smoke suite can hammer these from loopback), so this suite builds the
// server under a non-test env to exercise the throttle. Each route carries its OWN per-IP bucket, so the
// three routes are checked independently in one run without cross-contaminating counters.
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { buildServer } from '../src/server.ts';

const base = loadConfig();
const cfg = { ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'dev' as const, logger: false } as any;
const db = await createDb(cfg);
await migrate(db);

const app = buildServer(db, cfg);
await app.ready();

let passed = 0;
const ok = (name: string, cond: boolean, detail = '') => { assert.ok(cond, `${name} ${detail}`); passed++; console.log(`  ✓ ${name}`); };

const post = async (url: string, payload: any) => {
  const res = await app.inject({ method: 'POST', url, payload });
  let body: any = null; try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};

// A route is limited to 10 / minute per IP. Drive it 10× (each reaching the handler), then assert the
// 11th call is blocked BY the limiter (429 rate_limited) before the handler runs.
const RL_MAX = 10;
const exhaust = async (name: string, url: string, mk: (i: number) => any, expectHandlerStatus: (s: number) => boolean) => {
  let last: any = null;
  for (let i = 1; i <= RL_MAX; i++) last = await post(url, mk(i));
  ok(`${name}: ${RL_MAX}th call still reaches handler`, expectHandlerStatus(last.status), `status=${last.status} ${JSON.stringify(last.body)}`);
  const over = await post(url, mk(RL_MAX + 1));
  ok(`${name}: call ${RL_MAX + 1} → 429 rate_limited`, over.status === 429 && over.body?.error?.code === 'rate_limited', JSON.stringify(over.body));
};

// ── login: bad creds reach the handler → 401 invalid_credentials until the IP limiter trips ──
console.log('[login]');
await exhaust('login', '/api/v1/auth/login',
  (i) => ({ email: `ghost${i}@nope.test`, password: 'nope' }),
  (s) => s === 401);

// ── password-reset request: always 200 (no enumeration) until the IP limiter trips ──
console.log('[password-reset request]');
await exhaust('password-reset', '/api/v1/auth/password-reset/request',
  (i) => ({ email: `ghost${i}@nope.test` }),
  (s) => s === 200);

// ── signup: an invalid payload still reaches (and is rejected by) the handler until the limiter trips.
// Missing required fields → the handler returns a 4xx; the point is the limiter counts these attempts. ──
console.log('[signup]');
await exhaust('signup', '/api/v1/auth/signup',
  (_i) => ({}),
  (s) => s >= 400 && s < 500);

// ── /auth/register is an alias handler but its own route, so it carries an INDEPENDENT bucket: the
// signup exhaustion above must not have consumed register's allowance. ──
console.log('[register alias — independent bucket]');
const reg = await post('/api/v1/auth/register', {});
ok('register alias not throttled by signup exhaustion', reg.status !== 429, `status=${reg.status}`);

await app.close();
console.log(`\nTRI-1055 E2E: ${passed}/${passed} checks passed`);
process.exit(0);
