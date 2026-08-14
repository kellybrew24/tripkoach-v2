#!/usr/bin/env bash
# =============================================================================
# TripKoach v2 — prod static deploy with mandatory snapshot-before-deploy
# (TRI-1113 / TRI-1109 P1).
#
# WHY THIS EXISTS
#   deploy-static.sh is the audited rsync wrapper (do not edit it for this).
#   This thin wrapper guarantees a rollback snapshot is taken on the prod box
#   BEFORE every prod push, so a bad deploy can always be undone in <60s via
#   scripts/deploy-rollback.sh rollback <web|admin> prod.
#
# USAGE
#   export PROD_DEST_ROOT="/var/www/tripkoach-web"   # confirmed at cutover
#   export PROD_PUBLIC_URL="https://app.tripkoach.com"
#   export PROD_SSH_HOST="root@168.119.117.136"      # default if omitted
#   scripts/prod-deploy.sh <web|admin>
#
#   DRY_RUN=1  — runs snapshot + deploy-static.sh in dry-run mode; no changes.
#   SKIP_BUILD=1 — passed through to deploy-static.sh.
#
# ROLLBACK after a bad deploy
#   scripts/deploy-rollback.sh rollback <web|admin> prod
#
# API rollback: git-checkout-src procedure in docs/rollback.md.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APP="${1:-}"
case "$APP" in web|admin) ;; *) echo "usage: prod-deploy.sh <web|admin>" >&2; exit 1 ;; esac

# Guard: prod roots must be set (same as deploy-static.sh + deploy-rollback.sh).
[[ -n "${PROD_DEST_ROOT:-}" && -n "${PROD_PUBLIC_URL:-}" ]] || {
  echo "[prod-deploy] ERROR: export PROD_DEST_ROOT and PROD_PUBLIC_URL before deploying to prod." >&2
  exit 1
}

log() { echo "[prod-deploy] $*"; }

log "=== prod deploy: $APP ==="
log "PROD_DEST_ROOT=$PROD_DEST_ROOT"
log "PROD_PUBLIC_URL=$PROD_PUBLIC_URL"
log "PROD_SSH_HOST=${PROD_SSH_HOST:-root@168.119.117.136}"

# Step 1: snapshot current prod root (mandatory — abort if it fails).
log "--- step 1/2: snapshot ---"
"$REPO_ROOT/scripts/deploy-rollback.sh" snapshot "$APP" prod

# Step 2: deploy.
log "--- step 2/2: deploy ---"
SKIP_BUILD="${SKIP_BUILD:-0}" DRY_RUN="${DRY_RUN:-0}" \
  "$REPO_ROOT/scripts/deploy-static.sh" "$APP" prod

log "=== done. On failure: scripts/deploy-rollback.sh rollback $APP prod ==="
