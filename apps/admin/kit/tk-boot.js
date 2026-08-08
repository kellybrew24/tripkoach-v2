/* ==========================================================================
 * TripKoach v2 admin — boot gate (TRI-861 Phase 1 shim, scaffold).
 *
 * The admin console gets the SAME config + API-client shim as web so it is
 * wired and ready, but this Phase 1 issue scopes live READ integration to the
 * consumer web app only. So admin's boot is a flag-aware pass-through: it mounts
 * from fixtures today and gives the admin read-path work (dashboard + list reads)
 * a drop-in seam — mirror web/kit/tk-boot.js's loadLiveData() here when that
 * lands, no app.jsx change required beyond the render entrypoint already in place.
 * ======================================================================== */
(function () {
  window.TK_BOOT = function (render) {
    // Admin live-read wiring is a follow-up; always render from the current
    // (fixture) globals for now. window.TK_CONFIG / window.TK_API are present
    // so the swap is purely additive when scheduled.
    render();
  };
})();
