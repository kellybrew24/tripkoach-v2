const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, FilterBar, Drawer, RoleMatrix, RowMenu, StatusBadge, Badge, Button, IconButton, Icon, Price, Modal,
  Alert, SearchField, EmptyState, FormField, Input, PhoneInput, Select, Switch, Checkbox, Textarea, Tabs, BookingRow, Toast } = NS;

function payBadge(p) {
  const map = { paid: "paid", pending: "pending", refunded: "refunded", failed: "failed", unpaid: "pending" };
  const label = { paid: "Paid", pending: "Pending", refunded: "Refunded", failed: "Failed", unpaid: "Unpaid" }[p] || p;
  return <StatusBadge status={map[p]} size="sm" label={label} />;
}

/* ── Customers ─────────────────────────────────────────── */
function CustomersAdmin({ go, state, setState }) {
  const A = window.TK_ADMIN;
  const [q, setQ] = React.useState("");
  const [toast, setToast] = React.useState(null);
  const [country, setCountry] = React.useState(null);
  const [band, setBand] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const open = A.customers.find(c => c.id === state.detailRef);
  const custBookings = (id) => A.bookings.filter(b => b.customerId === id);
  const spend = (id) => custBookings(id).filter(b => b.payment === "paid").reduce((s, b) => s + b.total, 0);
  const countries = [...new Set(A.customers.map(c => c.country))].sort();
  const bands = [{ id: "0", label: "No spend yet", test: v => v === 0 }, { id: "lo", label: "Under $1,000", test: v => v > 0 && v < 1000 }, { id: "hi", label: "$1,000+", test: v => v >= 1000 }];
  let rows = A.customers;
  if (q) rows = rows.filter(c => (c.name + c.email + c.country).toLowerCase().includes(q.toLowerCase()));
  if (country) rows = rows.filter(c => c.country === country);
  if (band) { const b = bands.find(x => x.id === band); rows = rows.filter(c => b.test(spend(c.id))); }
  const applied = [];
  if (country) applied.push({ id: "country", label: "Country: " + country, onRemove: () => setCountry(null) });
  if (band) applied.push({ id: "band", label: "Value: " + bands.find(x => x.id === band).label, onRemove: () => setBand(null) });
  const kebab = (r) => [
    { label: "View details", icon: "eye", onClick: () => setState({ detailRef: r.id }) },
    { label: "Email customer", icon: "mail", onClick: () => setToast("Opening email to " + r.name) },
    { label: "Resend last confirmation", icon: "ticket", onClick: () => setToast("Confirmation resent to " + r.email) },
    { label: "Copy email address", icon: "receipt", onClick: () => setToast(r.email + " copied") },
    { divider: true },
    { label: "Export bookings (CSV)", icon: "download", onClick: () => setToast("Exporting " + r.name + "'s bookings") },
  ];
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
          rowActions={(r) => <RowMenu label={"Actions for " + r.name} items={kebab(r)} />}
          empty={<EmptyState icon="users" title="No customers found" body="Try a different search." />} />
      </div>

      <Drawer open={!!open} title={open ? open.name : ""} subtitle={open ? open.email : ""} onClose={() => setState({ detailRef: null })}
        footer={<><Button variant="secondary" iconStart="mail" onClick={() => setToast("Opening email…")}>Email customer</Button><Button variant="secondary" style={{ marginInlineStart: "auto" }} onClick={() => setState({ detailRef: null })}>Close</Button></>}>
        {open && <>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ flex: "none", width: 56, height: 56, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 20 }}>{open.initials}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong className="tk-h5">{open.name}</strong>
                {/* TRI-941: account verification state (live only — undefined for fixtures). */}
                {open.emailVerified === true && <span className="tk-badge tk-badge--confirmed">Email verified</span>}
                {open.emailVerified === false && <span className="tk-badge tk-badge--pending">Email unverified</span>}
                {custBookings(open.id).some(b => b.status === "pending") && <span className="tk-badge tk-badge--pending">Has pending</span>}
                {spend(open.id) >= 1000 && <Badge tone="solid">VIP</Badge>}
              </div>
              <div className="tk-caption">{open.country} · member since {open.joined}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[["Trips", open.bookings], ["Lifetime value", "$" + spend(open.id).toLocaleString()], ["Pending", custBookings(open.id).filter(b => b.status === "pending").length]].map(([k, v]) => (
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
              {[["Emergency contact", open.emergencyName || "—"], ["Emergency number", open.emergencyPhone || "—"], ["Dietary needs", open.diet || "—"]].map(([k, v]) => <div className="tk-summary__line" key={k}><span>{k}</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{v}</span></div>)}
            </div>
          </section>
          <section>
            <h3 className="tk-h6" style={{ marginBottom: 8 }}>Booking history</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {custBookings(open.id).map(b => (
                <BookingRow key={b.ref} reference={b.ref} title={b.tour} date={b.date} travellers={b.travellers + " travellers"} total={b.total} status={b.status} onClick={() => go("bookings", b.ref)} />
              ))}
              {custBookings(open.id).length === 0 && <p className="tk-caption">No bookings yet.</p>}
            </div>
          </section>
        </>}
      </Drawer>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Payments & reconciliation ─────────────────────────── */
function PaymentsAdmin({ go, state }) {
  const A = window.TK_ADMIN;
  const [tab, setTab] = React.useState("all");
  const totalPaid = A.payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const outstanding = A.bookings.filter(b => b.payment === "unpaid").reduce((s, b) => s + b.total, 0);
  let rows = A.payments.filter(p => tab === "all" || p.status === tab);
  const { StatCard } = NS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Alert tone="info" title="Payments run through Paystack">Card, bank and mobile-money payments are handled by Paystack's hosted checkout — TripKoach never stores card details. Transactions sync here automatically; you can still mark pay-later bookings paid by hand when money arrives another way.</Alert>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        <StatCard label="Collected" value={"$" + totalPaid.toLocaleString()} icon="wallet" delta="+8%" deltaDir="up" hint="this month" />
        <StatCard label="Outstanding (pay later)" value={"$" + outstanding.toLocaleString()} icon="clock" deltaDir="flat" delta="4 bookings" />
        <StatCard label="Refunded" value="$1,080" icon="receipt" deltaDir="flat" delta="1 this month" />
        <StatCard label="Failed attempts" value="1" icon="triangle-alert" deltaDir="down" delta="needs review" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "all", label: "All" }, { id: "paid", label: "Paid" }, { id: "pending", label: "Pending" }, { id: "failed", label: "Failed" }, { id: "refunded", label: "Refunded" }]} />
      <div className="tk-tablewrap">
        <div className="tk-tabletools"><strong style={{ fontSize: 14 }}>{rows.length} transactions</strong><Button size="sm" variant="secondary" iconStart="download" style={{ marginInlineStart: "auto" }} onClick={() => window.tkToast("Exporting transactions for reconciliation…")}>Export for reconciliation</Button></div>
        <DataTable density="compact"
          columns={[
            { key: "id", header: "Transaction", strong: true },
            { key: "ref", header: "Booking", render: r => <a href="#" onClick={(e) => { e.preventDefault(); go("bookings", r.ref); }} style={{ fontWeight: 600 }}>{r.ref}</a> },
            { key: "customer", header: "Customer" },
            { key: "method", header: "Method" },
            { key: "amount", header: "Amount", align: "end", render: r => <Price amount={r.amount} currency="USD" size="sm" /> },
            { key: "status", header: "Status", render: r => payBadge(r.status) },
            { key: "date", header: "Date" },
          ]}
          rows={rows} getRowId={r => r.id}
          rowActions={(r) => r.status === "pending"
            ? <Button size="sm" variant="secondary" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.markPaid(r.id), () => window.tkToast("Marked " + r.id + " as paid"))}>Mark paid</Button>
            : r.status === "paid" ? <IconButton icon="receipt" label="Issue refund" variant="ghost" size="sm" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.refundPayment(r.id), () => window.tkToast("Refund started for " + r.id))} /> : <IconButton icon="ellipsis" label="Actions" variant="ghost" size="sm" onClick={() => window.tkToast("Retry requested for " + r.id)} />}
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
          <FormField id="pc-code" label="Code" help="Uppercase, no spaces"><Input defaultValue={edit.code} placeholder="HARMATTAN10" style={{ textTransform: "uppercase" }} /></FormField>
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

