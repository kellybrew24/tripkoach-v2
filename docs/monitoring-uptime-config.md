# External uptime monitoring — as-built config (TRI-1111)

Execution of `docs/monitoring-proposal.md` item #1 (off-box external uptime).
Non-gated: monitors **already-live** prod endpoints, deploys nothing to prod.

## ⚠️ Target correction (important)

The parent proposal and TRI-1111 text name `https://tripkoach.com/api/health` and
`tripkoach.com` / `admin.tripkoach.com` as the SPAs. That is **wrong for the v2 app**:

| Host | What actually serves it | v2? |
|---|---|---|
| `tripkoach.com`, `www.tripkoach.com` | Astro marketing site on **Cloudflare/LiteSpeed** (separate hosting) | ❌ no `/api`; `/api/health` → 404 |
| `app.tripkoach.com` | v2 **consumer SPA** on Caddy, same-origin `/api` → `tripkoach-api-prod` :3120 | ✅ |
| `admin.tripkoach.com` | v2 **admin SPA** on Caddy, same-origin `/api` | ✅ |

Verified 2026-08-14:
- `https://app.tripkoach.com/api/health` → `{"status":"ok","db":"pg",...}` (200)
- `https://admin.tripkoach.com/api/health` → `{"status":"ok",...}` (200)
- `https://app.tripkoach.com/` and `https://admin.tripkoach.com/` → 200
- TLS (Caddy / Let's Encrypt, auto-renewing) valid ~83 days out

**Monitor `app.` / `admin.tripkoach.com`, not the apex.** Pointing an uptime check
at `tripkoach.com/api/health` would alert-storm on a permanent 404 and would never
tell us anything about the v2 API.

## What was stood up: GitHub Actions (off-box, $0, no third-party account)

`.github/workflows/uptime.yml` — the sanctioned "or equivalent" to UptimeRobot.
GitHub-hosted runners are off-box (survive a box outage — the whole point), free,
and need no new account/infra. Every 5 min it probes:

1. keyword `"status":"ok"` on `https://app.tripkoach.com/api/health` (catches a
   200-but-degraded-DB response a bare ping would miss),
2. HTTP-200 on the consumer + admin SPAs,
3. TLS expiry ≥ 14 days on both hosts.

**Alerting (email + one push, per proposal):**
- **Email (baseline, zero-config):** a failed job triggers GitHub's built-in
  workflow-failure email to the repo account. Works with no secrets set.
- **Push (optional):** set repo secret `NTFY_TOPIC` (an *unguessable* ntfy.sh
  topic) → urgent phone push on failure. `NTFY_SERVER` optional (default
  `https://ntfy.sh`). No secret committed; safe for a public repo.

Activation: scheduled runs execute only from the **default branch**, so the
workflow starts probing once this lands on `main`. The `on: push` trigger runs it
once on merge to confirm wiring. Probe logic was smoke-tested locally against prod
on 2026-08-14 → 0 failures.

### To add the ntfy push channel (2 min, optional)
1. Pick an unguessable topic, e.g. `tripkoach-prod-<random>`.
2. Repo → Settings → Secrets and variables → Actions → New secret `NTFY_TOPIC`.
3. Subscribe to that topic in the ntfy app / `https://ntfy.sh/<topic>`.

## UptimeRobot alternative (if the team prefers the SaaS dashboard)

Equivalent config to paste into UptimeRobot free tier (50 monitors / 5-min):

| Monitor | Type | Target | Alert on |
|---|---|---|---|
| API health | Keyword | `https://app.tripkoach.com/api/health`, keyword `"status":"ok"`, alert when **not** present | keyword missing / down |
| Consumer SPA | HTTP(s) | `https://app.tripkoach.com/` | ≠ 200 |
| Admin SPA | HTTP(s) | `https://admin.tripkoach.com/` | ≠ 200 |
| TLS (app) | SSL/TLS expiry | `app.tripkoach.com` | < 14 days |
| TLS (admin) | SSL/TLS expiry | `admin.tripkoach.com` | < 14 days |

Alert contacts: Resend/`@tripkoach.com` email + one push (ntfy/Telegram).
Standing this up needs a UptimeRobot account (human signup / credential) — the GH
Actions monitor above is what was stood up autonomously in its place.

## Not covered here (gated on TRI-1057 cutover — see the issue)
- On-box `/api/health` + `journalctl` 5xx sampler cron (touches prod box).
- Snapshot-before-deploy wired into the prod static push flow.
