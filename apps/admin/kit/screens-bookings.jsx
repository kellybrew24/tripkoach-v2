const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, FilterBar, Drawer, AuditTimeline, StatusBadge, Badge, Button, IconButton, Icon, Price, Modal, Alert, SearchField, Tabs, FormField, Select, Textarea, EmptyState, Toast } = NS;

function paymentBadge(p) {
  const map = { paid: "paid", unpaid: "pending", refunded: "refunded", failed: "failed" };
  const label = { paid: "Paid", unpaid: "Unpaid", refunded: "Refunded", failed: "Failed" }[p] || p;
  return <StatusBadge status={map[p] || "pending"} size="sm" label={label} />;
}

function BookingsAdmin({ go, state, setState }) {
  const A = window.TK_ADMIN;
  const [tab, setTab] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState([]);
  const [sort, setSort] = React.useState({ key: "created", dir: "desc" });
  const openRef = state.detailRef;
  const loading = state.bookingsView === "loading";

  let rows = A.bookings.filter(b => tab === "all" || b.status === tab);
  if (q) rows = rows.filter(b => (b.ref + b.customer + b.tour).toLowerCase().includes(q.toLowerCase()));

  const counts = { all: A.bookings.length };
  ["pending", "confirmed", "cancelled"].forEach(s => counts[s] = A.bookings.filter(b => b.status === s).length);

  const booking = A.bookings.find(b => b.ref === openRef);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "all", label: "All", count: counts.all }, { id: "pending", label: "Pending", count: counts.pending },
        { id: "confirmed", label: "Confirmed", count: counts.confirmed }, { id: "cancelled", label: "Cancelled", count: counts.cancelled }]} />

      <div className="tk-tablewrap">
        <FilterBar
          facets={[{ id: "date", label: "Date range", icon: "calendar-days", onClick: () => {} }, { id: "tour", label: "Tour", onClick: () => {} }, { id: "pay", label: "Payment", onClick: () => {} }]}
          applied={tab !== "all" ? [{ id: "s", label: "Status: " + tab, onRemove: () => setTab("all") }] : []}
          onClear={() => setTab("all")}>
          <div style={{ minWidth: 240 }}><SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Search reference, customer or tour" /></div>
        </FilterBar>

        {sel.length > 0 && (
          <div className="tk-bulkbar">
            <span>{sel.length} selected</span>
            <Button size="sm" variant="secondary" iconStart="download" onClick={() => window.tkToast(sel.length + " bookings exported")}>Export</Button>
            <Button size="sm" variant="secondary" iconStart="mail" onClick={() => window.tkToast("Confirmation resent to " + sel.length + " customers")}>Resend confirmation</Button>
            <button type="button" onClick={() => setSel([])} style={{ marginInlineStart: "auto", background: "none", border: 0, color: "var(--text-link)", fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>
        )}

        <DataTable density="compact" loading={loading} selectable selected={sel} onSelectedChange={setSel}
          sort={sort} onSortChange={setSort} onRowClick={(r) => setState({ detailRef: r.ref })}
          columns={[
            { key: "ref", header: "Reference", strong: true, sortable: true },
            { key: "customer", header: "Customer", sortable: true },
            { key: "tour", header: "Tour", render: r => <span title={r.tour} style={{ display: "inline-block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{r.tour}</span> },
            { key: "date", header: "Departure", sortable: true },
            { key: "travellers", header: "Pax", align: "end" },
            { key: "total", header: "Amount", align: "end", sortable: true, render: r => <Price amount={r.total} currency="USD" /> },
            { key: "status", header: "Booking", render: r => <StatusBadge status={r.status} size="sm" /> },
            { key: "payment", header: "Payment", render: r => paymentBadge(r.payment) },
            { key: "created", header: "Created", sortable: true },
          ]}
          rows={rows} getRowId={r => r.ref}
          rowActions={(r) => <IconButton icon="ellipsis" label={"Actions for " + r.ref} variant="ghost" size="sm" onClick={() => setState({ detailRef: r.ref })} />}
          empty={<EmptyState icon="ticket" title="No bookings match" body="Try a different status tab or clear your search." />} />
      </div>

      <BookingDrawer booking={booking} onClose={() => setState({ detailRef: null })} />
    </div>
  );
}

function BookingDrawer({ booking, onClose }) {
  const [status, setStatus] = React.useState(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [toast, setToast] = React.useState(null);
  React.useEffect(() => { setStatus(null); setConfirmCancel(false); setReason(""); }, [booking && booking.ref]);
  if (!booking) return null;
  const cur = status || booking.status;

  const events = [
    { type: "created", text: "Booking created via website", actor: "System", time: booking.created + ", 09:14" },
    ...(booking.payment === "paid" ? [{ type: "paid", text: "Payment received via Paystack", actor: "System", time: booking.created + ", 09:15", tone: "success" }] : []),
    ...(cur === "confirmed" ? [{ type: "confirmed", text: "Marked <strong>Confirmed</strong>", actor: "Kofi A.", time: booking.created + ", 10:02", tone: "success" }] : []),
    ...(cur === "cancelled" ? [{ type: "cancelled", text: "Booking <strong>cancelled</strong>" + (reason ? " — " + reason : ""), actor: "You", time: "Just now", tone: "danger" }] : []),
    { type: "email", text: "Confirmation email sent to " + booking.customer, actor: "System", time: booking.created + ", 09:16" },
  ];

  const footer = cur === "pending"
    ? <><Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel booking</Button><Button style={{ marginInlineStart: "auto" }} iconStart="check" onClick={() => { setStatus("confirmed"); setToast("Booking " + booking.ref + " confirmed"); }}>Confirm booking</Button></>
    : cur === "confirmed"
      ? <><Button variant="secondary" iconStart="mail" onClick={() => window.tkToast("Confirmation resent")}>Resend confirmation</Button><Button variant="danger" style={{ marginInlineStart: "auto" }} onClick={() => setConfirmCancel(true)}>Cancel booking</Button></>
      : <Button variant="secondary" style={{ marginInlineStart: "auto" }} onClick={onClose}>Close</Button>;

  return (
    <>
      <Drawer open={!!booking} title={"Booking " + booking.ref} subtitle={booking.customer + " · " + booking.tour} onClose={onClose} footer={footer}>
        <div className="tk-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <StatusBadge status={cur} /><span>·</span>{paymentBadge(booking.payment)}
        </div>
        {cur === "pending" && <Alert tone="warning" title="Awaiting payment">This booking is held. Confirm once payment is received, or cancel to release the spots.</Alert>}

        <section>
          <h3 className="tk-h6" style={{ marginBottom: 8 }}>Trip</h3>
          <div className="tk-summary" style={{ padding: 0 }}>
            {[["Tour", booking.tour], ["Region", booking.region], ["Departure", booking.date], ["Travellers", booking.travellers], ["Reference", booking.ref]].map(([k, v]) => (
              <div className="tk-summary__line" key={k}><span>{k}</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{v}</span></div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="tk-h6" style={{ marginBottom: 8 }}>Price</h3>
          <div className="tk-summary" style={{ padding: 0 }}>
            <div className="tk-summary__line"><span>{"$" + booking.unit} × {booking.travellers}</span><span>{"$" + booking.total.toLocaleString()}</span></div>
            <div className="tk-summary__total"><span>Total</span><Price amount={booking.total} currency="USD" /></div>
          </div>
        </section>
        <section>
          <h3 className="tk-h6" style={{ marginBottom: 10 }}>History</h3>
          <AuditTimeline events={events} />
        </section>
      </Drawer>

      <Modal open={confirmCancel} tone="danger" title={"Cancel booking " + booking.ref + "?"}
        description={"This releases " + booking.travellers + " on " + booking.date + ". The customer is emailed automatically."}
        onClose={() => setConfirmCancel(false)}
        actions={<><Button variant="secondary" onClick={() => setConfirmCancel(false)}>Keep booking</Button><Button variant="danger" onClick={() => { setStatus("cancelled"); setConfirmCancel(false); setToast("Booking " + booking.ref + " cancelled"); }}>Yes, cancel booking</Button></>}>
        <FormField id="cancel-reason" label="Reason (recorded in history)" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Choose a reason"
            options={[{ value: "Customer request", label: "Customer request" }, { value: "Non-payment", label: "Non-payment" }, { value: "Departure cancelled", label: "Departure cancelled" }, { value: "Duplicate", label: "Duplicate booking" }]} />
        </FormField>
      </Modal>

      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </>
  );
}
Object.assign(window, { BookingsAdmin });
