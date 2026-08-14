# PROD cutover backlog — every ⚠PROD item that owes production

**Owner:** CTO. **Tracker ticket:** TRI-1057 (*Batched pre-launch prod cutover*).
**Status of TRI-1057:** BLOCKED on CEO — needs (a) an authorized cutover window and
(b) the prod static roots (`PROD_DEST_ROOT` / `PROD_PUBLIC_URL`). See
[RUNBOOK.md](../RUNBOOK.md) for topology and rollback.

> **Why this file exists (TRI-1110 / TRI-1108 P2, item 8).** Until now the
> "landed on dev, owes prod" backlog lived only in agent memory. That is a
> single-point-of-failure and invites piecemeal shipping. This file is the
> repo-tracked source of truth: **nothing on this list ships to production on its
> own — it all rides the one batched cutover (TRI-1057).** When an item is cut
> over, tick it here in the same commit.

## The one rule

**No piecemeal prod deploys.** Every item below is DONE + verified on **dev**
(`dev.tripkoach.com` / `admin.dev.tripkoach.com`) and is exposed on prod only
because prod has not been cut over yet. They ship together, once, under
TRI-1057, gated on **CEO sign-off**. Blind `rsync src/` is forbidden — see the
migration-reconciliation note below and the `dev-deploy-src-ahead-of-branch`
lesson in RUNBOOK §3.

## Cutover-time environment / config (must set on prod at cutover)

These are not commits — they are prod env/flags that must be flipped as part of
the cutover, not before:

- [ ] `COOKIE_SAMESITE=strict` (prod) — TRI-1056
- [ ] `COOKIE_SECURE=true` (prod) — TRI-1056
- [ ] `PROD_DEST_ROOT` / `PROD_PUBLIC_URL` provided by CEO/DevOps (unblocks TRI-1057)
- [ ] Leave `PAYSTACK_USD_TO_GHS_RATE` **UNSET** on prod (FX convergence, TRI-873/876)
- [ ] Confirm `config.js` on prod static has `USE_LIVE_API:true` (never resurrect a flag-off config on rollback)
- [ ] `SITE_URL=https://<prod-public-host>` set when running `build:prod` — TRI-1114 **+ TRI-1126**. The web build bakes absolute canonical/OG/JSON-LD URLs from `SITE_URL` (defaults to `https://dev.tripkoach.com`) into both the sitewide index.html AND every prerendered `/tour/<slug>/` + `/blog/<slug>/` social card. If unset at prod build, social/canonical tags point at dev. Runtime per-route tags self-correct from `window.location.origin`, but non-JS scrapers read the static ones — so this must be set for the prod dist.
- [ ] Prod web Caddy vhost `try_files` must be `try_files {path} {path}/index.html /index.html` (NOT the bare `{path} /index.html`) — TRI-1126. Without the `{path}/index.html` term the prerendered per-tour/-post social cards are shadowed by the sitewide shell and deep-link scrapers get the generic card. Applied + verified on dev; mirror on prod's `dev.tripkoach.com`-equivalent web block at cutover.
- [ ] R2 media token valid — **see item 10 / [SECRETS-ROTATION.md](./SECRETS-ROTATION.md); token expires 2026-08-24, gates media/avatar on prod**

## ⚠ Migration reconciliation (do FIRST, before any `migrate` on prod)

Prod DB is at **mig 010**; dev is at **mig 031**. The ordered set 011→031 must be
applied in order, but the set is **not clean** — two collisions to resolve before
running `migrate` against prod:

- [ ] **029/030 duplicate lockout** — the TRI-1061 (MFA brute-force) and TRI-1065
  (SEC hardening item 3) stacks BOTH introduce a `029/030` migration adding the
  same consumer-lockout columns via *different* helpers. **Dedupe + renumber into
  a single ordered migration; never blind-rsync one stack over the other.**
- [ ] **030/031 numbering** — TRI-1095 `public_token` landed as mig 031 on top of
  the contested 030. Reconcile the final numbers so prod applies a clean 011→NNN.
