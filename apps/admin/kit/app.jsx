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

function AdminApp() {
  const [screen, setScreen] = React.useState("login");
  const [editId, setEditId] = React.useState(null);
  const [detailRef, setDetailRef] = React.useState(null);
  const [demo, setDemo] = React.useState({}); // per-screen view toggles
  const role = demo.role || "admin";
  const user = USERS[role];
  const go = (s, payload) => {
    if (s === "tour-edit" || s === "departures") setEditId(payload || null);
    if (s === "bookings" || s === "customers") setDetailRef(payload || null);
    if (AUTH_SCREENS.includes(s) || s === "dashboard") { setScreen(s); window.scrollTo({ top: 0 }); return; }
    setScreen(s); window.scrollTo({ top: 0 });
  };
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

/* Demo control bar — not part of the product */
function Frame({ children, demo, setDemo, screen, go }) {
  const set = (k, v) => setDemo(d => ({ ...d, [k]: d[k] === v ? undefined : v }));
  const chip = (label, active, onClick) => (
    <button type="button" onClick={onClick} className="tk-chip" style={{ flex: "none", minHeight: 30, fontSize: 12, background: active ? "var(--gold-300)" : "transparent", color: active ? "var(--n-950)" : "var(--n-100)", borderColor: active ? "var(--gold-300)" : "rgba(255,255,255,.3)" }}>{label}</button>
  );
  const NAV = [["login", "Login"], ["mfa", "MFA"], ["reset", "Reset"], ["expired", "Expired"], ["dashboard", "Dashboard"], ["bookings", "Bookings"], ["departures", "Departures"], ["tours", "Tours"], ["tour-edit", "Tour edit"], ["customers", "Customers"], ["guides", "Guides"], ["reviews", "Reviews"], ["payments", "Payments"], ["promos", "Promos"], ["users", "Staff & roles"], ["settings", "Settings"], ["admin-profile", "My profile"], ["admin-prefs", "Preferences"], ["forbidden", "403"]];
  return (
    <>
      <div style={{ position: "fixed", insetInline: 0, bottom: 0, zIndex: 950, display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "var(--bg-inverse)", overflowX: "auto", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--n-500)", flex: "none", paddingRight: 2 }}>Admin</span>
        {NAV.map(([id, l]) => <React.Fragment key={id}>{chip(l, screen === id, () => go(id === "tour-edit" ? "tour-edit" : id, id === "tour-edit" ? "accra-city-tour" : undefined))}</React.Fragment>)}
        <span style={{ width: 1, height: 20, background: "rgba(255,255,255,.2)", flex: "none", margin: "0 4px" }} />
        {!AUTH_SCREENS.includes(screen) && <><span className="tk-caption" style={{ color: "var(--n-500)", flex: "none" }}>Role</span>{chip("Admin (CEO)", (demo.role || "admin") === "admin", () => setDemo(d => ({ ...d, role: "admin" })))}{chip("Operator", demo.role === "operator", () => setDemo(d => ({ ...d, role: "operator" })))}<span style={{ width: 1, height: 20, background: "rgba(255,255,255,.2)", flex: "none", margin: "0 4px" }} /></>}
        {screen === "login" && <>{chip("error", demo.authView === "error", () => set("authView", "error"))}{chip("locked", demo.authView === "locked", () => set("authView", "locked"))}</>}
        {screen === "mfa" && chip("bad code", demo.authView === "mfa-error", () => set("authView", "mfa-error"))}
        {screen === "dashboard" && <>{chip("loading", demo.dashView === "loading", () => set("dashView", "loading"))}{chip("empty", demo.dashView === "empty", () => set("dashView", "empty"))}</>}
        {screen === "bookings" && chip("loading", demo.bookingsView === "loading", () => set("bookingsView", "loading"))}
      </div>
      {children}
    </>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<AdminApp />);
