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
  ["confirm", "/confirm"], ["bookings", "/bookings"], ["reviews", "/reviews"],
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
  return PATH_BY_SCREEN[screen] || "/";
}
function routeFromPath(pathname) {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  const m = path.match(/^\/blog\/(.+)$/);
  if (m) return { screen: "post", slug: decodeURIComponent(m[1]) };
  const t = path.match(/^\/tour\/(.+)$/);
  if (t) return { screen: "tour", slug: decodeURIComponent(t[1]) };
  // The emailed password-reset link (Backend TRI-881: APP_BASE_URL/reset-password
  // ?token=…) lands here — reuse the ForgotWeb screen, which reads the token off
  // the URL and opens on its "set a new password" stage.
  if (path === "/reset-password") return { screen: "forgot", slug: null };
  // Tokenized review-invite deep link (TRI-894): the address Backend emails
  // travellers, `{webUrl}/reviews/redeem/:token`. Matched before the exact
  // `/reviews` account route so the sub-path resolves to the invite landing.
  const rv = path.match(/^\/reviews\/redeem\/(.+)$/);
  if (rv) return { screen: "review", slug: null, token: decodeURIComponent(rv[1]) };
  const hit = ROUTES.find(([, p]) => p === path);
  return { screen: hit ? hit[0] : "home", slug: null };
}

// In-page loader shown while a tour detail hydrates from the API (TRI-888). Kept
// dependency-free (no DS namespace in app.jsx) and token-driven so it matches the
// pre-React boot spinner. Only ever rendered in live mode.
function TourDetailLoading() {
  return (
    <div
      className="tk-container"
      style={{ paddingBlock: "var(--space-10) var(--space-12)", maxWidth: 1200, minHeight: "60vh", display: "grid", placeItems: "center" }}
      aria-busy="true"
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)" }}>
        <span className="tk-spin" style={{ width: 34, height: 34, borderRadius: "50%", border: "3px solid var(--border-subtle)", borderTopColor: "var(--brand)", display: "inline-block" }} />
        <p className="tk-body" style={{ margin: 0, color: "var(--text-muted)" }}>Loading tour…</p>
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

function WebApp() {
  const first = routeFromPath(window.location.pathname);
  const [screen, setScreen] = React.useState(first.screen);
  const [slug, setSlug] = React.useState(first.slug);
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
  const go = (s, payload) => {
    // Tour nav carries a slug only in live mode; flag off drops it, so the URL
    // stays /tour and TourWeb falls back to tours[0] (byte-identical prototype).
    const tourSlug = s === "tour" ? (LIVE_API() ? payload || null : null) : null;
    const nextSlug = s === "post" ? payload : s === "tour" ? tourSlug : slug;
    if (s === "post") setSlug(payload);
    else if (s === "tour") setSlug(tourSlug);
    setScreen(s === "post" ? "post" : s);
    const url = pathForScreen(s, nextSlug);
    if (url !== window.location.pathname) window.history.pushState({ screen: s, slug: nextSlug }, "", url);
    window.scrollTo({ top: 0 });
  };
  React.useEffect(() => {
    const onPop = () => {
      const r = routeFromPath(window.location.pathname);
      setScreen(r.screen);
      setSlug(r.slug);
      setReviewToken(r.token || null);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
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
  const tourBody =
    screen === "tour" && LIVE_API() && slug && ready !== slug ? (
      <TourDetailLoading />
    ) : (
      <TourWeb go={go} currency={currency} slug={slug} />
    );
  const body = {
    home: <HomeWeb go={go} />,
    browse: <BrowseWeb go={go} currency={currency} view={view} />,
    tour: tourBody,
    checkout: <CheckoutWeb go={go} step={step} setStep={setStep} currency={currency} />,
    confirm: <ConfirmWeb go={go} currency={currency} />,
    bookings: <BookingsWeb go={go} currency={currency} />,
    reviews: <ReviewsWeb go={go} />,
    login: <LoginWeb go={go} />,
    signup: <LoginWeb go={go} startCreating />,
    forgot: <ForgotWeb go={go} />,
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
    post: <BlogPost go={go} slug={slug} />,
    review: <ReviewInvitePage go={go} token={reviewToken} />,
  }[screen] || <HomeWeb go={go} />;

  const AUTH = screen === "login" || screen === "signup" || screen === "forgot";
  return AUTH ? body : <Shell currency={currency} setCurrency={setCurrency} go={go}>{body}</Shell>;
}

// Render through the boot gate (TRI-861): with USE_LIVE_API off it renders
// immediately from fixtures; with it on, tk-boot hydrates the read screens from
// the live /api endpoints first. The `|| (fn => fn())` fallback keeps the DS
// browser-preview (which doesn't load the shim) rendering as before.
(window.TK_BOOT || ((fn) => fn()))(() =>
  ReactDOM.createRoot(document.getElementById("root")).render(<WebApp />)
);
