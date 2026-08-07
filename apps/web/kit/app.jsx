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

function WebApp() {
  const [screen, setScreen] = React.useState("home");
  const [slug, setSlug] = React.useState(null);
  const [currency, setCurrency] = React.useState("USD");
  const [step, setStep] = React.useState(1);
  const [view, setView] = React.useState("results");
  const go = (s, payload) => {
    if (s === "post" && payload) setSlug(payload);
    setScreen(s === "post" ? "post" : s);
    window.scrollTo({ top: 0 });
  };
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

  const TABS = [
    ["home", "Home"], ["browse", "Browse"], ["tour", "Tour"], ["checkout", "Checkout"], ["confirm", "Confirm"],
    ["bookings", "Bookings"], ["reviews", "My reviews"], ["login", "Sign in"], ["forgot", "Forgot pw"], ["profile", "Profile"], ["notifications", "Notifications"], ["account-settings", "Acct settings"], ["regions", "Regions"], ["esim", "eSIM"], ["pickup", "Pickup"],
    ["about", "About"], ["contact", "Contact"], ["blog", "Blog"], ["marketplace", "Shop"], ["club", "Club"], ["review", "Review invite"],
  ];

  const AUTH = screen === "login" || screen === "forgot";
  return (
    <>
      <div style={{ position: "fixed", insetInline: 0, bottom: 0, zIndex: 900, display: "flex", justifyContent: "flex-start", gap: 6, alignItems: "center",
        padding: "10px 12px", background: "var(--bg-inverse)", overflowX: "auto", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--n-500)", flex: "none", paddingRight: 4 }}>Screens</span>
        {TABS.map(([id, l]) => (
          <button key={id} type="button" onClick={() => go(id)} className="tk-chip"
            style={{ flex: "none", minHeight: 32, fontSize: 12, background: screen === id ? "var(--gold-300)" : "transparent",
              color: screen === id ? "var(--n-950)" : "var(--n-100)", borderColor: screen === id ? "var(--gold-300)" : "rgba(255,255,255,.3)" }}>{l}</button>
        ))}
        {screen === "browse" && ["results", "loading", "empty"].map(v => (
          <button key={v} type="button" onClick={() => setView(v)} className="tk-chip"
            style={{ flex: "none", minHeight: 32, fontSize: 12, background: "transparent", color: view === v ? "var(--gold-300)" : "var(--n-400)", borderColor: "rgba(255,255,255,.2)" }}>{v}</button>
        ))}
        {screen === "checkout" && [0,1,2,3].map(s => (
          <button key={s} type="button" onClick={() => setStep(s)} className="tk-chip"
            style={{ flex: "none", minHeight: 32, fontSize: 12, background: "transparent", color: step === s ? "var(--gold-300)" : "var(--n-400)", borderColor: "rgba(255,255,255,.2)" }}>Step {s + 1}</button>
        ))}
      </div>
      {AUTH ? body : <Shell currency={currency} setCurrency={setCurrency} go={go}>{body}</Shell>}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<WebApp />);
