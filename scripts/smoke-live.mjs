#!/usr/bin/env node
/**
 * Live read-path smoke (TRI-861). Proves the tk-api + tk-boot shim actually
 * hydrates the DS read screens from the API — WITHOUT waiting on Backend — by
 * standing up a mock server that returns the Phase 0 read-endpoint envelopes,
 * flipping USE_LIVE_API on, and rendering the built web app in jsdom at the
 * home / browse / tour routes. Asserts live-only sentinel strings appear (so we
 * know the data came from the mock API, not the fixtures) and that a forced API
 * failure renders the DS error state with a retry.
 *
 * This is the mechanical contract check: when Backend ships these shapes behind
 * the same-origin /api proxy, the same assertions hold against the real host.
 *
 * Usage: node scripts/smoke-live.mjs
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps", "web", "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Mock API mirroring Backend's ACTUAL read-endpoint DTOs -----------------
// Shapes copied from apps/api/src/{server,catalog}.ts so this smoke is a true
// contract check: /regions → {regions}, /tours → {items,...} (id = slug, price
// in MAJOR units), detail bare, availability/reviews → {tourId, ...}.
const LEAD_SLUG = "mock-live-accra";
const REGIONS = { regions: [
  { name: "Greater Accra", slug: "greater-accra", tourCount: 1, note: "The capital" },
  { name: "Central", slug: "central", tourCount: 0, note: "Cape Coast & Elmina" },
  { name: "Volta", slug: "volta", tourCount: 1, note: "Waterfalls" },
] };
const TOURS = { items: [
  { id: LEAD_SLUG, title: "MOCK Live Accra Heritage Walk", region: "Greater Accra",
    duration: "Half day", category: "City Tour", price: 65, currency: "USD",
    rating: 4.7, reviews: 42, spotsLeft: 8, tag: "Most booked", image: "https://cdn.example.test/a.jpg" },
  { id: "mock-live-volta", title: "MOCK Live Volta Falls", region: "Volta",
    duration: "3 days", category: "Cultural Discovery", price: 1400, currency: "USD",
    rating: 4.9, reviews: 18, spotsLeft: 5, tag: null, image: "https://cdn.example.test/v.jpg" },
], page: 1, pageSize: 12, total: 2, totalPages: 1 };
const DETAIL = { id: LEAD_SLUG, title: "MOCK Live Accra Heritage Walk", region: "Greater Accra",
  duration: "Half day", category: "City Tour", price: 65, currency: "USD",
  rating: 4.7, reviews: 42, spotsLeft: 8, tag: "Most booked", image: "https://cdn.example.test/a.jpg",
  images: [], blurb: "A mock live tour for the read-path smoke.",
  highlights: ["MOCK Independence Square", "MOCK Jamestown", "MOCK Makola Market"],
  included: ["Private transport", "Guide"], excluded: ["Tips"], pricing: [],
  itinerary: [["09:00", "MOCK pickup"], ["12:00", "MOCK market"]],
  tiers: [{ minPax: 1, price: 100 }, { minPax: 2, price: 75 }, { minPax: 6, price: 65 }],
  packages: [], defaultPackage: null, reviewStats: { count: 1, avg: 5 } };
const AVAIL = { tourId: LEAD_SLUG, departures: [
  { id: "dep1", date: "Sat 22 Aug 2026", time: "09:00 · Hotel pickup", price: 75, spotsLeft: 6, status: "scheduled" },
  { id: "dep2", date: "Sat 29 Aug 2026", time: "09:00 · Hotel pickup", price: 75, spotsLeft: 0, status: "scheduled" },
] };
const REVIEWS = { tourId: LEAD_SLUG, stats: { count: 1, avg: 5 }, reviews: [
  { id: "rev1", author: "Mock Traveller", initials: "MT", rating: 5, date: "18 Aug 2026",
    verified: true, title: "MOCK great day", text: "This review proves live reviews render.", reply: null },
] };

function makeServer({ fail } = {}) {
  return http.createServer((req, res) => {
    if (fail) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "boom", message: "mock failure" } })); return; }
    const url = req.url.split("?")[0];
    const send = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.endsWith("/regions")) return send(REGIONS);
    if (url.endsWith("/tours")) return send(TOURS);
    if (/\/tours\/[^/]+\/availability$/.test(url)) return send(AVAIL);
    if (/\/tours\/[^/]+\/reviews$/.test(url)) return send(REVIEWS);
    if (/\/tours\/[^/]+$/.test(url)) return send(DETAIL);
    res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "not_found", message: url } }));
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function renderAt(path, apiBase) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.detail || e));
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "https://dev.tripkoach.com" + path,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  // Real fetch from Node, bound to the window (tk-api uses window.fetch).
  window.fetch = (u, init) => globalThis.fetch(u, init);
  // Inject live config BEFORE the app scripts run.
  window.TK_CONFIG = { apiBase, env: "test", USE_LIVE_API: true };

  const chain = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "_ds_bundle.js",
    "config.js", "data/data.js", "data/blog.js", "tk-api.js", "tk-boot.js", "app.js"];
  for (const s of chain) window.eval(readFileSync(join(DIST, s), "utf8"));

  // Poll until the async boot + render settles.
  const root = window.document.getElementById("root");
  for (let i = 0; i < 60; i++) {
    if (/MOCK|Something went wrong/.test(root.innerHTML)) break;
    await sleep(50);
  }
  return { html: root.innerHTML, errors, window };
}

let ok = true;
const pass = (name, cond, extra = "") => { console.log(`[smoke:live] ${cond ? "PASS" : "FAIL"} — ${name}${extra && !cond ? " :: " + extra : ""}`); if (!cond) ok = false; };

// --- happy path -------------------------------------------------------------
{
  const server = makeServer();
  const port = await listen(server);
  const apiBase = `http://127.0.0.1:${port}/api/v1`;

  const home = await renderAt("/", apiBase);
  pass("home renders live catalogue", home.html.includes("MOCK Live Accra Heritage Walk"), home.html.slice(0, 300));
  pass("home stat shows live region count (3)", /MOCK/.test(home.html) && home.html.includes("3"), "");

  const browse = await renderAt("/browse", apiBase);
  pass("browse lists live tours", browse.html.includes("MOCK Live Accra Heritage Walk") && browse.html.includes("MOCK Live Volta Falls"));
  pass("browse derives filters from live regions (Volta)", browse.html.includes("Volta"));

  const tour = await renderAt("/tour", apiBase);
  pass("tour-detail renders live hero", tour.html.includes("MOCK Live Accra Heritage Walk"));
  pass("tour-detail renders live highlights", tour.html.includes("MOCK Jamestown"));
  pass("tour-detail renders live reviews", tour.html.includes("MOCK great day"));

  const noErr = [home, browse, tour].every((r) => r.errors.length === 0);
  pass("no jsdom errors on live render", noErr, [home, browse, tour].flatMap((r) => r.errors.map(String)).join(" | "));
  server.close();
}

// --- error path -------------------------------------------------------------
{
  const server = makeServer({ fail: true });
  const port = await listen(server);
  const apiBase = `http://127.0.0.1:${port}/api/v1`;
  const home = await renderAt("/", apiBase);
  pass("API failure renders DS error state + retry", home.html.includes("Something went wrong") && home.html.includes("Try again"), home.html.slice(0, 200));
  server.close();
}

console.log(ok ? "\n[smoke:live] ALL PASS" : "\n[smoke:live] FAILURES ABOVE");
process.exit(ok ? 0 : 1);
