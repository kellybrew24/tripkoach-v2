const NS = window.TripKoachDesignSystem_c9e4af;
const { Button, Input, PasswordInput, FormField, Checkbox, Alert, Icon } = NS;

// TRI-923 — the console sign-in aside rotates a small curated set of imagery + a
// restrained time-of-day greeting by the operator's LOCAL time, so the panel feels
// alive without changing the branded, staff-only copy. Imagery is served from
// cdn.tripkoach.com (TRI-914/918 hard rule — no dev-hosted / base64 heroes); the
// per-bucket scrim keeps the aside dark enough for white copy at any hour.
const TK_ADMIN_PROMO_BUCKET = (d) => { const h = (d || new Date()).getHours(); return h < 5 ? "night" : h < 11 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night"; };
// TRI-925 — returning-operator detection. We stamp a durable, best-effort flag once
// an operator completes sign-in on this device, so the console aside greets a
// returning operator with "Welcome back" and a first-time device with the neutral
// time-of-day greeting. Privacy modes that throw on storage simply read as "new".
const TK_ADMIN_RETURNING_KEY = "tk_admin_returning";
function tkAdminIsReturning() {
  try { if (window.localStorage && window.localStorage.getItem(TK_ADMIN_RETURNING_KEY)) return true; } catch (e) {}
  try { if (document.cookie && /(?:^|;\s*)tk_admin_returning=1(?:;|$)/.test(document.cookie)) return true; } catch (e) {}
  return false;
}
function tkAdminMarkReturning() {
  try { if (window.localStorage) window.localStorage.setItem(TK_ADMIN_RETURNING_KEY, "1"); } catch (e) {}
  try { document.cookie = "tk_admin_returning=1; path=/; max-age=31536000; SameSite=Lax"; } catch (e) {}
}
const TK_ADMIN_PROMO = {
  morning:   { img: "https://cdn.tripkoach.com/img/posts/green-season-ghana-hero.jpg",                greet: "Good morning",   scrim: "linear-gradient(180deg, rgba(60,42,15,.30), rgba(12,12,14,.74))" },
  afternoon: { img: "https://cdn.tripkoach.com/img/posts/kakum-canopy-walk-cape-coast-day-trip-hero.jpg", greet: "Good afternoon", scrim: "linear-gradient(180deg, rgba(15,30,48,.30), rgba(12,12,14,.74))" },
  evening:   { img: "https://cdn.tripkoach.com/img/posts/mole-larabanga-northern-ghana-weekend-hero.jpg",  greet: "Good evening",   scrim: "linear-gradient(180deg, rgba(120,52,12,.36), rgba(14,10,8,.8))" },
  night:     { img: "https://cdn.tripkoach.com/img/posts/cape-coast-castles-guide-hero.jpg",          greet: "Good evening",   scrim: "linear-gradient(180deg, rgba(26,26,72,.42), rgba(6,8,20,.84))" },
};

function AuthFrame({ children, foot }) {
  const promo = TK_ADMIN_PROMO[TK_ADMIN_PROMO_BUCKET()];
  const returning = tkAdminIsReturning(); // TRI-925 — new device vs returning operator
  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--shell-content-bg)" }}>
      <div style={{ position: "relative", background: "var(--n-950)", color: "var(--n-0)", padding: "48px", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden" }} className="tk-admin-authaside">
        <img src={promo.img} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.3 }} />
        <span style={{ position: "absolute", inset: 0, background: promo.scrim }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <img src="../../assets/logo-badge.png" width="38" height="38" alt="" />
          <strong style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>TripKoach <span style={{ color: "var(--gold-400)" }}>Ops</span></strong>
        </div>
        <div style={{ position: "relative" }}>
          <span className="tk-overline" style={{ color: "var(--gold-400)" }}>{returning ? "Welcome back" : promo.greet}</span>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.05, fontSize: 34, maxWidth: "14ch", marginTop: 8 }}>The back office for every booking in Ghana.</h1>
          <p style={{ color: "rgba(255,255,255,.7)", marginTop: 12, maxWidth: "40ch", fontSize: 14.5 }}>{returning ? "Sign in to pick up where you left off — bookings, departures and payments." : "Tours, departures, bookings and payments — one console for the whole operation."}</p>
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
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [busy, setBusy] = React.useState(false);
  const [liveErr, setLiveErr] = React.useState(null); // { title, msg }
  const locked = state.authView === "locked";
  const wrong = state.authView === "error" || !!liveErr;
  // Live sign-in: POST /api/admin/auth/login, then hydrate + land on dashboard
  // (or the MFA challenge if the server asks for a second factor). Flag off →
  // the prototype path (straight to the MFA demo screen) is untouched.
  const submit = (e) => {
    e.preventDefault();
    if (!LIVE) { go("mfa"); return; }
    const form = e.target;
    // TRI-990: read by stable id, NOT by input[type]. The DS PasswordInput's
    // "Show password" toggle flips the input's type from "password" to "text"
    // when revealed, so a `input[type="password"]` selector returns null and the
    // password reads as empty — the backend then 400s "email and password are
    // required" on a fully-filled form. Ids ("a-email"/"a-pw") are stamped onto
    // the inner inputs by FormField and never change with reveal state.
    const email = (form.querySelector('#a-email') || {}).value || "";
    const pwEl = form.querySelector('#a-pw') || {};
    const password = pwEl.value || "";
    const trust = !!(form.querySelector("#a-trust") && form.querySelector("#a-trust").checked);
    // TRI-952: remember the email being authenticated so the MFA screen names the
    // real account (not a hardcoded seed) during the second factor.
    window.TK_PENDING_STAFF_EMAIL = email;
    setBusy(true); setLiveErr(null);
    window.TK_ADMIN_API.login(email, password, { trust }).then((res) => {
      if (res && (res.mfaRequired || res.mfa_required || res.requiresMfa)) { setBusy(false); go("mfa"); return; }
      // TRI-912 enforcement: MFA is required for this role but the account has no factor yet. The server
      // issued an enroll-gated half-auth session; route to the enroll gate to set one up before entering.
      if (res && (res.mfaEnrollmentRequired || res.mfa_enrollment_required)) { setBusy(false); go("mfa-enroll"); return; }
      // Logged in — record session + hydrate, then go to the dashboard.
      tkAdminMarkReturning(); // TRI-925 — this device has now completed a staff sign-in
      Promise.resolve(window.TK_ADMIN_ENTER(res)).then(() => { setBusy(false); go("dashboard"); }, () => { setBusy(false); go("dashboard"); });
    }, (err) => {
      setBusy(false);
      if (err && err.status === 423) setLiveErr({ title: "Account temporarily locked", msg: "Too many failed attempts. Try again later, or contact an administrator to unlock your account." });
      else if (err && err.status === 401) setLiveErr({ title: "Sign-in failed", msg: "That email and password don't match. Please try again." });
      else setLiveErr({ title: "Couldn't sign in", msg: (err && err.message) || "We couldn't reach the console service. Please try again." });
    });
  };
  return (
    <AuthFrame foot={<p className="tk-caption" style={{ textAlign: "center", marginTop: "var(--space-3)" }}><Icon name="lock" size={12} /> Protected by two-factor authentication</p>}>
      <span className="tk-overline" style={{ color: "var(--gold-700)" }}>Staff sign-in</span>
      <h2 className="tk-h2" style={{ marginTop: 6 }}>Sign in to the console</h2>
      <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Use your TripKoach staff account. Personal customer logins won't work here.</p>
      {locked && <Alert tone="error" title="Account temporarily locked" style={{ marginBottom: "var(--space-4)" }}>Too many failed attempts. Try again in 15 minutes, or contact an administrator to unlock your account.</Alert>}
      {liveErr && <Alert tone="error" title={liveErr.title} style={{ marginBottom: "var(--space-4)" }}>{liveErr.msg}</Alert>}
      {wrong && !liveErr && <Alert tone="error" title="Sign-in failed" style={{ marginBottom: "var(--space-4)" }}>That email and password don't match. You have 2 attempts left before the account locks.</Alert>}
      <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={submit}>
        <FormField id="a-email" label="Work email"><Input type="email" autoComplete="username" placeholder="you@tripkoach.com" iconStart="mail" disabled={locked} /></FormField>
        <FormField id="a-pw" label="Password" error={wrong ? "Check your password" : undefined}><PasswordInput id="a-pw" disabled={locked} /></FormField>
        <div className="tk-row" style={{ justifyContent: "space-between" }}>
          <Checkbox id="a-trust" label="Trust this device for 14 days" />
          <Button variant="link" size="sm" type="button" onClick={() => go("reset")}>Forgot password?</Button>
        </div>
        <Button block size="lg" type="submit" disabled={locked || busy}>{busy ? "Signing in…" : "Continue"}</Button>
      </form>
    </AuthFrame>
  );
}

