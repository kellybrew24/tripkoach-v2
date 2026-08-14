const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, FilterBar, Drawer, AuditTimeline, StatusBadge, Badge, Button, IconButton, Icon, Price, Modal, Alert, SearchField, Tabs, FormField, Select, Textarea, Switch, EmptyState, Toast } = NS;

const PAY_LABEL = { paid: "Paid", unpaid: "Unpaid", refunded: "Refunded", failed: "Failed" };
const payLabel = (p) => PAY_LABEL[p] || p;
function paymentBadge(p) {
  const map = { paid: "paid", unpaid: "pending", refunded: "refunded", failed: "failed" };
  return <StatusBadge status={map[p] || "pending"} size="sm" label={payLabel(p)} />;
}

// TRI-1010: the Bookings FilterBar Date/Tour/Payment facets used to be no-op onClicks.
// They're now real client-side filters over the already-hydrated A.bookings rows (same
// menu-dropdown pattern as Customers). Departure dates arrive as display strings
// ("Sat 22 Aug 2026") — new Date() parses those, so the date presets compare against today.
function parseBookingDate(s) {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}
function bookingDateFilters() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
  return [
    { id: "upcoming", label: "Upcoming", test: (d) => d && d >= now },
    { id: "30", label: "Next 30 days", test: (d) => d && d >= now && d <= in30 },
    { id: "past", label: "Past", test: (d) => d && d < now },
  ];
}

// TRI-1130: custom departure-date range. Booking `date` is a display string
// ("Sat 22 Aug 2026"); we normalise it to a local YYYY-MM-DD so it string-compares
// cleanly against the native <input type="date"> values (also YYYY-MM-DD) with no
// timezone drift. Either bound may be open-ended.
function bookingYMD(s) {
  const d = parseBookingDate(s);
  if (!d) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}
function inDateRange(s, range) {
  const ymd = bookingYMD(s);
  if (!ymd) return false;
  if (range.from && ymd < range.from) return false;
  if (range.to && ymd > range.to) return false;
  return true;
}
function fmtYMD(ymd) {
  const d = ymd ? new Date(ymd + "T00:00:00") : null;
  if (!d || isNaN(d.getTime())) return ymd || "";
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear();
}
function rangeLabel(range) {
  if (range.from && range.to) return fmtYMD(range.from) + " – " + fmtYMD(range.to);
  if (range.from) return "From " + fmtYMD(range.from);
  if (range.to) return "Until " + fmtYMD(range.to);
  return "Date range";
}

