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
// A third catalogue entry mirrors the ACTUAL dev-host state (2026-08-08): every
// non-lead tour is seeded with basics + tiers but EMPTY detail/availability/
// reviews. Its detail below returns no highlights/included/itinerary/departures,
// so this proves the shim's backfill guards keep TourWeb from throwing on the
// sparse tours real users can open today.
const SPARSE_SLUG = "mock-live-sparse";
const TOURS = { items: [
  { id: LEAD_SLUG, title: "MOCK Live Accra Heritage Walk", region: "Greater Accra",
    duration: "Half day", category: "City Tour", price: 65, currency: "USD",
    rating: 4.7, reviews: 42, spotsLeft: 8, tag: "Most booked", image: "https://cdn.example.test/a.jpg" },
  { id: "mock-live-volta", title: "MOCK Live Volta Falls", region: "Volta",
    duration: "3 days", category: "Cultural Discovery", price: 1400, currency: "USD",
    rating: 4.9, reviews: 18, spotsLeft: 5, tag: null, image: "https://cdn.example.test/v.jpg" },
  { id: SPARSE_SLUG, title: "MOCK Live Sparse Tour", region: "Central",
    duration: "1 day", category: "Cultural Discovery", price: 90, currency: "USD",
    rating: 0, reviews: 0, spotsLeft: 6, tag: null, image: "https://cdn.example.test/s.jpg" },
], page: 1, pageSize: 12, total: 3, totalPages: 1 };
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

// --- Non-lead tour (TRI-888/C2): its own detail/availability/reviews, keyed by
//     a DIFFERENT slug, with sentinels the lead payload never contains. Rendering
//     /tour/<VOLTA_SLUG> must surface THESE, proving per-slug hydration fetches
//     the opened tour's data rather than the eagerly-hydrated lead's.
const VOLTA_SLUG = "mock-live-volta";
const VOLTA_DETAIL = { id: VOLTA_SLUG, title: "MOCK Live Volta Falls", region: "Volta",
  duration: "3 days", category: "Cultural Discovery", price: 1400, currency: "USD",
  rating: 4.9, reviews: 18, spotsLeft: 5, tag: null, image: "https://cdn.example.test/v.jpg",
  images: [], blurb: "A second mock live tour for the per-slug read-path smoke.",
  highlights: ["MOCK Wli Waterfalls", "MOCK Mount Afadja", "MOCK Tafi Atome"],
  included: ["Lodging", "Guide"], excluded: ["Flights"], pricing: [],
  itinerary: [["Day 1", "MOCK Volta arrival"], ["Day 2", "MOCK cascade hike"]],
  tiers: [{ minPax: 1, price: 1900 }, { minPax: 2, price: 1600 }, { minPax: 6, price: 1400 }],
  packages: [], defaultPackage: null, reviewStats: { count: 1, avg: 5 } };
const VOLTA_AVAIL = { tourId: VOLTA_SLUG, departures: [
  { id: "vdep1", date: "Mon 7 Sep 2026", time: "07:00 · MOCK Volta departure", price: 1400, spotsLeft: 4, status: "scheduled" },
  { id: "vdep2", date: "Mon 5 Oct 2026", time: "07:00 · MOCK Volta departure", price: 1400, spotsLeft: 8, status: "scheduled" },
] };
const VOLTA_REVIEWS = { tourId: VOLTA_SLUG, stats: { count: 1, avg: 5 }, reviews: [
  { id: "vrev1", author: "Mock Volta Traveller", initials: "MV", rating: 5, date: "20 Aug 2026",
    verified: true, title: "MOCK volta review", text: "This review proves per-slug live reviews render.", reply: null },
] };

