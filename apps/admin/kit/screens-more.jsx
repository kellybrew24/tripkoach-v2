const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, FilterBar, Drawer, RoleMatrix, RowMenu, StatusBadge, Badge, Button, IconButton, Icon, Price, Modal,
  Alert, SearchField, EmptyState, FormField, Input, PhoneInput, Select, Switch, Checkbox, Textarea, Tabs, BookingRow, Toast, Spinner } = NS;

function payBadge(p) {
  const map = { paid: "paid", pending: "pending", refunded: "refunded", failed: "failed", unpaid: "pending" };
  const label = { paid: "Paid", pending: "Pending", refunded: "Refunded", failed: "Failed", unpaid: "Unpaid" }[p] || p;
  return <StatusBadge status={map[p]} size="sm" label={label} />;
}

/* ── Customer activity timeline (TRI-972) ──────────────────
 * Human-readable, customer-scoped feed of booking lifecycle events
 * (created / paid / confirmed / cancelled / rescheduled / refunded / review),
 * newest first. Derived server-side from bookings + payments + reviews + the
 * booking slice of the audit log — this is NOT the staff audit log. Each row
 * links back to its booking. Only rendered in live mode (fixtures have no feed).
 */
const ACT_META = {
  booking_created:     { label: "Booking created",     icon: "ticket",           tone: "neutral" },
  booking_paid:        { label: "Payment received",    icon: "wallet",           tone: "success" },
  booking_confirmed:   { label: "Booking confirmed",   icon: "circle-check-big", tone: "success" },
  booking_cancelled:   { label: "Booking cancelled",   icon: "x",                tone: "danger"  },
  booking_rescheduled: { label: "Booking rescheduled", icon: "repeat",           tone: "warning" },
  booking_refunded:    { label: "Refund issued",       icon: "receipt",          tone: "warning" },
  review_submitted:    { label: "Review submitted",    icon: "star",             tone: "info"    },
};
function actTone(tone) {
  if (tone === "neutral") return { bg: "var(--bg-sunken)", fg: "var(--text-body)" };
  return { bg: "var(--" + tone + "-bg)", fg: "var(--" + tone + "-fg)" };
}
function actWhen(at) {
  const d = at ? new Date(at) : null;
  if (!d || isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (_) { return d.toISOString().slice(0, 16).replace("T", " "); }
}
function actDetail(ev) {
  const bits = [];
  if (ev.tour) bits.push(ev.tour);
  if ((ev.type === "booking_paid" || ev.type === "booking_refunded" || ev.type === "booking_created") && typeof ev.amount === "number") {
    bits.push((ev.currency ? ev.currency + " " : "$") + ev.amount.toLocaleString());
  }
  if (ev.type === "review_submitted" && ev.meta && ev.meta.rating != null) bits.push(ev.meta.rating + "★");
  if (ev.type === "booking_rescheduled" && ev.meta && (ev.meta.toDate || ev.meta.to_date)) bits.push("→ " + (ev.meta.toDate || ev.meta.to_date));
  if (ev.actor) bits.push("by " + ev.actor);
  return bits.join(" · ");
}
function ActivityTimeline({ items, status, go }) {
  if (status === "loading") return <div style={{ padding: 24, display: "grid", placeItems: "center" }}><Spinner /></div>;
  if (status === "error") return <Alert tone="warning" title="Couldn't load activity">The activity timeline couldn't be fetched. Try reopening the customer.</Alert>;
  if (!items || items.length === 0) return <p className="tk-caption">No activity yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((ev, i) => {
        const m = ACT_META[ev.type] || { label: ev.type, icon: "circle", tone: "neutral" };
        const t = actTone(m.tone);
        const detail = actDetail(ev);
        const last = i === items.length - 1;
        return (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: t.bg, color: t.fg, display: "grid", placeItems: "center" }}><Icon name={m.icon} size={15} /></span>
              {!last && <span style={{ flex: 1, width: 2, background: "var(--border-subtle)", marginTop: 2 }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : 16, minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14, color: "var(--text-strong)" }}>{m.label}</strong>
                {ev.ref && <a href="#" onClick={(e) => { e.preventDefault(); go("bookings", ev.ref); }} style={{ fontWeight: 600, fontSize: 12.5 }}>{ev.ref}</a>}
              </div>
              {detail && <div className="tk-caption" style={{ marginTop: 2 }}>{detail}</div>}
              <div className="tk-caption tk-muted" style={{ marginTop: 2 }}>{actWhen(ev.at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Row-action menu that escapes table clipping (TRI-978 reopen) ──────────
 * The DS <RowMenu> renders its dropdown with position:absolute inside the row.
 * That dropdown is clipped by the table's overflow ancestors — `.tk-tablewrap`
 * has `overflow:hidden`, and (since TRI-978 #1) the single content scroll region
 * `.tk-shell__main` has `overflow-y:auto`. So clicking the three-dots on a
 * customer opened a menu that was cut off / "hidden in a div" — the board's bug.
 * A CSS tweak can't defeat multiple nested overflow ancestors, so we render the
 * menu through a portal to <body> with position:fixed, anchored to the button's
 * viewport rect (flipping up when there isn't room below). App-layer only — the
 * design system / _ds_bundle stay pristine. */
function PortalRowMenu({ label = "Row actions", items = [], width = 220 }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const btnRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const estH = Math.min(items.length * 44 + 12, 320);
      let left = r.right - width;
      if (left < 8) left = 8;
      if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
      let top = r.bottom + 4;
      if (top + estH > vh - 8) top = Math.max(8, r.top - 4 - estH); // flip up near the viewport bottom
      setPos({ left, top });
    }
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    // The menu is anchored to a viewport rect; any scroll invalidates it — close.
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, items.length, width]);
  return (
    <span style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} type="button" className="tk-iconbtn-plain" style={{ width: 32, height: 32 }}
        aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(o => !o)}>
        <Icon name="ellipsis" size={18} />
      </button>
      {open && pos && ReactDOM.createPortal(
        <div className="tk-menu" role="menu" onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: pos.top, left: pos.left, width, zIndex: 900, maxHeight: 320, overflowY: "auto" }}>
          {items.map((it, i) => it.divider
            ? <div key={i} style={{ height: 1, background: "var(--border-subtle)", margin: "4px 0" }} />
            : it.section
              // TRI-1083: non-interactive muted group label (e.g. "Recover access") — lets the flat
              // PortalRowMenu read as a grouped section without a nested-flyout primitive (TRI-1081 §1).
              ? <div key={i} className="tk-caption tk-muted" role="presentation"
                  style={{ padding: "6px 12px 2px", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{it.label}</div>
              // TRI-1080 follow-up: disabled items (e.g. "Clear lockout" on a non-locked
              // account) render inert + muted with an optional trailing hint.
              : <button key={i} type="button" role="menuitem" className="tk-menu__item"
                  disabled={!!it.disabled}
                  style={it.disabled ? { opacity: .5, cursor: "not-allowed" } : (it.danger ? { color: "var(--danger-fg)" } : undefined)}
                  onClick={() => { if (it.disabled) return; setOpen(false); it.onClick && it.onClick(); }}>
                  {it.icon && <Icon name={it.icon} size={16} />}{it.label}
                  {it.hint && <span className="tk-caption tk-muted" style={{ marginInlineStart: "auto", fontStyle: "italic" }}>{it.hint}</span>}
                </button>)}
        </div>, document.body)}
    </span>
  );
}

/* ── Customers ─────────────────────────────────────────── */
function CustomersAdmin({ go, state, setState }) {
  const A = window.TK_ADMIN;
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [q, setQ] = React.useState("");
  const [toast, setToast] = React.useState(null);
  const [country, setCountry] = React.useState(null);
  const [band, setBand] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const [sort, setSort] = React.useState(null); // TRI-1097: header sort for the Customers table.
  // TRI-969: the list row only carries summary fields. The full profile
  // (emergency contact, dietary needs, preferences) + the complete booking
  // history come from GET /admin/customers/:id — fetched when the drawer opens.
  const [detail, setDetail] = React.useState(null);
  const [detailStatus, setDetailStatus] = React.useState("idle");
  // TRI-972: Activity tab — customer-scoped booking-lifecycle timeline, lazily
  // fetched from GET /admin/customers/:id/activity the first time the tab opens.
  const [custTab, setCustTab] = React.useState("overview");
  const [activity, setActivity] = React.useState(null);
  const [activityStatus, setActivityStatus] = React.useState("idle");
  const open = A.customers.find(c => c.id === state.detailRef);
  React.useEffect(() => {
    setDetail(null);
    setCustTab("overview"); setActivity(null); setActivityStatus("idle");
    if (!open || !LIVE || !window.TK_ADMIN_API) { setDetailStatus("idle"); return; }
    let live = true;
    setDetailStatus("loading");
    window.TK_ADMIN_API.getCustomer(open.id).then(
      (r) => { if (live) { setDetail(r || null); setDetailStatus("ok"); } },
      () => { if (live) setDetailStatus("error"); }
    );
    return () => { live = false; };
  }, [state.detailRef, LIVE]);
  // Load the activity feed the first time the Activity tab is shown for this customer.
  React.useEffect(() => {
    if (custTab !== "activity" || !open || !LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.getCustomerActivity) return;
    if (activityStatus !== "idle") return;
    let live = true;
    setActivityStatus("loading");
    window.TK_ADMIN_API.getCustomerActivity(open.id).then(
      (r) => { if (live) { setActivity((r && r.items) || []); setActivityStatus("ok"); } },
      () => { if (live) setActivityStatus("error"); }
    );
    return () => { live = false; };
  }, [custTab, state.detailRef, LIVE]);
  const custBookings = (id) => A.bookings.filter(b => b.customerId === id);
  const spend = (id) => custBookings(id).filter(b => b.payment === "paid").reduce((s, b) => s + b.total, 0);
  const countries = [...new Set(A.customers.map(c => c.country))].sort();
  const bands = [{ id: "0", label: "No spend yet", test: v => v === 0 }, { id: "lo", label: "Under $1,000", test: v => v > 0 && v < 1000 }, { id: "hi", label: "$1,000+", test: v => v >= 1000 }];
  let rows = A.customers;
  if (q) rows = rows.filter(c => (c.name + c.email + c.country).toLowerCase().includes(q.toLowerCase()));
  if (country) rows = rows.filter(c => c.country === country);
  if (band) { const b = bands.find(x => x.id === band); rows = rows.filter(c => b.test(spend(c.id))); }
  rows = tkSortRows(rows, sort); // TRI-1097: apply the header sort (name / joined).
  const applied = [];
  if (country) applied.push({ id: "country", label: "Country: " + country, onRemove: () => setCountry(null) });
  if (band) applied.push({ id: "band", label: "Value: " + bands.find(x => x.id === band).label, onRemove: () => setBand(null) });
  // TRI-1010: "Email customer" used to just toast — open the staff member's mail client
  // with a real mailto: to the customer's address (subject pre-filled with the trip context).
  const emailCustomer = (r) => {
    if (!r || !r.email) { setToast("No email on file for " + ((r && r.name) || "this customer")); return; }
    try { window.location.href = "mailto:" + r.email + "?subject=" + encodeURIComponent("Your TripKoach booking"); } catch (_) {}
  };
  const kebab = (r) => [
    { label: "View details", icon: "eye", onClick: () => setState({ detailRef: r.id }) },
    { label: "Email customer", icon: "mail", onClick: () => emailCustomer(r) },
    { label: "Resend last confirmation", icon: "ticket", onClick: () => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.resendCustomerLastConfirmation(r.id), (res) => setToast(window.TK_RESEND_MSG(res, "Confirmation resent to " + r.email))) },
    { label: "Copy email address", icon: "receipt", onClick: () => { try { navigator.clipboard && navigator.clipboard.writeText(r.email); } catch (_) {} setToast(r.email + " copied"); } },
    { divider: true },
    // TRI-1008: real CSV download of this customer's bookings via the existing client
    // helper (exportBookingsCsv, screens-bookings.jsx — global after bundling), instead
    // of a bare toast. custBookings(id) is the same A.bookings shape the Bookings export uses.
    { label: "Export bookings (CSV)", icon: "download", onClick: () => { const rows = custBookings(r.id); if (!rows.length) { setToast("No bookings to export for " + r.name); return; } exportBookingsCsv(rows); } },
  ];
  // Detail view — prefer the fetched profile (live), fall back to the list row / fixtures.
  const detailBookings = detail && Array.isArray(detail.bookings) ? detail.bookings : null;
  const bookingList = detailBookings ? detailBookings : (open ? custBookings(open.id) : []);
  const spendAmount = detail && typeof detail.totalSpend === "number" ? detail.totalSpend : (open ? spend(open.id) : 0);
  const tripsCount = detailBookings ? detailBookings.length : (open ? open.bookings : 0);
  const pendingCount = bookingList.filter(b => b.status === "pending").length;
  const emName = (detail && detail.emergencyName) || (open && open.emergencyName) || "";
  const emPhone = (detail && detail.emergencyPhone) || (open && open.emergencyPhone) || "";
  const emDietRaw = (detail && detail.dietaryNeeds) || (open && open.diet) || "";
  const emDiet = emDietRaw && emDietRaw !== "—" ? emDietRaw : "";
  const prefLang = (detail && detail.language) || (open && open.language) || "";
  const prefCurrency = (detail && detail.displayCurrency) || (open && open.displayCurrency) || "";
  const twoFA = detail ? detail.twoFactorEnabled : (open ? open.twoFactorEnabled : null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-tablewrap" style={{ position: "relative" }}>
        <FilterBar onClear={() => { setCountry(null); setBand(null); }} applied={applied}
          facets={[
            { id: "country", label: country ? "Country: " + country : "Country", active: !!country || menu === "country", onClick: () => setMenu(menu === "country" ? null : "country") },
            { id: "spend", label: band ? "Value: " + bands.find(x => x.id === band).label : "Lifetime value", active: !!band || menu === "spend", onClick: () => setMenu(menu === "spend" ? null : "spend") },
          ]}>
          <div style={{ minWidth: 240 }}><SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Search name or email" /></div>
        </FilterBar>
        {menu && <><div onClick={() => setMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 5 }} /><div style={{ position: "absolute", top: 52, insetInlineStart: menu === "spend" ? 150 : 12, zIndex: 6, minWidth: 200, maxHeight: 280, overflowY: "auto", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", padding: 6 }}>
          {(menu === "country" ? countries.map(c => ({ id: c, label: c, on: () => { setCountry(c); setMenu(null); }, sel: country === c })) : bands.map(b => ({ id: b.id, label: b.label, on: () => { setBand(b.id); setMenu(null); }, sel: band === b.id }))).map(o => (
            <button key={o.id} type="button" onClick={o.on} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", textAlign: "start", padding: "8px 10px", border: 0, borderRadius: "var(--radius-sm)", background: o.sel ? "var(--brand-wash)" : "transparent", color: "var(--text-strong)", fontWeight: o.sel ? 700 : 500, fontSize: 13.5, cursor: "pointer" }}>{o.label}{o.sel && <Icon name="check" size={15} />}</button>
          ))}
        </div></>}
        <DataTable onRowClick={(r) => setState({ detailRef: r.id })}
          sort={sort} onSortChange={setSort}
          columns={[
            { key: "name", header: "Customer", strong: true, sortable: true, render: r => (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: "none", width: 34, height: 34, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12.5 }}>{r.initials}</span>
                <span style={{ minWidth: 0 }}><div style={{ fontWeight: 600, color: "var(--text-strong)", display: "flex", alignItems: "center", gap: 6 }}>{r.name}
                  {/* TRI-941: email-verification chip — only in live mode (fixtures leave emailVerified undefined). */}
                  {r.emailVerified === true && <span className="tk-badge tk-badge--confirmed" title="Email verified"><Icon name="circle-check-big" size={11} /></span>}
                  {r.emailVerified === false && <span className="tk-badge tk-badge--pending" title="Email not verified">Unverified</span>}
                </div><div className="tk-caption" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</div></span></span>) },
            { key: "country", header: "Country" },
            { key: "bookings", header: "Trips", align: "end" },
            { key: "ltv", header: "Lifetime value", align: "end", render: r => <Price amount={spend(r.id)} currency="USD" size="sm" /> },
            { key: "joined", header: "Joined", sortable: true },
          ]}
          rows={rows} getRowId={r => r.id}
          rowActions={(r) => <PortalRowMenu label={"Actions for " + r.name} items={kebab(r)} />}
          empty={<EmptyState icon="users" title="No customers found" body="Try a different search." />} />
      </div>

      <Drawer open={!!open} title={open ? open.name : ""} subtitle={open ? open.email : ""} onClose={() => setState({ detailRef: null })}
        footer={<><Button variant="secondary" iconStart="mail" onClick={() => emailCustomer(open)}>Email customer</Button><Button variant="secondary" style={{ marginInlineStart: "auto" }} onClick={() => setState({ detailRef: null })}>Close</Button></>}>
        {open && <>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ flex: "none", width: 56, height: 56, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 20 }}>{open.initials}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong className="tk-h5">{open.name}</strong>
                {/* TRI-941: account verification state (live only — undefined for fixtures). */}
                {open.emailVerified === true && <span className="tk-badge tk-badge--confirmed">Email verified</span>}
                {open.emailVerified === false && <span className="tk-badge tk-badge--pending">Email unverified</span>}
                {pendingCount > 0 && <span className="tk-badge tk-badge--pending">Has pending</span>}
                {spendAmount >= 1000 && <Badge tone="solid">VIP</Badge>}
              </div>
              <div className="tk-caption">{open.country} · member since {open.joined}</div>
            </div>
          </div>
          {/* TRI-972: Overview keeps the profile + booking history; Activity is the lifecycle timeline.
              The wrapper's flexShrink:0 is load-bearing: .tk-drawer__body is a flex column and the DS
              .tk-tabs (flex:0 1 auto + overflow:auto → min-height 0) otherwise collapses to a 1px sliver
              when the drawer content is tall, hiding the tab bar entirely. Other Tabs usages sit in normal
              page flow so they're unaffected; only Tabs-inside-a-drawer needs this. */}
          {LIVE && <div style={{ flexShrink: 0 }}><Tabs value={custTab} onChange={setCustTab} tabs={[{ id: "overview", label: "Overview" }, { id: "activity", label: "Activity" }]} /></div>}
          {(!LIVE || custTab === "overview") && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[["Trips", tripsCount], ["Lifetime value", "$" + spendAmount.toLocaleString()], ["Pending", pendingCount]].map(([k, v]) => (
              <div key={k} className="tk-card" style={{ padding: "12px 14px" }}><div className="tk-caption">{k}</div><div style={{ fontWeight: 800, fontSize: 20, fontFamily: "var(--font-display)", letterSpacing: "-0.02em", color: "var(--text-strong)" }}>{v}</div></div>
            ))}
          </div>
          <Alert tone="info" title="Personal data">Handle with care. Only staff with the customers permission can view this.</Alert>
          <section>
            <h3 className="tk-h6" style={{ marginBottom: 8 }}>Contact</h3>
            <div className="tk-summary" style={{ padding: 0 }}>
              {[["Phone", open.phone], ["Email", open.email], ["Country", open.country]].map(([k, v]) => <div className="tk-summary__line" key={k}><span>{k}</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{v}</span></div>)}
            </div>
          </section>
          <section>
            <h3 className="tk-h6" style={{ marginBottom: 8 }}>Emergency contact &amp; needs</h3>
            <div className="tk-summary" style={{ padding: 0 }}>
              {[["Emergency contact", emName || "—"], ["Emergency number", emPhone || "—"], ["Dietary needs", emDiet || "—"]].map(([k, v]) => <div className="tk-summary__line" key={k}><span>{k}</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{v}</span></div>)}
            </div>
          </section>
          {open.hasAccount && (prefLang || prefCurrency || twoFA != null) && <section>
            <h3 className="tk-h6" style={{ marginBottom: 8 }}>Account preferences</h3>
            <div className="tk-summary" style={{ padding: 0 }}>
              {[["Language", prefLang || "—"], ["Display currency", prefCurrency || "—"], ["Two-factor auth", twoFA == null ? "—" : (twoFA ? "Enabled" : "Off")]].map(([k, v]) => <div className="tk-summary__line" key={k}><span>{k}</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{v}</span></div>)}
            </div>
          </section>}
          <section>
            <h3 className="tk-h6" style={{ marginBottom: 8 }}>Booking history</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {detailStatus === "loading" && <div style={{ padding: 24, display: "grid", placeItems: "center" }}><Spinner /></div>}
              {detailStatus === "error" && <Alert tone="warning" title="Couldn't load booking history">The customer's profile loaded, but their trips couldn't be fetched. Try reopening.</Alert>}
              {bookingList.map(b => (
                <BookingRow key={b.ref} reference={b.ref} title={b.tour} date={b.date} travellers={b.travellers + " travellers"} total={b.total} status={b.status} onClick={() => go("bookings", b.ref)} />
              ))}
              {detailStatus !== "loading" && bookingList.length === 0 && <p className="tk-caption">No bookings yet.</p>}
            </div>
          </section>
          </>}
          {LIVE && custTab === "activity" && <section>
            <ActivityTimeline items={activity} status={activityStatus} go={go} />
          </section>}
        </>}
      </Drawer>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Payments & reconciliation ─────────────────────────── */
