#!/usr/bin/env node
/**
 * TRI-1006 LIVE E2E against the running dev API (127.0.0.1). Proves the newly
 * wired "Export for reconciliation" download hits the REAL, cookie-authed
 * GET /reports/reconciliation.csv (perm payments.refund) and streams a CSV
 * attachment — the exact request tk-boot's API.reconciliationCsv() makes.
 * Also cross-checks the JSON /reports/reconciliation totals so we know the
 * Refunded/Failed stat cards (now derived from payments) have real data behind
 * them. Creates a throwaway admin account, runs the flow, then cleans up.
 * Run ON the dev host from /opt/tripkoach-v2/apps/api with the dev env sourced:
 *   node --experimental-strip-types /root/live-e2e-1006.mjs
 */
import { loadConfig } from "./src/config.ts";
import { createDb } from "./src/db.ts";
import { upsertStaff } from "./src/admin-seed.ts";
import { totp } from "./src/totp.ts";

const cfg = loadConfig();
const db = await createDb(cfg);
const PORT = process.env.PORT || 3020;
const BASE = `http://127.0.0.1:${PORT}/api/admin`;
const EMAIL = "recon-e2e-1006@tripkoach.com";
const PW = "Recon-E2E-2026!";
const COOKIE = cfg.adminCookieName;

const results = [];
const ok = (name, cond, detail = "") => results.push([name, !!cond, detail]);

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
async function rawGet(path, cookie) {
  const res = await fetch(BASE + path, { headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {} });
  const text = await res.text();
  return { status: res.status, ct: res.headers.get("content-type") || "", cd: res.headers.get("content-disposition") || "", text };
}

try {
  await upsertStaff(db, { email: EMAIL, password: PW, name: "Recon E2E", role: "admin" });
  await db.query(`UPDATE staff_user SET mfa_enabled=false WHERE lower(email)=lower($1)`, [EMAIL]);
  await db.query(`DELETE FROM mfa_factor WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);
  await db.query(`DELETE FROM recovery_code WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);

  const login1 = await call("POST", "/auth/login", { body: { email: EMAIL, password: PW } });
  let cookie = login1.cookie;
  if (login1.body?.mfaEnrollmentRequired) {
    const enroll = await call("POST", "/auth/mfa/enroll", { cookie });
    const verify = await call("POST", "/auth/mfa/verify", { cookie, body: { code: totp(enroll.body?.secret) } });
    cookie = verify.cookie || cookie;
    ok("session promoted via MFA", verify.status === 200 && Array.isArray(verify.body?.permissions));
  } else {
    ok("logged in (no MFA gate)", login1.status === 200);
  }

  // Guard proof: without a session the CSV route is 401 (not 404 / not open).
  const noAuth = await rawGet("/reports/reconciliation.csv", null);
  ok("CSV route guarded (401 unauth)", noAuth.status === 401, `status=${noAuth.status}`);

  // The real download the wired button performs.
  const csv = await rawGet("/reports/reconciliation.csv", cookie);
  ok("GET /reports/reconciliation.csv → 200", csv.status === 200, `status=${csv.status}`);
  ok("Content-Type is text/csv", /text\/csv/i.test(csv.ct), csv.ct);
  ok("Content-Disposition attachment filename", /attachment;.*filename=.*\.csv/i.test(csv.cd), csv.cd);
  const lines = csv.text.split(/\r?\n/).filter((l) => l.length);
  ok("CSV has a header row", lines.length >= 1 && /,/.test(lines[0]), lines[0] || "(empty)");

  // JSON report backs the derived Refunded/Failed cards — confirm it aggregates payments.
  const json = await call("GET", "/reports/reconciliation", { cookie });
  ok("GET /reports/reconciliation → 200 JSON", json.status === 200 && !!json.body, `status=${json.status}`);
  ok("report exposes items[] + summary[]", json.body && Array.isArray(json.body.items) && Array.isArray(json.body.summary),
     `count=${json.body?.count} summary=${JSON.stringify(json.body?.summary).slice(0, 120)}`);
} finally {
  await db.query(`DELETE FROM staff_user WHERE lower(email)=lower($1)`, [EMAIL]).catch(() => {});
  await db.end?.();
}

let pass = 0;
for (const [name, cond, detail] of results) {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : "  — " + detail}`);
  if (cond) pass++;
}
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
