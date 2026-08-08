#!/usr/bin/env node
/**
 * TRI-912 LIVE FE end-to-end (jsdom): drive the BUILT admin app with
 * USE_LIVE_API on against a mock API that returns the enforcement contract, and
 * prove the login-time MFA enrollment gate: login → gate renders QR → verify →
 * recovery codes → enter console (dashboard hydrates). Mirrors how it behaves
 * against admin.dev once the same shapes are served under /api/admin.
 *
 * Usage: node scripts/verify-912-live.mjs
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps", "admin", "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STAFF = { staff: { name: "Kwame Boateng", email: "kwame@tripkoach.com", initials: "KB", role: "admin" }, role: "admin", permissions: ["tours.edit", "bookings.cancel", "payments.refund", "users.manage", "settings.manage"] };
const SECRET = "JBSWY3DPEHPK3PXP";
const OTPAUTH = "otpauth://totp/TripKoach%20Admin:kwame@tripkoach.com?secret=" + SECRET + "&issuer=TripKoach%20Admin&algorithm=SHA1&digits=6&period=30";
const RECOVERY = ["A1B2-C3D4", "E5F6-G7H8", "J9K0-L1M2", "N3P4-Q5R6", "S7T8-U9V0", "W1X2-Y3Z4", "AA11-BB22", "CC33-DD44", "EE55-FF66", "GG77-HH88"];
const TOURS = { tours: [{ id: "t1", title: "MOCK Accra Tour", region: "Greater Accra", category: "City Tour", price: 65, currency: "USD", published: true, rating: 4.7, reviews: 42, image: "https://x.test/a.jpg" }] };

function makeServer() {
  const hits = [];
  let mfaEnabled = false; // flips true after enroll-verify
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    hits.push(req.method + " " + url);
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    // Factor-less enforced-role login → the enrollment gate (no full session yet).
    if (url.endsWith("/api/admin/auth/login") && req.method === "POST") {
      return send(200, { mfaEnrollmentRequired: true, staff: { id: "u1", email: "kwame@tripkoach.com", name: "Kwame Boateng", role: "admin", jobTitle: null } });
    }
    if (url.endsWith("/api/admin/auth/mfa/enroll") && req.method === "POST") return send(200, { secret: SECRET, otpauthUri: OTPAUTH, issuer: "TripKoach Admin" });
    if (url.endsWith("/api/admin/auth/mfa/verify") && req.method === "POST") {
      mfaEnabled = true; // gate cleared + session promoted → full { staff, permissions } returned
      return send(200, { enabled: true, recoveryCodes: RECOVERY, staff: STAFF.staff, permissions: STAFF.permissions });
    }
    if (url.endsWith("/api/admin/me")) return mfaEnabled ? send(200, STAFF) : send(401, { error: { code: "unauthenticated", message: "Sign in" } });
    if (url.endsWith("/api/admin/auth/mfa/status")) return send(200, { enabled: mfaEnabled, pendingEnrollment: !mfaEnabled, recoveryCodesRemaining: mfaEnabled ? 10 : 0 });
    if (url.endsWith("/api/admin/tours")) return send(200, TOURS);
    if (url.endsWith("/api/admin/regions")) return send(200, { regions: [{ name: "Greater Accra" }] });
    if (url.endsWith("/api/admin/dashboard")) return send(200, { range: "7d", bookings: { total: 137, byStatus: { confirmed: 82, pending: 34, cancelled: 12 } }, revenue: { usd: 24180, currency: "USD", ghs: 288790, ghsCurrency: "GHS" }, departures: { upcoming: 6, next: [{ id: "d1", tour: "MOCK Accra Tour", tourId: "t1", date: "Sat 22 Aug 2026", seatsTotal: 12, booked: 9, spotsLeft: 3 }] }, occupancy: { seatsTotal: 60, seatsReserved: 34, spotsLeft: 26, utilizationPct: 56.7 } });
    if (/\/api\/admin\/(bookings|payments|departures|promos|staff|customers|guides|reviews|audit-log)$/.test(url)) return send(200, {});
    if (url.endsWith("/api/admin/settings")) return send(200, {});
    return send(404, { error: { code: "not_found", message: url } });
  });
  server._hits = hits;
  return server;
}

function listen(server) { return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port))); }

const results = [];
function ok(name, cond, detail = "") { results.push([name, !!cond, detail]); }

const server = makeServer();
const port = await listen(server);
const apiBase = `http://127.0.0.1:${port}/api/admin`;

const vc = new VirtualConsole();
const errors = [];
vc.on("jsdomError", (e) => errors.push(String(e.detail || e)));
const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  url: "https://admin.dev.tripkoach.com/login", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc,
});
const { window } = dom;
window.scrollTo = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.fetch = (u, init) => globalThis.fetch(u, init);
window.TK_CONFIG = { apiBase, env: "test", USE_LIVE_API: true };
const chain = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "_ds_bundle.js",
  "data/data.js", "data/admin-data.js", "tk-api.js", "tk-boot.js", "app.js"];
for (const s of chain) window.eval(readFileSync(join(DIST, s), "utf8"));
const root = () => window.document.getElementById("root");

// Wait for the login screen.
for (let i = 0; i < 60 && !/Sign in to the console/.test(root().innerHTML); i++) await sleep(50);
ok("login screen rendered (live)", /Sign in to the console/.test(root().innerHTML));

// Fill + submit the sign-in form.
const form = window.document.querySelector("form");
const emailEl = form.querySelector('input[type="email"]');
const pwEl = form.querySelector('input[type="password"]');
const set = (el, v) => { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, "value"); d.set.call(el, v); el.dispatchEvent(new window.Event("input", { bubbles: true })); };
set(emailEl, "kwame@tripkoach.com");
set(pwEl, "Sup3r-Secret!");
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

// The gate should mount, call enroll, and render the QR.
for (let i = 0; i < 80 && !/Set up two-factor authentication/.test(root().innerHTML); i++) await sleep(50);
ok("login → routed to enrollment gate", /Set up two-factor authentication/.test(root().innerHTML));
ok("gate called POST /auth/mfa/enroll", server._hits.includes("POST /api/admin/auth/mfa/enroll"));
await sleep(120);
ok("gate rendered scannable QR (svg)", /QR code . scan with your authenticator|role="img"/.test(root().innerHTML) && /<svg/.test(root().innerHTML));
ok("gate shows the setup key fallback", root().innerHTML.replace(/\s+/g, "").includes(SECRET.replace(/(.{4})/g, "$1").slice(0, 8)) || /Setup key/.test(root().innerHTML));

// Enter the 6-digit code and verify.
const boxes = [...window.document.querySelectorAll('input[aria-label^="Digit"]')];
ok("gate shows six code inputs", boxes.length === 6);
"123456".split("").forEach((d, i) => set(boxes[i], d));
await sleep(30);
const verifyBtn = [...window.document.querySelectorAll("button")].find((b) => /Verify and continue/.test(b.textContent || ""));
ok("verify button present", !!verifyBtn);
verifyBtn && verifyBtn.dispatchEvent(new window.Event("click", { bubbles: true }));

// Recovery-codes step.
for (let i = 0; i < 80 && !/Save your recovery codes/.test(root().innerHTML); i++) await sleep(50);
ok("verify → recovery codes step", /Save your recovery codes/.test(root().innerHTML));
ok("verify called POST /auth/mfa/verify", server._hits.includes("POST /api/admin/auth/mfa/verify"));
ok("recovery codes rendered", RECOVERY.every((c) => root().innerHTML.includes(c)));

// Enter the console.
const enterBtn = [...window.document.querySelectorAll("button")].find((b) => /Enter the console/.test(b.textContent || ""));
ok("enter-console button present", !!enterBtn);
enterBtn && enterBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
for (let i = 0; i < 80 && !/MOCK|Good afternoon|Dashboard/.test(root().innerHTML); i++) await sleep(50);
ok("entered the console after enrollment", /MOCK|Good afternoon|Dashboard/.test(root().innerHTML));

server.close();
let allOk = true;
for (const [name, pass, detail] of results) { if (!pass) allOk = false; console.log(`  [live] ${pass ? "PASS" : "FAIL"} — ${name}${pass ? "" : "  " + detail}`); }
if (errors.length) console.log("  jsdom errors:", errors.slice(0, 3));
console.log(`\n== TRI-912 live FE gate: ${allOk ? "ALL PASS" : "FAIL"} ==`);
process.exit(allOk ? 0 : 1);
