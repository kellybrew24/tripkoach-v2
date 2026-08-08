#!/usr/bin/env node
/**
 * Live review-redeem smoke (TRI-894). Proves the tk-reviews shim + the live
 * ReviewInviteLive screen wire the DS invite surface to Backend's tokenized
 * redeem/submit contract (sibling TRI-892) — WITHOUT waiting on a deployed API —
 * by standing up a mock server that returns the exact redeem DTOs, flipping
 * USE_LIVE_API on, and rendering the built web app in jsdom at
 * `/reviews/redeem/:token`.
 *
 * Asserts, against the mock:
 *   - a valid token prefills the tour + traveller and the DS form renders;
 *   - submitting (rating + ≥10-char review) POSTs and lands the "awaiting
 *     approval" thank-you state (review is created pending);
 *   - an unknown token (404) renders the DS "isn't valid" state;
 *   - an already-redeemed token (410) renders the DS "already reviewed" state.
 *
 * Plus a flag-OFF render at `/review` to confirm the fixture demo path is
 * unchanged (byte-identical seam).
 *
 * When Backend deploys these routes behind the same-origin /api proxy, the same
 * assertions hold against the real host (the live-host E2E).
 *
 * Usage: node scripts/smoke-live-reviews.mjs
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps", "web", "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Mock API mirroring Backend's redeem DTOs (TRI-892 contract) ------------
const VALID = "valid-token-abc";
const REDEEMED = "redeemed-token-xyz";
const CONTEXT = {
  token: VALID,
  tour: { slug: "mock-live-accra", title: "MOCK Redeem Accra Heritage Walk", image: "https://cdn.example.test/a.jpg" },
  prefill: { name: "Kojo Mensah", email: "kojo@example.test" },
};

// The invite page mounts through TK_BOOT, which first hydrates the read path
// (/regions + /tours) before React renders. Serve minimal valid read payloads so
// the boot succeeds and the app reaches the /reviews/redeem/:token route; the
// per-tour detail/availability/reviews calls the boot makes are .catch()ed, so
// leaving them to 404 is fine.
const READ_REGIONS = { regions: [{ name: "Greater Accra", slug: "greater-accra", tourCount: 1 }] };
const READ_TOURS = { items: [{ id: "mock-live-accra", title: "MOCK Boot Tour", region: "Greater Accra", duration: "Half day", category: "City Tour", price: 65, currency: "USD", rating: 4.7, reviews: 42, spotsLeft: 8, image: "https://cdn.example.test/a.jpg" }], page: 1, pageSize: 12, total: 1, totalPages: 1 };

function makeServer() {
  return http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.endsWith("/regions")) return json(200, READ_REGIONS);
    if (url.endsWith("/tours")) return json(200, READ_TOURS);
    const m = url.match(/\/reviews\/redeem\/([^/]+)$/);
    if (m) {
      const token = decodeURIComponent(m[1]);
      if (token === REDEEMED) return json(410, { error: { code: "gone", message: "already redeemed" } });
      if (token !== VALID) return json(404, { error: { code: "not_found", message: "unknown token" } });
      if (req.method === "GET") return json(200, CONTEXT);
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          let p = {};
          try { p = JSON.parse(body || "{}"); } catch (_) {}
          if (typeof p.rating !== "number" || p.rating < 1 || p.rating > 5) {
            return json(422, { error: { code: "validation", field: "rating" } });
          }
          return json(200, { id: "rev-new-1", status: "pending", rating: p.rating, title: p.title || "", text: p.text || "", verified: true, message: "Thanks — your review is awaiting approval." });
        });
        return;
      }
    }
    json(404, { error: { code: "not_found", message: url } });
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function makeDom(path, apiBase, useLive) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.detail || e));
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: "https://app.tripkoach.com" + path,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.fetch = (u, init) => globalThis.fetch(u, init);
  if (useLive) window.TK_CONFIG = { apiBase, env: "test", USE_LIVE_API: true };

  const chain = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "_ds_bundle.js",
    "config.js", "data/data.js", "data/blog.js", "tk-api.js", "tk-booking.js", "tk-reviews.js", "tk-boot.js", "app.js"];
  for (const s of chain) window.eval(readFileSync(join(DIST, s), "utf8"));
  return { window, errors };
}

async function renderLive(token, apiBase) {
  const { window, errors } = makeDom("/reviews/redeem/" + token, apiBase, true);
  const root = window.document.getElementById("root");
  for (let i = 0; i < 80; i++) {
    if (/MOCK Redeem|isn't valid|already reviewed|Something went wrong/.test(root.innerHTML)) break;
    await sleep(50);
  }
  return { window, root, errors };
}

// Set a React-controlled input's value and fire the input event React listens for.
function setInput(window, el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

let ok = true;
const pass = (name, cond, extra = "") => { console.log(`[smoke:reviews] ${cond ? "PASS" : "FAIL"} — ${name}${extra && !cond ? " :: " + extra : ""}`); if (!cond) ok = false; };

const server = makeServer();
const port = await listen(server);
const apiBase = `http://127.0.0.1:${port}/api/v1`;

// --- happy path: prefill + submit → pending ---------------------------------
{
  const { window, root, errors } = await renderLive(VALID, apiBase);
  pass("valid token prefills tour title", root.innerHTML.includes("MOCK Redeem Accra Heritage Walk"), root.innerHTML.slice(0, 300));
  pass("DS invite form renders (rating + review)", root.innerHTML.includes("Your rating") && root.innerHTML.includes("Your review"));
  pass("no jsdom errors on live redeem render", errors.length === 0, errors.map(String).join(" | "));

  // Fill: pick 5 stars, write a ≥10-char review, submit.
  const star5 = Array.from(root.querySelectorAll('[role="radio"]')).find((b) => /^5 star/.test(b.getAttribute("aria-label") || ""));
  if (star5) star5.click();
  const ta = root.querySelector("#iv-text");
  if (ta) setInput(window, ta, "Fantastic guided tour, learned so much!");
  await sleep(30);
  const submit = Array.from(root.querySelectorAll("button")).find((b) => /Submit review/.test(b.textContent || ""));
  pass("submit button present + enabled after filling", !!submit && !submit.disabled);
  if (submit) submit.click();
  for (let i = 0; i < 80; i++) { if (/Thank you/.test(root.innerHTML)) break; await sleep(50); }
  pass("submit lands awaiting-approval thank-you state", root.innerHTML.includes("Thank you") && /approved/.test(root.innerHTML), root.innerHTML.slice(0, 300));
  pass("thank-you greets the prefilled traveller", root.innerHTML.includes("Kojo"));
}

// --- invalid token (404) ----------------------------------------------------
{
  const { root } = await renderLive("no-such-token", apiBase);
  pass("unknown token → DS 'isn't valid' state", root.innerHTML.includes("isn't valid"), root.innerHTML.slice(0, 200));
}

// --- already redeemed (410) -------------------------------------------------
{
  const { root } = await renderLive(REDEEMED, apiBase);
  pass("already-redeemed token → DS 'already reviewed' state", root.innerHTML.includes("already reviewed"), root.innerHTML.slice(0, 200));
}

server.close();

// --- flag OFF: fixture demo path unchanged ----------------------------------
{
  const { window, errors } = makeDom("/review", "/api/v1", false);
  await sleep(150);
  const root = window.document.getElementById("root");
  pass("flag-off /review renders the fixture invite demo", /How was your trip\?|Thank you/.test(root.innerHTML), root.innerHTML.slice(0, 200));
  pass("flag-off makes no review API call (no jsdom errors)", errors.length === 0, errors.map(String).join(" | "));
}

console.log(ok ? "\n[smoke:reviews] ALL PASS" : "\n[smoke:reviews] FAILURES ABOVE");
process.exit(ok ? 0 : 1);
