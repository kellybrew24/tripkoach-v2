# OPERATIONS.md — the non-obvious gotchas

**Audience:** any engineer touching build, deploy, or the API/FE for TripKoach v2.
**Owner:** CTO. **Companion docs:** [RUNBOOK.md](../RUNBOOK.md) (incidents),
[docs/PROD-CUTOVER-BACKLOG.md](./PROD-CUTOVER-BACKLOG.md) (what owes prod),
[docs/SECRETS-ROTATION.md](./SECRETS-ROTATION.md) (env/secret rotation).

This is the list of things that have bitten us and are **not discoverable from the
code alone**. Read it before your first deploy. Written for TRI-1110 (P2 doc debt).

---

## Topology in one line

Single Hetzner box `168.119.117.136` runs **both** environments:
- **dev**: systemd `tripkoach-api` on `:3020`, DB `tripkoach_dev`, static under
  `/var/www/tripkoach-dev-{web,admin}`, served by Caddy dev vhosts.
- **prod**: systemd `tripkoach-api-prod` on `:3120`, DB `tripkoach_prod`, static
  roots owned by DevOps (`PROD_DEST_ROOT`), env `/etc/tripkoach/tripkoach-v2-prod.env`.

Full table in RUNBOOK §1.

---

## Gotcha 1 — `dist` / built bundles are git-ignored; rebuild + rsync after every kit edit

- `apps/admin/dist/app.js` (and the web dist) are **git-ignored**. Editing a
  `kit/*.jsx` source file changes nothing live until you **rebuild** and rsync the
  built `dist`. (Lesson: TRI-980 — a kit edit that "did nothing" was never built.)
- Build: `npm run build:admin` / `npm run build:web` (esbuild static pipeline — **no
  Vite**), which emits `dist/`.
- Deploy static **only** via `scripts/deploy-static.sh <web|admin> [dev|prod]` —
  **never** a raw `rsync dist/` (TRI-1002). The wrapper preserves `config.js`
  (the live-API flag) and takes a rollback snapshot.
- Redeploys must `--exclude=config.js` so you don't clobber the env's API flag
  (TRI-908).

## Gotcha 2 — `_ds_bundle.js` is hand-maintained

The design-system bundle `_ds_bundle.js` is **not** produced by a build step — it
is maintained by hand. If you change design-system primitives, you must update that
file too, or dev (which loads the hand-maintained copy) and the built output drift.
(Lesson: TRI-1046 — dev API runs TS directly and the DS bundle is hand-kept.)

## Gotcha 3 — dev API runs TypeScript directly; prod runs the same src but is a separate service

- Dev API is started with Node's `--experimental-strip-types` and runs the `.ts`
  sources **in place** at `/opt/tripkoach-v2/apps/api/src` on `:3020`. To ship an
  API change to dev you `rsync apps/api/src` + `systemctl restart tripkoach-api`.
- **The live dev `src` is a *superset* of every reconcile branch** — it carries
  fixes (1054/1056/1061 …) that may not be in your checkout. **Diff host-vs-local
  first and patch only the changed lines. Never wholesale-rsync `src/`** or you
  will revert live fixes. (Lesson: `dev-deploy-src-ahead-of-branch`.)
- Prod is the same code shape but a distinct systemd unit (`tripkoach-api-prod`,
  `:3120`, `tripkoach_prod`). Prod deploys are gated on TRI-1057.

## Gotcha 4 — `tk-boot` mapper whitelists silently drop DTO fields

`tk-boot` maps API DTOs to the client shape through **explicit whitelists**
(`mapDeparture`, `mapStaff`, …). A field the API newly returns will be **silently
dropped** on the client unless you add it to the relevant mapper.
- TRI-992: `mapDeparture` dropped unlisted fields — add new fields there.
- TRI-1080: `mapStaff` dropped `locked` / `lockedUntil` / `mfaEnabled` until the
  whitelist was extended.
