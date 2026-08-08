const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Icon, FormField, Input, PhoneInput, PasswordInput, Select, Switch, Checkbox, Textarea, Alert, Badge, Modal, Toast, StatusBadge } = NS;

// TRI-882 — consumer auth live-wiring gate. When window.TK_CONFIG.USE_LIVE_API is
// OFF (the default build and the DS preview) window.TK_AUTH is inert and every
// screen below renders exactly the fixture prototype — no API calls. When ON, the
// auth/profile screens talk to the P1 /api/v1 auth spine (Backend TRI-881) through
// window.TK_AUTH (shim/tk-auth.js), mirroring the TRI-867 booking wiring posture.
const LIVE_AUTH = () => !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API && window.TK_AUTH);
const authVal = (id) => { const el = document.getElementById(id); return el && typeof el.value === "string" ? el.value.trim() : ""; };
const authErrMsg = (e, fallback) => (e && e.message ? e.message : (fallback || "Something went wrong. Please try again."));

// TRI-925 — returning-visitor detection for the login promo panel. We stamp a
// durable, best-effort flag (localStorage first, cookie fallback) the first time a
// visitor successfully authenticates AND whenever /me later resolves to a real
// person (so people who signed in before this feature shipped still count). The
// login panel then shows returning copy ("Welcome back") only to a browser that has
// logged in before, and prospect copy to a genuinely new visitor — independent of
// which auth tab they land on. Privacy modes that throw on storage read as "new".
const TK_RETURNING_KEY = "tk_returning";
function tkIsReturning() {
  try { if (window.localStorage && window.localStorage.getItem(TK_RETURNING_KEY)) return true; } catch (e) {}
  try { if (document.cookie && /(?:^|;\s*)tk_returning=1(?:;|$)/.test(document.cookie)) return true; } catch (e) {}
  return false;
}
function tkMarkReturning() {
  try { if (window.localStorage) window.localStorage.setItem(TK_RETURNING_KEY, "1"); } catch (e) {}
  try { document.cookie = "tk_returning=1; path=/; max-age=31536000; SameSite=Lax"; } catch (e) {}
}

// TRI-923 — the left promo panel used to statically read "Welcome back", which is
// wrong for first-time / prospective customers. It now (1) swaps copy on the auth
// mode — returning ("sign in") vs new ("sign up") — and (2) rotates a small curated
// set of imagery + greeting + scrim by the visitor's LOCAL time-of-day so the panel
// feels alive with zero extra logic and stays deterministic (no per-refresh random).
// All imagery lives on cdn.tripkoach.com (TRI-914/918 hard rule — no dev-hosted or
// base64 heroes); each scrim keeps the bottom heavily darkened so white copy stays
// legible across every image in the set.
const TK_PROMO_BUCKET = (d) => { const h = (d || new Date()).getHours(); return h < 5 ? "night" : h < 11 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night"; };
const TK_PROMO_SET = {
  morning:   { img: "https://cdn.tripkoach.com/img/posts/green-season-ghana-hero.jpg",                greet: "Good morning",   newSub: "Wake to Wli's falls and Kakum at first light — build the trip that's yours." },
  afternoon: { img: "https://cdn.tripkoach.com/img/posts/kakum-canopy-walk-cape-coast-day-trip-hero.jpg", greet: "Good afternoon", newSub: "Canopy walks, castle tours, market afternoons — plan it your way, book it in minutes." },
  evening:   { img: "https://cdn.tripkoach.com/img/posts/mole-larabanga-northern-ghana-weekend-hero.jpg",  greet: "Good evening",   newSub: "Golden-hour safari at Mole, sundowners on the coast — your Ghana, at your pace." },
  night:     { img: "https://cdn.tripkoach.com/img/posts/cape-coast-castles-guide-hero.jpg",          greet: "Good evening",   newSub: "From Cape Coast to the north — start planning tonight, travel on your terms." },
};
const TK_PROMO_SCRIM = {
  morning:   "linear-gradient(175deg, rgba(60,42,15,.14) 0%, rgba(20,19,18,.55) 55%, rgba(15,14,12,.86) 100%)",
  afternoon: "linear-gradient(175deg, rgba(15,30,48,.14) 0%, rgba(20,19,18,.55) 55%, rgba(15,14,12,.86) 100%)",
  evening:   "linear-gradient(165deg, rgba(120,52,12,.30) 0%, rgba(40,20,10,.62) 55%, rgba(18,12,8,.9) 100%)",
  night:     "linear-gradient(165deg, rgba(26,26,72,.42) 0%, rgba(12,14,35,.7) 55%, rgba(6,8,22,.92) 100%)",
};
// mode: "signin" | "signup" (prospect) | "reset" (forgot-password)
// returning: TRI-925 — has this browser signed in before? A first-time visitor who
// lands on the "sign in" tab still gets prospect copy (never a stale "Welcome back").
function PromoPanel({ mode, returning }) {
  const bucket = TK_PROMO_BUCKET();
  const set = TK_PROMO_SET[bucket];
  const isNew = mode === "signup" || (mode === "signin" && !returning);
  const overline = isNew ? "New to TripKoach" : set.greet;
  const heading = isNew ? "Discover Ghana, your way." : "Your trips to Ghana, in one place.";
  const sub = mode === "reset"
    ? "We'll help you back in — resetting your password only takes a moment."
    : (isNew ? set.newSub : "Sign in to see your bookings, manage travellers, and pick up planning where you left off.");
  return (
    <div style={{ position: "relative", overflow: "hidden", background: "var(--n-950)" }}>
      <img src={set.img} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }} />
      <span style={{ position: "absolute", inset: 0, background: TK_PROMO_SCRIM[bucket] }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "48px", color: "var(--n-0)" }}>
        <span className="tk-overline" style={{ color: "var(--gold-400)" }}>{overline}</span>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.02, fontSize: "clamp(28px,3vw,44px)", margin: "10px 0 0", maxWidth: "16ch" }}>{heading}</h2>
        <p style={{ color: "rgba(255,255,255,.82)", marginTop: 12, maxWidth: "42ch" }}>{sub}</p>
      </div>
    </div>
  );
}

