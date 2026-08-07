/* ==========================================================================
 * TripKoach v2 — PRODUCTION runtime configuration (TRI-874 Phase 4 cutover).
 *
 * This is the prod counterpart of the checked-in shim/config.js (which ships
 * with USE_LIVE_API OFF so the default build is byte-identical to the DS
 * prototype). It is stamped into apps/{web,admin}/dist/config.js by
 * scripts/stamp-prod-config.mjs (`npm run build:prod`).
 *
 * HOST-AGNOSTIC BY DESIGN: `apiBase` is a SAME-ORIGIN RELATIVE PATH — no
 * hostname anywhere. Caddy on the prod host proxies `/api/*` verbatim to the
 * Fastify service (no prefix strip), so:
 *   - consumer web reads/writes hit  /api/v1/*   (apiBase)
 *   - admin writes/auth hit          /api/admin/* (derived from apiBase by
 *                                                  tk-boot: /api/v1 → /api/admin)
 * Because the base carries no host, the SAME dist deploys unchanged on
 * app.tripkoach.com, admin.tripkoach.com, or any final hostname the board
 * picks — a hostname change needs NO rebuild.
 *
 *   window.TK_CONFIG = {
 *     apiBase:      "/api/v1"  — same-origin API root (Phase 0 contract).
 *     env:          "prod"     — informational.
 *     USE_LIVE_API: true       — read/booking/admin screens hydrate from live API.
 *   }
 * ======================================================================== */
window.TK_CONFIG = Object.assign(
  {
    apiBase: "/api/v1",
    env: "prod",
    USE_LIVE_API: true,
  },
  window.TK_CONFIG || {}
);
