#!/usr/bin/env bash
# =============================================================================
# TripKoach v2 — static-deploy rollback helper (TRI-1109, P1 safety net).
#
# WHY THIS EXISTS
#   scripts/deploy-static.sh does an in-place rsync --delete over the live
#   document root: the previous release is gone the instant it finishes, so there
#   is no "undo the last deploy". This helper adds a reversible snapshot/restore
#   path WITHOUT editing the audited deploy-static.sh (kept separate on purpose —
#   shared-file concurrency + trivially reversible: delete this file, capability
#   gone). See docs/rollback.md for the full design.
#
# MODEL
#   Before a deploy:   snapshot  → copies <root> to <root>.prev (keeps last 2)
#   After a bad deploy: rollback → restores <root>.prev back over <root> + reload
#   The snapshot captures the LIVE config.js, so a restore preserves the host's
#   live-API flag (same invariant deploy-static.sh protects).
#
# USAGE
#   scripts/deploy-rollback.sh snapshot <web|admin> [dev|prod]
#   scripts/deploy-rollback.sh rollback <web|admin> [dev|prod]
#   scripts/deploy-rollback.sh list     <web|admin> [dev|prod]
#
#   Env overrides (prod roots are intentionally not hard-coded — same guard as
#   deploy-static.sh): PROD_SSH_HOST, PROD_DEST_ROOT, PROD_PUBLIC_URL.
#   DRY_RUN=1 prints the ssh commands without running the copy/restore/reload.
#
# NOTE: This has NOT been run against prod. Dry-run + a dev exercise first.
# =============================================================================
set -euo pipefail

VERB="${1:-}"
APP="${2:-}"
TARGET="${3:-dev}"

die() { echo "[rollback] ERROR: $*" >&2; exit 1; }
log() { echo "[rollback] $*"; }

case "$VERB" in snapshot|rollback|list) ;; *) die "usage: deploy-rollback.sh <snapshot|rollback|list> <web|admin> [dev|prod]" ;; esac
case "$APP" in web|admin) ;; *) die "app must be 'web' or 'admin' (got '${APP:-}')" ;; esac
case "$TARGET" in dev|prod) ;; *) die "target must be 'dev' or 'prod' (got '$TARGET')" ;; esac

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=15 -i "$SSH_KEY")

# --- Per (app,target) host mapping — mirrors deploy-static.sh ---------------
if [[ "$TARGET" == "dev" ]]; then
  SSH_HOST="root@168.119.117.136"
  case "$APP" in
    web)   DEST_ROOT="/var/www/tripkoach-dev-web";   PUBLIC_URL="https://dev.tripkoach.com" ;;
    admin) DEST_ROOT="/var/www/tripkoach-dev-admin"; PUBLIC_URL="https://admin.dev.tripkoach.com" ;;
  esac
else
  SSH_HOST="${PROD_SSH_HOST:-root@168.119.117.136}"
  DEST_ROOT="${PROD_DEST_ROOT:-}"
  PUBLIC_URL="${PROD_PUBLIC_URL:-}"
  [[ -n "$DEST_ROOT" && -n "$PUBLIC_URL" ]] || die \
    "prod roots not configured — export PROD_DEST_ROOT and PROD_PUBLIC_URL (and PROD_SSH_HOST if needed). See docs/rollback.md."
fi

PREV="${DEST_ROOT}.prev"       # most-recent snapshot (what rollback restores)
PREV1="${DEST_ROOT}.prev-1"    # one older, kept for a second undo

run_ssh() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "[dry-run] ssh $SSH_HOST '$*'"; else ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$*"; fi
}

assert_config() {
  # Post-restore guardrail: same check deploy-static.sh runs — /config.js must be live.
  [[ "${DRY_RUN:-0}" == "1" ]] && { log "dry-run → skip /config.js assertion"; return 0; }
  local cfg actual
  cfg="$(curl -fsS "$PUBLIC_URL/config.js?cachebust=$$" || die "could not fetch $PUBLIC_URL/config.js after restore")"
  actual="$(printf '%s\n' "$cfg" | grep -E '^[^*/]*USE_LIVE_API' | grep -oE '(true|false)' | head -1 || true)"
  [[ "$actual" == "true" ]] || die "post-rollback /config.js has USE_LIVE_API=$actual (expected true) — fix host config.js"
  log "✅ post-rollback assertion OK — $PUBLIC_URL/config.js USE_LIVE_API=true"
}

case "$VERB" in
  snapshot)
    log "snapshotting $SSH_HOST:$DEST_ROOT → $PREV (rotating one back to $PREV1)"
    run_ssh "test -d '$DEST_ROOT' || { echo 'no dest root to snapshot: $DEST_ROOT' >&2; exit 3; }; \
      if [ -d '$PREV' ]; then rm -rf '$PREV1'; mv '$PREV' '$PREV1'; fi; \
      cp -a '$DEST_ROOT' '$PREV'; \
      echo \"snapshot done: \$(ls -1 '$PREV' | wc -l) entries at $PREV\""
    log "done. Deploy now; if it goes bad: scripts/deploy-rollback.sh rollback $APP $TARGET"
    ;;
  rollback)
    log "rolling back $SSH_HOST:$DEST_ROOT ← $PREV"
    run_ssh "test -d '$PREV' || { echo 'no snapshot to restore: $PREV — use the git-rebuild fallback (docs/rollback.md)' >&2; exit 4; }; \
      rm -rf '${DEST_ROOT}.failed'; \
      mv '$DEST_ROOT' '${DEST_ROOT}.failed'; \
      cp -a '$PREV' '$DEST_ROOT'; \
      chown -R caddy:caddy '$DEST_ROOT'; \
      systemctl reload caddy; \
      echo 'restored previous release; bad release parked at ${DEST_ROOT}.failed'"
    assert_config
    log "rollback complete. Investigate ${DEST_ROOT}.failed, then re-deploy a good build when ready."
    ;;
  list)
    log "snapshots present for $APP@$TARGET:"
    run_ssh "ls -ld --time-style=full-iso '$PREV' '$PREV1' '${DEST_ROOT}.failed' 2>/dev/null || echo 'none'"
    ;;
esac
