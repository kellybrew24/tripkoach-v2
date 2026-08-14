# TripKoach — Incident Response Runbook

**Owner:** CTO. **Audience:** whoever is on the incident. **Status:** P1 delivery
safety net (TRI-1109, parent TRI-1108/1087). Keep this current — a stale runbook
is worse than none.

> Scope: production (`tripkoach.com`) v2 stack. Dev hosts are the sandbox; the same
> commands apply with the dev names substituted (see the topology table).

---

## 0. First 5 minutes — triage

1. **Confirm the blast radius.** Hit the health endpoint from your laptop:
   ```bash
   curl -fsS https://tripkoach.com/api/health        # expect {"status":"ok","db":"pg",...}
   curl -fsIS https://tripkoach.com/                  # web SPA (200 + index.html)
   curl -fsIS https://admin.tripkoach.com/            # admin SPA (200) — if separate host
   ```
   - Health `ok` but users complain → likely a **frontend / static** problem or a
     single endpoint. Go to §2 (static rollback) or §4 (logs).
   - Health failing or timing out → **API or DB down**. Go to §1 then §3.
   - Everything times out → **box/network down**. Check the Hetzner console; the
     off-box uptime monitor should already have paged (see `docs/monitoring-proposal.md`).

2. **What changed?** Almost every incident is the last deploy. Check the last
   API restart and the last static push:
   ```bash
   ssh root@168.119.117.136 'systemctl show -p ActiveEnterTimestamp tripkoach-api-prod'
   ssh root@168.119.117.136 'ls -la --time-style=full-iso /opt/tripkoach-v2/apps/api/src | head'
   ```
   If a deploy is the suspect, **roll it back first, diagnose second** (§ROLLBACK / `docs/rollback.md`).

3. **Declare + comment.** Drop a one-line status on the active issue (or open one)
   so the team isn't double-driving. Note: symptom, suspected cause, action taken.

---

## 1. Production topology (where everything lives)

| Thing | Production | Dev (sandbox) |
|---|---|---|
| Host | Hetzner `168.119.117.136` | same box `168.119.117.136` |
| API service (systemd) | `tripkoach-api-prod` | `tripkoach-api` |
| API port (localhost) | `:3120` | `:3020` |
| API code root | `/opt/tripkoach-v2` | `/opt/tripkoach-v2` (dev runs TS direct) |
| API env / secrets | `/etc/tripkoach/tripkoach-v2-prod.env` | dev env file alongside |
| Postgres DB | `tripkoach_prod` (PG16, localhost) | `tripkoach_dev` |
| Web static root | prod root (owned by DevOps — set `PROD_DEST_ROOT`) | `/var/www/tripkoach-dev-web` |
| Admin static root | prod root (owned by DevOps) | `/var/www/tripkoach-dev-admin` |
| Reverse proxy | Caddy (`infra/caddy/Caddyfile.tripkoach`, TRI-1064) | Caddy dev vhosts |
| Public health | `https://tripkoach.com/api/health` | `https://dev.tripkoach.com/api/health` |
| Payments | Paystack (webhook `/api/v1/payments/webhook`, HMAC over raw body) | Paystack TEST |

> **The API health endpoint already exists** — `server.ts` serves `/health` and
> `/api/health` returning `{status:'ok', db, time}`. No code change needed to monitor.

---

## 2. Roll back a bad **static** (web/admin) push

Symptom: SPA broke after a `deploy-static.sh` run (blank page, wrong `config.js`,
JS error). See `docs/rollback.md` for the full procedure. Fast path:

```bash
# One snapshot is taken automatically before each deploy IF you deployed via the
# snapshot-aware path (scripts/deploy-rollback.sh snapshot ... run pre-deploy).
scripts/deploy-rollback.sh rollback web prod      # restores <root>.prev → <root>
scripts/deploy-rollback.sh rollback admin prod
```
- `config.js` (the live-API flag) is preserved by the deploy wrapper and by the
  snapshot — a rollback never resurrects a flag-off config.
- After rollback, re-run the post-deploy assertion: `curl` the public
  `/config.js` and confirm `USE_LIVE_API:true`.
- If no snapshot exists (deploy predates the safety net): rebuild the **last-known-good**
  commit locally and re-deploy — `git checkout <good-sha> && SKIP_BUILD=0 scripts/deploy-static.sh <app> prod`.

## 3. Roll back a bad **API** push

Symptom: 5xx spike / health failing right after an API deploy. The API deploy is
`rsync apps/api/src` + `systemctl restart tripkoach-api-prod`. To revert:

```bash
# Preferred: redeploy the previous good commit's src (git is the source of truth).
cd /home/iamsk/work/tripkoach-v2 && git log --oneline -10        # find last-good sha
git checkout <good-sha> -- apps/api/src
rsync -az apps/api/src/ root@168.119.117.136:/opt/tripkoach-v2/apps/api/src/
ssh root@168.119.117.136 'systemctl restart tripkoach-api-prod && sleep 2 && curl -fsS localhost:3120/api/health'
git checkout HEAD -- apps/api/src     # restore your working tree
```
- **Never wholesale-rsync `src/`** if the live host carries fixes ahead of your
  branch — diff host-vs-local first and patch only changed lines
  (`dev-deploy-src-ahead-of-branch` lesson). For prod this is less likely, but check.