const ACCOUNT_NAV = [
  { id: "bookings", icon: "ticket", label: "Bookings" },
  { id: "reviews", icon: "star", label: "Reviews" },
  { id: "profile", icon: "user", label: "Profile" },
  { id: "notifications", icon: "bell", label: "Notifications" },
  { id: "account-settings", icon: "settings", label: "Settings" },
];

function AccountShell({ current, go, title, children }) {
  const [signout, setSignout] = React.useState(false);
  // Live identity (TRI-882): hydrate the signed-in person from /me. Bounce to
  // login if the session is gone (401). Inert + placeholder person when flag off.
  const live = LIVE_AUTH();
  const [me, setMe] = React.useState(live ? window.TK_AUTH.cachedMe() || null : null);
  // TRI-941 — dismissible email-verification nudge (session-scoped) + resend.
  const [nudge, setNudge] = React.useState(true);
  const [nudgeSent, setNudgeSent] = React.useState(false);
  const [nudgeBusy, setNudgeBusy] = React.useState(false);
  const [nudgeErr, setNudgeErr] = React.useState(false);
  React.useEffect(() => {
    if (!live) return;
    let alive = true;
    window.TK_AUTH.me().then(
      (u) => { if (!alive) return; if (!u) { go("login"); return; } setMe(u); tkMarkReturning(); },
      () => {}
    );
    return () => { alive = false; };
  }, []);
  async function resendVerify() {
    if (nudgeBusy) return;
    setNudgeBusy(true); setNudgeErr(false);
    let failed = false;
    // The authed resend returns { deliveryFailed: true } when the provider actually rejected/timed out
    // (TRI-941) — don't claim "sent" when it wasn't. A thrown/rejected request is also a failure.
    try { const r = await window.TK_AUTH.resendVerification(); if (r && r.deliveryFailed) failed = true; }
    catch (_) { failed = true; }
    setNudgeBusy(false);
    if (failed) setNudgeErr(true); else setNudgeSent(true);
  }
  const unverified = live && me && me.emailVerified === false;
  const acctName = live && me ? (me.name || "Traveller") : "Ama Mensah";
  const acctEmail = live && me ? me.email : "ama@example.com";
  const acctInits = live && me ? window.TK_AUTH.initials(me.name, me.email) : "AM";
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-8) var(--space-12)", maxWidth: 1000, display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--space-10)", alignItems: "start" }}>
      <nav aria-label="Account" style={{ display: "flex", flexDirection: "column", gap: 4, position: "sticky", top: "calc(var(--header-h) + 24px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px 14px" }}>
          <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800 }}>{acctInits}</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{acctName}</strong>
            <span className="tk-caption" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{acctEmail}</span>
            {live && me && (
              <span style={{ marginTop: 4 }}>
                {me.emailVerified
                  ? <Badge tone="confirmed"><Icon name="circle-check-big" size={12} style={{ marginInlineEnd: 4 }} />Verified</Badge>
                  : <Badge tone="pending">Unverified</Badge>}
              </span>
            )}
          </span>
        </div>
        {ACCOUNT_NAV.map(n => (
          <button key={n.id} type="button" onClick={() => go(n.id)} className="tk-navlink"
            style={{ justifyContent: "flex-start", gap: 10, minHeight: 44, border: 0, cursor: "pointer", width: "100%", textAlign: "start", background: current === n.id ? "var(--bg-sunken)" : "transparent", fontWeight: current === n.id ? 700 : 500, color: current === n.id ? "var(--text-strong)" : "var(--text-body)" }}
            aria-current={current === n.id ? "page" : undefined}>
            <Icon name={n.icon} size={17} />{n.label}
          </button>
        ))}
        <button type="button" onClick={() => setSignout(true)} className="tk-navlink"
          style={{ justifyContent: "flex-start", gap: 10, minHeight: 44, border: 0, cursor: "pointer", width: "100%", textAlign: "start", background: "transparent", color: "var(--danger-fg)", marginTop: 6, borderTop: "1px solid var(--border-subtle)", borderRadius: 0, paddingTop: 14 }}>
          <Icon name="log-out" size={17} />Sign out
        </button>
      </nav>
      <div className="tk-stack" style={{ gap: "var(--space-5)" }}>
        {title && <h1 className="tk-h2">{title}</h1>}
        {unverified && nudge && (
          <Alert tone={nudgeErr ? "error" : nudgeSent ? "success" : "warning"}
            title={nudgeErr ? "Couldn’t send the email" : nudgeSent ? "Verification email sent" : "Verify your email address"}
            onDismiss={() => setNudge(false)}
            action={nudgeSent ? undefined : <Button size="sm" variant="secondary" disabled={nudgeBusy} onClick={resendVerify}>{nudgeBusy ? "Sending…" : nudgeErr ? "Try again" : "Resend email"}</Button>}>
            {nudgeErr
              ? <>We couldn’t send the verification link to <strong>{acctEmail}</strong> just now — please try again in a moment.</>
              : nudgeSent
              ? <>Check your inbox (and spam) for the link to <strong>{acctEmail}</strong>. It expires in 24 hours.</>
              : <>We sent a verification link to <strong>{acctEmail}</strong>. Confirm your address to secure your account — you can keep using TripKoach either way.</>}
          </Alert>
        )}
        {children}
      </div>
      <Modal open={signout} title="Sign out of TripKoach?" description="You'll need to log in again to see your bookings and manage your trips."
        onClose={() => setSignout(false)}
        actions={<><Button variant="secondary" onClick={() => setSignout(false)}>Stay signed in</Button><Button variant="danger" iconStart="log-out" onClick={async () => { setSignout(false); if (live) { try { await window.TK_AUTH.logout(); } catch (_) {} } go("login"); }}>Sign out</Button></>} />
    </div>
  );
}

