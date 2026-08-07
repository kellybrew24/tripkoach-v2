const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Input, PasswordInput, FormField, Checkbox, Alert, Icon } = NS;

function AuthFrame({ children, foot }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--shell-content-bg)" }}>
      <div style={{ position: "relative", background: "var(--n-950)", color: "var(--n-0)", padding: "48px", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden" }} className="tk-admin-authaside">
        <img src="https://cdn.tripkoach.com/img/tours/discover-ghana-in-10-days/hero-1440.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.22 }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <img src="../../assets/logo-badge.png" width="38" height="38" alt="" />
          <strong style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>TripKoach <span style={{ color: "var(--gold-400)" }}>Ops</span></strong>
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, fontSize: 34, maxWidth: "14ch" }}>The back office for every booking in Ghana.</h1>
          <p style={{ color: "rgba(255,255,255,.7)", marginTop: 12, maxWidth: "40ch", fontSize: 14.5 }}>Tours, departures, bookings and payments — one console for the whole operation.</p>
        </div>
        <p style={{ position: "relative", fontSize: 12, color: "rgba(255,255,255,.5)" }}>Staff access only · All actions are logged.</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "32px" }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          {children}
          {foot}
        </div>
      </div>
    </div>
  );
}

function AdminLogin({ go, state }) {
  const locked = state.authView === "locked";
  const wrong = state.authView === "error";
  return (
    <AuthFrame foot={<p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-6)" }}><Icon name="lock" size={12} /> Protected by two-factor authentication</p>}>
      <span className="tk-overline" style={{ color: "var(--gold-700)" }}>Staff sign-in</span>
      <h2 className="tk-h2" style={{ marginTop: 6 }}>Sign in to the console</h2>
      <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Use your TripKoach staff account. Personal customer logins won't work here.</p>
      {locked && <Alert tone="error" title="Account temporarily locked" style={{ marginBottom: "var(--space-4)" }}>Too many failed attempts. Try again in 15 minutes, or contact an administrator to unlock your account.</Alert>}
      {wrong && <Alert tone="error" title="Sign-in failed" style={{ marginBottom: "var(--space-4)" }}>That email and password don't match. You have 2 attempts left before the account locks.</Alert>}
      <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={(e) => { e.preventDefault(); go("mfa"); }}>
        <FormField id="a-email" label="Work email"><Input type="email" autoComplete="username" defaultValue="kwame@tripkoach.com" iconStart="mail" disabled={locked} /></FormField>
        <FormField id="a-pw" label="Password" error={wrong ? "Check your password" : undefined}><PasswordInput id="a-pw" disabled={locked} /></FormField>
        <div className="tk-row" style={{ justifyContent: "space-between" }}>
          <Checkbox id="a-trust" label="Trust this device for 30 days" />
          <Button variant="link" size="sm" type="button" onClick={() => go("reset")}>Forgot password?</Button>
        </div>
        <Button block size="lg" type="submit" disabled={locked}>Continue</Button>
      </form>
    </AuthFrame>
  );
}

function MfaChallenge({ go, state }) {
  const [code, setCode] = React.useState(["", "", "", "", "", ""]);
  const err = state.authView === "mfa-error";
  const refs = React.useRef([]);
  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...code]; next[i] = v; setCode(next);
    if (v && i < 5) refs.current[i + 1] && refs.current[i + 1].focus();
  };
  return (
    <AuthFrame foot={<Button block variant="ghost" style={{ marginTop: "var(--space-4)" }} onClick={() => go("login")}>Back to sign-in</Button>}>
      <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="shield-check" size={24} /></span>
      <h2 className="tk-h2">Two-factor verification</h2>
      <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Enter the 6-digit code from your authenticator app for <strong style={{ color: "var(--text-body)" }}>kwame@tripkoach.com</strong>.</p>
      {err && <Alert tone="error" title="Incorrect code" style={{ marginBottom: "var(--space-4)" }}>That code didn't match or has expired. Codes refresh every 30 seconds.</Alert>}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        {code.map((d, i) => (
          <input key={i} ref={(el) => refs.current[i] = el} value={d} onChange={(e) => setDigit(i, e.target.value)}
            inputMode="numeric" maxLength={1} aria-label={"Digit " + (i + 1)}
            style={{ width: 48, height: 56, textAlign: "center", fontSize: 22, fontWeight: 700, borderRadius: "var(--radius-md)", border: "1px solid " + (err ? "var(--danger-solid)" : "var(--border-input)"), background: "var(--surface-card)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }} />
        ))}
      </div>
      <Button block size="lg" style={{ marginTop: "var(--space-5)" }} onClick={() => go("dashboard")}>Verify and sign in</Button>
      <div className="tk-row" style={{ justifyContent: "center", gap: 6, marginTop: "var(--space-4)" }}>
        <span className="tk-caption">Didn't get a code?</span>
        <Button variant="link" size="sm">Use a backup code</Button>
      </div>
    </AuthFrame>
  );
}

function ResetPassword({ go }) {
  const [sent, setSent] = React.useState(false);
  return (
    <AuthFrame foot={<Button block variant="ghost" style={{ marginTop: "var(--space-4)" }} onClick={() => go("login")}>Back to sign-in</Button>}>
      <h2 className="tk-h2">Reset your password</h2>
      {sent ? (
        <Alert tone="success" title="Check your inbox" style={{ marginTop: "var(--space-5)" }}>If an account exists for that email, we've sent a reset link. It expires in 30 minutes.</Alert>
      ) : (
        <>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Enter your work email and we'll send a reset link. For security, we won't say whether the account exists.</p>
          <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="tk-stack" style={{ gap: "var(--space-4)" }}>
            <FormField id="r-email" label="Work email"><Input type="email" placeholder="you@tripkoach.com" iconStart="mail" /></FormField>
            <Button block size="lg" type="submit">Send reset link</Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}

function SessionExpired({ go }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--shell-content-bg)", padding: 24 }}>
      <div className="tk-card" style={{ maxWidth: 420, width: "100%", textAlign: "center" }}><div className="tk-card__body" style={{ padding: "var(--space-8)", alignItems: "center", gap: "var(--space-3)" }}>
        <span style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--warning-bg)", color: "var(--warning-fg)", display: "grid", placeItems: "center" }}><Icon name="lock" size={24} /></span>
        <h2 className="tk-h3">Your session expired</h2>
        <p className="tk-body-sm tk-muted">For security, we sign staff out after 30 minutes of inactivity. Nothing you saved was lost.</p>
        <Button block size="lg" style={{ marginTop: "var(--space-3)" }} onClick={() => go("login")}>Sign in again</Button>
      </div></div>
    </div>
  );
}
Object.assign(window, { AdminLogin, MfaChallenge, ResetPassword, SessionExpired });
