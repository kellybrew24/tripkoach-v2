#!/usr/bin/env node
// TRI-1017 targeted render test: Browse controls.
// Renders the real built BrowseWeb screen in jsdom over a controlled catalogue,
// then asserts: (1) hero uses the real CDN image (no picsum), (2) the redundant
// hero "Search" button is gone, (3) no "Departing" date select in the filter
// rail, (4) the Sort select is wired — changing it reorders the tour cards.
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
window.scrollTo = () => {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
for (const s of scripts) {
  const code = readFileSync(join(dist, s), "utf8");
  try { window.eval(code); } catch (e) { console.error(`script ${s} threw:`, e.stack || e); process.exit(1); }
  // Neutralise the app's own boot (defined by tk-boot.js) so app.js does not
  // fetch/auto-mount over our controlled fixture below.
  if (s === "tk-boot.js") window.TK_BOOT = () => {};
}

// Controlled catalogue: distinct price + reviews + rating so each sort is unambiguous.
window.TK_DATA = window.TK_DATA || {};
window.TK_DATA.tours = [
  { id: "alpha", slug: "alpha", title: "Alpha Tour", region: "Accra", category: "City", duration: "Full day", price: 300, reviews: 5, rating: 4.2, image: null },
  { id: "bravo", slug: "bravo", title: "Bravo Tour", region: "Volta", category: "Nature", duration: "Full day", price: 100, reviews: 50, rating: 4.9, image: null },
  { id: "charlie", slug: "charlie", title: "Charlie Tour", region: "Cape Coast", category: "History", duration: "Half day", price: 800, reviews: 20, rating: 4.5, image: null },
];
window.TK_REGION_COUNT = () => 9;
window.tkToast = () => { throw new Error("tkToast fired — a control is still a toast stub"); };

const React = window.React, ReactDOM = window.ReactDOM;
const root = window.document.createElement("div");
window.document.body.appendChild(root);
const r = ReactDOM.createRoot(root);
const render = () => new Promise((res) => { r.render(React.createElement(window.BrowseWeb, { go: () => {}, currency: "USD", view: "ready", initialRegion: null })); setTimeout(res, 40); });

await render();

const fail = (m) => { console.error("FAIL:", m); process.exit(1); };
const titlesInOrder = () => Array.from(root.querySelectorAll(".tk-card__body")).map(b => (b.textContent.match(/(Alpha|Bravo|Charlie) Tour/) || [])[0]).filter(Boolean);

// 1. Hero image
const hero = root.querySelector('img[aria-hidden="true"]');
if (!hero) fail("no hero image element");
if (/picsum/.test(hero.src)) fail("hero still uses picsum placeholder");
if (!/cdn\.tripkoach\.com\/img\/tours\/discover-ghana-in-10-days\/hero-1440\.jpg/.test(hero.src)) fail("hero not the CDN url: " + hero.src);
console.log("PASS hero CDN image:", hero.src);

// 2. No redundant Search button (a live search field remains)
const btns = Array.from(root.querySelectorAll("button")).map(b => (b.textContent || "").trim());
if (btns.includes("Search")) fail("redundant Search button still present");
if (!root.querySelector('[role="search"]')) fail("live search field missing");
console.log("PASS Search button removed, live search field present");

// 3. No Departing date select
const selectLabels = Array.from(root.querySelectorAll("select")).map(s => s.getAttribute("aria-label") || "");
const h3s = Array.from(root.querySelectorAll("h3")).map(h => h.textContent.trim());
if (h3s.includes("Departing")) fail("Departing filter still present");
console.log("PASS no Departing filter; filter headings:", h3s.join(", "));

// 4. Sort select wired — verify each order
const sortSel = root.querySelector('select[aria-label="Sort"]');
if (!sortSel) fail("Sort select missing");
const setSort = (v) => { const nv = window.Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set; nv.call(sortSel, v); sortSel.dispatchEvent(new window.Event("change", { bubbles: true })); return new Promise(res => setTimeout(res, 40)); };

const cases = [
  ["pop",  ["Bravo Tour", "Charlie Tour", "Alpha Tour"], "most popular (reviews desc)"],
  ["rate", ["Bravo Tour", "Charlie Tour", "Alpha Tour"], "top rated (rating desc)"],
  ["pl",   ["Bravo Tour", "Alpha Tour", "Charlie Tour"], "price low→high"],
  ["ph",   ["Charlie Tour", "Alpha Tour", "Bravo Tour"], "price high→low"],
];
for (const [v, expected, label] of cases) {
  await setSort(v);
  const got = titlesInOrder();
  if (got.join("|") !== expected.join("|")) fail(`sort ${label}: expected ${expected.join(",")} got ${got.join(",")}`);
  console.log(`PASS sort ${label}: ${got.join(" > ")}`);
}

console.log("\nALL TRI-1017 CHECKS PASSED");
