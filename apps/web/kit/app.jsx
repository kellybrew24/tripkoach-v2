window.tkToast = (msg) => {
  let host = document.getElementById("tk-toast-host");
  if (!host) { host = document.createElement("div"); host.id = "tk-toast-host"; host.style.cssText = "position:fixed;left:0;right:0;bottom:76px;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:1000;pointer-events:none"; document.body.appendChild(host); }
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "pointer-events:auto;background:#1E1C1A;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.28);font-size:14px;font-weight:600;max-width:88%;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s";
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "none"; });
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; setTimeout(() => el.remove(), 250); }, 2600);
};

// --- Real URL routing (History API, hashless) ------------------------------
// Each screen maps to a real, shareable path. Deep links, refresh and browser
// back/forward all work: dev.tripkoach.com serves index.html for any path
// (SPA try_files fallback) and <base href="/"> keeps asset URLs absolute
// regardless of route depth. Blog posts are dynamic: /blog/:slug.
const ROUTES = [
  ["home", "/"], ["browse", "/browse"], ["tour", "/tour"], ["checkout", "/checkout"],
  ["confirm", "/confirm"], ["bookings", "/bookings"], ["booking", "/booking"], ["reviews", "/reviews"],
  ["login", "/login"], ["signup", "/signup"], ["forgot", "/forgot"], ["profile", "/profile"],
  ["notifications", "/notifications"], ["account-settings", "/account/settings"],
  ["regions", "/regions"], ["marketplace", "/shop"], ["esim", "/esim"],
  ["pickup", "/pickup"], ["club", "/club"], ["about", "/about"],
  ["contact", "/contact"], ["blog", "/blog"], ["review", "/review"],
];
const PATH_BY_SCREEN = Object.fromEntries(ROUTES.map(([s, p]) => [s, p]));
function pathForScreen(screen, slug) {
  if (screen === "post") return "/blog/" + encodeURIComponent(slug || "");
  // Tour detail is slug-addressable so any tour is a shareable, deep-linkable
  // page (TRI-888/C2). No slug ⇒ the bare /tour path (the fixture prototype and
  // the flag-off build never pass one, so behaviour there is unchanged).
  if (screen === "tour" && slug) return "/tour/" + encodeURIComponent(slug);
  // Booking detail/confirmation is ref-addressable (TRI-938): /booking/:ref is a
  // reopenable, shareable confirmed-booking view. No ref ⇒ the bare /booking path.
  if (screen === "booking" && slug) return "/booking/" + encodeURIComponent(slug);
  return PATH_BY_SCREEN[screen] || "/";
}
function routeFromPath(pathname, search) {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  const m = path.match(/^\/blog\/(.+)$/);
  if (m) return { screen: "post", slug: decodeURIComponent(m[1]) };
  const t = path.match(/^\/tour\/(.+)$/);
  if (t) return { screen: "tour", slug: decodeURIComponent(t[1]) };
  // Ref-routed booking detail/confirmation (TRI-938): /booking/:ref.
  const bk = path.match(/^\/booking\/(.+)$/);
  if (bk) return { screen: "booking", slug: decodeURIComponent(bk[1]) };
  // The emailed password-reset link (Backend TRI-881: APP_BASE_URL/reset-password
  // ?token=…) lands here — reuse the ForgotWeb screen, which reads the token off
  // the URL and opens on its "set a new password" stage.
  if (path === "/reset-password") return { screen: "forgot", slug: null };
  // The emailed email-verification link (Backend TRI-941: APP_BASE_URL/verify-email
  // ?token=…) lands here — the VerifyEmailPage reads the token off the URL and
  // POSTs /auth/verify-email, showing a success / expired / already-verified state.
  if (path === "/verify-email") return { screen: "verify", slug: null };
  // Tokenized review-invite deep link (TRI-894): the address Backend emails
  // travellers, `{webUrl}/reviews/redeem/:token`. Matched before the exact
  // `/reviews` account route so the sub-path resolves to the invite landing.
  const rv = path.match(/^\/reviews\/redeem\/(.+)$/);
  if (rv) return { screen: "review", slug: null, token: decodeURIComponent(rv[1]) };
  const hit = ROUTES.find(([, p]) => p === path);
  // Unknown paths resolve to a real 404 screen (TRI-1117) instead of silently
  // rendering home, so a mistyped or dead link is clearly signalled.
  const screen = hit ? hit[0] : "notfound";
  // Deep-link region filter (TRI-940): /browse?region=<name> pre-applies that
  // region on the Tours screen. Only the browse route reads it; elsewhere null.
  let region = null;
  if (screen === "browse") {
    try { region = new URLSearchParams(search || "").get("region") || null; } catch (_) { region = null; }
  }
  return { screen, slug: null, region };
}

