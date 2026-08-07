# TripKoach v2 API — Phase 1 (read paths)

Clean-room Fastify + TypeScript service for the v2 SPAs. Fresh Postgres schema; **zero v1 assets**
(no v1 code, schema, or migrations). Built to serve the two live v2 DS SPAs. Spec of record:
the Phase 0 comment on **TRI-858**. This package delivers **TRI-860** (Backend Phase 1).

## What's here
- **Fastify API** (`src/`) — the six read-only endpoints below. No write/booking/payment routes (Phase 2/3).
- **Fresh SQL migrations** (`migrations/`) — the full Phase 0 schema (catalogue, inventory with the
  no-oversell CHECK, booking/payments, people, reviews, staff/RBAC/auth scaffold, content/leads/config).
- **Seed** (`src/seed.ts`) — populates the dev DB from the v2 consumer SPA fixtures (`apps/web/kit/data.js`).
- **Smoke** (`test/smoke.ts`) — boots in-process Postgres, migrates, seeds, exercises every endpoint,
  and proves the no-oversell DB constraint. 50 assertions, no Docker required.

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

## Schema notes (Phase 0 decisions resolved at Phase 1 kickoff)
- **customer = split** (distinct row, optional `user_id` link) so guest/offline bookings are representable;
  LTV/VIP/pending are derived at read time, never stored.
- **Enums** modelled as `text + CHECK` (portable, extensible) per the Phase 0 "enum or text+CHECK" latitude.
- **No-oversell** lives on `departure`: `CHECK (seats_reserved BETWEEN 0 AND seats_total)` +
  (Phase 2) a `SELECT … FOR UPDATE` reserve transaction. The constraint is the seatbelt; the lock is the mechanism.
- **Fixtures** carry 11 tours across 8 regions (Phase 0 §3.2 said "9 regions" — flagged to CTO; the SPA
  fixtures are the authoritative product source, so we seed the 8 they define).
