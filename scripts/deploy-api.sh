#!/usr/bin/env bash
# =============================================================================
# TripKoach v2 — GIT-PINNED API DEPLOY with drift guard + security smoke gate
# (TRI-1165, parent TRI-1160 H-1). Ties to TRI-1109 / TRI-1002 deploy-hardening.
#
# WHY THIS EXISTS
#   The API host (/opt/tripkoach-v2/apps/api/src) has been maintained by hand-
#   patching and wholesale rsync-from-working-tree. That let a feature deploy
#   ship a stale server.ts and SILENTLY revert a landed security control
#   (TRI-1160 H-1). This script replaces ad-hoc rsync/host edits with a deploy
#   from a PINNED GIT COMMIT and refuses to leave a deploy green if a security
#   control is missing.
#
#   Contract enforced by this script:
#     * Only COMMITTED content ships (git archive of a ref) — never the dirty
#       working tree, never a hand-edited host file.
#     * The working tree for apps/api must be clean at the ref (no uncommitted
#       drift leaking in) unless ALLOW_DIRTY=1.
#     * The deployed commit SHA is recorded on the host at DEPLOYED_REF so the
#       next deploy can DETECT host drift (someone hand-edited src since).
#     * A rollback snapshot of the current host src is tar'd before shipping.
#     * scripts/security-smoke.sh runs after restart and FAILS the deploy
#       (auto-rolling back the src + restart) if a control is missing.
#
# USAGE
#   scripts/deploy-api.sh <dev|prod> [git-ref]     # ref defaults to HEAD
#   DRY_RUN=1 scripts/deploy-api.sh dev <ref>       # print actions, ship nothing
#   FORCE=1   scripts/deploy-api.sh dev <ref>       # proceed despite host drift
#   ALLOW_DIRTY=1 ...                               # allow an unclean apps/api tree
#   SKIP_SMOKE=1 ...                                # skip the smoke gate (NOT for prod)
#
# ROLLBACK (manual, if you skipped the gate): the pre-deploy snapshot is at
#   /opt/tripkoach-v2/releases/api-src-<ts>.tgz on the host. Restore + restart.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENVN="${1:-}"
REF="${2:-HEAD}"
case "$ENVN" in
  dev)  SVC="tripkoach-api";      PORT=3020 ;;
  prod) SVC="tripkoach-api-prod"; PORT=3120 ;;
  *)    echo "usage: deploy-api.sh <dev|prod> [git-ref]" >&2; exit 2 ;;
esac
SSH_HOST="${SSH_HOST:-root@168.119.117.136}"
HOST_ROOT="${HOST_ROOT:-/opt/tripkoach-v2}"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"

log()  { echo "[deploy-api] $*"; }
die()  { echo "[deploy-api] ERROR: $*" >&2; exit 1; }
sshx() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" "$@"; }

# Paths shipped from the pinned ref. src is the deploy; package.json/migrations
# travel with it so a dep bump or a new migration file is never left behind.
PATHS=(apps/api/src apps/api/package.json apps/api/migrations)

# --- 1. Resolve + validate the ref -------------------------------------------
REF_SHA="$(git rev-parse --verify "${REF}^{commit}" 2>/dev/null)" || die "not a commit: $REF"
REF_SHORT="$(git rev-parse --short "$REF_SHA")"
log "env=$ENVN  svc=$SVC  host=$SSH_HOST"
log "pinned ref: $REF -> $REF_SHA"

# apps/api working tree must match the ref exactly (no uncommitted drift ships).
if [ "$ALLOW_DIRTY" != "1" ]; then
  if ! git diff --quiet "$REF_SHA" -- apps/api || ! git diff --cached --quiet "$REF_SHA" -- apps/api; then
    die "apps/api differs from $REF_SHORT (uncommitted drift). Commit it, deploy a clean ref, or set ALLOW_DIRTY=1."
  fi
  log "working tree clean vs $REF_SHORT for apps/api"
fi

