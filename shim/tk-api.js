/* ==========================================================================
 * TripKoach v2 — tiny same-origin API client (TRI-861 Phase 1 shim).
 *
 * `window.TK_API` — a dependency-free fetch wrapper that talks to the API base
 * from window.TK_CONFIG.apiBase. Same-origin (Caddy proxies `/api/*` to the
 * Fastify service on the box), so the session cookie "just works" with
 * credentials:"include" and there is no CORS. Errors are normalised to a
 * consistent shape so callers never have to branch on transport vs. HTTP vs.
 * API-error details.
 *
 * Response envelope (Phase 0 §3.1 conventions):
 *   - success: JSON body (object or array) with HTTP 2xx.
 *   - error:   { error: { code, message, fields? } } with 4xx/5xx.
 * We surface both as a thrown TkApiError carrying { status, code, message }.
 *
 * This is the transport only. Mapping API shapes → the kit's fixture shape
 * lives in each app's tk-boot.js so DS screens stay verbatim.
 * ======================================================================== */
(function () {
  function cfg() {
    return window.TK_CONFIG || { apiBase: "/api/v1" };
  }

  function base() {
    // Normalise: no trailing slash on the base, leading slash on the path.
    return String(cfg().apiBase || "/api/v1").replace(/\/+$/, "");
  }

  function join(path) {
    var p = String(path || "");
    if (/^https?:\/\//i.test(p)) return p; // absolute — used by tests/mocks
    if (p.charAt(0) !== "/") p = "/" + p;
    return base() + p;
  }

  function TkApiError(status, code, message, fields) {
    var e = new Error(message || code || ("HTTP " + status));
    e.name = "TkApiError";
    e.status = status;
    e.code = code || null;
    e.fields = fields || null;
    e.isTkApiError = true;
    return e;
  }

  function request(method, path, opts) {
    opts = opts || {};
    var url = join(path);
    if (opts.query) {
      var qs = Object.keys(opts.query)
        .filter(function (k) {
          var v = opts.query[k];
          return v !== undefined && v !== null && v !== "";
        })
        .map(function (k) {
          return encodeURIComponent(k) + "=" + encodeURIComponent(opts.query[k]);
        })
        .join("&");
      if (qs) url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
    }
    var init = {
      method: method,
      credentials: "include", // send/receive the same-origin session cookie
      headers: { Accept: "application/json" },
    };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    if (opts.signal) init.signal = opts.signal;

    return fetch(url, init).then(function (res) {
      var ct = res.headers && res.headers.get && res.headers.get("content-type");
      var isJson = ct && ct.indexOf("application/json") !== -1;
      return (isJson ? res.json() : res.text()).then(
        function (payload) {
          if (res.ok) return payload;
          var err = isJson && payload && payload.error ? payload.error : {};
          throw TkApiError(res.status, err.code, err.message || ("HTTP " + res.status), err.fields);
        },
        function () {
          // Body parse failed.
          if (res.ok) return null;
          throw TkApiError(res.status, null, "HTTP " + res.status);
        }
      );
    });
  }

  window.TK_API = {
    TkApiError: TkApiError,
    base: base,
    url: join,
    get: function (path, opts) {
      return request("GET", path, opts);
    },
    post: function (path, body, opts) {
      return request("POST", path, Object.assign({ body: body }, opts || {}));
    },
    put: function (path, body, opts) {
      return request("PUT", path, Object.assign({ body: body }, opts || {}));
    },
    patch: function (path, body, opts) {
      return request("PATCH", path, Object.assign({ body: body }, opts || {}));
    },
    del: function (path, opts) {
      return request("DELETE", path, opts);
    },
  };
})();