function ProfileWeb({ go }) {
  const [dirty, setDirty] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [delOpen, setDelOpen] = React.useState(false);
  const touch = () => setDirty(true);
  // Live hydration (TRI-882): mount the form only once /me has loaded, so the
  // uncontrolled inputs pick up the real profile as their defaultValue. Flag off
  // → loaded is true from the start and the DS placeholder person renders as-is.
  const live = LIVE_AUTH();
  const cached = live ? window.TK_AUTH.cachedMe() : null;
  const [me, setMe] = React.useState(cached && typeof cached === "object" ? cached : null);
  const [loaded, setLoaded] = React.useState(live ? !!(cached && typeof cached === "object") : true);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!live || loaded) return;
    let alive = true;
    window.TK_AUTH.me().then(
      (u) => { if (!alive) return; if (!u) { go("login"); return; } setMe(u); setLoaded(true); },
      () => { if (alive) setLoaded(true); }
    );
    return () => { alive = false; };
  }, []);
  const dv = (k, ds) => (live && me ? (me[k] || "") : ds);
  const phoneProps = (v) => (live && me && v ? { defaultValue: v } : {});
  async function saveProfile() {
    if (busy) return;
    setBusy(true);
    try {
      await window.TK_AUTH.updateProfile({
        name: authVal("p-name"), email: authVal("p-email"), phone: authVal("p-phone"),
        country: authVal("p-country"), emergencyName: authVal("p-emergency-name"),
        emergencyPhone: authVal("p-emergency-phone"), dietaryNeeds: authVal("p-diet"),
      });
      setDirty(false); setToast("Profile saved");
    } catch (e) {
      window.tkToast(authErrMsg(e, "We couldn't save your profile. Please try again."));
    } finally { setBusy(false); }
  }
  if (live && !loaded) return (
    <AccountShell current="profile" go={go} title="Profile">
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-8)", alignItems: "center" }}><span className="tk-body-sm tk-muted">Loading your profile…</span></div></div>
    </AccountShell>
  );
  return (
    <AccountShell current="profile" go={go} title="Profile">
      <p className="tk-body tk-muted" style={{ marginTop: -8 }}>Your details travel with every booking. Guides use them to prepare for your trip.</p>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 22 }}>AM</span>
          <Button variant="secondary" size="sm" iconStart="user" onClick={touch}>Change photo</Button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="p-name" label="Full name" help="As it appears on your ID"><Input defaultValue={dv("name", "Ama Mensah")} onChange={touch} /></FormField>
          <FormField id="p-email" label="Email address" help="Where confirmations are sent"><Input type="email" defaultValue={dv("email", "ama@example.com")} onChange={touch} /></FormField>
          <FormField id="p-phone" label="Phone number"><PhoneInput id="p-phone" onChange={touch} {...phoneProps(live && me ? me.phone : "")} /></FormField>
          <FormField id="p-country" label="Country of residence" optional><Input defaultValue={dv("country", "Ghana")} onChange={touch} /></FormField>
        </div>
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Travel details</h2>
        <p className="tk-body-sm tk-muted" style={{ marginTop: -8 }}>Optional, but it helps your koach look after you.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="p-emergency-name" label="Emergency contact name" help="Someone we can reach in an emergency"><Input placeholder="Kofi Mensah" onChange={touch} {...(live && me && me.emergencyName ? { defaultValue: me.emergencyName } : {})} /></FormField>
          <FormField id="p-emergency-phone" label="Emergency contact number"><PhoneInput id="p-emergency-phone" onChange={touch} {...phoneProps(live && me ? me.emergencyPhone : "")} /></FormField>
        </div>
        <FormField id="p-diet" label="Dietary needs" optional><Input placeholder="Vegetarian, no shellfish…" onChange={touch} {...(live && me && me.dietaryNeeds ? { defaultValue: me.dietaryNeeds } : {})} /></FormField>
      </div></div>
      <div className="tk-card" style={{ borderColor: "var(--danger-border)" }}><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-2)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Delete account</h2>
        <p className="tk-body-sm tk-muted">Permanently remove your account and personal data. Active bookings must be cancelled first.</p>
        <Button variant="secondary" size="sm" style={{ alignSelf: "flex-start", marginTop: 6, color: "var(--danger-fg)", borderColor: "var(--danger-border)" }} onClick={() => setDelOpen(true)}>Delete my account</Button>
      </div></div>
      <Modal open={delOpen} title="Delete your account?" description="This permanently removes your account and personal data. This can't be undone." onClose={() => setDelOpen(false)}
        actions={<><Button variant="secondary" onClick={() => setDelOpen(false)}>Keep my account</Button><Button variant="danger" iconStart="trash-2" onClick={() => { setDelOpen(false); go("login"); }}>Delete account</Button></>}>
        <Alert tone="warning" title="Active bookings must be cancelled first">If you have upcoming trips, cancel them before deleting so we can process any refunds.</Alert>
      </Modal>
      <div className="tk-stickybar" style={{ position: "sticky", bottom: 16, borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--elev-3)" }}>
        <span className="tk-caption">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <Button style={{ marginInlineStart: "auto" }} iconStart="check" disabled={!dirty || busy} onClick={() => { if (live) { saveProfile(); return; } setDirty(false); setToast("Profile saved"); }}>Save changes</Button>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </AccountShell>
  );
}

