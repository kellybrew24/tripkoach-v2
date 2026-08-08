#!/usr/bin/env node
/**
 * TRI-912 LIVE E2E against the running dev API (127.0.0.1). Proves the MFA
 * enforcement gate end-to-end with a real factor-less enforced-role account and
 * real RFC-6238 TOTP codes. Creates a throwaway operator account, runs the flow,
 * then deletes it. Run ON the dev host from /opt/tripkoach-v2/apps/api with the
 * dev env sourced:  node --experimental-strip-types /root/live-e2e-912.mjs
 */
import { loadConfig } from "./src/config.ts";
import { createDb } from "./src/db.ts";
import { upsertStaff } from "./src/admin-seed.ts";
import { totp } from "./src/totp.ts";

const cfg = loadConfig();
const db = await createDb(cfg);
const PORT = process.env.PORT || 3020;
const BASE = `http://127.0.0.1:${PORT}/api/admin`;
const EMAIL = "operator-e2e-912@tripkoach.com";
const PW = "Enforce-Me-2026!";
const COOKIE = cfg.adminCookieName;

const results = [];
const ok = (name, cond, detail = "") => results.push([name, !!cond, detail]);

// Minimal cookie jar: capture the admin session cookie from Set-Cookie, resend it.
function jarFrom(res) {
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(new RegExp(COOKIE + "=([^;]+)"));
  return m ? m[1] : null;
}
async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json, cookie: jarFrom(res) };
}

try {
  await upsertStaff(db, { email: EMAIL, password: PW, name: "E2E Operator", role: "operator" });
  // Ensure a clean slate (no leftover factor/session from a prior run).
  await db.query(`UPDATE staff_user SET mfa_enabled=false WHERE lower(email)=lower($1)`, [EMAIL]);
  await db.query(`DELETE FROM mfa_factor WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);
  await db.query(`DELETE FROM recovery_code WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);

  // 1. Factor-less enforced-role login → enroll gate (no full session).
  const login1 = await call("POST", "/auth/login", { body: { email: EMAIL, password: PW } });
  ok("factor-less operator login → mfaEnrollmentRequired", login1.status === 200 && login1.body?.mfaEnrollmentRequired === true, JSON.stringify(login1.body));
  ok("gated login exposes no permissions", login1.body?.permissions === undefined);
  const gcookie = login1.cookie;
  ok("gated login set a session cookie", !!gcookie);

  // 2. Gated cookie is blocked from privileged routes + /me until promoted.
  ok("gated cookie → GET /tours 401", (await call("GET", "/tours", { cookie: gcookie })).status === 401);
  ok("gated cookie → GET /me 401", (await call("GET", "/me", { cookie: gcookie })).status === 401);

  // 3. …but can enroll.
  const enroll = await call("POST", "/auth/mfa/enroll", { cookie: gcookie });
  ok("gated cookie → enroll 200 with secret + otpauthUri", enroll.status === 200 && typeof enroll.body?.secret === "string" && /^otpauth:\/\//.test(enroll.body?.otpauthUri || ""), JSON.stringify(enroll.body).slice(0, 120));
  const secret = enroll.body?.secret;
  if (!secret) throw new Error("no secret from enroll — aborting flow (see DEBUG above)");

  // 4. Verify a real TOTP → recovery codes + promotes the session in place.
  const verify = await call("POST", "/auth/mfa/verify", { cookie: gcookie, body: { code: totp(secret) } });
  ok("verify → recovery codes + promoted { staff, permissions }", verify.status === 200
    && Array.isArray(verify.body?.recoveryCodes) && verify.body.recoveryCodes.length > 0
    && verify.body?.staff?.role === "operator" && Array.isArray(verify.body?.permissions), JSON.stringify(verify.body).slice(0, 160));

  // 5. Same cookie now clears strict auth — gate closed.
  ok("promoted cookie → GET /tours 200", (await call("GET", "/tours", { cookie: gcookie })).status === 200);
  ok("promoted cookie → GET /me 200", (await call("GET", "/me", { cookie: gcookie })).status === 200);

  // 6. A now-enrolled login uses the normal 2FA challenge, not the enroll gate.
  const login2 = await call("POST", "/auth/login", { body: { email: EMAIL, password: PW } });
  ok("enrolled login → mfaRequired (challenge, not enroll)", login2.status === 200 && login2.body?.mfaRequired === true && !login2.body?.mfaEnrollmentRequired, JSON.stringify(login2.body));

  // 7. Complete that challenge with a fresh TOTP → full session.
  const chal = await call("POST", "/auth/mfa", { cookie: login2.cookie, body: { code: totp(secret) } });
  ok("challenge TOTP → full session { staff, permissions }", chal.status === 200 && chal.body?.staff?.role === "operator" && Array.isArray(chal.body?.permissions), JSON.stringify(chal.body).slice(0, 120));
} finally {
  await db.query(`DELETE FROM staff_user WHERE lower(email)=lower($1)`, [EMAIL]);
  await db.close?.();
}

let allOk = true;
for (const [name, pass, detail] of results) { if (!pass) allOk = false; console.log(`  [live-e2e] ${pass ? "PASS" : "FAIL"} — ${name}${pass ? "" : "  " + detail}`); }
console.log(`\n== TRI-912 LIVE E2E (dev API): ${allOk ? "ALL PASS" : "FAIL"} — ${results.filter((r) => r[1]).length}/${results.length} ==`);
process.exit(allOk ? 0 : 1);