// TRI-1006: "Export for reconciliation" download. Live mode streams the finance-grade CSV
// (payments + refunds, FX columns) from the real GET /reports/reconciliation.csv endpoint so
// the browser download carries the admin cookie. Demo/fixture mode (flag off, no server) falls
// back to a client-side CSV of the visible payment rows so the button still produces a file.
function reconCsvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function triggerBlobDownload(blob, filename) {
  const url = (window.URL || window.webkitURL).createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => (window.URL || window.webkitURL).revokeObjectURL(url), 0);
}
function exportReconciliation(payments) {
  const API = window.TK_ADMIN_API;
  if (API && API.live && API.live() && API.reconciliationCsv) {
    API.reconciliationCsv().then(({ blob, filename }) => {
      triggerBlobDownload(blob, filename || "reconciliation.csv");
      window.tkToast("Reconciliation export downloaded");
    }).catch((e) => {
      window.tkToast(e && e.message ? "Export failed — " + e.message : "Export failed");
    });
    return;
  }
  // Fixture fallback: build a CSV from the loaded payment rows.
  try {
    const cols = [["id", "Transaction"], ["ref", "Booking"], ["customer", "Customer"], ["method", "Method"], ["amount", "Amount (USD)"], ["status", "Status"], ["date", "Date"]];
    const lines = [cols.map((c) => c[1]).join(",")];
    (payments || []).forEach((r) => lines.push(cols.map((c) => reconCsvCell(r[c[0]])).join(",")));
    triggerBlobDownload(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }), "reconciliation.csv");
    window.tkToast((payments || []).length + " transactions exported");
  } catch (_) {
    window.tkToast("Export failed");
  }
}
function PaymentsAdmin({ go, state }) {
  const A = window.TK_ADMIN;
  const [tab, setTab] = React.useState("all");
  // TRI-980: apply the settled state to the SHARED payment record (and keep the
  // linked booking's payment flag in sync so the Outstanding stat + Bookings list
  // agree) so the console reflects the change live. TK_ADMIN_ACT broadcasts
  // tk-admin-mutated after this runs → AdminApp re-renders → this screen re-reads
  // A.payments and the row moves tabs / the badge flips with no manual refresh.
  const patchPayment = (row, status) => {
    const p = (A.payments || []).find(x => x.id === row.id); if (p) p.status = status;
    const bk = (A.bookings || []).find(b => b.ref === row.ref);
    if (bk) bk.payment = status === "paid" ? "paid" : status === "refunded" ? "refunded" : bk.payment;
  };
  // TRI-1033: every stat + row is stated in USD-of-record so this page reconciles with the Bookings page
  // (which shows USD). A Paystack charge row's `amount` is GHS (the real money moved, ~15.6× the USD), so
  // summing it under a "$" was the currency mismatch the reporter saw. `usdOf` prefers the true USD-of-record
  // and only falls back to `amount` for genuine non-GHS rows — GHS rows without a USD figure contribute 0
  // rather than leaking a GHS magnitude into a USD total.
  const usdOf = (p) => p.usd != null ? p.usd : (p.currency === "GHS" ? 0 : p.amount);
  const totalPaid = A.payments.filter(p => p.status === "paid").reduce((s, p) => s + usdOf(p), 0);
  const outstanding = A.bookings.filter(b => b.payment === "unpaid").reduce((s, b) => s + b.total, 0);
  // TRI-1006/1033: Refunded = money actually returned = the negative refund ledger rows (one per refund).
  // Summing status==="refunded" instead double-counted the flipped original + its negative row (netting ~0).
  const refundRows = A.payments.filter(p => p.amount < 0);
  const refundedTotal = refundRows.reduce((s, p) => s + Math.abs(usdOf(p)), 0);
  const failedCount = A.payments.filter(p => p.status === "failed").length;
  let rows = A.payments.filter(p => tab === "all" || p.status === tab);
  const { StatCard } = NS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Alert tone="info" title="Payments run through Paystack">Card, bank and mobile-money payments are handled by Paystack's hosted checkout — TripKoach never stores card details. Transactions sync here automatically; you can still mark pay-later bookings paid by hand when money arrives another way.</Alert>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        <StatCard label="Collected" value={"$" + totalPaid.toLocaleString()} icon="wallet" delta="+8%" deltaDir="up" hint="this month" />
        <StatCard label="Outstanding (pay later)" value={"$" + outstanding.toLocaleString()} icon="clock" deltaDir="flat" delta="4 bookings" />
        <StatCard label="Refunded" value={"$" + refundedTotal.toLocaleString()} icon="receipt" deltaDir="flat" delta={refundRows.length + (refundRows.length === 1 ? " transaction" : " transactions")} />
        <StatCard label="Failed attempts" value={String(failedCount)} icon="triangle-alert" deltaDir={failedCount > 0 ? "down" : "flat"} delta={failedCount > 0 ? "needs review" : "all clear"} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "all", label: "All" }, { id: "paid", label: "Paid" }, { id: "pending", label: "Pending" }, { id: "failed", label: "Failed" }, { id: "refunded", label: "Refunded" }]} />
      <div className="tk-tablewrap">
        <div className="tk-tabletools"><strong style={{ fontSize: 14 }}>{rows.length} transactions</strong><Button size="sm" variant="secondary" iconStart="download" style={{ marginInlineStart: "auto" }} onClick={() => exportReconciliation(A.payments)}>Export for reconciliation</Button></div>
        <DataTable density="compact"
          columns={[
            { key: "id", header: "Transaction", strong: true },
            { key: "ref", header: "Booking", render: r => <a href="#" onClick={(e) => { e.preventDefault(); go("bookings", r.ref); }} style={{ fontWeight: 600 }}>{r.ref}</a> },
            { key: "customer", header: "Customer" },
            { key: "method", header: "Method" },
            { key: "amount", header: "Amount", align: "end", render: r => {
              // TRI-1033: show the USD-of-record (matches the Bookings page) with the real GHS charge as an
              // "≈" note so finance sees the actual money moved. When there is no USD figure (legacy/older
              // refund rows), fall back to the row's true currency rather than mislabel a GHS number as USD.
              const hasUsd = r.usd != null;
              return <Price amount={hasUsd ? r.usd : r.amount} currency={hasUsd ? "USD" : (r.currency || "USD")}
                approxAmount={hasUsd && r.currency === "GHS" && r.ghs != null ? r.ghs : null} approxCurrency="GHS" size="sm" />;
            } },
            { key: "status", header: "Status", render: r => payBadge(r.status) },
            { key: "date", header: "Date" },
          ]}
          rows={rows} getRowId={r => r.id}
          rowActions={(r) => r.status === "pending"
            ? <Button size="sm" variant="secondary" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.markPaid(r.id), () => { patchPayment(r, "paid"); window.tkToast("Marked " + r.id + " as paid"); })}>Mark paid</Button>
            : r.status === "paid" ? <IconButton icon="receipt" label="Issue refund" variant="ghost" size="sm" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.refundPayment(r.id), () => { patchPayment(r, "refunded"); window.tkToast("Refund started for " + r.id); })} /> : null /* TRI-1010: dropped the dead "Retry" ellipsis — failed/refunded rows have no admin action (the customer re-pays through Paystack; there is no server retry). */}
          empty={<EmptyState icon="wallet" title="No transactions" body="Payments appear here once money starts moving." />} />
      </div>
    </div>
  );
}

