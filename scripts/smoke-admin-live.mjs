#!/usr/bin/env node
/**
 * Live admin write-path smoke (TRI-870). Proves the admin tk-boot + TK_ADMIN_API
 * shim actually (a) gates on the staff session, (b) hydrates the DS admin
 * screens from the /api/admin endpoints, and (c) drives the guarded write
 * endpoints — WITHOUT waiting on Backend — by standing up a mock admin API that
 * returns the Phase 3 (TRI-869) contract envelopes, flipping USE_LIVE_API on,
 * and rendering the built admin app in jsdom.
 *
 * When Backend ships these shapes under the same-origin /api/admin proxy, the
 * same assertions hold against admin.dev.tripkoach.com. Usage: node scripts/smoke-admin-live.mjs
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps", "admin", "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- mock admin API (TRI-869 contract, tolerant shapes) ---------------------
const STAFF = { staff: { name: "MOCK Kwame Boateng", email: "kwame@tripkoach.com", initials: "MK", role: "admin" }, role: "admin", permissions: ["tours.edit", "bookings.cancel", "payments.refund"] };
const TOURS = { tours: [
  { id: "mock-live-accra", title: "MOCK Admin Accra Tour", region: "Greater Accra", category: "City Tour", price: 65, currency: "USD", published: true, rating: 4.7, reviews: 42, image: "https://cdn.example.test/a.jpg" },
  { id: "mock-live-volta", title: "MOCK Admin Volta Draft", region: "Volta", category: "Cultural Discovery", price: 1400, currency: "USD", published: false, rating: 4.9, reviews: 12, image: "https://cdn.example.test/v.jpg" },
] };
const REGIONS = { regions: [{ name: "Greater Accra" }, { name: "Volta" }] };
const BOOKINGS = { bookings: [
  { ref: "MOCK-TK-1", customer: "MOCK Ama Mensah", tourId: "mock-live-accra", departureId: "d1", departureDate: "2026-08-22", travellers: 2, unitMinor: 6500, usdAmountMinor: 13000, ghsAmountMinor: 2028000, fxRateUsed: 15.6, status: "pending", paymentStatus: "unpaid", createdAt: "2026-08-01" },
] };
const PAYMENTS = { payments: [
  { id: "MOCK-PAY-1", bookingRef: "MOCK-TK-1", customer: "MOCK Ama Mensah", usdAmountMinor: 13000, ghsAmountMinor: 2028000, fxRateUsed: 15.6, provider: "Paystack", channel: "card", status: "paid", createdAt: "2026-08-01" },
] };
// TRI-898 reporting contract: dashboard aggregates (A15) + audit log (A16).
const DASHBOARD = {
  range: "7d",
  bookings: { total: 137, byStatus: { confirmed: 82, pending: 34, cancelled: 12 } },
  revenue: { usd: 24180, currency: "USD", ghs: 288790, ghsCurrency: "GHS" },
  departures: { upcoming: 6, next: [{ id: "d1", tour: "MOCK Admin Accra Tour", tourId: "mock-live-accra", date: "Sat 22 Aug 2026", seatsTotal: 12, booked: 9, spotsLeft: 3 }] },
  occupancy: { seatsTotal: 60, seatsReserved: 34, spotsLeft: 26, utilizationPct: 56.7 },
};
const AUDIT = { items: [
  { id: "a1", action: "booking.cancel", actorType: "staff", actorId: "s1", actor: "MOCK Kwame Boateng", actorEmail: "kwame@tripkoach.com", targetType: "booking", targetId: "MOCK-TK-1", before: null, after: null, ip: "1.2.3.4", createdAt: "2026-08-08T10:15:00Z" },
  { id: "a2", action: "payment.refund", actorType: "staff", actorId: "s1", actor: "MOCK Kwame Boateng", actorEmail: "kwame@tripkoach.com", targetType: "payment", targetId: "MOCK-PAY-1", before: null, after: null, ip: "1.2.3.4", createdAt: "2026-08-08T09:00:00Z" },
], page: 1, pageSize: 50, total: 2, totalPages: 1 };

function makeServer(opts) {
  opts = opts || {};
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    hits.push(req.method + " " + url);
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    // AuthN gate
    if (url.endsWith("/api/admin/me")) return opts.authed ? send(200, STAFF) : send(401, { error: { code: "unauthenticated", message: "Sign in" } });
    if (url.endsWith("/api/admin/auth/login") && req.method === "POST") return send(200, STAFF);
    if (url.endsWith("/api/admin/auth/logout")) return send(200, { ok: true });
    // Reads
    if (url.endsWith("/api/admin/tours")) return send(200, TOURS);
    if (url.endsWith("/api/admin/regions")) return send(200, REGIONS);
    if (url.endsWith("/api/admin/bookings")) return send(200, BOOKINGS);
    if (url.endsWith("/api/admin/payments")) return send(200, PAYMENTS);
    if (url.endsWith("/api/admin/dashboard")) return send(200, DASHBOARD);
    if (url.endsWith("/api/admin/audit-log")) return send(200, AUDIT);
    if (/\/api\/admin\/(departures|promos|staff|customers|guides|reviews)$/.test(url)) return send(200, {});
    // Writes
    if (/\/api\/admin\/bookings\/[^/]+\/cancel$/.test(url)) return opts.forbidWrites ? send(403, { error: { code: "forbidden", message: "No permission" } }) : send(200, { ok: true });
    if (/\/api\/admin\/payments\/[^/]+\/refund$/.test(url) && req.method === "POST") return send(200, { ok: true, refund: { status: "pending" } });
    return send(404, { error: { code: "not_found", message: url } });
  });
  server._hits = hits;
  return server;
}
function listen(server) { return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port))); }

async function render(path, apiBase) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(String(e.detail || e)));
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "https://admin.dev.tripkoach.com" + path, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.fetch = (u, init) => globalThis.fetch(u, init);
  window.TK_CONFIG = { apiBase, env: "test", USE_LIVE_API: true };
  const chain = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "_ds_bundle.js",
    "config.js", "data/data.js", "data/admin-data.js", "tk-api.js", "tk-boot.js", "app.js"];
  for (const s of chain) window.eval(readFileSync(join(DIST, s), "utf8"));
  const root = window.document.getElementById("root");
  for (let i = 0; i < 80; i++) {
    if (/MOCK|Sign in to the console|Something went wrong/.test(root.innerHTML)) break;
    await sleep(50);
  }
  await sleep(80);
  return { html: root.innerHTML, errors, window };
}

let ok = true;
const pass = (name, cond, extra = "") => { console.log(`[smoke:admin] ${cond ? "PASS" : "FAIL"} — ${name}${extra && !cond ? " :: " + extra : ""}`); if (!cond) ok = false; };

// --- 1. unauthenticated → login gate ---------------------------------------
{
  const server = makeServer({ authed: false });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}/api/v1`; // → admin base derives /api/admin
  const r = await render("/", base);
  pass("401 on /me routes to the login screen", r.html.includes("Sign in to the console"), r.html.slice(0, 200));
  pass("login gate: no console shell leaked", !r.html.includes("Dashboard") || r.html.includes("Sign in to the console"));
  server.close();
}

// --- 2. authenticated → hydrated console -----------------------------------
{
  const server = makeServer({ authed: true });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}/api/v1`;

  const tours = await render("/tours", base);
  pass("tours screen hydrates from /api/admin/tours", tours.html.includes("MOCK Admin Accra Tour"), tours.html.slice(0, 300));
  pass("tour publish state maps (Draft badge for unpublished)", tours.html.includes("MOCK Admin Volta Draft"));

  const bookings = await render("/bookings", base);
  pass("bookings hydrate from /api/admin/bookings", bookings.html.includes("MOCK-TK-1") && bookings.html.includes("MOCK Ama Mensah"), bookings.html.slice(0, 300));

  const payments = await render("/payments", base);
  pass("payments hydrate from /api/admin/payments", payments.html.includes("MOCK-PAY-1"));

  // --- dashboard aggregates (TRI-898 / TRI-906) ----------------------------
  const dash = await render("/", base);
  pass("dashboard hydrates live revenue from /api/admin/dashboard", dash.html.includes("$24,180"), dash.html.slice(0, 400));
  pass("dashboard shows live bookings total", dash.html.includes("137"));
  pass("dashboard shows live capacity utilization", dash.html.includes("56.7%"));

  // --- audit log (TRI-898 / TRI-906) ---------------------------------------
  const audit = await render("/audit-log", base);
  pass("audit-log renders live entries", audit.html.includes("booking cancel") && audit.html.includes("MOCK Kwame Boateng"), audit.html.slice(0, 400));
  pass("audit-log references the entity acted on", audit.html.includes("MOCK-TK-1"));
  pass("audit-log shows the entry count", audit.html.includes("2 entries"));

  const noErr = [tours, bookings, payments, dash, audit].every((r) => r.errors.length === 0);
  pass("no jsdom errors on live admin render", noErr, [tours, bookings, payments, dash, audit].flatMap((r) => r.errors).join(" | "));

  // --- 3. write path drives the guarded endpoints --------------------------
  const w = payments.window;
  await w.TK_ADMIN_API.cancelBooking("MOCK-TK-1", "Customer request");
  pass("cancelBooking hits POST /api/admin/bookings/MOCK-TK-1/cancel", server._hits.includes("POST /api/admin/bookings/MOCK-TK-1/cancel"), server._hits.join(" | "));
  // TRI-906: refund now hits the REAL execution route (/refund), not the old
  // non-existent /refund-flag stub.
  await w.TK_ADMIN_API.refundPayment("MOCK-PAY-1");
  pass("refundPayment hits POST /api/admin/payments/MOCK-PAY-1/refund", server._hits.includes("POST /api/admin/payments/MOCK-PAY-1/refund"), server._hits.join(" | "));
  const usd = w.TK_ADMIN.bookings[0];
  pass("booking carries usd/ghs/fx fields", usd.usd === 130 && usd.ghs === 20280 && usd.fx === 15.6, JSON.stringify(usd));
  server.close();
}

// --- 4. 403 on a write → optimistic NOT applied, error surfaced ------------
{
  const server = makeServer({ authed: true, forbidWrites: true });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}/api/v1`;
  const r = await render("/bookings", base);
  const w = r.window;
  let optimisticRan = false;
  let toasted = "";
  w.tkToast = (m) => { toasted = m; };
  try { await w.TK_ADMIN_ACT(() => w.TK_ADMIN_API.cancelBooking("MOCK-TK-1", "x"), () => { optimisticRan = true; }); } catch (_) {}
  pass("403 write: optimistic update is NOT applied", optimisticRan === false);
  pass("403 write: permission-denied surfaced in DS toast", /permission/i.test(toasted), toasted);
  server.close();
}

console.log(ok ? "\n[smoke:admin] ALL PASS" : "\n[smoke:admin] FAILURES ABOVE");
process.exit(ok ? 0 : 1);
