# Rollback story — TripKoach v2 deploys

**TRI-1109 (P1 delivery safety net).** Today every deploy is **forward-only,
in-place**:
- **Static (web/admin):** `scripts/deploy-static.sh <app> <env>` rsyncs `dist/`
  over the live document root with `--delete`. The old files are gone the instant
  rsync finishes. `config.js` is excluded (never clobbered) — that guardrail
  already exists (TRI-1002).
- **API:** `scripts/deploy-api.sh <dev|prod> <git-ref>` ships **committed content
  only** (`git archive` of a pinned commit) + `systemctl restart` + a security
  smoke gate (TRI-1165). It snapshots the current `src` to
  `/opt/tripkoach-v2/releases/api-src-<ts>.tgz` first, so a bad deploy auto-rolls
  back. **Do not hand-edit host `src` or rsync from a working tree** — that is how
  TRI-1160 H-1 silently reverted a landed control.

Neither keeps a previous release, so "undo the last deploy" today means *rebuild
and redeploy an older commit*. That works but is slow under pressure. This doc
defines a faster, reversible path and documents the manual fallback.

## Design: keep the previous release, swap back on demand

The cheapest reversible mechanism that fits an in-place rsync host is a
**pre-deploy snapshot** of the target directory, restorable with one command.
Implemented as a standalone, additive script — `scripts/deploy-rollback.sh` — so it
touches nothing in the existing hardened `deploy-static.sh`:

```bash
# BEFORE deploying (DevOps runs this as the first step of a prod push):
scripts/deploy-rollback.sh snapshot web  prod     # copies <root> → <root>.prev-<ts>, updates <root>.prev symlink
scripts/deploy-rollback.sh snapshot admin prod

# ... normal deploy ...
scripts/deploy-static.sh web  prod
scripts/deploy-static.sh admin prod

# IF the deploy is bad:
scripts/deploy-rollback.sh rollback web prod      # restores <root>.prev → <root>, reloads caddy
```

Properties:
- **Reversible & additive:** one new file; deleting it removes the capability with
  zero residue. No change to the audited `deploy-static.sh`.
- **config.js safe:** the snapshot captures the *live* `config.js`, so a restore
  preserves the host's live-API flag (same invariant `deploy-static.sh` protects).
- **Bounded disk:** keeps the last **2** snapshots per root (`.prev`, `.prev-1`),
  prunes older ones. A static build is a few MB — negligible on the box.
- **Post-restore assertion:** after a rollback, re-run the public `/config.js`
  check (`curl … | grep USE_LIVE_API`) exactly as the deploy wrapper does.

> Folding a `rollback` verb directly into `deploy-static.sh` is the alternative
> the ticket floats. We chose a **separate script** to avoid editing a shared,
> concurrency-sensitive file mid-flight (shared-repo lesson) and to keep the
> change trivially reversible. At cutover, DevOps may inline it if preferred.

### API deploy — git-pinned, drift-guarded, smoke-gated (TRI-1165)

`scripts/deploy-api.sh <dev|prod> [git-ref]` is the **only** supported way to push
the API. It exists because the host `src` was maintained by hand-patching /
wholesale rsync, which let a TRI-1100 feature deploy ship a stale `server.ts` and
**silently revert** the TRI-1054/1055 auth rate-limit control (TRI-1160 H-1) — no
gate caught it. The script closes that gap:

```bash
scripts/deploy-api.sh dev  <good-sha>     # or prod
```
- **Committed content only.** Ships `git archive <ref>` of `apps/api/{src,package.json,migrations}` —
  never the dirty working tree, never a hand-edited host file. Refuses if `apps/api`
  differs from the ref (unless `ALLOW_DIRTY=1`).
- **Drift guard.** Reads `/opt/tripkoach-v2/DEPLOYED_REF` (the last deployed SHA) and
  refuses if the host carries shadow `.bak`/`.pre-*` files (someone hand-edited),
  unless `FORCE=1`. Records the new SHA to `DEPLOYED_REF` after a successful ship.
