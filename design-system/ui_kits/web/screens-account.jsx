const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Icon, FormField, Input, PhoneInput, PasswordInput, Select, Switch, Checkbox, Textarea, Alert, Badge, Modal, Toast, StatusBadge } = NS;

const ACCOUNT_NAV = [
  { id: "bookings", icon: "ticket", label: "Bookings" },
  { id: "reviews", icon: "star", label: "Reviews" },
  { id: "profile", icon: "user", label: "Profile" },
  { id: "notifications", icon: "bell", label: "Notifications" },
  { id: "account-settings", icon: "settings", label: "Settings" },
];

function AccountShell({ current, go, title, children }) {
  const [signout, setSignout] = React.useState(false);
  return (
    <div className="tk-container" style={{ paddingBlock: "var(--space-8) var(--space-12)", maxWidth: 1000, display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--space-10)", alignItems: "start" }}>
      <nav aria-label="Account" style={{ display: "flex", flexDirection: "column", gap: 4, position: "sticky", top: "calc(var(--header-h) + 24px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px 14px" }}>
          <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800 }}>AM</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>Ama Mensah</strong>
            <span className="tk-caption" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>ama@example.com</span>
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
        {children}
      </div>
      <Modal open={signout} title="Sign out of TripKoach?" description="You'll need to log in again to see your bookings and manage your trips."
        onClose={() => setSignout(false)}
        actions={<><Button variant="secondary" onClick={() => setSignout(false)}>Stay signed in</Button><Button variant="danger" iconStart="log-out" onClick={() => { setSignout(false); go("login"); }}>Sign out</Button></>} />
    </div>
  );
}

function ProfileWeb({ go }) {
  const [dirty, setDirty] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [delOpen, setDelOpen] = React.useState(false);
  const touch = () => setDirty(true);
  return (
    <AccountShell current="profile" go={go} title="Profile">
      <p className="tk-body tk-muted" style={{ marginTop: -8 }}>Your details travel with every booking. Guides use them to prepare for your trip.</p>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 22 }}>AM</span>
          <Button variant="secondary" size="sm" iconStart="user" onClick={touch}>Change photo</Button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="p-name" label="Full name" help="As it appears on your ID"><Input defaultValue="Ama Mensah" onChange={touch} /></FormField>
          <FormField id="p-email" label="Email address" help="Where confirmations are sent"><Input type="email" defaultValue="ama@example.com" onChange={touch} /></FormField>
          <FormField id="p-phone" label="Phone number"><PhoneInput id="p-phone" onChange={touch} /></FormField>
          <FormField id="p-country" label="Country of residence" optional><Input defaultValue="Ghana" onChange={touch} /></FormField>
        </div>
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Travel details</h2>
        <p className="tk-body-sm tk-muted" style={{ marginTop: -8 }}>Optional, but it helps your koach look after you.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="p-emergency-name" label="Emergency contact name" help="Someone we can reach in an emergency"><Input placeholder="Kofi Mensah" onChange={touch} /></FormField>
          <FormField id="p-emergency-phone" label="Emergency contact number"><PhoneInput id="p-emergency-phone" onChange={touch} /></FormField>
        </div>
        <FormField id="p-diet" label="Dietary needs" optional><Input placeholder="Vegetarian, no shellfish…" onChange={touch} /></FormField>
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
        <Button style={{ marginInlineStart: "auto" }} iconStart="check" disabled={!dirty} onClick={() => { setDirty(false); setToast("Profile saved"); }}>Save changes</Button>
      </div>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </AccountShell>
  );
}

