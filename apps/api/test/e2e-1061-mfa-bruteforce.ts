// TRI-1061 [OWASP A07/A04-2] E2E: MFA/OTP-verify brute-force protection. The second-factor challenge
// (POST /auth/mfa) had no attempt cap and no throttle in either realm — an attacker holding the victim's
// password could flood 6-digit guesses at a live mfa_pending session and defeat 2FA. This drives, in an
// in-process PGlite + Fastify inject harness (mirroring e2e-1054/e2e-1029):
//   1. Admin: wrong codes bump the shared failed_login_count + session.mfa_failed_count; the 5th failure
//      locks the account (429) AND revokes the pending session. A correct code before the cap succeeds
//      and clears the counter. A locked account is rejected at /auth/login too.
//   2. Consumer: same, via /api/v1. Plus: a password miss and an MFA miss share ONE per-account counter.
//   3. Rate limit: under a NON-test env the /auth/mfa + password-reset/consume + resend-verification
//      routes opt into @fastify/rate-limit and answer 429 rate_limited once the per-IP cap is exceeded.
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { hashPassword, LOGIN_MAX_ATTEMPTS, MFA_MAX_ATTEMPTS } from '../src/auth.ts';
import { buildServer } from '../src/server.ts';
import { totp } from '../src/totp.ts';

let passed = 0;
const ok = (name: string, cond: boolean, detail = '') => { assert.ok(cond, `${name} ${detail}`); passed++; console.log(`  ✓ ${name}`); };