// In-page loader shown while a tour detail hydrates from the API (TRI-888). Kept
// dependency-free (no DS namespace in app.jsx) and token-driven so it matches the
// pre-React boot spinner. Only ever rendered in live mode.
function TourDetailLoading({ label = "Loading tour…" }) {
  return (
    <div
      className="tk-container"
      style={{ paddingBlock: "var(--space-10) var(--space-12)", maxWidth: 1200, minHeight: "60vh", display: "grid", placeItems: "center" }}
      aria-busy="true"
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)" }}>
        <span className="tk-spin" style={{ width: 34, height: 34, borderRadius: "50%", border: "3px solid var(--border-subtle)", borderTopColor: "var(--brand)", display: "inline-block" }} />
        <p className="tk-body" style={{ margin: 0, color: "var(--text-muted)" }}>{label}</p>
      </div>
    </div>
  );
}

// Live per-slug tour hydration (TRI-888/C2). Flag off ⇒ this whole layer is
// inert: nav never carries a tour slug, so `slug` stays null and the tour screen
// renders tours[0] exactly as the fixture prototype did.
const LIVE_API = () => !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
function tourNeedsHydration(slug) {
  if (!LIVE_API() || !slug || !window.TK_HYDRATE_TOUR) return false;
  const tours = (window.TK_DATA && window.TK_DATA.tours) || [];
  const t = tours.find((x) => x.id === slug || x.slug === slug);
  return !(t && t._hydrated);
}
// Live per-slug blog-post hydration (TRI-917). The /blog list ships card
// metadata only; a post's body block array is fetched when its page opens.
// Flag off ⇒ inert (fixtures already carry bodies), so the prototype is unchanged.
function postNeedsHydration(slug) {
  if (!LIVE_API() || !slug || !window.TK_HYDRATE_POST) return false;
  const posts = window.TK_BLOG || [];
  const p = posts.find((x) => x.slug === slug);
  return !(p && Array.isArray(p.body));
}

// --- Per-route SEO & social head (TRI-1114) --------------------------------
// The web app is a client-rendered SPA (History-API routing, no SSR), so there
// is no server step to emit a per-route <title>/description/OG. Instead we keep
// the document head in sync with the router: on every screen change we set the
// title, meta description, canonical URL, robots directive and Open Graph /
// Twitter Card tags. JS-executing crawlers (Googlebot) and preview scrapers
// that run the page pick these up; the static index.html (scripts/build.mjs)
// ships sitewide defaults + Organization/WebSite JSON-LD for scrapers that
// never execute JS. Tour and blog-post routes derive richer metadata from the
// already-loaded fixtures / hydrated data so shared links read well.
const TK_SITE_NAME = "TripKoach";
const TK_DEFAULT_DESC =
  "Guided small-group tours across Ghana — festivals, coastline, culture and nature, booked with a local koach.";
function tkOrigin() {
  try { return (window.location.origin || "").replace(/\/+$/, ""); } catch (_) { return ""; }
}
function tkUpsertHead(selector, make) {
  let el = document.head.querySelector(selector);
  if (!el) { el = make(); document.head.appendChild(el); }
  return el;
}
function tkSetMeta(attr, key, content) {
  const el = tkUpsertHead(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement("meta"); m.setAttribute(attr, key); return m;
  });
  el.setAttribute("content", content == null ? "" : String(content));
}
function tkSetCanonical(href) {
  const el = tkUpsertHead('link[rel="canonical"]', () => {
    const l = document.createElement("link"); l.setAttribute("rel", "canonical"); return l;
  });
  el.setAttribute("href", href);
}
// Screens kept out of the search index: auth, checkout and anything behind a
// login. Everything else is indexable marketing/catalogue surface.
const TK_NOINDEX = ["login", "signup", "forgot", "verify", "checkout", "confirm",
  "bookings", "booking", "profile", "notifications", "account-settings", "review", "reviews",
  "notfound"];
