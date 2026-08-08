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
  ["login", "/login"], ["forgot", "/forgot"], ["profile", "/profile"],
  ["notifications", "/notifications"], ["account-settings", "/account/settings"],
  ["regions", "/regions"], ["marketplace", "/shop"], ["esim", "/esim"],
  ["pickup", "/pickup"], ["club", "/club"], ["about", "/about"],
  ["contact", "/contact"], ["blog", "/blog"], ["review", "/review"],
];
const PATH_BY_SCREEN = Object.fromEntries(ROUTES.map(([s, p]) => [s, p]));
function pathForScreen(screen, slug) {
  if (screen === "post") return "/blog/" + encodeURIComponent(slug || "");
  return PATH_BY_SCREEN[screen] || "/";
}
function routeFromPath(pathname) {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  const m = path.match(/^\/blog\/(.+)$/);
  if (m) return { screen: "post", slug: decodeURIComponent(m[1]) };
  const hit = ROUTES.find(([, p]) => p === path);
  return { screen: hit ? hit[0] : "home", slug: null };
}

function WebApp() {
  const first = routeFromPath(window.location.pathname);
  const [screen, setScreen] = React.useState(first.screen);
  const [slug, setSlug] = React.useState(first.slug);
  const [currency, setCurrency] = React.useState("USD");
  const [step, setStep] = React.useState(1);
  const [view, setView] = React.useState("results");
  const go = (s, payload) => {
    const nextSlug = s === "post" ? payload : slug;
    if (s === "post") setSlug(payload);
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
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const body = {
    home: <HomeWeb go={go} />,
    browse: <BrowseWeb go={go} currency={currency} view={view} />,
    tour: <TourWeb go={go} currency={currency} />,
    checkout: <CheckoutWeb go={go} step={step} setStep={setStep} currency={currency} />,
    confirm: <ConfirmWeb go={go} currency={currency} />,
    bookings: <BookingsWeb go={go} currency={currency} />,
    reviews: <ReviewsWeb go={go} />,
    login: <LoginWeb go={go} />,
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
    review: <ReviewInvitePage go={go} />,
  }[screen] || <HomeWeb go={go} />;

  const AUTH = screen === "login" || screen === "forgot";
  return AUTH ? body : <Shell currency={currency} setCurrency={setCurrency} go={go}>{body}</Shell>;
}

// Render through the boot gate (TRI-861): with USE_LIVE_API off it renders
// immediately from fixtures; with it on, tk-boot hydrates the read screens from
// the live /api endpoints first. The `|| (fn => fn())` fallback keeps the DS
// browser-preview (which doesn't load the shim) rendering as before.
(window.TK_BOOT || ((fn) => fn()))(() =>
  ReactDOM.createRoot(document.getElementById("root")).render(<WebApp />)
);