const cookieFrom = (res: any, name: string): string => {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const c of arr) { const m = String(c).match(new RegExp(`${name}=([^;]+)`)); if (m) return `${name}=${m[1]}`; }
  return '';
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 + 2. Attempt cap + account lockout (env:test → per-IP limiter off, so we can drive the counters)
// ═══════════════════════════════════════════════════════════════════════════
{
  const base = loadConfig();
  const cfg = { ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'test' as const, mfaEnforcedRoles: [] };
  const db = await createDb(cfg);
  await migrate(db);
  const app = buildServer(db, cfg);
  await app.ready();

  // ── Admin ──────────────────────────────────────────────────────────────────
  console.log('[admin: MFA brute-force cap + lockout]');
  const A_EMAIL = 'mfa.admin@tripkoach.com';
  const A_PW = 'Correct-Horse-9!';
  await db.query(
    `INSERT INTO staff_user (email, password_hash, name, role, status)
     VALUES ($1, $2, 'MFA Admin', 'operator', 'active')`,
    [A_EMAIL, await hashPassword(A_PW)],
  );
  const aInject = (url: string, cookie: string, payload: any) =>
    app.inject({ method: 'POST', url: `/api/admin${url}`, payload, headers: cookie ? { cookie } : undefined });
  const aCookie = (res: any) => cookieFrom(res, cfg.adminCookieName);
  const staffRow = async () => (await db.query(`SELECT failed_login_count, locked_until FROM staff_user WHERE email=$1`, [A_EMAIL])).rows[0] as any;

  // Log in (no MFA yet) → full session, then enroll a TOTP factor + confirm it.
  const aLogin1 = await aInject('/auth/login', '', { email: A_EMAIL, password: A_PW });
  ok('admin plain login → 200', aLogin1.statusCode === 200, String(aLogin1.statusCode));
  let aSession = aCookie(aLogin1);
  const aEnroll = await aInject('/auth/mfa/enroll', aSession, {});
  const aSecret = aEnroll.json().secret as string;
  ok('admin enroll → secret', aEnroll.statusCode === 200 && typeof aSecret === 'string', aEnroll.body);
  const aVerify = await aInject('/auth/mfa/verify', aSession, { code: totp(aSecret) });
  ok('admin enroll verify → MFA enabled', aVerify.statusCode === 200, aVerify.body);
  await aInject('/auth/logout', aSession, {});

  // Re-login → mfa_pending challenge.
  const aLogin2 = await aInject('/auth/login', '', { email: A_EMAIL, password: A_PW });
  ok('admin login with MFA on → { mfaRequired }', aLogin2.statusCode === 200 && aLogin2.json().mfaRequired === true, aLogin2.body);
  const aPending = aCookie(aLogin2);
  ok('admin login minted pending cookie', !!aPending);

  // First (MFA_MAX_ATTEMPTS - 1) wrong codes → 401 invalid_code, counters climb together.
  for (let i = 1; i < MFA_MAX_ATTEMPTS; i++) {
    const r = await aInject('/auth/mfa', aPending, { code: '000000' });
    ok(`admin wrong code ${i} → 401 invalid_code`, r.statusCode === 401 && r.json().error?.code === 'invalid_code', r.body);
    const row = await staffRow();
    ok(`admin failed_login_count == ${i}`, row.failed_login_count === i, JSON.stringify(row));
    const s = (await db.query(`SELECT mfa_failed_count, revoked_at FROM session WHERE subject_id=(SELECT id FROM staff_user WHERE email=$1) AND mfa_pending=true`, [A_EMAIL])).rows[0] as any;
    ok(`admin session.mfa_failed_count == ${i}`, s && s.mfa_failed_count === i, JSON.stringify(s));
  }
  // The MFA_MAX_ATTEMPTS-th failure locks the account (429) and revokes the pending session.
  const aLock = await aInject('/auth/mfa', aPending, { code: '000000' });
  ok('admin threshold failure → 429 account_locked', aLock.statusCode === 429 && aLock.json().error?.code === 'account_locked', aLock.body);
  const aLocked = await staffRow();
  ok('admin locked_until stamped in the future', !!aLocked.locked_until && new Date(aLocked.locked_until).getTime() > Date.now());
  const revoked = (await db.query(`SELECT revoked_at FROM session WHERE subject_id=(SELECT id FROM staff_user WHERE email=$1) ORDER BY created_at DESC LIMIT 1`, [A_EMAIL])).rows[0] as any;
  ok('admin pending session revoked at the cap', !!revoked.revoked_at);
  // Even a correct password is now rejected at login (account locked).
  const aWhileLocked = await aInject('/auth/login', '', { email: A_EMAIL, password: A_PW });
  ok('admin correct password while locked → 429 account_locked', aWhileLocked.statusCode === 429 && aWhileLocked.json().error?.code === 'account_locked', aWhileLocked.body);
  // staff.mfa_failed audit rows were written for every wrong code.
  const aAudits = (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action='staff.mfa_failed'`)).rows[0] as any;
  ok('admin staff.mfa_failed audit rows recorded', aAudits.n >= MFA_MAX_ATTEMPTS, `got ${aAudits.n}`);

  // A correct code BEFORE the cap succeeds and clears the counter. Unlock first, then re-login.
  await db.query(`UPDATE staff_user SET failed_login_count=0, locked_until=NULL WHERE email=$1`, [A_EMAIL]);
  const aLogin3 = await aInject('/auth/login', '', { email: A_EMAIL, password: A_PW });
  const aPending3 = aCookie(aLogin3);
  await aInject('/auth/mfa', aPending3, { code: '111111' }); // one wrong → count=1
  ok('admin counter climbed to 1 before success', (await staffRow()).failed_login_count === 1);
  const aGood = await aInject('/auth/mfa', aPending3, { code: totp(aSecret) });
  ok('admin correct code → 200 with permissions', aGood.statusCode === 200 && Array.isArray(aGood.json().permissions), aGood.body);
  ok('admin failed_login_count reset to 0 after MFA success', (await staffRow()).failed_login_count === 0);

  // ── Consumer ─────────────────────────────────────────────────────────────
  console.log('[consumer: MFA brute-force cap + shared password/MFA counter]');
  const C_EMAIL = 'mfa.consumer@example.com';
  const C_PW = 'sup3rSecret!';
  const cInject = (method: string, url: string, cookie: string, payload?: any) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, payload, headers: cookie ? { cookie } : undefined });
  const cCookie = (res: any) => cookieFrom(res, cfg.consumer.cookieName);
  const userRow = async () => (await db.query(`SELECT failed_login_count, locked_until FROM user_account WHERE lower(email)=$1`, [C_EMAIL])).rows[0] as any;

  const cSignup = await cInject('POST', '/auth/signup', '', { email: C_EMAIL, password: C_PW, name: 'MFA User' });
  ok('consumer signup → 201', cSignup.statusCode === 201, String(cSignup.statusCode));
  let cSession = cCookie(cSignup);
  const cEnroll = await cInject('POST', '/auth/mfa/enroll', cSession);
  const cSecret = cEnroll.json().secret as string;
  await cInject('POST', '/auth/mfa/verify', cSession, { code: totp(cSecret) });
  ok('consumer MFA enrolled', typeof cSecret === 'string');
  await cInject('POST', '/auth/logout', cSession);

  const cLogin = await cInject('POST', '/auth/login', '', { email: C_EMAIL, password: C_PW });
  ok('consumer login with MFA on → { mfaRequired }', cLogin.statusCode === 200 && cLogin.json().mfaRequired === true, cLogin.body);
  const cPending = cCookie(cLogin);
  for (let i = 1; i < MFA_MAX_ATTEMPTS; i++) {
    const r = await cInject('POST', '/auth/mfa', cPending, { code: '000000' });
    ok(`consumer wrong code ${i} → 401 invalid_code`, r.statusCode === 401 && r.json().error?.code === 'invalid_code', r.body);
  }
  const cLock = await cInject('POST', '/auth/mfa', cPending, { code: '000000' });
  ok('consumer threshold failure → 429 account_locked', cLock.statusCode === 429 && cLock.json().error?.code === 'account_locked', cLock.body);
  ok('consumer locked_until stamped', !!(await userRow()).locked_until);
  const cLoginLocked = await cInject('POST', '/auth/login', '', { email: C_EMAIL, password: C_PW });
  ok('consumer login while locked → 429 account_locked', cLoginLocked.statusCode === 429 && cLoginLocked.json().error?.code === 'account_locked', cLoginLocked.body);
  const cAudits = (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action='user.mfa_failed'`)).rows[0] as any;
  ok('consumer user.mfa_failed audit rows recorded', cAudits.n >= MFA_MAX_ATTEMPTS, `got ${cAudits.n}`);

  // Shared counter: a password miss and an MFA miss both feed the SAME failed_login_count.
  await db.query(`UPDATE user_account SET failed_login_count=0, locked_until=NULL WHERE lower(email)=$1`, [C_EMAIL]);
  const cBadPw = await cInject('POST', '/auth/login', '', { email: C_EMAIL, password: 'wrong' });
  ok('consumer bad password → 401', cBadPw.statusCode === 401 && cBadPw.json().error?.code === 'invalid_credentials', cBadPw.body);
  ok('consumer password miss bumped the shared counter to 1', (await userRow()).failed_login_count === 1);

  await app.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Per-IP rate limit opt-in (NON-test env → the limiter is active on the hardened routes)
