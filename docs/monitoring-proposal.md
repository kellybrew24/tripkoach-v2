# Monitoring & alerting — minimal free-tier proposal

**TRI-1109 (P1).** There is no monitoring today. This proposes the smallest thing
that reliably tells us prod is down or erroring, on a $0 budget, on the existing
Hetzner box. **Nothing here is deployed yet** — standing it up is delegated to
DevOps and gated on the cutover authorization (TRI-1057).

## What we're protecting
- **Availability** of the prod API and the two SPAs.
- **Error rate** (5xx) on the API.
- A **human gets alerted** within minutes, through a channel someone actually watches.

## The key constraint: the monitor must not live only on the box it monitors
A self-hosted monitor on `168.119.117.136` cannot alert us when the **whole box**
goes down — the exact worst case. So we split it:

### 1. External uptime (primary) — off-box, free
**UptimeRobot free tier** (50 monitors, 5-min interval, email/Slack/Telegram alerts):
- Monitor `https://tripkoach.com/api/health` — **keyword check for `"status":"ok"`**
  (not just HTTP 200), so a degraded-DB response that still returns 200 still alerts.
- Monitor `https://tripkoach.com/` and `https://admin.tripkoach.com/` (HTTP 200).
- Monitor TLS cert expiry on the public host.

Why UptimeRobot: zero infra, off-box (survives a box outage), free, 5-min cadence
is fine for a pre-launch beta. Alternative if we prefer self-hosted+richer:
**Uptime Kuma** in one Docker/systemd unit on the box — but it shares the box's fate,
so only use it *in addition to* an off-box check, never instead of.

### 2. On-box error-rate + health probe (secondary) — pure bash cron, no new deps
The health endpoint already exists (`/api/health`); we lean on it plus journald.
A single cron script (model it on the v1 `health-check.sh` already running in the
`tripmybo` crontab, TRI-280) every 5 min:
- `curl -fsS localhost:3120/api/health` — fail → alert.
- Sample 5xx from the API log over the last interval:
  `journalctl -u tripkoach-api-prod --since '-5 min' | grep -c '"statusCode":5'` —
  over a threshold → alert.
- Alert channel: **email via the already-configured Resend transport**
  (EMAIL_FROM `@tripkoach.com`), or a free **ntfy.sh** / Telegram push. Recommend
  ntfy.sh (phone push, no inbox noise, free) as the on-call channel and email as
  the fallback/record.

This catches "health is up but the app is throwing 5xx" that a pure uptime ping
misses, and it's genuinely zero-cost / zero-new-service.

## Recommendation (smallest thing that works)
1. **UptimeRobot** off-box keyword monitor on `/api/health` + SPA 200 checks +
   TLS expiry → email + one push channel. *(primary, do first — 15 min of setup)*
2. **Bash cron** on the box: health probe + 5xx sampler → ntfy/email. *(secondary)*
3. Optional later: Uptime Kuma dashboard, or ship logs to a free Grafana Cloud /
   Better Stack tier if we outgrow journald. Not needed for launch.

## Non-goals for now
- APM / distributed tracing / metrics TSDB — overkill for a single-box beta.
- Paid PagerDuty-style on-call — revisit post-launch if volume justifies it.

## Handoff
DevOps to implement #1 and #2 during/after the cutover window (needs prod host +
public URL confirmed). Health endpoint and log format are already in place, so this
is configuration, not code. Tracked as a child of TRI-1109.
