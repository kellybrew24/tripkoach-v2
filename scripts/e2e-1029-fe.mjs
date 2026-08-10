#!/usr/bin/env node
// TRI-1029 FE render test: consumer two-factor wiring in the built web bundle.
// Mocks ONLY the low-level transport (window.TK_API) so the REAL tk-auth.js shim + the REAL built
// AccountSettingsWeb / LoginWeb components run end-to-end against a fake 2FA server. Asserts:
//   (1) account "Turn on" → enroll modal shows the QR (client-rendered from otpauth) + manual key
//   (2) verifying a code → recovery codes are shown; the row flips to "On"
//   (3) a wrong enrollment code surfaces an inline error (no crash)
//   (4) login for a 2FA account shows the challenge step; a good code completes (go → bookings)
// Production React → no act(); drive via native value setters + dispatched events + setTimeout flushes.
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(ROOT, "apps", "web", "dist");
// NOTE: tk-api.js is intentionally omitted — we inject a mock window.TK_API BEFORE tk-auth.js so the
// shim (var api = window.TK_API) captures our fake transport.
const before = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "_ds_bundle.js", "config.js", "data/data.js", "data/blog.js"];
const after = ["tk-booking.js", "tk-auth.js", "tk-reviews.js", "tk-boot.js", "app.js"];

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.detail || e));
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
window.scrollTo = () => {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

const evalScript = (s) => { const code = readFileSync(join(dist, s), "utf8"); try { window.eval(code); } catch (e) { console.error(`script ${s} threw:`, e.stack || e); process.exit(1); } };
for (const s of before) evalScript(s);

// ── Fake 2FA server + transport ───────────────────────────────────────────
const CODE = "123456";                     // the one "correct" TOTP the fake accepts
const RECOVERY = Array.from({ length: 10 }, (_, i) => `code${i}-abcd${i}`);
const server = { enabled: false };
const USER = { id: "u1", email: "mfa@example.com", name: "MFA Tester" };
const reject = (status, code, message, field) => Promise.reject(Object.assign(new Error(message), { status, code, field }));
window.TK_API = {
  get(path) {
    if (path === "/me") return Promise.resolve({ user: { ...USER, two_factor_enabled: server.enabled } });
    if (path === "/auth/mfa/status") return Promise.resolve({ enabled: server.enabled });
    if (path === "/me/bookings") return Promise.resolve({ bookings: [] });
    return Promise.resolve({});
  },
  post(path, body) {
    body = body || {};
    if (path === "/auth/mfa/enroll") return Promise.resolve({ secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/TripKoach:mfa@example.com?secret=JBSWY3DPEHPK3PXP&issuer=TripKoach", issuer: "TripKoach" });
    if (path === "/auth/mfa/verify") { if (String(body.code).trim() === CODE) { server.enabled = true; return Promise.resolve({ enabled: true, recoveryCodes: RECOVERY }); } return reject(400, "validation", "That code did not match.", "code"); }
    if (path === "/auth/mfa/disable") { if (String(body.code).trim() === CODE) { server.enabled = false; return Promise.resolve({ enabled: false }); } return reject(400, "validation", "Enter a current code.", "code"); }
    if (path === "/auth/login") { if (server.enabled) return Promise.resolve({ mfaRequired: true }); return Promise.resolve({ user: USER, linkedBookings: 0 }); }
    if (path === "/auth/mfa") { if (String(body.code).trim() === CODE) return Promise.resolve({ user: USER, linkedBookings: 0 }); return reject(401, "invalid_code", "That code did not match."); }
    if (path === "/auth/logout") return Promise.resolve({ ok: true });
    return Promise.resolve({});
  },
  put() { return Promise.resolve({}); },
  del() { return Promise.resolve({}); },
};

for (const s of after) { evalScript(s); if (s === "tk-boot.js") window.TK_BOOT = () => {}; }

// Live-API flag ON so the components take the real wiring path.
window.TK_CONFIG = window.TK_CONFIG || {};
window.TK_CONFIG.USE_LIVE_API = true;

const React = window.React, ReactDOM = window.ReactDOM, doc = window.document;
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error("FAIL:", m); if (errors.length) console.error("jsdomErrors:", errors.map(String).join("\n")); process.exit(1); };
const pass = (m) => console.log("PASS", m);
const buttons = () => Array.from(doc.querySelectorAll("button"));
const btnByText = (re) => buttons().find((b) => re.test((b.textContent || "").trim()));
const setInput = (el, v) => { const set = window.Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; set.call(el, v); el.dispatchEvent(new window.Event("input", { bubbles: true })); return flush(); };

// ── Part A: account settings enroll flow ──────────────────────────────────
const rootA = doc.createElement("div"); doc.body.appendChild(rootA);
ReactDOM.createRoot(rootA).render(React.createElement(window.AccountSettingsWeb, { go: () => {} }));
await flush(150); // hydrate /me

let turnOn = btnByText(/^Turn on$/);
if (!turnOn) fail("no 'Turn on' 2FA button rendered");
if (turnOn.disabled) fail("'Turn on' button disabled with live flag on");
pass("account shows an enabled 'Turn on' two-factor control");

turnOn.click();
await flush(60); // mfaEnroll resolves
// QR present (svg with the aria-label from MfaQr) + manual secret shown
const qr = doc.querySelector('svg[aria-label*="QR code"]');
if (!qr) fail("enroll modal did not render the QR code");
if (!/JBSWY3DPEHPK3PXP/.test(doc.body.textContent)) fail("manual secret key not shown in enroll modal");
pass("enroll modal renders client-side QR + manual key");

// Wrong code → inline error, no crash
let codeInput = doc.getElementById("tfa-code");
if (!codeInput) fail("no code input in enroll modal");
await setInput(codeInput, "000000");
let verifyBtn = btnByText(/Verify & turn on/);
verifyBtn.click();
await flush(60);
if (!/did.?n.?t match|didn't match|did not match/i.test(doc.body.textContent)) fail("wrong enrollment code did not surface an inline error");
pass("wrong enrollment code shows inline error (no crash)");

// Correct code → recovery codes shown
codeInput = doc.getElementById("tfa-code");
await setInput(codeInput, CODE);
verifyBtn = btnByText(/Verify & turn on/);
verifyBtn.click();
await flush(80);
if (!RECOVERY.every((c) => doc.body.textContent.includes(c))) fail("recovery codes not all shown after verify");
pass("verify → all 10 recovery codes displayed once");
const doneBtn = btnByText(/I've saved them/);
if (!doneBtn) fail("no 'I've saved them' completion button");
doneBtn.click();
await flush(40);
if (!btnByText(/^Turn off$/)) fail("row did not flip to 'Turn off' after enabling");
pass("account row flips to On / 'Turn off' after enrollment");

// ── Part B: login challenge (2FA now enabled on the fake server) ──────────
let navigated = null;
const rootB = doc.createElement("div"); doc.body.appendChild(rootB);
ReactDOM.createRoot(rootB).render(React.createElement(window.LoginWeb, { go: (d) => { navigated = d; } }));
await flush(40);
const emailEl = rootB.querySelector('#lg-email input, input[type="email"]') || doc.querySelector('input[type="email"]');
await setInput(emailEl, USER.email);
const pwEl = doc.getElementById("lg-pw");
await setInput(pwEl, "whatever-pass");
const loginBtn = Array.from(rootB.querySelectorAll("button")).find((b) => /Log in/.test(b.textContent));
loginBtn.click();
await flush(60); // login → mfaRequired
if (!/Two-step verification/.test(doc.body.textContent)) fail("login did not switch to the 2FA challenge step");
pass("2FA login shows the second-factor challenge step");

const mfaInput = doc.getElementById("lg-mfa");
if (!mfaInput) fail("no challenge code input");
await setInput(mfaInput, CODE);
const verifySignIn = btnByText(/Verify & sign in/);
verifySignIn.click();
await flush(60); // loginMfa → go('bookings')
if (navigated !== "bookings") fail("successful challenge did not navigate to bookings (got " + navigated + ")");
pass("correct challenge code completes login (→ bookings)");

if (errors.length) fail("jsdom surfaced errors during render");
console.log("\nALL TRI-1029 FE CHECKS PASSED");
