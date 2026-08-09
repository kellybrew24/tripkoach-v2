#!/usr/bin/env node
/**
 * TRI-1005 LIVE E2E against the running dev API (127.0.0.1). Proves the Guides
 * write path (POST/PATCH/DELETE /admin/guides) — the exact endpoints the newly
 * wired tk-boot wrappers (createGuide/updateGuide/setGuideStatus/deleteGuide)
 * hit — actually create, mutate and delete a guide with a real MFA'd staff
 * session. Creates a throwaway admin account, runs the flow, then cleans up.
 * Run ON the dev host from /opt/tripkoach-v2/apps/api with the dev env sourced:
 *   node --experimental-strip-types /root/live-e2e-1005.mjs
 */
import { loadConfig } from "./src/config.ts";
import { createDb } from "./src/db.ts";
import { upsertStaff } from "./src/admin-seed.ts";
import { totp } from "./src/totp.ts";

const cfg = loadConfig();
const db = await createDb(cfg);
const PORT = process.env.PORT || 3020;
const BASE = `http://127.0.0.1:${PORT}/api/admin`;
const EMAIL = "guides-e2e-1005@tripkoach.com";
const PW = "Guides-E2E-2026!";
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

let guideId = null;
try {
  // admin role → all permissions on (incl. tours.edit that guards /guides writes).
  await upsertStaff(db, { email: EMAIL, password: PW, name: "Guides E2E", role: "admin" });
  await db.query(`UPDATE staff_user SET mfa_enabled=false WHERE lower(email)=lower($1)`, [EMAIL]);
  await db.query(`DELETE FROM mfa_factor WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);
  await db.query(`DELETE FROM recovery_code WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);

  // Login → enroll → verify to obtain a promoted admin session cookie.
  const login1 = await call("POST", "/auth/login", { body: { email: EMAIL, password: PW } });
  let cookie = login1.cookie;
  if (login1.body?.mfaEnrollmentRequired) {
    const enroll = await call("POST", "/auth/mfa/enroll", { cookie });
    const secret = enroll.body?.secret;
    const verify = await call("POST", "/auth/mfa/verify", { cookie, body: { code: totp(secret) } });
    cookie = verify.cookie || cookie;
    ok("session promoted via MFA", verify.status === 200 && Array.isArray(verify.body?.permissions), JSON.stringify(verify.body).slice(0, 120));
  } else {
    ok("logged in (no MFA gate)", login1.status === 200);
  }

  // CREATE — createGuide
  const create = await call("POST", "/guides", { cookie, body: {
    name: "E2E Test Guide", email: "e2e-guide@tripkoach.com", phone: "0244000000",
    base: "Accra", status: "active", regions: ["Greater Accra", "Eastern"], languages: ["English", "Twi"], bio: "temp",
  } });
  guideId = create.body?.id;
  ok("POST /guides → 201 + id", create.status === 201 && !!guideId, JSON.stringify(create.body).slice(0, 160));
  ok("created guide persisted regions/base", create.body?.base === "Accra" && (create.body?.regions || []).includes("Eastern"));

  // Appears in the list the console hydrates from.
  const listAfterCreate = await call("GET", "/guides", { cookie });
  ok("GET /guides includes new guide", (listAfterCreate.body?.guides || []).some((g) => g.id === guideId));

  // UPDATE (edit drawer) — updateGuide
  const upd = await call("PATCH", `/guides/${guideId}`, { cookie, body: { name: "E2E Renamed Guide", base: "Kumasi" } });
  ok("PATCH /guides/:id → name + base updated", upd.status === 200 && upd.body?.name === "E2E Renamed Guide" && upd.body?.base === "Kumasi", JSON.stringify(upd.body).slice(0, 120));

  // STATUS TOGGLE (set on leave) — setGuideStatus
  const leave = await call("PATCH", `/guides/${guideId}`, { cookie, body: { status: "leave" } });
  ok("PATCH status=leave persisted", leave.status === 200 && leave.body?.status === "leave");
  const active = await call("PATCH", `/guides/${guideId}`, { cookie, body: { status: "active" } });
  ok("PATCH status=active persisted", active.status === 200 && active.body?.status === "active");

  // DELETE (remove modal) — deleteGuide
  const del = await call("DELETE", `/guides/${guideId}`, { cookie });
  ok("DELETE /guides/:id → ok", del.status === 200 && del.body?.ok === true, JSON.stringify(del.body).slice(0, 120));
  const listAfterDel = await call("GET", "/guides", { cookie });
  ok("guide gone from list after delete", !(listAfterDel.body?.guides || []).some((g) => g.id === guideId));
  guideId = null;
} finally {
  if (guideId) { try { await db.query(`DELETE FROM guide WHERE id::text=$1`, [guideId]); } catch {} }
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
