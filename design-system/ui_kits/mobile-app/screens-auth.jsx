const { Button, Input, PasswordInput, PhoneInput, FormField, Checkbox, Alert, Icon, ErrorSummary, Logo } = window.TripKoachDesignSystem_c9e4af;

function AuthGate({ go, state }) {
  return (
    <div style={{ padding: "var(--space-6) var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div className="tk-stack" style={{ gap: "var(--space-2)", alignItems: "center", textAlign: "center" }}>
        <span style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center" }}>
          <Icon name="lock" size={22} />
        </span>
        <h1 className="tk-h3">Sign in to finish booking</h1>
        <p className="tk-body-sm tk-muted" style={{ maxWidth: "34ch" }}>
          Your departure and traveller details are saved. You will come straight back here.
        </p>
      </div>
      <div className="tk-card"><div className="tk-card__body" style={{ gap: 4 }}>
        <span className="tk-overline">Holding for you</span>
        <strong className="tk-h5">Accra City Tour</strong>
        <span className="tk-body-sm tk-muted">Sat 22 Aug 2026 · 4 travellers · $300</span>
      </div></div>
      <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
        <Button block size="lg" onClick={() => go("login")}>Log in</Button>
        <Button block size="lg" variant="secondary" onClick={() => go("signup")}>Create an account</Button>
      </div>
      <p className="tk-caption" style={{ textAlign: "center" }}>Booking requires an account so we can send your confirmation and let you manage the trip.</p>
    </div>
  );
}

function LoginScreen({ go, state }) {
  const wrong = state.authError;
  return (
    <div style={{ padding: "var(--space-6) var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <Logo src="../../assets/logo-badge.png" size={40} />
      <div className="tk-stack" style={{ gap: 4 }}>
        <h1 className="tk-h2">Welcome back</h1>
        <p className="tk-body-sm tk-muted">Log in to pick up where you left off.</p>
      </div>
      {wrong && <Alert tone="error" title="We could not log you in">That email and password do not match. Check them and try again, or reset your password.</Alert>}
      <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={(e) => { e.preventDefault(); go("checkout"); }}>
        <FormField id="l-email" label="Email address"><Input type="email" autoComplete="email" placeholder="you@example.com" defaultValue="ama@example.com" /></FormField>
        <FormField id="l-pw" label="Password" error={wrong ? "Check your password" : undefined}>
          <PasswordInput id="l-pw" defaultValue="wrongpass" />
        </FormField>
        <div className="tk-row" style={{ justifyContent: "space-between" }}>
          <Checkbox id="remember" label="Keep me signed in" defaultChecked />
          <Button variant="link" size="sm" onClick={() => window.tkToast("Password reset link sent")}>Forgot password?</Button>
        </div>
        <Button block size="lg" type="submit">Log in</Button>
      </form>
      <p className="tk-body-sm" style={{ textAlign: "center" }}>New to TripKoach? <a href="#" onClick={(e) => { e.preventDefault(); go("signup"); }}>Create an account</a></p>
    </div>
  );
}

function SignupScreen({ go }) {
  const [pw, setPw] = React.useState("");
  const [taken, setTaken] = React.useState(false);
  return (
    <div style={{ padding: "var(--space-6) var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <Logo src="../../assets/logo-badge.png" size={40} />
      <div className="tk-stack" style={{ gap: 4 }}>
        <h1 className="tk-h2">Create your account</h1>
        <p className="tk-body-sm tk-muted">Takes a minute. You only need it once.</p>
      </div>
      {taken && <ErrorSummary errors={[{ id: "s-email", message: "That email is already registered — log in instead" }]} />}
      <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={(e) => { e.preventDefault(); go("profile"); }}>
        <FormField id="s-name" label="Full name" help="As it appears on your ID"><Input autoComplete="name" placeholder="Ama Mensah" /></FormField>
        <FormField id="s-email" label="Email address" error={taken ? "That email is already registered" : undefined}
          help="We send your booking confirmation here"><Input type="email" autoComplete="email" placeholder="you@example.com" /></FormField>
        <FormField id="s-phone" label="Phone number" help="For urgent updates about your departure"><PhoneInput id="s-phone" /></FormField>
        <FormField id="s-pw" label="Password">
          <PasswordInput id="s-pw" value={pw} onChange={(e) => setPw(e.target.value)}
            rules={[{ label: "8+ characters", met: pw.length >= 8 }, { label: "A letter", met: /[a-z]/i.test(pw) }, { label: "A number", met: /\d/.test(pw) }]} />
        </FormField>
        <Checkbox id="s-terms" label="I agree to the booking terms and cancellation policy" />
        <Button block size="lg" type="submit">Create account</Button>
        <Button block variant="ghost" size="sm" type="button" onClick={() => setTaken(!taken)}>Preview: email already used</Button>
      </form>
    </div>
  );
}

function ProfileScreen({ go }) {
  return (
    <div style={{ padding: "var(--space-6) var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div className="tk-stack" style={{ gap: 4 }}>
        <span className="tk-overline">Step 2 of 2</span>
        <h1 className="tk-h2">Complete your profile</h1>
        <p className="tk-body-sm tk-muted">Guides use this to prepare for your trip. You can change it any time.</p>
      </div>
      <form className="tk-stack" style={{ gap: "var(--space-4)" }} onSubmit={(e) => { e.preventDefault(); go("checkout"); }}>
        <FormField id="p-country" label="Country of residence" optional><Input defaultValue="Ghana" /></FormField>
        <FormField id="p-emergency" label="Emergency contact" help="Name and phone number of someone we can reach"><Input placeholder="Kofi Mensah, 024 555 0199" /></FormField>
        <FormField id="p-diet" label="Dietary needs" optional><Input placeholder="Vegetarian, no shellfish…" /></FormField>
        <Button block size="lg" type="submit">Save and continue</Button>
        <Button block variant="ghost" type="button" onClick={() => go("checkout")}>Skip for now</Button>
      </form>
    </div>
  );
}
Object.assign(window, { AuthGate, LoginScreen, SignupScreen, ProfileScreen });
