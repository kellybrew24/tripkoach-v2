/* ==========================================================================
 * TripKoach v2 web — booking + Paystack checkout client (TRI-867 Phase 2 shim).
 *
 * `window.TK_BOOKING` — a dependency-free wrapper over the Phase-2 WRITE
 * contract (Backend sibling TRI-866), built on the same-origin transport from
 * tk-api.js (TRI-861). Loaded FIRST alongside the other shims but wired only
 * from the checkout/confirm screens, and every call site is gated behind
 * window.TK_CONFIG.USE_LIVE_API — so with the flag OFF this module is inert:
 * the built app makes no booking calls and no third-party (Paystack) requests
 * whatsoever, staying byte-for-byte the fixture prototype.
 *
 * Checkout strategy — REDIRECT to Paystack's hosted page (not inline). It is
 * the simpler of the two options the ticket allows, fits the DS confirm screen,
 * and needs ZERO third-party JavaScript: we never load js.paystack.co, so there
 * is nothing to self-host and nothing to leak when the flag is off. The flow:
 *   1. POST /bookings                       → create + seat hold, USD quote, ref
 *   2. POST /bookings/:ref/payment/init     → { authorization_url, reference }
 *   3. window.location = authorization_url  → Paystack hosts card/MoMo/bank
 *   4. Paystack redirects back (server callback_url → /confirm?ref=…&reference=…)
 *   5. POST /bookings/:ref/payment/verify + poll GET /bookings/:ref until paid
 *
 * Currency (board decision): prices are DISPLAYED and quoted in USD (source of
 * truth); the SERVER converts USD→GHS and charges GHS via Paystack. This client
 * never computes or hardcodes FX — it only ever reads the USD amounts the API
 * returns. (The DS header toggle's GHS figure is a pre-existing display-only
 * conversion, unrelated to what is charged.)
 *
 * Mapping is deliberately tolerant (snake_case or camelCase, minor-unit or
 * major-unit money, envelope or bare object) so integration with Backend stays
 * mechanical while the exact JSON firms up — same posture as tk-boot.js.
 * ======================================================================== */
