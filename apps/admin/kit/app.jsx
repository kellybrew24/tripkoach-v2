const NS = window.TripKoachDesignSystem_c9e4af;
const { AppShell, PageHeader, Button } = NS;

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

// Screens an Operator may not see (finance + org admin).
const ADMIN_ONLY = ["payments", "users", "settings"];
const USERS = {
  admin: { name: "Kwame B.", role: "Admin", initials: "KB", email: "kwame@tripkoach.com", greet: "Kwame" },
  operator: { name: "Kofi A.", role: "Operator", initials: "KA", email: "kofi@tripkoach.com", greet: "Kofi" },
};
function navGroups(role) {
  const groups = [
    { items: [{ id: "dashboard", label: "Dashboard", icon: "house" }] },
    { label: "Operations", items: [
      { id: "bookings", label: "Bookings", icon: "ticket", badge: 5 },
      { id: "departures", label: "Departures", icon: "calendar-days" },
      { id: "customers", label: "Customers", icon: "users" },
      { id: "guides", label: "Guides", icon: "user" },
      { id: "reviews", label: "Reviews", icon: "star", badge: (window.TK_REVIEWS || []).filter(function (r) { return r.status === "pending"; }).length || undefined },
      { id: "payments", label: "Payments", icon: "wallet" },
    ] },
    { label: "Catalogue", items: [
      { id: "tours", label: "Tours", icon: "compass" },
      { id: "promos", label: "Promo codes", icon: "badge-percent" },
    ] },
    { label: "Admin", items: [
      { id: "users", label: "Staff & roles", icon: "shield-check" },
      { id: "settings", label: "Settings", icon: "settings" },
    ] },
  ];
  if (role === "operator") {
    return groups.map(g => ({ ...g, items: g.items.filter(it => !ADMIN_ONLY.includes(it.id)) })).filter(g => g.items.length);
  }
  return groups;
}

const META = {
  dashboard: { title: "Dashboard", sub: "Wednesday 22 August · Good afternoon, Kwame" },
  bookings: { title: "Bookings", sub: "Manage and confirm customer bookings" },
  departures: { title: "Departures & inventory", sub: "Scheduled departures across every tour" },
  customers: { title: "Customers", sub: "Accounts and booking history" },
  guides: { title: "Guides", sub: "The field team who lead your departures" },
  reviews: { title: "Reviews", sub: "Moderate what travellers say before it goes public" },
  payments: { title: "Payments & reconciliation", sub: "Transactions, refunds and what's outstanding" },
  tours: { title: "Tours", sub: "Your published and draft catalogue" },
  "tour-edit": { title: "Edit tour", sub: null },
  promos: { title: "Promo codes", sub: "Discounts and their usage" },
  users: { title: "Staff & roles", sub: "Who can do what in the console" },
  settings: { title: "Settings", sub: "Shared by the website and the app" },
  "admin-profile": { title: "Your profile", sub: "Your staff account" },
  "admin-prefs": { title: "Preferences", sub: "How the console works for you" },
};

const AUTH_SCREENS = ["login", "mfa", "reset", "expired"];

// --- Real URL routing (History API, hashless) ------------------------------
// The console home is the dashboard (/). Auth screens live at their own paths;
// with no auth backend wired (fixtures only) they are reached explicitly, e.g.
// on sign-out. Tour editing is dynamic: /tours/:id (id = "new" or a tour id).
// admin.dev.tripkoach.com serves index.html for any path (SPA fallback) and
// <base href="/"> keeps asset URLs absolute regardless of route depth.
const ADMIN_ROUTES = [
  ["dashboard", "/"], ["bookings", "/bookings"], ["departures", "/departures"],
  ["customers", "/customers"], ["guides", "/guides"], ["reviews", "/reviews"],
  ["payments", "/payments"], ["tours", "/tours"], ["promos", "/promos"],
  ["users", "/staff"], ["settings", "/settings"], ["admin-profile", "/profile"],
  ["admin-prefs", "/preferences"], ["login", "/login"], ["mfa", "/mfa"],
  ["reset", "/reset"], ["expired", "/expired"], ["forbidden", "/403"],
];
const ADMIN_PATH_BY_SCREEN = Object.fromEntries(ADMIN_ROUTES.map(([s, p]) => [s, p]));
function adminPathForScreen(screen, editId) {
  if (screen === "tour-edit") return "/tours/" + encodeURIComponent(editId || "new");
  return ADMIN_PATH_BY_SCREEN[screen] || "/";
}
function adminRouteFromPath(pathname) {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/") return { screen: "dashboard", editId: null };
  const te = path.match(/^\/tours\/(.+)$/);
  if (te) return { screen: "tour-edit", editId: decodeURIComponent(te[1]) };
  const hit = ADMIN_ROUTES.find(([, p]) => p === path);
  return { screen: hit ? hit[0] : "dashboard", editId: null };
}

