#!/usr/bin/env node
/**
 * TRI-1032 LIVE E2E against the running dev API (127.0.0.1:3020). Proves the staff
 * invite -> accept (set-password) flow works end to end via the SAME public endpoints
 * the newly-wired admin FE calls:
 *   • POST /admin/staff                 (authed) → real invite, real emailed acceptUrl
 *   • GET  /admin/staff/accept?token=   (public) → preview (what AcceptInvite shows)
 *   • POST /admin/staff/accept          (public) → set password + activate account
 *   • POST /admin/auth/login            → the freshly-invited admin can now sign in
 *
 * The invite token is read from email_message.vars->>'acceptUrl' — exactly the link
 * the recipient clicks — so we also assert the emailed path is /accept-invite (the
 * route the FE now serves). Throwaway rows are cleaned up at the end.
 *
 * Run ON the dev host from /opt/tripkoach-v2/apps/api with the API env loaded.
 */
import { loadConfig } from "./src/config.ts";
import { createDb } from "./src/db.ts";
import { upsertStaff } from "./src/admin-seed.ts";
import { totp } from "./src/totp.ts";

const cfg = loadConfig();
const db = await createDb(cfg);
const PORT = process.env.PORT || 3020;
const BASE = `http://127.0.0.1:${PORT}/api/admin`;
const COOKIE = cfg.adminCookieName;

const ADMIN = "invite-e2e-1032-admin@tripkoach.com";
const ADMIN_PW = "Invite-Admin-2026!";
const INVITEE = "invite-e2e-1032-justice@tripkoach.com";
const INVITEE_PW = "Justice-NewPass-2026!";

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
async function cleanup() {
  for (const e of [ADMIN, INVITEE]) {
    await db.query(
      `DELETE FROM staff_invite WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [e]);
    await db.query(
      `DELETE FROM mfa_factor WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [e]);
    await db.query(
      `DELETE FROM recovery_code WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [e]);
    await db.query(`DELETE FROM staff_user WHERE lower(email)=lower($1)`, [e]);
  }
}

try {
  await cleanup();

  // 1. Throwaway admin with users.manage; log in (+ MFA enroll if enforced).
  await upsertStaff(db, { email: ADMIN, password: ADMIN_PW, name: "Invite E2E Admin", role: "admin" });
  await db.query(`UPDATE staff_user SET mfa_enabled=false WHERE lower(email)=lower($1)`, [ADMIN]);
  await db.query(`DELETE FROM mfa_factor WHERE staff_user_id IN (SELECT id FROM staff_user WHERE lower(email)=lower($1))`, [ADMIN]);
  const login = await call("POST", "/auth/login", { body: { email: ADMIN, password: ADMIN_PW } });
  let cookie = login.cookie;
  if (login.body?.mfaEnrollmentRequired || login.body?.mfaRequired) {
    const enroll = await call("POST", "/auth/mfa/enroll", { cookie });
    const verify = await call("POST", "/auth/mfa/verify", { cookie, body: { code: totp(enroll.body?.secret) } });
    cookie = verify.cookie || cookie;
    ok("admin session (MFA enrolled)", verify.status === 200);
  } else {
    ok("admin session (no MFA gate)", login.status === 200);
  }

  // 2. Create a REAL invite through the authed API.
  const inv = await call("POST", "/staff", { cookie, body: { email: INVITEE, name: "Justice Ayoka", role: "admin" } });
  ok("POST /staff created invite (201)", inv.status === 201, `status=${inv.status} ${JSON.stringify(inv.body)?.slice(0,160)}`);

  // 3. Recover the exact emailed link from the send-log (what the recipient clicks).
  const em = await db.query(
    `SELECT vars FROM email_message WHERE template='staff_invite' AND lower(vars->>'name') IS NOT NULL
       AND (vars->>'acceptUrl') LIKE '%accept-invite%' ORDER BY created_at DESC LIMIT 5`);
  // Match the row whose acceptUrl token resolves to OUR invitee.
  let acceptUrl = null, token = null;
  for (const r of em.rows) {
    const u = r.vars?.acceptUrl;
    if (!u) continue;
    const t = (u.match(/[?&]token=([^&]+)/) || [])[1];
    if (!t) continue;
    const prev = await call("GET", `/staff/accept?token=${encodeURIComponent(t)}`);
    if (prev.body?.invite?.valid && (prev.body.invite.email || "").toLowerCase() === INVITEE.toLowerCase()) {
      acceptUrl = u; token = t; break;
    }
  }
  ok("emailed acceptUrl found in send-log", !!acceptUrl, acceptUrl || "(none)");
  ok("emailed link path is /accept-invite", !!acceptUrl && new URL(acceptUrl).pathname === "/accept-invite",
    acceptUrl ? new URL(acceptUrl).pathname : "");

  // 4. Preview (the AcceptInvite screen's first call).
  const pv = await call("GET", `/staff/accept?token=${encodeURIComponent(token)}`);
  ok("GET preview valid + correct email/role", pv.status === 200 && pv.body?.invite?.valid === true
    && (pv.body.invite.email || "").toLowerCase() === INVITEE.toLowerCase() && pv.body.invite.role === "admin",
    JSON.stringify(pv.body?.invite));

  // 5. Bad token → invalid preview (screen shows the friendly error, not a set-password form).
  const bad = await call("GET", `/staff/accept?token=not-a-real-token`);
  ok("GET preview bad token → valid:false", bad.status === 200 && bad.body?.invite?.valid === false, JSON.stringify(bad.body));

  // 6. Short password rejected (mirrors the FE's >=10 gate on the server).
  const short = await call("POST", "/staff/accept", { body: { token, password: "short" } });
  ok("POST accept short password → 400", short.status === 400, `status=${short.status}`);

  // 7. Accept → sets password + activates the account.
  const acc = await call("POST", "/staff/accept", { body: { token, password: INVITEE_PW } });
  ok("POST accept → 200 ok", acc.status === 200 && acc.body?.ok === true, `status=${acc.status} ${JSON.stringify(acc.body)}`);
  const row = (await db.query(`SELECT status FROM staff_user WHERE lower(email)=lower($1)`, [INVITEE])).rows[0];
  ok("account activated (status=active)", row?.status === "active", `status=${row?.status}`);

  // 8. Single-use: reusing the token now fails.
  const reuse = await call("POST", "/staff/accept", { body: { token, password: INVITEE_PW } });
  ok("POST accept reuse → 4xx (single-use)", reuse.status >= 400, `status=${reuse.status}`);

  // 9. The freshly-invited admin can now SIGN IN with the password they set.
  const signin = await call("POST", "/auth/login", { body: { email: INVITEE, password: INVITEE_PW } });
  const signedIn = signin.status === 200 && (Array.isArray(signin.body?.permissions) || signin.body?.mfaRequired || signin.body?.mfaEnrollmentRequired);
  ok("invited admin can sign in with new password", signedIn, `status=${signin.status} ${JSON.stringify(signin.body)?.slice(0,120)}`);

} finally {
  await cleanup();
  await db.end?.();
}

let pass = 0;
for (const [name, good, detail] of results) {
  console.log(`${good ? "PASS" : "FAIL"}  ${name}${good ? "" : "  <<< " + detail}`);
  if (good) pass++;
}
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
