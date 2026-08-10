/* ==========================================================================
 * TripKoach v2 web — consumer accounts & auth client (TRI-882 P1 shim).
 *
 * `window.TK_AUTH` — a dependency-free wrapper over the P1 consumer auth
 * contract (Backend sibling TRI-881), built on the same-origin transport from
 * tk-api.js (TRI-861). Loaded FIRST alongside the other shims but wired only
 * from the auth/profile screens, and EVERY call site is gated behind
 * window.TK_CONFIG.USE_LIVE_API — so with the flag OFF this module is inert:
 * the built app makes no auth calls whatsoever and stays byte-for-byte the
 * fixture prototype (login just walks to the bookings screen, profile shows
 * the DS placeholder person, etc).
 *
 * Endpoints consumed (Phase-1 auth contract, same-origin under /api/v1):
 *   POST /auth/signup            → { user, linkedBookings }   (201; 409 dup email)
 *   POST /auth/login             → { user, linkedBookings }   (200; 401 bad creds)
 *   POST /auth/logout            → { ok }
 *   POST /auth/password-reset/request  → { ok }               (always 200)
 *   POST /auth/password-reset/consume  → { ok }               (400 invalid_token)
 *   GET  /me                     → { user }                   (401 if signed out)
 *   PATCH /me                    → { user }
 *   POST /me/password            → { ok }                     (401 wrong current)
 *   GET  /me/notifications       → { notifications: {email,whatsapp} }
 *   PUT  /me/notifications       → { notifications }
 *   GET  /me/bookings            → { bookings: [...] }
 *
 * Session is a server-side httpOnly cookie (tk_user_session) — the browser
 * carries it automatically via credentials:"include" (tk-api.js), so this
 * client holds NO token. It only caches the /me profile in memory to avoid
 * re-fetching it on every account sub-screen (AccountShell renders on each).
 *
 * Mapping is deliberately tolerant (accepts { user } envelope or a bare user,
 * snake_case or camelCase) so integration with Backend stays mechanical — same
 * posture as tk-boot.js / tk-booking.js.
 * ======================================================================== */