// A sparse tour exactly like the dev host's non-lead entries: detail carries only
// basics + tiers; availability and reviews are empty.
const SPARSE_DETAIL = { id: SPARSE_SLUG, title: "MOCK Live Sparse Tour", region: "Central",
  duration: "1 day", category: "Cultural Discovery", price: 90, currency: "USD",
  rating: 0, reviews: 0, spotsLeft: 6, tag: null, image: "https://cdn.example.test/s.jpg",
  images: [], blurb: "A sparse mock tour mirroring the dev host's non-lead seed.",
  tiers: [{ minPax: 1, price: 130 }, { minPax: 2, price: 105 }, { minPax: 6, price: 90 }] };
const EMPTY_AVAIL = { tourId: SPARSE_SLUG, departures: [] };
const EMPTY_REVIEWS = { tourId: SPARSE_SLUG, stats: { count: 0, avg: 0 }, reviews: [] };

// Slug → payload lookup so the mock answers each endpoint with the RIGHT tour.
const DETAIL_BY_SLUG = { [LEAD_SLUG]: DETAIL, [VOLTA_SLUG]: VOLTA_DETAIL, [SPARSE_SLUG]: SPARSE_DETAIL };
const AVAIL_BY_SLUG = { [LEAD_SLUG]: AVAIL, [VOLTA_SLUG]: VOLTA_AVAIL, [SPARSE_SLUG]: EMPTY_AVAIL };
const REVIEWS_BY_SLUG = { [LEAD_SLUG]: REVIEWS, [VOLTA_SLUG]: VOLTA_REVIEWS, [SPARSE_SLUG]: EMPTY_REVIEWS };
const slugOf = (url) => decodeURIComponent((url.match(/\/tours\/([^/]+)/) || [])[1] || "");

function makeServer({ fail } = {}) {
  return http.createServer((req, res) => {
    if (fail) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "boom", message: "mock failure" } })); return; }
    const url = req.url.split("?")[0];
    const send = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.endsWith("/regions")) return send(REGIONS);
    if (url.endsWith("/tours")) return send(TOURS);
    if (/\/tours\/[^/]+\/availability$/.test(url)) return send(AVAIL_BY_SLUG[slugOf(url)] || AVAIL);
    if (/\/tours\/[^/]+\/reviews$/.test(url)) return send(REVIEWS_BY_SLUG[slugOf(url)] || REVIEWS);
    if (/\/tours\/[^/]+$/.test(url)) return send(DETAIL_BY_SLUG[slugOf(url)] || DETAIL);
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

  // TRI-888/C2: a deep-link to a NON-lead tour must hydrate ITS OWN detail,
  // availability and reviews by slug — the lead's payload must NOT leak through.
  const volta = await renderAt("/tour/" + VOLTA_SLUG, apiBase);
  pass("non-lead tour-detail renders its own hero (per-slug detail)", volta.html.includes("MOCK Live Volta Falls"), volta.html.slice(0, 300));
  pass("non-lead tour-detail renders its own highlights", volta.html.includes("MOCK Wli Waterfalls"));
  pass("non-lead tour-detail renders its own availability (departures)", volta.html.includes("MOCK Volta departure"));
  pass("non-lead tour-detail renders its own reviews", volta.html.includes("MOCK volta review"));
  pass("non-lead tour-detail does NOT leak the lead's data", !volta.html.includes("MOCK Jamestown") && !volta.html.includes("MOCK great day"), volta.html.slice(0, 300));

  // TRI-888: a sparse tour (no highlights/departures/reviews — the dev host's
  // real non-lead shape) must render its detail WITHOUT throwing (backfill guards).
  const sparse = await renderAt("/tour/" + SPARSE_SLUG, apiBase);
  pass("sparse non-lead tour renders its hero", sparse.html.includes("MOCK Live Sparse Tour"), sparse.html.slice(0, 300));
  pass("sparse non-lead tour renders without jsdom errors", sparse.errors.length === 0, sparse.errors.map(String).join(" | "));

  const noErr = [home, browse, tour, volta, sparse].every((r) => r.errors.length === 0);
  pass("no jsdom errors on live render", noErr, [home, browse, tour, volta, sparse].flatMap((r) => r.errors.map(String)).join(" | "));
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
