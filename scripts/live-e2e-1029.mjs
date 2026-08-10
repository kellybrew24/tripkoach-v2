#!/usr/bin/env node
// TRI-1029 LIVE smoke against dev.tripkoach.com/api/v1 — real HTTPS, real Postgres.
// Creates a throwaway account, enrolls 2FA (computing the TOTP locally from the returned secret),
// exercises the login gate + challenge + recovery code + disable, then deletes the account.
import { totp } from "../apps/api/src/totp.ts";

const BASE = process.env.API_BASE || "https://dev.tripkoach.com/api/v1";
let cookie = "";
let pass = 0;
const ok = (name, cond, detail = "") => { if (!cond) { console.error("FAIL:", name, detail); process.exit(1); } pass++; console.log("  ✓", name); };

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setC = res.headers.get("set-cookie");
  if (setC) { const m = setC.match(/tk_user_session=[^;]+/); if (m) cookie = m[0]; }
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}

const email = `qa-1029-${Date.now()}@tripkoach.dev`;
const PW = "sup3rSecret!29";

const su = await call("POST", "/auth/signup", { email, password: PW, name: "QA 1029" });
ok("signup → 201", su.status === 201, String(su.status));

const st0 = await call("GET", "/auth/mfa/status");
ok("status disabled initially", st0.status === 200 && st0.json.enabled === false, JSON.stringify(st0.json));

const en = await call("POST", "/auth/mfa/enroll");
ok("enroll → secret + otpauth", en.status === 200 && typeof en.json.secret === "string" && /^otpauth:/.test(en.json.otpauthUri) && en.json.issuer === "TripKoach", JSON.stringify(en.json));
const secret = en.json.secret;

const badV = await call("POST", "/auth/mfa/verify", { code: "000000" });
ok("wrong verify → 400", badV.status === 400, String(badV.status));

const v = await call("POST", "/auth/mfa/verify", { code: totp(secret) });
ok("verify → enabled + 10 recovery codes", v.status === 200 && v.json.enabled === true && Array.isArray(v.json.recoveryCodes) && v.json.recoveryCodes.length === 10, JSON.stringify(v.json).slice(0, 100));
const recovery = v.json.recoveryCodes;

const me = await call("GET", "/me");
ok("/me twoFactorEnabled true", me.status === 200 && me.json.user.twoFactorEnabled === true, JSON.stringify(me.json.user?.twoFactorEnabled));

// logout → login now gated
await call("POST", "/auth/logout");
cookie = "";
const login1 = await call("POST", "/auth/login", { email, password: PW });
ok("login with 2FA → { mfaRequired }", login1.status === 200 && login1.json.mfaRequired === true && !login1.json.user, JSON.stringify(login1.json));

const gated = await call("GET", "/me");
ok("pending session gated on /me (401)", gated.status === 401, String(gated.status));

const chBad = await call("POST", "/auth/mfa", { code: "111111" });
ok("challenge wrong code → 401", chBad.status === 401, String(chBad.status));

const ch = await call("POST", "/auth/mfa", { code: totp(secret) });
ok("challenge TOTP → user", ch.status === 200 && ch.json.user?.email === email, JSON.stringify(ch.json).slice(0, 100));

const me2 = await call("GET", "/me");
ok("session resolves /me after challenge", me2.status === 200 && me2.json.user.email === email, String(me2.status));

// recovery-code login single-use
await call("POST", "/auth/logout"); cookie = "";
await call("POST", "/auth/login", { email, password: PW });
const rc = await call("POST", "/auth/mfa", { code: recovery[0] });
ok("recovery-code challenge → success", rc.status === 200 && rc.json.user?.email === email, String(rc.status));
await call("POST", "/auth/logout"); cookie = "";
await call("POST", "/auth/login", { email, password: PW });
const rcReuse = await call("POST", "/auth/mfa", { code: recovery[0] });
ok("reused recovery code → 401", rcReuse.status === 401, String(rcReuse.status));
const rc2 = await call("POST", "/auth/mfa", { code: recovery[1] });
ok("second recovery code valid", rc2.status === 200, String(rc2.status));

// disable → login direct again
const dis = await call("POST", "/auth/mfa/disable", { code: totp(secret) });
ok("disable with TOTP → enabled:false", dis.status === 200 && dis.json.enabled === false, JSON.stringify(dis.json));
await call("POST", "/auth/logout"); cookie = "";
const login4 = await call("POST", "/auth/login", { email, password: PW });
ok("login after disable → full session", login4.status === 200 && !login4.json.mfaRequired && login4.json.user?.email === email, JSON.stringify(login4.json).slice(0, 80));

// cleanup: delete the throwaway account
const del = await call("DELETE", "/me");
ok("cleanup: account deleted", del.status === 200, String(del.status));

console.log(`\nLIVE TRI-1029: ${pass} checks passed against ${BASE}`);
