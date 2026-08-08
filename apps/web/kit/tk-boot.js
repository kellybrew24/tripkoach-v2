/* ==========================================================================
 * TripKoach v2 web — read-path bootstrap (TRI-861 Phase 1 shim).
 *
 * The DS-verbatim seam. The kit screens read their data SYNCHRONOUSLY from
 * window-globals (window.TK_DATA.tours, window.TK_REVIEWS, window.TK_DATA.regions,
 * per-tour t.departures). Fixtures (data/data.js) populate those globals today.
 * This file replaces that static seam with a runtime one WITHOUT editing any
 * screen: when USE_LIVE_API is on it fetches the live read endpoints, maps the
 * API shapes back into the *same global shape* the screens already expect, and
 * only then mounts the app. Flag off → it renders immediately from fixtures, so
 * behaviour is byte-for-byte the prototype.
 *
 * app.js calls `window.TK_BOOT(render)` instead of rendering directly. The one
 * app.jsx edit is the render entrypoint; the screen files are untouched.
 *
 * Endpoints consumed (Phase 0 contract, same-origin under TK_CONFIG.apiBase):
 *   GET /regions                    → region set
 *   GET /tours                      → catalogue (home featured + browse cards)
 *   GET /tours/:slug                → tour detail (highlights/itinerary/packages)
 *   GET /tours/:id/availability     → departures (+ remaining seats)
 *   GET /tours/:id/reviews          → approved reviews + stats
 *
 * Mapping is deliberately tolerant (accepts either minor-unit or major-unit
 * money, string-or-ISO dates, `{tours:[...]}` envelope or a bare array) so
 * integration with Backend stays mechanical even as the exact JSON firms up.
 * ======================================================================== */
