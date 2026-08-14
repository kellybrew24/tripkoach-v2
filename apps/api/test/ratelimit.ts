// TRI-1173 · Standalone regression guard for the consumer per-IP auth throttle (TRI-1055 SEC-H3).
//
// WHY THIS IS ITS OWN FILE
//   The control silently drifted out of production: server.ts lost the `@fastify/rate-limit`
//   registration + `trustProxy`, so the route-level `config.rateLimit` on the consumer /auth/* routes
//   was inert and NO 429 ever fired (TRI-1160 H-1, caught by scripts/security-smoke.sh on 2026-08-14).
//   This test boots the REAL buildServer() with a low limit and proves the login route trips a 429
//   after `authRateLimitMax` bad attempts from one IP, returning the clean rate_limited envelope
//   (not a 500 — the consumer error handler must pass the 429 through). Self-contained (own pglite),
//   so it stays green independent of the broader smoke suite.
//
// Run: npm run smoke:ratelimit   (no Docker / external Postgres needed)

import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { buildServer } from '../src/server.ts';

let passed = 0;
function ok(name: string, cond: boolean, detail = '') {
  assert.ok(cond, `${name} ${detail}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

const base = loadConfig();
const RL_MAX = 3;
const cfg = {
  ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'test' as const,
  consumer: { ...base.consumer, authRateLimitMax: RL_MAX, authRateLimitWindow: '1 minute' },
};
const db = await createDb(cfg);
await migrate(db);
const app = buildServer(db, cfg);
await app.ready();

const hit = async () => app.inject({
  method: 'POST', url: '/api/v1/auth/login',
  headers: { 'content-type': 'application/json' },
  // Junk credentials against a non-existent account → 401 until the per-IP limiter trips.
  payload: JSON.stringify({ email: 'throttle-probe@tripkoach.invalid', password: 'nope' }),
});

const codes: number[] = [];
let limited: Awaited<ReturnType<typeof hit>> | null = null;
for (let i = 0; i < RL_MAX + 1; i++) {
  const res = await hit();
  codes.push(res.statusCode);
  if (res.statusCode === 429) { limited = res; break; }
}
console.log(`  codes: ${codes.join(' ')}`);

ok(`first ${RL_MAX} attempts are 401 (not throttled yet)`, codes.slice(0, RL_MAX).every((c) => c === 401), codes.join(' '));
ok('attempt past the limit → 429 (per-IP throttle active)', limited?.statusCode === 429, codes.join(' '));
let body: any; try { body = limited?.json(); } catch { body = limited?.body; }
ok('429 returns the rate_limited error envelope (not a 500)', body?.error?.code === 'rate_limited', JSON.stringify(body).slice(0, 120));

await app.close();
await db.close();
console.log(`\n✅ ratelimit regression passed — ${passed} assertions`);