- Symptom: "the API returns it but the UI never sees it." Check the mapper first.

## Gotcha 5 — migrations are forward-only; there are no down-migrations

- `npm run migrate` applies ordered `.sql` files, each in its own transaction,
  tracked in `schema_migrations`. **No down-migrations exist.** To revert you write
  the reverse SQL by hand and delete the `schema_migrations` row.
- **Always `pg_dump` before a prod migration** — for a data backfill (e.g. mig 028)
  the dump is the *only* real rollback.
- **Migration numbers currently collide going into cutover** (029/030 across the
  1061/1065 stacks; 030/031 with 1095). Reconcile before running against prod. See
  [PROD-CUTOVER-BACKLOG.md](./PROD-CUTOVER-BACKLOG.md) and [rollback.md](./rollback.md).
- Prod DB is at **mig 010**; dev at **31**. Diff `schema_migrations` before
  assuming anything is live.

## Gotcha 6 — prod cookie flags are set AT cutover, not before

Set on the prod env at cutover (not on dev, not early):
`COOKIE_SAMESITE=strict`, `COOKIE_SECURE=true` (TRI-1056). Trusted-device window is
14d (`config.ts trustedDeviceDays`, TRI-1085). Cookies use the `__Host-` prefix.

## Gotcha 7 — payments: HMAC over the RAW body

The Paystack webhook `/api/v1/payments/webhook` verifies an HMAC over the **raw**
request body. Any middleware that reparses/reserializes the body breaks signature
verification. Store USD, charge GHS; leave `PAYSTACK_USD_TO_GHS_RATE` UNSET on prod
(FX convergence, TRI-873/876). Test-mode: simulate `charge.success` with a
correctly-HMAC'd raw body (Paystack sits behind CF-Turnstile in the browser).

## Gotcha 8 — media/avatar uploads depend on the R2 token (expires 2026-08-24)

Object storage (R2, S3-compatible, dependency-free SigV4 in `storage.ts`) is
**safe-when-unconfigured**: missing `R2_*` env → `enabled=false` → media routes
answer **503**. A media/avatar 403/503 wave after **2026-08-24** is the **expired
token**, not a deploy. Rotation procedure + env checklist:
[SECRETS-ROTATION.md](./SECRETS-ROTATION.md).

## Gotcha 9 — house style: hand-rolled crypto, no heavy SDKs

The API ships only `fastify` / `pg` / `hash-wasm`. TOTP, the QR encoder
(`apps/admin/kit/qr.jsx`), and R2 SigV4 signing are **hand-rolled on purpose** — do
not add `@aws-sdk`, a TOTP lib, etc. without a real reason. Argon2id for password /
backup-code hashing; load seeds with `psql -f` (not `-c`) — TRI-990.

## Gotcha 10 — QA uses a dedicated bot account, never a real admin

E2E / QA runs against `qa-bot@tripkoach.dev`
(`secrets/tripkoach-dev-qa-admin.env`) — **never** Samuel's admin account, which
clobbers real board state (TRI-993). The admin login show-password toggle rewrites
`input[type=password]`; target `#a-email` / `#a-pw` in automation (TRI-990).

---

## Deploy quick-reference

| Change | Command |
|---|---|
| Static (web/admin) | `npm run build:<app>` → `scripts/deploy-static.sh <web|admin> [dev|prod]` |
| API | diff host vs local → `rsync apps/api/src` (changed lines) → `systemctl restart tripkoach-api[-prod]` |
| DB migration | `pg_dump` first → `npm run migrate` (forward-only) |
| Rollback | `scripts/deploy-rollback.sh rollback <app> <env>` / RUNBOOK §3 for API |

**Golden rule:** dev is the sandbox; **prod is gated on TRI-1057 and CEO sign-off.**
Nothing on the [cutover backlog](./PROD-CUTOVER-BACKLOG.md) ships piecemeal.