/* ── Promo codes ───────────────────────────────────────── */
function PromosAdmin({ go }) {
  const A = window.TK_ADMIN;
  const [edit, setEdit] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const stateOf = (p) => !p.active ? <Badge tone="neutral">Inactive</Badge> : p.used >= p.limit ? <span className="tk-badge tk-badge--failed">Exhausted</span> : <span className="tk-badge tk-badge--confirmed">Active</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-tablewrap">
        <div className="tk-tabletools"><strong style={{ fontSize: 14 }}>{A.promos.length} codes</strong><Button size="sm" iconStart="plus" style={{ marginInlineStart: "auto" }} onClick={() => setEdit({ code: "", type: "percent", value: 10, currency: "USD", limit: 100, tours: "All tours", active: true })}>New promo code</Button></div>
        <DataTable
          columns={[
            { key: "code", header: "Code", strong: true, render: r => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: ".04em" }}>{r.code}</span> },
            { key: "type", header: "Value", render: r => r.type === "percent" ? r.value + "% off" : "$" + r.value + " off" },
            { key: "usage", header: "Used", render: r => <span className="tk-num">{r.used} / {r.limit}</span> },
            { key: "tours", header: "Applies to" },
            { key: "window", header: "Valid", render: r => <span className="tk-caption">{r.from} → {r.to}</span> },
            { key: "state", header: "State", render: r => stateOf(r) },
          ]}
          rows={A.promos} getRowId={r => r.code} onRowClick={(r) => setEdit(r)}
          rowActions={(r) => <IconButton icon="ellipsis" label={"Actions for " + r.code} variant="ghost" size="sm" onClick={() => setEdit(r)} />}
          empty={<EmptyState icon="badge-percent" title="No promo codes" body="Create a code to run a seasonal discount." action={<Button iconStart="plus" onClick={() => setEdit({})}>New promo code</Button>} />} />
      </div>
      <Drawer open={!!edit} title={edit && edit.code ? "Edit " + edit.code : "New promo code"} onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.savePromo({ id: edit && edit.code ? edit.code : undefined, code: (document.getElementById("pc-code") || {}).value, type: (document.getElementById("pc-type") || {}).value || "percent", value: +(((document.getElementById("pc-val") || {}).value) || 0), tours: (document.getElementById("pc-tours") || {}).value, from: (document.getElementById("pc-from") || {}).value, to: (document.getElementById("pc-to") || {}).value, limit: +(((document.getElementById("pc-limit") || {}).value) || 0), active: !!(edit && edit.active), currency: "USD" }), () => { setToast("Promo code saved"); setEdit(null); })}>Save code</Button></>}>
        {edit && <>
          <FormField id="pc-code" label="Code" help="Uppercase, no spaces"><Input defaultValue={edit.code} style={{ textTransform: "uppercase" }} /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField id="pc-type" label="Type"><Select defaultValue={edit.type} options={[{ value: "percent", label: "Percentage" }, { value: "fixed", label: "Fixed amount" }]} /></FormField>
            <FormField id="pc-val" label="Value"><Input inputMode="numeric" defaultValue={edit.value} iconStart={edit.type === "fixed" ? "wallet" : undefined} /></FormField>
          </div>
          <FormField id="pc-tours" label="Applies to"><Select defaultValue={edit.tours} options={[{ value: "All tours", label: "All tours" }, { value: "Cultural Discovery", label: "Category: Cultural Discovery" }, { value: "Coastal History Trail", label: "Specific tour…" }]} /></FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField id="pc-from" label="Valid from"><Input type="date" /></FormField>
            <FormField id="pc-to" label="Valid until"><Input type="date" /></FormField>
          </div>
          <FormField id="pc-limit" label="Usage limit" help="Total redemptions across all customers"><Input inputMode="numeric" defaultValue={edit.limit} /></FormField>
          <Switch id="pc-active" label="Active" checked={edit.active} onChange={() => setEdit({ ...edit, active: !edit.active })} />
        </>}
      </Drawer>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Admin recovery (TRI-1083 · spec TRI-1081 · plan TRI-1080 §1) ──────────
 * Three recovery actions an admin runs on ANOTHER admin's account, launched from
 * the Staff row menu's "Recover access" group: clear a lockout, regenerate the
 * target's MFA recovery codes, and force MFA re-enrolment. Reuses Modal/Alert/
 * Button + the canonical MFA codes grid — no new DS primitives. Regenerated codes
 * are shown exactly ONCE and are never stored client-side; reopening the action
 * mints a fresh set (and re-invalidates). If the TRI-1082 backend requires a fresh
 * re-auth for these sensitive writes it answers 401/403 with a step-up code — we
 * then collect a current authenticator/recovery code for the ACTING admin and retry. */
function RecoverAccessModal({ kind, target, onClose, onToast }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [stepUp, setStepUp] = React.useState(false);
  const [reauth, setReauth] = React.useState("");
  const [codes, setCodes] = React.useState(null); // null → confirm step; array → codes revealed once
  const [copied, setCopied] = React.useState(false);
  if (!kind || !target) return null;
  const name = target.name || target.email || "this admin";
  const firstName = String(target.name || "").trim().split(/\s+/)[0] || name;
  const revealed = kind === "codes" && Array.isArray(codes);

  // Backend contract for step-up isn't final (TRI-1082 in flight) — match on a few plausible
  // codes/messages so the re-auth prompt still appears whatever exact shape it lands on.
  const isStepUp = (e) => {
    if (!e || (e.status !== 401 && e.status !== 403)) return false;
    const c = String(e.code || "").toLowerCase();
    if (c.indexOf("step_up") !== -1 || c.indexOf("stepup") !== -1 || c.indexOf("reauth") !== -1 || c.indexOf("re_auth") !== -1 || c.indexOf("mfa_required") !== -1) return true;
    return /step[-_ ]?up|re-?auth|confirm it'?s you/i.test(String(e.message || ""));
  };
  const call = (apiFn, onOk) => {
    if (busy) return;
    setBusy(true); setErr(null);
    const extra = stepUp && reauth.trim() ? { reauthCode: reauth.trim(), code: reauth.trim() } : undefined;
    Promise.resolve(apiFn(target.id, extra)).then(
      (res) => { setBusy(false); onOk(res); },
      (e) => {
        setBusy(false);
        if (isStepUp(e)) { setErr(stepUp && reauth ? "That code didn't match — enter a current code and try again." : null); setStepUp(true); return; }
        if (e && e.status === 401) { window.dispatchEvent(new CustomEvent("tk-admin-401")); return; } // real session expiry → login
        setErr((e && e.message) || "Something went wrong. Please try again.");
      }
    );
  };
  const errBlock = err ? <Alert tone="error" title="Couldn't complete that" style={{ marginBottom: "var(--space-3)" }}>{err}</Alert> : null;
  const stepUpField = (stepUp && !revealed) ? <div style={{ marginTop: "var(--space-3)" }}>
    <Alert tone="info" title="Confirm it's you">For this sensitive action, enter a current authenticator or recovery code for your own account.</Alert>
    <FormField id="ra-reauth" label="Your authenticator or recovery code"><Input id="ra-reauth" value={reauth} onChange={(e) => setReauth(e.target.value)} autoComplete="one-time-code" /></FormField>
  </div> : null;

  if (kind === "clear") return (
    <Modal open title={"Clear lockout for " + name + "?"} onClose={busy ? undefined : onClose}
      actions={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy} onClick={() => call(window.TK_ADMIN_API.clearStaffLockout, () => { onToast("Lockout cleared for " + name + "."); onClose(); })}>{busy ? "Clearing…" : "Clear lockout"}</Button></>}>
      {errBlock}
      <p className="tk-body-sm tk-muted">This resets the failed-login counter and removes the lock, letting {firstName} sign in again right away. Their password and two-factor are unchanged.</p>
      {stepUpField}
    </Modal>
  );

  if (kind === "reset") return (
    <Modal open tone="danger" title={"Reset two-factor for " + name + "?"} onClose={busy ? undefined : onClose}
      actions={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" disabled={busy} onClick={() => call(window.TK_ADMIN_API.resetStaffMfa, () => { onToast("Two-factor reset — " + name + " must re-enrol at next sign-in."); onClose(); })}>{busy ? "Resetting…" : "Reset two-factor"}</Button></>}>
      {errBlock}
      <Alert tone="warning" title="This removes their authenticator app">At their next sign-in {firstName} will be required to set up two-factor again from scratch.</Alert>
      <p className="tk-body-sm tk-muted" style={{ marginTop: "var(--space-3)" }}>{firstName} still needs their own password to finish re-enrolment — this doesn't sign them in for you or reveal their password.</p>
      {stepUpField}
    </Modal>
  );

  // kind === "codes" — step 1 confirm
  if (!revealed) return (
    <Modal open title={"Regenerate recovery codes for " + name} onClose={busy ? undefined : onClose}
      actions={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy} onClick={() => call(window.TK_ADMIN_API.regenerateStaffRecoveryCodes, (res) => setCodes((res && res.recoveryCodes) || []))}>{busy ? "Generating…" : "Generate codes"}</Button></>}>
      {errBlock}
      <Alert tone="warning" title="This replaces their current codes">This creates 10 new one-time recovery codes and immediately invalidates {firstName}'s current codes. You'll see the new codes once, on the next screen — we never store them in a readable form, so they can't be recovered later.</Alert>
      {stepUpField}
    </Modal>
  );

  // kind === "codes" — step 2, codes revealed ONCE. No backdrop/Escape close (onClose no-op); only Done exits.
  return (
    <Modal open title={"New recovery codes for " + name} onClose={function () {}}
      actions={<Button onClick={() => { onToast("Recovery codes regenerated for " + name + "."); onClose(); }}>Done</Button>}>
      <Alert tone="success" title="New codes generated">10 new codes generated. {firstName}'s old codes no longer work.</Alert>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", marginTop: "var(--space-3)" }}>
        {codes.map((c) => <span key={c} className="tk-num" style={{ fontSize: 14, letterSpacing: "0.04em", color: "var(--text-strong)" }}>{c}</span>)}
        <span className="tk-caption tk-muted" style={{ gridColumn: "1 / -1" }}>These will not be shown again.</span>
      </div>
      <Button variant="secondary" size="sm" iconStart={copied ? "check" : "copy"} style={{ marginTop: 10 }}
        onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(codes.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (_) {} }}>{copied ? "Copied" : "Copy codes"}</Button>
      <Alert tone="warning" title="Deliver over a trusted channel" style={{ marginTop: "var(--space-3)" }}>Give these to {firstName} in person or over their known-good email. Anyone who has a code can pass two-factor as {firstName}. Don't paste them into chat or tickets.</Alert>
    </Modal>
  );
}

