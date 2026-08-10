#!/usr/bin/env node
/**
 * TRI-1009 LIVE E2E against the running dev API (127.0.0.1). Proves the staff
 * "Preferences" screen is no longer a front-end-only fake: it persists through the
 * new endpoints backed by staff_preferences (migration 007, previously unused):
 *   • GET   /admin/me/preferences         → hydrate
 *   • PATCH /admin/me/preferences         → persist (partial-patch friendly)
 *   • GET   /admin/me                     → includes `preferences`
 *
 * Uses a throwaway MFA'd admin session; cleans the staff row + its preferences at the
 * end. Run ON the dev host from /opt/tripkoach-v2/apps/api with the dev env sourced:
 *   node --experimental-strip-types /root/live-e2e-1009.mjs
 */
import { loadConfig } from "./src/config.ts";
import { createDb } from "./src/db.ts";
import { upsertStaff } from "./src/admin-seed.ts";
import { totp } from "./src/totp.ts";

const cfg = loadConfig();
const db = await createDb(cfg);
const PORT = process.env.PORT || 3020;
const BASE = `http://127.0.0.1:${PORT}/api/admin`;
const EMAIL = "prefs-e2e-1009@tripkoach.com";
const PW = "Prefs-E2E-2026!";
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

try {
  await upsertStaff(db, { email: EMAIL, password: PW, name: "Prefs E2E", role: "admin" });
  await db.query(`UPDATE staff_user SET mfa_enabled=false WHERE lower(email)=lower($1)`, [EMAIL]);
  await db.query(`DELETE FROM mfa_factor WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);
  await db.query(`DELETE FROM recovery_code WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);
  await db.query(`DELETE FROM staff_preferences WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);

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

  // 1. Defaults when no row exists yet.
  const g0 = await call("GET", "/me/preferences", { cookie });
  const p0 = g0.body?.preferences;
  ok("GET defaults: theme=system", g0.status === 200 && p0?.theme === "system", JSON.stringify(p0));
  ok("GET defaults: density=comfortable", p0?.tableDensity === "comfortable");
  ok("GET defaults: alerts.newBooking=true, departureNearlyFull=false",
    p0?.alerts?.newBooking === true && p0?.alerts?.departureNearlyFull === false, JSON.stringify(p0?.alerts));

  // 2. Persist a full set.
  const patch1 = await call("PATCH", "/me/preferences", { cookie, body: {
    theme: "dark", tableDensity: "compact", timeZone: "wat", startPage: "bookings",
    alerts: { newBooking: false, departureNearlyFull: true, dailySummary: true },
  }});
  ok("PATCH 200", patch1.status === 200, JSON.stringify(patch1.body).slice(0, 200));
  const pp = patch1.body?.preferences;
  ok("PATCH echoes theme=dark", pp?.theme === "dark");
  ok("PATCH merged alerts (newBooking=false, paymentFailed stays default true)",
    pp?.alerts?.newBooking === false && pp?.alerts?.paymentFailed === true, JSON.stringify(pp?.alerts));

  // 3. Persisted across a fresh GET.
  const g1 = await call("GET", "/me/preferences", { cookie });
  const p1 = g1.body?.preferences;
  ok("re-GET persisted theme=dark", p1?.theme === "dark");
  ok("re-GET persisted density=compact, tz=wat, start=bookings",
    p1?.tableDensity === "compact" && p1?.timeZone === "wat" && p1?.startPage === "bookings", JSON.stringify(p1));
  ok("re-GET persisted alerts", p1?.alerts?.departureNearlyFull === true && p1?.alerts?.dailySummary === true);

  // 4. Partial patch keeps untouched fields.
  const patch2 = await call("PATCH", "/me/preferences", { cookie, body: { theme: "light" } });
  const p2 = patch2.body?.preferences;
  ok("partial PATCH updates theme=light, keeps density=compact",
    patch2.status === 200 && p2?.theme === "light" && p2?.tableDensity === "compact", JSON.stringify(p2));

  // 5. GET /me includes preferences.
  const me = await call("GET", "/me", { cookie });
  ok("GET /me carries preferences.theme=light", me.status === 200 && me.body?.preferences?.theme === "light",
    JSON.stringify(me.body?.preferences));

  // 6. Validation rejects a bad enum.
  const bad = await call("PATCH", "/me/preferences", { cookie, body: { theme: "neon" } });
  ok("bad enum rejected (4xx)", bad.status >= 400 && bad.status < 500, `status=${bad.status}`);

  // 7. Empty body rejected.
  const empty = await call("PATCH", "/me/preferences", { cookie, body: {} });
  ok("empty patch rejected (4xx)", empty.status >= 400 && empty.status < 500, `status=${empty.status}`);
} finally {
  await db.query(`DELETE FROM staff_preferences WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]).catch(() => {});
  await db.query(`DELETE FROM staff_user WHERE lower(email)=lower($1)`, [EMAIL]).catch(() => {});
}

let pass = 0;
for (const [name, cond, detail] of results) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++;
}
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