function MfaChallenge({ go, state }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [code, setCode] = React.useState(["", "", "", "", "", ""]);
  const [recovery, setRecovery] = React.useState("");
  const [useRecovery, setUseRecovery] = React.useState(false); // LIVE only — see below
  const [busy, setBusy] = React.useState(false);
  const [liveErr, setLiveErr] = React.useState(false);
  // TRI-952: name the real account being verified (captured at the login step),
  // not a hardcoded seed email. Neutral phrasing if we don't have it.
  const pendingEmail = (LIVE && window.TK_PENDING_STAFF_EMAIL) || "";
  const err = state.authView === "mfa-error" || liveErr;
  const verify = () => {
    if (!LIVE) { go("dashboard"); return; }
    const value = useRecovery ? recovery.trim() : code.join("");
    setBusy(true); setLiveErr(false);
    // POST /auth/mfa accepts a live TOTP OR a single-use recovery code (TRI-895).
    window.TK_ADMIN_API.verifyMfa(value).then((res) => {
      tkAdminMarkReturning(); // TRI-925 — completed sign-in (TOTP / recovery)
      Promise.resolve(window.TK_ADMIN_ENTER(res)).then(() => { setBusy(false); go("dashboard"); }, () => { setBusy(false); go("dashboard"); });
    }, () => { setBusy(false); setLiveErr(true); });
  };
  const refs = React.useRef([]);
  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...code]; next[i] = v; setCode(next);
    if (v && i < 5) refs.current[i + 1] && refs.current[i + 1].focus();
  };
  // The recovery-code path is a LIVE-only enhancement; with the flag off the
  // "Use a backup code" link stays inert and the rendered DOM is byte-identical
  // to the DS prototype (useRecovery can never flip true).
  return (
    <AuthFrame foot={<Button block variant="ghost" style={{ marginTop: "var(--space-4)" }} onClick={() => go("login")}>Back to sign-in</Button>}>
      <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="shield-check" size={24} /></span>
      <h2 className="tk-h2">Two-factor verification</h2>
      {useRecovery
        ? <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Enter one of your one-time recovery codes. Each code works only once.</p>
        : <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Enter the 6-digit code from your authenticator app{pendingEmail ? <> for <strong style={{ color: "var(--text-body)" }}>{pendingEmail}</strong></> : null}.</p>}
      {err && <Alert tone="error" title="Incorrect code" style={{ marginBottom: "var(--space-4)" }}>{useRecovery ? "That recovery code didn't match or has already been used." : "That code didn't match or has expired. Codes refresh every 30 seconds."}</Alert>}
      {useRecovery ? (
        <FormField id="mfa-recovery" label="Recovery code">
          <Input id="mfa-recovery" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX" autoComplete="one-time-code"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em", textTransform: "uppercase" }} />
        </FormField>
      ) : (
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          {code.map((d, i) => (
            <input key={i} ref={(el) => refs.current[i] = el} value={d} onChange={(e) => setDigit(i, e.target.value)}
              inputMode="numeric" maxLength={1} aria-label={"Digit " + (i + 1)}
              style={{ width: 48, height: 56, textAlign: "center", fontSize: 22, fontWeight: 700, borderRadius: "var(--radius-md)", border: "1px solid " + (err ? "var(--danger-solid)" : "var(--border-input)"), background: "var(--surface-card)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }} />
          ))}
        </div>
      )}
      <Button block size="lg" style={{ marginTop: "var(--space-5)" }} disabled={busy} onClick={verify}>{busy ? "Verifying…" : "Verify and sign in"}</Button>
      <div className="tk-row" style={{ justifyContent: "center", gap: 6, marginTop: "var(--space-4)" }}>
        {useRecovery
          ? <Button variant="link" size="sm" onClick={() => { setUseRecovery(false); setLiveErr(false); }}>Use an authenticator code instead</Button>
          : <>
              <span className="tk-caption">Didn't get a code?</span>
              <Button variant="link" size="sm" onClick={() => { if (LIVE) { setUseRecovery(true); setLiveErr(false); } }}>Use a backup code</Button>
            </>}
      </div>
    </AuthFrame>
  );
}

