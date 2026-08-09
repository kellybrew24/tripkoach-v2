const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, FilterBar, Drawer, AuditTimeline, StatusBadge, Badge, Button, IconButton, Icon, Price, Modal, Alert, SearchField, Tabs, FormField, Select, Textarea, Switch, EmptyState, Toast } = NS;

function paymentBadge(p) {
  const map = { paid: "paid", unpaid: "pending", refunded: "refunded", failed: "failed" };
  const label = { paid: "Paid", unpaid: "Unpaid", refunded: "Refunded", failed: "Failed" }[p] || p;
  return <StatusBadge status={map[p] || "pending"} size="sm" label={label} />;
}

// TRI-968: CSV export of the bookings list. Client-side (all rows are already hydrated into TK_ADMIN),
// RFC-4180-ish quoting so a customer name with a comma doesn't break the columns.
function bookingsCsvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportBookingsCsv(list) {
  const cols = [
    ["ref", "Reference"], ["customer", "Customer"], ["customerEmail", "Email"],
    ["tour", "Tour"], ["date", "Departure"], ["travellers", "Pax"],
    ["total", "Amount"], ["currency", "Currency"], ["status", "Status"],
    ["payment", "Payment"], ["created", "Created"],
  ];
  const lines = [cols.map((c) => c[1]).join(",")];
  list.forEach((r) => lines.push(cols.map((c) => bookingsCsvCell(r[c[0]])).join(",")));
  const csv = lines.join("\r\n") + "\r\n";
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = (window.URL || window.webkitURL).createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "bookings.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => (window.URL || window.webkitURL).revokeObjectURL(url), 0);
    window.tkToast(list.length + " bookings exported");
  } catch (_) {
    window.tkToast("Export failed");
  }
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
          <Button size="sm" variant="secondary" iconStart="download" disabled={rows.length === 0}
            onClick={() => exportBookingsCsv(rows)}>Export</Button>
        </FilterBar>

        {sel.length > 0 && (
          <div className="tk-bulkbar">
            <span>{sel.length} selected</span>
            <Button size="sm" variant="secondary" iconStart="download" onClick={() => exportBookingsCsv(A.bookings.filter(b => sel.includes(b.ref)))}>Export</Button>
            <Button size="sm" variant="secondary" iconStart="mail" onClick={() => window.TK_ADMIN_ACT(
              () => Promise.all(sel.map(ref => window.TK_ADMIN_API.resendBookingConfirmation(ref).catch(err => ({ ref, outcome: "error", error: err })))),
              (results) => window.tkToast(window.TK_RESEND_BULK_MSG(results, sel.length))
            )}>Resend confirmation</Button>
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
  // TRI-970 reschedule state
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [targetDep, setTargetDep] = React.useState("");
  const [notifyMove, setNotifyMove] = React.useState(true);
  const [movedDate, setMovedDate] = React.useState(null);
  React.useEffect(() => { setStatus(null); setConfirmCancel(false); setReason(""); setMoveOpen(false); setTargetDep(""); setNotifyMove(true); setMovedDate(null); }, [booking && booking.ref]);
  if (!booking) return null;
  const cur = status || booking.status;
  const shownDate = movedDate || booking.date;

  // Candidate target departures: same tour, scheduled, room for the party, not the current one.
  const A = window.TK_ADMIN || {};
  const moveOptions = (A.departures || [])
    .filter((d) => d.tourId === booking.tourId && d.id !== booking.departureId
      && d.status === "scheduled" && Number(d.spotsLeft) >= Number(booking.travellers))
    .map((d) => ({ value: d.id, label: (d.date || "Departure") + (d.time ? " · " + d.time : "") + " — " + d.spotsLeft + " left" }));
  const canReschedule = cur !== "cancelled" && cur !== "completed" && cur !== "failed";

  // TRI-978 #2: the drawer History used to fabricate precise clock times
  // ("09:14"/"10:02") and a made-up staff name ("Kofi A.") — placeholder data.
  // Show only what's actually true for this booking: the real creation date, the
  // real payment outcome, and the real current status. "Just now"/"You" appear
  // only for an action taken in THIS drawer session (`status` is set on confirm/
  // cancel); a pre-existing status change is attributed to "Staff" without an
  // invented timestamp. (A per-event audit trail is a separate backend surface.)
  const created = booking.created || "";
  const stamp = (sessionActor, sessionTime, fallback) => (status ? { actor: sessionActor, time: sessionTime } : { actor: "", time: fallback });
  const events = [
    { type: "created", text: "Booking created", actor: "Website", time: created },
    ...(booking.payment === "paid" ? [{ type: "paid", text: "Payment received via Paystack", actor: "Paystack", time: created, tone: "success" }] : []),
    ...(booking.payment === "failed" ? [{ type: "failed", text: "Payment failed", actor: "Paystack", time: created, tone: "danger" }] : []),
    ...(cur === "confirmed" ? [Object.assign({ type: "confirmed", text: "Booking confirmed", tone: "success" }, stamp("You", "Just now", "Staff"))] : []),
    ...(cur === "cancelled" ? [Object.assign({ type: "cancelled", text: "Booking cancelled" + (reason ? " — " + reason : ""), tone: "danger" }, stamp("You", "Just now", "Staff"))] : []),
  ];

  const moveBtn = canReschedule
    ? <Button variant="secondary" iconStart="calendar-days" disabled={moveOptions.length === 0}
        title={moveOptions.length === 0 ? "No other scheduled departure with room on this tour" : undefined}
        onClick={() => setMoveOpen(true)}>Move departure</Button>
    : null;
  const footer = cur === "pending"
    ? <>{moveBtn}<Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel booking</Button><Button style={{ marginInlineStart: "auto" }} iconStart="check" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.confirmBooking(booking.ref), () => { booking.status = "confirmed"; setStatus("confirmed"); setToast("Booking " + booking.ref + " confirmed"); })}>Confirm booking</Button></>
    : cur === "confirmed"
      ? <>{moveBtn}<Button variant="secondary" iconStart="mail" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.resendBookingConfirmation(booking.ref), (res) => setToast(window.TK_RESEND_MSG(res, "Confirmation resent")))}>Resend confirmation</Button><Button variant="danger" style={{ marginInlineStart: "auto" }} onClick={() => setConfirmCancel(true)}>Cancel booking</Button></>
      : (canReschedule
        ? <>{moveBtn}<Button variant="secondary" style={{ marginInlineStart: "auto" }} onClick={onClose}>Close</Button></>
        : <Button variant="secondary" style={{ marginInlineStart: "auto" }} onClick={onClose}>Close</Button>);

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
            {[["Tour", booking.tour], ["Region", booking.region], ["Departure", shownDate], ["Travellers", booking.travellers], ["Reference", booking.ref]].map(([k, v]) => (
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
        actions={<><Button variant="secondary" onClick={() => setConfirmCancel(false)}>Keep booking</Button><Button variant="danger" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.cancelBooking(booking.ref, reason), () => { booking.status = "cancelled"; setStatus("cancelled"); setConfirmCancel(false); setToast("Booking " + booking.ref + " cancelled"); })}>Yes, cancel booking</Button></>}>
        <FormField id="cancel-reason" label="Reason (recorded in history)" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Choose a reason"
            options={[{ value: "Customer request", label: "Customer request" }, { value: "Non-payment", label: "Non-payment" }, { value: "Departure cancelled", label: "Departure cancelled" }, { value: "Duplicate", label: "Duplicate booking" }]} />
        </FormField>
      </Modal>

      <Modal open={moveOpen} title={"Move booking " + booking.ref + " to another departure"}
        description={"Choose a scheduled departure of " + booking.tour + " with room for " + booking.travellers + " traveller(s). The payment carries over — the amount is unchanged."}
        onClose={() => setMoveOpen(false)}
        actions={<><Button variant="secondary" onClick={() => setMoveOpen(false)}>Cancel</Button><Button iconStart="calendar-days" disabled={!targetDep} onClick={() => {
          const chosen = moveOptions.find((o) => o.value === targetDep);
          window.TK_ADMIN_ACT(
            () => window.TK_ADMIN_API.rescheduleBooking(booking.ref, targetDep, { notify: notifyMove }),
            (res) => {
              const newDate = (res && (res.newDeparture || res.date)) || (chosen ? chosen.label.split(" — ")[0] : booking.date);
              setMovedDate(newDate);
              booking.date = newDate; booking.departureId = targetDep; // optimistic local sync
              setMoveOpen(false);
              setToast("Booking " + booking.ref + " moved to " + newDate + (notifyMove ? " · traveller emailed" : ""));
            });
        }}>Move booking</Button></>}>
        <FormField id="move-target" label="New departure" required>
          <Select value={targetDep} onChange={(e) => setTargetDep(e.target.value)}
            placeholder={moveOptions.length ? "Choose a departure" : "No eligible departures"}
            options={moveOptions} />
        </FormField>
        <div style={{ marginTop: 12 }}>
          <Switch id="move-notify" label="Email the traveller about the new date" checked={notifyMove} onChange={() => setNotifyMove(!notifyMove)} />
        </div>
      </Modal>

      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </>
  );
}
Object.assign(window, { BookingsAdmin });