(function () {
  var api = window.TK_API;

  // ---- money / date helpers -------------------------------------------------
  // Fixtures carry whole-currency numbers (e.g. 65). The API carries integer
  // minor units + an explicit currency (Phase 0 §3.1). Accept both.
  function major(v, minorField) {
    if (typeof minorField === "number") return Math.round(minorField) / 100;
    return typeof v === "number" ? v : 0;
  }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(v) {
    if (!v) return "";
    // Already a display string ("Sat 22 Aug 2026")? pass through.
    if (typeof v === "string" && !/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  // ---- mappers: API shape → kit fixture shape -------------------------------
  function mapTierList(tiers) {
    if (!Array.isArray(tiers)) return null;
    return tiers
      .map(function (t) {
        return { minPax: t.minPax != null ? t.minPax : t.min_pax, price: major(t.price, t.priceMinor != null ? t.priceMinor : t.price_minor) };
      })
      .filter(function (t) {
        return typeof t.minPax === "number";
      });
  }
  // Same group-discount fallback data.js uses, so TK_PRICE stays consistent when
  // the API doesn't ship explicit tiers for a tour.
  function deriveTiers(price) {
    var r = function (n) {
      return Math.round(n / 5) * 5;
    };
    return [
      { minPax: 1, price: r(price * 1.4) },
      { minPax: 2, price: r(price * 1.15) },
      { minPax: 6, price: price },
    ];
  }

  function mapTourSummary(t) {
    var price = major(t.price != null ? t.price : t.priceMajor, t.basePriceMinor != null ? t.basePriceMinor : t.base_price_minor);
    var out = {
      // The kit keys tours, images and reviews by `id`; the catalogue slug is
      // that natural key. Keep the raw API id for the availability/reviews calls.
      id: t.slug || t.id,
      _apiId: t.id != null ? t.id : t.slug,
      slug: t.slug || t.id,
      title: t.title,
      region: t.region || t.regionName || (t.region && t.region.name) || "",
      duration: t.duration || "",
      category: t.category || "",
      price: price,
      currency: t.currency || "USD",
      rating: t.rating != null ? t.rating : t.ratingCached != null ? t.ratingCached : t.rating_cached,
      reviews: t.reviews != null ? t.reviews : t.reviewCount != null ? t.reviewCount : t.review_count_cached,
      spotsLeft: t.spotsLeft != null ? t.spotsLeft : t.spots_left,
      tag: t.tag || (t.featured ? "Featured" : undefined),
      image: t.image || (Array.isArray(t.images) && t.images[0]) || null,
      blurb: t.blurb || "",
      featured: !!t.featured,
    };
    out.tiers = mapTierList(t.tiers) || deriveTiers(price);
    return out;
  }

  function enrichTourDetail(tour, detail) {
    if (!detail) return tour;
    if (detail.highlights) tour.highlights = detail.highlights;
    if (detail.included) tour.included = detail.included;
    if (detail.excluded) tour.excluded = detail.excluded;
    if (detail.itinerary) {
      tour.itinerary = detail.itinerary.map(function (row) {
        return Array.isArray(row) ? row : [row.time || row.day || "", row.label || row.text || ""];
      });
    }
    if (detail.pricing) tour.pricing = detail.pricing;
    // Only attach packages when there's at least one — the kit treats `t.packages`
    // as truthy ("this tour has routes") and reads packages[0].id, so an empty
    // array would crash. Absent/empty ⇒ the single-route tour path.
    if (Array.isArray(detail.packages) && detail.packages.length) tour.packages = detail.packages;
    var tiers = mapTierList(detail.tiers || detail.priceTiers || detail.price_tiers);
    if (tiers && tiers.length) tour.tiers = tiers;
    if (detail.defaultPackage) tour.defaultPackage = detail.defaultPackage;
    return tour;
  }

  function mapDeparture(d) {
    return {
      id: d.id,
      date: fmtDate(d.date),
      time: d.time || "",
      price: major(d.price, d.priceMinor != null ? d.priceMinor : d.price_minor),
      spotsLeft: d.spotsLeft != null ? d.spotsLeft : d.spots_left,
    };
  }

  function mapReview(r, tourSlug) {
    var author = r.author || r.name || "Traveller";
    return {
      id: r.id,
      tourId: r.tourId || r.tourSlug || tourSlug,
      tour: r.tour || "",
      author: author,
      initials: r.initials || author.split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase(),
      rating: r.rating,
      date: fmtDate(r.date || r.createdAt || r.created_at),
      verified: r.verified != null ? r.verified : true,
      status: r.status || "approved",
      title: r.title || "",
      text: r.text || r.body || "",
      reply: r.reply || "",
    };
  }

  // ---- envelope helpers -----------------------------------------------------
  function list(body, key) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body[key])) return body[key];
    if (body && Array.isArray(body.items)) return body.items;
    return [];
  }

  // ---- per-tour hydration (TRI-888, gap C2) ---------------------------------
  // Fetch detail + availability + reviews for ONE tour and fold them into the
  // existing summary object IN PLACE (the tour screen reads it synchronously, so
  // mutating the object the catalogue already handed React keeps every reference
  // valid). Idempotent — a hydrated tour short-circuits — and resolves even when
  // a sub-request fails, degrading to the summary while guaranteeing the arrays
  // TourWeb reads are defined so the screen can never throw.
  //
  // The three read endpoints are LIVE (audit §3, C2/C3/C16). The availability /
  // reviews resolver accepts a slug OR a UUID, so we key every call off the slug
  // (the Phase-0 `:slug` contract) and fall back to the raw API id defensively.
  function hydrateTour(tour) {
    if (!tour) return Promise.resolve(tour);
    if (tour._hydrated) return Promise.resolve(tour);
    var slug = tour.slug || tour.id;
    var key = slug != null ? slug : tour._apiId;
    return Promise.all([
      api.get("/tours/" + encodeURIComponent(key)).catch(function () { return null; }),
      api.get("/tours/" + encodeURIComponent(key) + "/availability").catch(function () { return null; }),
      api.get("/tours/" + encodeURIComponent(key) + "/reviews").catch(function () { return null; }),
    ]).then(function (d) {
      enrichTourDetail(tour, d[0]);
      var deps = list(d[1], "departures").map(mapDeparture);
      if (deps.length) tour.departures = deps;
      var reviews = list(d[2], "reviews").map(function (r) { return mapReview(r, tour.id); });
      setReviewsFor(tour.id, reviews);
      // Backfill only what a degraded sub-request left missing; the API supplies
      // all of these today, so this is a no-op on the happy path.
      if (!Array.isArray(tour.departures)) tour.departures = [];
      if (!Array.isArray(tour.highlights)) tour.highlights = [];
      if (!Array.isArray(tour.included)) tour.included = [];
      if (!Array.isArray(tour.excluded)) tour.excluded = [];
      if (!Array.isArray(tour.itinerary)) tour.itinerary = [];
      tour._hydrated = true;
      return tour;
    });
  }

  // The boot gate exposes on-demand hydration so slug-aware routing (app.jsx)
  // can pull any tour's detail/departures/reviews when its page opens. Resolves
  // (never rejects) — an unknown slug or a fetch failure still lets the screen
  // render from summary data rather than blocking on an error.
  window.TK_HYDRATE_TOUR = function (slug) {
    var D = window.TK_DATA || {};
    var tours = Array.isArray(D.tours) ? D.tours : [];
    var tour = null;
    for (var i = 0; i < tours.length; i++) {
      if (tours[i].id === slug || tours[i].slug === slug) { tour = tours[i]; break; }
    }
    if (!tour) return Promise.resolve(null);
    return hydrateTour(tour).catch(function () { return tour; });
  };

  // ---- blog (TRI-917) -------------------------------------------------------
  // The blog screens read window.TK_BLOG (cards) + window.TK_BLOG_TAGS (chips)
  // synchronously; a post page reads the matching entry's `body` block array.
  // The list endpoint ships card metadata only (no body) — each post's body is
  // fetched on demand via TK_HYDRATE_POST when its page opens (mirrors tours).
  function mapPostCard(p) {
    return {
      slug: p.slug, tag: p.tag || null,
      readTime: p.readTime != null ? p.readTime : p.read_time,
      date: typeof p.date === "string" ? p.date : fmtDate(p.date || p.publishedAt || p.published_at),
      title: p.title || "", excerpt: p.excerpt || "",
      hero: p.hero || p.heroUrl || p.hero_url || null,
    };
  }
  function commitBlog(posts, tags) {
    if (!Array.isArray(window.TK_BLOG)) window.TK_BLOG = [];
    window.TK_BLOG.length = 0;
    Array.prototype.push.apply(window.TK_BLOG, posts);
    if (Array.isArray(tags) && tags.length) {
      if (!Array.isArray(window.TK_BLOG_TAGS)) window.TK_BLOG_TAGS = [];
      window.TK_BLOG_TAGS.length = 0;
      Array.prototype.push.apply(window.TK_BLOG_TAGS, tags);
    }
  }
  function loadBlog() {
    return api.get("/blog").then(function (body) {
      var posts = list(body, "posts").map(mapPostCard);
      var tags = body && Array.isArray(body.tags) ? body.tags : null;
      commitBlog(posts, tags);
    }).catch(function () { /* blog is non-critical to the catalogue boot; leave fixtures */ });
  }
  // Fetch one post's full body on demand and fold it into the TK_BLOG entry in
  // place (BlogPost reads window.TK_BLOG synchronously). Idempotent — a post that
  // already carries a body array short-circuits. Resolves even on failure.
  window.TK_HYDRATE_POST = function (slug) {
    var posts = Array.isArray(window.TK_BLOG) ? window.TK_BLOG : [];
    var p = null;
    for (var i = 0; i < posts.length; i++) if (posts[i].slug === slug) { p = posts[i]; break; }
    if (!p) return Promise.resolve(null);
    if (Array.isArray(p.body)) return Promise.resolve(p);
    return api.get("/blog/" + encodeURIComponent(slug)).then(function (d) {
      if (d) {
        p.body = Array.isArray(d.body) ? d.body : [];
        if (d.heroAlt || d.hero_alt) p.heroAlt = d.heroAlt || d.hero_alt;
        if (d.author) p.author = d.author;
      }
      return p;
    }, function () { return p; });
  };

  // ---- live load ------------------------------------------------------------
  function loadLiveData() {
    return Promise.all([api.get("/regions"), api.get("/tours"), loadBlog()]).then(function (res) {
      var regionsBody = res[0];
      var toursBody = res[1];

      var regionNames = list(regionsBody, "regions")
        .filter(function (r) {
          return typeof r === "string" || r.active !== false;
        })
        .map(function (r) {
          return typeof r === "string" ? r : r.name;
        })
        .filter(Boolean);

      var tours = list(toursBody, "tours").map(mapTourSummary);
      // We're live — drop the fixture reviews so nothing stale shows through; each
      // tour's approved reviews are merged back in as its page hydrates.
      commit(tours, regionNames);
      if (!tours.length) return; // empty catalogue is valid (screens have EmptyState)

      // Eagerly hydrate the lead tour so the home/browse landing feels instant and
      // a deep-link to `/tour` (no slug) resolves. Every OTHER tour hydrates lazily
      // via TK_HYDRATE_TOUR when its slug-routed page opens (gap C2).
      return hydrateTour(tours[0]);
    });
  }

  // Mutate the existing globals IN PLACE where kit helpers captured a reference
  // to the array (data.js's TK_REGION_TOURS closes over the original tours array;
  // TK_REVIEWS_FOR reads window.TK_REVIEWS fresh each call). Reassigning would
  // orphan those closures — clearing + repushing keeps every helper valid.
  function commit(tours, regionNames) {
    var D = (window.TK_DATA = window.TK_DATA || {});
    if (!Array.isArray(D.tours)) D.tours = [];
    D.tours.length = 0;
    Array.prototype.push.apply(D.tours, tours);
    D.regions = regionNames;
    // Start from an empty review set in live mode; hydration fills it per tour.
    if (!Array.isArray(window.TK_REVIEWS)) window.TK_REVIEWS = [];
    window.TK_REVIEWS.length = 0;
  }

  // Replace the review set for one tour in-place: drop any prior entries for that
  // id (re-hydration stays idempotent) then append the fresh approved reviews.
  // TK_REVIEWS_FOR filters window.TK_REVIEWS by tourId, so multiple tours' reviews
  // coexist happily.
  function setReviewsFor(tourId, reviews) {
    if (!Array.isArray(window.TK_REVIEWS)) window.TK_REVIEWS = [];
    var kept = window.TK_REVIEWS.filter(function (r) { return r.tourId !== tourId; });
    window.TK_REVIEWS.length = 0;
    Array.prototype.push.apply(window.TK_REVIEWS, kept.concat(reviews || []));
  }

  // ---- DS-consistent loading / error states (pre-React, token-driven) -------
  function stateShell(inner) {
    return (
      '<div style="min-height:70vh;display:grid;place-items:center;padding:var(--space-8)">' +
      '<div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-4);max-width:420px;text-align:center">' +
      inner +
      "</div></div>"
    );
  }
  function renderLoading() {
    var root = document.getElementById("root");
    if (!root) return;
    root.innerHTML = stateShell(
      '<span class="tk-spin" style="width:34px;height:34px;border-radius:50%;border:3px solid var(--border-subtle);border-top-color:var(--brand);display:inline-block"></span>' +
        '<p class="tk-body" style="margin:0;color:var(--text-muted)">Loading tours…</p>'
    );
    if (!document.getElementById("tk-spin-kf")) {
      var st = document.createElement("style");
      st.id = "tk-spin-kf";
      st.textContent = "@keyframes tk-spin{to{transform:rotate(360deg)}}.tk-spin{animation:tk-spin .8s linear infinite}";
      document.head.appendChild(st);
    }
  }
  function renderError(err, retry) {
    var root = document.getElementById("root");
    if (!root) return;
    var msg = (err && err.message) || "We couldn't reach the tours service.";
    root.innerHTML = stateShell(
      '<span style="width:44px;height:44px;border-radius:50%;background:var(--danger-wash,rgba(200,40,40,.1));color:var(--danger-fg,#b3261e);display:grid;place-items:center;font-size:22px;font-weight:800">!</span>' +
        '<h2 class="tk-h4" style="margin:0">Something went wrong</h2>' +
        '<p class="tk-body" style="margin:0;color:var(--text-muted)">' + String(msg).replace(/[<>&]/g, "") + "</p>" +
        '<button id="tk-retry" class="tk-btn tk-btn--primary" style="min-height:44px;padding:0 20px;border-radius:var(--radius-pill);border:0;background:var(--brand);color:#fff;font-weight:700;cursor:pointer">Try again</button>'
    );
    var btn = document.getElementById("tk-retry");
    if (btn) btn.addEventListener("click", retry);
  }

  // ---- the boot gate app.js calls -------------------------------------------
  window.TK_BOOT = function (render) {
    var cfg = window.TK_CONFIG || {};
    if (!cfg.USE_LIVE_API || !api) {
      render(); // fixtures — unchanged prototype
      return;
    }
    renderLoading();
    loadLiveData().then(
      function () {
        render();
      },
      function (err) {
        renderError(err, function () {
          window.TK_BOOT(render);
        });
      }
    );
  };
})();
