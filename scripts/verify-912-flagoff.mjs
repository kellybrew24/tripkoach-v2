#!/usr/bin/env node
/**
 * TRI-912 flag-off byte-identity check (admin). Renders a built admin app with
 * USE_LIVE_API=false at each auth/console route and diffs #root against a
 * baseline build. With the flag off the enrollment gate is never routed to, so
 * the prototype render must be byte-identical to the baseline.
 *
 * Usage: node scripts/verify-912-flagoff.mjs <newDist> <oldDist>
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [, , NEW_DIST, OLD_DIST] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "_ds_bundle.js",
  "data/data.js", "data/admin-data.js", "tk-api.js", "tk-boot.js"];

async function renderOff(dist, path) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "https://admin.dev.tripkoach.com" + path, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.eval(`window.TK_CONFIG={apiBase:"/api/admin",env:"test",USE_LIVE_API:false};`);
  for (const f of CHAIN) window.eval(readFileSync(join(dist, f), "utf8"));
  window.eval(readFileSync(join(dist, "app.js"), "utf8"));
  await sleep(200);
  return window.document.getElementById("root").innerHTML;
}

const PATHS = ["/", "/login", "/mfa", "/bookings", "/tours", "/settings", "/profile"];
let ok = true;
for (const p of PATHS) {
  const a = await renderOff(NEW_DIST, p);
  const b = await renderOff(OLD_DIST, p);
  const same = a === b;
  if (!same) ok = false;
  console.log(`  [flag-off] ${p.padEnd(11)} ${same ? "IDENTICAL (" + a.length + "b)" : "DIFF (" + a.length + " vs " + b.length + "b)"}`);
}
console.log(`\n== flag-off byte-identity: ${ok ? "PASS" : "FAIL"} ==`);
process.exit(ok ? 0 : 1);
