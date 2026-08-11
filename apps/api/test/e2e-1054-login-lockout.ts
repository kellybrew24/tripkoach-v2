// TRI-1054 [SEC-H2] E2E: admin login brute-force protection — per-account lockout (5 failed attempts
// → 15 min lock) + per-IP @fastify/rate-limit (5 / 15 min). In-process PGlite + Fastify inject,
// mirroring test/smoke.ts's harness. The lockout half runs under env:test (rate limit off so we can
// drive the counter); the rate-limit half runs under a non-test env so the route opts into the limiter.
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { hashPassword, LOGIN_MAX_ATTEMPTS } from '../src/auth.ts';
import { buildServer } from '../src/server.ts';

const base = loadConfig();
const cfg = { ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'test' as const, mfaEnforcedRoles: [] };
const db = await createDb(cfg);
await migrate(db);

// Seed one active staff user with a known password (no MFA → plain-session login path).
const PASSWORD = 'Correct-Horse-9!';
await db.query(
  `INSERT INTO staff_user (email, password_hash, name, role, status)
   VALUES ($1, $2, 'Lock Test', 'operator', 'active')`,
  ['lock@tripkoach.com', await hashPassword(PASSWORD)],
);

const app = buildServer(db, cfg);
await app.ready();

let passed = 0;
const ok = (name: string, cond: boolean, detail = '') => { assert.ok(cond, `${name} ${detail}`); passed++; console.log(`  ✓ ${name}`); };

const login = async (a: any, email: string, password: string) => {
  const res = await a.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { email, password } });
  let body: any = null; try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};
const countRow = async (email: string) =>
  (await db.query(`SELECT failed_login_count, locked_until FROM staff_user WHERE email = $1`, [email])).rows[0] as any;

// ── 1. Account lockout (env:test — IP rate limit is off) ─────────────────────
console.log('[lockout]');
// The first (LOGIN_MAX_ATTEMPTS - 1) bad attempts return the generic 401 and bump the counter.
for (let i = 1; i < LOGIN_MAX_ATTEMPTS; i++) {
  const r = await login(app, 'lock@tripkoach.com', 'wrong');
  ok(`bad attempt ${i} → 401 invalid_credentials`, r.status === 401 && r.body?.error?.code === 'invalid_credentials', JSON.stringify(r.body));
  ok(`counter == ${i}`, (await countRow('lock@tripkoach.com')).failed_login_count === i);
}
// The LOGIN_MAX_ATTEMPTS-th failure locks the account.
const locking = await login(app, 'lock@tripkoach.com', 'wrong');
ok('threshold attempt → 429 account_locked', locking.status === 429 && locking.body?.error?.code === 'account_locked', JSON.stringify(locking.body));
const lockedRow = await countRow('lock@tripkoach.com');
ok('locked_until stamped in the future', !!lockedRow.locked_until && new Date(lockedRow.locked_until).getTime() > Date.now());

// While locked, even the CORRECT password is rejected (short-circuits before argon2 verify).
const whileLocked = await login(app, 'lock@tripkoach.com', PASSWORD);
ok('correct password while locked → 429 account_locked', whileLocked.status === 429 && whileLocked.body?.error?.code === 'account_locked', JSON.stringify(whileLocked.body));

// A staff.login_locked audit row was written for the rejected correct-password attempt.
const lockedAudits = (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'staff.login_locked'`)).rows[0] as any;
ok('staff.login_locked audit recorded', lockedAudits.n >= 1, `got ${lockedAudits.n}`);

// ── 2. Lock expiry → fresh window, then success clears the counter ───────────
console.log('[expiry + reset]');
// Simulate the lock elapsing by back-dating locked_until; the next failed attempt resets to 1.
await db.query(`UPDATE staff_user SET locked_until = now() - interval '1 minute' WHERE email = $1`, ['lock@tripkoach.com']);
const afterExpiryBad = await login(app, 'lock@tripkoach.com', 'wrong');
ok('post-expiry bad attempt → 401 (fresh window)', afterExpiryBad.status === 401 && afterExpiryBad.body?.error?.code === 'invalid_credentials', JSON.stringify(afterExpiryBad.body));
ok('counter reset to 1 after stale lock', (await countRow('lock@tripkoach.com')).failed_login_count === 1);

const good = await login(app, 'lock@tripkoach.com', PASSWORD);
ok('correct password → 200 with permissions', good.status === 200 && Array.isArray(good.body?.permissions), JSON.stringify(good.body));
const cleared = await countRow('lock@tripkoach.com');
ok('success clears counter + lock', cleared.failed_login_count === 0 && cleared.locked_until == null);

await app.close();

// ── 3. Per-IP rate limit (non-test env → route opts into @fastify/rate-limit) ─
console.log('[rate limit]');
const appRl = buildServer(db, { ...cfg, env: 'dev', logger: false } as any);
await appRl.ready();
// Hit the login route 5× with a nonexistent email (never creates a lockable row); the 6th call is
// blocked by the IP limiter BEFORE reaching the handler → 429 rate_limited, distinct from a lockout.
let last: any = null;
for (let i = 1; i <= 5; i++) last = await login(appRl, 'ghost@tripkoach.com', 'nope');
ok('5th attempt still reaches handler → 401', last.status === 401 && last.body?.error?.code === 'invalid_credentials', JSON.stringify(last?.body));
const sixth = await login(appRl, 'ghost@tripkoach.com', 'nope');
ok('6th attempt → 429 rate_limited (IP throttle)', sixth.status === 429 && sixth.body?.error?.code === 'rate_limited', JSON.stringify(sixth.body));
await appRl.close();

console.log(`\nTRI-1054 E2E: ${passed}/${passed} checks passed`);
process.exit(0);