/* ── Users & roles ─────────────────────────────────────── */
function UsersAdmin({ go }) {
  const A = window.TK_ADMIN;
  const [invite, setInvite] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [perms, setPerms] = React.useState({
    "tours.view": { admin: true, operator: true, viewer: true }, "tours.edit": { admin: true, operator: true, viewer: false },
    "bookings.view": { admin: true, operator: true, viewer: true }, "bookings.manage": { admin: true, operator: true, viewer: false },
    "bookings.cancel": { admin: true, operator: true, viewer: false }, "payments.refund": { admin: true, operator: false, viewer: false },
    "customers.view": { admin: true, operator: true, viewer: true }, "promos.manage": { admin: true, operator: true, viewer: false },
    "users.manage": { admin: true, operator: false, viewer: false }, "settings.manage": { admin: true, operator: false, viewer: false },
  });
  const roleBadge = (r) => ({ admin: <Badge tone="solid">Admin</Badge>, operator: <span className="tk-badge tk-badge--confirmed">Operator</span>, viewer: <Badge tone="neutral">Read-only</Badge> }[r]);
  const statusBadge = (s) => ({ active: <span className="tk-badge tk-badge--confirmed">Active</span>, invited: <span className="tk-badge tk-badge--pending">Invited</span>, disabled: <Badge tone="neutral">Disabled</Badge> }[s]);
  const toggle = (perm, role) => setPerms(p => ({ ...p, [perm]: { ...p[perm], [role]: !p[perm][role] } }));

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
            { key: "status", header: "Status", render: r => statusBadge(r.status) },
            { key: "last", header: "Last active" },
          ]}
          rows={A.staff} getRowId={r => r.id}
          rowActions={(r) => <IconButton icon="ellipsis" label={"Actions for " + r.name} variant="ghost" size="sm" onClick={() => window.tkToast("Manage " + r.name + " — edit role or remove")} />} />
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
          value={perms} onToggle={toggle} />
      </div>
      <Drawer open={invite} title="Invite staff" subtitle="They'll get an email to set a password and enable two-factor." onClose={() => setInvite(false)}
        footer={<><Button variant="secondary" onClick={() => setInvite(false)}>Cancel</Button><Button iconStart="mail" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.inviteStaff({ email: (document.getElementById("iv-email") || {}).value, name: (document.getElementById("iv-name") || {}).value, role: (document.getElementById("iv-role") || {}).value || "operator" }), () => { setToast("Invite sent"); setInvite(false); })}>Send invite</Button></>}>
        <FormField id="iv-email" label="Work email" required><Input type="email" placeholder="name@tripkoach.com" iconStart="mail" /></FormField>
        <FormField id="iv-name" label="Full name"><Input placeholder="Ama Owusu" /></FormField>
        <FormField id="iv-role" label="Role" help="You can change this later"><Select defaultValue="operator" options={[{ value: "admin", label: "Admin — full access" }, { value: "operator", label: "Operator — day-to-day ops" }, { value: "viewer", label: "Read-only — view but not change" }]} /></FormField>
      </Drawer>
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
        </>}
        {tab === "notify" && <>
          <Section title="Customer emails" hint="Automatic emails sent on booking events.">
            <Switch id="n1" label="Booking confirmation email" checked readOnly />
            <Switch id="n2" label="Payment reminder before deadline" checked readOnly />
            <Switch id="n3" label="Departure reminder 48h before" checked readOnly />
            <Switch id="n4" label="Post-trip review request" />
          </Section>
          <Section title="Staff alerts" hint="Where new bookings and failures are announced.">
            <Switch id="n5" label="New booking to ops inbox" checked readOnly />
            <Switch id="n6" label="Failed payment alert" checked readOnly />
          </Section>
        </>}
      </div>
      <div className="tk-stickysave"><span className="tk-caption">Changes apply to both the website and the app.</span><Button iconStart="check" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.saveSettings({ businessName: (document.getElementById("s-org") || {}).value, address: (document.getElementById("s-addr") || {}).value, supportPhone: (document.getElementById("s-phone") || {}).value, supportEmail: (document.getElementById("s-email") || {}).value, currencyOfRecord: (document.getElementById("s-cur") || {}).value, displayCurrency: (document.getElementById("s-disp") || {}).value, usdToGhsDisplayRate: +(((document.getElementById("s-rate") || {}).value) || 0) || undefined, cancellationPolicy: (document.getElementById("s-canc") || {}).value, paymentDeadlineDays: +(((document.getElementById("s-deadline") || {}).value) || 0) || undefined }), () => setToast("Settings saved"))}>Save settings</Button></div>
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
    if (mode !== "reconfigure") beginEnroll(); // first-time: enroll immediately
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
          <FormField id="mfa-reconf-code" label="Current code"><Input id="mfa-reconf-code" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} placeholder="123456 or recovery code" autoComplete="one-time-code" /></FormField>
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
      {codes && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>{codes.map((c) => <span key={c} className="tk-num" style={{ fontSize: 14, letterSpacing: "0.04em", color: "var(--text-strong)" }}>{c}</span>)}<span className="tk-caption tk-muted" style={{ gridColumn: "1 / -1" }}>Save these now — they won't be shown again.</span></div>}
      <Alert tone="warning" title="Turning 2FA off isn't allowed">Policy requires two-factor for all staff. Use Reconfigure to switch to a new device; contact an admin to reset a lost one.</Alert>
    </Drawer>
  );
}

