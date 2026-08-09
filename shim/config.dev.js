/* ==========================================================================
 * TripKoach v2 — DEV runtime configuration (dev.tripkoach.com + admin.dev).
 *
 * Counterpart of shim/config.prod.js. The checked-in shim/config.js ships with
 * USE_LIVE_API OFF so a default build is byte-identical to the DS prototype;
 * the DEV static hosts must run against the live dev API, so their per-host
 * config.js sets USE_LIVE_API=true.
 *
 * This file is NOT copied into the build. It exists so scripts/deploy-static.sh
 * can SEED config.js on a *fresh* dev root (one that has never been deployed).
 * On an already-provisioned root the deploy NEVER touches config.js — it is
 * rsync-excluded — so this file is only the first-time default, and the live
 * host's config.js is the source of truth thereafter.
 *
 *   window.TK_CONFIG = {
 *     apiBase:      "/api/v1"  — same-origin API root (Caddy proxies /api/*).
 *     env:          "dev"      — informational.
 *     USE_LIVE_API: true       — read/booking/admin screens hydrate from live API.
 *   }
 * ======================================================================== */
window.TK_CONFIG = Object.assign(
  {
    apiBase: "/api/v1",
    env: "dev",
    USE_LIVE_API: true,
  },
  window.TK_CONFIG || {}
);
