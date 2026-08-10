#!/usr/bin/env node
/**
 * TRI-1016 LIVE E2E against the running dev API (127.0.0.1:3020). Proves the new
 * authed GET /me/reviews surface that backs the account "Reviews" page (dropping
 * the hard-coded "Ama Mensah" + slice(0,2) demo fallback):
 *   1. seeds a throwaway consumer with two confirmed/paid bookings —
 *        A: already has a submitted (approved, with a TripKoach reply) review;
 *        B: has an unredeemed one-time review_invite (the "awaiting" case);
 *   2. logs in → GET /me/reviews → asserts `reviews` carries A (slug tourId,
 *      status, rating, title, reply, human date) and `invites` carries B with a
 *      LIVE token + ref + departure date;
 *   3. submits the real review against B's token (POST /reviews/redeem/:token) —
 *      the same tokenized/verified path the emailed link + Bookings CTA use;
 *   4. re-reads /me/reviews → B has dropped out of `invites` and a new pending
 *      review has appeared in `reviews`.
 * Then deletes everything it created.
 *
 * Run ON the dev host from /opt/tripkoach-v2/apps/api with the API's env:
 *   node --experimental-strip-types /root/live-e2e-1016.mjs
 */
import { loadConfig } from "./src/config.ts";
import { createDb } from "./src/db.ts";
import { hashPassword } from "./src/auth.ts";

const cfg = loadConfig();
const db = await createDb(cfg);
const PORT = process.env.PORT || 3020;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const COOKIE = cfg.consumer.cookieName;
const EMAIL = "reviews-e2e-1016@tripkoach.com";
const PW = "Reviews-E2E-2026!";

const results = [];
const ok = (name, cond, detail = "") => results.push([name, !!cond, detail]);

function jarFrom(res) {
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(new RegExp(COOKIE + "=([^;]+)"));
  return m ? m[1] : null;
}
async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json, cookie: jarFrom(res) };
}

