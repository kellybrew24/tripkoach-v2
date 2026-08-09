#!/usr/bin/env node
/**
 * TRI-1007 LIVE E2E against the running dev API (127.0.0.1). Proves the newly wired
 * "Resend confirmation" controls hit real endpoints that (1) re-render + log the
 * confirmation email through the shared transport, (2) audit the action, and (3)
 * reject bookings with nothing to resend:
 *   • POST /admin/bookings/:ref/resend            (Bookings bulk bar + drawer)
 *   • POST /admin/customers/:id/resend-confirmation (Customers row menu)
 *
 * To avoid delivering to a fixture recipient, the target booking's lead-traveller
 * email is repointed to a sink on our own domain for the duration, then restored.
 * Creates a throwaway MFA'd admin session, runs the flow, then cleans up.
 * Run ON the dev host from /opt/tripkoach-v2/apps/api with the dev env sourced:
 *   node --experimental-strip-types /root/live-e2e-1007.mjs
 */
import { loadConfig } from "./src/config.ts";
import { createDb } from "./src/db.ts";
import { upsertStaff } from "./src/admin-seed.ts";
import { totp } from "./src/totp.ts";

const cfg = loadConfig();
const db = await createDb(cfg);
const PORT = process.env.PORT || 3020;
const BASE = `http://127.0.0.1:${PORT}/api/admin`;
const EMAIL = "resend-e2e-1007@tripkoach.com";
const PW = "Resend-E2E-2026!";
const SINK = "e2e-resend-sink-1007@tripkoach.com";
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

let restore = null; // { travellerId, email } to put back after the test
try {
  await upsertStaff(db, { email: EMAIL, password: PW, name: "Resend E2E", role: "admin" });
  await db.query(`UPDATE staff_user SET mfa_enabled=false WHERE lower(email)=lower($1)`, [EMAIL]);
  await db.query(`DELETE FROM mfa_factor WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);
  await db.query(`DELETE FROM recovery_code WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [EMAIL]);

  // Login → enroll → verify to obtain a promoted admin session cookie.
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

  // Pick a confirmed/completed GUEST booking (user_id IS NULL) so the recipient resolves to the
  // lead-traveller email we control — an account-linked booking would (correctly) prefer the
  // account's real email, which we must not deliver to during a test.
  const pick = (await db.query(
    `SELECT b.ref, b.status, bt.id AS traveller_id, bt.email AS orig_email
       FROM booking b
       JOIN booking_traveller bt ON bt.booking_id = b.id AND bt.is_lead = true
      WHERE b.status IN ('confirmed','completed') AND b.user_id IS NULL
      ORDER BY b.created_at DESC LIMIT 1`)).rows[0];
  ok("found a confirmed booking with a lead traveller", !!pick, JSON.stringify(pick || {}));
  if (!pick) throw new Error("no confirmed booking to test against");

  restore = { travellerId: pick.traveller_id, email: pick.orig_email };
  await db.query(`UPDATE booking_traveller SET email=$1 WHERE id=$2`, [SINK, pick.traveller_id]);

  const before = Number((await db.query(
    `SELECT count(*)::int AS n FROM email_message WHERE related_id=$1 AND related_type='booking'`, [pick.ref])).rows[0].n);

  // ── POST /bookings/:ref/resend ──────────────────────────────────────────────
  const resend = await call("POST", `/bookings/${encodeURIComponent(pick.ref)}/resend`, { cookie });
  ok("POST /bookings/:ref/resend → 200", resend.status === 200, JSON.stringify(resend.body).slice(0, 160));
  ok("response carries outcome + recipient", ["sent", "skipped", "failed", "no_recipient"].includes(resend.body?.outcome) && resend.body?.to === SINK, JSON.stringify(resend.body));

  const after = (await db.query(
    `SELECT template, status, to_email FROM email_message
      WHERE related_id=$1 AND related_type='booking' ORDER BY created_at DESC LIMIT 1`, [pick.ref])).rows[0];
  const nowCount = Number((await db.query(
    `SELECT count(*)::int AS n FROM email_message WHERE related_id=$1 AND related_type='booking'`, [pick.ref])).rows[0].n);
  ok("a new email_message row was logged", nowCount === before + 1, `before=${before} now=${nowCount}`);
  ok("logged the booking_confirmed template to the sink", after?.template === "booking_confirmed" && after?.to_email === SINK, JSON.stringify(after));
  ok("send-log status matches API outcome", after?.status === resend.body?.outcome, `${after?.status} vs ${resend.body?.outcome}`);

  // audit row written
  const audit = (await db.query(
    `SELECT action, target_id FROM audit_log
      WHERE action='booking.resend_confirmation' AND target_id=$1 ORDER BY created_at DESC LIMIT 1`, [pick.ref])).rows[0];
  ok("audit_log has booking.resend_confirmation", !!audit, JSON.stringify(audit || {}));

  // ── Guard: unknown ref → 404, cancelled/failed → 409 ────────────────────────
  const missing = await call("POST", `/bookings/NOPE-9999/resend`, { cookie });
  ok("unknown ref → 404", missing.status === 404, String(missing.status));

  const cancelled = (await db.query(
    `SELECT ref FROM booking WHERE status IN ('cancelled','failed') ORDER BY created_at DESC LIMIT 1`)).rows[0];
  if (cancelled) {
    const c = await call("POST", `/bookings/${encodeURIComponent(cancelled.ref)}/resend`, { cookie });
    ok("cancelled/failed booking → 409", c.status === 409, `${cancelled.ref} → ${c.status}`);
  } else {
    ok("cancelled/failed 409 (skipped — none present)", true, "no cancelled/failed booking in dev");
  }

  // ── POST /customers/:id/resend-confirmation ─────────────────────────────────
  // Route + guard only (it delegates to the same resendBookingConfirmation core proven above). We
  // deliberately DON'T trigger a live customer send here: the recipient would be a real account holder,
  // and the shared send path is already exercised by the booking test. Unknown id must 404.
  const custGuard = await call("POST", `/customers/00000000-0000-0000-0000-000000000000/resend-confirmation`, { cookie });
  ok("customers resend route wired (unknown id → 404)", custGuard.status === 404, String(custGuard.status));
} finally {
  if (restore) { try { await db.query(`UPDATE booking_traveller SET email=$1 WHERE id=$2`, [restore.email, restore.travellerId]); } catch {} }
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