/* ── Users & roles ─────────────────────────────────────── */
function UsersAdmin({ go }) {
  const A = window.TK_ADMIN;
  const [invite, setInvite] = React.useState(false);
  const [edit, setEdit] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  // TRI-1083: admin recovery actions are admin-only (users.manage) and hidden on the acting
  // admin's own row (self-recovery goes through More → Security). `recover` = { kind, target }.
  const [recover, setRecover] = React.useState(null);
  const _sess = window.TK_ADMIN_SESSION || {};
  const _me = _sess.staff || {};
  const myId = _me.id;
  const _perms = _sess.permissions;
  const canManageUsers = String(_sess.role || _me.role || "").toLowerCase() === "admin"
    || (Array.isArray(_perms) ? _perms.indexOf("users.manage") !== -1 : !!(_perms && _perms["users.manage"]));
  // TRI-996: screens read the mutable A.staff global directly, so a successful
  // write must both mutate the shared record AND force a re-render (TRI-980
  // pattern) — run only from the TK_ADMIN_ACT success callback, never on failure.
  const [, forceRerender] = React.useReducer((x) => x + 1, 0);
  const initialsOf = (name) => String(name || "").split(/\s+/).map(w => w.charAt(0)).join("").slice(0, 2).toUpperCase();
  const applyStaff = (id, patch) => {
    const s = (A.staff || []).find((x) => x.id === id);
    if (s) { Object.assign(s, patch); if (patch.name !== undefined) s.initials = initialsOf(patch.name); }
    forceRerender();
  };
  const removeStaff = (id) => {
    const i = (A.staff || []).findIndex((x) => x.id === id);
    if (i >= 0) A.staff.splice(i, 1);
    forceRerender();
  };
  const copyEmail = (r) => {
    try { navigator.clipboard && navigator.clipboard.writeText(r.email); } catch (_) {}
    setToast(r.email + " copied");
  };
  const roleLabel = { admin: "Admin", operator: "Operator", viewer: "Read-only" };
  const kebab = (r) => {
    const items = [
      { label: "Edit details", icon: "pencil", onClick: () => setEdit({ id: r.id, name: r.name, role: r.role, jobTitle: r.jobTitle || "", status: r.status, email: r.email }) },
      { label: "Copy email address", icon: "mail", onClick: () => copyEmail(r) },
      { divider: true },
    ];
    if (r.status === "invited") {
      items.push({ label: "Resend invite", icon: "refresh-cw", onClick: () => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.resendStaffInvite(r.id), () => setToast("Invite re-sent to " + r.email)) });
      items.push({ label: "Revoke invite", icon: "trash-2", danger: true, onClick: () => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.revokeStaffInvite(r.id), () => { removeStaff(r.id); setToast("Invite to " + r.email + " revoked"); }) });
    }
    if (r.status === "disabled")
      items.push({ label: "Re-enable account", icon: "circle-check-big", onClick: () => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.enableStaff(r.id), () => { applyStaff(r.id, { status: "active" }); setToast(r.name + " re-enabled"); }) });
    else if (r.status !== "invited")
      items.push({ label: "Disable account", icon: "log-out", danger: true, onClick: () => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.disableStaff(r.id), () => { applyStaff(r.id, { status: "disabled" }); setToast(r.name + " disabled — signed out everywhere"); }) });
    // TRI-1083: "Recover access" group — admin-only, and never on your own row or a pending invite
    // (an invited account has no lockout/MFA state yet). Inline grouped section (TRI-1081 §1), not a flyout.
    if (canManageUsers && r.id !== myId && r.status !== "invited") {
      items.push({ divider: true });
      items.push({ section: true, label: "Recover access" });
      // TRI-1080 follow-up: only actionable when the account is actually locked; on an
      // active account it's an inert no-op, so show it disabled with a "Not locked" hint.
      items.push(r.locked
        ? { label: "Clear lockout", icon: "lock", onClick: () => setRecover({ kind: "clear", target: r }) }
        : { label: "Clear lockout", icon: "lock", disabled: true, hint: "Not locked" });
      // TRI-1080: both MFA actions require the target to actually have 2FA enabled.
      // Regenerating codes hits a backend 409 ("enable MFA first") when off, and there's
      // nothing to reset when off — so gate both on r.mfaEnabled with a "2FA not enabled"
      // hint. Clear lockout stays independent (gated on r.locked above). For a not-yet-
      // enrolled locked-out admin the right recovery is Clear lockout → they enroll at login.
      items.push(r.mfaEnabled
        ? { label: "Regenerate recovery codes", icon: "rotate-ccw", onClick: () => setRecover({ kind: "codes", target: r }) }
        : { label: "Regenerate recovery codes", icon: "rotate-ccw", disabled: true, hint: "2FA not enabled" });
      items.push(r.mfaEnabled
        ? { label: "Force MFA re-enrollment", icon: "shield-check", danger: true, onClick: () => setRecover({ kind: "reset", target: r }) }
        : { label: "Force MFA re-enrollment", icon: "shield-check", disabled: true, hint: "2FA not enabled" });
    }
    return items;
  };
  const saveEdit = () => {
    if (!edit) return;
    const name = (document.getElementById("se-name") || {}).value;
    const role = (document.getElementById("se-role") || {}).value || edit.role;
    const jobTitle = (document.getElementById("se-title") || {}).value || "";
    window.TK_ADMIN_ACT(
      () => window.TK_ADMIN_API.updateStaff(edit.id, { name: name, role: role, jobTitle: jobTitle }),
      () => { applyStaff(edit.id, { name: name, role: role, jobTitle: jobTitle }); setToast("Staff member updated"); setEdit(null); }
    );
  };
  // TRI-1011: the role→permission matrix is real RBAC — the same rows the API guards resolve per request.
  // Hydrate from GET /admin/roles/permissions and persist each toggle to PUT /admin/roles/permissions, so
  // what an admin sees here is exactly what Operators/Read-only staff can do. (These defaults are only the
  // design-preview seed for the non-LIVE bundle; LIVE overwrites them from the server on mount.)
  const DEFAULT_PERMS = {
    "tours.view": { admin: true, operator: true, viewer: true }, "tours.edit": { admin: true, operator: true, viewer: false },
    "bookings.view": { admin: true, operator: true, viewer: true }, "bookings.manage": { admin: true, operator: true, viewer: false },
    "bookings.cancel": { admin: true, operator: true, viewer: false }, "payments.refund": { admin: true, operator: false, viewer: false },
    "customers.view": { admin: true, operator: true, viewer: true }, "promos.manage": { admin: true, operator: true, viewer: false },
    "users.manage": { admin: true, operator: false, viewer: false }, "settings.manage": { admin: true, operator: false, viewer: false },
  };
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [perms, setPerms] = React.useState(DEFAULT_PERMS);
  const [permsBusy, setPermsBusy] = React.useState(false);
  React.useEffect(() => {
    if (!LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.getRolePermissions) return;
    let live = true;
    window.TK_ADMIN_API.getRolePermissions()
      .then((res) => { if (live && res && res.matrix) setPerms(res.matrix); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const roleBadge = (r) => ({ admin: <Badge tone="solid">Admin</Badge>, operator: <span className="tk-badge tk-badge--confirmed">Operator</span>, viewer: <Badge tone="neutral">Read-only</Badge> }[r]);
  const statusBadge = (s) => ({ active: <span className="tk-badge tk-badge--confirmed">Active</span>, invited: <span className="tk-badge tk-badge--pending">Invited</span>, disabled: <Badge tone="neutral">Disabled</Badge> }[s]);
  // TRI-1080: 2FA state per staff row. MFA is org-enforced (TRI-912), so "Off" means
  // "not yet enrolled" (forced at next login) — muted, not alarming. Pending invites
  // have no MFA state yet, so we show a dash. This badge also gates the recovery menu.
  const mfaBadge = (r) => r.status === "invited"
    ? <span className="tk-muted">—</span>
    : r.mfaEnabled
      ? <span className="tk-badge tk-badge--confirmed" title="Two-factor authentication is enabled">On</span>
      : <span className="tk-badge tk-badge--neutral" title="Not yet enrolled — enforced at next login">Off</span>;
  const toggle = (perm, role) => {
    if (role === "admin") return; // admin is locked all-on; RoleMatrix disables its cells anyway
    const next = !(perms[perm] && perms[perm][role]);
    const prev = perms;
    const optimistic = { ...perms, [perm]: { ...perms[perm], [role]: next } };
    setPerms(optimistic); // optimistic; revert on failure
    if (!LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.saveRolePermissions) return;
    setPermsBusy(true);
    window.TK_ADMIN_API.saveRolePermissions({ [role]: { [perm]: next } })
      .then((res) => { if (res && res.matrix) setPerms(res.matrix); setToast(next ? "Permission granted — takes effect immediately" : "Permission revoked — takes effect immediately"); })
      .catch((e) => { setPerms(prev); setToast((e && e.message) ? e.message : "Couldn't save permission change"); })
      .then(() => setPermsBusy(false));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="tk-tablewrap">
        <div className="tk-tabletools"><strong style={{ fontSize: 14 }}>{A.staff.length} staff accounts</strong><Button size="sm" iconStart="plus" style={{ marginInlineStart: "auto" }} onClick={() => setInvite(true)}>Invite staff</Button></div>
        <DataTable
          columns={[
            { key: "name", header: "Name", strong: true, render: r => (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: "none", width: 32, height: 32, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12, opacity: r.status === "disabled" ? .5 : 1 }}>{r.initials}</span>{r.name}</span>) },
            { key: "email", header: "Email" },
            { key: "role", header: "Role", render: r => roleBadge(r.role) },
            { key: "mfa", header: "2FA", render: r => mfaBadge(r) },
            { key: "status", header: "Status", render: r => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {statusBadge(r.status)}
                {r.locked && <span className="tk-badge tk-badge--cancelled" title={r.lockedUntil ? "Locked until " + new Date(r.lockedUntil).toLocaleString() : "Locked"}>Locked</span>}
              </span>) },
            { key: "last", header: "Last active" },
          ]}
          rows={A.staff} getRowId={r => r.id}
          rowActions={(r) => <PortalRowMenu label={"Actions for " + r.name} items={kebab(r)} />} />
      </div>
      <div>
        <h3 className="tk-h5" style={{ marginBottom: 4 }}>Role permissions</h3>
        <p className="tk-caption" style={{ marginBottom: 12 }}>Admins always have every permission. Toggle what Operators and Read-only staff can do.</p>
        <RoleMatrix
          roles={[{ id: "admin", label: "Admin", locked: true }, { id: "operator", label: "Operator" }, { id: "viewer", label: "Read-only" }]}
          permissions={[
            { id: "tours.view", label: "View tours" }, { id: "tours.edit", label: "Create & edit tours" },
            { id: "bookings.view", label: "View bookings" }, { id: "bookings.manage", label: "Confirm bookings" },
            { id: "bookings.cancel", label: "Cancel bookings", hint: "Destructive" }, { id: "payments.refund", label: "Issue refunds", hint: "Destructive" },
            { id: "customers.view", label: "View customer data", hint: "Personal data" }, { id: "promos.manage", label: "Manage promo codes" },
            { id: "users.manage", label: "Manage staff & roles" }, { id: "settings.manage", label: "Change settings" },
          ]}
          value={perms} onToggle={toggle} readOnly={permsBusy} />
      </div>
      <Drawer open={invite} title="Invite staff" subtitle="They'll get an email to set a password and enable two-factor." onClose={() => setInvite(false)}
        footer={<><Button variant="secondary" onClick={() => setInvite(false)}>Cancel</Button><Button iconStart="mail" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.inviteStaff({ email: (document.getElementById("iv-email") || {}).value, name: (document.getElementById("iv-name") || {}).value, role: (document.getElementById("iv-role") || {}).value || "operator" }), () => { setToast("Invite sent"); setInvite(false); })}>Send invite</Button></>}>
        <FormField id="iv-email" label="Work email" required><Input type="email" iconStart="mail" /></FormField>
        <FormField id="iv-name" label="Full name"><Input /></FormField>
        <FormField id="iv-role" label="Role" help="You can change this later"><Select defaultValue="operator" options={[{ value: "admin", label: "Admin — full access" }, { value: "operator", label: "Operator — day-to-day ops" }, { value: "viewer", label: "Read-only — view but not change" }]} /></FormField>
      </Drawer>
      <Drawer open={!!edit} title="Edit staff member" subtitle={edit ? edit.email : ""} onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button iconStart="check" onClick={saveEdit}>Save changes</Button></>}>
        {edit && <>
          <FormField id="se-name" label="Full name"><Input defaultValue={edit.name} /></FormField>
          <FormField id="se-role" label="Role" help="Changing to Operator or Read-only removes admin access. The last active admin can't be demoted.">
            <Select defaultValue={edit.role} options={[{ value: "admin", label: "Admin — full access" }, { value: "operator", label: "Operator — day-to-day ops" }, { value: "viewer", label: "Read-only — view but not change" }]} /></FormField>
          <FormField id="se-title" label="Job title" help="Shown on their profile — e.g. Operations Lead"><Input defaultValue={edit.jobTitle} /></FormField>
          {edit.status === "invited" && <Alert tone="info" title="Invite pending">This person hasn't accepted their invite yet. Role and name changes apply now; use “Resend invite” from the row menu if they need a fresh link.</Alert>}
        </>}
      </Drawer>
      {recover && <RecoverAccessModal kind={recover.kind} target={recover.target} onClose={() => setRecover(null)} onToast={setToast} />}
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Settings ──────────────────────────────────────────── */
function SettingsAdmin({ go }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [tab, setTab] = React.useState("general");
  const [toast, setToast] = React.useState(null);
  // A14/C19 (TRI-898): hydrate from GET /api/admin/settings and surface BOTH
  // USD→GHS rates distinctly — the editable customer-facing display rate and the
  // read-only charge rate owned by the FX cron. Flag off → LIVE is false, `data`
  // stays null, and every field keeps its prototype defaultValue (byte-identical).
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    if (!LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.getSettings) return;
    let alive = true;
    window.TK_ADMIN_API.getSettings().then((s) => { if (alive && s) setData(s); }, () => {});
    return () => { alive = false; };
  }, []);
  // Apply fetched values to whatever fields are currently mounted (fields are
  // per-tab, so re-apply on tab switch too). Uncontrolled inputs → set imperatively.
  React.useEffect(() => {
    if (!data) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null && v !== "") el.value = v; };
    set("s-org", data.businessName); set("s-addr", data.address);
    set("s-phone", data.supportPhone); set("s-email", data.supportEmail);
    set("s-cur", data.currencyOfRecord); set("s-disp", data.displayCurrency || "none");
    set("s-rate", data.usdToGhsDisplayRate != null ? data.usdToGhsDisplayRate : (data.fx && data.fx.displayRate && data.fx.displayRate.value));
    set("s-canc", data.cancellationPolicy); set("s-deadline", data.paymentDeadlineDays);
    set("s-terms", data.termsConditions); // TRI-1150 canonical T&C (empty until Content publishes)
  }, [data, tab]);
  const chargeRate = data && data.fx && data.fx.chargeRate;
  const Section = ({ title, hint, children }) => (
    <div className="tk-formsection"><div className="tk-formsection__aside"><h3>{title}</h3><p>{hint}</p></div><div className="tk-formsection__body">{children}</div></div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "general", label: "General" }, { id: "pricing", label: "Pricing & currency" }, { id: "policy", label: "Policies" }, { id: "notify", label: "Notifications" }]} />
      <div style={{ maxWidth: 900 }}>
        {tab === "general" && <>
          <Section title="Organization" hint="Shown on invoices and customer emails.">
            <FormField id="s-org" label="Business name"><Input defaultValue="TripKoach Ghana Ltd" /></FormField>
            <FormField id="s-addr" label="Address"><Input defaultValue="P.O. Box CT 11125, Cantonments, Accra" /></FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <FormField id="s-phone" label="Support phone"><Input defaultValue="+233 53 324 4042" /></FormField>
              <FormField id="s-email" label="Support email"><Input defaultValue="services@tripkoach.com" /></FormField>
            </div>
          </Section>
        </>}
        {tab === "pricing" && <>
          <Section title="Currency" hint="The currency of record is what customers are charged. USD today.">
            <FormField id="s-cur" label="Currency of record"><Select defaultValue="USD" options={[{ value: "USD", label: "US Dollar (USD)" }, { value: "GHS", label: "Ghana Cedi (GHS)" }]} /></FormField>
            <FormField id="s-disp" label="Also display prices in" help="An approximate second currency shown to customers"><Select defaultValue="none" options={[{ value: "none", label: "Don't show a second currency" }, { value: "GHS", label: "Ghana Cedi (GHS)" }]} /></FormField>
            <FormField id="s-rate" label="USD → GHS display rate" help="Used only for the approximate figure"><Input defaultValue="15.6" /></FormField>
            {chargeRate && <FormField id="s-charge" label="USD → GHS charge rate (automated)" help={"Drives what customers are actually charged in GHS · source " + (chargeRate.source || "FX cron") + ". Set by the daily FX automation — not editable here."}><Input defaultValue={chargeRate.value} readOnly disabled /></FormField>}
            {chargeRate && <Alert tone="info" title="Two separate rates">The <strong>display rate</strong> above is only for the approximate figure shown to customers. The <strong>charge rate</strong> is what builds each Paystack charge and is owned by the daily FX cron — editing the display rate never changes it.</Alert>}
          </Section>
        </>}
        {tab === "policy" && <>
          <Section title="Cancellation policy" hint="Shown at checkout and on booking pages.">
            <FormField id="s-canc" label="Policy text"><Textarea rows={4} defaultValue={"Free cancellation until 7 days before departure. Between 7 and 2 days, half the total is held. Inside 48 hours the booking is non-refundable."} /></FormField>
            <FormField id="s-deadline" label="Payment deadline" help="How long before departure payment is due"><Select defaultValue="5" options={[{ value: "3", label: "3 days before departure" }, { value: "5", label: "5 days before departure" }, { value: "7", label: "7 days before departure" }]} /></FormField>
          </Section>
          {/* TRI-1150: the single canonical Terms & Conditions both agree-gates (checkout + sign-up)
              read via /config. Distinct from the cancellation blurb above. Leave blank until Content
              provides the real document — the customer disclosure stays hidden while it's empty, so
              no placeholder ever ships. */}
          <Section title="Terms & Conditions" hint="The full T&C customers can read before agreeing at checkout and sign-up. Leave blank until Content has real copy — it won't show to customers while empty.">
            <FormField id="s-terms" label="Terms & Conditions text" help="Plain text; line breaks and paragraphs are preserved. This is the one source both agree-gates use."><Textarea rows={10} /></FormField>
          </Section>
        </>}
        {tab === "notify" && <>
          {/* TRI-1009: these are transactional/system emails with no per-toggle backend — the
              notifier always sends them and there is no setting the sending code consults. They
              were previously plain/read-only switches that no Save ever persisted, which read as
              broken toggles. Mark them honestly as system-managed and always on (read-only), and
              add a note so it's clear they aren't hand-editable here. (Post-trip review requests
              are issued per departure from the Departures screen, not a global toggle.) */}
          <Alert tone="info" title="These emails are system-managed">Booking, payment, departure and staff-alert emails are transactional and always on — they can't be switched off here. They're shown for reference so you know exactly what the system sends.</Alert>
          <Section title="Customer emails" hint="Automatic emails sent on booking events. Always on.">
            <Switch id="n1" label="Booking confirmation email" checked readOnly disabled />
            <Switch id="n2" label="Payment reminder before deadline" checked readOnly disabled />
            <Switch id="n3" label="Departure reminder 48h before" checked readOnly disabled />
            <Switch id="n4" label="Post-trip review request" checked readOnly disabled />
          </Section>
          <Section title="Staff alerts" hint="Where new bookings and failures are announced. Always on.">
            <Switch id="n5" label="New booking to ops inbox" checked readOnly disabled />
            <Switch id="n6" label="Failed payment alert" checked readOnly disabled />
          </Section>
        </>}
      </div>
      <div className="tk-stickysave"><span className="tk-caption">Changes apply to both the website and the app.</span><Button iconStart="check" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.saveSettings({ businessName: (document.getElementById("s-org") || {}).value, address: (document.getElementById("s-addr") || {}).value, supportPhone: (document.getElementById("s-phone") || {}).value, supportEmail: (document.getElementById("s-email") || {}).value, currencyOfRecord: (document.getElementById("s-cur") || {}).value, displayCurrency: (document.getElementById("s-disp") || {}).value, usdToGhsDisplayRate: +(((document.getElementById("s-rate") || {}).value) || 0) || undefined, cancellationPolicy: (document.getElementById("s-canc") || {}).value, paymentDeadlineDays: +(((document.getElementById("s-deadline") || {}).value) || 0) || undefined, termsConditions: (document.getElementById("s-terms") || {}).value }), () => setToast("Settings saved"))}>Save settings</Button></div>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Permission denied (403) ───────────────────────────── */
