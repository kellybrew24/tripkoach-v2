# TripKoach v2 API — Phase 1 (read paths)

Clean-room Fastify + TypeScript service for the v2 SPAs. Fresh Postgres schema; **zero v1 assets**
(no v1 code, schema, or migrations). Built to serve the two live v2 DS SPAs. Spec of record:
the Phase 0 comment on **TRI-858**. This package delivers **TRI-860** (Backend Phase 1).

## What's here
- **Fastify API** (`src/`) — the six consumer read endpoints below **plus** the Phase 3 admin write/auth
  realm at `/api/admin` (auth, RBAC, catalogue CRUD, booking/payment ops — see the Admin realm section).
- **Fresh SQL migrations** (`migrations/`) — the full Phase 0 schema (catalogue, inventory with the
  no-oversell CHECK, booking/payments, people, reviews, staff/RBAC/auth scaffold, content/leads/config).
- **Seed** (`src/seed.ts`) — populates the dev DB from the v2 consumer SPA fixtures (`apps/web/kit/data.js`).
- **Smoke** (`test/smoke.ts`) — boots in-process Postgres, migrates, seeds, exercises every endpoint,
  and proves the no-oversell DB constraint. Phase 2 (TRI-866) extends it to the booking + Paystack
  write flow (reserve → concurrent oversell rejection → init/FX → webhook sig+idempotency → confirm →
  expiry sweep) with a stubbed Paystack client. Phase 3 (TRI-869) adds the admin realm (login → RBAC →
  CRUD → consumer read; unauth 401 / wrong-perm 403; booking cancel releases seats; refund flag).
  134 assertions, no Docker required.