- [ ] **028 is a data backfill, NOT cleanly reversible** (guest→customer). Take the
  pre-migration `pg_dump` (RUNBOOK §DB) — that dump is the only real rollback.
- [ ] mig 021 (email verification, SOFT gate) was never run on prod — included here.

Migration source of truth for reversibility: [docs/rollback.md](./rollback.md).

---

## Backlog by batch

Legend: **C** = commit · **mig** = DB migration introduced · FE = frontend-only
(rebuild+rsync dist, no mig) · BE = API (`rsync apps/api/src` + restart) ·
DNS/infra as noted. All items DONE on dev unless flagged.

### A. Security / cutover stack (highest priority — these are the reason prod is exposed)

- [ ] TRI-1053 — Caddy security headers — infra (`Caddyfile.tripkoach`)
- [ ] TRI-1054 — admin login rate-limit + lockout — BE, **mig 029**, C `f752615`
- [ ] TRI-1055 — consumer auth rate-limit — BE, C `6804d7e`
- [ ] TRI-1056 — session cookie hardening (`__Host-` + SameSite=strict) — BE, C `cddbfba`
- [ ] TRI-1059 — post-logout back/bfcache auth leak — FE, C `bc392fd`
- [ ] TRI-1061 — MFA brute-force throttle + lockout — BE, **mig 030** (collision ↑), C `2330e96`
- [ ] TRI-1062 — audit webhook pay/refund — BE, C `808c1be`
- [ ] TRI-1063 — guest-lookup hardening (per-IP 100/min, PII-drop) — BE, C `ef8b512`
- [ ] TRI-1064 — Caddy config into VCS — infra, C `bb2d487`
- [ ] TRI-1065 — SEC hardening follow-ups (items 1–7; overlaps 1062/1063) — BE, C `d827497`
- [ ] TRI-1066 — AuditTimeline output escaping — FE, C `ba6c230`
- [ ] TRI-1046 — anti-phishing hardening (trust copy) — BE/FE, **mig 021**, C `16bf861`
- [ ] TRI-1051 — anti-phishing prod copy — FE, C `16bf861` (rides cutover)

### B. Admin recovery / MFA / account

- [ ] TRI-1080 — admin lockout recovery: BE C `5cc064d` (3 POST `/staff/:id/...`, step-up TOTP, audit)
- [ ] TRI-1080 — admin lockout recovery: FE C `e045b82` (row-menu + codes-once modal)
- [ ] TRI-1085 — admin login trusted-device 30→14d + padlock — C `38cce3d`
- [ ] TRI-1079 — admin profile phone persist (`PATCH/GET /api/admin/me`) — C `c2c599b` + `f2ce1de`
- [ ] TRI-1078 — Samuel admin MFA backup codes — **DEV-only, no prod row** (argon2id). Confirm prod admin has codes post-cutover.

### C. Booking / checkout / receipt (customer-facing)