// TRI-912 · Login-time MFA enrollment gate. Shown when a factor-less staffer in an MFA-enforced role
// signs in: the server returned { mfaEnrollmentRequired: true } and issued an enroll-gated half-auth
// session that can reach only /auth/mfa/*. We reuse the same enroll → QR → verify → recovery-codes flow
// as the in-console MfaEnrollDrawer (TRI-899/911); on a successful verify the server promotes the session
// and returns { staff, permissions, recoveryCodes }, so we hydrate and land on the dashboard. LIVE only —
// with the flag off this screen is never routed to, so the prototype render stays byte-identical.
function MfaEnrollGate({ go }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [data, setData] = React.useState(null);          // { secret, otpauthUri, issuer }
  const [step, setStep] = React.useState("scan");        // "scan" | "codes"
  const [code, setCode] = React.useState(["", "", "", "", "", ""]);
  const [recoveryCodes, setRecoveryCodes] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const enterRes = React.useRef(null);
  const refs = React.useRef([]);
  // Begin enrollment on mount: fetch a fresh secret + otpauth URI for the QR.
  React.useEffect(() => {
    if (!LIVE) return undefined;
    let live = true;
    window.TK_ADMIN_API.mfaEnroll().then(
      (r) => { if (live) setData(r); },
      () => { if (live) setLoadErr(true); },
    );
    return () => { live = false; };
  }, []);
  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...code]; next[i] = v; setCode(next);
    if (v && i < 5) refs.current[i + 1] && refs.current[i + 1].focus();
  };
  const verify = () => {
    setBusy(true); setErr(false);
    window.TK_ADMIN_API.mfaVerifyEnroll(code.join("")).then(
      (res) => { enterRes.current = res; setRecoveryCodes((res && res.recoveryCodes) || []); setStep("codes"); setBusy(false); },
      () => { setBusy(false); setErr(true); setCode(["", "", "", "", "", ""]); },
    );
  };
  const enter = () => {
    const res = enterRes.current || {};
    tkAdminMarkReturning(); // TRI-925 — completed enrollment + sign-in on this device
    Promise.resolve(window.TK_ADMIN_ENTER(res)).then(() => go("dashboard"), () => go("dashboard"));
  };
  const secretPretty = data && data.secret ? data.secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim() : "";
  return (
    <AuthFrame foot={step === "scan" ? <Button block variant="ghost" style={{ marginTop: "var(--space-4)" }} onClick={() => go("login")}>Back to sign-in</Button> : null}>
      <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}><Icon name="shield-check" size={24} /></span>
      {step === "scan" ? (
        <>
          <h2 className="tk-h2">Set up two-factor authentication</h2>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-5)" }}>Your role requires two-factor authentication. Scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code to finish.</p>
          {loadErr && <Alert tone="error" title="Couldn't start setup" style={{ marginBottom: "var(--space-4)" }}>We couldn't reach the console service. Please go back and sign in again.</Alert>}
          {data && data.otpauthUri && (
            <div style={{ display: "grid", placeItems: "center", marginBottom: "var(--space-4)" }}>
              <div style={{ padding: 10, background: "#fff", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
                <MfaQr text={data.otpauthUri} px={184} />
              </div>
            </div>
          )}
          {data && data.secret && (
            <FormField id="mfa-enroll-secret" label="Setup key" hint="Can't scan? Type or paste this into your authenticator app.">
              <div className="tk-row" style={{ gap: 8 }}>
                <Input id="mfa-enroll-secret" readOnly value={secretPretty} style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.08em" }} />
                <Button variant="secondary" size="sm" iconStart="copy" onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(data.secret); } catch (_) {} }}>Copy</Button>
              </div>
            </FormField>
          )}
          {err && <Alert tone="error" title="Incorrect code" style={{ marginTop: "var(--space-4)", marginBottom: "var(--space-2)" }}>That code didn't match or has expired. Codes refresh every 30 seconds.</Alert>}
          <p className="tk-caption" style={{ marginTop: "var(--space-4)", marginBottom: 6 }}>Enter the 6-digit code</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            {code.map((d, i) => (
              <input key={i} ref={(el) => refs.current[i] = el} value={d} onChange={(e) => setDigit(i, e.target.value)}
                inputMode="numeric" maxLength={1} aria-label={"Digit " + (i + 1)}
                style={{ width: 48, height: 56, textAlign: "center", fontSize: 22, fontWeight: 700, borderRadius: "var(--radius-md)", border: "1px solid " + (err ? "var(--danger-solid)" : "var(--border-input)"), background: "var(--surface-card)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }} />
            ))}
          </div>
          <Button block size="lg" style={{ marginTop: "var(--space-5)" }} disabled={busy || !data || code.join("").length !== 6} onClick={verify}>{busy ? "Verifying…" : "Verify and continue"}</Button>
        </>
      ) : (
        <>
          <h2 className="tk-h2">Save your recovery codes</h2>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-5)" }}>Two-factor authentication is now on. Store these one-time recovery codes somewhere safe — each works once if you lose access to your authenticator.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "var(--space-4)", background: "var(--surface-muted)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", marginBottom: "var(--space-3)" }}>
            {(recoveryCodes || []).map((c) => <span key={c} className="tk-num" style={{ fontSize: 14, letterSpacing: "0.04em", color: "var(--text-strong)" }}>{c}</span>)}
          </div>
          <Button block variant="secondary" size="sm" iconStart="copy" style={{ marginBottom: "var(--space-4)" }} onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText((recoveryCodes || []).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (_) {} }}>{copied ? "Copied" : "Copy codes"}</Button>
          <Button block size="lg" onClick={enter}>Enter the console</Button>
        </>
      )}
    </AuthFrame>
  );
}