function NotificationsWeb({ go }) {
  const [toast, setToast] = React.useState(null);
  // Live prefs (TRI-882): GET /me/notifications hydrates each Switch, and a toggle
  // PUTs the single { channel: { type: bool } } that changed. Flag off → the Rows
  // are the DS static defaults and a toggle just shows the local toast (unchanged).
  const live = LIVE_AUTH();
  const [prefs, setPrefs] = React.useState(null);
  const [loaded, setLoaded] = React.useState(!live);
  React.useEffect(() => {
    if (!live) return;
    let alive = true;
    window.TK_AUTH.me().then((u) => {
      if (!alive) return undefined;
      if (!u) { go("login"); return undefined; }
      return window.TK_AUTH.getNotifications().then((p) => { if (alive) { setPrefs(p); setLoaded(true); } });
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);
  const Row = ({ label, hint, defaultChecked, locked, channel, type }) => {
    const liveChecked = live && prefs && channel && type && prefs[channel] ? !!prefs[channel][type] : undefined;
    const onLive = async (e) => {
      const val = e.target.checked;
      try { await window.TK_AUTH.updateNotifications({ [channel]: { [type]: val } }); setToast("Preference updated"); }
      catch (err) { window.tkToast(authErrMsg(err, "Couldn't update that preference.")); }
    };
    return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "16px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <span style={{ maxWidth: "44ch" }}><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>{label}</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>{hint}</p></span>
      <Switch id={"n-" + label.replace(/\W/g, "")} checked={locked ? true : undefined} defaultChecked={locked ? undefined : (live && liveChecked !== undefined ? liveChecked : defaultChecked)} readOnly={locked} onChange={locked ? undefined : (live ? onLive : () => setToast("Preference updated"))} />
    </div>
    );
  };
  if (live && !loaded) return (
    <AccountShell current="notifications" go={go} title="Notifications">
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-8)", alignItems: "center" }}><span className="tk-body-sm tk-muted">Loading your preferences…</span></div></div>
    </AccountShell>
  );
  return (
    <AccountShell current="notifications" go={go} title="Notifications">
      <p className="tk-body tk-muted" style={{ marginTop: -8 }}>Choose what we send and how. Booking confirmations and payment reminders are always on — they're part of your trip.</p>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-2) var(--space-6) var(--space-4)" }}>
        <h2 className="tk-h6" style={{ margin: "var(--space-4) 0 0" }}>Email</h2>
        <Row label="Booking confirmations" hint="Your reference, payment instructions and receipt." locked />
        <Row label="Payment reminders" hint="Before your pay-by date, so you don't lose your spots." locked />
        <Row label="Departure reminders" hint="A nudge 48 hours before you travel, with pickup details." defaultChecked channel="email" type="departure_reminders" />
        <Row label="Review reminders" hint="After your trip, an invite to review the tour — with a nudge if you haven't yet." defaultChecked channel="email" type="review_reminders" />
        <Row label="Trip inspiration & offers" hint="New tours, seasonal trips and the occasional promo code." defaultChecked={false} channel="email" type="marketing_offers" />
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-2) var(--space-6) var(--space-4)" }}>
        <h2 className="tk-h6" style={{ margin: "var(--space-4) 0 0" }}>WhatsApp &amp; SMS</h2>
        <Row label="Urgent trip updates" hint="Delays, weather or last-minute changes to your departure." defaultChecked channel="whatsapp" type="urgent_updates" />
        <Row label="Your koach messages" hint="Replies from the koach planning or running your trip." defaultChecked channel="whatsapp" type="koach_messages" />
      </div></div>
      <Alert tone="info" title="Quiet hours">We never send non-urgent messages between 21:00 and 07:00 GMT.</Alert>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </AccountShell>
  );
}

