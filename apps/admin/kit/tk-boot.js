/* ==========================================================================
 * TripKoach v2 admin — auth gate + write-path API shim (TRI-870 Phase 3).
 *
 * Same pattern as the consumer app (TRI-861): the DS-verbatim admin screens
 * read their data SYNCHRONOUSLY from window-globals (window.TK_ADMIN.*,
 * window.TK_DATA.tours/regions, window.TK_REVIEWS) which the fixtures
 * (data.js + admin-data.js) populate today. This file replaces that static
 * seam with a runtime one WITHOUT redesigning any screen:
 *
 *   USE_LIVE_API === false  → render immediately from fixtures. Byte-for-byte
 *                             the prototype (the whole live path is guarded).
 *   USE_LIVE_API === true   → check the staff session, hydrate the same globals
 *                             from the admin API, gate to /login on 401, then
 *                             mount. Screen mutations (create/save/cancel/…)
 *                             route through window.TK_ADMIN_ACT, which calls the
 *                             guarded write endpoints and surfaces 401/403/
 *                             validation errors in the DS UI.
 *
 * Admin realm (Phase 3 backend, TRI-869): every route is mounted under
 * `/api/admin` and Caddy proxies `/api/*` verbatim to the Fastify service, so
 * the httpOnly session cookie is same-origin. The shared config.js ships
 * apiBase="/api/v1" for the consumer read paths; we derive the admin base from
 * it (…/v1 → …/admin) so DevOps only overwrites the one shared config.js at
 * deploy. An explicit TK_CONFIG.adminApiBase always wins.
 *
 * Mapping is deliberately tolerant (accepts snake_case or camelCase, integer
 * minor units or whole-currency numbers, `{items:[…]}`/`{tours:[…]}`/bare-array
 * envelopes) so integration stays mechanical as the exact DTOs firm up with
 * Backend — mirrors web/kit/tk-boot.js.
 * ======================================================================== */
