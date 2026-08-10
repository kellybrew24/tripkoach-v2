// TRI-1029 E2E: consumer two-factor (TOTP). Enrollment (secret → verify → recovery codes), the login
// challenge gate (mfa_pending session resolves to no context until the second factor clears), recovery-
// code single-use, and disable. In-process PGlite + Fastify inject (no network), mirroring
// test/e2e-1018-interest.ts.
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { seed } from '../src/seed.ts';
import { buildServer } from '../src/server.ts';
import { totp } from '../src/totp.ts';

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

const COOKIE = cfg.consumer.cookieName;
function cookieOf(res: any): string {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const c of arr) { const m = String(c).match(new RegExp(`${COOKIE}=([^;]+)`)); if (m) return `${COOKIE}=${m[1]}`; }
  return '';
}
const req = (method: string, url: string, opts: { cookie?: string; payload?: any } = {}) =>
  app.inject({ method: method as any, url, payload: opts.payload,
    headers: opts.cookie ? { cookie: opts.cookie } : undefined });

const EMAIL = 'mfa.tester@example.com';
const PW = 'sup3rSecret!';

// ── Signup → full session ─────────────────────────────────────────────────
const su = await req('POST', '/api/v1/auth/signup', { payload: { email: EMAIL, password: PW, name: 'MFA Tester' } });
ok('signup → 201', su.statusCode === 201, String(su.statusCode));
let cookie = cookieOf(su);
ok('signup set a session cookie', !!cookie);

// status starts disabled
let st = await req('GET', '/api/v1/auth/mfa/status', { cookie });
ok('status enabled=false initially', st.statusCode === 200 && st.json().enabled === false, st.body);