function AdminApp() {
  const first = adminRouteFromPath(window.location.pathname);
  const [screen, setScreen] = React.useState(first.screen);
  const [editId, setEditId] = React.useState(first.editId);
  const [detailRef, setDetailRef] = React.useState(null);
  const [demo, setDemo] = React.useState({}); // per-screen view toggles
  const role = demo.role || "admin";
  const user = USERS[role];
  const go = (s, payload) => {
    const nextEditId = (s === "tour-edit" || s === "departures") ? (payload || null) : editId;
    if (s === "tour-edit" || s === "departures") setEditId(payload || null);
    if (s === "bookings" || s === "customers") setDetailRef(payload || null);
    setScreen(s);
    const url = adminPathForScreen(s, s === "tour-edit" ? payload : nextEditId);
    if (url !== window.location.pathname) window.history.pushState({ screen: s, payload }, "", url);
    window.scrollTo({ top: 0 });
  };
  React.useEffect(() => {
    const onPop = () => {
      const r = adminRouteFromPath(window.location.pathname);
      setScreen(r.screen);
      setEditId(r.editId);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Accessibility enhancement layer. Applied to the DS components' RENDERED
  // OUTPUT only — design-system/ source stays byte-for-byte pristine. These are
  // additive ARIA annotations (never restyle): the AppShell renders its content
  // region as a plain <div class="tk-shell__main"> (no main landmark); card
  // section titles use <h3 class="tk-h5"> directly under the page <h1> (skips
  // h2); and collapsed icon-rail nav buttons hide their text label (no
  // accessible name). We annotate after every commit so it survives re-renders
  // and route changes. Residual DS gaps (e.g. --text-subtle chart-label
  // contrast) are tracked upstream against tripv2-DS.
  React.useEffect(() => {
    const main = document.querySelector(".tk-shell__main");
    if (main && !main.getAttribute("role")) main.setAttribute("role", "main");
    document.querySelectorAll(".tk-shell__main h3.tk-h5").forEach((h) => {
      if (h.getAttribute("aria-level") !== "2") { h.setAttribute("role", "heading"); h.setAttribute("aria-level", "2"); }
    });
    document.querySelectorAll(".tk-navitem").forEach((b) => {
      // Use the button's full visible text (label + any badge, e.g. "Bookings 5")
      // so the accessible name still contains the visible label when the icon
      // rail hides it — and never mismatches it.
      const name = b.textContent.replace(/\s+/g, " ").trim();
      if (name && !b.getAttribute("aria-label")) b.setAttribute("aria-label", name);
    });
  });
  const state = { ...demo, editId, detailRef,
    authView: demo.authView, dashView: demo.dashView, bookingsView: demo.bookingsView };
  const setState = (p) => {
    if ("detailRef" in p) setDetailRef(p.detailRef);
    if ("editId" in p) setEditId(p.editId);
    setDemo(d => ({ ...d, ...p }));
  };

  // Auth screens render full-bleed (no shell)
  if (screen === "login") return <Frame demo={demo} setDemo={setDemo} screen={screen} go={go}><AdminLogin go={go} state={state} /></Frame>;
  if (screen === "mfa") return <Frame demo={demo} setDemo={setDemo} screen={screen} go={go}><MfaChallenge go={go} state={state} /></Frame>;
  if (screen === "reset") return <Frame demo={demo} setDemo={setDemo} screen={screen} go={go}><ResetPassword go={go} /></Frame>;
  if (screen === "expired") return <Frame demo={demo} setDemo={setDemo} screen={screen} go={go}><SessionExpired go={go} /></Frame>;

  const meta = { ...(META[screen] || { title: screen }) };
  if (screen === "dashboard") meta.sub = "Wednesday 22 August · Good afternoon, " + user.greet;
  // Operators can't reach finance/org-admin screens
  const blocked = role === "operator" && ADMIN_ONLY.includes(screen);
  const forbidden = screen === "forbidden" || blocked;
  const body =
    forbidden ? <Forbidden go={go} />
    : screen === "dashboard" ? <Dashboard go={go} state={state} role={role} />
    : screen === "bookings" ? <BookingsAdmin go={go} state={state} setState={setState} />
    : screen === "departures" ? <DeparturesAdmin go={go} state={state} setState={setState} />
    : screen === "customers" ? <CustomersAdmin go={go} state={state} setState={setState} />
    : screen === "guides" ? <GuidesAdmin go={go} />
    : screen === "reviews" ? <ReviewsAdmin go={go} />
    : screen === "payments" ? <PaymentsAdmin go={go} state={state} />
    : screen === "tours" ? <ToursAdmin go={go} state={state} setState={setState} />
    : screen === "tour-edit" ? <TourEdit go={go} state={state} />
    : screen === "promos" ? <PromosAdmin go={go} />
    : screen === "users" ? <UsersAdmin go={go} />
    : screen === "settings" ? <SettingsAdmin go={go} />
    : screen === "admin-profile" ? <AccountProfileAdmin go={go} user={user} />
    : screen === "admin-prefs" ? <PreferencesAdmin go={go} />
    : <Dashboard go={go} state={state} role={role} />;

  const navCurrent = { "tour-edit": "tours" }[screen] || screen;
  const crumbs = screen === "tour-edit"
    ? [{ label: "Tours", onClick: () => go("tours") }, { label: editId === "new" ? "New tour" : "Edit" }]
    : [];
  const actions = {
    tours: <Button size="sm" iconStart="plus" onClick={() => go("tour-edit", "new")}>Create tour</Button>,
    bookings: <Button size="sm" variant="secondary" iconStart="download">Export</Button>,
    departures: <Button size="sm" iconStart="plus" onClick={() => window.dispatchEvent(new CustomEvent("tk-add-departure"))}>Add departure</Button>,
    guides: <Button size="sm" iconStart="plus" onClick={() => window.dispatchEvent(new CustomEvent("tk-add-guide"))}>Add guide</Button>,
  }[screen];

  const notifs = [
    { icon: "ticket", tone: "pending", text: "New booking TK-4821 — Accra City Tour", time: "2 min ago", onClick: () => go("bookings", "TK-4821") },
    { icon: "triangle-alert", tone: "failed", text: "Payment failed on TK-4610", time: "1 hr ago", onClick: () => go(role === "operator" ? "bookings" : "payments", "TK-4610") },
    { icon: "calendar-days", tone: "warning", text: "Cape Coast departure is 90% full", time: "3 hr ago", onClick: () => go("departures") },
  ];
  return (
    <Frame demo={demo} setDemo={setDemo} screen={screen} go={go}>
      <AppShell groups={navGroups(role)} current={navCurrent} onNavigate={go} notifications={3} notificationItems={notifs}
        user={user} onSignOut={() => go("login")} onProfile={() => go("admin-profile")} onPreferences={() => go("admin-prefs")} logoSrc="../../assets/logo-badge.png">
        <PageHeader title={meta.title} subtitle={forbidden ? null : meta.sub} breadcrumbs={crumbs} actions={forbidden ? null : actions} />
        {body}
      </AppShell>
    </Frame>
  );
}

/* App frame. The prototype's demo control bar (screen switcher + role/view
   toggles) has been removed for production — navigation is real URL routing
   and screens render their real (loaded, non-error) state by default. */
function Frame({ children }) {
  return <>{children}</>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<AdminApp />);