function AccountSettingsWeb({ go }) {
  const [toast, setToast] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [pwOpen, setPwOpen] = React.useState(false);
  const [pw, setPw] = React.useState({ cur: "", next: "", conf: "" });
  const pwOk = pw.next.length >= 10 && pw.next === pw.conf && pw.cur.length > 0;
  const touch = () => setDirty(true);
  // Live wiring (TRI-882): preferences (language / display currency / data saver)
  // hydrate from /me and PATCH on save; the change-password modal POSTs
  // /me/password (wrong current → 401 shown inline). Flag off → DS demo behaviour.
  const live = LIVE_AUTH();
  const cached = live ? window.TK_AUTH.cachedMe() : null;
  const [me, setMe] = React.useState(cached && typeof cached === "object" ? cached : null);
  const [loaded, setLoaded] = React.useState(live ? !!(cached && typeof cached === "object") : true);
  const [busy, setBusy] = React.useState(false);
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwErr, setPwErr] = React.useState(null);
  React.useEffect(() => {
    if (!live || loaded) return;
    let alive = true;
    window.TK_AUTH.me().then(
      (u) => { if (!alive) return; if (!u) { go("login"); return; } setMe(u); setLoaded(true); },
      () => { if (alive) setLoaded(true); }
    );
    return () => { alive = false; };
  }, []);
  async function savePrefs() {
    if (busy) return;
    setBusy(true);
    try {
      await window.TK_AUTH.updateProfile({
        language: authVal("s-lang"), displayCurrency: authVal("s-cur"),
        dataSaver: !!(document.getElementById("s-saver") && document.getElementById("s-saver").checked),
      });
      setDirty(false); setToast("Settings saved");
    } catch (e) {
      window.tkToast(authErrMsg(e, "We couldn't save your settings. Please try again."));
    } finally { setBusy(false); }
  }
  async function changePw() {
    if (pwBusy) return;
    setPwBusy(true); setPwErr(null);
    try {
      await window.TK_AUTH.changePassword(pw.cur, pw.next);
      setPwBusy(false); setPwOpen(false); setToast("Password updated");
    } catch (e) {
      setPwBusy(false);
      setPwErr(e && e.status === 401 ? "Your current password is incorrect." : authErrMsg(e, "We couldn't update your password."));
    }
  }
  if (live && !loaded) return (
    <AccountShell current="account-settings" go={go} title="Settings">
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-8)", alignItems: "center" }}><span className="tk-body-sm tk-muted">Loading your settings…</span></div></div>
    </AccountShell>
  );
  return (
    <AccountShell current="account-settings" go={go} title="Settings">
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Preferences</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="s-lang" label="Language"><Select defaultValue={live && me ? me.language : "en"} onChange={touch} options={[{ value: "en", label: "English" }, { value: "tw", label: "Twi" }, { value: "fr", label: "Français" }]} /></FormField>
          <FormField id="s-cur" label="Display currency" help="You're always charged in USD"><Select defaultValue={live && me ? me.displayCurrency : "USD"} onChange={touch} options={[{ value: "USD", label: "US Dollar ($)" }, { value: "GHS", label: "Ghana Cedi (GH₵)" }]} /></FormField>
        </div>
        <Switch id="s-saver" label="Data saver — lighter images on slow connections" defaultChecked={live && me ? me.dataSaver : true} onChange={touch} />
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Password &amp; security</h2>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>Password</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Last changed 3 months ago.</p></span>
          <Button variant="secondary" size="sm" onClick={() => { setPw({ cur: "", next: "", conf: "" }); setPwOpen(true); }}>Change password</Button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <span><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>Two-factor authentication <Badge tone="neutral">Off</Badge></strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Add a second step when signing in.</p></span>
          <Button variant="secondary" size="sm" onClick={touch}>Turn on</Button>
        </div>
      </div></div>
      <div className="tk-stickybar" style={{ position: "sticky", bottom: 16, borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--elev-3)" }}>
        <span className="tk-caption">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <Button style={{ marginInlineStart: "auto" }} iconStart="check" disabled={!dirty || busy} onClick={() => { if (live) { savePrefs(); return; } setDirty(false); setToast("Settings saved"); }}>Save changes</Button>
      </div>
      <Modal open={pwOpen} title="Change password" description="Choose a strong password you don't use elsewhere." onClose={() => { setPwOpen(false); setPwErr(null); }}
        actions={<><Button variant="secondary" onClick={() => { setPwOpen(false); setPwErr(null); }}>Cancel</Button><Button iconStart="check" disabled={!pwOk || pwBusy} onClick={() => { if (live) { changePw(); return; } setPwOpen(false); setToast("Password updated"); }}>Update password</Button></>}>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {pwErr && <Alert tone="error" title="We couldn't update your password">{pwErr}</Alert>}
          <FormField id="sp-cur" label="Current password"><Input id="sp-cur" type="password" value={pw.cur} onChange={(e) => setPw(p => ({ ...p, cur: e.target.value }))} /></FormField>
          <FormField id="sp-next" label="New password" help="At least 10 characters"><Input id="sp-next" type="password" value={pw.next} onChange={(e) => setPw(p => ({ ...p, next: e.target.value }))} /></FormField>
          <FormField id="sp-conf" label="Confirm new password" error={pw.conf && pw.next !== pw.conf ? "Passwords don't match" : undefined}><Input id="sp-conf" type="password" value={pw.conf} onChange={(e) => setPw(p => ({ ...p, conf: e.target.value }))} /></FormField>
        </div>
      </Modal>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </AccountShell>
  );
}
function LoginWeb({ go, startCreating }) {
  const [creating, setCreating] = React.useState(!!startCreating);
  const [pw, setPw] = React.useState("");
  const [wrong, setWrong] = React.useState(false);
  // TRI-925 — snapshot returning-visitor status once at mount; the page navigates
  // away on a successful login so it never needs to re-read after the flag is set.
  const returning = React.useMemo(() => tkIsReturning(), []);
  // Live auth (TRI-882): submit logs in / signs up via /api/v1. Flag off → the
  // form just walks to the bookings screen exactly like the DS prototype.
  const live = LIVE_AUTH();
  const [busy, setBusy] = React.useState(false);
  const [errMsg, setErrMsg] = React.useState(null);
  // TRI-941 — after a live signup the account is created + signed in but unverified; show a
  // "check your inbox" panel (with a resend path) instead of dropping straight into bookings.
  const [signedUp, setSignedUp] = React.useState(false);
  const [signupEmail, setSignupEmail] = React.useState("");
  async function submit(e) {
    e.preventDefault();
    if (!live) { go("bookings"); return; }
    if (busy) return;
    const email = authVal("lg-email");
    if (creating && pw.length < 8) { setWrong(true); setErrMsg("Choose a password with at least 8 characters."); return; }
    setWrong(false); setErrMsg(null); setBusy(true);
    try {
      if (creating) {
        const name = authVal("lg-name");
        const terms = !!(document.getElementById("lg-terms") && document.getElementById("lg-terms").checked);
        await window.TK_AUTH.signup({ email: email, password: pw, name: name || undefined, agreedTerms: terms });
        tkMarkReturning(); // TRI-925 — this browser has now signed in at least once
        setBusy(false); setSignupEmail(email); setSignedUp(true); return; // TRI-941 check-inbox
      }
      const el = document.getElementById("lg-pw");
      const password = el && typeof el.value === "string" ? el.value : "";
      await window.TK_AUTH.login(email, password);
      tkMarkReturning(); // TRI-925 — this browser has now signed in at least once
      go("bookings");
    } catch (err) {
      setBusy(false); setWrong(true);
      if (creating && err && err.status === 409) setErrMsg("An account with that email already exists. Try logging in instead.");
      else if (!creating && err && err.status === 401) setErrMsg(null); // fall through to the DS default copy
      else setErrMsg(authErrMsg(err, creating ? "We couldn't create your account. Please check your details." : "That email and password don't match."));
    }
  }
  if (signedUp) return <CheckInboxPanel email={signupEmail} go={go} />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", minHeight: "calc(100vh - var(--header-h))" }} className="tk-login">
      <PromoPanel mode={creating ? "signup" : "signin"} returning={returning} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          <img src="../../assets/logo-badge.png" width="44" height="44" alt="TripKoach" style={{ marginBottom: "var(--space-5)" }} />
          <h1 className="tk-h2">{creating ? "Create your account" : "Log in"}</h1>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>{creating ? "Takes a minute — you only need it once." : (returning ? "Welcome back. Enter your details to continue." : "Welcome — sign in to pick up your Ghana trip planning.")}</p>
          {wrong && <Alert tone="error" title={creating ? "We couldn't create your account" : "We couldn't log you in"} style={{ marginBottom: "var(--space-4)" }}>{errMsg || "That email and password don't match. Try again, or reset your password."}</Alert>}
          <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={submit}>
            {creating && <FormField id="lg-name" label="Full name"><Input placeholder="Ama Mensah" autoComplete="name" /></FormField>}
            <FormField id="lg-email" label="Email address"><Input type="email" autoComplete="email" placeholder="you@example.com" defaultValue={creating ? "" : (live ? "" : "ama@example.com")} iconStart="mail" /></FormField>
            <FormField id="lg-pw" label="Password" error={wrong && !creating ? "Check your password" : undefined}>
              {creating
                ? <PasswordInput id="lg-pw" value={pw} onChange={(e) => setPw(e.target.value)} rules={[{ label: "8+ characters", met: pw.length >= 8 }, { label: "A letter", met: /[a-z]/i.test(pw) }, { label: "A number", met: /\d/.test(pw) }]} />
                : <PasswordInput id="lg-pw" />}
            </FormField>
            {!creating && (
              <div className="tk-row" style={{ justifyContent: "space-between" }}>
                <Checkbox id="lg-remember" label="Keep me signed in" defaultChecked />
                <Button variant="link" size="sm" type="button" onClick={() => go("forgot")}>Forgot password?</Button>
              </div>
            )}
            {creating && <Checkbox id="lg-terms" label="I agree to the booking terms and privacy policy" />}
            <Button block size="lg" type="submit" disabled={live ? busy : undefined}>{busy ? (creating ? "Creating…" : "Signing in…") : (creating ? "Create account" : "Log in")}</Button>
          </form>
          <p className="tk-body-sm" style={{ textAlign: "center", marginTop: "var(--space-5)" }}>
            {creating ? "Already have an account? " : "New to TripKoach? "}
            <a href="#" onClick={(e) => { e.preventDefault(); setCreating(!creating); setWrong(false); setErrMsg(null); }}>{creating ? "Log in" : "Create an account"}</a>
          </p>
          <p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
            <a href="#" onClick={(e) => { e.preventDefault(); go("browse"); }}>← Keep browsing tours</a>
          </p>
        </div>
      </div>
    </div>
  );
}
function AuthShell({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", minHeight: "calc(100vh - var(--header-h))" }} className="tk-login">
      <PromoPanel mode="reset" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <div style={{ width: "100%", maxWidth: 380 }}>{children}</div>
      </div>
    </div>
  );
}