- [ ] TRI-1095 — secure guessable booking link (`public_token`, `?t=`) — BE, **mig 031**, C `3c8a281`
- [ ] TRI-1100 — checkout terms/cancellation gate (Pay disabled until ticked) — FE, C `0b041fb`
- [ ] TRI-1099 booking-receipt logo — print/PDF C `fbe0adf` (1101)
- [ ] TRI-1099 booking-receipt logo — web page C `ed01ff4` (1103)
- [ ] TRI-1099 booking-receipt logo — email C `167cb9e` (1102) — **awaits CEO sign-off**
- [ ] TRI-1097 — fix broken table sort (`tkSortRows` across Bookings/Tours/Customers/Guides) — FE, C `48fdb75`
- [ ] TRI-1114 — SEO & shareability: per-route meta/OG/JSON-LD + real anchor links — FE, C `12cfe2b`. **At cutover set `SITE_URL` (see env checklist above) before `build:prod`.** Admin dist now ships `noindex,nofollow`.
- [ ] TRI-1126 — per-tour/-post social cards for deep links (child of 1114) — FE build + infra. `scripts/build.mjs` now prerenders a static `/tour/<slug>/index.html` + `/blog/<slug>/index.html` per catalogue entry (same SPA shell, per-route OG/Twitter + Product/BreadcrumbList / Article JSON-LD) so non-JS scrapers on shared deep links get a real card. **Two cutover deps, both in the env/config checklist above: (1) `SITE_URL` before `build:prod`; (2) prod web Caddy `try_files {path} {path}/index.html /index.html`.** Applied + verified on dev.
- [ ] TRI-1119 — a11y (skip-to-content link + `<main>` landmark, keyboard-operable blog cards) + DS logo lockup spec + logo asset consolidation (removed duplicate `uploads/logo-badge.png`) — FE + DS docs, NO mig, C `f55209b`.
- [ ] TRI-1120 — credentialed admin console UX pass: added 4 missing DS icon glyphs (`smartphone` in the self-serve 2FA drawer, `circle`+`repeat` in the audit timeline, `refresh-cw` in the Resend-invite menu — all previously rendered as empty boxes) to `Icon.jsx`+`_ds_bundle.js`; made the auth aside context-aware so the accept-invite/reset-password first-run screens drop the "Welcome back / pick up where you left off" copy (invite → "Welcome to the team"). FE + DS, NO mig, C `8de711d`. **Rebuild admin dist (`build:admin`) at cutover — `apps/admin/dist` is git-ignored.**
- [ ] TRI-1128 — admin notifications bell made functional (child of TRI-1127): "Mark all as read" was a dead button and the unread badge could never clear. The feed itself is already the real derived one (TRI-978 #4). Added stable per-row ids + per-operator localStorage read-state (`tk.admin.notif.read`, pruned to the live feed), an unread badge that counts only unread rows, a wired `onMarkAllRead`, and a per-row unread dot in the DS TopBar. `apps/admin/kit/app.jsx` + `design-system/components/admin/AppShell.jsx` + hand-maintained `_ds_bundle.js`. FE + DS, NO mig, C `91da3b5`. Browser-verified on admin.dev (QA account). **Rebuild admin dist (`build:admin`) at cutover — `apps/admin/dist` is git-ignored.**

### D. UX / content cleanups

- [ ] TRI-1136/1137/1138/1139 — custom/private date requests A+B1: `enquiries.ts` intent='request' + new fields (requestedDate/partySize/phone/note); mig **032** `departure.visibility DEFAULT 'public' CHECK IN ('public','unlisted')`; catalog.ts excludes unlisted from all public queries; admin service: `listRequests` + `updateRequestStatus` + `createPrivateBookingLink` (72h-hold reserved booking); admin routes: `GET /requests`, `PATCH /requests/:id`, `POST /requests/:id/secure-link`, `POST /departures/:id/private-link`; `/config` exposes `dateRequestsEnabled` (from `settings.flags.date_requests_enabled`) + `minRequestLeadDays:3`; consumer DateInterestForm upgraded (date picker, group-size stepper, phone, note); admin Requests inbox screen + nav item. BE mig 032 applied dev. FE+BE, mig 032, C `de14c36`+`1dc76d0`. ⚠ At cutover: apply mig 032 on prod before deploying; set `settings.flags.date_requests_enabled=true` to turn on. ⚠ RECONCILE mig 032 numbering at cutover (check what mig number is next on prod; prod is at mig 010 today).
- [ ] TRI-1092/1088 — remove input placeholders (67 across 10 kit files) — FE
- [ ] TRI-1132 — homepage hero image slider (child of TRI-1131): replaced the single static hero image with an accessible cross-fade carousel of the exact CDN image set + order the LIVE apex hero uses (`img/hero/slider/{canopy-walk,smiles,north-dance,independence-arch}`), all hotlinking `cdn.tripkoach.com` via a new `TK_HERO_SRCSET` (480/960/1440, per TRI-1117). Auto-advance (6s, pauses on hover/focus, honours prefers-reduced-motion) + prev/next buttons + dot tablist (Arrow/Home/End keys), per-slide alt text, aria-hidden on inactive slides. `apps/web/kit/data.js` + `screens-home.jsx`. FE, NO mig, C `ce5c90f`. Browser-verified on dev.tripkoach.com (4 imgs load from CDN, controls + auto-advance work). Prod counterpart is the v2 SPA (app.tripkoach.com), NOT the apex — the apex already ships this slider.
- [ ] TRI-1090/1093/1096 — tour-badge removal (cleared tags, home rail copy) — FE + dev DB/seed, C `6e8c294`
- [ ] TRI-1074 — Boti Falls blog → dev CMS — content, C `d9160254` (⚠ prod v2 blog DB EMPTY — needs content load at cutover)

### E. Earlier waves still owing prod (batched under TRI-1057)

These pre-date the SEC stack but were fixed on dev after the last prod cutover
and have never been promoted. Full per-ticket detail in agent topic files; they
ride the same window.

- [ ] **TRI-1001 fix-wave** — 1000/1003/1005–1019/1029/1033 (see agent memory `tri1001-fix-wave-children`). Includes migs **024** (admin pw), **025** (delete-account), **026** (empty-departures), **027** (consumer 2FA), **007** (leads).
- [ ] **TRI-977 reopen fixes** — 1032/1038/1039/1040/1041/1043 (admin lists, transitions, table clipping, invite-accept FE).
- [ ] **TRI-857 review/receipt/FX + earlier** — 937–941 (mig 021 email verify), 926–936 checkout/payment, 917/918 blog+media (**mig 019**), 943/945 avatar. Confirm which already landed prod vs owe — cross-check `schema_migrations` on prod (at 010) against the ordered set before assuming.

> **Action for cutover prep:** reconcile section E against the *actual* prod
> `schema_migrations` table — prod is at mig 010, so anything with mig ≤ 010 is
> already there and does NOT re-ship; anything > 010 owes prod. The migration
> ledger, not memory, is authoritative for what's live.

### F. Custom / private date requests (TRI-1136, A + B1)

Custom-date request flow: a traveller asks for a date that isn't scheduled → the
enquiry lands in a net-new admin **Requests inbox**; ops schedule a private
(unlisted) departure + reserved-booking secure link, or dismiss. Dev-only build;
BE (TRI-1137) lands the endpoints in parallel. **At cutover the BE row must land
before/with the FE** — the inbox degrades gracefully to fixtures if `/requests`
is absent, but Copy-secure-link / status PATCH need TRI-1137.

- [ ] TRI-1139 — **admin Requests inbox + nav + Unlisted departure toggle** — FE, NO mig, C `<pending>`. Changed: `apps/admin/kit/app.jsx` (nav "Requests" in Operations w/ live New-count badge — NOT admin-only; `/requests` route; META; render branch), `screens-requests.jsx` (**new** inbox screen — list, status chips New→Contacted→Scheduled→Booked→Closed, row actions: advance status / Create-departure-prefilled / Copy-secure-link `?t=` / mailto·tel·WhatsApp / dismiss-with-reason), `screens-tours.jsx` (`DeparturesAdmin` Visibility=Unlisted toggle on Add-departure drawer → POSTs `visibility`; prefill via `tk-add-departure` event detail; Unlisted row badge), `tk-boot.js` (`mapRequest`, `listRequests`/`updateRequest`/`createRequestSecureLink` API, requests hydration, `visibility` on `mapDepartureRow`), `admin-data.js` (requests fixture), `scripts/build.mjs` + `kit/index.html` (register `screens-requests.jsx`). Verified on the built bundle via `scripts/tri1139-render-check.mjs` (21/21) + agent-browser screenshots. **Rebuild admin dist (`build:admin`) at cutover — `apps/admin/dist` is git-ignored.** Consumer secure-link base is derived by stripping the leading `admin.` from the console host (or set `TK_CONFIG.webBaseUrl`); confirm it resolves to the prod consumer origin at cutover.
- [ ] TRI-1141 — **BE gaps on the deployed A+B1 slice (24h SLA email + atomic private booking)** — BE, NO mig, dev-only, verified live. Changed on the dev API (`/opt/tripkoach-v2/apps/api/src`, reconcile at cutover by diffing the host — src is a superset of any branch):
  - **Gap 1 (CEO #5):** `email-templates.ts` adds template `custom_date_request_received` (subject "We've got your date request — {{tourName}}", carries the verbatim "within 24 hours" SLA line); `enquiries.ts` `submitTourInterest` sends it (best-effort, after the ops notify) to the requester on `intent='request'` with vars `{tourName, requestedDate, partySize}`. Verified live: request submit → row in `email_message` with that template, `status=sent` to a Resend-allowed recipient (fake `example.com` recipients are rejected by the provider, not a code fault).
  - **Gap 2 (atomicity + customer roll-up):** `admin.ts` `createPrivateBookingLink` no longer hand-rolls an INSERT + unguarded `seats_reserved+N`; it now routes through the shared `bookings.create()` (new `booking.ts` `CreateBookingOpts.adminCreated` bypasses the consumer terms gate + `holdMinutes` gives the 72h hold; `tierUnitPriceMinor` extracted/exported for reuse). This reuses the atomic guarded seat-reserve, the 128-bit `newPublicToken()`, and the guest→customer roll-up. **Contract preserved:** still returns `{ref, token, expiresAt}` for the deployed TRI-1139 FE. `admin-routes.ts` `/requests/:id/secure-link` now passes `requestId` through so the booking hydrates the requester's contact from the enquiry and links a `customer` row (surfaces under Admin → Customers). Verified live (in-process integration test): `TK-`-prefixed ref (not the old `TKP…`), `token_required=true`, 32-hex token, `customer_id` linked, `seats_reserved` 0→2 atomically, over-reserve rejected with seats unchanged, 72h `reservation_expires_at`.
  - Changed files to reconcile at cutover: `email-templates.ts`, `enquiries.ts`, `admin.ts`, `admin-routes.ts`, `booking.ts`. Local cherry-pick copies at `/home/iamsk/work/tri1141/`. No new migration. Rides the same `settings.flags.date_requests_enabled` gate + mig 032 as the rest of TRI-1136.
- [ ] TRI-1142 — **server-side min-lead (72h) enforcement** — BE, NO mig, dev-only (landed on dev by a concurrent run; reconciled with TRI-1141 in `enquiries.ts`). `submitTourInterest` now rejects `intent='request'` with a malformed date or a `requestedDate` inside the `MIN_REQUEST_LEAD_DAYS` (3-day) window (422), matching the FE `min=`/`minRequestDate()` guard and the `/config` `minRequestLeadDays:3` the route publishes. Previously the floor was FE-only, so a direct API call could create a sub-lead request. Verified live: `+1d` → 422 "Please choose a date at least 3 days from now"; `+14d` → 201. Reconcile in `enquiries.ts` at cutover (the TRI-1141 customer-ack email and this guard are both additive, non-overlapping regions of the same file).
- [ ] TRI-1143 — **request-a-date entry point on tours that HAVE departures** (CEO scope call, TRI-1133 follow-up) — FE-only, NO mig, dev-only, deployed + verified live. `apps/web/kit/screens-web.jsx` `TourWeb`: in the `hasDepartures` branch, below "Reserve my spot", a flag-gated (`customDateFlags().enabled`), collapsed-by-default `variant="link"` control — "None of these dates work? Request your own date" — reveals the **same** `DateInterestForm` (same `POST /tours/:id/interest` intent='request' → same admin Requests inbox; no second pipeline). Reuses the shipped 72h min-lead / dedupe / 24h-SLA / indicative-pricing / unlisted guardrails. Flag-off ⇒ the departures branch is byte-identical to before. Same `date_requests_enabled` gate + mig 032 as the rest of §F. Verified live: entry point renders on `accra-city-tour`, opens the form, a browser submission landed in the inbox (enquiry `9018d048`, status `new`). **Rebuild web dist (`build:web`) + `deploy-static.sh web prod` at cutover — `apps/web/dist` is git-ignored.**

---

## How to keep this current

- When you fix something on dev that can't ship to prod immediately, **add a line
  here in the same PR** and reference TRI-1057.
- At cutover, tick each box as it's verified live, and record the SHA actually
  deployed. A ticked box with no prod evidence is not done.
- This file supersedes the "⚠PROD" markers scattered in agent memory as the
  canonical, reviewable list.