function NotificationsWeb({ go }) {
  const [toast, setToast] = React.useState(null);
  const Row = ({ label, hint, defaultChecked, locked }) => (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "16px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <span style={{ maxWidth: "44ch" }}><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>{label}</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>{hint}</p></span>
      <Switch id={"n-" + label.replace(/\W/g, "")} checked={locked ? true : undefined} defaultChecked={locked ? undefined : defaultChecked} readOnly={locked} onChange={locked ? undefined : () => setToast("Preference updated")} />
    </div>
  );
  return (
    <AccountShell current="notifications" go={go} title="Notifications">
      <p className="tk-body tk-muted" style={{ marginTop: -8 }}>Choose what we send and how. Booking confirmations and payment reminders are always on — they're part of your trip.</p>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-2) var(--space-6) var(--space-4)" }}>
        <h2 className="tk-h6" style={{ margin: "var(--space-4) 0 0" }}>Email</h2>
        <Row label="Booking confirmations" hint="Your reference, payment instructions and receipt." locked />
        <Row label="Payment reminders" hint="Before your pay-by date, so you don't lose your spots." locked />
        <Row label="Departure reminders" hint="A nudge 48 hours before you travel, with pickup details." defaultChecked />
        <Row label="Review reminders" hint="After your trip, an invite to review the tour — with a nudge if you haven't yet." defaultChecked />
        <Row label="Trip inspiration & offers" hint="New tours, seasonal trips and the occasional promo code." defaultChecked={false} />
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-2) var(--space-6) var(--space-4)" }}>
        <h2 className="tk-h6" style={{ margin: "var(--space-4) 0 0" }}>WhatsApp &amp; SMS</h2>
        <Row label="Urgent trip updates" hint="Delays, weather or last-minute changes to your departure." defaultChecked />
        <Row label="Your koach messages" hint="Replies from the koach planning or running your trip." defaultChecked />
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
  return (
    <AccountShell current="account-settings" go={go} title="Settings">
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Preferences</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="s-lang" label="Language"><Select defaultValue="en" onChange={touch} options={[{ value: "en", label: "English" }, { value: "tw", label: "Twi" }, { value: "fr", label: "Français" }]} /></FormField>
          <FormField id="s-cur" label="Display currency" help="You're always charged in USD"><Select defaultValue="USD" onChange={touch} options={[{ value: "USD", label: "US Dollar ($)" }, { value: "GHS", label: "Ghana Cedi (GH₵)" }]} /></FormField>
        </div>
        <Switch id="s-saver" label="Data saver — lighter images on slow connections" defaultChecked onChange={touch} />
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
        <Button style={{ marginInlineStart: "auto" }} iconStart="check" disabled={!dirty} onClick={() => { setDirty(false); setToast("Settings saved"); }}>Save changes</Button>
      </div>
      <Modal open={pwOpen} title="Change password" description="Choose a strong password you don't use elsewhere." onClose={() => setPwOpen(false)}
        actions={<><Button variant="secondary" onClick={() => setPwOpen(false)}>Cancel</Button><Button iconStart="check" disabled={!pwOk} onClick={() => { setPwOpen(false); setToast("Password updated"); }}>Update password</Button></>}>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <FormField id="sp-cur" label="Current password"><Input id="sp-cur" type="password" value={pw.cur} onChange={(e) => setPw(p => ({ ...p, cur: e.target.value }))} /></FormField>
          <FormField id="sp-next" label="New password" help="At least 10 characters"><Input id="sp-next" type="password" value={pw.next} onChange={(e) => setPw(p => ({ ...p, next: e.target.value }))} /></FormField>
          <FormField id="sp-conf" label="Confirm new password" error={pw.conf && pw.next !== pw.conf ? "Passwords don't match" : undefined}><Input id="sp-conf" type="password" value={pw.conf} onChange={(e) => setPw(p => ({ ...p, conf: e.target.value }))} /></FormField>
        </div>
      </Modal>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </AccountShell>
  );
}
function LoginWeb({ go }) {
  const [creating, setCreating] = React.useState(false);
  const [pw, setPw] = React.useState("");
  const [wrong, setWrong] = React.useState(false);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", minHeight: "calc(100vh - var(--header-h))" }} className="tk-login">
      <div style={{ position: "relative", overflow: "hidden", background: "var(--n-950)" }}>
        <img src="https://cdn.tripkoach.com/img/tours/discover-ghana-in-10-days/hero-1440.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }} />
        <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(20,19,18,.25), rgba(20,19,18,.8))" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "48px", color: "var(--n-0)" }}>
          <span className="tk-overline" style={{ color: "var(--gold-400)" }}>Welcome back</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.02, fontSize: "clamp(28px,3vw,44px)", margin: "10px 0 0", maxWidth: "16ch" }}>Your trips to Ghana, in one place.</h2>
          <p style={{ color: "rgba(255,255,255,.82)", marginTop: 12, maxWidth: "42ch" }}>Sign in to see your bookings, manage travellers, and pick up planning where you left off.</p>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          <img src="../../assets/logo-badge.png" width="44" height="44" alt="TripKoach" style={{ marginBottom: "var(--space-5)" }} />
          <h1 className="tk-h2">{creating ? "Create your account" : "Log in"}</h1>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>{creating ? "Takes a minute — you only need it once." : "Welcome back. Enter your details to continue."}</p>
          {wrong && !creating && <Alert tone="error" title="We couldn't log you in" style={{ marginBottom: "var(--space-4)" }}>That email and password don't match. Try again, or reset your password.</Alert>}
          <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={(e) => { e.preventDefault(); go("bookings"); }}>
            {creating && <FormField id="lg-name" label="Full name"><Input placeholder="Ama Mensah" autoComplete="name" /></FormField>}
            <FormField id="lg-email" label="Email address"><Input type="email" autoComplete="email" placeholder="you@example.com" defaultValue={creating ? "" : "ama@example.com"} iconStart="mail" /></FormField>
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
            <Button block size="lg" type="submit">{creating ? "Create account" : "Log in"}</Button>
          </form>
          <p className="tk-body-sm" style={{ textAlign: "center", marginTop: "var(--space-5)" }}>
            {creating ? "Already have an account? " : "New to TripKoach? "}
            <a href="#" onClick={(e) => { e.preventDefault(); setCreating(!creating); setWrong(false); }}>{creating ? "Log in" : "Create an account"}</a>
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
      <div style={{ position: "relative", overflow: "hidden", background: "var(--n-950)" }}>
        <img src="https://cdn.tripkoach.com/img/tours/discover-ghana-in-10-days/hero-1440.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }} />
        <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(20,19,18,.25), rgba(20,19,18,.8))" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "48px", color: "var(--n-0)" }}>
          <span className="tk-overline" style={{ color: "var(--gold-400)" }}>Your account</span>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.02, fontSize: "clamp(28px,3vw,44px)", margin: "10px 0 0", maxWidth: "16ch" }}>Your trips to Ghana, in one place.</h2>
          <p style={{ color: "rgba(255,255,255,.82)", marginTop: 12, maxWidth: "42ch" }}>We'll help you back in — resetting your password only takes a moment.</p>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
        <div style={{ width: "100%", maxWidth: 380 }}>{children}</div>
      </div>
    </div>
  );
}

