#!/usr/bin/env node
/**
 * Headless render smoke test for the built apps.
 *
 * Loads dist/index.html in jsdom, executes the real production script chain
 * (React → _ds_bundle.js → data → app.js) exactly as a browser would, then
 * asserts the SPA mounted real content into #root. This proves the shared-
 * global-scope model (screen `function`s hoisted to window, cross-file
 * references, the DS component namespace) all resolve after the build.
 *
 * Usage: node scripts/smoke.mjs [web|admin]   (no arg = both)
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECT = {
  // Strings that only appear once the React tree has actually rendered.
  web: ["TripKoach", "Ghana"],
  admin: ["TripKoach"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(name) {
  const dist = join(ROOT, "apps", name, "dist");
  const scripts = [
    "vendor/react.production.min.js",
    "vendor/react-dom.production.min.js",
    "_ds_bundle.js",
    "config.js",
    ...(name === "web" ? ["data/data.js", "data/blog.js"] : ["data/data.js", "data/admin-data.js"]),
    "tk-api.js",
    "tk-boot.js",
    "app.js",
  ];

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.detail || e));

  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  // Minimal browser shims the kit may touch during first paint.
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

  for (const s of scripts) {
    const code = readFileSync(join(dist, s), "utf8");
    try {
      window.eval(code);
    } catch (e) {
      throw new Error(`[${name}] script ${s} threw: ${e.stack || e}`);
    }
  }

  // React 18 createRoot().render() flushes asynchronously — let the scheduler run.
  await sleep(150);

  const root = window.document.getElementById("root");
  const html = root.innerHTML;
  const childCount = root.children.length;
  const nsKey = Object.keys(window).find((k) => k.startsWith("TripKoachDesignSystem_"));
  const nsCount = nsKey ? Object.keys(window[nsKey]).length : 0;

  const problems = [];
  if (childCount === 0 || html.length < 200) problems.push(`#root barely populated (children=${childCount}, html=${html.length}b)`);
  for (const needle of EXPECT[name]) if (!html.includes(needle)) problems.push(`missing expected text: "${needle}"`);
  if (nsCount < 40) problems.push(`DS namespace looks short (${nsCount} components)`);
  if (errors.length) problems.push(`jsdom errors: ${errors.map(String).join(" | ")}`);

  console.log(`[smoke] ${name}: #root children=${childCount}, html=${html.length}b, DS components=${nsCount}`);
  if (problems.length) {
    console.error(`[smoke] ${name}: FAIL\n  - ${problems.join("\n  - ")}`);
    return false;
  }
  console.log(`[smoke] ${name}: PASS`);
  return true;
}

const arg = process.argv[2];
const targets = arg ? [arg] : ["web", "admin"];
let ok = true;
for (const t of targets) ok = (await runOne(t)) && ok;
process.exit(ok ? 0 : 1);