- If the bad push also ran a **migration**, code rollback alone is not enough — see §DB.

## 4. Where the logs live

```bash
ssh root@168.119.117.136 'journalctl -u tripkoach-api-prod -n 200 --no-pager'      # API app log (Fastify)
ssh root@168.119.117.136 'journalctl -u tripkoach-api-prod -p err -n 100 --no-pager'
ssh root@168.119.117.136 'journalctl -u caddy -n 100 --no-pager'                   # proxy / TLS / 5xx at edge
# Quick 5xx count over the last hour from the proxy/app:
ssh root@168.119.117.136 "journalctl -u tripkoach-api-prod --since '1 hour ago' | grep -c '\"statusCode\":5'"
```
> **PII in logs is a known gap (TRI-1107):** the app logs recipient addresses in
> `send-email` and may log request bodies at error. Do not paste raw log lines
> containing emails/phones/tokens into issues or chat — redact first.

## 5. Reach the database

```bash
ssh root@168.119.117.136
sudo -u postgres psql tripkoach_prod          # prod DB (be careful — this is live)
# Read-only sanity checks:
SELECT count(*) FROM booking;
SELECT name, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;
```
- **Take a backup before any write / migration** (see §DB).
- Argon2 hashes and secrets live in this DB — treat every session as sensitive.

## 6. Secrets / env

- Prod API secrets: `/etc/tripkoach/tripkoach-v2-prod.env` on the box (root-owned).
  Contains Paystack keys, Resend key, cookie flags, DB creds. **Never** paste into
  an issue, doc, or anything git-synced.
- Cookie posture at cutover: `COOKIE_SAMESITE=strict`, `COOKIE_SECURE=true`.
- R2 (media/avatar CDN) token **expires 2026-08-24** — rotation is its own task; a
  media 403/503 wave after that date is the token, not a deploy. Procedure + full
  secret inventory: [`docs/SECRETS-ROTATION.md`](docs/SECRETS-ROTATION.md).

> **See also:** [`docs/OPERATIONS.md`](docs/OPERATIONS.md) (build/deploy gotchas for
> new engineers) and [`docs/PROD-CUTOVER-BACKLOG.md`](docs/PROD-CUTOVER-BACKLOG.md)
> (every ⚠PROD item that owes production, gated on TRI-1057).

---

## 7. Supply-chain / dependency gate (CI)

Every PR to `main` runs `.github/workflows/supply-chain.yml`: `npm ci` (lockfile-drift
check) + an `npm audit --omit=dev` gate on **HIGH/CRITICAL** advisories in production deps,
for the root and `apps/api` lockfiles. Dependabot (`.github/dependabot.yml`) opens weekly
update PRs. **A red `supply-chain` check means a dependency has a high/critical advisory or
the lockfile drifted** — fix with `npm audit fix` / a bump, or (no fix available) add an
*expiring* entry to `.audit-allowlist.json`. Full policy + allow-list how-to:
[`docs/SUPPLY-CHAIN.md`](docs/SUPPLY-CHAIN.md).

---

## <a name="rollback"></a>ROLLBACK — DB migrations (the hard part)

Migrations are **forward-only**: `npm run migrate` applies ordered `.sql` files in
a transaction each, tracked in `schema_migrations`. **There are no down-migrations.**
To revert a schema change you write and run the reverse SQL by hand, then delete the
row from `schema_migrations`.

**Before any migration on prod:**
```bash
ssh root@168.119.117.136 "sudo -u postgres pg_dump tripkoach_prod | gzip > /root/tripkoach_prod_$(date +%Y%m%d_%H%M%S).sql.gz"
```
A pre-migration dump is the real rollback path for a destructive change.

**Reversibility of recent migrations** (full table in `docs/rollback.md`):
- **Additive & easily reversible** (add column/table/index, widen CHECK):
  026 (enquiry type), 027 (consumer MFA tables), 031 (booking `public_token`) —
  revert by dropping the added object. Cheap, low-risk.
- **Data backfill — NOT cleanly reversible**: 028 (guest-customer backfill) creates
  rows; reverting means identifying and deleting exactly those rows. Restore from the
  pre-migration dump instead of hand-reversing.
- **Migration numbering is contested going into cutover:** the 1061 and 1065 stacks
  both introduce a mig `029/030` (MFA brute-force lockout) with the same columns via
  different helpers. **Dedupe + renumber at cutover; never blind-rsync one over the
  other.** Prod DB is currently at a *lower* applied number than dev — reconcile the
  ordered set before running `migrate` against prod (TRI-1057).

---

## Escalation

- Payments / money-movement incident → CTO immediately, then CEO.
- Data exposure / suspected breach → CTO + follow the security memo (TRI-1107); do
  not discuss specifics in public channels.
- Anything needing a prod window or spend → CEO (cutover stays gated on TRI-1057).