- **Auto-rollback.** Snapshots `src` → `releases/api-src-<ts>.tgz` before shipping;
  restores it + restarts if health or the smoke gate fails.
- **Security smoke gate.** Runs `scripts/security-smoke.sh` after restart and FAILS
  the deploy (auto-rollback) if a control is missing — asserts login returns 429
  after N attempts, the hardening headers are present, and the webhook rejects a bad
  HMAC. Runnable standalone: `scripts/security-smoke.sh <dev|prod>` (exit non-zero on
  any missing control) — use it as a post-deploy check and in CI.

> **⚠ Reconciliation prerequisite (TRI-1057).** The live host `src` is currently an
> UNRECONCILED superset — it carries `rate-gate.ts` + TRI-1054/1055/1061/1062/1079
> patches that are **not yet in `origin/main`**. Deploying `origin/main` today would
> REVERT those controls, so `deploy-api.sh` is not yet CI-wired to main. First import
> the host superset into git (child of TRI-1165), *then* pin deploys to that ref. The
> smoke gate is the backstop: even a wrong ref that drops a control fails the deploy.

### API rollback

`deploy-api.sh` auto-rolls back on a failed gate. To revert manually, restore the
pre-deploy snapshot on the host, or redeploy the previous good commit:

```bash
# fast: restore the snapshot the deploy took
ssh root@168.119.117.136 'cd /opt/tripkoach-v2 && rm -rf apps/api/src && \
  tar xzf releases/api-src-<ts>.tgz && systemctl restart tripkoach-api-prod && \
  sleep 2 && curl -fsS localhost:3120/api/health'
# or redeploy a known-good commit through the gated path:
scripts/deploy-api.sh prod <good-sha>
```

**Guardrail:** the host `src` may be *ahead* of `origin/main` (dev carries
1054/1056/1061-style fixes not yet reconciled). Never wholesale-rsync a branch over
it (`dev-deploy-src-ahead-of-branch`); pin the deploy to a ref that INCLUDES those
controls and let the smoke gate confirm.

## Database migrations — reversibility inventory

Runner: `apps/api/src/migrate.ts`. Ordered `.sql`, one transaction per file,
tracked in `schema_migrations`. **No down-migrations exist.** Reverting = hand-written
reverse SQL + `DELETE FROM schema_migrations WHERE name = '…'`, OR restore from a
pre-migration `pg_dump` (always take one first).

| Mig | What it does | Reversible? | How to revert |
|---|---|---|---|
| 026 enquiry_interest_type | Widen `enquiry.type` CHECK to add `interest` | ✅ easy | drop+re-add narrower CHECK (fails if `interest` rows exist) |
| 027 consumer_mfa | New tables `user_mfa_factor`, `user_recovery_code` (+indexes) | ✅ easy | `DROP TABLE` both (loses enrolled consumer 2FA) |
| 028 backfill_guest_customers | **Data backfill** — inserts `customer` rows, sets `booking.customer_id` | ⚠️ not cleanly | restore from pre-mig dump; hand-reverse is error-prone |
| 031 booking_public_token | Add `booking.public_token`, `token_required` col + unique index | ✅ easy | drop index + columns (breaks token-gated guest links minted after) |
| 029/030 (contested) | MFA brute-force throttle/lockout — **1061 vs 1065 both claim these numbers with different helpers** | ⚠️ reconcile first | dedupe + renumber before applying to prod (TRI-1057); do not blind-apply |

**Prod DB is behind dev** on applied migrations. Before cutover, reconcile the
ordered set (resolve the 029/030 collision), take a dump, then `npm run migrate`.
Rule of thumb: **additive DDL is reversible and safe to fast-forward; any data
migration or destructive DDL requires a pre-migration dump as the rollback plan.**

## Manual fallback (no snapshot available)

If a bad deploy predates the snapshot script:
- **Static:** `git checkout <good-sha>` → `scripts/deploy-static.sh <app> prod`
  (rebuild + redeploy last-known-good).
- **API:** the git-checkout-src procedure above.
- **DB:** restore the latest pre-migration `pg_dump` (accepting data loss back to
  the dump), or hand-write reverse SQL for a purely additive change.