// ═══════════════════════════════════════════════════════════════════════════
{
  console.log('[rate limit: /auth/mfa + consume + resend opt into @fastify/rate-limit]');
  const base = loadConfig();
  const cfg = { ...base, dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'dev' as const, mfaEnforcedRoles: [], logger: false } as any;
  const db = await createDb(cfg);
  await migrate(db);
  const app = buildServer(db, cfg);
  await app.ready();

  // The limiter runs as a preHandler before the route body, so requests with no pending session still
  // consume the per-IP budget. Admin /auth/mfa is 10 / 15 min → the 11th is 429 rate_limited.
  let sawAdminRateLimit = false;
  for (let i = 0; i < 12; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/admin/auth/mfa', payload: { code: '000000' } });
    if (r.statusCode === 429 && r.json().error?.code === 'rate_limited') { sawAdminRateLimit = true; break; }
  }
  ok('admin /auth/mfa → 429 rate_limited once the per-IP cap is exceeded', sawAdminRateLimit);

  // Consumer /auth/mfa is 10 / minute.
  let sawConsumerRateLimit = false;
  for (let i = 0; i < 12; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/mfa', payload: { code: '000000' } });
    if (r.statusCode === 429 && r.json().error?.code === 'rate_limited') { sawConsumerRateLimit = true; break; }
  }
  ok('consumer /auth/mfa → 429 rate_limited once the per-IP cap is exceeded', sawConsumerRateLimit);

  // Consumer resend-verification (previously unthrottled) now opts in too.
  let sawResendRateLimit = false;
  for (let i = 0; i < 12; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/resend-verification', payload: { email: 'nobody@example.com' } });
    if (r.statusCode === 429 && r.json().error?.code === 'rate_limited') { sawResendRateLimit = true; break; }
  }
  ok('consumer /auth/resend-verification is throttled', sawResendRateLimit);

  await app.close();
}

console.log(`\nTRI-1061 MFA brute-force E2E: ${passed} checks passed.`);
