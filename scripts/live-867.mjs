#!/usr/bin/env node
/**
 * TRI-867 LIVE-HOST E2E (opt-in; creates a real TEST booking).
 *
 * Loads the SHIPPED built shims (tk-api.js + tk-booking.js from apps/web/dist)
 * with USE_LIVE_API on, points them at the deployed dev API, and drives the
 * real write contract exactly as the checkout screen does:
 *
 *   TK_BOOKING.create  → POST /bookings            (seat hold + USD quote)
 *   TK_BOOKING.initPayment → POST /:ref/payment/init (Paystack authorization_url)
 *   TK_BOOKING.get     → GET  /bookings/:ref
 *
 * It asserts the tolerant mapper reconciles the DEPLOYED JSON (camelCase,
 * quote-nested MAJOR-unit money, tour/departure sub-objects, tourSlug lookup)
 * into the stable shape the DS screens read. It does NOT complete a card
 * payment — that final leg is jointly verified with Backend/DevOps on TRI-864.
 *
 * Usage: TK_LIVE=1 node scripts/live-867.mjs [apiBase]
 *   default apiBase = https://dev.tripkoach.com/api/v1
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.TK_LIVE) {
  console.log("skipped: set TK_LIVE=1 to run the live-host booking E2E (creates a real TEST booking).");
  process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps/web/dist");
const API_BASE = process.argv[2] || "https://dev.tripkoach.com/api/v1";

// Minimal window: absolute apiBase + real fetch, so the shipped shims run as-is.
const win = {
  TK_CONFIG: { apiBase: API_BASE, env: "test", USE_LIVE_API: true },
  fetch: (u, init) => fetch(u, init),
  location: { origin: "https://dev.tripkoach.com" },
  sessionStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
  setTimeout, clearTimeout,
};
win.window = win;
globalThis.window = win;

const evalIn = (file) => { const src = readFileSync(join(DIST, file), "utf8"); new Function("window", src + "\n//# sourceURL=" + file).call(win, win); };
evalIn("tk-api.js");
evalIn("tk-booking.js");

const TK = win.TK_BOOKING;
let ok = true;
const check = (label, pass, extra) => { if (!pass) ok = false; console.log(`  [live] ${pass ? "PASS" : "FAIL"} — ${label}${!pass && extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); };

async function firstBookableDeparture(base) {
  const tours = await win.fetch(base + "/tours").then((r) => r.json());
  const tour = tours.items[0];
  const avail = await win.fetch(base + "/tours/" + tour.id + "/availability").then((r) => r.json());
  const dep = (avail.departures || []).find((d) => d.status === "scheduled" && d.spotsLeft > 1) || avail.departures[0];
  return { slug: tour.id, dep, price: (dep && dep.price) || tour.price };
}

(async () => {
  console.log("== TRI-867 LIVE E2E vs " + API_BASE + " ==");
  const { slug, dep, price } = await firstBookableDeparture(API_BASE);
  console.log(`  using tour=${slug} departure=${dep.id} (${dep.date}) unit≈$${price}`);

  // 1. create booking (mirrors the checkout payload)
  const bk = await TK.create({
    tourSlug: slug,
    departureId: dep.id,
    partySize: 2,
    agreedTerms: true,
    payMode: "now",
    travellers: [
      { name: "TRI-867 Live E2E", email: "tri867-e2e@example.com", phone: "+233200000000", lead: true },
      { name: "Second Traveller", lead: false },
    ],
    specialRequests: "TRI-867 automated live contract check",
  });
  check("booking created with ref", !!(bk && bk.ref), bk);
  check("status reserved", bk.status === "reserved", bk.status);
  check("paymentState unpaid", bk.paymentState === "unpaid", bk.paymentState);
  check("USD unit price mapped (major units, from quote)", bk.unitUsd === price, bk.unitUsd);
  check("USD total mapped = unit × 2", bk.totalUsd === price * 2, bk.totalUsd);
  check("party size mapped", bk.partySize === 2, bk.partySize);
  check("tour title mapped from tour.{}", !!bk.tourTitle, bk.tourTitle);
  check("departure label mapped from departure.{}", !!bk.departureLabel, bk.departureLabel);

  // 2. init Paystack payment
  const init = await TK.initPayment(bk.ref, { callbackUrl: win.location.origin + "/confirm?ref=" + encodeURIComponent(bk.ref) });
  check("Paystack authorization_url mapped", /^https:\/\/checkout\.paystack\.com\//.test(init.authorizationUrl || ""), init.authorizationUrl);
  check("Paystack TEST public key mapped", /^pk_test_/.test(init.publicKey || ""), init.publicKey);
  check("payment reference mapped", !!init.reference, init.reference);

  // 3. re-fetch booking → still unpaid (no card completed), mapper stable
  const got = await TK.get(bk.ref);
  check("GET booking round-trips ref", got.ref === bk.ref, got.ref);
  check("GET total stable", got.totalUsd === bk.totalUsd, got.totalUsd);
  check("not yet paid (awaiting card)", !TK.isPaid(got) && !TK.isFailed(got), { s: got.status, p: got.paymentState });

  console.log(ok ? "\n== LIVE RESULT: ALL PASS ==" : "\n== LIVE RESULT: FAIL ==");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("LIVE E2E error:", e); process.exit(1); });