# --- 2. Drift guard: has the host src been hand-edited since last deploy? -----
log "--- checking host for drift ---"
HOST_DRIFT="$(sshx "
  cd '$HOST_ROOT' 2>/dev/null || exit 3
  shadows=\$(find apps/api/src -maxdepth 1 -type f \( -name '*.bak' -o -name '*.pre-*' -o -name '*.orig' \) 2>/dev/null | wc -l)
  ref=\$(cat DEPLOYED_REF 2>/dev/null | head -1 | awk '{print \$1}')
  echo \"shadows=\$shadows ref=\${ref:-none}\"
")" || die "cannot reach host $SSH_HOST:$HOST_ROOT"
log "host state: $HOST_DRIFT"
shadow_count="$(echo "$HOST_DRIFT" | sed -n 's/.*shadows=\([0-9]*\).*/\1/p')"
if [ "${shadow_count:-0}" -gt 0 ] && [ "$FORCE" != "1" ]; then
  die "host has ${shadow_count} shadow (.bak/.pre-*) file(s) — reconcile/clean them first (TRI-1165 step 3), or FORCE=1 to override."
fi

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 — would ship [${PATHS[*]}] at $REF_SHORT, restart $SVC, then run security smoke. Exiting."
  exit 0
fi

# --- 3. Snapshot current host src (rollback artifact) ------------------------
TS="$(date -u +%Y%m%d_%H%M%S 2>/dev/null || echo manual)"
log "--- snapshotting current host src -> releases/api-src-$TS.tgz ---"
sshx "mkdir -p '$HOST_ROOT/releases' && cd '$HOST_ROOT' && tar czf 'releases/api-src-$TS.tgz' apps/api/src 2>/dev/null && echo snapshot_ok" \
  | grep -q snapshot_ok || die "snapshot failed — aborting before any change"

# --- 4. Ship the pinned tree (committed content only) ------------------------
log "--- shipping $REF_SHORT via git archive ---"
git archive --format=tar "$REF_SHA" "${PATHS[@]}" \
  | sshx "cd '$HOST_ROOT' && tar -xf - && echo extract_ok" \
  | grep -q extract_ok || die "ship/extract failed — host may be partially updated; restore releases/api-src-$TS.tgz"

# Record the deployed SHA so the NEXT deploy can detect hand-edits since.
sshx "cd '$HOST_ROOT' && printf '%s deployed_at=%s by=deploy-api.sh\n' '$REF_SHA' '$TS' > DEPLOYED_REF"
log "recorded DEPLOYED_REF=$REF_SHA on host"

# --- 5. Restart + health -----------------------------------------------------
log "--- restart $SVC ---"
sshx "systemctl restart '$SVC' && sleep 2 && curl -fsS localhost:$PORT/api/health" \
  | grep -q '"status":"ok"' || die "health check failed after restart — rollback: restore releases/api-src-$TS.tgz + restart $SVC"
log "health OK on :$PORT"

# --- 6. SECURITY SMOKE GATE --------------------------------------------------
if [ "$SKIP_SMOKE" = "1" ]; then
  [ "$ENVN" = "prod" ] && die "SKIP_SMOKE is not permitted for prod."
  log "SKIP_SMOKE=1 — skipping security smoke gate (dev only). NOT a clean deploy."
  log "=== done (ungated): $SVC @ $REF_SHORT ==="
  exit 0
fi
log "--- security smoke gate ---"
if "$REPO_ROOT/scripts/security-smoke.sh" "$ENVN"; then
  log "=== done: $SVC @ $REF_SHORT — security smoke PASSED ==="
  exit 0
fi

# Gate failed → auto-rollback to the snapshot and re-restart, then fail loud.
log "!!! security smoke FAILED — a control is missing at $REF_SHORT. Rolling back."
sshx "cd '$HOST_ROOT' && rm -rf apps/api/src && tar xzf 'releases/api-src-$TS.tgz' && systemctl restart '$SVC' && sleep 2 && curl -fsS localhost:$PORT/api/health >/dev/null && echo rollback_ok" \
  | grep -q rollback_ok && log "rolled back to pre-deploy snapshot ($TS)" || log "ROLLBACK ALSO FAILED — page on-call, restore releases/api-src-$TS.tgz by hand"
die "deploy REJECTED by security smoke gate — $REF_SHORT reverts a security control. Fix the ref, do not force."