const cleanup = [];
try {
  // ── Pick an existing tour + a departure on it (avoid fabricating catalogue rows). ──
  const tour = (await db.query(`SELECT id, slug, title FROM tour ORDER BY created_at LIMIT 1`)).rows[0];
  if (!tour) throw new Error("no tour in catalogue to test against");
  let dep = (await db.query(`SELECT id, date_label, time_label FROM departure WHERE tour_id=$1 ORDER BY created_at LIMIT 1`, [tour.id])).rows[0];
  if (!dep) {
    dep = (await db.query(
      `INSERT INTO departure (tour_id, date_label, time_label, seats_total, status)
       VALUES ($1,'Sat 22 Aug 2026','09:00 · Hotel pickup, Accra',20,'completed') RETURNING id, date_label, time_label`,
      [tour.id])).rows[0];
    cleanup.push(["departure", dep.id]);
  }
  ok("catalogue tour + departure available", !!tour && !!dep, `${tour.slug} / ${dep.date_label}`);

  // ── Consumer account (known password). ──
  const hash = await hashPassword(PW);
  const user = (await db.query(
    `INSERT INTO user_account (email, password_hash, name)
     VALUES ($1,$2,'Reviews E2E')
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name
     RETURNING id`, [EMAIL, hash])).rows[0];
  cleanup.push(["user_account", user.id]);

  // ── Two confirmed/paid bookings owned by the account. ──
  async function seedBooking(ref) {
    const b = (await db.query(
      `INSERT INTO booking (ref, user_id, tour_id, departure_id, party_size, unit_price_minor, total_minor, status, payment_state)
       VALUES ($1,$2,$3,$4,1,6500,6500,'confirmed','paid') RETURNING id`,
      [ref, user.id, tour.id, dep.id])).rows[0];
    cleanup.unshift(["booking", b.id]); // delete before user; cascades travellers
    await db.query(
      `INSERT INTO booking_traveller (booking_id, is_lead, name, email) VALUES ($1,true,'Reviews E2E',$2)`,
      [b.id, EMAIL]);
    return b.id;
  }
  const stamp = Date.now().toString().slice(-6);
  const bookingA = await seedBooking(`TK-E2E-A${stamp}`);
  const bookingB = await seedBooking(`TK-E2E-B${stamp}`);

  // Booking A → an already-submitted, approved review with a reply.
  const revA = (await db.query(
    `INSERT INTO review (tour_id, booking_id, author_name, rating, title, text, verified, status, reply)
     VALUES ($1,$2,'Reviews E2E',5,'Superb from start to finish','Our guide made the day. Highly recommend.',true,'approved','Thank you so much — see you next time!')
     RETURNING id`, [tour.id, bookingA])).rows[0];
  cleanup.unshift(["review", revA.id]);

  // Booking B → an unredeemed one-time invite (the "awaiting your review" case).
  const token = `e2e1016tok${stamp}${Math.floor(Number(stamp))}`;
  await db.query(
    `INSERT INTO review_invite (token, booking_id, tour_id, traveller_name, traveller_email)
     VALUES ($1,$2,$3,'Reviews E2E',$4)`, [token, bookingB, tour.id, EMAIL]);
  cleanup.unshift(["review_invite_token", token]);

  // ── Log in as the consumer. ──
  const login = await call("POST", "/auth/login", { body: { email: EMAIL, password: PW } });
  const cookie = login.cookie;
  ok("consumer login → session cookie", login.status === 200 && !!cookie, `status=${login.status}`);

  // ── 1) GET /me/reviews — the real backing for the account Reviews page. ──
  const r1 = await call("GET", "/me/reviews", { cookie });
  ok("GET /me/reviews → 200", r1.status === 200, `status=${r1.status}`);
  const reviews1 = (r1.body && r1.body.reviews) || [];
  const invites1 = (r1.body && r1.body.invites) || [];
  const mineA = reviews1.find((r) => r.id === revA.id);
  ok("own submitted review present", !!mineA, JSON.stringify(mineA || {}));
  ok("review carries SLUG tourId (not UUID)", mineA && mineA.tourId === tour.slug, mineA && mineA.tourId);
  ok("review carries status + rating + reply + date", mineA && mineA.status === "approved" && mineA.rating === 5 && !!mineA.reply && !!mineA.date,
    mineA && `${mineA.status}/${mineA.rating}/${mineA.date}`);
  ok("NO demo/foreign reviews leak in (only this account's own)", reviews1.every((r) => r.id === revA.id), `count=${reviews1.length}`);
  const invB = invites1.find((iv) => iv.token === token);
  ok("pending invite present with LIVE token", !!invB && invB.token === token, JSON.stringify(invB || {}));
  ok("invite carries tour title + booking ref + date", invB && invB.tour === tour.title && /E2E-B/.test(invB.ref) && !!invB.date,
    invB && `${invB.tour}/${invB.ref}/${invB.date}`);

  // ── 2) Submit the real review against the invite token (tokenized path). ──
  const sub = await call("POST", `/reviews/redeem/${encodeURIComponent(token)}`, { body: { rating: 4, title: "Great trip", text: "Everything went smoothly, thanks!" } });
  ok("submit via invite token → 200 pending", sub.status === 200 && sub.body && sub.body.status === "pending", `status=${sub.status} ${JSON.stringify(sub.body || {})}`);
  if (sub.body && sub.body.id) cleanup.unshift(["review", sub.body.id]);

  // ── 3) Re-read: invite burned (gone from awaiting), new pending review shows up. ──
  const r2 = await call("GET", "/me/reviews", { cookie });
  const reviews2 = (r2.body && r2.body.reviews) || [];
  const invites2 = (r2.body && r2.body.invites) || [];
  ok("invite dropped from awaiting after submit", !invites2.find((iv) => iv.token === token), `remaining=${invites2.length}`);
  ok("new pending review now in 'your reviews'", reviews2.some((r) => r.status === "pending" && r.rating === 4), `count=${reviews2.length}`);
} catch (e) {
  ok("no exception", false, e && e.stack ? e.stack : String(e));
} finally {
  // Cleanup in dependency order (reviews/invites first, then bookings, then user/departure).
  for (const [kind, id] of cleanup) {
    try {
      if (kind === "review") await db.query(`DELETE FROM review WHERE id=$1`, [id]);
      else if (kind === "review_invite_token") await db.query(`DELETE FROM review_invite WHERE token=$1`, [id]);
      else if (kind === "booking") {
        // review / review_invite FKs are ON DELETE SET NULL, so the booking deletes cleanly
        // (travellers cascade); the seeded review + invite rows are removed by their own entries.
        await db.query(`DELETE FROM review WHERE booking_id=$1`, [id]);
        await db.query(`DELETE FROM review_invite WHERE booking_id=$1`, [id]);
        await db.query(`DELETE FROM booking WHERE id=$1`, [id]);
      }
      else if (kind === "user_account") await db.query(`DELETE FROM user_account WHERE id=$1`, [id]);
      else if (kind === "departure") await db.query(`DELETE FROM departure WHERE id=$1`, [id]);
    } catch (e) { console.error(`[cleanup] ${kind} ${id}: ${e.message}`); }
  }
}

let pass = 0;
for (const [name, good, detail] of results) {
  console.log(`${good ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (good) pass++;
}
console.log(`\n${pass}/${results.length} checks passed`);
await db.close?.();
process.exit(pass === results.length ? 0 : 1);
