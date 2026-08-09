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

// Screens an Operator may not see (finance + org admin). Audit log is settings-
// tier on the backend (perm settings.manage), so it stays admin-only too.
const ADMIN_ONLY = ["payments", "users", "settings", "audit"];
const USERS = {
  admin: { name: "Kwame B.", role: "Admin", initials: "KB", email: "kwame@tripkoach.com", greet: "Kwame" },
  operator: { name: "Kofi A.", role: "Operator", initials: "KA", email: "kofi@tripkoach.com", greet: "Kofi" },
};
function navGroups(role) {
  const groups = [
    { items: [{ id: "dashboard", label: "Dashboard", icon: "house" }] },
    { label: "Operations", items: [
      // TRI-978 #2: the badge was a hardcoded stub (always "5"), contradicting the
      // dashboard's real "Pending confirmation" figure. Drive it off the real,
      // hydrated bookings so it matches — pending = awaiting confirmation.
      { id: "bookings", label: "Bookings", icon: "ticket", badge: ((window.TK_ADMIN && window.TK_ADMIN.bookings) || []).filter(function (b) { return b.status === "pending"; }).length || undefined },
      { id: "departures", label: "Departures", icon: "calendar-days" },
      { id: "customers", label: "Customers", icon: "users" },
      { id: "guides", label: "Guides", icon: "user" },
      { id: "reviews", label: "Reviews", icon: "star", badge: (window.TK_REVIEWS || []).filter(function (r) { return r.status === "pending"; }).length || undefined },
      { id: "payments", label: "Payments", icon: "wallet" },
    ] },
    { label: "Catalogue", items: [
      { id: "tours", label: "Tours", icon: "compass" },
      { id: "blog", label: "Blog", icon: "pencil" },
      { id: "promos", label: "Promo codes", icon: "badge-percent" },
    ] },
    { label: "Admin", items: [
      { id: "users", label: "Staff & roles", icon: "shield-check" },
      // Audit log (A16) is a live-only read screen; gating the nav entry behind
      // the live flag keeps the fixture/prototype build byte-identical.
      ...((window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API) ? [{ id: "audit", label: "Audit log", icon: "clock" }] : []),
      { id: "settings", label: "Settings", icon: "settings" },
    ] },
  ];
  if (role === "operator") {
    return groups.map(g => ({ ...g, items: g.items.filter(it => !ADMIN_ONLY.includes(it.id)) })).filter(g => g.items.length);
  }
  return groups;
}

// TRI-978 #4: build the top-right notifications feed from real hydrated data.
// Categories mirror what an operator actually needs to see; each row deep-links
// to the relevant screen. Returns [] when nothing needs attention.
function buildNotifications(role, go) {
  const A = window.TK_ADMIN || {};
  const out = [];
  // Bookings awaiting confirmation (held, payment pending).
  (A.bookings || []).filter((b) => b.status === "pending").slice(0, 6).forEach((b) => {
    out.push({ icon: "ticket", tone: "pending", text: "Booking " + b.ref + " awaiting confirmation — " + b.tour, time: b.created || "", onClick: () => go("bookings", b.ref) });
  });
  // Failed payments — skip cancelled bookings (moot) and dedupe by reference.
  const cancelled = new Set((A.bookings || []).filter((b) => b.status === "cancelled").map((b) => b.ref));
  const seen = {};
  (A.payments || []).filter((p) => p.status === "failed").forEach((p) => {
    if (!p.ref || seen[p.ref] || cancelled.has(p.ref)) return;
    seen[p.ref] = 1;
    out.push({ icon: "triangle-alert", tone: "failed", text: "Payment failed on " + p.ref, time: "", onClick: () => go("bookings", p.ref) });
  });
  // Nearly-full scheduled departures (>=90% booked).
  (A.departures || []).filter((d) => d.status === "scheduled").forEach((d) => {
    const cap = Number(d.capacity || 0);
    const left = d.spotsLeft != null ? Number(d.spotsLeft) : NaN;
    if (!cap || isNaN(left)) return;
    const pct = Math.round((1 - left / cap) * 100);
    if (pct >= 90) out.push({ icon: "calendar-days", tone: "warning", text: (d.tour || "Departure") + " on " + (d.date || "") + " is " + pct + "% full", time: "", onClick: () => go("departures") });
  });
  return out.slice(0, 12);
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
  blog: { title: "Blog", sub: "Guides and field notes for the journal" },
  promos: { title: "Promo codes", sub: "Discounts and their usage" },
  users: { title: "Staff & roles", sub: "Who can do what in the console" },
  audit: { title: "Audit log", sub: "Every action taken in the console" },
  settings: { title: "Settings", sub: "Shared by the website and the app" },
  "admin-profile": { title: "Your profile", sub: "Your staff account" },
  "admin-prefs": { title: "Preferences", sub: "How the console works for you" },
};