function ForgotWeb({ go }) {
  // Live reset (TRI-882): the email stage POSTs /password-reset/request (always
  // 200 — no enumeration); arriving via the emailed /reset-password?token=… link
  // opens straight on the "reset" stage and the form POSTs /password-reset/consume.
  const live = LIVE_AUTH();
  const initial = (function () {
    try {
      if (live && /reset-password/.test(window.location.pathname || "")) {
        return { stage: "reset", token: new URLSearchParams(window.location.search || "").get("token") || "" };
      }
    } catch (_) {}
    return { stage: "email", token: "" };
  })();
  const [stage, setStage] = React.useState(initial.stage);
  const [token] = React.useState(initial.token);
  const [busy, setBusy] = React.useState(false);
  const [resetErr, setResetErr] = React.useState(null);
  const [email, setEmail] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const emailOk = /.+@.+\..+/.test(email);
  const pwOk = pw.length >= 8 && /\d/.test(pw) && pw === pw2;
  async function submitEmail(e) {
    e.preventDefault();
    if (!emailOk || busy) return;
    if (!live) { setStage("sent"); return; }
    setBusy(true);
    try { await window.TK_AUTH.requestReset(email); } catch (_) {}
    setBusy(false); setStage("sent");
  }
  async function submitReset(e) {
    e.preventDefault();
    if (!pwOk || busy) return;
    if (!live) { setStage("done"); return; }
    if (!token) { setResetErr("This reset link is invalid or has expired. Request a new one."); return; }
    setBusy(true); setResetErr(null);
    try { await window.TK_AUTH.consumeReset(token, pw); setBusy(false); setStage("done"); }
    catch (err) {
      setBusy(false);
      setResetErr(err && (err.code === "invalid_token" || err.status === 400)
        ? "This reset link is invalid or has expired. Request a new one."
        : authErrMsg(err, "We couldn't update your password. Please try again."));
    }
  }
  return (
    <AuthShell>
      <img src="../../assets/logo-badge.png" width="44" height="44" alt="TripKoach" style={{ marginBottom: "var(--space-5)" }} />
      {stage === "email" && (<>
        <h1 className="tk-h2">Reset your password</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Enter the email you booked with and we'll send a link to set a new password.</p>
        <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={submitEmail}>
          <FormField id="fp-email" label="Email address"><Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} iconStart="mail" /></FormField>
          <Button block size="lg" type="submit" disabled={!emailOk || busy}>{busy ? "Sending…" : "Send reset link"}</Button>
        </form>
        <p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-5)" }}><a href="#" onClick={(e) => { e.preventDefault(); go("login"); }}>← Back to log in</a></p>
      </>)}
      {stage === "sent" && (<>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--success-bg)", color: "var(--success-fg)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="mail" size={26} /></div>
        <h1 className="tk-h2">Check your email</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-5)" }}>If an account exists for <strong style={{ color: "var(--text-strong)" }}>{email || "that address"}</strong>, we've sent a link to reset your password. It expires in 30 minutes.</p>
        <Alert tone="info" title="Didn't get it?" style={{ marginBottom: "var(--space-5)" }}>Check spam, or <a href="#" onClick={(e) => { e.preventDefault(); if (live) { window.TK_AUTH.requestReset(email); } window.tkToast("Reset link sent again"); }}>resend the link</a>. Still stuck? Message us on WhatsApp.</Alert>
        <Button block variant="secondary" onClick={() => setStage("reset")}>I've opened the link</Button>
        <p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-5)" }}><a href="#" onClick={(e) => { e.preventDefault(); go("login"); }}>← Back to log in</a></p>
      </>)}
      {stage === "reset" && (<>
        <h1 className="tk-h2">Set a new password</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Choose a password you don't use anywhere else.</p>
        {resetErr && <Alert tone="error" title="We couldn't reset your password" style={{ marginBottom: "var(--space-4)" }}>{resetErr}</Alert>}
        <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={submitReset}>
          <FormField id="fp-pw" label="New password"><PasswordInput id="fp-pw" value={pw} onChange={(e) => setPw(e.target.value)} rules={[{ label: "8+ characters", met: pw.length >= 8 }, { label: "A number", met: /\d/.test(pw) }]} /></FormField>
          <FormField id="fp-pw2" label="Confirm new password" error={pw2 && pw !== pw2 ? "Passwords don't match" : undefined}><PasswordInput id="fp-pw2" value={pw2} onChange={(e) => setPw2(e.target.value)} /></FormField>
          <Button block size="lg" type="submit" disabled={!pwOk || busy}>{busy ? "Updating…" : "Update password"}</Button>
        </form>
      </>)}
      {stage === "done" && (<>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--success-bg)", color: "var(--success-fg)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="circle-check-big" size={26} /></div>
        <h1 className="tk-h2">Password updated</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>You're all set. Log in with your new password to see your bookings.</p>
        <Button block size="lg" onClick={() => go("login")}>Back to log in</Button>
      </>)}
    </AuthShell>
  );
}
// TRI-941 — post-signup "check your inbox" panel. The account is already created + signed in (session
// cookie set), but unverified; this confirms where the verify email went and offers a rate-limited resend
// plus a way to continue into the account without verifying (SOFT enforcement — nothing is gated).
function CheckInboxPanel({ email, go }) {
  const live = LIVE_AUTH();
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  async function resend() {
    if (busy) return;
    setBusy(true);
    if (live) { try { await window.TK_AUTH.resendVerification(); } catch (_) {} }
    setBusy(false); setSent(true);
  }
  return (
    <AuthShell>
      <img src="../../assets/logo-badge.png" width="44" height="44" alt="TripKoach" style={{ marginBottom: "var(--space-5)" }} />
      <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--success-bg)", color: "var(--success-fg)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="mail" size={26} /></div>
      <h1 className="tk-h2">Check your inbox</h1>
      <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-5)" }}>Your account is ready. We've sent a verification link to <strong style={{ color: "var(--text-strong)" }}>{email || "your email"}</strong> — open it to confirm your address. You can start planning right away; verifying just secures your account.</p>
      {sent
        ? <Alert tone="success" title="Verification email sent" style={{ marginBottom: "var(--space-5)" }}>Check your inbox (and spam). Links can take a minute to arrive.</Alert>
        : <Alert tone="info" title="Didn't get it?" style={{ marginBottom: "var(--space-5)" }}>Check spam, or resend the link below. The link expires in 24 hours.</Alert>}
      <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
        <Button block size="lg" onClick={() => go("bookings")}>Continue to my account</Button>
        <Button block variant="secondary" disabled={busy || sent} onClick={resend}>{busy ? "Sending…" : sent ? "Link sent" : "Resend verification email"}</Button>
      </div>
    </AuthShell>
  );
}