function Forbidden({ go }) {
  return (
    <div style={{ padding: "48px 0" }}>
      <EmptyState icon="lock" title="You don't have access to this"
        body="This area needs a permission your role doesn't have. Ask an administrator if you think this is a mistake."
        action={<Button onClick={() => go("dashboard")}>Back to dashboard</Button>} />
    </div>
  );
}

/* ── Admin MFA (TRI-899) ───────────────────────────────────────────────────
 * Self-service two-factor for the signed-in staff member, wired to the
 * /api/admin/auth/mfa/* endpoints (TRI-895). These components only ever mount
 * when USE_LIVE_API is on (see AccountProfileAdmin), so the flag-off DS
 * prototype below is byte-identical.
 *
 * Two entry points share one drawer:
 *   • First-time enroll (the DS gap) — mode "enroll": begin enroll → scan the
 *     setup key → verify a 6-digit code → save recovery codes.
 *   • Reconfigure — mode "reconfigure": confirm a current code (disables the old
 *     factor) → then the same enroll flow. Permanent self-service turn-off is
 *     intentionally NOT surfaced — policy requires 2FA for all staff.
 */
function MfaCodeBoxes({ code, setCode, error }) {
  const refs = React.useRef([]);
  const setDigit = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const next = code.slice(); next[i] = v; setCode(next);
    if (v && i < 5) refs.current[i + 1] && refs.current[i + 1].focus();
  };
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {code.map((d, i) => (
        <input key={i} ref={(el) => refs.current[i] = el} value={d} onChange={(e) => setDigit(i, e.target.value)}
          inputMode="numeric" maxLength={1} aria-label={"Digit " + (i + 1)}
          style={{ width: 44, height: 52, textAlign: "center", fontSize: 20, fontWeight: 700, borderRadius: "var(--radius-md)", border: "1px solid " + (error ? "var(--danger-solid)" : "var(--border-input)"), background: "var(--surface-card)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }} />
      ))}
    </div>
  );
}

