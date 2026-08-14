/* ==========================================================================
 * TripKoach v2 runtime configuration (TRI-861 Phase 1 shim).
 *
 * Loaded FIRST, before the data fixtures and the app bundle. Fits the kit's
 * existing window-global convention exactly (`window.TK_*`); no secrets here.
 *
 * This file is the DEFAULT, checked-in config and ships with USE_LIVE_API OFF
 * so the built apps behave EXACTLY like the fixture prototype out of the box.
 * DevOps overwrites this one file at deploy time (per host) to point at the
 * same-origin `/api` proxy and flip the flag on (see the Phase 0 wiring model,
 * config.js generated at deploy). No rebuild required to toggle.
 *
 *   window.TK_CONFIG = {
 *     apiBase:     string:   API root, same-origin. Phase 0 contract: "/api/v1".
 *     env:         string:   "dev" | "prod" (informational).
 *     USE_LIVE_API bool:     false → synchronous fixtures (unchanged prototype);
 *                            true  → read screens hydrate from the live API.
 *   }
 * ======================================================================== */
window.TK_CONFIG = Object.assign(
  {
    apiBase: "/api/v1",
    env: "dev",
    USE_LIVE_API: false,
  },
  window.TK_CONFIG || {}
);
