#!/usr/bin/env node
/**
 * TRI-1139 targeted render + interaction check. Boots the real built admin app.js
 * in jsdom (same chain as tri998-render-check), then:
 *   1. Renders <RequestsAdmin> (fixture mode) and asserts the inbox lists the
 *      custom-date requests with their status chips and the "N new" count.
 *   2. Drives the row-action menu to advance a status (New → Contacted), copy a
 *      secure booking link (asserts a working ?t= URL), and dismiss with a reason
 *      (New/whatever → Closed) — the three load-bearing row actions.
 *   3. Renders <DeparturesAdmin> with an unlisted departure and asserts the
 *      "Unlisted" badge renders on that row.
 * Fixture (USE_LIVE_API off) is the right harness: TK_ADMIN_ACT runs the optimistic
 * mutation synchronously, so the request status transitions are deterministic.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = join(ROOT, "apps", "admin", "dist");
const scripts = [
  "vendor/react.production.min.js", "vendor/react-dom.production.min.js",
  "_ds_bundle.js", "config.js", "data/data.js", "data/admin-data.js",
  "tk-api.js", "tk-boot.js", "app.js",
];

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.detail || e));
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { runScripts: "outside-only", pretendToBeVisual: true, url: "https://admin.dev.tripkoach.com/", virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
let opened = [];
window.open = (u) => { opened.push(u); return null; };
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
// clipboard stub so copyText() succeeds and we can assert what was copied
let clipboard = "";
window.navigator.clipboard = { writeText: (t) => { clipboard = String(t); return Promise.resolve(); } };
for (const s of scripts) window.eval(readFileSync(join(dist, s), "utf8"));
await sleep(150);

const React = window.React, ReactDOM = window.ReactDOM;
window.TK_CONFIG = window.TK_CONFIG || {};
window.TK_CONFIG.USE_LIVE_API = false; // fixture mode: optimistic writes apply synchronously

let ok = true;
function check(label, cond) { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; }
function fire(el, type) { el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window })); }
function click(el) { fire(el, "mousedown"); fire(el, "mouseup"); fire(el, "click"); }
function byText(root, re, sel) { return [...root.querySelectorAll(sel || "*")].find((e) => re.test((e.textContent || "").trim())); }

// ---- 1. Requests inbox renders ------------------------------------------------
const host = document.createElement("div");
document.body.appendChild(host);
ReactDOM.createRoot(host).render(React.createElement(window.RequestsAdmin, { go: () => {} }));
await sleep(250);
let txt = host.textContent || "";
console.log("[TRI-1139] Requests inbox:");
check("lists 5 requests", /5 requests/.test(txt));
check("shows customer Ama Mensah", /Ama Mensah/.test(txt));
check("shows customer Marcus Bell", /Marcus Bell/.test(txt));
check('status chip "New"', /New/.test(txt));
check('status chip "Contacted"', /Contacted/.test(txt));
check('status chip "Scheduled"', /Scheduled/.test(txt));
check('status chip "Booked"', /Booked/.test(txt));
check('status chip "Closed"', /Closed/.test(txt));
check('"1 new" summary badge', /1\s*new/.test(txt));

// ---- 2. Row actions ----------------------------------------------------------
function openMenu(rowName) {
  const btn = host.querySelector(`button[aria-label="Actions for ${rowName}"]`);
  if (!btn) throw new Error("no kebab for " + rowName);
  click(btn);
}
function menuItem(re) {
  const it = byText(document.body, re, '[role="menuitem"]');
  if (!it) throw new Error("no menu item " + re);
  return it;
}
const rq = () => window.TK_ADMIN.requests;
const amaBefore = rq().find((r) => r.customerName === "Ama Mensah").status || "new";

console.log("[TRI-1139] Advance status (Ama: new → contacted):");
openMenu("Ama Mensah"); await sleep(30);
click(menuItem(/Mark as contacted/)); await sleep(120);
check("Ama was new", amaBefore === "new");
check("Ama is now contacted", rq().find((r) => r.customerName === "Ama Mensah").status === "contacted");

console.log("[TRI-1139] Copy secure booking link (Marcus):");
openMenu("Marcus Bell"); await sleep(30);
click(menuItem(/Copy secure booking link/)); await sleep(150);
txt = document.body.textContent || "";
check("clipboard holds a /bookings/..?t= link", /\/bookings\/.+\?t=/.test(clipboard));
check("secure link points at consumer host (not admin.)", /^https?:\/\/(?!admin\.)/.test(clipboard) || /localhost/.test(clipboard));
check("link modal shows the URL", /Secure booking link/.test(txt));
// close modal
const done = byText(document.body, /^Done$/, "button"); if (done) { click(done); await sleep(60); }

console.log("[TRI-1139] Dismiss with reason (Kojo → Closed):");
openMenu("Kojo Asante"); await sleep(30);
click(menuItem(/Dismiss with reason/)); await sleep(120);
const reason = document.getElementById("req-reason");
check("dismiss modal has a reason field", !!reason);
if (reason) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(reason, "Dates no longer available");
  reason.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(60);
}
const dismissBtn = byText(document.body, /^Dismiss request$/, "button");
check("dismiss confirm button present", !!dismissBtn);
if (dismissBtn) { click(dismissBtn); await sleep(150); }
const kojo = rq().find((r) => r.customerName === "Kojo Asante");
check("Kojo is now closed", kojo.status === "closed");
check("Kojo close reason stored", kojo.closeReason === "Dates no longer available");

// ---- 3. Unlisted departure badge ---------------------------------------------
console.log("[TRI-1139] Departures list — Unlisted badge:");
// Seed one unlisted departure onto the fixture set.
window.TK_ADMIN.departures.unshift({
  id: "unlisted-check", tourId: window.TK_ADMIN.tours[0].id, tour: "Private hold tour", region: "Greater Accra",
  date: "Sat 10 Oct 2026", time: "09:00", price: 100, currency: "USD", capacity: 4, booked: 1, spotsLeft: 3,
  status: "scheduled", visibility: "unlisted",
});
const dhost = document.createElement("div");
document.body.appendChild(dhost);
ReactDOM.createRoot(dhost).render(React.createElement(window.DeparturesAdmin, { go: () => {}, state: {}, setState: () => {} }));
await sleep(250);
const dtxt = dhost.textContent || "";
check('renders an "Unlisted" badge', /Unlisted/.test(dtxt));
check("public rows are NOT all badged unlisted", (dtxt.match(/Unlisted/g) || []).length === 1);

if (errors.length) { console.error("jsdom errors: " + errors.map(String).join(" | ")); ok = false; }
console.log(ok ? "\n[TRI-1139] render-check PASS" : "\n[TRI-1139] render-check FAIL");
process.exit(ok ? 0 : 1);