function MfaEnrollDrawer({ open, mode, onClose, onEnabled, setToast }) {
  // step: confirm (reconfigure only) → scan → codes
  const [step, setStep] = React.useState(mode === "reconfigure" ? "confirm" : "scan");
  const [data, setData] = React.useState(null);            // { secret, otpauthUri, issuer }
  const [confirmCode, setConfirmCode] = React.useState("");
  const [code, setCode] = React.useState(["", "", "", "", "", ""]);
  const [recoveryCodes, setRecoveryCodes] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const beginEnroll = React.useCallback(() => {
    setBusy(true); setErr(null);
    return window.TK_ADMIN_API.mfaEnroll().then(
      (d) => { setData(d); setStep("scan"); setBusy(false); },
      (e) => { setBusy(false); setErr((e && e.message) || "Couldn't start enrollment. Please try again."); });
  }, []);

  React.useEffect(() => {
    if (!open) { // reset for next time
      setStep(mode === "reconfigure" ? "confirm" : "scan");
      setData(null); setConfirmCode(""); setCode(["", "", "", "", "", ""]); setRecoveryCodes(null); setBusy(false); setErr(null);
      return;
    }
    // On open, seed the starting step from mode. The drawer is always mounted (open just toggles),
    // so the useState initializer above ran while mode was still "enroll" — we can't rely on it to
    // land reconfigure on "confirm". Without this, reconfigure opened straight into "scan" with no
    // enroll data, so the QR never rendered (TRI-987).
    if (mode === "reconfigure") setStep("confirm"); // confirm a current code → disables old factor → enroll
    else beginEnroll(); // first-time: enroll immediately
  }, [open, mode, beginEnroll]);

  // Reconfigure: verify a current code (disables the old factor), then enroll.
  const confirmReconfigure = () => {
    setBusy(true); setErr(null);
    window.TK_ADMIN_API.mfaDisable(confirmCode.trim())
      .then(() => beginEnroll())
      .catch((e) => { setBusy(false); setErr((e && e.message) || "Enter a current authenticator or recovery code to continue."); });
  };
  const verify = () => {
    setBusy(true); setErr(null);
    window.TK_ADMIN_API.mfaVerifyEnroll(code.join("")).then(
      (r) => { setRecoveryCodes((r && r.recoveryCodes) || []); setStep("codes"); setBusy(false); onEnabled && onEnabled(); },
      (e) => { setBusy(false); setErr((e && e.message) || "That code didn't match — check your authenticator app and try again."); });
  };

  const secretPretty = data && data.secret ? data.secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim() : "";
  const title = mode === "reconfigure" ? "Reconfigure two-factor" : "Set up two-factor authentication";
  const footer = step === "codes"
    ? <Button onClick={onClose} style={{ marginInlineStart: "auto" }}>Done</Button>
    : step === "confirm"
      ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !confirmCode.trim()} onClick={confirmReconfigure} style={{ marginInlineStart: "auto" }}>{busy ? "Checking…" : "Continue"}</Button></>
      : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button iconStart="check" disabled={busy || step !== "scan" || code.join("").length < 6} onClick={verify} style={{ marginInlineStart: "auto" }}>{busy ? "Verifying…" : "Verify & turn on"}</Button></>;

  return (
    <Drawer open={open} title={title} subtitle="Protect your staff account with an authenticator app" onClose={onClose} footer={footer}>
      {err && <Alert tone="error" title="Something went wrong">{err}</Alert>}
      {step === "confirm" && (
        <>
          <Alert tone="info" title="Confirm it's you">Enter a current authenticator or recovery code. This replaces your existing authenticator with a new one.</Alert>
          <FormField id="mfa-reconf-code" label="Current code"><Input id="mfa-reconf-code" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} autoComplete="one-time-code" /></FormField>
        </>
      )}
      {step === "scan" && (
        <>
          <ol className="tk-body-sm" style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 6, color: "var(--text-body)" }}>
            <li>Open your authenticator app (Google Authenticator, Authy, 1Password…).</li>
            <li>Scan the QR code below — or add an account with the setup key.</li>
            <li>Enter the 6-digit code it shows to finish.</li>
          </ol>
          {data && data.otpauthUri && (
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
              <div style={{ padding: 12, background: "#fff", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)" }}>
                <MfaQr text={data.otpauthUri} px={184} />
              </div>
            </div>
          )}
          <FormField id="mfa-secret" label="Setup key" hint="Can't scan? Type or paste this into your authenticator app.">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Input id="mfa-secret" readOnly value={secretPretty} style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.08em" }} />
              <Button variant="secondary" size="sm" iconStart="copy" onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(data.secret); setToast && setToast("Setup key copied"); } catch (_) {} }}>Copy</Button>
            </div>
          </FormField>
          <FormField id="mfa-verify" label="Verification code" error={err ? "Check the code and try again" : undefined}>
            <MfaCodeBoxes code={code} setCode={setCode} error={!!err} />
          </FormField>
        </>
      )}
      {step === "codes" && (
        <>
          <Alert tone="success" title="Two-factor is on">Save these one-time recovery codes somewhere safe — each works once if you ever lose your authenticator.</Alert>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>
            {(recoveryCodes || []).map((c) => <span key={c} className="tk-num" style={{ fontSize: 14, letterSpacing: "0.04em", color: "var(--text-strong)" }}>{c}</span>)}
            <span className="tk-caption tk-muted" style={{ gridColumn: "1 / -1" }}>These won't be shown again.</span>
          </div>
          <Button variant="secondary" size="sm" iconStart="copy" style={{ marginTop: 10 }} onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText((recoveryCodes || []).join("\n")); setToast && setToast("Recovery codes copied"); } catch (_) {} }}>Copy codes</Button>
        </>
      )}
    </Drawer>
  );
}

function MfaManageDrawer({ open, onClose, status, onReconfigure, onChanged, setToast }) {
  const [codes, setCodes] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!open) { setCodes(null); setBusy(false); } }, [open]);
  const remaining = status ? status.recoveryCodesRemaining : null;
  const regen = () => {
    setBusy(true);
    window.TK_ADMIN_API.mfaRegenerateCodes().then(
      (r) => { setCodes((r && r.recoveryCodes) || []); setBusy(false); onChanged && onChanged(); },
      () => { setBusy(false); setToast && setToast("Couldn't regenerate recovery codes"); });
  };
  return (
    <Drawer open={open} title="Two-factor authentication" subtitle="Required for every staff account" onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose} style={{ marginInlineStart: "auto" }}>Done</Button>}>
      <Alert tone="success" title="Two-factor is on">Sign-in is protected by an authenticator app.</Alert>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--bg-sunken)", display: "grid", placeItems: "center" }}><Icon name="smartphone" size={18} /></span><span><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>Authenticator app</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>TOTP · active</p></span></span>
        <Button variant="secondary" size="sm" onClick={onReconfigure}>Reconfigure</Button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
        <span><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>Recovery codes</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>{remaining == null ? "Use these if you lose your phone." : remaining + " unused. Regenerating replaces all of them."}</p></span>
        <Button variant="secondary" size="sm" disabled={busy} onClick={regen}>{busy ? "Generating…" : "Regenerate"}</Button>
      </div>
      {codes && <><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>{codes.map((c) => <span key={c} className="tk-num" style={{ fontSize: 14, letterSpacing: "0.04em", color: "var(--text-strong)" }}>{c}</span>)}<span className="tk-caption tk-muted" style={{ gridColumn: "1 / -1" }}>Save these now — they won't be shown again.</span></div><Button variant="secondary" size="sm" iconStart="copy" style={{ marginTop: 10 }} onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(codes.join("\n")); setToast && setToast("Recovery codes copied"); } catch (_) {} }}>Copy codes</Button></>}
      <Alert tone="warning" title="Turning 2FA off isn't allowed">Policy requires two-factor for all staff. Use Reconfigure to switch to a new device; contact an admin to reset a lost one.</Alert>
    </Drawer>
  );
}

/* ── Staff profile (from the user menu) ────────────────── */
function AccountProfileAdmin({ go, user }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [toast, setToast] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [manage2fa, setManage2fa] = React.useState(false);
  const [changePw, setChangePw] = React.useState(false);
  const [pw, setPw] = React.useState({ cur: "", next: "", conf: "" });
  const pwOk = pw.next.length >= 10 && pw.next === pw.conf && pw.cur.length > 0;
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwErr, setPwErr] = React.useState(null);
  // TRI-1000: real change-password. This drawer previously just closed + toasted
  // "Password updated" without ever calling the API (nothing changed — the exact
  // failure Samuel hit). Live → POST /api/admin/me/password (wrong current → 401
  // shown inline). Flag off → keep the demo behaviour (byte-identical prototype).
  function submitPw() {
    if (!LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.changePassword) { setChangePw(false); setToast("Password updated"); return; }
    setPwBusy(true); setPwErr(null);
    window.TK_ADMIN_API.changePassword(pw.cur, pw.next).then(function () {
      setPwBusy(false); setChangePw(false); setToast("Password updated");
    }, function (e) {
      setPwBusy(false);
      setPwErr(e && e.status === 401 ? "Your current password is incorrect." : (e && e.message) || "We couldn't update your password. Please try again.");
    });
  }
  const [showCodes, setShowCodes] = React.useState(false);
  const codes = ["7F2K-9QL4", "B3MX-1WP8", "D6RT-5YC2", "H9NA-4VE7", "K2QZ-8JU3", "M5LP-6XB9"];
  const u = user || { name: "Kwame Boateng", role: "Admin", rawRole: "admin", initials: "KB", email: "kwame@tripkoach.com", jobTitle: null };
  const isAdmin = (u.rawRole || "").toLowerCase() === "admin";
  const [nameVal, setNameVal] = React.useState(u.name || "");
  const [phoneVal, setPhoneVal] = React.useState(u.phone || ""); // TRI-1079: phone was a no-op fake — now round-trips
  const [titleVal, setTitleVal] = React.useState(u.jobTitle || "");
  const touch = () => setDirty(true);

  function saveProfile() {
    if (!LIVE || !window.TK_ADMIN_API) { setDirty(false); setToast("Profile saved"); return; }
    const patch = { name: nameVal.trim() || undefined, phone: phoneVal.trim() };
    if (isAdmin) patch.jobTitle = titleVal.trim() || null;
    setSaving(true);
    window.TK_ADMIN_API.patchMe(patch).then(function (updated) {
      // TRI-1079 follow-up (Samuel): the PATCH persists (DB) and the value reappears
      // after a full reload/re-login, but SPA navigation away and back showed the
      // saved phone/name as lost. Root cause: `user` is derived every render from the
      // in-memory session (window.TK_ADMIN_SESSION.staff), and this screen seeds its
      // fields from that via useState on mount — but a successful save never wrote the
      // fresh values back into the session, so the next remount re-seeded from stale
      // data. Sync the returned DTO into the session cache so the derived identity
      // stays current across navigation without a reload.
      try {
        var d = (updated && updated.staff) ? updated.staff : updated;
        var sess = window.TK_ADMIN_SESSION;
        if (sess && sess.staff && d) {
          if (d.name !== undefined) sess.staff.name = d.name;
          if (d.phone !== undefined) sess.staff.phone = d.phone;
          if (d.jobTitle !== undefined) sess.staff.jobTitle = d.jobTitle;
        }
      } catch (_) {}
      // Refresh the mounted tree so the shell header/avatar reflect the change live.
      if (window.TK_ADMIN_NOTIFY_MUTATED) window.TK_ADMIN_NOTIFY_MUTATED();
      setDirty(false); setSaving(false); setToast("Profile saved");
    }, function (err) {
      setSaving(false);
      setToast((err && err.message) ? err.message : "Couldn't save profile. Please try again.");
    });
  }

  // --- Live MFA state (TRI-899). None of this runs (and none of the LIVE-only
  //     markup below mounts) when the flag is off, so the DS prototype is
  //     byte-identical. `mfa` = { enabled, pendingEnrollment, recoveryCodesRemaining }.
  const [mfa, setMfa] = React.useState(null);
  const [mfaDrawer, setMfaDrawer] = React.useState(null); // "enroll" | "reconfigure" | "manage" | null
  const refreshMfa = React.useCallback(() => {
    if (!LIVE || !window.TK_ADMIN_API) return;
    window.TK_ADMIN_API.mfaStatus().then(setMfa, function () {});
  }, [LIVE]);
  React.useEffect(() => { refreshMfa(); }, [refreshMfa]);
  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 22 }}>{u.initials}</span>
          <div><div className="tk-h5">{u.name}</div><div className="tk-caption">{u.role} · {u.email}</div></div>
          <Badge tone="neutral" style={{ marginInlineStart: "auto" }}>{u.role}</Badge>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="ap-name" label="Full name"><Input value={nameVal} onChange={e => { setNameVal(e.target.value); touch(); }} /></FormField>
          <FormField id="ap-email" label="Work email"><Input type="email" defaultValue={u.email} readOnly /></FormField>
          <FormField id="ap-phone" label="Phone"><PhoneInput id="ap-phone" value={phoneVal} onChange={e => { setPhoneVal(e.target.value); touch(); }} /></FormField>
          <FormField id="ap-title" label="Job title" optional hint={isAdmin ? undefined : "Set by your admin"}><Input value={titleVal} onChange={e => { setTitleVal(e.target.value); touch(); }} disabled={!isAdmin} /></FormField>
        </div>
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Security</h2>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>Password</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Last changed 2 months ago.</p></span>
          <Button variant="secondary" size="sm" onClick={() => { setPw({ cur: "", next: "", conf: "" }); setPwErr(null); setChangePw(true); }}>Change password</Button>
        </div>
        {LIVE ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
            <span><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>Two-factor authentication {mfa ? <span className={"tk-badge " + (mfa.enabled ? "tk-badge--confirmed" : "tk-badge--pending")}>{mfa.enabled ? "On" : "Off"}</span> : null}</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>{mfa == null ? "Checking status…" : mfa.enabled ? "Authenticator app · required for all staff." : "Required for all staff — set it up to secure your account."}</p></span>
            {mfa == null
              ? <Button variant="secondary" size="sm" disabled>Manage</Button>
              : mfa.enabled
                ? <Button variant="secondary" size="sm" onClick={() => setMfaDrawer("manage")}>Manage</Button>
                : <Button size="sm" onClick={() => setMfaDrawer("enroll")}>Set up</Button>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
            <span><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>Two-factor authentication <span className="tk-badge tk-badge--confirmed">On</span></strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Authenticator app · required for all staff.</p></span>
            <Button variant="secondary" size="sm" onClick={() => setManage2fa(true)}>Manage</Button>
          </div>
        )}
      </div></div>

      <Drawer open={changePw} title="Change password" subtitle="Choose a strong password you don't use elsewhere" onClose={() => { setChangePw(false); setPwErr(null); }}
        footer={<><Button variant="secondary" onClick={() => { setChangePw(false); setPwErr(null); }}>Cancel</Button><Button iconStart="check" disabled={!pwOk || pwBusy} onClick={submitPw} style={{ marginInlineStart: "auto" }}>{pwBusy ? "Updating…" : "Update password"}</Button></>}>
        {pwErr && <Alert tone="error" title="We couldn't update your password" style={{ marginBottom: "var(--space-4)" }}>{pwErr}</Alert>}
        <FormField id="pw-cur" label="Current password"><Input id="pw-cur" type="password" value={pw.cur} onChange={(e) => setPw(p => ({ ...p, cur: e.target.value }))} /></FormField>
        <FormField id="pw-next" label="New password" hint="At least 10 characters."><Input id="pw-next" type="password" value={pw.next} onChange={(e) => setPw(p => ({ ...p, next: e.target.value }))} /></FormField>
        <FormField id="pw-conf" label="Confirm new password" error={pw.conf && pw.next !== pw.conf ? "Passwords don't match" : undefined}><Input id="pw-conf" type="password" value={pw.conf} onChange={(e) => setPw(p => ({ ...p, conf: e.target.value }))} /></FormField>
        <Alert tone="info" title="You'll stay signed in on this device">Signing in on other devices will need the new password.</Alert>
      </Drawer>
      {LIVE ? (
        <>
          <MfaManageDrawer open={mfaDrawer === "manage"} status={mfa} setToast={setToast}
            onClose={() => setMfaDrawer(null)}
            onReconfigure={() => setMfaDrawer("reconfigure")}
            onChanged={refreshMfa} />
          <MfaEnrollDrawer open={mfaDrawer === "enroll" || mfaDrawer === "reconfigure"}
            mode={mfaDrawer === "reconfigure" ? "reconfigure" : "enroll"} setToast={setToast}
            onClose={() => { setMfaDrawer(null); refreshMfa(); }}
            onEnabled={refreshMfa} />
        </>
      ) : (
      <Drawer open={manage2fa} title="Two-factor authentication" subtitle="Required for every staff account" onClose={() => setManage2fa(false)}
        footer={<Button variant="secondary" onClick={() => setManage2fa(false)} style={{ marginInlineStart: "auto" }}>Done</Button>}>
        <Alert tone="success" title="Two-factor is on">Sign-in is protected by an authenticator app.</Alert>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--bg-sunken)", display: "grid", placeItems: "center" }}><Icon name="smartphone" size={18} /></span><span><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>Authenticator app</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Added 12 Feb 2026 · Google Authenticator</p></span></span>
          <Button variant="secondary" size="sm" onClick={() => setToast("Scan the new QR code in your app")}>Reconfigure</Button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
          <span><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>Recovery codes</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Use these if you lose your phone. 6 unused.</p></span>
          <Button variant="secondary" size="sm" onClick={() => setShowCodes(s => !s)}>{showCodes ? "Hide" : "View codes"}</Button>
        </div>
        {showCodes && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>{codes.map(c => <span key={c} className="tk-num" style={{ fontSize: 14, letterSpacing: "0.04em", color: "var(--text-strong)" }}>{c}</span>)}<Button variant="link" size="sm" iconStart="refresh-cw" style={{ gridColumn: "1 / -1", justifySelf: "start", marginTop: 4 }} onClick={() => setToast("New recovery codes generated")}>Regenerate codes</Button></div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0" }}>
          <span style={{ maxWidth: "40ch" }}><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>Backup phone</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Get codes by SMS if the app is unavailable.</p></span>
          <Button variant="secondary" size="sm" onClick={() => setToast("Enter a backup number")}>Add number</Button>
        </div>
        <Alert tone="warning" title="Turning 2FA off isn't allowed">Policy requires two-factor for all staff. Contact an admin to reset a lost device.</Alert>
      </Drawer>
      )}
      <div className="tk-stickysave"><span className="tk-caption">{dirty ? "Unsaved changes" : "All changes saved"}</span><Button iconStart="check" disabled={!dirty || saving} onClick={saveProfile} style={{ marginInlineStart: "auto" }}>{saving ? "Saving…" : "Save changes"}</Button></div>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Staff preferences (from the user menu) ────────────── */
