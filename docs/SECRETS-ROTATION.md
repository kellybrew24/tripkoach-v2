# SECRETS-ROTATION.md — env/secret inventory + rotation procedures

**Owner:** CTO → DevOps for execution. Written for TRI-1110 P2 item 10.
**Companion:** [OPERATIONS.md](./OPERATIONS.md), [RUNBOOK.md](../RUNBOOK.md) §6.

> Secrets live **only** in the systemd `EnvironmentFile` on the box
> (`/etc/tripkoach/tripkoach-v2-prod.env` for prod; the dev env file for dev).
> **Never** commit a secret, paste one into an issue/comment/doc, or log it. The
> `.env.example` in `apps/api/` documents *names only*, never values.

---

## 🔴 URGENT — Cloudflare R2 media token expires **2026-08-24**

**Impact if it lapses:** media + avatar uploads break on **both dev and prod**.
The storage layer is safe-when-unconfigured, so an expired/invalid token doesn't
crash the API — media routes just return **503** and uploads silently fail. There
is **no automatic alert** today (monitoring gap — see [monitoring-proposal.md](./monitoring-proposal.md)).

### What the token is

An R2 (S3-compatible) API token = an **access-key-id + secret-access-key** pair,
scoped to the media bucket. The API reads these env names (verbatim from the token
file the board supplied; neutral `MEDIA_*` names also honoured — see `config.ts`
`loadMediaConfig`):

| Env var | What it is | Rotates? |
|---|---|---|
| `R2_ACCESS_KEY_ID` | token access key id | **YES — the credential** |
| `R2_SECRET_ACCESS_KEY` | token secret | **YES — the credential** |
| `R2_ENDPOINT` (or `S3_API`) | `https://<account>.r2.cloudflarestorage.com` | no (stable) |
| `R2_BUCKET` | bucket name | no |
| `R2_PUBLIC_URL` / `CUSTOM_DOMAIN` | public CDN host (`cdn.tripkoach.com`) | no |
| `R2_REGION` | `auto` | no |

Only the **access-key pair** expires. The endpoint/bucket/public host stay put.

### Who has to do what — and the credential gap

Generating a new R2 API token requires **Cloudflare dashboard access to the
TripKoach account** (R2 → Manage API Tokens). **The engineering agents do not hold
that login — the board/CEO does.** So rotation is a two-party task:

1. **CEO / account owner (blocking input):** create a new R2 API token in the
   Cloudflare dashboard (R2 → *Manage R2 API Tokens* → *Create API token*), scoped
   **Object Read & Write** to the media bucket. Set expiry to **≥12 months** (or
   no-expiry per policy) so we don't repeat this fire drill — and put the next
   expiry date on the calendar. Hand the **new access-key-id + secret** to DevOps
   over a secure channel (not an issue comment).
2. **DevOps (execution):** drop the new pair into both EnvironmentFiles, restart
   the services, verify an upload round-trips, then **revoke the old token** in
   Cloudflare.

> **This is flagged to the CEO** on TRI-1110 and TRI-1057 — rotation cannot
> complete without the CEO generating the token. Tracked as a DevOps child issue.

### Rotation procedure (DevOps, once the new key pair is in hand)

```bash
# 1. DEV first (sandbox). Edit the dev EnvironmentFile — replace the two values only:
ssh root@168.119.117.136
#   $EDITOR <dev env file>   → set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
systemctl restart tripkoach-api
sleep 2 && curl -fsS localhost:3020/api/health

# 2. Verify an upload actually round-trips on dev (admin media upload or avatar).
#    A 200 with a cdn.tripkoach.com URL that then fetches 200 = good.
#    503 on the media route = env not picked up (check names/restart).

# 3. PROD — same edit against the prod EnvironmentFile:
#   $EDITOR /etc/tripkoach/tripkoach-v2-prod.env
systemctl restart tripkoach-api-prod
sleep 2 && curl -fsS localhost:3120/api/health
#    Then verify a prod upload round-trips.

# 4. Only after BOTH verify: revoke the OLD token in the Cloudflare dashboard.
#    (Revoking before verify = self-inflicted outage.)
```

Rollback: if the new key fails, the old token is still valid **until you revoke it
in step 4** — just put the old values back and restart. Keep the old pair until
both envs verify.

### Verification checklist

- [ ] New token created (CEO), Object R&W, expiry ≥12mo, next-expiry on calendar
- [ ] Dev env updated + `tripkoach-api` restarted + upload round-trips
- [ ] Prod env updated + `tripkoach-api-prod` restarted + upload round-trips
- [ ] Old token **revoked** in Cloudflare
- [ ] This file's expiry banner updated to the new date; calendar reminder set for T-14d

---

## Full prod secret inventory (so a rotation never surprises us again)

All in `/etc/tripkoach/tripkoach-v2-prod.env` (root-owned). Names only:

| Secret | Purpose | Rotation trigger | Owner to generate |
|---|---|---|---|
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | media/avatar CDN | **expiry (next: set at rotation)** | CEO (Cloudflare) → DevOps |
| `PAYSTACK_SECRET_KEY` (`TRIPKOACH_PAYSTACK_SECRET_KEY`) | charge/refund API | on suspected leak / key roll; test↔live swap at go-live | CEO (Paystack) → DevOps |
| `PAYSTACK_WEBHOOK_SECRET` (`TRIPKOACH_PAYSTACK_WEBHOOK_SECRET`) | verify webhook HMAC (raw body) | with the secret-key roll | CEO (Paystack) → DevOps |
| Resend / email API key (`EMAIL_*`) | transactional email (`@tripkoach.com`) | on leak | CEO/DevOps |
| DB credentials (`DATABASE_URL` / PG creds) | `tripkoach_prod` | on leak / host rebuild | DevOps |
| Cookie / session signing key(s) | session integrity | on leak (forces re-login) | DevOps |
| FTP creds (legacy `/beta/` host, `instructions/SECRETS.md`) | legacy static deploy | **treat as compromised — rotate + delete file** (TRI-3) | CTO/DevOps |

### Rotation hygiene rules

1. **Two-value swap, not a rewrite** — change only the secret's value lines; leave
   endpoints/bucket/URLs alone.
2. **Verify before revoke** — new credential must round-trip on dev *and* prod
   before the old one is revoked/disabled.
3. **Secure hand-off** — credentials the CEO generates come to DevOps out-of-band,
   never in an issue comment or anything git-synced.
4. **Set the next reminder** — every expiring secret gets a calendar/cron reminder
   at **T-14 days**. Until an external monitor exists, the reminder is the alert.
5. **No secret is ever defaulted in code** — `config.ts` reads env only and degrades
   safely (media 503 / email disabled) when unset.

---

## Prod env checklist (non-secret flags that ride the cutover)

Cross-reference [PROD-CUTOVER-BACKLOG.md](./PROD-CUTOVER-BACKLOG.md); set at cutover:

- [ ] `COOKIE_SAMESITE=strict`, `COOKIE_SECURE=true` (TRI-1056)
- [ ] `PAYSTACK_USD_TO_GHS_RATE` **UNSET** (FX convergence, TRI-873/876)
- [ ] `PROD_DEST_ROOT` / `PROD_PUBLIC_URL` (from CEO/DevOps — unblocks TRI-1057)
- [ ] `config.js` on static has `USE_LIVE_API:true`