// TRI-941 — /verify-email?token=… landing page. Consumes the emailed token on mount and resolves to one
// of: verified (just now), already-verified, or invalid/expired (with a resend path). Flag off → inert
// demo success (no API), matching the DS prototype posture of the other auth pages.
function VerifyEmailPage({ go }) {
  const live = LIVE_AUTH();
  const token = React.useMemo(() => {
    try { return new URLSearchParams(window.location.search || "").get("token") || ""; } catch (_) { return ""; }
  }, []);
  // Stages: verifying · verified · already · expired · sent (resend confirmation)
  const [stage, setStage] = React.useState(live ? "verifying" : "verified");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!live) return;
    if (!token) { setStage("expired"); return; }
    let alive = true;
    window.TK_AUTH.verifyEmail(token).then(
      (res) => { if (alive) setStage(res && res.status === "already_verified" ? "already" : "verified"); },
      () => { if (alive) setStage("expired"); }
    );
  }, []);
  async function resend() {
    if (busy) return;
    setBusy(true);
    // Resend needs a session (the token is spent). If signed in, ask the server to re-send; otherwise
    // route to login so the person can sign in and resend from the account nudge.
    try {
      const me = live ? await window.TK_AUTH.me() : null;
      if (me) { await window.TK_AUTH.resendVerification(); setBusy(false); setStage("sent"); return; }
    } catch (_) {}
    setBusy(false); go("login");
  }
  const Success = ({ title, body }) => (<>
    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--success-bg)", color: "var(--success-fg)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="circle-check-big" size={26} /></div>
    <h1 className="tk-h2">{title}</h1>
    <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>{body}</p>
    <Button block size="lg" onClick={() => go("bookings")}>Go to my account</Button>
    <p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-5)" }}><a href="#" onClick={(e) => { e.preventDefault(); go("home"); }}>← Back to TripKoach</a></p>
  </>);
  return (
    <AuthShell>
      <img src="../../assets/logo-badge.png" width="44" height="44" alt="TripKoach" style={{ marginBottom: "var(--space-5)" }} />
      {stage === "verifying" && (<>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "var(--space-4)" }}>
          <span className="tk-spin" style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid var(--border-subtle)", borderTopColor: "var(--brand)", display: "inline-block" }} />
          <h1 className="tk-h2" style={{ margin: 0 }}>Verifying your email…</h1>
        </div>
        <p className="tk-body-sm tk-muted">This only takes a moment.</p>
      </>)}
      {stage === "verified" && <Success title="Email verified" body="Thanks — your email address is confirmed and your account is secured. You're all set." />}
      {stage === "already" && <Success title="Already verified" body="This email address was already confirmed. Nothing more to do — you're all set." />}
      {stage === "sent" && <Success title="New link sent" body="We've sent a fresh verification link to your inbox. Open it to confirm your address (it expires in 24 hours)." />}
      {stage === "expired" && (<>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--warning-bg, var(--bg-sunken))", color: "var(--warning-fg, var(--text-strong))", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="triangle-alert" size={26} /></div>
        <h1 className="tk-h2">Link expired</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>This verification link is invalid or has expired. Verification links can be used once and last 24 hours — request a fresh one below.</p>
        <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
          <Button block size="lg" disabled={busy} onClick={resend}>{busy ? "Sending…" : "Send me a new link"}</Button>
          <Button block variant="secondary" onClick={() => go("login")}>Back to log in</Button>
        </div>
      </>)}
    </AuthShell>
  );
}

