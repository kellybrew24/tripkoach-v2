#!/usr/bin/env node
/**
 * TRI-998 targeted render check. Boots the real built web app.js in jsdom (same
 * chain as smoke.mjs), then renders <TourWeb> in LIVE mode against (a) a tour with
 * ZERO bookable departures and (b) a tour WITH departures, asserting the empty
 * state / picker swap behaves and the normal path is unaffected.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = join(ROOT, "apps", "web", "dist");
const scripts = [
  "vendor/react.production.min.js", "vendor/react-dom.production.min.js",
  "_ds_bundle.js", "config.js", "data/data.js", "data/blog.js",
  "tk-api.js", "tk-booking.js", "tk-auth.js", "tk-reviews.js", "tk-boot.js", "app.js",
];

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.detail || e));
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
window.open = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
for (const s of scripts) window.eval(readFileSync(join(dist, s), "utf8"));
await sleep(150);

const React = window.React, ReactDOM = window.ReactDOM;
window.TK_CONFIG = window.TK_CONFIG || {};
window.TK_CONFIG.USE_LIVE_API = true; // exercise the live branch (empty-state + d2-kill)

function baseTour(over) {
  return Object.assign({
    id: "x", slug: "x", _apiId: "x-uuid", title: "Render Check Tour", region: "Greater Accra",
    duration: "Half day", category: "City Tour", price: 100, currency: "USD", blurb: "Blurb.",
    image: null, images: [], highlights: ["Highlight one"], included: ["Included one"], excluded: [],
    itinerary: [["09:00", "Depart"]], tiers: [{ minPax: 1, price: 100 }, { minPax: 2, price: 75 }],
    departures: [], _hydrated: true, reviews: 0, rating: null,
  }, over);
}

async function render(tour) {
  const tours = window.TK_DATA.tours;
  const i = tours.findIndex((t) => t.id === tour.id);
  if (i >= 0) tours.splice(i, 1);
  tours.unshift(tour);
  const c = document.createElement("div");
  document.body.appendChild(c);
  ReactDOM.createRoot(c).render(React.createElement(window.TourWeb, { go: () => {}, currency: "USD", slug: tour.id }));
  await sleep(200);
  return c.textContent || "";
}

let ok = true;
function check(label, cond) { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; }

console.log("[TRI-998] LIVE mode, tour with ZERO bookable departures:");
const empty = await render(baseTour({ id: "empty-x", slug: "empty-x", departures: [] }));
check('shows "No upcoming departures"', /No upcoming departures/.test(empty));
check('shows "Enquire about dates" CTA', /Enquire about dates/.test(empty));
check('shows WhatsApp CTA', /Message a koach on WhatsApp/.test(empty));
check('NO "Reserve my spot" button', !/Reserve my spot/.test(empty));
check('NO "Choose a departure" picker legend', !/Choose a departure/.test(empty));

console.log("[TRI-998] LIVE mode, tour WITH bookable departures (regression):");
const full = await render(baseTour({
  id: "full-x", slug: "full-x",
  departures: [
    { id: "dA", date: "Sat 20 Sep 2026", time: "09:00", price: 100, spotsLeft: 6, status: "scheduled" },
    { id: "dB", date: "Sat 27 Sep 2026", time: "09:00", price: 100, spotsLeft: 3, status: "scheduled" },
  ],
}));
check('shows "Reserve my spot"', /Reserve my spot/.test(full));
check('shows "Choose a departure"', /Choose a departure/.test(full));
check('NO "No upcoming departures"', !/No upcoming departures/.test(full));

if (errors.length) { console.error("jsdom errors: " + errors.map(String).join(" | ")); ok = false; }
console.log(ok ? "\n[TRI-998] render-check PASS" : "\n[TRI-998] render-check FAIL");
process.exit(ok ? 0 : 1);
