# Cutover migration reconciliation — 011 → 032 (TRI-1170)

Cutover-blocking prep for **TRI-1057** (batched prod cutover, CEO-gated). This branch
(`tri-1170-cutover-migration-set`, based on `origin/main`) is the **single git ref that carries the
complete, contiguous, deduped migration chain 001 → 032** plus the security code that reads the columns
they add. Do **not** run any of this against prod — that rides TRI-1057.

## The problem this fixes

No single ref had the whole ordered set, and one number had two divergent definitions:

| Ref | Had | Missing |
|-----|-----|---------|
| `origin/main` (security line) | 011→030 incl. 029 + `030_consumer_login_lockout.sql`, admin+consumer **password** lockout code | 031, 032, and the TRI-1061 **MFA** hardening (no `mfa_failed_count` anywhere) |
| `tri-1155-remove-dashes` (feature-line tip) | 011–028 + 031 + 032 | 029, 030, **all** brute-force lockout code |
| `tri-1061-mfa-brute-force` | `030_mfa_bruteforce_hardening.sql` (superset) + MFA code | branched pre-TRI-1065, so its consumer-lockout code is an *older, parallel* implementation |

The migration runner (`apps/api/src/migrate.ts`) tracks applied migrations **by filename**, forward-only,
`.sort()`-ordered, one file per transaction. So **two `030_*` files would both run**. Dedupe therefore
has to happen in the files (keep exactly one `030_*`), not in the DB.

### The 030 divergence

* `main`: `030_consumer_login_lockout.sql` — `user_account.{failed_login_count,locked_until}` only.
* `tri-1061`: `030_mfa_bruteforce_hardening.sql` — the **superset**: the same two `user_account` columns
  **plus** `session.mfa_failed_count`, all `ADD COLUMN IF NOT EXISTS`.

## What this branch contains

1. **One contiguous 011→032 chain, single file per number:**
   * `029_admin_login_lockout.sql` — `staff_user.{failed_login_count,locked_until}` (TRI-1054). Identical
     on `main` and `tri-1061`; unchanged.
   * `030_mfa_bruteforce_hardening.sql` — **the TRI-1061 superset** (all three columns, `IF NOT EXISTS`).
     `030_consumer_login_lockout.sql` was **deleted** so only one `030_*` exists.
   * `031_booking_public_token.sql` — `booking.{public_token,token_required}` + backfill + unique index (TRI-1095).
   * `032_departure_visibility.sql` — `departure.visibility` CHECK/DEFAULT (TRI-1136/1137).

2. **The TRI-1061 MFA-lockout CODE, reconciled onto main's post-TRI-1065 architecture (no duplication):**
   `main` already split password lockout into `recordFailedLogin`/`resetFailedLogins` (staff, `auth.ts`)
   and `recordFailedUserLogin`/`resetFailedUserLogins` (consumer, `consumer-auth.ts`). `tri-1061` predates
   that split and used one parameterized helper for both realms. We did **not** import tri-1061's parallel
   helpers (that would duplicate the consumer password lockout). Instead we added only the genuinely
   net-new surface on top of main's helpers:
   * `auth.ts`: `MFA_MAX_ATTEMPTS`, `lockoutMessage()`, `recordMfaFailure(db, sessionId)` (realm-neutral,
     drives `session.mfa_failed_count`, revokes the pending session at the cap), and `resolvePendingSession`
     now surfaces staff lockout state.
   * `consumer-auth.ts`: `resolvePendingUserSession` now surfaces `user_account` lockout state.
   * `admin-routes.ts` + `consumer-routes.ts` `/auth/mfa`: reject a locked account before verifying; on a
     wrong code, cap per-session **and** feed the existing per-account lockout (`recordFailedLogin` /
     `recordFailedUserLogin`); on success, reset the counter.

   > **Coordinate with TRI-1164** (security re-deploy of the regressed 1054/1055/1061/1065 controls to dev):
   > deploy the MFA code from **this reconciled ref**, NOT from raw `tri-1061-mfa-brute-force` — the raw
   > branch re-introduces a second, older consumer password-lockout implementation. Same regression surface;
   > do not apply both.

## Prod `schema_migrations` reconciliation (TRI-1057, do NOT run yet)

Prod DB is at **migration 010** (`schema_migrations` has 001→010). Cutover = a straight forward-only apply
of **011 → 032 in filename order**. The runner records each filename in `schema_migrations` inside its own
transaction, so a mid-run failure leaves a clean prefix applied.

* Prod will only ever see **one** `030_*` (`030_mfa_bruteforce_hardening.sql`) — the ambiguity is gone.
* **Only real rollback risk = `028_backfill_guest_customers.sql`.** It is the one data-mutating migration
  (DDL 011–027, 029–032 are additive `ADD COLUMN`/index and reversible by drop). **Take a `pg_dump` of the
  prod DB immediately before applying 028** — that dump is the rollback path for the backfill; the rest roll
  back by dropping the added columns/indexes.

### Verification done on this branch (fresh in-memory PGlite / real Postgres semantics)

* Full 001→032 applies forward-only; exactly one `030_*` runs; contiguous, no gaps/dupes; re-run applies 0.
* Superset 030 yields `session.mfa_failed_count` + `user_account.{failed_login_count,locked_until}`.
* `recordMfaFailure`: increments per wrong code, revokes the session at `MFA_MAX_ATTEMPTS`, idempotent after.
* `tsc -p tsconfig.json`: the MFA merge adds **zero** new type errors (the 2 pre-existing `main` errors —
  `consumer-routes.ts` `out.user` union narrowing + `test/smoke.ts` `"PUT"` — are unchanged and out of scope).

## Caveat: base is the security line, not the feature line

This branch is `origin/main` + the migration chain + the MFA delta. It intentionally does **not** carry the
feature-line work (dashes, T&C, custom-date UI, hero, etc.). Merging the two lines is **TRI-1057's** job; this
ref exists so the *migration + security-code half* of that cutover is a clean, reviewed, forward-only apply.