// The Date-facet dropdown: quick presets (mutually exclusive with a custom range)
// plus two native date inputs for an arbitrary from/to window. Setting either input
// clears the active preset and vice versa, so exactly one date filter is ever live.
function DateRangeMenu({ range, setRange, dateF, setDateF, presets, onDone }) {
  const setFrom = (v) => { setDateF(null); setRange((r) => ({ ...r, from: v })); };
  const setTo = (v) => { setDateF(null); setRange((r) => ({ ...r, to: v })); };
  const pickPreset = (id) => { setRange({ from: "", to: "" }); setDateF(id); onDone(); };
  const label = { fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 };
  const input = { minHeight: 34, padding: "6px 8px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--bg-surface)", color: "var(--text-strong)", fontSize: 13.5, width: "100%", boxSizing: "border-box", colorScheme: "light dark" };
  const heading = { fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" };
  return (
    <div style={{ minWidth: 244, display: "flex", flexDirection: "column", gap: 10, padding: 4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={heading}>Quick ranges</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {presets.map((f) => (
            <button key={f.id} type="button" onClick={() => pickPreset(f.id)} style={{ padding: "5px 10px", border: "1px solid var(--border-subtle)", borderRadius: 999, background: dateF === f.id ? "var(--brand-wash)" : "transparent", color: "var(--text-strong)", fontWeight: dateF === f.id ? 700 : 500, fontSize: 12.5, cursor: "pointer" }}>{f.label}</button>
          ))}
        </div>
      </div>
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={heading}>Custom range</span>
        <label style={label}>From
          <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setFrom(e.target.value)} style={input} />
        </label>
        <label style={label}>To
          <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setTo(e.target.value)} style={input} />
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 2 }}>
        <button type="button" onClick={() => { setRange({ from: "", to: "" }); setDateF(null); }} style={{ background: "none", border: 0, color: "var(--text-link)", fontWeight: 600, fontSize: 13, cursor: "pointer", padding: "4px 2px" }}>Clear</button>
        <button type="button" onClick={onDone} style={{ padding: "6px 16px", border: 0, borderRadius: "var(--radius-sm)", background: "var(--brand-gold-deep, var(--text-strong))", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Done</button>
      </div>
    </div>
  );
}

// TRI-1097: shared client-side row sort. The DS DataTable is presentational — it renders
// the sort chevron/aria-sort and reports header clicks via onSortChange, but it NEVER
// reorders rows. Every admin table therefore has to sort its own rows from the {key,dir}
// state before handing them to DataTable; historically none did, so the sort headers on
// Bookings/Tours flipped the chevron but never moved a row, and Customers/Guides never even
// wired the state. This helper is defined once here (screens-bookings.jsx loads before
// tours/more) and re-used cross-file via the build's window re-export (same pattern as
// exportBookingsCsv). Type is inferred per-column so the formatted date strings
// ("Sat 22 Aug 2026", not ISO) sort chronologically instead of lexicographically, and
// money/count columns sort numerically. Returns a new array; empty rows/no sort → passthrough.
function tkSortRows(rows, sort) {
  if (!sort || !sort.key || !Array.isArray(rows) || rows.length < 2) return rows;
  const key = sort.key, dir = sort.dir === "desc" ? -1 : 1;
  const vals = rows.map(r => r && r[key]).filter(v => v != null && v !== "");
  const asNum = (v) => typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  // Column is numeric only if EVERY non-empty value is a real number or a purely
  // numeric/currency string ("$1,240", "12") — this keeps ref codes like "TK-4821" (letters)
  // out of the numeric path so they sort as text.
  const allNum = vals.length > 0 && vals.every(v => typeof v === "number" || (/^[-+]?[\d.,\s$₵%]+$/.test(String(v).trim()) && !isNaN(asNum(v))));
  // Otherwise date if every non-empty value parses to a valid date (formatted date strings do).
  const allDate = !allNum && vals.length > 0 && vals.every(v => !isNaN(new Date(v).getTime()));
  const keyOf = (v) => {
    if (v == null || v === "") return allNum || allDate ? -Infinity : "";
    if (allNum) return asNum(v);
    if (allDate) return new Date(v).getTime();
    return String(v).toLowerCase();
  };
  return rows.slice().sort((a, b) => {
    const ka = keyOf(a && a[key]), kb = keyOf(b && b[key]);
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return 0;
  });
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
  // TRI-1010: FilterBar facet state — which dropdown is open + the active date/tour/payment filters.
  const [menu, setMenu] = React.useState(null);
  const [dateF, setDateF] = React.useState(null);
  const [tourF, setTourF] = React.useState(null);
  const [payF, setPayF] = React.useState(null);
  // TRI-1130: custom departure-date range (yyyy-mm-dd). Mutually exclusive with dateF.
  const [range, setRange] = React.useState({ from: "", to: "" });
  const rangeActive = !!(range.from || range.to);
  const openRef = state.detailRef;
  const loading = state.bookingsView === "loading";

  const dateFilters = bookingDateFilters();
  const tours = [...new Set(A.bookings.map(b => b.tour).filter(Boolean))].sort();
  const pays = ["paid", "unpaid", "refunded", "failed"].filter(p => A.bookings.some(b => b.payment === p));

  let rows = A.bookings.filter(b => tab === "all" || b.status === tab);
  if (q) rows = rows.filter(b => (b.ref + b.customer + b.tour).toLowerCase().includes(q.toLowerCase()));
  if (rangeActive) rows = rows.filter(b => inDateRange(b.date, range)); // TRI-1130: custom range wins over presets
  else if (dateF) { const f = dateFilters.find(x => x.id === dateF); if (f) rows = rows.filter(b => f.test(parseBookingDate(b.date))); }
  if (tourF) rows = rows.filter(b => b.tour === tourF);
  if (payF) rows = rows.filter(b => b.payment === payF);
  rows = tkSortRows(rows, sort); // TRI-1097: apply the header sort the DataTable only tracks.

  const counts = { all: A.bookings.length };
  ["pending", "confirmed", "cancelled"].forEach(s => counts[s] = A.bookings.filter(b => b.status === s).length);

  const applied = [];
  if (tab !== "all") applied.push({ id: "s", label: "Status: " + tab, onRemove: () => setTab("all") });
  if (rangeActive) applied.push({ id: "d", label: "Date: " + rangeLabel(range), onRemove: () => setRange({ from: "", to: "" }) });
  else if (dateF) applied.push({ id: "d", label: "Date: " + (dateFilters.find(x => x.id === dateF) || {}).label, onRemove: () => setDateF(null) });
  if (tourF) applied.push({ id: "t", label: "Tour: " + tourF, onRemove: () => setTourF(null) });
  if (payF) applied.push({ id: "p", label: "Payment: " + payLabel(payF), onRemove: () => setPayF(null) });
  const clearAll = () => { setTab("all"); setDateF(null); setRange({ from: "", to: "" }); setTourF(null); setPayF(null); };
  const menuItems = menu === "tour"
    ? tours.map(t => ({ id: t, label: t, on: () => { setTourF(t); setMenu(null); }, sel: tourF === t }))
    : menu === "pay"
      ? pays.map(p => ({ id: p, label: payLabel(p), on: () => { setPayF(p); setMenu(null); }, sel: payF === p }))
      : [];
  const menuLeft = { date: 12, tour: 150, pay: 250 }[menu] || 12;

  const booking = A.bookings.find(b => b.ref === openRef);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "all", label: "All", count: counts.all }, { id: "pending", label: "Pending", count: counts.pending },
        { id: "confirmed", label: "Confirmed", count: counts.confirmed }, { id: "cancelled", label: "Cancelled", count: counts.cancelled }]} />

      <div className="tk-tablewrap" style={{ position: "relative" }}>
        <FilterBar
          facets={[
            { id: "date", icon: "calendar-days", label: rangeActive ? rangeLabel(range) : (dateF ? (dateFilters.find(x => x.id === dateF) || {}).label : "Date range"), active: !!dateF || rangeActive || menu === "date", onClick: () => setMenu(menu === "date" ? null : "date") },
            { id: "tour", label: tourF ? "Tour: " + tourF : "Tour", active: !!tourF || menu === "tour", onClick: () => setMenu(menu === "tour" ? null : "tour") },
            { id: "pay", label: payF ? "Payment: " + payLabel(payF) : "Payment", active: !!payF || menu === "pay", onClick: () => setMenu(menu === "pay" ? null : "pay") }]}
          applied={applied}
          onClear={clearAll}>
          <div style={{ minWidth: 240 }}><SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Search reference, customer or tour" /></div>
          <Button size="sm" variant="secondary" iconStart="download" disabled={rows.length === 0}
            onClick={() => exportBookingsCsv(rows)}>Export</Button>
        </FilterBar>
        {menu && (menu === "date" || menuItems.length > 0) && <><div onClick={() => setMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 5 }} /><div style={{ position: "absolute", top: 52, insetInlineStart: menuLeft, zIndex: 6, minWidth: 200, maxHeight: 340, overflowY: "auto", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", padding: 6 }}>
          {menu === "date"
            ? <DateRangeMenu range={range} setRange={setRange} dateF={dateF} setDateF={setDateF} presets={dateFilters} onDone={() => setMenu(null)} />
            : menuItems.map(o => (
              <button key={o.id} type="button" onClick={o.on} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", textAlign: "start", padding: "8px 10px", border: 0, borderRadius: "var(--radius-sm)", background: o.sel ? "var(--brand-wash)" : "transparent", color: "var(--text-strong)", fontWeight: o.sel ? 700 : 500, fontSize: 13.5, cursor: "pointer" }}>{o.label}{o.sel && <Icon name="check" size={15} />}</button>
            ))}
        </div></>}

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
          <h3 className="tk-h6" style={{ marginBottom: 8 }}>Contact</h3>
          {/* TRI-1035: surface the booker's real contact so staff can reach out — this is the
              only place a GUEST (no-account) booker's email/phone shows in the console. */}
          <div className="tk-summary" style={{ padding: 0 }}>
            <div className="tk-summary__line"><span>Name</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{booking.customer || "—"}</span></div>
            <div className="tk-summary__line"><span>Email</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{booking.customerEmail ? <a href={"mailto:" + booking.customerEmail} style={{ color: "var(--brand-ink)" }}>{booking.customerEmail}</a> : "—"}</span></div>
            <div className="tk-summary__line"><span>Phone</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{booking.customerPhone ? <a href={"tel:" + booking.customerPhone} style={{ color: "var(--brand-ink)" }}>{booking.customerPhone}</a> : "—"}</span></div>
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
