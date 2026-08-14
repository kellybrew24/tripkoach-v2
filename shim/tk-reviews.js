/* ==========================================================================
 * TripKoach v2 web: tokenized review redeem client (TRI-894 Phase 2 shim).
 *
 * `window.TK_REVIEWS_API`, a dependency-free wrapper over the Phase-2 consumer
 * WRITE contract (Backend sibling TRI-892), built on the same-origin transport
 * from tk-api.js (TRI-861). Loaded alongside the other shims but wired only from
 * the review-invite landing screen, and every call site is gated behind
 * window.TK_CONFIG.USE_LIVE_API, so with the flag OFF this module is inert: the
 * built app makes no review-submit calls whatsoever, staying byte-for-byte the
 * fixture prototype.
 *
 * The write path is TOKENIZED ONLY (there is no un-tokenized submit endpoint):
 * a traveller receives a one-time link `{webUrl}/reviews/redeem/:token` by email
 * after their departure. The landing page reads the redeem context to prefill
 * the tour + traveller, then submits the review against the same token.
 *
 *   GET  /reviews/redeem/:token  → 200 { token, tour:{slug,title,image}, prefill:{name,email} }
 *                                  404 { error:{code:"not_found"} }  , unknown/invalid token
 *                                  410 { error:{code:"gone"} }       , already redeemed
 *   POST /reviews/redeem/:token  → 200 { id, status:"pending", rating, title, text, verified, message }
 *      body { rating:1..5 (int, required), title?:string, text?:string }
 *                                  422 { error:{code:"validation", field} }
 *                                  404 unknown token | 410 already redeemed
 *
 * A submitted review is created status=pending and is invisible to the public
 * read (GET /tours/:slug/reviews, approved-only) until an admin approves it,
 * the landing screen reflects that in its post-submit "awaiting approval" state.
 *
 * Mapping is deliberately tolerant (snake_case or camelCase, envelope or bare
 * object) so integration with Backend stays mechanical while the exact JSON
 * firms up, same posture as tk-boot.js / tk-booking.js. TkApiError.status is
 * preserved so the screen can branch not_found (404) vs. gone (410).
 * ======================================================================== */
(function () {
  var api = window.TK_API;

  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return undefined;
  }

  // Normalise the redeem context into one stable shape the screen reads,
  // regardless of how Backend cased/nested its fields.
  function mapContext(r) {
    r = r || {};
    var body = r.data && typeof r.data === "object" ? r.data : r;
    var t = body.tour && typeof body.tour === "object" ? body.tour : {};
    var p = body.prefill && typeof body.prefill === "object" ? body.prefill : {};
    return {
      token: pick(body.token),
      tour: {
        slug: pick(t.slug, t.id, body.tourSlug, body.tour_slug),
        title: pick(t.title, t.name, body.tourTitle, body.tour_title) || "",
        image: pick(t.image, t.hero, t.imageUrl, t.image_url) || null,
      },
      prefill: {
        name: pick(p.name, p.travellerName, p.traveller_name, body.name) || "",
        email: pick(p.email, p.travellerEmail, p.traveller_email, body.email) || "",
      },
      raw: r,
    };
  }

  // Normalise a submit response. New reviews are always pending until moderated.
  function mapSubmit(r) {
    r = r || {};
    var body = r.data && typeof r.data === "object" ? r.data : r;
    return {
      id: pick(body.id, body.reviewId, body.review_id),
      status: pick(body.status) || "pending",
      rating: pick(body.rating),
      title: pick(body.title) || "",
      text: pick(body.text, body.body) || "",
      verified: pick(body.verified) !== undefined ? pick(body.verified) : true,
      message: pick(body.message) || "",
      raw: r,
    };
  }

  window.TK_REVIEWS_API = {
    // Read the redeem context for a token → prefill tour + traveller.
    // Rejects with a TkApiError carrying .status (404 not_found / 410 gone).
    redeemContext: function (token) {
      return api.get("/reviews/redeem/" + encodeURIComponent(token)).then(mapContext);
    },

    // Submit the review against the token. Only `rating` is required; empty
    // title/text are dropped so the server sees them as absent (optional).
    submit: function (token, review) {
      review = review || {};
      var payload = { rating: review.rating };
      var title = typeof review.title === "string" ? review.title.trim() : "";
      var text = typeof review.text === "string" ? review.text.trim() : "";
      if (title) payload.title = title;
      if (text) payload.text = text;
      return api.post("/reviews/redeem/" + encodeURIComponent(token), payload).then(mapSubmit);
    },
  };
})();
