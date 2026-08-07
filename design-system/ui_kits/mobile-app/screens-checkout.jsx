const { Button, Input, FormField, Textarea, NumberStepper, CheckoutStepper, DeparturePicker, OrderSummary, PromoCode, PaymentForm, ConfirmationPanel, Alert, Checkbox, Icon, StatusBadge, Price, ErrorSummary, Accordion } = window.TripKoachDesignSystem_c9e4af;

const STEPS = ["Departure", "Travellers", "Review", "Payment", "Done"];

function CheckoutScreen({ go, state, setState }) {
  const t = state.tour || window.TK_DATA.tours[0];
  const [step, setStep] = React.useState(state.step || 0);
  const [dep, setDep] = React.useState(state.departure || "d2");
  const [pax, setPax] = React.useState(4);
  const [mode, setMode] = React.useState("later");
  const [errors, setErrors] = React.useState([]);
  const departure = (t.departures || []).find(d => d.id === dep) || (t.departures || [])[1];
  const unit = window.TK_PRICE.perPerson(t, pax);
  const total = unit * pax;
  const nextTier = window.TK_PRICE.nextTier(t, pax);
  const cur = state.currency || "USD";
  const M = (u) => window.tkMoney(u, cur);

  const summary = (
    <OrderSummary
      lines={[{ label: M(unit) + "/person × " + pax + " " + (pax === 1 ? "traveller" : "travellers"), amount: window.tkCvt(total, cur) }]}
      total={window.tkCvt(total, cur)} currency={cur} payMode={mode}>
      {nextTier && <p className="tk-help" style={{ display: "flex", gap: 6, color: "var(--success-fg)" }}><Icon name="users" size={14} />Add {nextTier.minPax - pax} more and everyone pays {M(nextTier.price)}rice}/person.</p>}
      <PromoCode state="idle" />
    </OrderSummary>
  );

  const next = () => { setErrors([]); setStep(s => Math.min(4, s + 1)); };
  const back = () => setStep(s => Math.max(0, s - 1));

  if (step === 4) {
    const paid = mode === "now";
    return (
      <div style={{ padding: "var(--space-6) var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <ConfirmationPanel reference="TK-4821" status={paid ? "confirmed" : "pending"} title={paid ? "You're all set" : "Your spot is reserved"}
          subtitle={`We emailed ${paid ? "your receipt" : "the details"} to ama@example.com. ${t.title.split("&")[0].trim()}, ${departure.date}.`}>
          <div className="tk-card" style={{ width: "100%", textAlign: "start" }}><div className="tk-card__body">
            <div className="tk-summary__line"><span>Tour</span><span>{t.title}</span></div>
            <div className="tk-summary__line"><span>Departure</span><span>{departure.date}</span></div>
            <div className="tk-summary__line"><span>Travellers</span><span>{pax}</span></div>
            <div className="tk-summary__line"><span>{paid ? "Total paid" : "Total due"}</span><span>{M(total)}</span></div>
          </div></div>
          {paid
            ? <Alert tone="success" title="Payment received">
                We charged your card <strong>{M(total)}</strong> via Paystack. Your spots are confirmed — no further action needed.
              </Alert>
            : <Alert tone="warning" title="How to pay">
                Your koach will email payment options (bank transfer, mobile money or card) to <strong>ama@example.com</strong>, quoting <strong>TK-4821</strong>. Pay at least 5 days before departure to lock in your spots.
              </Alert>}
        </ConfirmationPanel>
        <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
          <Button block size="lg" onClick={() => go("bookings")}>View in my bookings</Button>
          <Button block variant="secondary" iconStart="download" onClick={() => window.tkToast("Preparing your booking PDF…")}>Save details</Button>
          <Button block variant="ghost" onClick={() => go("browse")}>Browse more tours</Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 96 }}>
      <div style={{ padding: "var(--space-4)", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
        <CheckoutStepper steps={STEPS} current={step} errorAt={errors.length ? step : -1} onStepClick={setStep} />
      </div>
      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {errors.length > 0 && <ErrorSummary errors={errors} />}

        {step === 0 && (
          <>
            <h1 className="tk-h3">When would you like to go?</h1>
            <DeparturePicker departures={window.tkDeps(t.departures || [], cur)} value={dep} onChange={setDep} currency={cur} legend="Available departures" />
            <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
              <span className="tk-label" id="pax-l">How many travellers?</span>
              <div className="tk-row" style={{ justifyContent: "space-between" }}>
                <NumberStepper id="pax" value={pax} max={departure ? departure.spotsLeft : 10} onChange={setPax} />
                <Price amount={window.tkCvt(total, cur)} currency={cur} unit="total" />
              </div>
              <p className="tk-help">{departure ? `${departure.spotsLeft} spots left on this departure` : ""}</p>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="tk-h3">Who is travelling?</h1>
            <div className="tk-card"><div className="tk-card__body" style={{ gap: "var(--space-4)" }}>
              <span className="tk-overline">Lead traveller</span>
              <FormField id="c-name" label="Full name" required><Input defaultValue="Ama Mensah" autoComplete="name" /></FormField>
              <FormField id="c-email" label="Email address" required help="Your confirmation goes here"><Input type="email" defaultValue="ama@example.com" /></FormField>
              <FormField id="c-phone" label="Phone number" required><Input type="tel" defaultValue="024 555 0142" /></FormField>
            </div></div>
            {[2,3,4].slice(0, pax - 1).map((n) => (
              <div className="tk-card" key={n}><div className="tk-card__body" style={{ gap: "var(--space-4)" }}>
                <span className="tk-overline">Traveller {n}</span>
                <FormField id={`t${n}-name`} label="Full name" required
                  error={n === 3 && errors.length ? "Enter a name for traveller 3" : undefined}><Input placeholder="As on their ID" /></FormField>
                <FormField id={`t${n}-age`} label="Age group" optional><Input placeholder="Adult" /></FormField>
              </div></div>
            ))}
            <FormField id="c-notes" label="Special requests" optional help="Dietary needs, mobility, a birthday we should know about">
              <Textarea rows={3} placeholder="Anything we should know?" />
            </FormField>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="tk-h3">Check everything over</h1>
            <div className="tk-card"><div className="tk-card__body">
              <span className="tk-overline">{t.region}, Ghana</span>
              <strong className="tk-h5">{t.title}</strong>
              <div className="tk-summary__line"><span>Departure</span><span>{departure.date}, {departure.time}</span></div>
              <div className="tk-summary__line"><span>Travellers</span><span>{pax}</span></div>
              <div className="tk-summary__line"><span>Lead traveller</span><span>Ama Mensah</span></div>
              <Button variant="link" size="sm" onClick={() => setStep(1)}>Change details</Button>
            </div></div>
            {summary}
            <Accordion items={[{ id: "policy", title: "Cancellation policy", content:
              <p>Free cancellation until 7 days before departure. Between 7 and 2 days, half the total is held. Inside 48 hours the booking is non-refundable. Because card payments are not live yet, nothing is charged today and no refund is needed to cancel.</p> }]} />
            <Checkbox id="agree" label="I agree to the booking terms and cancellation policy" />
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="tk-h3">How would you like to pay?</h1>
            <PaymentForm mode={mode} onModeChange={setMode} payNowEnabled amountLabel={M(total)} dueBy="5 days before departure" />
            {summary}
          </>
        )}
      </div>

      <div className="tk-stickybar">
        {step > 0 && <Button variant="secondary" onClick={back} iconStart="arrow-left" aria-label="Back a step">Back</Button>}
        <div className="tk-stack" style={{ gap: 0, marginInlineStart: step > 0 ? 0 : undefined }}>
          <span className="tk-caption">Total {mode === "later" ? "due" : ""}</span>
          <strong className="tk-num" style={{ fontSize: 17, fontWeight: 800 }}>{M(total)}</strong>
        </div>
        <Button style={{ marginInlineStart: "auto" }} size="lg" iconEnd={step === 3 && mode === "now" ? "external-link" : undefined} onClick={step === 3 ? () => { setStep(4); } : next}>
          {step === 3 ? (mode === "now" ? "Pay with Paystack" : "Confirm booking") : "Continue"}
        </Button>
      </div>
    </div>
  );
}
Object.assign(window, { CheckoutScreen });