## Stack & the local-Postgres story
Phase 0 chose **Node + Fastify + TypeScript + Postgres**, explicit SQL, no ORM magic hiding the lock.
- **Production / dev box:** `node-postgres` (`pg`) against `DATABASE_URL` (DevOps dev Postgres 16, TRI-862).
- **Local dev / CI / smoke:** [**PGlite**](https://github.com/electric-sql/pglite) — real Postgres 16
  compiled to WASM, in-process. Identical SQL semantics (enums via CHECK, `FOR UPDATE`, constraints),
  so the Phase 2 no-oversell reserve transaction will run unchanged. This is our stand-in for the
  "local Docker Postgres" soft dependency — **no Docker needed**. Selected automatically when
  `DATABASE_URL` is unset.
- Runs via **Node's native type-stripping** (`node --experimental-strip-types`) — no bundler, no build
  step. `npm run typecheck` (tsc `--noEmit`) is the type gate.

## Run it
```bash
cd apps/api
npm install
npm run smoke        # full end-to-end against PGlite — start here
npm run dev          # boots on 127.0.0.1:3020, auto-migrates + seeds a PGlite DB
npm run typecheck    # tsc --noEmit

# Against real Postgres (dev box):
DATABASE_URL=postgresql://tripkoach_dev:***@127.0.0.1:5432/tripkoach_dev npm run migrate
DATABASE_URL=... npm run seed
DATABASE_URL=... npm start
```
Config: see `.env.example`. Deploy: `deploy/tripkoach-api.service` (systemd, localhost:3020, Caddy edge).

---

## API contract (Phase 1 read paths) — consumed by the SPA client (TRI-861)

Base: same-origin `/api/v1` (Caddy proxies `/api/*` verbatim → `127.0.0.1:3020`, no prefix strip).
Money is returned as **whole-currency numbers** (e.g. `65`, not `6500`) with an explicit `currency`
(stored internally as integer minor units). Errors: `{ "error": { "code, message } }`, `404` unknown tour.

### `GET /api/health`  ·  `GET /health`
```json
{ "status": "ok", "db": "pg" | "pglite", "time": "2026-08-07T21:00:00.000Z" }
```

### `GET /api/v1/regions`
```json
{ "regions": [ { "name": "Greater Accra", "slug": "greater-accra", "tourCount": 2, "note": null } ] }
```
`tourCount` = published tours in the region (derived, not stored).

### `GET /api/v1/tours`
Query params (all optional; multi-select facets accept repeated keys or CSV):
| param | values |
|---|---|
| `region` | region name(s), e.g. `Central` |
| `category` | display label(s) (`City Tour`, `Cultural Discovery`, `Adventure`, `Luxury`) **or** enum (`city\|cultural\|adventure\|luxury`) |
| `price` | band label(s): `Under $200`, `$200–600`, `$600–1,200`, `$1,200+` (mirror the SPA FilterPanel exactly) |
| `duration` | band label(s): `Half day`, `Full day`, `Multi-day` |
| `q` | free text over title / region / category |
| `sort` | `featured` (default), `popular`, `rating`, `price_asc`, `price_desc`, `title` |
| `page`, `pageSize` | pagination (default `1` / `12`, max pageSize `60`) |
```json
{
  "items": [ {
    "id": "accra-city-tour", "title": "Accra City Tour", "region": "Greater Accra",
    "duration": "3 to 4 hrs · Half day", "category": "City Tour",
    "price": 65, "currency": "USD", "rating": 4.7, "reviews": 3,
    "spotsLeft": 11, "tag": "Most booked", "image": "https://cdn.tripkoach.com/img/tours/accra-city-tour/hero-480.jpg"
  } ],
  "page": 1, "pageSize": 12, "total": 11, "totalPages": 1
}
```
`price` is the "from" (cheapest-tier) per-person price. `rating`/`reviews` are cached from approved
reviews. `spotsLeft` on the card is the authored scarcity hint (real inventory is per-departure, below).

### `GET /api/v1/tours/:slug`
Full detail: card fields **plus** `images[]`, `blurb`, `highlights[]`, `included[]`, `excluded[]`,
`pricing` (`[label, priceText][]` as authored), `itinerary` (`[label, text][]`), `tiers`
(`[{ minPax, price }]`), `packages` (`[{ id, name, tag, blurb, duration, stops[], includes[], tiers[] }]`),
`defaultPackage` (package id), `departures` (see below), and `reviewStats` (`{ count, avg }`).
`404` if the slug is unknown or unpublished.

### `GET /api/v1/tours/:slug/availability`
`:slug` accepts a slug **or** a tour UUID.
```json
{ "tourId": "<uuid>", "departures": [
  { "id": "<uuid>", "date": "Sat 15 Aug 2026", "time": "09:00 · Hotel pickup, Accra",
    "price": 75, "spotsLeft": 9, "status": "scheduled" | "sold_out" | "completed" | "cancelled" } ] }
```
`spotsLeft = seats_total − seats_reserved` (real inventory; the no-oversell source of truth in Phase 2).

### `GET /api/v1/tours/:slug/reviews`
Public = **approved only** (pending/rejected/spam are filtered).
```json
{ "tourId": "<uuid>", "stats": { "count": 3, "avg": 4.7 },
  "reviews": [ { "id": "<uuid>", "author": "Ama Mensah", "initials": "AM", "rating": 5,
    "date": "18 Aug 2026", "verified": true, "title": "…", "text": "…", "reply": "…" | null } ] }
```

---

## API contract (Phase 2 write paths, TRI-866) — booking + Paystack payments

Same base (`/api/v1`), same error envelope (`{ "error": { "code", "message" } }`). Money in DTOs is
**whole-currency** (`150`, not `15000`). **Currency model:** prices are **stored/displayed in USD**
(currency of record); **Paystack is charged in GHS**. At `payment/init` the USD total is converted to
GHS **pesewas** (integer) using the configurable charge rate; each payment persists `usd_amount_minor`,
`fx_rate_used`, `ghs_amount_minor`, `currency='GHS'`. **TEST mode only** in this slice.

**Charge-rate precedence (env wins):** `PAYSTACK_USD_TO_GHS_RATE` env → `settings.usd_to_ghs_charge_rate`
→ `settings.usd_to_ghs_display_rate` (15.6). In prod the env override is **unset**, so the automated daily
FX cron (Phase 4 — see below) drives `settings.usd_to_ghs_charge_rate` and thus every charge, with **zero
change to this payment path**. Each payment also persists `fx_source` + `fx_rate_at` (rate provenance).
**Seat-hold window:** 30 min (`RESERVATION_HOLD_MINUTES`),
distinct from `settings.payment_deadline_days` (the offline-invoice deadline).

Seat safety: reservation is an **atomic guarded decrement** (`UPDATE departure SET seats_reserved =
seats_reserved + $n WHERE seats_reserved + $n <= seats_total RETURNING …`) inside a transaction, with the
`departure_no_oversell` CHECK as the final DB seatbelt. `reserved` **and** `confirmed` bookings hold seats.

### `POST /api/v1/bookings` → `201`
Reserves seats, prices the quote, persists travellers (lead carries contact).
```jsonc
// request  (promoCode optional — TRI-896 C7)
{ "tourSlug": "accra-city-tour", "departureId": "<uuid>", "packageSlug": "route1"|null,
  "partySize": 2, "specialRequests": null, "agreedTerms": true, "promoCode": "SAVE10"|null,
  "travellers": [ { "name": "Ama Mensah", "email": "a@x.com", "phone": "+233…", "idNumber": null, "isLead": true } ] }
// 201
{ "ref": "TK-8F3K2Q", "status": "reserved", "paymentState": "unpaid",
  "reservationExpiresAt": "2026-08-07T22:00:00.000Z",
  "quote": { "unitPrice": 75, "subtotal": 150, "discount": 15, "total": 135, "currency": "USD",
             "partySize": 2, "promo": { "code": "SAVE10", "type": "percent", "value": 10, "discount": 15 } },
  "tour": { "slug": "accra-city-tour", "title": "Accra City Tour" },
  "departure": { "id": "<uuid>", "date": "Sat 15 Aug 2026", "time": "09:00 · Hotel pickup, Accra" } }
```
`quote.promo` is `null` when no code was applied; `subtotal` is the pre-discount price, `total` is what
the customer pays (and what the GHS charge is derived from at payment/init). A valid code atomically claims
one redemption of its `usage_limit`; cancelling/expiring the booking releases it again.
Errors: `404 not_found` (tour/departure/package), `409 sold_out`, `409 not_bookable` (departure not
scheduled), `422 validation` (partySize<1, terms not agreed, no lead traveller / no lead contact),
`422 promo_invalid | promo_inactive | promo_not_started | promo_expired | promo_scope | promo_currency |
promo_limit_reached` (the code is rejected cleanly and no seat is held).

### `POST /api/v1/bookings/:ref/payment/init` → `200`
Creates a pending GHS `payment` row (with FX reconciliation), calls Paystack **initialize**, moves the
booking to `pending` (hold kept). Request body optional: `{ "channel": "card" | "mobile_money" }`.
```jsonc
{ "reference": "PAY-7QK2MN", "authorizationUrl": "https://checkout.paystack.com/…",
  "accessCode": "…", "publicKey": "pk_test_…",
  "amount": { "usd": 150, "ghs": 2340, "ghsPesewas": 234000, "fxRate": 15.6, "currency": "GHS" } }
```
Errors: `404 not_found`, `409 not_payable` (already paid / not in a payable state), `422 validation`
(no contact email), `5xx paystack_error`.

### `GET /api/v1/bookings/:ref` → `200` (FE polling / confirmation screen)
```jsonc
{ "ref": "TK-…", "status": "reserved"|"pending"|"confirmed"|"cancelled"|…,
  "paymentState": "unpaid"|"pending"|"paid"|"failed"|…, "reservationExpiresAt": "…"|null,
  "quote": { "unitPrice": 75, "total": 150, "currency": "USD", "partySize": 2 },
  "tour": { "slug": "…", "title": "…" }, "departure": { "id": "…", "date": "…", "time": "…" },
  "travellers": [ { "name": "…", "email": "…", "phone": "…", "isLead": true } ],
  "payment": { "reference": "PAY-…", "status": "pending"|"paid"|…, "currency": "GHS",
               "usd": 150, "ghs": 2340 } | null }
```
`404` unknown ref.

### `POST /api/v1/bookings/:ref/payment/verify` → `200`
Server-side Paystack **verify** (fallback when the webhook hasn't landed). Idempotent; confirms on
`success`. Request body optional: `{ "reference": "PAY-…" }`.
```jsonc
{ "ref": "TK-…", "status": "confirmed", "paymentState": "paid", "verified": true }   // paid
{ "ref": "TK-…", "status": "pending",   "paymentState": "pending", "verified": false } // not yet
```

### `POST /api/v1/payments/webhook` (Paystack only — FE never calls this)
HMAC-SHA512 over the **raw** body via `x-paystack-signature` (constant-time compare); `401` on
bad/missing signature. **Idempotent** via `paystack_event(event_id UNIQUE)`. On `charge.success` the
matching booking is confirmed, the payment marked paid, and `provider_ref` + `raw` persisted. Always
returns `200 { "received": true }` on a valid signature (including duplicate/no-op deliveries).
DevOps owns the same-origin path + `WEBHOOK_URL` wiring.

### `POST /api/v1/internal/expire-holds` (cron-callable — DevOps triggers)
Releases unpaid holds past `reservation_expires_at` (decrements `seats_reserved`, sets the booking
`cancelled`/`non_payment`). Returns `{ "released": <n>, "refs": ["TK-…"] }`.

---

## Automated daily USD→GHS FX (Phase 4 — TRI-873)

Replaces the static `PAYSTACK_USD_TO_GHS_RATE=15.6` override with a **daily cron** that fetches the
mid-market USD→GHS rate, applies a buffer, and writes the **effective** rate into
`settings.usd_to_ghs_charge_rate`. Because the charge-rate precedence is unchanged (env override →
`settings.usd_to_ghs_charge_rate` → display), in prod the env override is simply **not set** and the
automated value drives every charge — **no change to the payment path**. Every attempt (success or a
tripped guard) is written to `fx_rate_history` (migration **010**), and each payment records `fx_source`
+ `fx_rate_at` so a charge is traceable to the exact rate/source that produced it.

### Cron command
```bash
# from apps/api, DATABASE_URL in the environment (systemd EnvironmentFile / cron env):
npm run fx-refresh
#   ≡ node --experimental-strip-types src/fx-refresh.ts
# Exit 0 = rate applied ('ok') or override in force; exit 1 = a guard tripped ('fetch_failed' /
# 'out_of_bounds') — last-known-good was kept and checkout is unaffected, but ops should investigate.
```
Board decision: run **daily at 00:00 Africa/Accra** (Accra is UTC±0, so `0 0 * * *` UTC). The process
opens one DB connection, runs a single refresh, logs the outcome to stdout, and exits — cron/journald
captures the log line and the exit code is the alert signal.

### Env vars
| var | default | meaning |
|---|---|---|
| `FX_PROVIDER_NAME` | `open.er-api.com` | provider label recorded in `fx_rate_history.source` |
| `FX_PROVIDER_URL` | `https://open.er-api.com/v6/latest/USD` | JSON rates endpoint (exchangerate-api.com free tier, GHS supported, **no key**); swap to change vendor without code |
| `FX_TARGET_CURRENCY` | `GHS` | currency read from the provider's `rates` map |
| `FX_BUFFER_PCT` | `1.75` | % added on top of mid-market → effective charge rate |
| `FX_MAX_DEVIATION_PCT` | `5` | reject a fetch deviating more than this % from last-known-good |
| `FX_TIMEOUT_MS` | `10000` | provider fetch timeout |
| `PAYSTACK_USD_TO_GHS_RATE` | *(unset in prod)* | **ops kill-switch** — when set, pins the rate, bypasses the fetch, recorded as `override`; leave unset so the cron drives the rate |

The provider tolerates the exchangerate-api open shape (`{ result:"success", rates:{ GHS } }`) and the
`conversion_rates` variant, so most vendors drop in via `FX_PROVIDER_URL` alone.

### Guards (all enforced; smoke-tested per branch)
1. **Sanity bounds** — a fetch deviating > `FX_MAX_DEVIATION_PCT` from last-known-good is rejected
   (`out_of_bounds`); the last-known-good stays in `settings`. (First run has no history → seeded from
   the `settings` default 15.6, so the first fetch is bounded against that.)
2. **Fallback** — on fetch failure the last-known-good is retained (`fetch_failed`); the cron **never
   writes 0 and never crashes checkout**.
3. **Override** — `PAYSTACK_USD_TO_GHS_RATE` pins the rate (recorded `override`); `settings` is not touched.
4. **Per-txn persistence** — `payment.fx_source` + `payment.fx_rate_at` (010) record where/when the
   applied rate came from, alongside the 008 `usd_amount_minor` / `fx_rate_used` / `ghs_amount_minor`.
5. **Log/alert** — every run logs `[fx] OK|OUT_OF_BOUNDS|FETCH_FAILED|override …` to stdout and sets the
   exit code so cron surfaces a tripped guard.

`fx_rate_history` columns: `id, source, fetched_at, raw_rate, buffer_pct, effective_rate, status
(ok|out_of_bounds|fetch_failed|override), note`.

---

## Admin realm (Phase 3 — TRI-869)

Write/auth realm mounted at same-origin **`/api/admin`** (Caddy proxies `/api/*` verbatim →
`127.0.0.1:3020` on **admin.dev.tripkoach.com**, so the session cookie is same-origin). The consumer
`/api/v1` read paths are **untouched / flag-off byte-identical**. Money crosses the wire as whole-currency
numbers with an explicit `currency` (USD), same as the read contract. Errors use the shared
`{ "error": { "code", "message", "field?" } }` envelope: `400` validation, `401` no/invalid session,
`403` missing permission, `404` not found, `409` conflict.

### AuthN — session cookie
- `POST /api/admin/auth/login` — body `{ email, password, trustDevice? }`. Verifies **argon2id** against
  `staff_user.password_hash`; on success creates a server-side `session` row (`subject_type='staff'`) and
  sets an **httpOnly + Secure + SameSite=Lax** cookie (`tk_admin_session`, path `/api/admin`). Returns
  `{ staff: { id, email, name, role, jobTitle }, permissions: string[] }`. `401 invalid_credentials` otherwise.
- `POST /api/admin/auth/logout` — revokes the current session, clears the cookie → `{ ok: true }`.
- `GET /api/admin/me` — (auth) → `{ staff, permissions }`.
- Sessions have a **sliding 30-min idle expiry** (`ADMIN_SESSION_IDLE_MINUTES`) and honour `revoked_at`.
- MFA (TOTP) schema exists (migration 006) but enforcement is a deliberate **follow-up** — password +
  server-side session is live now. Account lockout is likewise a follow-up.

### AuthZ — RBAC
A preHandler resolves session → `staff_user` → role → the `role_permission` matrix and attaches the
permission set to the request. **Every write is guarded**; no open mutations. `admin` is all-locked-on in
the app. Default matrix (seeded in migration **009**, editable thereafter):

| permission | admin | operator | viewer |
|---|:--:|:--:|:--:|
| tours.view / bookings.view / customers.view | ✓ | ✓ | ✓ |
| tours.edit | ✓ | ✓ | — |
| bookings.manage / bookings.cancel | ✓ | ✓ | — |
| promos.manage | ✓ | ✓ | — |
| payments.refund / users.manage / settings.manage | ✓ | — | — |

### CRUD & views (permission in brackets)
**Regions** — `GET /regions` [tours.view] → `{ regions: [{ id, name, slug, note, active, tourCount }] }`;
`POST /regions` [tours.edit] `{ name, note?, active? }`; `PATCH /regions/:id` [tours.edit];
`DELETE /regions/:id` [tours.edit] (`409` if tours still reference it).

**Tours** — `GET /tours` [tours.view] → `{ tours: [{ id(slug), uuid, title, region, category, currency,
price, rating, reviews, published, departures }] }`; `GET /tours/:idOrSlug` [tours.view] → full detail
(incl. **unpublished**): `{ id, uuid, title, region, regionId, category, categoryEnum, duration, currency,
price, tag, spotsLeft, image, images[], blurb, highlights[], included[], excluded[], pricing[], itinerary[],
tiers:[{minPax,price}], packages:[{id,name,tag,blurb,duration,stops[],includes[],tiers[]}], defaultPackage,
published }`.
`POST /tours` [tours.edit] — `{ title, region|regionId, category, duration, blurb?, highlights?, included?,
excluded?, itinerary?, pricing?, images?, image?, currency?='USD', tiers:[{minPax,price}] | price, tag?,
spotsLeft?, published?=false, packages?, defaultPackage? }` → `201` full detail. The "from" price is the
cheapest tier. `PATCH /tours/:idOrSlug` [tours.edit] (partial; `tiers`/`packages` are replace-all when
present). `POST /tours/:idOrSlug/publish` · `/unpublish` [tours.edit]. `DELETE /tours/:idOrSlug` [tours.edit]
(`409` if bookings exist — unpublish instead).

**Departures** — `GET /departures?tourId=` [tours.view] → `{ departures: [{ id, tourId(slug), tour,
packageId, date(label), departOn, time, price, currency, capacity, seatsTotal, booked, spotsLeft, status,
guideId, guide(name), notes }] }`. `POST /departures` [tours.edit] `{ tourId, packageId?, date:"YYYY-MM-DD",
dateLabel?, time?, capacity, price?, currency?, status?, guideId?, notes? }` → `201`. A supplied `guideId`
must reference an existing guide (else `400`); `null` clears the assignment. `PATCH /departures/:id`
[tours.edit] (capacity below already-reserved seats → `409`; respects the `departure_no_oversell` CHECK).
`POST /departures/:id/cancel` [tours.edit].

**Guides** (TRI-896 A12) — the field roster a departure's `guideId` points at. `GET /guides` [tours.view] →
`{ guides: [{ id, name, email, phone, base, regions[], languages[], status, rating, trips, bio, departures }] }`;
`GET /guides/:id` [tours.view]. `POST /guides` [tours.edit] `{ name, email?, phone?, base?, regions?[],
languages?[], status?=active('active'|'leave'|'disabled'), rating?(0–5), trips?, bio? }` → `201`.
`PATCH /guides/:id` [tours.edit] (partial). `DELETE /guides/:id` [tours.edit] — hard delete; the FK
`ON DELETE SET NULL` unassigns any departures it led → `{ ok, departuresUnassigned }`.

**Promo codes** (TRI-896 A13) — admin CRUD; consumer redemption lives in `POST /api/v1/bookings`.
`GET /promos` [promos.manage] → `{ promos: [{ id, code, type, value, currency, scope, scopeRef, tours(label),
from, to, usageLimit, limit, used, active }] }`; `GET /promos/:idOrCode` [promos.manage]. `POST /promos`
[promos.manage] `{ code, type('percent'|'fixed'), value, currency?='USD'(fixed), scope?|tours?, scopeRef?,
from?/validFrom?, to?/validTo?, limit?/usageLimit?, active?=true }` → `201`. **`value` is whole-currency at
the boundary** (a `$20` fixed code is `value:20`; stored as minor units per the 003 schema). Scope resolves
from explicit `{scope, scopeRef}` or the FE's fuzzy `tours` string ("All tours" | a category label | a tour
title/slug). `PATCH /promos/:idOrCode` [promos.manage] (partial; changing `type` requires a new `value`).
`DELETE /promos/:idOrCode` [promos.manage] — **deactivate** (soft: sets `active=false`) → `{ ok, promo }`.
`:idOrCode` accepts the uuid **or** the code.

**Bookings** — `GET /bookings?status=&q=&page=&pageSize=` [bookings.view] → paginated
`{ items:[{ ref, status, payment, customer, tour, tourId, region, date, travellers, unit, total, currency,
created }], page, pageSize, total, totalPages }`. `GET /bookings/:ref` [bookings.view] → detail + travellers[]
+ payments[] + `{ customerEmail, customerPhone, specialRequests, cancelReason }`.
`POST /bookings/:ref/confirm` [bookings.manage] (reserved|pending → confirmed).
`POST /bookings/:ref/cancel` [bookings.cancel] `{ reason }` (reason ∈ customer_request | non_payment |
departure_cancelled | duplicate; human labels accepted) → sets `cancelled` + `cancel_reason` and **releases
held seats** (`departure.seats_reserved`), returning `{ …booking, seatsReleased }`.

**Payments** — `GET /payments?status=&q=&page=&pageSize=` [bookings.view] and `GET /payments/:ref`
[bookings.view] → `{ ref, bookingRef, customer, amount, currency, method, status, providerRef, created,
usdAmount, fxRate, ghsAmount, refundIntent }`. The `usd/fx/ghs` fields are surfaced from Phase 2 migration
**008** when present (read defensively — `null` until 008 lands; see coordination note below).
`POST /payments/:ref/refund` [payments.refund] `{ reason? }` — **refund FLAG only**: records the intent in
`payment.raw.refund_intent` + audit; **does not** flip status to `refunded` (actual Paystack refund
execution is a follow-up) → `{ refundRequested: true, payment }`.

Every mutation writes an **`audit_log`** row (actor from the session, `before`/`after`, action, target, ip).

### Bootstrap a staff user (no hardcoded secret)
```bash
STAFF_EMAIL=you@tripkoach.com STAFF_PASSWORD='…' STAFF_NAME='You' STAFF_ROLE=admin \
  DATABASE_URL=… npm run admin-seed        # idempotent by email; hashes with argon2id
```

### Migration coordination (Phase 2 ↔ Phase 3)
Phase 2 (TRI-866) owns `008_write_path_payments_fx.sql`; this phase adds **`009_admin_rbac_seed.sql`**
(role_permission matrix + settings singleton) only — it does **not** edit or renumber 008. 009 must apply
**after** 008 (guaranteed by the runner's lexical sort). The admin payment views read the 008 FX columns
defensively, so this branch migrates and passes `npm run smoke` **standalone** (008 absent) and needs no
edit once 008 lands. Keep the sequence monotonic on merge to the shared `tripkoach_dev` DB.

**TRI-896 (P3)** adds **`014_promo_guide_admin.sql`** off `main` — two columns on `booking`
(`promo_code_id` FK → `promo_code`, `discount_minor`) so a redeemed promo is linked to its booking and can
be released on cancel/expiry. `guide` (004) and `promo_code` (003) already existed, so no other schema
change was needed. 014 is the next free number after the consolidated `main` (…010); the runner's lexical
sort applies it last.

---

## Production migration + seed strategy (Phase 4 — TRI-873)

**Linearized migration set** (applies cleanly on an empty DB in this order — verified by `npm run smoke`
migrating a fresh PGlite DB → `migrations applied: 10`; no renumbering, no collisions):

```
001_catalogue → 002_inventory → 003_booking_payments → 004_people → 005_reviews →
006_staff_rbac_auth → 007_content_leads_config → 008_write_path_payments_fx →
009_admin_rbac_seed → 010_fx_rate_automation
```
008 (Phase 2 FX cols) and 009 (Phase 3 admin) are already integrated on this branch; 010 (FX automation:
`fx_rate_history` + `payment.fx_source/fx_rate_at`) stacks on top. The runner tracks applied files in
`schema_migrations` and is idempotent, so re-running is safe.

**Apply migrations (prod):**
```bash
DATABASE_URL=… npm run migrate      # applies 001–010 in order; idempotent
```

**Seed (prod):** catalogue + content/config + reviews **YES**; **NO test bookings/payments** — prod starts
empty of transactions. `npm run seed` inserts only `region / tour / tour_package / price_tier / departure /
review` (booking / payment / staff tables are left empty by design):
```bash
DATABASE_URL=… npm run seed         # catalogue + content only; no bookings/payments
```

**Admin user (prod):** seeded from the prod secret via argon2id — **never committed**:
```bash
STAFF_EMAIL=… STAFF_PASSWORD='…' STAFF_NAME='…' STAFF_ROLE=admin \
  DATABASE_URL=… npm run admin-seed  # idempotent by email
```

**First FX rate:** the singleton `settings` row seeds `usd_to_ghs_charge_rate=15.6`; the first
`npm run fx-refresh` run bounds its fetch against that default and applies the live effective rate.

---

## Schema notes (Phase 0 decisions resolved at Phase 1 kickoff)
- **customer = split** (distinct row, optional `user_id` link) so guest/offline bookings are representable;
  LTV/VIP/pending are derived at read time, never stored.
- **Enums** modelled as `text + CHECK` (portable, extensible) per the Phase 0 "enum or text+CHECK" latitude.
- **No-oversell** lives on `departure`: `CHECK (seats_reserved BETWEEN 0 AND seats_total)` +
  (Phase 2) a `SELECT … FOR UPDATE` reserve transaction. The constraint is the seatbelt; the lock is the mechanism.
- **Fixtures** carry 11 tours across 8 regions (Phase 0 §3.2 said "9 regions" — flagged to CTO; the SPA
  fixtures are the authoritative product source, so we seed the 8 they define).