(function () {
  var TkApiError = (window.TK_API && window.TK_API.TkApiError) || function (s, c, m) {
    var e = new Error(m || c || ("HTTP " + s)); e.status = s; e.code = c || null; e.isTkApiError = true; return e;
  };

  function cfg() { return window.TK_CONFIG || {}; }
  function adminBase() {
    var c = cfg();
    if (c.adminApiBase) return String(c.adminApiBase).replace(/\/+$/, "");
    var b = String(c.apiBase || "/api/v1").replace(/\/+$/, "");
    if (/\/admin$/.test(b)) return b;          // already an admin base
    if (/\/v1$/.test(b)) return b.replace(/\/v1$/, "/admin"); // /api/v1 → /api/admin
    return b + "/admin";                        // /api → /api/admin
  }
  function live() { return !!cfg().USE_LIVE_API; }

  // ---- transport (admin base, same-origin cookie) ---------------------------
  function req(method, path, body, opts) {
    opts = opts || {};
    var url = adminBase() + (path.charAt(0) === "/" ? path : "/" + path);
    if (opts.query) {
      var qs = Object.keys(opts.query)
        .filter(function (k) { var v = opts.query[k]; return v !== undefined && v !== null && v !== ""; })
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(opts.query[k]); })
        .join("&");
      if (qs) url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
    }
    var init = { method: method, credentials: "include", headers: { Accept: "application/json" } };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = typeof body === "string" ? body : JSON.stringify(body); }
    return fetch(url, init).then(function (res) {
      var ct = res.headers && res.headers.get && res.headers.get("content-type");
      var isJson = ct && ct.indexOf("application/json") !== -1;
      return (isJson ? res.json() : res.text()).then(function (payload) {
        if (res.ok) return payload;
        var err = isJson && payload && payload.error ? payload.error : {};
        throw TkApiError(res.status, err.code, err.message || ("HTTP " + res.status), err.fields);
      }, function () {
        if (res.ok) return null;
        throw TkApiError(res.status, null, "HTTP " + res.status);
      });
    });
  }

  // ---- helpers --------------------------------------------------------------
  function list(body, key) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body[key])) return body[key];
    if (body && Array.isArray(body.items)) return body.items;
    return [];
  }
  function major(v, minorField) {
    if (typeof minorField === "number") return Math.round(minorField) / 100;
    return typeof v === "number" ? v : (v != null && !isNaN(+v) ? +v : 0);
  }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(v) {
    if (!v) return "";
    if (typeof v === "string" && !/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function pick() { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]; return undefined; }
  // Money that stays NULL when genuinely absent (vs major()'s 0). `maj` is already in whole units; the two
  // minor candidates are cents. Used for optional FX figures so callers can distinguish "missing" from "0".
  function moneyOrNull(maj, minorA, minorB) {
    if (maj != null && !isNaN(+maj)) return +maj;
    var m = pick(minorA, minorB);
    return m != null && !isNaN(+m) ? Math.round(+m) / 100 : null;
  }

  // ---- mappers: admin API → kit fixture shape -------------------------------
  function mapTier(t) { return { minPax: pick(t.minPax, t.min_pax), price: major(t.price, pick(t.priceMinor, t.price_minor)) }; }
  function mapTour(t) {
    var price = major(pick(t.price, t.priceMajor, t.fromPrice), pick(t.basePriceMinor, t.base_price_minor, t.priceMinor, t.price_minor));
    var out = {
      id: t.slug || t.id,
      _apiId: pick(t.id, t.slug),
      slug: t.slug || t.id,
      title: t.title || "",
      region: t.region || t.regionName || (t.region && t.region.name) || "",
      category: t.category || "",
      duration: t.duration || "",
      price: price,
      currency: t.currency || "USD",
      rating: pick(t.rating, t.ratingCached, t.rating_cached),
      reviews: pick(t.reviews, t.reviewCount, t.review_count_cached),
      image: t.image || (Array.isArray(t.images) && t.images[0]) || null,
      blurb: t.blurb || t.overview || "",
      published: t.published !== undefined ? !!t.published : (t.status ? t.status === "published" || t.status === "live" : undefined),
    };
    if (Array.isArray(t.tiers) && t.tiers.length) out.tiers = t.tiers.map(mapTier).filter(function (x) { return typeof x.minPax === "number"; });
    if (Array.isArray(t.highlights)) out.highlights = t.highlights;
    if (Array.isArray(t.included)) out.included = t.included;
    if (Array.isArray(t.excluded)) out.excluded = t.excluded;
    // TRI-928: carry the ordered gallery (detail endpoint returns images[]; the
    // list projection returns only the cover). Editor seeds the MediaManager from this.
    out.images = (Array.isArray(t.images) && t.images.length) ? t.images.slice() : (out.image ? [out.image] : []);
    if (Array.isArray(t.departures)) out.departures = t.departures.map(mapDeparture);
    else if (typeof t.departures === "number") out.departures = t.departures; // TRI-998: list projection ships a count
    // TRI-998: bookable (upcoming) departures count from the list projection, so the
    // tours table can warn on a PUBLISHED tour that has 0 upcoming departures.
    if (t.upcomingDepartures != null) out.upcomingDepartures = Number(t.upcomingDepartures);
    return out;
  }
  function mapDeparture(d) {
    return {
      id: pick(d.id, d.departureId),
      tourId: d.tourId || d.tourSlug || d.tour_id,
      date: fmtDate(pick(d.date, d.departsOn, d.departs_on)),
      time: d.time || "",
      price: major(d.price, pick(d.priceMinor, d.price_minor)),
      spotsLeft: pick(d.spotsLeft, d.spots_left, d.seatsAvailable),
    };
  }
  // Full admin departure row (capacity/booked/status) for DeparturesAdmin.
  function mapDepartureRow(d, tourById) {
    var tourId = d.tourId || d.tourSlug || d.tour_id;
    var t = (tourById && tourById[tourId]) || {};
    var cap = pick(d.capacity, d.seatsTotal, d.seats_total, 0);
    var spots = pick(d.spotsLeft, d.spots_left, (typeof cap === "number" && d.seatsReserved != null ? cap - d.seatsReserved : undefined), 0);
    return {
      id: pick(d.id, tourId + "-" + pick(d.departureId, "")),
      tourId: tourId, tour: d.tour || t.title || tourId, region: d.region || t.region || "",
      date: fmtDate(pick(d.date, d.departsOn, d.departs_on)), time: d.time || "",
      price: major(d.price, pick(d.priceMinor, d.price_minor)), currency: d.currency || "USD",
      capacity: cap, booked: pick(d.booked, (typeof cap === "number" ? cap - spots : undefined), 0), spotsLeft: spots,
      status: d.status || (spots <= 0 ? "sold-out" : "scheduled"),
    };
  }
  function mapBooking(b, tourById) {
    var tourId = pick(b.tourId, b.tourSlug, b.tour_id);
    var t = (tourById && tourById[tourId]) || {};
    var travellers = pick(b.travellers, b.pax, b.partySize, b.party_size, 1);
    var usd = major(pick(b.usdAmount, b.totalUsd, b.total), pick(b.usdAmountMinor, b.usd_amount_minor, b.totalMinor, b.total_minor));
    var unit = major(pick(b.unit, b.unitPrice, t.price), pick(b.unitMinor, b.unit_minor));
    return {
      ref: pick(b.ref, b.reference, b.code, b.id),
      customerId: pick(b.customerId, b.customer_id),
      customer: pick(b.customer, b.customerName, b.customer_name, (b.customer && b.customer.name)),
      customerEmail: pick(b.customerEmail, b.customer_email, (b.customer && b.customer.email)),
      tourId: tourId, tour: b.tour || t.title || tourId, region: b.region || t.region || "",
      departureId: pick(b.departureId, b.departure_id),
      date: fmtDate(pick(b.date, b.departureDate, b.departure_date)),
      travellers: travellers,
      unit: unit || (usd && travellers ? Math.round(usd / travellers) : 0),
      total: usd || (unit * travellers) || 0,
      currency: b.currency || "USD",
      // Phase 2 FX columns carried through for the payment/reconciliation views.
      usd: usd, ghs: major(pick(b.ghsAmount, b.ghs_amount), pick(b.ghsAmountMinor, b.ghs_amount_minor)),
      fx: pick(b.fxRateUsed, b.fx_rate_used, b.fxRate),
      status: b.status || "pending",
      payment: pick(b.payment, b.paymentStatus, b.payment_status, "unpaid"),
      created: fmtDate(pick(b.created, b.createdAt, b.created_at)),
    };
  }
  function mapPayment(p) {
    return {
      id: pick(p.id, p.ref, p.reference),
      ref: pick(p.bookingRef, p.booking_ref, p.ref),
      customer: pick(p.customer, p.customerName, p.customer_name),
      // `amount` is the figure IN THE ROW'S CURRENCY (GHS for a Paystack charge — the real money moved);
      // never mislabel it. TRI-1033: `usd`/`ghs` must stay NULL when the row carries no real figure so the
      // screen can tell "no USD-of-record" (legacy/refund rows) apart from "$0" and avoid printing a GHS
      // number under a $ sign. Only the true USD-of-record / GHS-charge sources feed them (no amount fallback).
      amount: major(pick(p.amount, p.total), pick(p.amountMinor, p.amount_minor)),
      currency: p.currency || "USD",
      usd: moneyOrNull(p.usdAmount, p.usdAmountMinor, p.usd_amount_minor),
      ghs: moneyOrNull(p.ghsAmount, p.ghsAmountMinor, p.ghs_amount_minor),
      fx: pick(p.fxRateUsed, p.fx_rate_used),
      method: p.method || (p.provider ? p.provider + (p.channel ? " · " + p.channel : "") : "Paystack"),
      status: p.status || "paid",
      refundFlagged: !!pick(p.refundFlagged, p.refund_flagged),
      date: fmtDate(pick(p.date, p.createdAt, p.created_at)),
    };
  }
  function mapPromo(p) {
    return {
      code: p.code, type: p.type || (p.percent != null ? "percent" : "fixed"),
      value: pick(p.value, p.percent, p.amount, 0), currency: p.currency || "USD",
      used: pick(p.used, p.usedCount, p.used_count, 0), limit: pick(p.limit, p.usageLimit, p.usage_limit, 0),
      from: fmtDate(pick(p.from, p.startsAt, p.starts_at)), to: fmtDate(pick(p.to, p.endsAt, p.ends_at)),
      tours: p.tours || p.scope || "All tours", active: p.active !== undefined ? !!p.active : true,
    };
  }
  function initials(name) { return String(name || "").split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase(); }
  function mapStaff(u) {
    return {
      id: pick(u.id, u.staffId), name: u.name || "", email: u.email || "",
      role: u.role || "viewer", status: u.status || "active", initials: u.initials || initials(u.name),
      jobTitle: pick(u.jobTitle, u.job_title) || "",
      last: pick(u.last, u.lastActive, u.last_active_at, "—"),
    };
  }
  function mapCustomer(c) {
    return {
      id: pick(c.id, c.customerId), name: c.name || "", email: c.email || "", phone: c.phone || "",
      country: c.country || "", joined: fmtDate(pick(c.joined, c.createdAt, c.created_at)),
      bookings: pick(c.bookings, c.bookingCount, 0), initials: c.initials || initials(c.name),
      emergencyName: c.emergencyName || "", emergencyPhone: c.emergencyPhone || "",
      diet: pick(c.dietaryNeeds, c.diet) || "—",
      language: c.language || "", displayCurrency: c.displayCurrency || "",
      twoFactorEnabled: c.twoFactorEnabled === undefined ? null : c.twoFactorEnabled,
      // TRI-941: account/verification state (guests have no account → hasAccount=false, emailVerified=null).
      hasAccount: pick(c.hasAccount, c.userId != null, c.user_id != null) === true,
      emailVerified: c.emailVerified === undefined ? null : c.emailVerified,
    };
  }
  function mapGuide(g) {
    return {
      id: pick(g.id, g.guideId), name: g.name || "", initials: g.initials || initials(g.name),
      email: g.email || "", phone: g.phone || "", base: g.base || "",
      regions: g.regions || [], languages: g.languages || [], status: g.status || "active",
      rating: pick(g.rating, 0), trips: pick(g.trips, 0), bio: g.bio || "",
    };
  }
  function mapReview(r) {
    var author = r.author || r.name || "Traveller";
    return {
      id: r.id, tourId: pick(r.tourId, r.tourSlug, r.tour_id), tour: r.tour || "",
      author: author, initials: r.initials || initials(author), rating: r.rating,
      date: fmtDate(pick(r.date, r.createdAt, r.created_at)),
      verified: r.verified !== undefined ? !!r.verified : true,
      status: r.status || "approved", title: r.title || "", text: r.text || r.body || "", reply: r.reply || "",
    };
  }
  // Blog / CMS (TRI-917). The admin list DTO already matches the kit shape; this
  // stays tolerant of snake_case / camelCase so integration is mechanical.
  function mapBlogPost(p) {
    return {
      id: pick(p.id, p.slug), slug: p.slug || p.id, tag: p.tag || null,
      status: p.status || (p.published ? "published" : "draft"),
      published: p.published !== undefined ? !!p.published : p.status === "published",
      readTime: pick(p.readTime, p.read_time),
      date: p.date != null ? (typeof p.date === "string" ? p.date : fmtDate(p.date)) : fmtDate(pick(p.publishedAt, p.published_at)),
      title: p.title || "", excerpt: p.excerpt || "", hero: pick(p.hero, p.heroUrl, p.hero_url) || null,
      heroAlt: pick(p.heroAlt, p.hero_alt) || "", author: p.author || "",
      body: p.body, bodyText: p.bodyText,
      updated: p.updated != null ? p.updated : fmtDate(pick(p.updatedAt, p.updated_at)),
    };
  }

  // ---- write serialisers: kit form values → API body ------------------------
  // USD is the currency of record. Prices go out as whole-currency numbers with
  // an explicit currency, mirroring the read contract (Backend converts to GHS
  // pesewas at charge time — the FE never computes FX).
  function tourBody(v) {
    var b = { title: v.title, region: v.region, category: v.category, duration: v.duration,
      blurb: v.blurb, currency: v.currency || "USD", published: !!v.published };
    if (Array.isArray(v.highlights)) b.highlights = v.highlights;
    if (Array.isArray(v.included)) b.included = v.included;
    if (Array.isArray(v.excluded)) b.excluded = v.excluded;
    if (Array.isArray(v.tiers)) b.tiers = v.tiers;
    if (Array.isArray(v.packages)) b.packages = v.packages;   // TRI-989 per-tour tracks (route variants)
    if (v.defaultPackage != null) b.defaultPackage = v.defaultPackage; // TRI-989 which track is preselected
    if (Array.isArray(v.images)) b.images = v.images;   // TRI-928 gallery (ordered, cover first)
    if (v.image != null) b.image = v.image;             // TRI-928 cover image
    if (v.price != null && v.price !== "") b.price = +v.price;
    return b;
  }

  // TRI-928: upload raw image bytes to POST /api/admin/media (TRI-918) and resolve
  // the canonical cdn.tripkoach.com URL. The endpoint buffers the RAW request body
  // keyed by Content-Type (no multipart); unknown types are sent as octet-stream so
  // the server still validates by magic bytes. XHR (not fetch) gives upload %.
  function uploadMedia(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var name = (file && file.name) || "upload";
      var ct = (file && file.type) || "";
      var OK = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (OK.indexOf(ct) === -1) ct = "application/octet-stream";
      var xhr = new XMLHttpRequest();
      xhr.open("POST", adminBase() + "/media?filename=" + encodeURIComponent(name), true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Accept", "application/json");
      xhr.setRequestHeader("Content-Type", ct);
      if (xhr.upload && onProgress) xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = function () {
        var p = null; try { p = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300 && p && p.asset && p.asset.url) { resolve(p.asset.url); return; }
        var err = (p && p.error) || {};
        reject(TkApiError(xhr.status || 0, err.code || null, err.message || ("Upload failed (HTTP " + xhr.status + ")")));
      };
      xhr.onerror = function () { reject(TkApiError(0, "network", "Upload failed — network error")); };
      xhr.send(file);
    });
  }

  // ---- the write API screens call ------------------------------------------
  var API = {
    live: live,
    base: adminBase,
    // auth
    login: function (email, password, opts) { return req("POST", "/auth/login", Object.assign({ email: email, password: password }, opts || {})); },
    verifyMfa: function (code) { return req("POST", "/auth/mfa", { code: code }); }, // login challenge (TOTP or recovery code)
    logout: function () { return req("POST", "/auth/logout"); },
    me: function () { return req("GET", "/me"); },
    patchMe: function (body) { return req("PATCH", "/me", body); },
    // per-staff preferences (TRI-1009)
    getMyPreferences: function () { return req("GET", "/me/preferences"); },
    saveMyPreferences: function (body) { return req("PATCH", "/me/preferences", body || {}); },
    // self-service MFA management (TRI-899 → TRI-895 /auth/mfa/*)
    mfaStatus: function () { return req("GET", "/auth/mfa/status"); },
    mfaEnroll: function () { return req("POST", "/auth/mfa/enroll"); },
    mfaVerifyEnroll: function (code) { return req("POST", "/auth/mfa/verify", { code: code }); },
    mfaDisable: function (code) { return req("POST", "/auth/mfa/disable", { code: code }); },
    mfaRegenerateCodes: function () { return req("POST", "/auth/mfa/recovery-codes"); },
    // password — change (authed self-service) + forgot/reset (public) (TRI-1000)
    changePassword: function (currentPassword, newPassword) { return req("POST", "/me/password", { currentPassword: currentPassword, newPassword: newPassword }); },
    requestPasswordReset: function (email) { return req("POST", "/auth/password-reset/request", { email: email }); },
    consumePasswordReset: function (token, password) { return req("POST", "/auth/password-reset/consume", { token: token, password: password }); },
    // staff invite accept (public — the opaque token IS the credential) (TRI-1032)
    previewInvite: function (token) { return req("GET", "/staff/accept", undefined, { query: { token: token } }); },
    acceptInvite: function (token, password) { return req("POST", "/staff/accept", { token: token, password: password }); },
    // catalogue
    listTours: function () { return req("GET", "/tours"); },
    getTour: function (id) { return req("GET", "/tours/" + encodeURIComponent(id)); },
    createTour: function (v) { return req("POST", "/tours", tourBody(v)); },
    updateTour: function (id, v) { return req("PATCH", "/tours/" + encodeURIComponent(id), tourBody(v)); },
    saveTour: function (v) { return v.id && v.id !== "new" ? API.updateTour(v.id, v) : API.createTour(v); },
    setPublished: function (id, pub) { return req("PATCH", "/tours/" + encodeURIComponent(id), { published: !!pub }); },
    deleteTour: function (id) { return req("DELETE", "/tours/" + encodeURIComponent(id)); },
    uploadMedia: uploadMedia, // TRI-928: File → cdn.tripkoach.com URL
    // regions
    listRegions: function () { return req("GET", "/regions"); },
    createRegion: function (name) { return req("POST", "/regions", { name: name }); },
    // departures / schedules
    listDepartures: function () { return req("GET", "/departures"); },
    createDeparture: function (v) { return req("POST", "/departures", v); },
    // TRI-974: patch a departure (capacity/price/time/status/guide/notes). Server rejects
    // capacity below already-reserved seats with a 409 (no oversell / no negative availability).
    updateDeparture: function (id, patch) { return req("PATCH", "/departures/" + encodeURIComponent(id), patch || {}); },
    cancelDeparture: function (id, reason) { return req("POST", "/departures/" + encodeURIComponent(id) + "/cancel", { reason: reason }); },
    // TRI-1004: end a departure server-side (status → completed) and issue per-booking review
    // invites (idempotent; sends the review_invite email). Returns { departureStatus, eligible, issued[], skipped[] }.
    requestReviews: function (id) { return req("POST", "/departures/" + encodeURIComponent(id) + "/request-reviews", {}); },
    // bookings
    listBookings: function () { return req("GET", "/bookings"); },
    getBooking: function (ref) { return req("GET", "/bookings/" + encodeURIComponent(ref)); },
    confirmBooking: function (ref) { return req("POST", "/bookings/" + encodeURIComponent(ref) + "/confirm"); },
    cancelBooking: function (ref, reason) { return req("POST", "/bookings/" + encodeURIComponent(ref) + "/cancel", { reason: reason }); },
    // TRI-970: move a booking to another departure of the same tour (availability-checked server-side).
    rescheduleBooking: function (ref, targetDepartureId, opts) { return req("POST", "/bookings/" + encodeURIComponent(ref) + "/reschedule", Object.assign({ targetDepartureId: targetDepartureId }, opts || {})); },
    // TRI-1007: re-send the booking confirmation email. Resolves { ref, outcome, to } where outcome is
    // 'sent' | 'skipped' (transport off) | 'failed' | 'no_recipient'; 409 for cancelled/failed bookings.
    resendBookingConfirmation: function (ref) { return req("POST", "/bookings/" + encodeURIComponent(ref) + "/resend"); },
    // TRI-1007: Customers row-menu — re-send the confirmation for a customer's most recent booking.
    resendCustomerLastConfirmation: function (id) { return req("POST", "/customers/" + encodeURIComponent(id) + "/resend-confirmation"); },
    // payments
    listPayments: function () { return req("GET", "/payments"); },
    // TRI-897: real Paystack refund (was a flag-only stub that hit a non-existent
    // /refund-flag route). Optional body carries { amount, reason }; omit amount
    // for a full refund of the original charge.
    refundPayment: function (id, body) { return req("POST", "/payments/" + encodeURIComponent(id) + "/refund", body || {}); },
    markPaid: function (id) { return req("POST", "/payments/" + encodeURIComponent(id) + "/mark-paid"); },
    // TRI-1006: reconciliation export. GET /reports/reconciliation.csv is a real, cookie-authed
    // (perm payments.refund) endpoint that streams a finance-grade CSV (payments + refunds, FX
    // columns) with a Content-Disposition filename. Fetch it as a Blob so the browser download
    // carries the admin session cookie; resolves { blob, filename }.
    reconciliationCsv: function (params) {
      var url = adminBase() + "/reports/reconciliation.csv";
      if (params) {
        var qs = Object.keys(params)
          .filter(function (k) { var v = params[k]; return v !== undefined && v !== null && v !== ""; })
          .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
          .join("&");
        if (qs) url += "?" + qs;
      }
      return fetch(url, { method: "GET", credentials: "include", headers: { Accept: "text/csv" } }).then(function (res) {
        if (!res.ok) throw TkApiError(res.status, null, "HTTP " + res.status);
        var cd = res.headers && res.headers.get && res.headers.get("content-disposition");
        var m = cd && /filename="?([^"]+)"?/.exec(cd);
        var filename = (m && m[1]) || "reconciliation.csv";
        return res.blob().then(function (blob) { return { blob: blob, filename: filename }; });
      });
    },
    // promos / settings / staff
    listPromos: function () { return req("GET", "/promos"); },
    savePromo: function (v) { return v && v.id ? req("PATCH", "/promos/" + encodeURIComponent(v.id), v) : req("POST", "/promos", v); },
    getSettings: function () { return req("GET", "/settings"); },
    saveSettings: function (v) { return req("PATCH", "/settings", v || {}); },
    listStaff: function () { return req("GET", "/staff"); },
    inviteStaff: function (v) { return req("POST", "/staff", v); },
    // TRI-996: staff row actions — update role/name/job-title, resend invite, disable/enable.
    // All guarded server-side by perm('users.manage'); the last-active-admin guard returns 409.
    updateStaff: function (id, v) { return req("PATCH", "/staff/" + encodeURIComponent(id), v || {}); },
    resendStaffInvite: function (id) { return req("POST", "/staff/" + encodeURIComponent(id) + "/resend-invite"); },
    revokeStaffInvite: function (id) { return req("POST", "/staff/" + encodeURIComponent(id) + "/revoke-invite"); },
    disableStaff: function (id) { return req("POST", "/staff/" + encodeURIComponent(id) + "/disable"); },
    enableStaff: function (id) { return req("POST", "/staff/" + encodeURIComponent(id) + "/enable"); },
    // TRI-1011: role→permission matrix. GET hydrates the RBAC toggles; PUT persists operator/viewer edits
    // (admin is locked all-on server-side). Guards resolve permissions per request, so edits take effect live.
    getRolePermissions: function () { return req("GET", "/roles/permissions"); },
    saveRolePermissions: function (matrix) { return req("PUT", "/roles/permissions", { matrix: matrix || {} }); },
    // reviews moderation (TRI-893) — unpublish & restore both return a review to 'pending' (hidden)
    listReviews: function () { return req("GET", "/reviews"); },
    approveReview: function (id) { return req("POST", "/reviews/" + encodeURIComponent(id) + "/approve"); },
    rejectReview: function (id) { return req("POST", "/reviews/" + encodeURIComponent(id) + "/reject"); },
    unpublishReview: function (id) { return req("POST", "/reviews/" + encodeURIComponent(id) + "/unpublish"); },
    restoreReview: function (id) { return req("POST", "/reviews/" + encodeURIComponent(id) + "/restore"); },
    replyReview: function (id, reply) { return req("POST", "/reviews/" + encodeURIComponent(id) + "/reply", { reply: reply }); },
    // blog / CMS (TRI-917) — authoring CRUD, guarded server-side by content.manage
    listBlog: function () { return req("GET", "/blog"); },
    getBlog: function (id) { return req("GET", "/blog/" + encodeURIComponent(id)); },
    saveBlog: function (v) {
      var id = v && v.id; var b = Object.assign({}, v); delete b.id;
      return id ? req("PATCH", "/blog/" + encodeURIComponent(id), b) : req("POST", "/blog", b);
    },
    setBlogPublished: function (id, pub) { return req("POST", "/blog/" + encodeURIComponent(id) + "/" + (pub ? "publish" : "unpublish")); },
    deleteBlog: function (id) { return req("DELETE", "/blog/" + encodeURIComponent(id)); },
    // misc lists
    listCustomers: function () { return req("GET", "/customers"); },
    getCustomer: function (id) { return req("GET", "/customers/" + encodeURIComponent(id)); },
    // TRI-972: customer activity/events timeline (bookings, cancellations, reschedules, refunds, reviews)
    getCustomerActivity: function (id) { return req("GET", "/customers/" + encodeURIComponent(id) + "/activity"); },
    listGuides: function () { return req("GET", "/guides"); },
    // guides write path (TRI-1005) — POST/PATCH/DELETE /guides all exist server-side
    // (guarded by tours.edit). createGuide → save, updateGuide/setGuideStatus → edit
    // + on-leave/active toggle, deleteGuide → remove from the lead-guide picker.
    getGuide: function (id) { return req("GET", "/guides/" + encodeURIComponent(id)); },
    createGuide: function (v) { return req("POST", "/guides", v || {}); },
    updateGuide: function (id, v) { return req("PATCH", "/guides/" + encodeURIComponent(id), v || {}); },
    setGuideStatus: function (id, status) { return req("PATCH", "/guides/" + encodeURIComponent(id), { status: status }); },
    deleteGuide: function (id) { return req("DELETE", "/guides/" + encodeURIComponent(id)); },
    // reporting (TRI-898): console-home aggregates + read-only audit log (A15/A16)
    getDashboard: function (range) { return req("GET", "/dashboard" + (range ? "?range=" + encodeURIComponent(range) : "")); },
    listAuditLog: function (params) {
      var q = [];
      if (params) { for (var k in params) if (params[k] != null && params[k] !== "") q.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k])); }
      return req("GET", "/audit-log" + (q.length ? "?" + q.join("&") : ""));
    },
    request: req,
  };
  window.TK_ADMIN_API = API;

  // ---- 401/403/validation surfacing for screen mutations --------------------
  // Screens keep their optimistic UI (toast + local state) exactly as the
  // prototype does; TK_ADMIN_ACT just wraps it. Flag off → run the optimistic
  // callback synchronously (byte-identical). Flag on → call the endpoint, then
  // run the optimistic callback on success, else surface the server error in the
  // DS toast and dispatch tk-admin-401 on an expired/absent session.
  function toast(msg) { if (window.tkToast) window.tkToast(msg); }
  function errMessage(err) {
    if (!err) return "Something went wrong. Please try again.";
    if (err.status === 401) return "Your session has expired. Please sign in again.";
    if (err.status === 403) return "You don't have permission to do that.";
    if (err.status === 422 || (err.fields && Object.keys(err.fields).length)) {
      var f = err.fields ? Object.keys(err.fields).map(function (k) { return err.fields[k]; }).join(" ") : "";
      return err.message ? err.message + (f ? " — " + f : "") : (f || "Please check the form and try again.");
    }
    return err.message || "Something went wrong. Please try again.";
  }
  // TRI-980: SYSTEMIC re-render seam. Admin screens read mutable module globals
  // (window.TK_ADMIN.*, window.TK_REVIEWS) directly — a successful mutation that
  // updates the shared record does NOT, on its own, make the mounted screen
  // re-read it, so the row stayed stale until a manual refresh re-hydrated the
  // console (reviews approve/publish, payments mark-paid, refund, …). Every write
  // funnels through TK_ADMIN_ACT, so we bump a global revision and broadcast a
  // single event here AFTER the optimistic callback has applied its data change.
  // AdminApp (app.jsx) subscribes and force-re-renders the whole tree, so any
  // screen that mutated its shared global re-reads it live. One seam, whole family.
  function notifyMutated() {
    window.TK_ADMIN_REV = (window.TK_ADMIN_REV || 0) + 1;
    try { window.dispatchEvent(new CustomEvent("tk-admin-mutated")); } catch (_) {}
  }
  window.TK_ADMIN_NOTIFY_MUTATED = notifyMutated;
  window.TK_ADMIN_ACT = function (call, optimistic, opts) {
    opts = opts || {};
    if (!live()) { if (optimistic) optimistic(); notifyMutated(); return Promise.resolve(); }
    var p = typeof call === "function" ? call() : call;
    if (!p || typeof p.then !== "function") { if (optimistic) optimistic(); notifyMutated(); return Promise.resolve(); }
    return p.then(function (res) {
      if (optimistic) optimistic(res);
      if (opts.onSuccess) opts.onSuccess(res);
      notifyMutated();
      return res;
    }, function (err) {
      if (err && err.status === 401) window.dispatchEvent(new CustomEvent("tk-admin-401"));
      if (opts.onError) opts.onError(err);
      else toast(errMessage(err));
      // Do NOT run the optimistic update on failure — the write didn't persist.
      throw err;
    });
  };

  // TRI-1007 · Turn a resend-confirmation API result into an honest operator toast. `res` is undefined
  // in fixture mode (TK_ADMIN_ACT short-circuits off the live API) → show the passed-in fallback so the
  // DS demo copy is unchanged. Live → report what actually happened with the send.
  window.TK_RESEND_MSG = function (res, fallback) {
    if (!res) return fallback;
    var to = res.to ? " to " + res.to : "";
    switch (res.outcome) {
      case "sent": return "Confirmation re-sent" + to + ".";
      case "skipped": return "Email sending is off in this environment — nothing was sent.";
      case "no_recipient": return "No contact email on file — nothing was sent.";
      default: return "Couldn't send the confirmation — check the email log.";
    }
  };
  // Summarise a bulk resend (array of per-ref results, some may be rejections caught as {outcome:'error'}).
  window.TK_RESEND_BULK_MSG = function (results, count) {
    if (!results) return "Confirmation resent to " + count + " customers";
    var sent = results.filter(function (r) { return r && r.outcome === "sent"; }).length;
    if (sent === results.length) return "Confirmation re-sent to " + sent + " customer" + (sent === 1 ? "" : "s") + ".";
    if (sent === 0) return "No confirmations sent — recipients had no email, sending is off, or the bookings can't be resent.";
    return "Re-sent " + sent + " of " + results.length + " confirmations (the rest had no email or can't be resent).";
  };

  // ---- live hydration -------------------------------------------------------
  function commitTours(tours) {
    var D = (window.TK_DATA = window.TK_DATA || {});
    if (!Array.isArray(D.tours)) D.tours = [];
    D.tours.length = 0; Array.prototype.push.apply(D.tours, tours);
    var A = (window.TK_ADMIN = window.TK_ADMIN || {});
    A.tours = D.tours;
  }
  function commitRegions(names) {
    var D = (window.TK_DATA = window.TK_DATA || {});
    if (!Array.isArray(D.regions)) D.regions = [];
    D.regions.length = 0; Array.prototype.push.apply(D.regions, names);
  }
  function setAdmin(key, arr) { var A = (window.TK_ADMIN = window.TK_ADMIN || {}); A[key] = arr; }

  function hydrate() {
    var A = (window.TK_ADMIN = window.TK_ADMIN || {});
    // Tours + regions first (bookings/departures reference them).
    return Promise.all([
      API.listTours().catch(function () { return null; }),
      API.listRegions().catch(function () { return null; }),
    ]).then(function (r) {
      var tours = list(r[0], "tours").map(mapTour);
      if (r[0] != null) commitTours(tours);
      var regionNames = list(r[1], "regions")
        .map(function (x) { return typeof x === "string" ? x : x.name; })
        .filter(Boolean);
      if (regionNames.length) commitRegions(regionNames);

      var tourById = {}; (window.TK_DATA.tours || []).forEach(function (t) { tourById[t.id] = t; tourById[t._apiId] = t; });

      // The rest hydrate independently; a missing/not-ready endpoint (or even a
      // synchronous error building the request) leaves the fixture-derived
      // TK_ADMIN entry in place. `safe` guarantees no single list can reject the
      // batch and drop the console back to fixtures mid-boot.
      function safe(fn) { try { return Promise.resolve(fn()).catch(function () {}); } catch (_) { return Promise.resolve(); } }
      return Promise.all([
        safe(function () { return API.listBookings().then(function (b) { setAdmin("bookings", list(b, "bookings").map(function (x) { return mapBooking(x, tourById); })); }); }),
        safe(function () { return API.listPayments().then(function (b) { setAdmin("payments", list(b, "payments").map(mapPayment)); }); }),
        safe(function () { return API.listDepartures().then(function (b) { setAdmin("departures", list(b, "departures").map(function (x) { return mapDepartureRow(x, tourById); })); }); }),
        safe(function () { return API.listPromos().then(function (b) { setAdmin("promos", list(b, "promos").map(mapPromo)); }); }),
        safe(function () { return API.listStaff().then(function (b) { setAdmin("staff", list(b, "staff").map(mapStaff)); }); }),
        safe(function () { return API.listCustomers().then(function (b) { setAdmin("customers", list(b, "customers").map(mapCustomer)); }); }),
        safe(function () { return API.listGuides().then(function (b) { setAdmin("guides", list(b, "guides").map(mapGuide)); }); }),
        safe(function () { return API.listBlog().then(function (b) { setAdmin("blog", list(b, "posts").map(mapBlogPost)); }); }),
        safe(function () { return req("GET", "/reviews").then(function (b) {
          var revs = list(b, "reviews").map(mapReview);
          if (!Array.isArray(window.TK_REVIEWS)) window.TK_REVIEWS = [];
          window.TK_REVIEWS.length = 0; Array.prototype.push.apply(window.TK_REVIEWS, revs);
        }); }),
        // Dashboard aggregates (TRI-898) for the default "7d" range so the console
        // home renders real numbers on first paint; the screen refetches on range change.
        safe(function () { return API.getDashboard("7d").then(function (d) { if (d) setAdmin("dashboard", d); }); }),
      ]);
    });
  }

  // ---- DS-consistent loading / error states (pre-React) ---------------------
  function shell(inner) {
    return '<div style="min-height:100vh;display:grid;place-items:center;padding:32px;background:var(--shell-content-bg)">' +
      '<div style="display:flex;flex-direction:column;align-items:center;gap:16px;max-width:420px;text-align:center">' + inner + "</div></div>";
  }
  function renderLoading() {
    var root = document.getElementById("root"); if (!root) return;
    root.innerHTML = shell('<span class="tk-spin" style="width:34px;height:34px;border-radius:50%;border:3px solid var(--border-subtle);border-top-color:var(--brand);display:inline-block"></span>' +
      '<p style="margin:0;color:var(--text-muted)">Loading the console…</p>');
    if (!document.getElementById("tk-spin-kf")) {
      var st = document.createElement("style"); st.id = "tk-spin-kf";
      st.textContent = "@keyframes tk-spin{to{transform:rotate(360deg)}}.tk-spin{animation:tk-spin .8s linear infinite}";
      document.head.appendChild(st);
    }
  }
  function renderError(err, retry) {
    var root = document.getElementById("root"); if (!root) return;
    var msg = (err && err.message) || "We couldn't reach the console service.";
    root.innerHTML = shell('<span style="width:44px;height:44px;border-radius:50%;background:var(--danger-wash,rgba(200,40,40,.1));color:var(--danger-fg,#b3261e);display:grid;place-items:center;font-size:22px;font-weight:800">!</span>' +
      '<h2 class="tk-h4" style="margin:0">Something went wrong</h2>' +
      '<p style="margin:0;color:var(--text-muted)">' + String(msg).replace(/[<>&]/g, "") + "</p>" +
      '<button id="tk-retry" class="tk-btn tk-btn--primary" style="min-height:44px;padding:0 20px;border-radius:var(--radius-pill);border:0;background:var(--brand);color:#fff;font-weight:700;cursor:pointer">Try again</button>');
    var btn = document.getElementById("tk-retry"); if (btn) btn.addEventListener("click", retry);
  }

  // ---- the boot gate app.js calls -------------------------------------------
  // window.TK_ADMIN_SESSION: null until resolved. When live, it is either the
  // staff session ({staff, role, permissions}) or the sentinel {unauthenticated:true}
  // so app.jsx renders the login screen. Flag off → left null (fixtures/demo).
  window.TK_ADMIN_SESSION = null;
  // TRI-1009: apply the staff member's saved theme to the whole console. "system"
  // follows the OS; explicit light/dark wins. Uses the design system's own
  // [data-theme="dark"] tokens (semantic.css / admin.css).
  function applyTheme(theme) {
    try {
      var root = document.documentElement;
      var t = theme;
      if (t === "system") t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
      if (t === "dark") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
    } catch (e) {}
  }
  window.TK_ADMIN_APPLY_THEME = applyTheme;
  function sessionFromMe(me) {
    var prefs = (me && me.preferences) || null;
    if (prefs && prefs.theme) applyTheme(prefs.theme);
    return {
      staff: (me && (me.staff || me.user || me)) || {},
      role: (me && (me.role || (me.staff && me.staff.role))) || "admin",
      permissions: (me && (me.permissions || me.perms)) || null,
      preferences: prefs,
    };
  }
  // Called by the login screen after a successful POST /auth/login: record the
  // session, then hydrate the globals so the console lands on real data.
  window.TK_ADMIN_ENTER = function (me) {
    window.TK_ADMIN_SESSION = sessionFromMe(me);
    return live() ? hydrate() : Promise.resolve();
  };
  window.TK_ADMIN_HYDRATE = hydrate;
  window.TK_BOOT = function (render) {
    if (!live()) { render(); return; } // fixtures — unchanged prototype
    renderLoading();
    API.me().then(function (me) {
      window.TK_ADMIN_SESSION = sessionFromMe(me);
      return hydrate().then(render, render);
    }, function (err) {
      if (err && (err.status === 401 || err.status === 403)) {
        // Not signed in (or no access) → render the app, which starts on /login.
        window.TK_ADMIN_SESSION = { unauthenticated: true };
        render();
        return;
      }
      renderError(err, function () { window.TK_BOOT(render); });
    });
  };
})();