(function () {
  var api = window.TK_API;

  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return undefined;
  }

  // ---- mappers: API shape → a stable shape the screens read -----------------
  function mapUser(body) {
    if (!body || typeof body !== "object") return null;
    var u = body.user && typeof body.user === "object" ? body.user : body;
    if (!u || (u.email == null && u.id == null)) return null;
    return {
      id: pick(u.id),
      email: pick(u.email) || "",
      name: pick(u.name) || "",
      phone: pick(u.phone, u.phone_number) || "",
      country: pick(u.country) || "",
      photoUrl: pick(u.photoUrl, u.photo_url) || null,
      emergencyName: pick(u.emergencyName, u.emergency_name) || "",
      emergencyPhone: pick(u.emergencyPhone, u.emergency_phone) || "",
      dietaryNeeds: pick(u.dietaryNeeds, u.dietary_needs) || "",
      language: pick(u.language) || "en",
      displayCurrency: pick(u.displayCurrency, u.display_currency) || "USD",
      dataSaver: pick(u.dataSaver, u.data_saver) !== false,
      twoFactorEnabled: !!pick(u.twoFactorEnabled, u.two_factor_enabled),
      // TRI-941: soft email-verification signal (never gates checkout). Drives the badge + nudge.
      emailVerified: !!pick(u.emailVerified, u.email_verified),
      // TRI-943: avatar. avatarUrl is null when rejected/hidden — FE shows default placeholder.
      avatarUrl: pick(u.avatarUrl, u.avatar_url) || null,
      avatarStatus: pick(u.avatarStatus, u.avatar_status) || null,
      createdAt: pick(u.createdAt, u.created_at) || null,
      raw: u,
    };
  }

  function initials(name, email) {
    var s = String(name || "").trim();
    if (s) {
      return s.split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase();
    }
    var e = String(email || "").trim();
    return e ? e.slice(0, 2).toUpperCase() : "?";
  }

  function mapBooking(b) {
    b = b || {};
    var dep = b.departure && typeof b.departure === "object" ? b.departure : {};
    var tour = b.tour && typeof b.tour === "object" ? b.tour : {};
    var date = pick(dep.date, dep.date_label) || "";
    var time = pick(dep.time, dep.time_label) || "";
    return {
      ref: pick(b.ref, b.reference) || "",
      status: pick(b.status) || "",
      paymentState: pick(b.paymentState, b.payment_state) || "",
      total: pick(b.total, b.total_major),
      currency: pick(b.currency) || "USD",
      partySize: pick(b.partySize, b.party_size),
      tourSlug: pick(tour.slug, b.tourSlug) || "",
      tourTitle: pick(tour.title, b.tourTitle) || "",
      date: date,
      time: time,
      departureLabel: date + (time ? ", " + time : ""),
      // Review-invite state for this booking (TRI-1014). { state: 'none'|'open'|'submitted', token? }.
      // `open` carries the one-time review token so the Bookings CTA can submit the real review.
      review: (b.review && typeof b.review === "object")
        ? { state: pick(b.review.state) || "none", token: pick(b.review.token) || "" }
        : { state: "none", token: "" },
      raw: b,
    };
  }

  function listOf(body, key) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body[key])) return body[key];
    if (body && Array.isArray(body.items)) return body.items;
    return [];
  }

  // ---- in-memory profile cache (avoids re-GET /me per account sub-screen) ----
  var meCache; // undefined = unknown, null = signed out, {} = user
  var mePromise = null;

  function setMe(user) {
    meCache = user || null;
    return meCache;
  }

  window.TK_AUTH = {
    initials: initials,

    // Cached current user. force=true bypasses the cache (after a mutation).
    // Resolves to a user object, or null when signed out (401).
    me: function (force) {
      if (!force && meCache !== undefined) return Promise.resolve(meCache);
      if (!force && mePromise) return mePromise;
      mePromise = api.get("/me").then(
        function (body) { mePromise = null; return setMe(mapUser(body)); },
        function (err) {
          mePromise = null;
          if (err && err.status === 401) return setMe(null);
          throw err; // real transport/5xx error — let the caller show it
        }
      );
      return mePromise;
    },

    // Synchronous best-effort read of the cached user (or null/undefined).
    cachedMe: function () { return meCache; },

    signup: function (payload) {
      return api.post("/auth/signup", payload).then(function (body) {
        setMe(mapUser(body));
        return { user: meCache, linkedBookings: pick(body && body.linkedBookings, 0) || 0 };
      });
    },

    // Resolves { user, linkedBookings } on a completed login, OR { mfaRequired: true } when the account
    // has two-factor on (TRI-1029) — the caller then collects an authenticator code and calls loginMfa().
    // The server has already set an mfa_pending session cookie in that case.
    login: function (email, password) {
      return api.post("/auth/login", { email: email, password: password }).then(function (body) {
        if (body && body.mfaRequired) return { mfaRequired: true };
        setMe(mapUser(body));
        return { user: meCache, linkedBookings: pick(body && body.linkedBookings, 0) || 0 };
      });
    },

    // Complete a 2FA-gated login with the authenticator (or recovery) code. Resolves { user,… } on
    // success; rejects with err.status===401 for a wrong/expired code (retry) or no pending challenge.
    loginMfa: function (code) {
      return api.post("/auth/mfa", { code: String(code || "").trim() }).then(function (body) {
        setMe(mapUser(body));
        return { user: meCache, linkedBookings: pick(body && body.linkedBookings, 0) || 0 };
      });
    },

    logout: function () {
      return api.post("/auth/logout", {}).then(
        function () { setMe(null); return true; },
        function () { setMe(null); return false; } // clear locally even if the call fails
      );
    },

    requestReset: function (email) {
      // Always resolves (backend returns 200 for any email — no user enumeration).
      return api.post("/auth/password-reset/request", { email: email }).then(
        function () { return true; },
        function () { return true; }
      );
    },

    consumeReset: function (token, password) {
      return api.post("/auth/password-reset/consume", { token: token, password: password });
    },

    // ── Email verification (TRI-941) ──
    // Consume the emailed token on the /verify-email landing page. Resolves { ok, status } on success
    // ('verified' | 'already_verified'); rejects with err.status===400 for an invalid/expired/used link.
    verifyEmail: function (token) {
      return api.post("/auth/verify-email", { token: token }).then(function (body) {
        // On success the account is now verified — refresh the cached /me so badges update immediately.
        if (meCache) meCache.emailVerified = true;
        return body || { ok: true };
      });
    },

    // Resend the verification email. Authed callers omit email (server uses the session); logged-out
    // callers pass their email. Always resolves (server returns 200 for any input — no enumeration).
    resendVerification: function (email) {
      return api.post("/auth/resend-verification", email ? { email: email } : {}).then(
        function (body) { return body || { ok: true }; },
        function () { return { ok: true }; }
      );
    },

    updateProfile: function (patch) {
      return api.patch("/me", patch).then(function (body) { return setMe(mapUser(body)); });
    },

    changePassword: function (currentPassword, newPassword) {
      return api.post("/me/password", { currentPassword: currentPassword, newPassword: newPassword });
    },

    // ── Two-factor (TOTP) self-service (TRI-1029) ──
    // Status of the current account's 2FA. Resolves { enabled }.
    mfaStatus: function () {
      return api.get("/auth/mfa/status").then(function (body) { return { enabled: !!(body && body.enabled) }; });
    },
    // Begin enrollment. Resolves { secret, otpauthUri, issuer } — the FE renders the QR from otpauthUri
    // entirely client-side (the secret NEVER goes to a third-party image service).
    mfaEnroll: function () {
      return api.post("/auth/mfa/enroll", {}).then(function (body) {
        body = body || {};
        return { secret: body.secret || "", otpauthUri: body.otpauthUri || "", issuer: body.issuer || "TripKoach" };
      });
    },
    // Confirm enrollment with the first authenticator code. Resolves { enabled, recoveryCodes:[…] }.
    // Rejects with err.status===400 (field "code") on a wrong code.
    mfaVerify: function (code) {
      return api.post("/auth/mfa/verify", { code: String(code || "").trim() }).then(function (body) {
        body = body || {};
        if (meCache) meCache.twoFactorEnabled = true;
        return { enabled: !!body.enabled, recoveryCodes: Array.isArray(body.recoveryCodes) ? body.recoveryCodes : [] };
      });
    },
    // Turn 2FA off. Requires a current authenticator or recovery code. Resolves { enabled:false }.
    mfaDisable: function (code) {
      return api.post("/auth/mfa/disable", { code: String(code || "").trim() }).then(function (body) {
        if (meCache) meCache.twoFactorEnabled = false;
        return { enabled: !!(body && body.enabled) };
      });
    },
    // Regenerate the one-time recovery codes (invalidates the old set). Resolves { recoveryCodes:[…] }.
    mfaRecoveryCodes: function () {
      return api.post("/auth/mfa/recovery-codes", {}).then(function (body) {
        return { recoveryCodes: (body && Array.isArray(body.recoveryCodes)) ? body.recoveryCodes : [] };
      });
    },

    // TRI-1012: permanently delete + anonymize my account. On success the server has scrubbed the
    // PII, revoked every session and cleared the cookie — so we drop the cached /me locally too and
    // the caller redirects to login. Rejects with err.status===409 (code "active_bookings") when the
    // account still has upcoming trips to cancel; the screen surfaces that message.
    deleteAccount: function () {
      return api.del("/me").then(function (body) {
        setMe(null);
        return body || { ok: true };
      });
    },

    getNotifications: function () {
      return api.get("/me/notifications").then(function (body) {
        return (body && body.notifications) || body || {};
      });
    },

    // patch: { email:{type:bool,…}, whatsapp:{…} } — partial upsert.
    updateNotifications: function (patch) {
      return api.put("/me/notifications", patch).then(function (body) {
        return (body && body.notifications) || body || {};
      });
    },

    myBookings: function () {
      return api.get("/me/bookings").then(function (body) {
        return listOf(body, "bookings").map(mapBooking);
      });
    },

    // TRI-1016: the account "Reviews" page. Resolves { reviews, invites } —
    // `reviews` are this account's own submissions (with moderation status),
    // `invites` are pending review-invite tokens ("Awaiting your review") that
    // the "Write your review" CTA submits against via TK_REVIEWS_API.submit.
    myReviews: function () {
      return api.get("/me/reviews").then(function (body) {
        body = body || {};
        return {
          reviews: Array.isArray(body.reviews) ? body.reviews : [],
          invites: Array.isArray(body.invites) ? body.invites : [],
        };
      });
    },

    // TRI-943: upload avatar. `file` is a File/Blob. Resolves { avatarUrl, avatarStatus }.
    // The raw bytes are POSTed with the image's content-type; filename is sent via X-Filename.
    uploadAvatar: function (file) {
      var base = (window.TK_CONFIG && window.TK_CONFIG.API_BASE) || "/api/v1";
      var url = base.replace(/\/$/, "") + "/me/avatar";
      var filename = (file && file.name) || "avatar";
      return fetch(url, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": filename },
        body: file,
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) {
            // Match the tk-api.js error shape: the friendly copy lives at body.error.message
            // ({ error: { code, message, field } }); fall back to a bare message then a status line.
            var apiErr = (body && body.error) || {};
            var e = new Error(apiErr.message || (body && body.message) || ("Upload failed: " + r.status));
            e.status = r.status; e.code = apiErr.code; throw e;
          }
          // Refresh cached /me so the avatar shows everywhere.
          if (meCache) { meCache.avatarUrl = body.avatarUrl || null; meCache.avatarStatus = body.avatarStatus || null; }
          return { avatarUrl: body.avatarUrl || null, avatarStatus: body.avatarStatus || null };
        });
      });
    },

    // TRI-943: remove avatar (revert to default placeholder).
    deleteAvatar: function () {
      return api.del ? api.del("/me/avatar") : fetch(
        ((window.TK_CONFIG && window.TK_CONFIG.API_BASE) || "/api/v1").replace(/\/$/, "") + "/me/avatar",
        { method: "DELETE", credentials: "include" }
      ).then(function (r) { return r.json(); }).then(function () {
        if (meCache) { meCache.avatarUrl = null; meCache.avatarStatus = null; }
        return { avatarUrl: null, avatarStatus: null };
      });
    },
  };
})();