function ForgotWeb({ go }) {
  const [stage, setStage] = React.useState("email");
  const [email, setEmail] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const emailOk = /.+@.+\..+/.test(email);
  const pwOk = pw.length >= 8 && /\d/.test(pw) && pw === pw2;
  return (
    <AuthShell>
      <img src="../../assets/logo-badge.png" width="44" height="44" alt="TripKoach" style={{ marginBottom: "var(--space-5)" }} />
      {stage === "email" && (<>
        <h1 className="tk-h2">Reset your password</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Enter the email you booked with and we'll send a link to set a new password.</p>
        <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={(e) => { e.preventDefault(); if (emailOk) setStage("sent"); }}>
          <FormField id="fp-email" label="Email address"><Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} iconStart="mail" /></FormField>
          <Button block size="lg" type="submit" disabled={!emailOk}>Send reset link</Button>
        </form>
        <p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-5)" }}><a href="#" onClick={(e) => { e.preventDefault(); go("login"); }}>← Back to log in</a></p>
      </>)}
      {stage === "sent" && (<>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--success-bg)", color: "var(--success-fg)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="mail" size={26} /></div>
        <h1 className="tk-h2">Check your email</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-5)" }}>If an account exists for <strong style={{ color: "var(--text-strong)" }}>{email || "that address"}</strong>, we've sent a link to reset your password. It expires in 30 minutes.</p>
        <Alert tone="info" title="Didn't get it?" style={{ marginBottom: "var(--space-5)" }}>Check spam, or <a href="#" onClick={(e) => { e.preventDefault(); window.tkToast("Reset link sent again"); }}>resend the link</a>. Still stuck? Message us on WhatsApp.</Alert>
        <Button block variant="secondary" onClick={() => setStage("reset")}>I've opened the link</Button>
        <p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-5)" }}><a href="#" onClick={(e) => { e.preventDefault(); go("login"); }}>← Back to log in</a></p>
      </>)}
      {stage === "reset" && (<>
        <h1 className="tk-h2">Set a new password</h1>
        <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Choose a password you don't use anywhere else.</p>
        <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={(e) => { e.preventDefault(); if (pwOk) setStage("done"); }}>
          <FormField id="fp-pw" label="New password"><PasswordInput id="fp-pw" value={pw} onChange={(e) => setPw(e.target.value)} rules={[{ label: "8+ characters", met: pw.length >= 8 }, { label: "A number", met: /\d/.test(pw) }]} /></FormField>
          <FormField id="fp-pw2" label="Confirm new password" error={pw2 && pw !== pw2 ? "Passwords don't match" : undefined}><PasswordInput id="fp-pw2" value={pw2} onChange={(e) => setPw2(e.target.value)} /></FormField>
          <Button block size="lg" type="submit" disabled={!pwOk}>Update password</Button>
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
Object.assign(window, { AccountShell, ProfileWeb, NotificationsWeb, AccountSettingsWeb, LoginWeb, ForgotWeb, ReviewsWeb });

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
              <a href="#tour" onClick={(e) => { e.preventDefault(); go("tour"); }} className="tk-h6" style={{ margin: 0, textDecoration: "none", color: "var(--text-strong)" }}>{tourTitle(r.tourId)}</a>
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
