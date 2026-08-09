#!/usr/bin/env node
/** TRI-998 admin render check: boots built admin app.js in jsdom, renders
 * <ToursAdmin> with a PUBLISHED tour that has 0 upcoming departures and asserts
 * the "No upcoming" guardrail badge shows; a tour with upcoming departures shows
 * its numeric count instead. */
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
  { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
for (const s of scripts) window.eval(readFileSync(join(dist, s), "utf8"));
await sleep(150);

const React = window.React, ReactDOM = window.ReactDOM;
const A = window.TK_ADMIN = window.TK_ADMIN || {};
A.tours = [
  { id: "pub-empty", slug: "pub-empty", title: "Published No Upcoming", region: "Greater Accra",
    category: "City Tour", price: 100, currency: "USD", rating: 4.5, image: null,
    departures: 2, upcomingDepartures: 0 },              // published (unknown slug ⇒ true), 0 upcoming
  { id: "pub-ok", slug: "pub-ok", title: "Published With Upcoming", region: "Greater Accra",
    category: "City Tour", price: 100, currency: "USD", rating: 4.7, image: null,
    departures: 5, upcomingDepartures: 3 },
];

const c = document.createElement("div");
document.body.appendChild(c);
ReactDOM.createRoot(c).render(React.createElement(window.ToursAdmin, { go: () => {}, state: {}, setState: () => {} }));
await sleep(200);
const txt = c.textContent || "";

let ok = true;
function check(label, cond) { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; }
console.log("[TRI-998] admin ToursAdmin render:");
check('shows both tour rows', /Published No Upcoming/.test(txt) && /Published With Upcoming/.test(txt));
check('shows "No upcoming" guardrail badge', /No upcoming/.test(txt));
check('healthy tour shows its total departures count (5), not a badge', /\b5\b/.test(txt));
if (errors.length) { console.error("jsdom errors: " + errors.map(String).join(" | ")); ok = false; }
console.log(ok ? "\n[TRI-998] admin render-check PASS" : "\n[TRI-998] admin render-check FAIL");
process.exit(ok ? 0 : 1);
