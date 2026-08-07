const NS = window.TripKoachDesignSystem_c9e4af;
const { Header, BottomNav, Button, Icon } = NS;

window.tkToast = (msg) => {
  let host = document.getElementById("tk-toast-host");
  if (!host) { host = document.createElement("div"); host.id = "tk-toast-host"; host.style.cssText = "position:fixed;left:0;right:0;bottom:96px;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:1000;pointer-events:none"; document.body.appendChild(host); }
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "pointer-events:auto;background:#1E1C1A;color:#fff;padding:11px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.28);font-size:13.5px;font-weight:600;max-width:80%;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s";
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "none"; });
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; setTimeout(() => el.remove(), 250); }, 2600);
};

const SCREENS = [
  { id: "browse", label: "Browse", note: "catalogue, filters" },
  { id: "tour", label: "Tour detail", note: "departures, sticky CTA" },
  { id: "gate", label: "Sign in to book", note: "interstitial" },
  { id: "login", label: "Log in", note: "error state" },
  { id: "signup", label: "Sign up", note: "validation" },
  { id: "profile", label: "Complete profile", note: "" },
  { id: "checkout", label: "Checkout wizard", note: "5 steps" },
  { id: "bookings", label: "My bookings", note: "list + tabs" },
  { id: "booking", label: "Booking detail", note: "cancel flow" },
  { id: "account", label: "Account", note: "dashboard" },
  { id: "error", label: "Error / offline", note: "404, offline" },
];

function App() {
  const [screen, setScreen] = React.useState("browse");
  const [state, setState] = React.useState({ currency: "USD", tour: window.TK_DATA.tours[0] });
  const patch = (p) => setState(s => ({ ...s, ...p }));
  const go = (next, p) => { if (p) patch(p); setScreen(next); };

  const props = { go, state, setState: patch };
  const body = {
    browse: <BrowseScreen {...props} />,
    tour: <TourDetailScreen {...props} />,
    gate: <AuthGate {...props} />,
    login: <LoginScreen {...props} />,
    signup: <SignupScreen {...props} />,
    profile: <ProfileScreen {...props} />,
    checkout: <CheckoutScreen {...props} key={state.departure} />,
    bookings: <BookingsScreen {...props} />,
    booking: <BookingDetailScreen {...props} />,
    account: <AccountScreen {...props} />,
    error: <ErrorScreen {...props} kind={state.errorKind || "offline"} />,
  }[screen];

  const chromeless = ["gate", "login", "signup", "profile", "checkout"].includes(screen);
  const navFor = { bookings: "bookings", booking: "bookings", account: "account" }[screen] || "explore";

  return (
    <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
      <AndroidDevice width={390} height={780}>
        <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "var(--bg-page)" }}>
          {!chromeless && (
            <Header compact signedIn logoSrc="../../assets/logo-badge.png" onMenu={() => go("account")} />
          )}
          {chromeless && (
            <div style={{ padding: "10px var(--space-4) 0" }}>
              <Button variant="ghost" size="sm" iconStart="arrow-left" style={{ paddingInline: 0 }}
                onClick={() => go(screen === "checkout" ? "tour" : "gate")}>Back</Button>
            </div>
          )}
          <div style={{ flex: 1 }}>{body}</div>
          {!chromeless && (
            <BottomNav current={navFor} onSelect={(id) => go(id === "explore" ? "browse" : id)}
              items={[{ id: "explore", label: "Explore", icon: "compass" },
                      { id: "bookings", label: "Bookings", icon: "ticket" },
                      { id: "account", label: "Account", icon: "user" }]} />
          )}
        </div>
      </AndroidDevice>

      <div style={{ width: 232, display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="tk-overline">Screens</p>
        <div style={{ display: "grid", gap: 4 }}>
          {SCREENS.map(s => (
            <button key={s.id} type="button" onClick={() => go(s.id)}
              style={{ textAlign: "start", padding: "8px 10px", minHeight: 40, borderRadius: "var(--radius-sm)", cursor: "pointer",
                border: "1px solid " + (screen === s.id ? "var(--brand-ink)" : "var(--border-subtle)"),
                background: screen === s.id ? "var(--brand-ink)" : "var(--surface-card)",
                color: screen === s.id ? "var(--text-inverse)" : "var(--text-body)", fontSize: 13, fontWeight: 600 }}>
              {s.label}
              {s.note && <span style={{ display: "block", fontWeight: 400, fontSize: 11, opacity: .7 }}>{s.note}</span>}
            </button>
          ))}
        </div>
        <p className="tk-overline" style={{ marginTop: 8 }}>States</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[["Results", { browseView: "results" }], ["Loading", { browseView: "loading" }], ["No results", { browseView: "empty" }],
            ["Offline banner", { offline: !state.offline }], ["Bookings empty", { bookingsView: state.bookingsView === "empty" ? "list" : "empty" }],
            ["Bookings loading", { bookingsView: state.bookingsView === "loading" ? "list" : "loading" }],
            ["Login error", { authError: !state.authError }], ["404", { errorKind: "404" }], ["Server error", { errorKind: "error" }]]
            .map(([label, p]) => (
              <button key={label} type="button" className="tk-chip" onClick={() => patch(p)} style={{ minHeight: 32, fontSize: 12 }}>{label}</button>
            ))}
        </div>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