const AUTH_SCREENS = ["login", "mfa", "mfa-enroll", "reset", "expired"];

// --- Real URL routing (History API, hashless) ------------------------------
// The console home is the dashboard (/). Auth screens live at their own paths;
// with no auth backend wired (fixtures only) they are reached explicitly, e.g.
// on sign-out. Tour editing is dynamic: /tours/:id (id = "new" or a tour id).
// admin.dev.tripkoach.com serves index.html for any path (SPA fallback) and
// <base href="/"> keeps asset URLs absolute regardless of route depth.
const ADMIN_ROUTES = [
  ["dashboard", "/"], ["bookings", "/bookings"], ["departures", "/departures"],
  ["customers", "/customers"], ["guides", "/guides"], ["reviews", "/reviews"],
  ["payments", "/payments"], ["tours", "/tours"], ["blog", "/blog"], ["promos", "/promos"],
  ["users", "/staff"], ["audit", "/audit-log"], ["settings", "/settings"], ["admin-profile", "/profile"],
  ["admin-prefs", "/preferences"], ["login", "/login"], ["mfa", "/mfa"], ["mfa-enroll", "/mfa-enroll"],
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

// Live-API auth gate (TRI-870). Flag off → LIVE is false and everything below
// collapses to the fixture/demo prototype (byte-identical). Flag on → the boot
// gate (tk-boot.js) has already resolved the staff session before first render:
// TK_ADMIN_SESSION is either the session or {unauthenticated:true}.
const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
function tkSession() { return window.TK_ADMIN_SESSION; }
function tkAuthed() { const s = tkSession(); return !LIVE || (s && !s.unauthenticated); }

function AdminApp() {
  const first = adminRouteFromPath(window.location.pathname);
  // When live and not signed in, start on the login screen regardless of URL.
  const initialScreen = (LIVE && !tkAuthed()) ? "login" : first.screen;
  const [screen, setScreen] = React.useState(initialScreen);
  const [editId, setEditId] = React.useState(first.editId);
  const [detailRef, setDetailRef] = React.useState(null);
  const [demo, setDemo] = React.useState({}); // per-screen view toggles
  // TRI-980: whole-console reactive binding. Screens read mutable module globals
  // (window.TK_ADMIN.*, window.TK_REVIEWS) that mutations update in place; those
  // in-place edits don't trigger React on their own. TK_ADMIN_ACT broadcasts
  // "tk-admin-mutated" after every successful write, so bumping this counter here
  // re-renders the whole tree and every mounted screen re-reads its global live —
  // no manual refresh, and it covers the entire family of admin mutations at once.
  const [, bumpDataRev] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const onMutated = () => bumpDataRev();
    window.addEventListener("tk-admin-mutated", onMutated);
    return () => window.removeEventListener("tk-admin-mutated", onMutated);
  }, []);
  // Role/user come from the live session when signed in; otherwise the demo/
  // fixture identity (unchanged prototype behaviour).
  const session = tkSession();
  const liveAuthed = LIVE && session && !session.unauthenticated;
  const role = liveAuthed ? (session.role || "admin") : (demo.role || "admin");
  const user = liveAuthed
    ? (function () {
        const s = session.staff || {};
        const name = s.name || "Staff";
        return { name, role: (role.charAt(0).toUpperCase() + role.slice(1)), initials: s.initials || name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase(), email: s.email || "", greet: (name.split(/\s+/)[0]) };
      })()
    // TRI-952: never show the seeded "Kwame" demo identity in a live console. When
    // live-but-unauthenticated the app already forces the /login screen (no shell),
    // so this neutral identity is only a belt-and-suspenders guard; the Kwame
    // fixture is reserved for the flag-off DS prototype.
    : (LIVE ? { name: "TripKoach staff", role: (role.charAt(0).toUpperCase() + role.slice(1)), initials: "TK", email: "", greet: "there" } : (USERS[role] || USERS.admin));
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
  // A mid-session 401 (session expired/revoked) from any write → land on the
  // session-expired screen (which routes back to /login). Live only.
  React.useEffect(() => {
    if (!LIVE) return;
    const on401 = () => { window.TK_ADMIN_SESSION = { unauthenticated: true }; go("expired"); };
    window.addEventListener("tk-admin-401", on401);
    return () => window.removeEventListener("tk-admin-401", on401);
  }, []);
  // Sign out: revoke the server session when live, then return to /login.
  const signOut = () => {
    if (LIVE && window.TK_ADMIN_API) {
      window.TK_ADMIN_API.logout().catch(() => {}).then(() => { window.TK_ADMIN_SESSION = { unauthenticated: true }; go("login"); });
    } else { go("login"); }
  };

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
  if (screen === "mfa-enroll") return <Frame demo={demo} setDemo={setDemo} screen={screen} go={go}><MfaEnrollGate go={go} state={state} /></Frame>;
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
    : screen === "blog" ? <BlogAdmin go={go} />
    : screen === "promos" ? <PromosAdmin go={go} />
    : screen === "users" ? <UsersAdmin go={go} />
    : screen === "audit" ? <AuditLogAdmin go={go} />
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
    // TRI-982: the Bookings page had TWO Export buttons — this PageHeader one was a
    // dead no-op (no onClick). The real CSV export lives in the Bookings FilterBar
    // (exportBookingsCsv, wired in TRI-968). Removed the duplicate; no header action
    // for bookings now.
    departures: <Button size="sm" iconStart="plus" onClick={() => window.dispatchEvent(new CustomEvent("tk-add-departure"))}>Add departure</Button>,
    guides: <Button size="sm" iconStart="plus" onClick={() => window.dispatchEvent(new CustomEvent("tk-add-guide"))}>Add guide</Button>,
  }[screen];

  // TRI-978 #4: the notifications bell was a hardcoded 3-item fixture (TK-4821 /
  // TK-4610 / Cape Coast — none of which exist). Derive a real "needs attention"
  // feed from the already-hydrated console data (no new backend surface): bookings
  // awaiting confirmation, failed payments on live bookings, and departures that
  // are nearly full. Passing our own non-empty array also prevents the frozen DS
  // TopBar from falling back to its built-in demo notifications when the feed is
  // empty — instead we show an explicit "all caught up" row.
  const notifs = buildNotifications(role, go);
  const notifCount = notifs.length;
  const notifItems = notifCount ? notifs
    : [{ icon: "check", tone: "success", text: "You're all caught up", time: "Nothing needs attention" }];
  return (
    <Frame demo={demo} setDemo={setDemo} screen={screen} go={go}>
      <AppShell groups={navGroups(role)} current={navCurrent} onNavigate={go} notifications={notifCount} notificationItems={notifItems}
        user={user} onSignOut={signOut} onProfile={() => go("admin-profile")} onPreferences={() => go("admin-prefs")} logoSrc="../../assets/logo-badge.png">
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
// Render through the boot gate (TRI-861) — see web/kit/app.jsx. Admin renders
// from fixtures for now; the gate is in place for live read wiring to drop in.
(window.TK_BOOT || ((fn) => fn()))(() =>
  ReactDOM.createRoot(document.getElementById("root")).render(<AdminApp />)
);
