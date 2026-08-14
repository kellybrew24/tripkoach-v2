#!/usr/bin/env bash
# =============================================================================
# TripKoach v2 — on-box health + 5xx cron probe (TRI-1113 / TRI-1109 P1).
#
# Run every 5 minutes from root's crontab on the prod box:
#   */5 * * * * /opt/tripkoach-v2/scripts/health-check-prod.sh >> /var/log/tripkoach-health.log 2>&1
#
# ALERTS (both channels fire on any failure):
#   1. ntfy push → $NTFY_TOPIC (same topic as the GH Actions off-box monitor).
#   2. Resend email → ops@tripkoach.com (on-call record).
#
# ENV (set in /etc/tripkoach/tripkoach-v2-prod.env or crontab):
#   NTFY_TOPIC     — ntfy topic token (e.g. "tk-prod-alerts-<secret>")
#   NTFY_SERVER    — ntfy server base URL (default: https://ntfy.sh)
#   RESEND_API_KEY — Resend API key for email alerts
#   ALERT_EMAIL    — alert recipient (default: ops@tripkoach.com)
#   FIVE_XX_THRESHOLD — max 5xx lines per 5-min window before alerting (default: 5)
#
# DESIGN NOTES
#   - Complements the off-box GH Actions uptime monitor (catches "UP but 5xx").
#   - /api/health is the authoritative health endpoint (already exists on :3120).
#   - journalctl grep counts Fastify JSON log lines with "statusCode":5xx.
#   - Resend email is a best-effort record; ntfy is the primary pager.
#   - If NTFY_TOPIC or RESEND_API_KEY are unset the script still exits non-zero
#     so cron logs the failure; it does NOT silently succeed.
# =============================================================================
set -euo pipefail

API_PORT="${API_PORT:-3120}"
HEALTH_URL="http://localhost:${API_PORT}/api/health"
API_SVC="${API_SVC:-tripkoach-api-prod}"
NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
ALERT_EMAIL="${ALERT_EMAIL:-ops@tripkoach.com}"
FIVE_XX_THRESHOLD="${FIVE_XX_THRESHOLD:-5}"

TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
HOST="$(hostname -s)"

log()   { echo "[$TIMESTAMP health-check] $*"; }
alert() {
  local title="$1" body="$2"
  log "ALERT: $title — $body"

  # ntfy push
  if [[ -n "${NTFY_TOPIC:-}" ]]; then
    curl -fsS -X POST \
      -H "Title: $title" \
      -H "Priority: urgent" \
      -H "Tags: rotating_light,tripkoach" \
      -d "$body" \
      "${NTFY_SERVER}/${NTFY_TOPIC}" >/dev/null 2>&1 || log "ntfy push failed (non-fatal)"
  else
    log "NTFY_TOPIC unset — skipping push"
  fi

  # Resend email
  if [[ -n "${RESEND_API_KEY:-}" ]]; then
    curl -fsS -X POST "https://api.resend.com/emails" \
      -H "Authorization: Bearer $RESEND_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{
        \"from\": \"alerts@tripkoach.com\",
        \"to\": [\"$ALERT_EMAIL\"],
        \"subject\": \"[PROD ALERT] $title\",
        \"text\": \"Host: $HOST\\nTime: $TIMESTAMP\\n\\n$body\"
      }" >/dev/null 2>&1 || log "Resend email failed (non-fatal)"
  else
    log "RESEND_API_KEY unset — skipping email"
  fi
}

FAILED=0

# --- 1. Health endpoint -------------------------------------------------------
log "probing $HEALTH_URL"
if ! curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  alert "prod API health FAIL" \
    "curl $HEALTH_URL failed — API may be down. Check: systemctl status $API_SVC"
  FAILED=1
else
  log "health OK"
fi

# --- 2. 5xx rate in last 5 minutes -------------------------------------------
FIVE_XX_COUNT=0
if FIVE_XX_COUNT="$(journalctl -u "$API_SVC" --since '-5 min' --no-pager 2>/dev/null \
    | grep -c '"statusCode":5' 2>/dev/null || echo 0)"; then
  :
fi
log "5xx lines in last 5 min: $FIVE_XX_COUNT (threshold: $FIVE_XX_THRESHOLD)"
if (( FIVE_XX_COUNT > FIVE_XX_THRESHOLD )); then
  alert "prod API 5xx spike" \
    "${FIVE_XX_COUNT} 5xx log lines in last 5 min (threshold ${FIVE_XX_THRESHOLD}). Check: journalctl -u $API_SVC --since '-5 min'"
  FAILED=1
fi

if (( FAILED == 0 )); then
  log "all checks passed"
fi

exit $FAILED