/* ── Staff profile (from the user menu) ────────────────── */
function AccountProfileAdmin({ go, user }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [toast, setToast] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [manage2fa, setManage2fa] = React.useState(false);
  const [changePw, setChangePw] = React.useState(false);
  const [pw, setPw] = React.useState({ cur: "", next: "", conf: "" });
  const pwOk = pw.next.length >= 10 && pw.next === pw.conf && pw.cur.length > 0;
  const [showCodes, setShowCodes] = React.useState(false);
  const codes = ["7F2K-9QL4", "B3MX-1WP8", "D6RT-5YC2", "H9NA-4VE7", "K2QZ-8JU3", "M5LP-6XB9"];
  const touch = () => setDirty(true);
  const u = user || { name: "Kwame Boateng", role: "Admin", initials: "KB", email: "kwame@tripkoach.com" };

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
          <FormField id="ap-name" label="Full name"><Input defaultValue={u.name} onChange={touch} /></FormField>
          <FormField id="ap-email" label="Work email"><Input type="email" defaultValue={u.email} onChange={touch} /></FormField>
          <FormField id="ap-phone" label="Phone"><PhoneInput id="ap-phone" onChange={touch} /></FormField>
          <FormField id="ap-title" label="Job title" optional><Input placeholder="Operations lead" onChange={touch} /></FormField>
        </div>
      </div></div>
      <div className="tk-card"><div className="tk-card__body" style={{ padding: "var(--space-6)", gap: "var(--space-4)" }}>
        <h2 className="tk-h5" style={{ margin: 0 }}>Security</h2>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span><strong style={{ fontSize: 14.5, color: "var(--text-strong)" }}>Password</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>Last changed 2 months ago.</p></span>
          <Button variant="secondary" size="sm" onClick={() => { setPw({ cur: "", next: "", conf: "" }); setChangePw(true); }}>Change password</Button>
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

      <Drawer open={changePw} title="Change password" subtitle="Choose a strong password you don't use elsewhere" onClose={() => setChangePw(false)}
        footer={<><Button variant="secondary" onClick={() => setChangePw(false)}>Cancel</Button><Button iconStart="check" disabled={!pwOk} onClick={() => { setChangePw(false); setToast("Password updated"); }} style={{ marginInlineStart: "auto" }}>Update password</Button></>}>
        <FormField id="pw-cur" label="Current password"><Input id="pw-cur" type="password" value={pw.cur} onChange={(e) => setPw(p => ({ ...p, cur: e.target.value }))} /></FormField>
        <FormField id="pw-next" label="New password" hint="At least 10 characters."><Input id="pw-next" type="password" value={pw.next} onChange={(e) => setPw(p => ({ ...p, next: e.target.value }))} /></FormField>
        <FormField id="pw-conf" label="Confirm new password" error={pw.conf && pw.next !== pw.conf ? "Passwords don't match" : undefined}><Input id="pw-conf" type="password" value={pw.conf} onChange={(e) => setPw(p => ({ ...p, conf: e.target.value }))} /></FormField>
        <Alert tone="info" title="You'll stay signed in">Other devices will be signed out and need the new password.</Alert>
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
      <div className="tk-stickysave"><span className="tk-caption">{dirty ? "Unsaved changes" : "All changes saved"}</span><Button iconStart="check" disabled={!dirty} onClick={() => { setDirty(false); setToast("Profile saved"); }} style={{ marginInlineStart: "auto" }}>Save changes</Button></div>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

/* ── Staff preferences (from the user menu) ────────────── */
function PreferencesAdmin({ go }) {
  const [toast, setToast] = React.useState(null);
  const Row = ({ label, hint, defaultChecked }) => (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--border-subtle)" }}>
      <span style={{ maxWidth: "46ch" }}><strong style={{ fontSize: 14, color: "var(--text-strong)" }}>{label}</strong><p className="tk-body-sm tk-muted" style={{ margin: "2px 0 0" }}>{hint}</p></span>
      <Switch id={"pf-" + label.replace(/\W/g, "")} defaultChecked={defaultChecked} onChange={() => setToast("Preference updated")} />
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
        <Row label="New booking" hint="A booking is created on the website or app." defaultChecked />
        <Row label="Pending over 24h" hint="A booking has waited more than a day for confirmation." defaultChecked />
        <Row label="Payment failed" hint="A Paystack charge was declined." defaultChecked />
        <Row label="Departure nearly full" hint="A departure passes 90% capacity." defaultChecked={false} />
        <Row label="Daily summary email" hint="Yesterday's numbers, sent at 07:00 GMT." defaultChecked={false} />
      </div></div>
      <div className="tk-stickysave"><span className="tk-caption">Preferences apply to your account only.</span><Button iconStart="check" onClick={() => setToast("Preferences saved")} style={{ marginInlineStart: "auto" }}>Save preferences</Button></div>
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
  const [edit, setEdit] = React.useState(null);
  const [remove, setRemove] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const guides = A.guides || [];
  const regions = [...new Set(guides.flatMap(g => g.regions))].sort();
  let rows = guides;
  if (q) rows = rows.filter(g => (g.name + g.email + g.base).toLowerCase().includes(q.toLowerCase()));
  if (region) rows = rows.filter(g => g.regions.includes(region));
  if (status) rows = rows.filter(g => g.status === status);
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
              { label: r.status === "leave" ? "Mark active" : "Set on leave", icon: r.status === "leave" ? "circle-check-big" : "clock", onClick: () => setToast(r.name + (r.status === "leave" ? " marked active" : " set to on leave")) },
              { label: "Remove guide", icon: "trash-2", danger: true, onClick: () => setRemove(r) },
            ]} />)}
          empty={<EmptyState icon="user" title="No guides match" body="Adjust the filters, or add a new guide." action={<Button iconStart="plus" onClick={() => setEdit("new")}>Add guide</Button>} />} />
      </div>

      <Drawer open={!!edit} title={isNew ? "Add guide" : (g ? g.name : "")} subtitle={isNew ? "Create a guide profile that departures can be assigned to" : (g ? "Based in " + g.base : "")} onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button iconStart={isNew ? "plus" : "check"} style={{ marginInlineStart: "auto" }} onClick={() => { setEdit(null); setToast(isNew ? "Guide added" : "Guide updated"); }}>{isNew ? "Add guide" : "Save changes"}</Button></>}>
        <FormField id="g-name" label="Full name" required><Input id="g-name" defaultValue={g ? g.name : ""} placeholder="e.g. Kwame Boateng" /></FormField>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="g-email" label="Email"><Input id="g-email" type="email" defaultValue={g ? g.email : ""} placeholder="name@tripkoach.com" /></FormField>
          <FormField id="g-phone" label="Phone"><PhoneInput id="g-phone" /></FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <FormField id="g-base" label="Home base"><Input id="g-base" defaultValue={g ? g.base : ""} placeholder="e.g. Accra" /></FormField>
          <FormField id="g-status" label="Status"><Select id="g-status" defaultValue={g ? g.status : "active"} options={[{ value: "active", label: "Active" }, { value: "leave", label: "On leave" }, { value: "disabled", label: "Inactive" }]} /></FormField>
        </div>
        <FormField id="g-regions" label="Regions covered" help="Comma-separated. Used to match guides to departures."><Input id="g-regions" defaultValue={g ? g.regions.join(", ") : ""} placeholder="Greater Accra, Eastern" /></FormField>
        <FormField id="g-langs" label="Languages" help="Comma-separated."><Input id="g-langs" defaultValue={g ? g.languages.join(", ") : ""} placeholder="English, Twi, Ga" /></FormField>
        <FormField id="g-bio" label="Short bio" optional><Textarea id="g-bio" rows={3} defaultValue={g ? g.bio : ""} placeholder="What this guide is known for." /></FormField>
        {g && <Alert tone="info" title="Assignments">{g.name} has led {g.trips} trips · ★ {g.rating}. Assign them to a departure from Departures → Add departure.</Alert>}
      </Drawer>

      <Modal open={!!remove} tone="danger" title={remove ? "Remove " + remove.name + "?" : ""}
        description="They'll no longer appear in the lead-guide picker. Departures they already lead keep their assignment."
        onClose={() => setRemove(null)}
        actions={<><Button variant="secondary" onClick={() => setRemove(null)}>Keep guide</Button><Button variant="danger" onClick={() => { const n = remove.name; setRemove(null); setToast(n + " removed"); }}>Remove guide</Button></>} />
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
                  <Button variant="secondary" size="sm" iconStart="x" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.rejectReview(r.id), () => setToast("Review rejected — it stays hidden"))}>Reject</Button>
                  <Button size="sm" iconStart="check" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.approveReview(r.id), () => setToast("Approved — now live on the tour page"))}>Approve & publish</Button>
                </>}
                {tab === "approved" && <>
                  <Button variant="secondary" size="sm" iconStart="message-circle" onClick={() => setReply(r)}>{r.reply ? "Edit reply" : "Reply"}</Button>
                  <Button variant="secondary" size="sm" iconStart="eye-off" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.unpublishReview(r.id), () => setToast("Unpublished — hidden from the tour page"))}>Unpublish</Button>
                </>}
                {tab === "rejected" && <Button variant="secondary" size="sm" iconStart="rotate-ccw" onClick={() => window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.restoreReview(r.id), () => setToast("Moved back to Pending"))}>Restore to pending</Button>}
              </div>
            </div></div>
          ))}
        </div>
      )}
      <Drawer open={!!reply} title="Reply to review" subtitle={reply ? reply.author + " · " + reply.tour : ""} onClose={() => setReply(null)}
        footer={<><Button variant="secondary" onClick={() => setReply(null)}>Cancel</Button><Button iconStart="check" style={{ marginInlineStart: "auto" }} onClick={() => { const v = (document.getElementById("rv-reply") || {}).value || ""; const id = reply && reply.id; window.TK_ADMIN_ACT(() => window.TK_ADMIN_API.replyReview(id, v), () => { setReply(null); setToast("Reply saved — shown publicly under the review"); }); }}>Save reply</Button></>}>
        {reply && <><div className="tk-card" style={{ boxShadow: "none", border: "1px solid var(--border-subtle)", marginBottom: "var(--space-4)" }}><div className="tk-card__body" style={{ padding: "var(--space-4)", gap: 4 }}><AdminStars value={reply.rating} /><p className="tk-body-sm" style={{ margin: 0 }}>{reply.text}</p></div></div>
        <FormField id="rv-reply" label="Your public reply" hint="Speak as TripKoach. Warm, brief and specific."><Textarea id="rv-reply" rows={4} defaultValue={reply.reply || ""} placeholder="Thank the traveller and add a personal touch." /></FormField></>}
      </Drawer>
      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}

Object.assign(window, { CustomersAdmin, PaymentsAdmin, PromosAdmin, UsersAdmin, SettingsAdmin, Forbidden, AccountProfileAdmin, PreferencesAdmin, GuidesAdmin, ReviewsAdmin });