// TRI-1009: the "Alerts to me" personal-subscription rows. Stable ids so we can read
// their state on save and hydrate them from GET /me/preferences (they persist in the
// staff_preferences.flags blob keyed by `key`).
const PREF_ALERT_ROWS = [
  { id: "pf-al-newBooking", key: "newBooking", label: "New booking", hint: "A booking is created on the website or app.", def: true },
  { id: "pf-al-pendingOver24h", key: "pendingOver24h", label: "Pending over 24h", hint: "A booking has waited more than a day for confirmation.", def: true },
  { id: "pf-al-paymentFailed", key: "paymentFailed", label: "Payment failed", hint: "A Paystack charge was declined.", def: true },
  { id: "pf-al-departureNearlyFull", key: "departureNearlyFull", label: "Departure nearly full", hint: "A departure passes 90% capacity.", def: false },
  { id: "pf-al-dailySummary", key: "dailySummary", label: "Daily summary email", hint: "Yesterday's numbers, sent at 07:00 GMT.", def: false },
];
function PreferencesAdmin({ go }) {
  // TRI-1009: this screen was a front-end-only fake — every control toasted "saved"
  // but nothing persisted and no endpoint existed. Now hydrate from GET /me/preferences
  // and persist via PATCH /me/preferences (backed by the staff_preferences table, which
  // has existed since migration 007 but had no reader/writer). Flag off → LIVE false,
  // no fetch, controls keep their defaults and toggles/Save just toast, byte-identical
  // to the DS prototype.
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [toast, setToast] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [prefs, setPrefs] = React.useState(null);
  React.useEffect(() => {
    if (!LIVE || !window.TK_ADMIN_API || !window.TK_ADMIN_API.getMyPreferences) return;
    let alive = true;
    window.TK_ADMIN_API.getMyPreferences().then((r) => { if (alive && r && r.preferences) setPrefs(r.preferences); }, () => {});
    return () => { alive = false; };
  }, []);
  // Apply loaded values onto the uncontrolled controls once known (re-apply if refetched).
  React.useEffect(() => {
    if (!prefs) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
    set("pf-theme", prefs.theme); set("pf-density", prefs.tableDensity);
    set("pf-tz", prefs.timeZone); set("pf-start", prefs.startPage);
    const alerts = prefs.alerts || {};
    PREF_ALERT_ROWS.forEach((a) => { const el = document.getElementById(a.id); if (el) el.checked = alerts[a.key] !== undefined ? !!alerts[a.key] : a.def; });
  }, [prefs]);
  // Flag-off prototype behaviour: each switch toast on change. Live: silent (Save is explicit).
  const onSwitch = () => { if (!LIVE) setToast("Preference updated"); };
  function savePrefs() {
    if (!LIVE || !window.TK_ADMIN_API) { setToast("Preferences saved"); return; }
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
    const alerts = {};
    PREF_ALERT_ROWS.forEach((a) => { const el = document.getElementById(a.id); if (el) alerts[a.key] = !!el.checked; });
    setSaving(true);
    window.TK_ADMIN_API.saveMyPreferences({
      theme: val("pf-theme"), tableDensity: val("pf-density"), timeZone: val("pf-tz"), startPage: val("pf-start"), alerts,
    }).then((r) => {
      setSaving(false);
      if (r && r.preferences) { setPrefs(r.preferences); if (window.TK_ADMIN_APPLY_THEME) window.TK_ADMIN_APPLY_THEME(r.preferences.theme); }
      setToast("Preferences saved");
    }, (err) => {
      setSaving(false);
      setToast((err && err.message) ? err.message : "Couldn't save preferences. Please try again.");
    });
  }
  const Row = ({ id, label, hint, defaultChecked }) => (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <span style={{ maxWidth: "46ch" }}><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>{label}</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>{hint}</p></span>
      <Switch id={id} defaultChecked={defaultChecked} onChange={onSwitch} />
    </div>
  );
  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-2)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Appearance & locale</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginTop: 8 }}>
          <FormField id="pf-theme" label="Theme"><Select defaultValue="system" options={[{ value: "system", label: "Match system" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} /></FormField>
          <FormField id="pf-density" label="Table density"><Select defaultValue="comfortable" options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></FormField>
          <FormField id="pf-tz" label="Time zone"><Select defaultValue="gmt" options={[{ value: "gmt", label: "GMT (Accra)" }, { value: "wat", label: "WAT (Lagos)" }]} /></FormField>
          <FormField id="pf-start" label="Start page"><Select defaultValue="dashboard" options={[{ value: "dashboard", label: "Dashboard" }, { value: "bookings", label: "Bookings" }]} /></FormField>
        </div>
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-2) var(--space-6) var(--space-4)" }}>
        <h2 className="tk-h6" style={{ margin: "var(--space-4) 0 0" }}>Alerts to me</h2>
        {PREF_ALERT_ROWS.map((a) => <Row key={a.id} id={a.id} label={a.label} hint={a.hint} defaultChecked={a.def} />)}
      </div></div>
      <div className="tk-stickysave"><span className="tk-caption">Preferences apply to your account only.</span><Button iconStart="check" disabled={saving} onClick={savePrefs} style={{ marginInlineStart: "auto" }}>{saving ? "Saving…" : "Save preferences"}</Button></div>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}