const TK_SCREEN_META = {
  home: { title: "TripKoach — Guided tours across Ghana", desc: TK_DEFAULT_DESC },
  browse: { title: "Browse tours — TripKoach", desc: "Explore guided tour packages across Ghana's regions. Filter by region, compare prices and reserve your spot." },
  regions: { title: "Regions of Ghana — TripKoach", desc: "Nine regions, one koach. Discover the festivals, coastline, culture and nature that make each corner of Ghana worth the trip." },
  marketplace: { title: "Marketplace — TripKoach", desc: "Travel gear, local crafts and trip add-ons curated for your Ghana adventure." },
  esim: { title: "Travel eSIM — TripKoach", desc: "Stay connected across Ghana with a data eSIM that works the moment you land." },
  pickup: { title: "Airport pickup — TripKoach", desc: "Book a vetted driver to meet you at Kotoka and get you to your first stop." },
  club: { title: "Tourism clubs — TripKoach", desc: "Join a TripKoach tourism club and explore Ghana with a community of travellers." },
  about: { title: "About TripKoach", desc: "Why TripKoach exists and how a local koach makes exploring Ghana effortless." },
  contact: { title: "Contact TripKoach", desc: "Plan a trip, ask a question or partner with us — we reply fast." },
  blog: { title: "Stories — TripKoach", desc: "Field notes, destination guides and travel stories from across Ghana." },
  notfound: { title: "Page not found — TripKoach", desc: "The page you were looking for doesn't exist. Browse guided tours across Ghana instead." },
};
function tkOgImage(src, origin) {
  // Only trust absolute (CDN/R2) image URLs for social cards; anything else
  // falls back to the always-present brand badge so previews never 404.
  if (typeof src === "string" && /^https?:\/\//.test(src)) return src;
  return origin + "/assets/logo-badge.png";
}
function applyHead(screen, slug) {
  const origin = tkOrigin();
  let meta = TK_SCREEN_META[screen] || TK_SCREEN_META.home;
  let image = origin + "/assets/logo-badge.png";
  let ogType = "website";
  if (screen === "tour" && slug) {
    const t = ((window.TK_DATA && window.TK_DATA.tours) || []).find((x) => x.id === slug || x.slug === slug);
    if (t) {
      meta = { title: t.title + " — TripKoach", desc: String(t.blurb || TK_DEFAULT_DESC).slice(0, 180) };
      image = tkOgImage(t.image, origin);
      ogType = "product";
    }
  } else if (screen === "post" && slug) {
    const p = (window.TK_BLOG || []).find((x) => x.slug === slug);
    if (p) {
      meta = { title: p.title + " — TripKoach Stories", desc: String(p.excerpt || TK_DEFAULT_DESC).slice(0, 180) };
      image = tkOgImage(p.image || p.cover, origin);
      ogType = "article";
    }
  }
  const url = origin + pathForScreen(screen, slug);
  document.title = meta.title;
  tkSetMeta("name", "description", meta.desc);
  tkSetMeta("name", "robots", TK_NOINDEX.indexOf(screen) >= 0 ? "noindex,follow" : "index,follow");
  tkSetCanonical(url);
  tkSetMeta("property", "og:site_name", TK_SITE_NAME);
  tkSetMeta("property", "og:type", ogType);
  tkSetMeta("property", "og:title", meta.title);
  tkSetMeta("property", "og:description", meta.desc);
  tkSetMeta("property", "og:url", url);
  tkSetMeta("property", "og:image", image);
  tkSetMeta("name", "twitter:card", "summary_large_image");
  tkSetMeta("name", "twitter:title", meta.title);
  tkSetMeta("name", "twitter:description", meta.desc);
  tkSetMeta("name", "twitter:image", image);
}

function WebApp() {
  const first = routeFromPath(window.location.pathname, window.location.search);
  const [screen, setScreen] = React.useState(first.screen);
  const [slug, setSlug] = React.useState(first.slug);
  // Active region filter for the Tours screen, driven by /browse?region=<name>
  // deep links from the home + regions grids (TRI-940). null ⇒ no pre-filter.
  const [browseRegion, setBrowseRegion] = React.useState(first.region || null);
  // Review-invite token, only set when the URL is a `/reviews/redeem/:token`
  // deep link (TRI-894). Off that route it stays null and the invite page falls
  // back to the fixture demo, so nothing else is affected.
  const [reviewToken, setReviewToken] = React.useState(first.token || null);
  const [currency, setCurrency] = React.useState("USD");
  const [step, setStep] = React.useState(1);
  const [view, setView] = React.useState("results");
  // Which tour slug is hydrated and ready to render. null while a live per-slug
  // fetch is in flight, which gates the tour body behind a loader below.
  const [ready, setReady] = React.useState(() => (tourNeedsHydration(first.slug) ? null : first.slug));
  // Which post slug's body is loaded and ready to render (null while a live
  // per-slug fetch is in flight, which gates the article behind a loader below).
  const [postReady, setPostReady] = React.useState(() => (first.screen === "post" && postNeedsHydration(first.slug) ? null : first.slug));
  const go = (s, payload) => {
    // Tour nav carries a slug only in live mode; flag off drops it, so the URL
    // stays /tour and TourWeb falls back to tours[0] (byte-identical prototype).
    const tourSlug = s === "tour" ? (LIVE_API() ? payload || null : null) : null;
    // Browse nav carries an optional region name to pre-apply as a filter (TRI-940).
    const region = s === "browse" ? (payload || null) : null;
    // Booking detail carries the booking ref as its slug (TRI-938).
    const nextSlug = s === "post" ? payload : s === "tour" ? tourSlug : s === "booking" ? (payload || null) : slug;
    if (s === "post") setSlug(payload);
    else if (s === "tour") setSlug(tourSlug);
    else if (s === "booking") setSlug(payload || null);
    if (s === "browse") setBrowseRegion(region);
    setScreen(s === "post" ? "post" : s);
    let url = pathForScreen(s, nextSlug);
    if (s === "browse" && region) url += "?region=" + encodeURIComponent(region);
    if (url !== window.location.pathname + window.location.search) window.history.pushState({ screen: s, slug: nextSlug, region }, "", url);
    window.scrollTo({ top: 0 });
  };
  React.useEffect(() => {
    const onPop = () => {
      const r = routeFromPath(window.location.pathname, window.location.search);
      setScreen(r.screen);
      setSlug(r.slug);
      setBrowseRegion(r.region || null);
      setReviewToken(r.token || null);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Keep the document head (title / description / OG / canonical / robots) in
  // sync with the active route so deep links share richly and JS crawlers index
  // each screen (TRI-1114). Re-runs when a tour/post finishes hydrating so
  // late-arriving titles and images are reflected.
  React.useEffect(() => { applyHead(screen, slug); }, [screen, slug, ready, postReady]);
  // Lazily hydrate any tour whose slug-routed page opens (nav, deep-link or
  // back/forward). The lead tour is pre-hydrated at boot, so it resolves instantly.
  React.useEffect(() => {
    if (screen !== "tour") return;
    if (!tourNeedsHydration(slug)) { setReady(slug); return; }
    let cancelled = false;
    setReady(null);
    window.TK_HYDRATE_TOUR(slug).then(
      () => { if (!cancelled) setReady(slug); },
      () => { if (!cancelled) setReady(slug); }
    );
    return () => { cancelled = true; };
  }, [screen, slug]);
  // Lazily hydrate a blog post's body when its page opens (TRI-917). Mirrors the
  // tour effect: the article renders from fixtures (flag off) or after the body
  // fetch resolves (flag on). Failures still resolve so the fallback card shows.
  React.useEffect(() => {
    if (screen !== "post") return;
    if (!postNeedsHydration(slug)) { setPostReady(slug); return; }
    let cancelled = false;
    setPostReady(null);
    window.TK_HYDRATE_POST(slug).then(
      () => { if (!cancelled) setPostReady(slug); },
      () => { if (!cancelled) setPostReady(slug); }
    );
    return () => { cancelled = true; };
  }, [screen, slug]);
  const tourBody =
    screen === "tour" && LIVE_API() && slug && ready !== slug ? (
      <TourDetailLoading />
    ) : (
      <TourWeb go={go} currency={currency} slug={slug} />
    );
  const body = {
    home: <HomeWeb go={go} />,
    browse: <BrowseWeb go={go} currency={currency} view={view} initialRegion={browseRegion} />,
    tour: tourBody,
    checkout: <CheckoutWeb go={go} step={step} setStep={setStep} currency={currency} />,
    confirm: <ConfirmWeb go={go} currency={currency} />,
    bookings: <BookingsWeb go={go} currency={currency} />,
    booking: <BookingDetailWeb go={go} currency={currency} bref={slug} />,
    reviews: <ReviewsWeb go={go} />,
    login: <LoginWeb go={go} />,
    signup: <LoginWeb go={go} startCreating />,
    forgot: <ForgotWeb go={go} />,
    verify: <VerifyEmailPage go={go} />,
    profile: <ProfileWeb go={go} />,
    notifications: <NotificationsWeb go={go} />,
    "account-settings": <AccountSettingsWeb go={go} />,
    regions: <RegionsPage go={go} />,
    marketplace: <MarketplacePage go={go} />,
    esim: <EsimPage go={go} />,
    pickup: <PickupPage go={go} />,
    club: <ClubPage go={go} />,
    about: <AboutPage go={go} />,
    contact: <ContactPage go={go} />,
    blog: <BlogIndex go={go} />,
    post: (LIVE_API() && slug && postReady !== slug) ? <TourDetailLoading label="Loading story…" /> : <BlogPost go={go} slug={slug} />,
    review: <ReviewInvitePage go={go} token={reviewToken} />,
    notfound: <NotFoundWeb go={go} />,
  }[screen] || <NotFoundWeb go={go} />;

  const AUTH = screen === "login" || screen === "signup" || screen === "forgot" || screen === "verify";
  return AUTH ? body : <Shell currency={currency} setCurrency={setCurrency} go={go} screen={screen}>{body}</Shell>;
}

// Render through the boot gate (TRI-861): with USE_LIVE_API off it renders
// immediately from fixtures; with it on, tk-boot hydrates the read screens from
// the live /api endpoints first. The `|| (fn => fn())` fallback keeps the DS
// browser-preview (which doesn't load the shim) rendering as before.
(window.TK_BOOT || ((fn) => fn()))(() =>
  ReactDOM.createRoot(document.getElementById("root")).render(<WebApp />)
);