// ── Enroll → verify with a live TOTP → recovery codes ─────────────────────
const en = await req('POST', '/api/v1/auth/mfa/enroll', { cookie });
const enB = en.json();
ok('enroll → secret + otpauth + issuer', en.statusCode === 200 && typeof enB.secret === 'string' && /^otpauth:\/\/totp\//.test(enB.otpauthUri) && enB.issuer === 'TripKoach', JSON.stringify(enB));

// wrong code → 400 validation, still not enabled
const badVerify = await req('POST', '/api/v1/auth/mfa/verify', { cookie, payload: { code: '000000' } });
ok('verify wrong code → 400', badVerify.statusCode === 400 && badVerify.json().error?.field === 'code', badVerify.body);
st = await req('GET', '/api/v1/auth/mfa/status', { cookie });
ok('still disabled after bad verify', st.json().enabled === false);

const goodVerify = await req('POST', '/api/v1/auth/mfa/verify', { cookie, payload: { code: totp(enB.secret) } });
const gv = goodVerify.json();
ok('verify live code → enabled + 10 recovery codes', goodVerify.statusCode === 200 && gv.enabled === true && Array.isArray(gv.recoveryCodes) && gv.recoveryCodes.length === 10, JSON.stringify(gv).slice(0, 120));
const recoveryCodes: string[] = gv.recoveryCodes;

// profile reflects it
const me1 = await req('GET', '/api/v1/me', { cookie });
ok('/me twoFactorEnabled=true', me1.statusCode === 200 && me1.json().user?.twoFactorEnabled === true, me1.body);

// re-enroll while enabled → 409
const reEnroll = await req('POST', '/api/v1/auth/mfa/enroll', { cookie });
ok('enroll while enabled → 409', reEnroll.statusCode === 409, String(reEnroll.statusCode));

// ── Login now requires the second factor ──────────────────────────────────
await req('POST', '/api/v1/auth/logout', { cookie });
const login1 = await req('POST', '/api/v1/auth/login', { payload: { email: EMAIL, password: PW } });
ok('login with 2FA on → { mfaRequired } (no user)', login1.statusCode === 200 && login1.json().mfaRequired === true && !login1.json().user, login1.body);
const pendingCookie = cookieOf(login1);
ok('login minted a pending session cookie', !!pendingCookie);

// the half-auth session cannot reach /me
const meGated = await req('GET', '/api/v1/me', { cookie: pendingCookie });
ok('pending session is gated (401 on /me)', meGated.statusCode === 401, String(meGated.statusCode));

// wrong challenge code → 401, session still pending
const chBad = await req('POST', '/api/v1/auth/mfa', { cookie: pendingCookie, payload: { code: '111111' } });
ok('challenge wrong code → 401', chBad.statusCode === 401 && chBad.json().error?.code === 'invalid_code', chBad.body);

// correct TOTP → completes login
const chOk = await req('POST', '/api/v1/auth/mfa', { cookie: pendingCookie, payload: { code: totp(enB.secret) } });
ok('challenge TOTP → { user }', chOk.statusCode === 200 && chOk.json().user?.email === EMAIL, chOk.body.slice(0, 120));
const fullCookie = cookieOf(chOk) || pendingCookie; // same session id, now cleared of mfa_pending
const meNow = await req('GET', '/api/v1/me', { cookie: fullCookie });
ok('session now resolves /me after challenge', meNow.statusCode === 200 && meNow.json().user?.email === EMAIL, String(meNow.statusCode));

// ── Recovery code path: single-use ────────────────────────────────────────
await req('POST', '/api/v1/auth/logout', { cookie: fullCookie });
const login2 = await req('POST', '/api/v1/auth/login', { payload: { email: EMAIL, password: PW } });
const pend2 = cookieOf(login2);
const rc = recoveryCodes[0];
const chRc = await req('POST', '/api/v1/auth/mfa', { cookie: pend2, payload: { code: rc } });
ok('challenge with recovery code → success', chRc.statusCode === 200 && chRc.json().user?.email === EMAIL, String(chRc.statusCode));

// reuse the SAME recovery code → rejected (consumed)
await req('POST', '/api/v1/auth/logout', { cookie: pend2 });
const login3 = await req('POST', '/api/v1/auth/login', { payload: { email: EMAIL, password: PW } });
const pend3 = cookieOf(login3);
const chReuse = await req('POST', '/api/v1/auth/mfa', { cookie: pend3, payload: { code: rc } });
ok('reused recovery code → 401', chReuse.statusCode === 401, String(chReuse.statusCode));
// but a fresh recovery code still works
const chRc2 = await req('POST', '/api/v1/auth/mfa', { cookie: pend3, payload: { code: recoveryCodes[1] } });
ok('second recovery code still valid', chRc2.statusCode === 200 && chRc2.json().user?.email === EMAIL, String(chRc2.statusCode));
const c2 = cookieOf(chRc2) || pend3;

// ── Disable requires a code, then login is direct again ───────────────────
const disBad = await req('POST', '/api/v1/auth/mfa/disable', { cookie: c2, payload: { code: '222222' } });
ok('disable wrong code → 400', disBad.statusCode === 400, String(disBad.statusCode));
const dis = await req('POST', '/api/v1/auth/mfa/disable', { cookie: c2, payload: { code: totp(enB.secret) } });
ok('disable with TOTP → enabled:false', dis.statusCode === 200 && dis.json().enabled === false, dis.body);

// factor + recovery rows gone
const factorN = (await db.query<{ n: string }>(`SELECT count(*) n FROM user_mfa_factor WHERE user_id=(SELECT id FROM user_account WHERE email=$1)`, [EMAIL])).rows[0];
const recN = (await db.query<{ n: string }>(`SELECT count(*) n FROM user_recovery_code WHERE user_id=(SELECT id FROM user_account WHERE email=$1)`, [EMAIL])).rows[0];
ok('all factor + recovery rows removed on disable', Number(factorN.n) === 0 && Number(recN.n) === 0, `${factorN.n}/${recN.n}`);

await req('POST', '/api/v1/auth/logout', { cookie: c2 });
const login4 = await req('POST', '/api/v1/auth/login', { payload: { email: EMAIL, password: PW } });
ok('login after disable → full session (no mfaRequired)', login4.statusCode === 200 && !login4.json().mfaRequired && login4.json().user?.email === EMAIL, login4.body);

console.log(`\nTRI-1029 consumer-MFA E2E: ${passed} checks passed`);
await app.close();
process.exit(0);