// TRI-1000 · Forgot password — request stage (from the sign-in screen). Previously this only flipped a
// local `sent` flag without calling anything. Live → POST /api/admin/auth/password-reset/request, which
// always returns 200 (no account enumeration), so we show the same "check your inbox" state regardless.
// Flag off → keep the prototype behaviour (byte-identical).
function ResetPassword({ go }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [err, setErr] = React.useState(null);
  const submit = (e) => {
    e.preventDefault();
    if (!LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.requestPasswordReset) { setSent(true); return; }
    setBusy(true); setErr(null);
    window.TK_ADMIN_API.requestPasswordReset(email.trim()).then(function () {
      setBusy(false); setSent(true);
    }, function (ex) {
      setBusy(false); setErr((ex && ex.message) || "We couldn't send the reset link. Please try again.");
    });
  };
  return (
    <AuthFrame foot={<Button block variant="ghost" style={{ marginTop: "var(--space-4)" }} onClick={() => go("login")}>Back to sign-in</Button>}>
      <h2 className="tk-h2">Reset your password</h2>
      {sent ? (
        <Alert tone="success" title="Check your inbox" style={{ marginTop: "var(--space-5)" }}>If an account exists for that email, we've sent a reset link. It expires in 60 minutes.</Alert>
      ) : (
        <>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Enter your work email and we'll send a reset link. For security, we won't say whether the account exists.</p>
          {err && <Alert tone="error" title="Couldn't send reset link" style={{ marginBottom: "var(--space-4)" }}>{err}</Alert>}
          <form onSubmit={submit} className="tk-stack" style={{ gap: "var(--space-4)" }}>
            <FormField id="r-email" label="Work email"><Input id="r-email" type="email" placeholder="you@tripkoach.com" iconStart="mail" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
            <Button block size="lg" type="submit" disabled={busy || (LIVE && !email.trim())}>{busy ? "Sending…" : "Send reset link"}</Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}

// TRI-1000 · Forgot password — consume stage. Reached via the emailed link
// (${ADMIN_BASE_URL}/reset-password?token=…). Sets a new password with the single-use token, then routes
// back to sign-in. The token is read from the query string once on mount.
function ResetPasswordConsume({ go }) {
  const token = React.useMemo(() => {
    try { return new URLSearchParams(window.location.search || "").get("token") || ""; } catch (e) { return ""; }
  }, []);
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const pwOk = pw.length >= 10 && pw === pw2;
  const submit = (e) => {
    e.preventDefault();
    if (!token) { setErr("This reset link is invalid or has expired. Request a new one."); return; }
    if (!window.TK_ADMIN_API || !window.TK_ADMIN_API.consumePasswordReset) { setErr("Password reset is unavailable right now. Please try again later."); return; }
    setBusy(true); setErr(null);
    window.TK_ADMIN_API.consumePasswordReset(token, pw).then(function () {
      setBusy(false); setDone(true);
    }, function (ex) {
      setBusy(false);
      setErr(ex && (ex.status === 400) ? "This reset link is invalid or has expired. Request a new one." : (ex && ex.message) || "We couldn't reset your password. Please try again.");
    });
  };
  return (
    <AuthFrame foot={<Button block variant="ghost" style={{ marginTop: "var(--space-4)" }} onClick={() => go("login")}>Back to sign-in</Button>}>
      {done ? (
        <>
          <h2 className="tk-h2">Password updated</h2>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>You're all set. Sign in with your new password to continue.</p>
          <Button block size="lg" onClick={() => go("login")}>Go to sign-in</Button>
        </>
      ) : (
        <>
          <h2 className="tk-h2">Set a new password</h2>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Choose a strong password you don't use anywhere else.</p>
          {err && <Alert tone="error" title="We couldn't reset your password" style={{ marginBottom: "var(--space-4)" }}>{err}</Alert>}
          <form onSubmit={submit} className="tk-stack" style={{ gap: "var(--space-4)" }}>
            <FormField id="rp-pw" label="New password" hint="At least 10 characters."><PasswordInput id="rp-pw" value={pw} onChange={(e) => setPw(e.target.value)} /></FormField>
            <FormField id="rp-pw2" label="Confirm new password" error={pw2 && pw !== pw2 ? "Passwords don't match" : undefined}><PasswordInput id="rp-pw2" value={pw2} onChange={(e) => setPw2(e.target.value)} /></FormField>
            <Button block size="lg" type="submit" disabled={!pwOk || busy}>{busy ? "Updating…" : "Update password"}</Button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}

// TRI-1032 · Accept invite — set-password stage. Reached via the emailed staff-invite link
// (${ADMIN_BASE_URL}/accept-invite?token=…). Previews who the invite is for, then sets the initial
// password with the single-use token (POST /api/admin/staff/accept), which activates the account.
// On success the invitee signs in normally (and enrols MFA on first login if their role enforces it).
// The token is read from the query string once on mount. This mirrors ResetPasswordConsume (TRI-1000) —
// the FE was never built for the invite path, so the emailed link landed on the sign-in screen.
function AcceptInvite({ go }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const token = React.useMemo(() => {
    try { return new URLSearchParams(window.location.search || "").get("token") || ""; } catch (e) { return ""; }
  }, []);
  const [preview, setPreview] = React.useState(null); // {valid, email, name, role} | {valid:false, reason}
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const pwOk = pw.length >= 10 && pw === pw2;

  React.useEffect(() => {
    if (!LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.previewInvite) { setPreview({ valid: true }); return; }
    if (!token) { setPreview({ valid: false, reason: "not_found" }); return; }
    window.TK_ADMIN_API.previewInvite(token).then(function (r) {
      setPreview((r && r.invite) ? r.invite : (r || { valid: false, reason: "not_found" }));
    }, function () { setPreview({ valid: false, reason: "not_found" }); });
  }, [token]);

  const submit = (e) => {
    e.preventDefault();
    if (!token) { setErr("This invite link is invalid or has expired. Ask an admin to resend it."); return; }
    if (!window.TK_ADMIN_API || !window.TK_ADMIN_API.acceptInvite) { setErr("Setting your password is unavailable right now. Please try again later."); return; }
    setBusy(true); setErr(null);
    window.TK_ADMIN_API.acceptInvite(token, pw).then(function () {
      setBusy(false); setDone(true);
    }, function (ex) {
      setBusy(false);
      var expired = ex && (ex.status === 410 || (ex.code === "expired"));
      setErr(expired ? "This invite link has expired. Ask an admin to resend it."
        : (ex && (ex.status === 400 || ex.status === 409)) ? "This invite link is invalid or has already been used. Ask an admin to resend it."
        : (ex && ex.message) || "We couldn't set your password. Please try again.");
    });
  };

  const backFoot = <Button block variant="ghost" style={{ marginTop: "var(--space-4)" }} onClick={() => go("login")}>Back to sign-in</Button>;

  if (!preview) {
    return <AuthFrame foot={backFoot}><p className="tk-body-sm tk-muted" style={{ marginTop: 4 }}>Checking your invite…</p></AuthFrame>;
  }
  if (preview.valid === false) {
    const msg = ({
      expired: "This invite link has expired. Ask an admin to send you a fresh one.",
      already_accepted: "This invite has already been used. Try signing in, or use “Forgot password?” to reset.",
      not_pending: "This account is no longer awaiting acceptance. Try signing in instead.",
    })[preview.reason] || "This invite link is invalid. Ask an admin to send you a fresh one.";
    return (
      <AuthFrame foot={backFoot}>
        <h2 className="tk-h2">Invite link problem</h2>
        <Alert tone="error" title="We couldn't open this invite" style={{ marginTop: "var(--space-5)" }}>{msg}</Alert>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame foot={backFoot}>
      {done ? (
        <>
          <h2 className="tk-h2">You're all set</h2>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>Your password is set and your account is active. Sign in to get started.</p>
          <Button block size="lg" onClick={() => go("login")}>Go to sign-in</Button>
        </>
      ) : (
        <>
          <h2 className="tk-h2">Set your password</h2>
          <p className="tk-body-sm tk-muted" style={{ marginTop: 4, marginBottom: "var(--space-6)" }}>
            {preview.email ? <>Welcome{preview.name ? ", " + preview.name.split(/\s+/)[0] : ""}. Choose a password for <strong>{preview.email}</strong> to finish setting up your TripKoach admin account.</>
              : "Choose a strong password you don't use anywhere else to finish setting up your account."}
          </p>
          {err && <Alert tone="error" title="We couldn't set your password" style={{ marginBottom: "var(--space-4)" }}>{err}</Alert>}
          <form onSubmit={submit} className="tk-stack" style={{ gap: "var(--space-4)" }}>
            <FormField id="ai-pw" label="Password" hint="At least 10 characters."><PasswordInput id="ai-pw" value={pw} onChange={(e) => setPw(e.target.value)} /></FormField>
            <FormField id="ai-pw2" label="Confirm password" error={pw2 && pw !== pw2 ? "Passwords don't match" : undefined}><PasswordInput id="ai-pw2" value={pw2} onChange={(e) => setPw2(e.target.value)} /></FormField>
            <Button block size="lg" type="submit" disabled={!pwOk || busy}>{busy ? "Setting up…" : "Set password & continue"}</Button>
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
Object.assign(window, { AdminLogin, MfaChallenge, MfaEnrollGate, ResetPassword, ResetPasswordConsume, AcceptInvite, SessionExpired });
