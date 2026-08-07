const { Button, BookingRow, StatusBadge, Tabs, EmptyState, Skeleton, Alert, Modal, Icon, Toast, Accordion, Price } = window.TripKoachDesignSystem_c9e4af;

function BookingsScreen({ go, state, setState }) {
  const cur = state.currency || "USD";
  const [tab, setTab] = React.useState("all");
  const view = state.bookingsView || "list";
  const all = window.TK_DATA.bookings;
  const rows = tab === "all" ? all : all.filter(b => b.status === tab);
  return (
    <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1 className="tk-h2">Your bookings</h1>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "all", label: "All", count: all.length },
        { id: "pending", label: "Pending", count: all.filter(b => b.status === "pending").length },
        { id: "confirmed", label: "Confirmed", count: all.filter(b => b.status === "confirmed").length },
        { id: "cancelled", label: "Cancelled", count: all.filter(b => b.status === "cancelled").length }]} />

      {view === "loading" && (
        <div aria-busy="true" style={{ display: "grid", gap: 12 }}>
          {[0,1,2].map(i => <div className="tk-card" key={i}><div className="tk-card__body" style={{ flexDirection: "row", gap: 12 }}>
            <Skeleton width={64} height={64} radius="var(--radius-md)" />
            <div style={{ flex: 1 }}><Skeleton lines={3} height={10} /></div></div></div>)}
        </div>
      )}

      {view === "empty" && (
        <EmptyState icon="ticket" title="No bookings yet"
          body="When you reserve a tour it shows up here, with your reference and what to pay."
          action={<Button onClick={() => go("browse")}>Browse tours</Button>} />
      )}

      {view === "list" && (
        <>
          {tab !== "cancelled" && (
            <Alert tone="warning" title="One booking is waiting for payment"
              action={<Button variant="link" size="sm" onClick={() => go("booking", { booking: all[0] })}>See how to pay</Button>}>
              TK-4821 is held until 7 Sep.
            </Alert>
          )}
          <div style={{ display: "grid", gap: 12 }}>
            {rows.map(b => (
              <BookingRow key={b.ref} reference={b.ref} title={b.tour} date={b.date}
                travellers={b.travellers} total={window.tkCvt(b.total, cur)} currency={cur} status={b.status}
                onClick={() => go("booking", { booking: b })} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BookingDetailScreen({ go, state, setState }) {
  const cur = state.currency || "USD";
  const b = state.booking || window.TK_DATA.bookings[0];
  const [confirm, setConfirm] = React.useState(false);
  const [status, setStatus] = React.useState(b.status);
  const [toast, setToast] = React.useState(false);
  return (
    <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)", paddingBottom: 40 }}>
      <Button variant="ghost" size="sm" iconStart="arrow-left" onClick={() => go("bookings")} style={{ alignSelf: "flex-start", paddingInline: 0 }}>All bookings</Button>
      <div className="tk-row" style={{ justifyContent: "space-between", gap: 12 }}>
        <div className="tk-stack" style={{ gap: 2 }}>
          <span className="tk-caption tk-num">{b.ref}</span>
          <h1 className="tk-h3">{b.tour}</h1>
        </div>
        <StatusBadge status={status} size="lg" />
      </div>

      {status === "pending" && (
        <Alert tone="warning" title="Payment due by 7 Sep">
          Your koach emailed payment options, quoting <strong>{b.ref}</strong>. Pay at least 5 days before departure to keep your spots.
        </Alert>
      )}
      {status === "cancelled" && (
        <Alert tone="info" title="This booking is cancelled">Nothing was charged. You are welcome to book another departure any time.</Alert>
      )}

      <div className="tk-card"><div className="tk-card__body">
        <div className="tk-summary__line"><span>Departure</span><span>{b.date}, 06:30</span></div>
        <div className="tk-summary__line"><span>Meeting point</span><span>Accra Mall car park</span></div>
        <div className="tk-summary__line"><span>Travellers</span><span>{b.travellers}</span></div>
        <div className="tk-summary__line"><span>Lead traveller</span><span>Ama Mensah</span></div>
        <div className="tk-summary__line"><span>Guide</span><span>Ama Owusu</span></div>
      </div></div>

      <div className="tk-summary">
        <h2 className="tk-h6">Price summary</h2>
        <div className="tk-summary__line"><span>{b.travellers}</span><span>{window.tkMoney(b.total, cur)}</span></div>
        <div className="tk-summary__total"><span>Total due</span><Price amount={window.tkCvt(b.total, cur)} currency={cur} /></div>
        <p className="tk-caption"><Icon name="wallet" size={13} /> Nothing has been charged. You pay before departure.</p>
      </div>

      <Accordion items={[{ id: "pol", title: "Cancellation policy", content:
        <p>Free cancellation until 7 days before departure (5 Sep). Between 7 and 2 days, half the total is held. Inside 48 hours the booking is non-refundable. Nothing has been charged, so cancelling now costs you nothing.</p> }]} />

      <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
        <Button block variant="secondary" iconStart="download" onClick={() => window.tkToast("Preparing your booking PDF…")}>Download details</Button>
        {status !== "cancelled" && (
          <Button block variant="ghost" style={{ color: "var(--danger-fg)" }} onClick={() => setConfirm(true)}>Cancel booking</Button>
        )}
      </div>

      <Modal open={confirm} tone="danger" title="Cancel this booking?"
        description={`Your ${b.travellers} on ${b.date} will be released and someone else can take the spots.`}
        onClose={() => setConfirm(false)}
        actions={<>
          <Button variant="secondary" onClick={() => setConfirm(false)}>Keep booking</Button>
          <Button variant="danger" onClick={() => { setStatus("cancelled"); setConfirm(false); setToast(true); }}>Yes, cancel</Button>
        </>}>
        <div className="tk-alert tk-alert--info" style={{ fontSize: "var(--text-caption-size)" }}>
          <span className="tk-alert__icon"><Icon name="info" size={16} /></span>
          <span className="tk-alert__body">Free cancellation applies until 5 Sep. Nothing has been charged, so there is nothing to refund.</span>
        </div>
      </Modal>

      {toast && (
        <div style={{ position: "fixed", insetInline: 16, bottom: 84, zIndex: 700 }}>
          <Toast tone="success" onClose={() => setToast(false)}>Booking {b.ref} cancelled</Toast>
        </div>
      )}
    </div>
  );
}

function AccountScreen({ go }) {
  const items = [
    { icon: "ticket", label: "My bookings", note: "3 trips", to: "bookings" },
    { icon: "user", label: "Profile & travellers", note: "Ama Mensah" },
    { icon: "wallet", label: "Payments", note: "Pay later" },
    { icon: "bell", label: "Notifications", note: "Email on" },
    { icon: "settings", label: "Settings", note: "USD · English" },
  ];
  return (
    <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div className="tk-row" style={{ gap: 12 }}>
        <span style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800 }}>AM</span>
        <div className="tk-stack" style={{ gap: 0 }}>
          <strong className="tk-h4">Ama Mensah</strong>
          <span className="tk-caption">ama@example.com</span>
        </div>
      </div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: 0 }}>
        {items.map((i, n) => (
          <button key={i.label} type="button" onClick={() => i.to && go(i.to)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "var(--space-4)", minHeight: 56, background: "transparent",
              border: 0, borderTop: n ? "1px solid var(--border-subtle)" : "none", width: "100%", textAlign: "start", cursor: "pointer" }}>
            <Icon name={i.icon} size={20} style={{ color: "var(--text-muted)" }} />
            <span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{i.label}</span>
            <span className="tk-caption" style={{ marginInlineStart: "auto" }}>{i.note}</span>
            <Icon name="chevron-right" size={16} style={{ color: "var(--text-muted)" }} />
          </button>
        ))}
      </div></div>
      <Button variant="ghost" iconStart="log-out" style={{ alignSelf: "flex-start" }} onClick={() => go("gate")}>Log out</Button>
    </div>
  );
}

function ErrorScreen({ go, kind = "404" }) {
  const map = {
    "404": { icon: "compass", title: "We cannot find that page", body: "The link may be old, or the tour may no longer run.", cta: "Browse tours" },
    "offline": { icon: "wifi-off", title: "You are offline", body: "We will load your bookings as soon as you are back on a connection. Saved tours still work.", cta: "Try again" },
    "error": { icon: "triangle-alert", title: "Something went wrong on our side", body: "Nothing was charged and no booking was made. Please try again in a moment.", cta: "Try again" },
  }[kind];
  return (
    <div style={{ padding: "var(--space-10) var(--space-4)" }}>
      <EmptyState icon={map.icon} title={map.title} body={map.body} action={<Button onClick={() => go("browse")}>{map.cta}</Button>} />
    </div>
  );
}
Object.assign(window, { BookingsScreen, BookingDetailScreen, AccountScreen, ErrorScreen });