Object.assign(window, { AccountShell, ProfileWeb, NotificationsWeb, AccountSettingsWeb, LoginWeb, ForgotWeb, ReviewsWeb, VerifyEmailPage, CheckInboxPanel });

function ReviewsWeb({ go }) {
  const Stars = NS.Stars;
  const me = "Ama Mensah";
  const awaiting = window.TK_INVITE ? [window.TK_INVITE] : [];
  const all = (window.TK_REVIEWS || []);
  let mine = all.filter(r => r.author === me || r.name === me);
  if (!mine.length) mine = all.slice(0, 2); // demo fallback so the page has content
  const tourTitle = (id) => { const t = window.TK_DATA.tours.find(x => x.id === id); return t ? t.title : id; };
  const statusChip = (s) => s === "approved"
    ? <span className="tk-badge tk-badge--confirmed">Published</span>
    : s === "rejected" ? <span className="tk-badge tk-badge--cancelled">Not published</span>
    : <span className="tk-badge tk-badge--pending">In review</span>;
  return (
    <AccountShell current="reviews" go={go} title="Reviews">
      <p className="tk-body tk-muted" style={{ marginTop: -8 }}>Reviews you can leave after a trip, and the ones you've already shared. We check each review before it appears publicly.</p>

      <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Awaiting your review</h2>
        {awaiting.length ? awaiting.map((iv, i) => (
          <div key={i} className="tk-card" style={{ borderColor: "var(--brand-border)" }}><div className="tk-card__body" style={{ padding: "var(--space-5)", flexDirection: "row", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <span style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", flex: "none" }}><Icon name="star" size={20} /></span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong style={{ display: "block" }}>{iv.tour}</strong>
              <span className="tk-caption">You travelled on {iv.date} · booking {iv.ref}</span>
            </div>
            <Button iconStart="pencil" onClick={() => go("review")}>Write your review</Button>
          </div></div>
        )) : (
          <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", alignItems: "center", textAlign: "center", gap: 6 }}>
            <span className="tk-body-sm tk-muted">No trips waiting for a review right now. We'll email you a link after your next departure.</span>
          </div></div>
        )}
      </div>

      <div className="tk-stack" style={{ gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Your reviews</h2>
        {mine.map((r, i) => (
          <div key={i} className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-5)", gap: "var(--space-2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <a href="#tour" onClick={(e) => { e.preventDefault(); go("tour", r.tourId); }} className="tk-h6" style={{ margin: 0, textDecoration: "none", color: "var(--text-strong)" }}>{tourTitle(r.tourId)}</a>
              {statusChip(r.status)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{Stars ? <Stars value={r.rating} /> : null}<span className="tk-caption">{r.date || "Recently"}</span></div>
            {r.title && <strong style={{ fontSize: 14.5 }}>{r.title}</strong>}
            <p className="tk-body-sm" style={{ margin: 0, color: "var(--text-body)" }}>{r.body || r.text}</p>
            {r.status === "pending" && <span className="tk-caption" style={{ color: "var(--warning-fg)" }}>Checked before it appears publicly — usually within a day.</span>}
            {r.reply && <div style={{ marginTop: 6, padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}><span className="tk-caption" style={{ fontWeight: 700, color: "var(--brand-ink)" }}>TripKoach replied</span><p className="tk-body-sm" style={{ margin: "2px 0 0" }}>{r.reply}</p></div>}
          </div></div>
        ))}
      </div>
    </AccountShell>
  );
}
