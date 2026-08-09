#!/usr/bin/env bash
# =============================================================================
# TripKoach v2 — hardened static-host deploy wrapper (TRI-1002).
#
# WHY THIS EXISTS
#   The TRI-1001 headline incident: a manual `rsync dist/ → root` overwrote the
#   live host's /config.js with the checked-in DEFAULT (USE_LIVE_API:false),
#   silently turning the WHOLE admin console into static fixtures with no login
#   gate. This wrapper makes that regression STRUCTURALLY IMPOSSIBLE:
#
#     1. config.js (and any per-host runtime file) is ALWAYS rsync-excluded, so
#        a deploy can never clobber the host's live flag. On an already-deployed
#        root the host config.js is the source of truth and is never touched.
#     2. A fresh root with NO config.js is SEEDED once from the committed
#        shim/config.<env>.js (USE_LIVE_API:true) — never left flag-less.
#     3. A post-deploy ASSERTION curls the public /config.js and FAILS the
#        deploy (non-zero exit) unless USE_LIVE_API matches the expected value.
#
# USAGE
#     scripts/deploy-static.sh <web|admin> [dev|prod]      # default target: dev
#
#   Env overrides:
#     SKIP_BUILD=1   deploy the existing dist/ as-is (skip `npm run build:<app>`)
#     DRY_RUN=1      rsync --dry-run + skip chown/reload (assertion still runs)
#
# REQUIREMENTS: local `npm`, `rsync`, `ssh`, `curl`; SSH key access to the host.
# =============================================================================
set -euo pipefail

APP="${1:-}"
TARGET="${2:-dev}"

die() { echo "[deploy-static] ERROR: $*" >&2; exit 1; }
log() { echo "[deploy-static] $*"; }

case "$APP" in web|admin) ;; *) die "usage: deploy-static.sh <web|admin> [dev|prod]" ;; esac
case "$TARGET" in dev|prod) ;; *) die "target must be 'dev' or 'prod' (got '$TARGET')" ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=15 -i "$SSH_KEY")

# --- Per (app,target) host mapping -----------------------------------------
# EXPECTED_LIVE is the value the post-deploy assertion enforces on /config.js.
SEED_CONFIG="$REPO_ROOT/shim/config.$TARGET.js"
EXPECTED_LIVE="true"   # every real host (dev + prod) runs against the live API

if [[ "$TARGET" == "dev" ]]; then
  SSH_HOST="root@168.119.117.136"
  case "$APP" in
    web)   DEST_ROOT="/var/www/tripkoach-dev-web";   PUBLIC_URL="https://dev.tripkoach.com" ;;
    admin) DEST_ROOT="/var/www/tripkoach-dev-admin"; PUBLIC_URL="https://admin.dev.tripkoach.com" ;;
  esac
else
  # PROD host roots are owned by DevOps and are intentionally NOT hard-coded
  # here yet — set them explicitly to deploy prod, so nobody rsyncs a wrong
  # destination by accident. Fill DEST_ROOT + PUBLIC_URL (and SSH_HOST if it
  # differs) below once the prod static roots are confirmed, then remove this
  # guard. The hardening logic (exclude + seed + assert) is target-agnostic.
  SSH_HOST="${PROD_SSH_HOST:-root@168.119.117.136}"
  DEST_ROOT="${PROD_DEST_ROOT:-}"
  PUBLIC_URL="${PROD_PUBLIC_URL:-}"
  [[ -n "$DEST_ROOT" && -n "$PUBLIC_URL" ]] || die \
    "prod roots not configured — export PROD_DEST_ROOT and PROD_PUBLIC_URL (and PROD_SSH_HOST if needed). See DevOps runbook."
fi

DIST="$REPO_ROOT/apps/$APP/dist"
[[ -f "$SEED_CONFIG" ]] || die "missing seed config $SEED_CONFIG"

# --- 1. Build --------------------------------------------------------------
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  log "SKIP_BUILD=1 → using existing dist at $DIST"
else
  log "building $APP …"
  ( cd "$REPO_ROOT" && npm run "build:$APP" )
fi
[[ -f "$DIST/index.html" && -f "$DIST/app.js" ]] || die "dist looks incomplete ($DIST) — expected index.html + app.js"

# --- 2. rsync (config.js + per-host runtime + backups EXCLUDED) ------------
# Excluded paths are also protected from --delete (rsync does not delete
# excluded files unless --delete-excluded, which we never pass).
RSYNC_FLAGS=(-az --delete
  --exclude='config.js'        # the live runtime flag file — NEVER overwrite
  --exclude='config.*.js'      # any per-host runtime variant
  --exclude='config.js.bak*'   # incident backups (e.g. config.js.bak-tri1001)
  --exclude='*.bak-*'
)
[[ "${DRY_RUN:-0}" == "1" ]] && RSYNC_FLAGS+=(--dry-run --itemize-changes)

log "rsync $APP dist → $SSH_HOST:$DEST_ROOT (config.js excluded)"
rsync "${RSYNC_FLAGS[@]}" -e "ssh ${SSH_OPTS[*]}" "$DIST/" "$SSH_HOST:$DEST_ROOT/"

# --- 3. Seed config.js ONLY if the host has none (fresh root) --------------
if [[ "${DRY_RUN:-0}" != "1" ]]; then
  if ssh "${SSH_OPTS[@]}" "$SSH_HOST" "test -f '$DEST_ROOT/config.js'"; then
    log "host config.js present → left untouched (source of truth on the host)"
  else
    log "host has NO config.js → seeding from shim/config.$TARGET.js (first deploy)"
    scp "${SSH_OPTS[@]}" "$SEED_CONFIG" "$SSH_HOST:$DEST_ROOT/config.js"
  fi
  # --- 4. Ownership + reload ------------------------------------------------
  log "chown caddy:caddy + reload caddy"
  ssh "${SSH_OPTS[@]}" "$SSH_HOST" "chown -R caddy:caddy '$DEST_ROOT' && systemctl reload caddy"
else
  log "DRY_RUN=1 → skipped seed/chown/reload"
fi

# --- 5. Post-deploy assertion (the guardrail) ------------------------------
log "asserting $PUBLIC_URL/config.js has USE_LIVE_API=$EXPECTED_LIVE …"
CFG="$(curl -fsS "$PUBLIC_URL/config.js?cachebust=$$" || die "could not fetch $PUBLIC_URL/config.js")"
# Parse the ACTIVE assignment (a line with `USE_LIVE_API:` that is NOT a comment).
ACTUAL="$(printf '%s\n' "$CFG" | grep -E '^[^*/]*USE_LIVE_API' | grep -oE 'USE_LIVE_API[[:space:]]*:[[:space:]]*(true|false)' | grep -oE '(true|false)' | head -1 || true)"
[[ -n "$ACTUAL" ]] || die "could not parse USE_LIVE_API from $PUBLIC_URL/config.js"
if [[ "$ACTUAL" != "$EXPECTED_LIVE" ]]; then
  die "GUARDRAIL TRIPPED — $PUBLIC_URL/config.js has USE_LIVE_API=$ACTUAL, expected $EXPECTED_LIVE. The live flag was clobbered; fix the host config.js before trusting this deploy."
fi

log "✅ deploy OK — $APP@$TARGET live, USE_LIVE_API=$ACTUAL verified at $PUBLIC_URL/config.js"
