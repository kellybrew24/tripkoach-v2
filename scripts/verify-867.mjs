#!/usr/bin/env node
/**
 * TRI-867 verification harness (not part of the shipped app).
 *
 *  1. FLAG-OFF byte-identity: render the new build (USE_LIVE_API off) at each
 *     key route and diff #root against the snapshotted Phase-1 app.js render.
 *  2. LIVE pay-now checkout: flag on + mocked API, drive tour→checkout→Pay,
 *     assert the POST /bookings payload and the Paystack redirect.
 *  3. LIVE confirmation: flag on, land on /confirm?ref=…&reference=…, assert
 *     verify+poll reconciles to a paid confirmation with real booking data.
 *
 * Usage: node scripts/verify-867.mjs
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps/web/dist");
const SCRATCH = process.env.PAPERCLIP_SCRATCH_DIR || "/tmp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHAIN = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "_ds_bundle.js"];
const AFTER = ["data/data.js", "data/blog.js", "tk-api.js", "tk-booking.js", "tk-boot.js"];

function baseWindow(url) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.detail || e));
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc, url,
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  return { window, errors };
}

function runScripts(window, files, appJs, configJs) {
  window.eval(configJs);
  for (const f of CHAIN) window.eval(readFileSync(join(DIST, f), "utf8"));
  for (const f of AFTER) window.eval(readFileSync(join(DIST, f), "utf8"));
  window.eval(appJs);
}

const CONFIG_OFF = `window.TK_CONFIG={apiBase:"/api/v1",env:"test",USE_LIVE_API:false};`;
const CONFIG_ON = `window.TK_CONFIG={apiBase:"/api/v1",env:"test",USE_LIVE_API:true};`;

// ---- 1. FLAG-OFF byte-identity ---------------------------------------------
async function renderOff(appJs, path) {
  const { window } = baseWindow("https://dev.tripkoach.com" + path);
  runScripts(window, AFTER, appJs, CONFIG_OFF);
  await sleep(180);
  return window.document.getElementById("root").innerHTML;
}

async function testByteIdentical() {
  const newApp = readFileSync(join(DIST, "app.js"), "utf8");
  const oldApp = readFileSync(join(SCRATCH, "app.phase1.js"), "utf8");
  const paths = ["/", "/browse", "/tour", "/checkout", "/confirm", "/bookings", "/about"];
  let ok = true;
  for (const p of paths) {
    const a = await renderOff(newApp, p);
    const b = await renderOff(oldApp, p);
    const same = a === b;
    if (!same) ok = false;
    console.log(`  [byte-identical] ${p.padEnd(10)} ${same ? "IDENTICAL" : "DIFF (" + a.length + " vs " + b.length + "b)"}`);
  }
  return ok;
}

// ---- mocked API ------------------------------------------------------------
function makeFetchMock(state) {
  const TOURS = { tours: [{ slug: "accra-city-tour", id: "uuid-tour-1", title: "Accra City Tour", region: "Greater Accra", duration: "Half day", price: 65, currency: "USD", rating: 4.8, reviews: 12, spotsLeft: 8, featured: true, image: "x.jpg", blurb: "See Accra." }] };
  const DETAIL = { highlights: ["Independence Arch", "Makola Market"], included: ["Guide", "Water"], excluded: ["Lunch"], itinerary: [["09:00", "Pickup"], ["12:00", "Return"]] };
  const AVAIL = { departures: [{ id: "dep-1", date: "2026-08-22", time: "09:00", price: 65, spotsLeft: 8 }, { id: "dep-2", date: "2026-08-29", time: "09:00", price: 65, spotsLeft: 6 }] };
  const PAID = { ref: "TK-9001", status: "confirmed", payment_state: "paid", currency: "USD", unit_price_minor: 6500, total_minor: 26000, party_size: 4, tour_title: "Accra City Tour", departure_label: "Fri 29 Aug 2026, 09:00", email: "ama@example.com" };
  const json = (body, ok = true, status = 200) => Promise.resolve({
    ok, status, headers: { get: (h) => (/content-type/i.test(h) ? "application/json" : null) },
    json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)),
  });
  return function (url, init) {
    const u = String(url); const method = (init && init.method) || "GET";
    if (method === "POST" && /\/bookings$/.test(u)) { state.bookingBody = JSON.parse(init.body); return json({ ref: "TK-9001", status: "reserved", payment_state: "unpaid", currency: "USD", unit_price_minor: 6500, total_minor: 26000, party_size: state.bookingBody.partySize }); }
    if (method === "POST" && /\/payment\/init$/.test(u)) { state.initBody = JSON.parse(init.body); return json({ authorization_url: "https://checkout.paystack.com/xyz", access_code: "acc_1", reference: "ps_ref_1", public_key: "pk_test_1" }); }
    if (method === "POST" && /\/payment\/verify$/.test(u)) { state.verifyBody = JSON.parse(init.body); return json(PAID); }
    if (/\/bookings\/TK-9001$/.test(u)) return json(PAID);
    if (/\/regions$/.test(u)) return json(["Greater Accra"]);
    if (/\/tours\/accra-city-tour$/.test(u)) return json(DETAIL);
    if (/\/tours\/uuid-tour-1\/availability$/.test(u)) return json(AVAIL);
    if (/\/tours\/uuid-tour-1\/reviews$/.test(u)) return json({ reviews: [] });
    if (/\/tours$/.test(u)) return json(TOURS);
    return json({ error: { code: "not_found", message: "no route " + u } }, false, 404);
  };
}

function clickByText(window, text) {
  const btns = [...window.document.querySelectorAll("button")];
  const el = btns.find((b) => (b.textContent || "").includes(text));
  if (!el) throw new Error(`button "${text}" not found; have: ${btns.map((b) => JSON.stringify(b.textContent)).join(", ")}`);
  el.dispatchEvent(new window.Event("click", { bubbles: true }));
  return el;
}

// ---- 2. LIVE pay-now checkout ----------------------------------------------
async function testLiveCheckout() {
  const appJs = readFileSync(join(DIST, "app.js"), "utf8");
  const state = {};
  const { window } = baseWindow("https://dev.tripkoach.com/checkout");
  window.fetch = makeFetchMock(state);
  let navigated = null;
  runScripts(window, AFTER, appJs, CONFIG_ON);
  // jsdom won't let us intercept location.assign, so capture the URL the app
  // hands to the redirect helper (proves it received Paystack's authorization_url).
  window.TK_BOOKING.redirect = (init) => { navigated = init && init.authorizationUrl; return !!(init && init.authorizationUrl); };
  await sleep(250); // tk-boot live hydrate
  // TourWeb would set this; we're deep-linking to /checkout so set it directly.
  window.TK_SEL = { tourId: "accra-city-tour", apiTourId: "uuid-tour-1", packageId: undefined, packageName: undefined, departureId: "d2" };
  // Re-render checkout now that TK_SEL exists: navigate away and back.
  window.history.pushState({}, "", "/"); window.dispatchEvent(new window.PopStateEvent("popstate"));
  await sleep(60);
  window.history.pushState({}, "", "/checkout"); window.dispatchEvent(new window.PopStateEvent("popstate"));
  await sleep(80);
  // Advance step 1→2→3 (WebApp starts at step 1).
  clickByText(window, "Continue"); await sleep(40);
  clickByText(window, "Continue"); await sleep(40);
  // Choose "Pay now" (controlled radio — React's change plugin fires on click).
  const payNow = window.document.getElementById("pay-now"); payNow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(40);
  clickByText(window, "Pay "); // "Pay $260 with Paystack"
  await sleep(120);

  const b = state.bookingBody || {};
  const checks = [
    ["POST /bookings sent", !!state.bookingBody],
    ["tourId = uuid-tour-1", b.tourId === "uuid-tour-1"],
    ["departureId resolved to real dep-2", b.departureId === "dep-2"],
    ["partySize = 4", b.partySize === 4],
    ["travellers length = 4", Array.isArray(b.travellers) && b.travellers.length === 4],
    ["lead traveller flagged", b.travellers && b.travellers[0] && b.travellers[0].lead === true],
    ["agreedTerms true", b.agreedTerms === true],
    ["payMode now", b.payMode === "now"],
    ["payment init called", !!state.initBody],
    ["init callbackUrl carries ref", !!(state.initBody && /ref=TK-9001/.test(state.initBody.callbackUrl || ""))],
    ["redirected to Paystack", navigated === "https://checkout.paystack.com/xyz"],
  ];
  let ok = true;
  for (const [label, pass] of checks) { if (!pass) ok = false; console.log(`  [checkout] ${pass ? "PASS" : "FAIL"} — ${label}`); }
  if (!ok) console.log("    bookingBody:", JSON.stringify(state.bookingBody), "nav:", navigated);
  return ok;
}

// ---- 3. LIVE confirmation ---------------------------------------------------
async function testLiveConfirm() {
  const appJs = readFileSync(join(DIST, "app.js"), "utf8");
  const state = {};
  const { window } = baseWindow("https://dev.tripkoach.com/confirm?ref=TK-9001&reference=ps_ref_1");
  window.fetch = makeFetchMock(state);
  runScripts(window, AFTER, appJs, CONFIG_ON);
  await sleep(400); // settle: verify + poll
  const html = window.document.getElementById("root").innerHTML;
  const checks = [
    ["verify called with paystack reference", state.verifyBody && state.verifyBody.reference === "ps_ref_1"],
    ["shows booking ref TK-9001", html.includes("TK-9001")],
    ["success headline", html.includes("You&#x27;re all set") || html.includes("You're all set")],
    ["payment-received alert", html.includes("Payment received")],
    ["real total $260", html.includes("260")],
    ["real tour title", html.includes("Accra City Tour")],
  ];
  let ok = true;
  for (const [label, pass] of checks) { if (!pass) ok = false; console.log(`  [confirm] ${pass ? "PASS" : "FAIL"} — ${label}`); }
  if (!ok) console.log("    html snippet:", html.slice(0, 400));
  return ok;
}

(async () => {
  console.log("== 1. FLAG-OFF byte-identity vs Phase-1 ==");
  const t1 = await testByteIdentical();
  console.log("== 2. LIVE pay-now checkout ==");
  const t2 = await testLiveCheckout();
  console.log("== 3. LIVE confirmation ==");
  const t3 = await testLiveConfirm();
  const ok = t1 && t2 && t3;
  console.log(`\n== RESULT: ${ok ? "ALL PASS" : "FAIL"} ==`);
  process.exit(ok ? 0 : 1);
})();