(function () {
  var api = window.TK_API;

  // ---- helpers --------------------------------------------------------------
  function pick() {
    // First defined (not null/undefined) argument.
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return undefined;
  }
  // API money is integer minor units (USD cents, Phase 0 §3.1). Accept a major
  // number too, so a not-yet-final backend that returns whole dollars still works.
  function majorFromMinor(minor, major) {
    if (typeof minor === "number") return Math.round(minor) / 100;
    if (typeof major === "number") return major;
    return null;
  }

  // ---- response mappers -----------------------------------------------------
  // Normalise a booking (from create / get / verify) into one stable shape the
  // screens read, regardless of how Backend cased/nested its fields.
  function mapBooking(b) {
    if (!b || typeof b !== "object") return null;
    var body = b.booking && typeof b.booking === "object" ? b.booking : b;
    var dep = body.departure && typeof body.departure === "object" ? body.departure : {};
    return {
      ref: pick(body.ref, body.reference, body.bookingRef, body.booking_ref) || "",
      status: pick(body.status) || "",
      paymentState: pick(body.paymentState, body.payment_state, body.paymentStatus, body.payment_status) || "",
      currency: pick(body.currency) || "USD",
      unitUsd: majorFromMinor(pick(body.unitPriceMinor, body.unit_price_minor), pick(body.unitPriceUsd, body.unit_price_usd, body.unitPrice)),
      totalUsd: majorFromMinor(pick(body.totalMinor, body.total_minor), pick(body.totalUsd, body.total_usd, body.total)),
      partySize: pick(body.partySize, body.party_size, body.travellers && body.travellers.length),
      tourTitle: pick(body.tourTitle, body.tour_title, body.tour && (body.tour.title || body.tour), dep.tourTitle),
      departureLabel: pick(body.departureLabel, body.departure_label, dep.label, dep.date && dep.time ? dep.date + ", " + dep.time : dep.date),
      email: pick(body.email, body.leadEmail, body.lead_email, body.lead && body.lead.email),
      reservationExpiresAt: pick(body.reservationExpiresAt, body.reservation_expires_at),
      raw: body,
    };
  }

  function mapInit(r) {
    r = r || {};
    var body = r.data && typeof r.data === "object" ? r.data : r;
    return {
      authorizationUrl: pick(body.authorizationUrl, body.authorization_url),
      accessCode: pick(body.accessCode, body.access_code),
      reference: pick(body.reference, body.paymentRef, body.payment_ref),
      publicKey: pick(body.publicKey, body.public_key, r.publicKey, r.public_key),
      email: pick(body.email, r.email),
      raw: r,
    };
  }

  // ---- terminal-state predicates -------------------------------------------
  // Booking is confirmed/paid → success.
  function isPaid(bk) {
    if (!bk) return false;
    return bk.paymentState === "paid" || bk.status === "confirmed" || bk.status === "completed";
  }
  // Payment definitively won't complete (distinct from still-pending).
  function isFailed(bk) {
    if (!bk) return false;
    return bk.paymentState === "failed" || bk.status === "failed" || bk.status === "cancelled";
  }

  // ---- session context ------------------------------------------------------
  // A full-page redirect to Paystack tears down the SPA, so we stash just enough
  // human-readable context to render the confirm screen instantly on return,
  // BEFORE the verify/poll reconciles against the server. Keyed by booking ref.
  function ctxKey(ref) {
    return "tk.booking." + String(ref || "");
  }
  function saveCtx(ref, ctx) {
    try {
      window.sessionStorage.setItem(ctxKey(ref), JSON.stringify(ctx || {}));
      window.sessionStorage.setItem("tk.lastBookingRef", String(ref || ""));
    } catch (_) {}
  }
  function loadCtx(ref) {
    try {
      var raw = window.sessionStorage.getItem(ctxKey(ref));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }
  function lastRef() {
    try {
      return window.sessionStorage.getItem("tk.lastBookingRef") || "";
    } catch (_) {
      return "";
    }
  }

  function wait(ms) {
    return new Promise(function (res) {
      setTimeout(res, ms);
    });
  }

  window.TK_BOOKING = {
    isPaid: isPaid,
    isFailed: isFailed,
    saveCtx: saveCtx,
    loadCtx: loadCtx,
    lastRef: lastRef,

    // Create booking + seat hold; returns the normalised booking (carries ref + USD quote).
    create: function (payload) {
      return api.post("/bookings", payload).then(mapBooking);
    },

    // Initialize a Paystack transaction for a reserved booking.
    initPayment: function (ref, body) {
      return api.post("/bookings/" + encodeURIComponent(ref) + "/payment/init", body || {}).then(mapInit);
    },

    // Verify a returned Paystack transaction reference server-side.
    verify: function (ref, reference) {
      return api
        .post("/bookings/" + encodeURIComponent(ref) + "/payment/verify", { reference: reference })
        .then(mapBooking);
    },

    // Fetch current booking state.
    get: function (ref) {
      return api.get("/bookings/" + encodeURIComponent(ref)).then(mapBooking);
    },

    // Hand off to Paystack's hosted checkout (full-page redirect).
    redirect: function (init) {
      if (init && init.authorizationUrl) {
        window.location.assign(init.authorizationUrl);
        return true;
      }
      return false;
    },

    // Reconcile after the Paystack redirect: verify (if we have a txn reference),
    // then poll the booking until it reaches a terminal paid/failed state or we
    // give up. Resolves to the final normalised booking.
    settle: function (ref, reference, opts) {
      opts = opts || {};
      var tries = opts.tries || 6;
      var delay = opts.delay || 1500;
      var start = reference
        ? this.verify(ref, reference).catch(function () {
            return null;
          })
        : Promise.resolve(null);
      var self = this;
      return start.then(function (afterVerify) {
        if (isPaid(afterVerify) || isFailed(afterVerify)) return afterVerify;
        var attempt = function (n, lastSeen) {
          return self.get(ref).then(
            function (bk) {
              if (isPaid(bk) || isFailed(bk) || n <= 0) return bk;
              return wait(delay).then(function () {
                return attempt(n - 1, bk);
              });
            },
            function () {
              // Transient fetch error — keep whatever we last saw / verify result.
              return lastSeen || afterVerify;
            }
          );
        };
        return attempt(tries, afterVerify);
      });
    },
  };
})();
