#!/usr/bin/env bash
# =============================================================================
# TripKoach v2 — POST-DEPLOY SECURITY SMOKE TEST (TRI-1165, parent TRI-1160 H-1).
#
# WHY THIS EXISTS
#   TRI-1160 H-1 root cause: the API host is maintained by hand-patching /
#   wholesale file replacement of apps/api/src. A feature deploy (TRI-1100)
#   shipped a server.ts from a branch predating the TRI-1054/1055 auth
#   rate-limit wiring and SILENTLY reverted a landed security control — no gate
#   caught it. This script IS that gate: it exercises three security controls
#   against a *running* API and fails (non-zero) if any is missing, so a deploy
#   that reverts a control cannot be marked green.
#
#   Run it as the last step of scripts/deploy-api.sh (which does exactly that),
#   or standalone against any environment.
#
# CHECKS (all must pass)
#   1. AUTH RATE LIMIT — the unauthenticated consumer login route returns 429
#      after N attempts from one IP (TRI-1055 SEC-H3 per-IP throttle). Uses
#      junk credentials, so it never touches a real account (invalid creds are
#      401 until the limiter trips).
#   2. SECURITY HEADERS — the public site (through Caddy, TRI-1053) returns the
#      hardening headers: HSTS, X-Frame-Options, X-Content-Type-Options, CSP,
#      Referrer-Policy. Checked against PUBLIC_BASE because these are set at the
#      edge, not by the app.
#   3. WEBHOOK HMAC — the Paystack webhook rejects a bad/missing signature with
#      401 (TRI-868/booking.ts verifySignature). A 2xx here would mean the HMAC
#      gate is off and forged payment events would be accepted.
#
# USAGE
#   scripts/security-smoke.sh <dev|prod>
#   # or fully explicit:
#   API_BASE=http://localhost:3020 PUBLIC_BASE=https://dev.tripkoach.com \
#     scripts/security-smoke.sh
#
# ENV OVERRIDES
#   API_BASE      — base for the running API's public prefix routes (login,
#                   webhook). Default per-env (localhost:3020 dev / :3120 prod).
#   PUBLIC_BASE   — public origin (through Caddy) for the header check.
#   RL_ATTEMPTS   — login attempts to fire (default 14; limit is 10/min).
#   RL_REQUIRED   — set 0 to treat a missing 429 as a WARN not a FAIL (default 1).
#   REQUIRED_HEADERS — space-separated header names that must be present.
#
# EXIT
#   0 — all required checks passed. Non-zero — at least one required check failed.
# =============================================================================
set -uo pipefail

ENVN="${1:-${ENVN:-dev}}"
case "$ENVN" in
  dev)  API_BASE="${API_BASE:-http://localhost:3020}"; PUBLIC_BASE="${PUBLIC_BASE:-https://dev.tripkoach.com}" ;;
  prod) API_BASE="${API_BASE:-http://localhost:3120}"; PUBLIC_BASE="${PUBLIC_BASE:-https://tripkoach.com}" ;;
  *)    API_BASE="${API_BASE:?set API_BASE for a non dev/prod env}"; PUBLIC_BASE="${PUBLIC_BASE:?set PUBLIC_BASE}" ;;
esac

RL_ATTEMPTS="${RL_ATTEMPTS:-14}"
RL_REQUIRED="${RL_REQUIRED:-1}"
REQUIRED_HEADERS="${REQUIRED_HEADERS:-strict-transport-security x-frame-options x-content-type-options content-security-policy referrer-policy}"

pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }
warn() { echo "  WARN  $*"; }
FAILED=0

echo "== TripKoach security smoke =="
echo "   env=$ENVN  API_BASE=$API_BASE  PUBLIC_BASE=$PUBLIC_BASE"

# -----------------------------------------------------------------------------
# 1. AUTH RATE LIMIT — expect a 429 within RL_ATTEMPTS tries from one IP.
# -----------------------------------------------------------------------------
echo "-- 1/3 auth rate limit ($API_BASE/api/v1/auth/login)"
saw_429=0; codes=""
# A stable junk address so we never brute a real account; creds are always wrong.
junk_email="smoke-ratelimit@tripkoach.invalid"
for i in $(seq 1 "$RL_ATTEMPTS"); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "$API_BASE/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$junk_email\",\"password\":\"wrong-$i\"}" 2>/dev/null || echo 000)"
  codes="$codes $code"
  if [ "$code" = "429" ]; then saw_429=1; break; fi
done
echo "     codes:$codes"
if [ "$saw_429" = "1" ]; then
  pass "login returned 429 (per-IP throttle active)"
elif [ "$RL_REQUIRED" = "0" ]; then
  warn "no 429 after $RL_ATTEMPTS attempts — rate limit NOT observed (RL_REQUIRED=0, not failing)"
else
  fail "no 429 after $RL_ATTEMPTS attempts — per-IP auth throttle (TRI-1055 SEC-H3) appears INACTIVE"
fi

# -----------------------------------------------------------------------------
# 2. SECURITY HEADERS — present on the public origin (Caddy, TRI-1053).
# -----------------------------------------------------------------------------
echo "-- 2/3 security headers ($PUBLIC_BASE/)"
hdrs="$(curl -fsSI --max-time 15 "$PUBLIC_BASE/" 2>/dev/null | tr 'A-Z' 'a-z')"
if [ -z "$hdrs" ]; then
  fail "could not fetch headers from $PUBLIC_BASE/"
else
  for h in $REQUIRED_HEADERS; do
    if printf '%s\n' "$hdrs" | grep -q "^$h:"; then
      pass "header present: $h"
    else
      fail "header MISSING: $h"
    fi
  done
fi

# -----------------------------------------------------------------------------
# 3. WEBHOOK HMAC — bad signature must NOT be accepted (expect 401).
# -----------------------------------------------------------------------------
echo "-- 3/3 webhook HMAC ($API_BASE/api/v1/payments/webhook)"
wh_bad="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "$API_BASE/api/v1/payments/webhook" \
  -H 'Content-Type: application/json' \
  -H 'x-paystack-signature: 0000000000000000deadbeefbadsignature' \
  -d '{"event":"charge.success","data":{"reference":"smoke-forged"}}' 2>/dev/null || echo 000)"
wh_none="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "$API_BASE/api/v1/payments/webhook" \
  -H 'Content-Type: application/json' \
  -d '{"event":"charge.success","data":{"reference":"smoke-forged"}}' 2>/dev/null || echo 000)"
echo "     bad_sig=$wh_bad  no_sig=$wh_none"
if [ "$wh_bad" = "401" ] || [ "$wh_bad" = "400" ]; then
  pass "webhook rejects a forged signature ($wh_bad)"
else
  fail "webhook did NOT reject a forged signature (got $wh_bad; a 2xx means the HMAC gate is off)"
fi
if [ "$wh_none" = "401" ] || [ "$wh_none" = "400" ]; then
  pass "webhook rejects a missing signature ($wh_none)"
else
  fail "webhook did NOT reject a missing signature (got $wh_none)"
fi

echo "== result: $([ "$FAILED" = "0" ] && echo PASS || echo FAIL) =="
exit "$FAILED"