/* ── Guides ────────────────────────────────────────────── */
function GuidesAdmin({ go }) {
  const A = window.TK_ADMIN;
  const [q, setQ] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [sort, setSort] = React.useState(null); // TRI-1097: header sort for the Guides table.
  const [edit, setEdit] = React.useState(null);
  const [remove, setRemove] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  // TRI-1005: the whole write path was toast-only (screens read the mutable A.guides
  // global directly). Route Add/Save/Set-on-leave/Mark-active/Remove through
  // TK_ADMIN_ACT → real POST/PATCH/DELETE /guides, mutate the shared record on
  // success, and force a re-render (TRI-980/996 seam). Flag off → optimistic-only,
  // byte-identical to the prototype.
  const [, forceRerender] = React.useReducer((x) => x + 1, 0);
  const initialsOf = (name) => String(name || "").split(/\s+/).filter(Boolean).map(w => w.charAt(0)).join("").slice(0, 2).toUpperCase();
  const applyGuide = (id, patch) => {
    const gg = (A.guides || []).find((x) => x.id === id);
    if (gg) { Object.assign(gg, patch); if (patch.name !== undefined) gg.initials = initialsOf(patch.name); }
    forceRerender();
  };
  const removeGuide = (id) => {
    const i = (A.guides || []).findIndex((x) => x.id === id);
    if (i >= 0) A.guides.splice(i, 1);
    forceRerender();
  };
  const addGuide = (guide) => {
    if (!Array.isArray(A.guides)) A.guides = [];
    A.guides.push(guide);
    forceRerender();
  };
  const saveGuide = () => {
    const val = (id) => ((document.getElementById(id) || {}).value || "");
    const toList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
    const name = val("g-name").trim();
    if (!name) { setToast("Enter the guide's full name"); return; }
    const editingId = g ? g.id : null;
    const payload = {
      name: name, email: val("g-email").trim(), phone: val("g-phone").trim(),
      base: val("g-base").trim(), status: val("g-status") || "active",
      regions: toList(val("g-regions")), languages: toList(val("g-langs")), bio: val("g-bio").trim(),
    };
    window.TK_ADMIN_ACT(
      () => editingId ? window.TK_ADMIN_API.updateGuide(editingId, payload) : window.TK_ADMIN_API.createGuide(payload),
      (res) => {
        const shaped = {
          id: (res && res.id) || editingId || ("g_" + name.toLowerCase().replace(/\s+/g, "_")),
          name: name, initials: initialsOf(name), email: payload.email, phone: payload.phone,
          base: payload.base, status: payload.status, regions: payload.regions, languages: payload.languages,
          rating: g ? g.rating : (res && res.rating) || 0, trips: g ? g.trips : (res && res.trips) || 0, bio: payload.bio,
        };
        if (editingId) applyGuide(editingId, shaped); else addGuide(shaped);
        setEdit(null);
        setToast(editingId ? "Guide updated" : "Guide added");
      }
    );
  };
  const toggleLeave = (r) => {
    const next = r.status === "leave" ? "active" : "leave";
    window.TK_ADMIN_ACT(
      () => window.TK_ADMIN_API.setGuideStatus(r.id, next),
      () => { applyGuide(r.id, { status: next }); setToast(r.name + (next === "leave" ? " set to on leave" : " marked active")); }
    );
  };
  const doRemove = () => {
    const r = remove; if (!r) return;
    window.TK_ADMIN_ACT(
      () => window.TK_ADMIN_API.deleteGuide(r.id),
      () => { removeGuide(r.id); setRemove(null); setToast(r.name + " removed"); }
    );
  };
  const guides = A.guides || [];
  const regions = [...new Set(guides.flatMap(g => g.regions))].sort();
  let rows = guides;
  if (q) rows = rows.filter(g => (g.name + g.email + g.base).toLowerCase().includes(q.toLowerCase()));
  if (region) rows = rows.filter(g => g.regions.includes(region));
  if (status) rows = rows.filter(g => g.status === status);
  rows = tkSortRows(rows, sort); // TRI-1097: apply the header sort (Trips led).
  const stBadge = (s) => s === "active" ? <span className="tk-badge tk-badge--confirmed">Active</span> : s === "leave" ? <span className="tk-badge tk-badge--pending">On leave</span> : <Badge tone="neutral">Inactive</Badge>;
  const isNew = edit === "new";
  const g = (edit && edit !== "new") ? edit : null;
  React.useEffect(() => { const h = () => setEdit("new"); window.addEventListener("tk-add-guide", h); return () => window.removeEventListener("tk-add-guide", h); });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-tablewrap">
        <div className="tk-tabletools" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 220 }}><SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Search guides" /></div>
          <Select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)} style={{ width: 180 }} options={[{ value: "", label: "All regions" }, ...regions.map(r => ({ value: r, label: r }))]} />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }} options={[{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "leave", label: "On leave" }, { value: "disabled", label: "Inactive" }]} />
          <span className="tk-caption" style={{ marginInlineStart: "auto" }}>{rows.length} of {guides.length} guides</span>
        </div>
        <DataTable
          sort={sort} onSortChange={setSort}
          columns={[
            { key: "name", header: "Guide", render: r => (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, flex: "none" }}>{r.initials}</span>
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}><strong style={{ fontSize: 14 }}>{r.name}</strong><span className="tk-caption">Based in {r.base}</span></span>
              </span>) },
            { key: "regions", header: "Regions", render: r => r.regions.join(", ") },
            { key: "languages", header: "Languages", render: r => r.languages.join(", ") },
            { key: "trips", header: "Trips led", align: "end", sortable: true },
            { key: "rating", header: "Rating", align: "end", render: r => "★ " + r.rating },
            { key: "status", header: "Status", render: r => stBadge(r.status) },
          ]}
          rows={rows}
          onRowClick={(r) => setEdit(r)}
          rowActions={(r) => (
            <RowMenu label={"Actions for " + r.name} items={[
              { label: "Edit guide", icon: "pencil", onClick: () => setEdit(r) },
              { label: "View schedule", icon: "calendar-days", onClick: () => go("departures") },
              { label: r.status === "leave" ? "Mark active" : "Set on leave", icon: r.status === "leave" ? "circle-check-big" : "clock", onClick: () => toggleLeave(r) },
              { label: "Remove guide", icon: "trash-2", danger: true, onClick: () => setRemove(r) },
            ]} />)}
          empty={<EmptyState icon="user" title="No guides match" body="Adjust the filters, or add a new guide." action={<Button iconStart="plus" onClick={() => setEdit("new")}>Add guide</Button>} />} />
      </div>

      <Drawer open={!!edit} title={isNew ? "Add guide" : (g ? g.name : "")} subtitle={isNew ? "Create a guide profile that departures can be assigned to" : (g ? "Based in " + g.base : "")} onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button iconStart={isNew ? "plus" : "check"} style={{ marginInlineStart: "auto" }} onClick={saveGuide}>{isNew ? "Add guide" : "Save changes"}</Button></>}>
        <FormField id="g-name" label="Full name" required><Input id="g-name" defaultValue={g ? g.name : ""} /></FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="g-email" label="Email"><Input id="g-email" type="email" defaultValue={g ? g.email : ""} /></FormField>
          <FormField id="g-phone" label="Phone"><PhoneInput id="g-phone" defaultValue={g ? g.phone : ""} /></FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="g-base" label="Home base"><Input id="g-base" defaultValue={g ? g.base : ""} /></FormField>
          <FormField id="g-status" label="Status"><Select id="g-status" defaultValue={g ? g.status : "active"} options={[{ value: "active", label: "Active" }, { value: "leave", label: "On leave" }, { value: "disabled", label: "Inactive" }]} /></FormField>
        </div>
        <FormField id="g-regions" label="Regions covered" help="Comma-separated. Used to match guides to departures."><Input id="g-regions" defaultValue={g ? g.regions.join(", ") : ""} /></FormField>
        <FormField id="g-langs" label="Languages" help="Comma-separated."><Input id="g-langs" defaultValue={g ? g.languages.join(", ") : ""} /></FormField>
        <FormField id="g-bio" label="Short bio" optional><Textarea id="g-bio" rows={3} defaultValue={g ? g.bio : ""} /></FormField>
        {g && <Alert tone="info" title="Assignments">{g.name} has led {g.trips} trips · ★ {g.rating}. Assign them to a departure from Departures → Add departure.</Alert>}
      </Drawer>

      <Modal open={!!remove} tone="danger" title={remove ? "Remove " + remove.name + "?" : ""}
        description="They'll no longer appear in the lead-guide picker. Departures they already lead keep their assignment."
        onClose={() => setRemove(null)}
        actions={<><Button variant="secondary" onClick={() => setRemove(null)}>Keep guide</Button><Button variant="danger" onClick={doRemove}>Remove guide</Button></>} />
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Reviews (moderation) ──────────────────────────────── */
function AdminStars({ value }) {
  return <span style={{ display: "inline-flex", gap: 1 }} aria-label={value + " of 5"}>{[1,2,3,4,5].map(i => <Icon key={i} name="star" size={14} style={{ color: i <= value ? "#f5b301" : "var(--border-strong)", fill: i <= value ? "#f5b301" : "transparent" }} />)}</span>;
}
function ReviewsAdmin({ go }) {
  const R = window.TK_REVIEWS || [];
  const [tab, setTab] = React.useState("pending");
  const [tour, setTour] = React.useState("");
  const [minRating, setMinRating] = React.useState("");
  const [reply, setReply] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  // TRI-978 #3: the screen reads the TK_REVIEWS module global directly, so a
  // moderation mutation (approve/reject/unpublish/restore) left the row where it
  // was until a manual refresh re-hydrated /reviews — e.g. "Approve & publish"
  // kept the review in Pending. Apply the new state to the shared record and
  // force a re-render AFTER the write resolves (TK_ADMIN_ACT only runs the
  // success callback on a confirmed write), so the row moves tabs immediately.
  const [, forceRerender] = React.useReducer((x) => x + 1, 0);
  const applyStatus = (id, status) => { const rv = (window.TK_REVIEWS || []).find((x) => x.id === id); if (rv) rv.status = status; forceRerender(); };
  const applyReply = (id, replyText) => { const rv = (window.TK_REVIEWS || []).find((x) => x.id === id); if (rv) rv.reply = replyText; forceRerender(); };
  const tours = [...new Set(R.map(r => r.tour))];
  const counts = { pending: R.filter(r => r.status === "pending").length, approved: R.filter(r => r.status === "approved").length, rejected: R.filter(r => r.status === "rejected").length };
  let rows = R.filter(r => r.status === tab);
  if (tour) rows = rows.filter(r => r.tour === tour);
  if (minRating) rows = rows.filter(r => r.rating >= +minRating);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "pending", label: "Pending", count: counts.pending },
        { id: "approved", label: "Published", count: counts.approved },
        { id: "rejected", label: "Rejected", count: counts.rejected },
      ]} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <Select aria-label="Tour" value={tour} onChange={(e) => setTour(e.target.value)} style={{ width: 240 }} options={[{ value: "", label: "All tours" }, ...tours.map(t => ({ value: t, label: t }))]} />
        <Select aria-label="Minimum rating" value={minRating} onChange={(e) => setMinRating(e.target.value)} style={{ width: 160 }} options={[{ value: "", label: "Any rating" }, { value: "4", label: "4★ & up" }, { value: "3", label: "3★ & up" }, { value: "1", label: "1–2★ only" }]} />
        <span className="tk-caption" style={{ marginInlineStart: "auto" }}>{rows.length} review{rows.length !== 1 ? "s" : ""}</span>
      </div>
      {tab === "pending" && counts.pending > 0 && <Alert tone="info" title={counts.pending + " review" + (counts.pending > 1 ? "s" : "") + " awaiting moderation"}>Approve to publish on the tour page, or reject to keep it hidden. Nothing goes live until you approve it.</Alert>}
      {rows.length === 0 ? (
        <EmptyState icon="star" title={tab === "pending" ? "Nothing to moderate" : "No reviews here"} body={tab === "pending" ? "New reviews from travellers will appear here for approval." : "Reviews you " + (tab === "approved" ? "publish" : "reject") + " will show up here."} />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map(r => (
            <div key={r.id} className="tk-card"><div className="tk-card__body" style={{ gap: 10, padding: "var(--space-4)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 700, flex: "none" }}>{r.initials}</span>
                <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><strong>{r.author}</strong>{r.verified ? <Badge tone="success">Verified booking</Badge> : <Badge tone="warning">Unverified</Badge>}<AdminStars value={r.rating} /></span>
                  <span className="tk-caption">{r.tour} · {r.date}</span>
                </div>
                {r.status === "approved" && <span className="tk-badge tk-badge--confirmed">Published</span>}
                {r.status === "rejected" && <Badge tone="neutral">Rejected</Badge>}
              </div>
              {r.title && <strong style={{ fontSize: 15 }}>{r.title}</strong>}
              <p className="tk-body" style={{ margin: 0 }}>{r.text}</p>
              {!r.verified && <Alert tone="warning" title="No matching booking">This reviewer has no completed booking for this tour — likely spam. Reject unless you can verify it.</Alert>}
              {r.reply && <div style={{ padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", borderInlineStart: "3px solid var(--brand)" }}><span style={{ fontWeight: 700, fontSize: 12.5, color: "var(--brand-ink)" }}>Your reply</span><p className="tk-body-sm" style={{ margin: "4px 0 0" }}>{r.reply}</p></div>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
                {tab === "pending" && <>
                  <Button variant="secondary" size="sm" iconStart="x" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.rejectReview(r.id), () => { applyStatus(r.id, "rejected"); setToast("Review rejected — it stays hidden"); })}>Reject</Button>
                  <Button size="sm" iconStart="check" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.approveReview(r.id), () => { applyStatus(r.id, "approved"); setToast("Approved — now live on the tour page"); })}>Approve & publish</Button>
                </>}
                {tab === "approved" && <>
                  <Button variant="secondary" size="sm" iconStart="message-circle" onClick={() => setReply(r)}>{r.reply ? "Edit reply" : "Reply"}</Button>
                  <Button variant="secondary" size="sm" iconStart="eye-off" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.unpublishReview(r.id), () => { applyStatus(r.id, "pending"); setToast("Unpublished — hidden from the tour page"); })}>Unpublish</Button>
                </>}
                {tab === "rejected" && <Button variant="secondary" size="sm" iconStart="rotate-ccw" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.restoreReview(r.id), () => { applyStatus(r.id, "pending"); setToast("Moved back to Pending"); })}>Restore to pending</Button>}
              </div>
            </div></div>
          ))}
        </div>
      )}
      <Drawer open={!!reply} title="Reply to review" subtitle={reply ? reply.author + " · " + reply.tour : ""} onClose={() => setReply(null)}
        footer={<><Button variant="secondary" onClick={() => setReply(null)}>Cancel</Button><Button iconStart="check" style={{ marginInlineStart: "auto" }} onClick={() => { const v = (document.getElementById("rv-reply") || {}).value || ""; const id = reply && reply.id; window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.replyReview(id, v), () => { applyReply(id, v); setReply(null); setToast("Reply saved — shown publicly under the review"); }); }}>Save reply</Button></>}>
        {reply && <><div className="tk-card" style={{ boxShadow: "none", border: "1px solid var(--border-subtle)", marginBottom: "var(--space-4)" }}><div className="tk-card__body" style={{ padding: "var(--space-4)", gap: 4 }}><AdminStars value={reply.rating} /><p className="tk-body-sm" style={{ margin: 0 }}>{reply.text}</p></div></div>
        <FormField id="rv-reply" label="Your public reply" hint="Speak as TripKoach. Warm, brief and specific."><Textarea id="rv-reply" rows={4} defaultValue={reply.reply || ""} /></FormField></>}
      </Drawer>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

Object.assign(window, { CustomersAdmin, PaymentsAdmin, PromosAdmin, UsersAdmin, SettingsAdmin, Forbidden, AccountProfileAdmin, PreferencesAdmin, GuidesAdmin, ReviewsAdmin });
