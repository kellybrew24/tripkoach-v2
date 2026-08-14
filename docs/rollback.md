# Rollback story — TripKoach v2 deploys

**TRI-1109 (P1 delivery safety net).** Today every deploy is **forward-only,
in-place**:
- **Static (web/admin):** `scripts/deploy-static.sh <app> <env>` rsyncs `dist/`
  over the live document root with `--delete`. The old files are gone the instant
  rsync finishes. `config.js` is excluded (never clobbered) — that guardrail
  already exists (TRI-1002).
- **API:** rsync `apps/api/src` → `/opt/tripkoach-v2/apps/api/src` + `systemctl
  restart tripkoach-api-prod`. The previous `src` is overwritten in place.

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

### API rollback

The API has no build artifact to snapshot — `src` *is* the deploy. Git is the
source of truth, so the rollback is "redeploy the previous good commit's src":

```bash
git checkout <good-sha> -- apps/api/src
rsync -az apps/api/src/ root@168.119.117.136:/opt/tripkoach-v2/apps/api/src/
ssh root@168.119.117.136 'systemctl restart tripkoach-api-prod && sleep 2 && curl -fsS localhost:3120/api/health'
git checkout HEAD -- apps/api/src
```
Optional hardening (later): have the API deploy tar the current `src` to
`/opt/tripkoach-v2/releases/api-src-<ts>.tgz` before rsync, so a restore doesn't
depend on a laptop's git state. Noted as an automation candidate, not built now.

**Guardrail:** if the live host `src` is *ahead* of your branch (dev carries
1054/1056/1061-style fixes not yet reconciled), do NOT wholesale-rsync — diff
host-vs-local and patch only changed lines (`dev-deploy-src-ahead-of-branch`).

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
