const NS = window.TripKoachDesignSystem_c9e4af;
const { DataTable, Badge, Button, IconButton, Icon, Price, Modal, Alert, SearchField, EmptyState,
  FormField, Input, Textarea, Select, Drawer, Toast, RowMenu } = NS;

/* ── Custom-date requests inbox (TRI-1139 · parent TRI-1136 B1) ──────────────
   A traveller who wants a date that isn't on the schedule submits an interest
   enquiry with intent 'request' (BE TRI-1137 widens POST /tours/:id/interest).
   Those land here so ops can triage, schedule a private departure, mint a secure
   booking link, or dismiss. Status flows New → Contacted → Scheduled → Booked → Closed.

   Data source: window.TK_ADMIN.requests. In LIVE mode tk-boot hydrates it from
   GET /requests and every write funnels through TK_ADMIN_ACT (which re-renders the
   whole console on success); in fixture mode it runs the optimistic update inline. */

// Status model: keyed by the LIVE BE enum (lowercase: new|contacted|scheduled|
// booked|closed, TRI-1137). Each maps to an existing DS badge tone (no new CSS), a
// display label, and (where the flow continues) the next status "Advance" moves to.
const REQ_STATUS = {
  new:       { label: "New",       tone: "pending",   next: "contacted", nextLabel: "Mark as contacted" },
  contacted: { label: "Contacted", tone: "neutral",   next: "scheduled", nextLabel: "Mark as scheduled" },
  scheduled: { label: "Scheduled", tone: "confirmed", next: "booked",    nextLabel: "Mark as booked" },
  booked:    { label: "Booked",    tone: "paid",      next: null },
  closed:    { label: "Closed",    tone: "cancelled", next: null },
};
const REQ_ORDER = ["new", "contacted", "scheduled", "booked", "closed"];
function reqStatus(r) { return (((r && r.status) || "new") + "").toLowerCase(); }
function reqLabel(s) { return (REQ_STATUS[s] || {}).label || (s ? s[0].toUpperCase() + s.slice(1) : "New"); }
function ReqStatusChip({ status }) {
  const cfg = REQ_STATUS[status] || REQ_STATUS.new;
  return <Badge tone={cfg.tone} dot>{cfg.label}</Badge>;
}

// The admin console lives at admin.<host>; the consumer booking link the customer
// opens lives at <host>. Prefer an explicit config value; otherwise derive it by
// dropping the leading `admin.` label. BE may also return an absolute URL, which wins.
function consumerBase() {
  const c = window.TK_CONFIG || {};
  if (c.webBaseUrl) return String(c.webBaseUrl).replace(/\/+$/, "");
  if (c.WEB_BASE_URL) return String(c.WEB_BASE_URL).replace(/\/+$/, "");
  try {
    const host = window.location.host.replace(/^admin\./, "");
    return window.location.protocol + "//" + host;
  } catch (_) { return ""; }
}
function copyText(t) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(String(t)); return true; } } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = String(t); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    return true;
  } catch (_) { return false; }
}
function digits(s) { return String(s || "").replace(/[^0-9]/g, ""); }

function RequestsAdmin({ go }) {
  const A = window.TK_ADMIN || {};
  const all = A.requests || [];
  const [q, setQ] = React.useState("");
  const [statusF, setStatusF] = React.useState("");     // "" = all
  const [detail, setDetail] = React.useState(null);      // request open in the side drawer
  const [dismiss, setDismiss] = React.useState(null);    // request being dismissed
  const [reason, setReason] = React.useState("");
  const [linkModal, setLinkModal] = React.useState(null); // { url }
  const [toast, setToast] = React.useState(null);

  const ql = q.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (statusF && reqStatus(r) !== statusF) return false;
    if (!ql) return true;
    return [r.tour, r.customerName, r.email, r.phone].some((v) => String(v || "").toLowerCase().includes(ql));
  });
  const newCount = all.filter((r) => reqStatus(r) === "new").length;

  // Fulfil a request in one click. The landed BE splits fulfillment into two calls
  // (TRI-1137): first create an UNLISTED departure for the requested tour/date/size,
  // then mint a 72h-hold reserved booking against THAT departure id. We compose them:
  //   POST /departures {visibility:'unlisted', …}        → { id, … }
  //   POST /requests/:id/secure-link { departureId, partySize } → { ref, token }
  // then build /bookings/:ref?t=<token> (TRI-1095), copy it, and show it to share.
  const buildLink = (res) => {
    if (res && (res.url || res.bookingUrl)) return res.url || res.bookingUrl;
    const ref = (res && res.ref) || ("TKP" + Math.random().toString(36).slice(2, 8).toUpperCase());
    const tok = (res && (res.token || res.publicToken)) || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    return consumerBase() + "/bookings/" + encodeURIComponent(ref) + "?t=" + encodeURIComponent(tok);
  };
  const secureLink = (r) => {
    const raw = r.requestedDateRaw || (/^\d{4}-\d{2}-\d{2}/.test(r.requestedDate || "") ? String(r.requestedDate).slice(0, 10) : "");
    const size = Math.max(1, +r.partySize || 1);
    window.TK_ADMIN_ACT(
      () => window.TK_ADMIN_API.createDeparture({ tourId: r.tourId, date: raw, capacity: size, currency: r.currency || "USD", visibility: "unlisted" }),
      (dep) => {
        const depId = dep && dep.id;
        window.TK_ADMIN_ACT(
          () => window.TK_ADMIN_API.createRequestSecureLink(r.id, { departureId: depId, partySize: size }),
          (res) => {
            const url = buildLink(res);
            copyText(url);
            // A minted hold means the request is at least scheduled.
            if (reqStatus(r) === "new" || reqStatus(r) === "contacted") r.status = "scheduled";
            setLinkModal({ url: url, name: r.customerName });
          }
        );
      }
    );
  };

  // Open the shared Add-departure drawer (DeparturesAdmin) prefilled with this
  // request's tour + requested date + capacity ≥ group size + Unlisted visibility.
  // DeparturesAdmin only listens for the event while mounted, so navigate first.
  const createDeparture = (r) => {
    go("departures");
    // mapRequest supplies requestedDateRaw (yyyy-mm-dd) in live mode; fall back to
    // requestedDate when it's already an ISO date (fixtures) so the picker prefills either way.
    const raw = r.requestedDateRaw || (/^\d{4}-\d{2}-\d{2}/.test(r.requestedDate || "") ? String(r.requestedDate).slice(0, 10) : "");
    const dtl = { tourId: r.tourId, date: raw, capacity: Math.max(1, +r.partySize || 1), visibility: "unlisted" };
    setTimeout(() => { try { window.dispatchEvent(new CustomEvent("tk-add-departure", { detail: dtl })); } catch (_) {} }, 80);
  };

  const advance = (r) => {
    const cfg = REQ_STATUS[reqStatus(r)] || {};
    if (!cfg.next) return;
    const next = cfg.next;
    window.TK_ADMIN_ACT(
      () => window.TK_ADMIN_API.updateRequest(r.id, { status: next }),
      () => { r.status = next; setToast(r.customerName + " → " + reqLabel(next)); }
    );
  };

  const doDismiss = () => {
    const r = dismiss, why = reason.trim();
    // BE updateRequestStatus persists `status` (reason is captured locally for the
    // drawer + sent for future-proofing; the status change is audit-logged server-side).
    window.TK_ADMIN_ACT(
      () => window.TK_ADMIN_API.updateRequest(r.id, { status: "closed", reason: why || undefined }),
      () => { r.status = "closed"; r.closeReason = why; setDismiss(null); setReason(""); setDetail(null); setToast("Request from " + r.customerName + " closed"); }
    );
  };

  const waLink = (r) => "https://wa.me/" + digits(r.phone) + "?text=" + encodeURIComponent(
    "Hi " + (r.customerName || "there") + ", thanks for your TripKoach request for " + r.tour +
    (r.requestedDate ? " around " + r.requestedDate : "") + ". "
  );
  const mailLink = (r) => "mailto:" + encodeURIComponent(r.email) +
    "?subject=" + encodeURIComponent("Your TripKoach request: " + r.tour) +
    "&body=" + encodeURIComponent("Hi " + (r.customerName || "") + ",\n\nThanks for your request for " + r.tour +
      (r.requestedDate ? " on " + r.requestedDate : "") + " for " + r.partySize + " traveller" + (r.partySize === 1 ? "" : "s") + ".\n\n");

  const rowMenu = (r) => {
    const cfg = REQ_STATUS[reqStatus(r)] || {};
    const items = [];
    if (cfg.next) items.push({ icon: "check", label: cfg.nextLabel, onClick: () => advance(r) });
    items.push({ icon: "calendar-days", label: "Create departure…", onClick: () => createDeparture(r) });
    items.push({ icon: "link", label: "Copy secure booking link", onClick: () => secureLink(r) });
    items.push({ divider: true });
    if (r.email) items.push({ icon: "mail", label: "Email customer", onClick: () => { try { window.open(mailLink(r)); } catch (_) {} } });
    if (r.phone) items.push({ icon: "phone", label: "Call", onClick: () => { try { window.open("tel:" + r.phone); } catch (_) {} } });
    if (r.phone) items.push({ icon: "message-circle", label: "WhatsApp", onClick: () => { try { window.open(waLink(r), "_blank"); } catch (_) {} } });
    if (reqStatus(r) !== "closed") { items.push({ divider: true }); items.push({ icon: "x", label: "Dismiss with reason…", danger: true, onClick: () => { setDismiss(r); setReason(""); } }); }
    return items;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Alert tone="info" title="Custom-date requests">
        Travellers asking for a date that isn't scheduled land here. Schedule a private departure and share a secure booking link, or dismiss with a note. New requests get a first reply within 24 hours.
      </Alert>

      <div className="tk-tablewrap">
        <div className="tk-tabletools" style={{ gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{rows.length} request{rows.length === 1 ? "" : "s"}</strong>
          {newCount > 0 && <Badge tone="pending" dot>{newCount} new</Badge>}
          <div style={{ marginInlineStart: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <SearchField id="req-search" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Search tour, name, email…" style={{ minWidth: 220 }} />
            <Select value={statusF} onChange={(e) => setStatusF(e.target.value)} options={[{ value: "", label: "All statuses" }].concat(REQ_ORDER.map((s) => ({ value: s, label: reqLabel(s) })))} />
          </div>
        </div>
        <DataTable density="compact"
          columns={[
            { key: "tour", header: "Tour", strong: true, render: (r) => <span style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{r.tour}</span> },
            { key: "requestedDate", header: "Requested date", render: (r) => <span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{r.requestedDate || "-"}</span> },
            { key: "partySize", header: "Group", align: "end", render: (r) => <span className="tk-num">{r.partySize}</span> },
            { key: "customer", header: "Customer", render: (r) => <span><div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{r.customerName}</div><div className="tk-caption">{r.email || r.phone || ""}</div></span> },
            { key: "receivedAt", header: "Received", render: (r) => <span className="tk-caption">{r.receivedAt || "-"}</span> },
            { key: "status", header: "Status", render: (r) => <ReqStatusChip status={reqStatus(r)} /> },
          ]}
          rows={rows} getRowId={(r) => r.id}
          onRowClick={(r) => setDetail(r)}
          rowActions={(r) => <span onClick={(e) => e.stopPropagation()}><RowMenu label={"Actions for " + r.customerName} items={rowMenu(r)} /></span>}
          empty={<EmptyState icon="message-square" title={q || statusF ? "No matching requests" : "No custom-date requests yet"} body={q || statusF ? "Try a different search or status filter." : "When a traveller asks for a date that isn't scheduled, it shows up here."} />} />
      </div>

      {/* Detail drawer: full request + all actions as large buttons for a clear triage view */}
      <Drawer open={!!detail} title={detail ? detail.customerName : ""} subtitle={detail ? detail.tour : ""} onClose={() => setDetail(null)}
        footer={detail && <>
          <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
          {REQ_STATUS[reqStatus(detail)] && REQ_STATUS[reqStatus(detail)].next && <Button variant="secondary" iconStart="check" onClick={() => advance(detail)}>{REQ_STATUS[reqStatus(detail)].nextLabel}</Button>}
          <Button iconStart="calendar-days" onClick={() => createDeparture(detail)} style={{ marginInlineStart: "auto" }}>Create departure</Button>
        </>}>
        {detail && <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><ReqStatusChip status={reqStatus(detail)} /></div>
          <div className="tk-summary">
            <div className="tk-summary__line"><span>Tour</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{detail.tour}</span></div>
            <div className="tk-summary__line"><span>Requested date</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{detail.requestedDate || "-"}</span></div>
            <div className="tk-summary__line"><span>Group size</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{detail.partySize} traveller{detail.partySize === 1 ? "" : "s"}</span></div>
            <div className="tk-summary__line"><span>Received</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{detail.receivedAt || "-"}</span></div>
            <div className="tk-summary__line"><span>Email</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{detail.email ? <a href={mailLink(detail)} style={{ color: "var(--brand-ink)" }}>{detail.email}</a> : "-"}</span></div>
            <div className="tk-summary__line"><span>Phone</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{detail.phone ? <a href={"tel:" + detail.phone} style={{ color: "var(--brand-ink)" }}>{detail.phone}</a> : "-"}</span></div>
            {detail.indicativeTotalMinor != null && <div className="tk-summary__line"><span>Indicative total</span><span style={{ fontWeight: 600, color: "var(--text-strong)" }}><Price amount={detail.indicativeTotalMinor / 100} currency={detail.currency || "USD"} size="sm" /> <span className="tk-caption">· {detail.indicativeLabel || "indicative, confirmed on quote"}</span></span></div>}
          </div>
          {detail.note && <div><span className="tk-label" style={{ display: "block", marginBottom: 4 }}>Their note</span><p className="tk-body-sm" style={{ margin: 0, padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>{detail.note}</p></div>}
          {detail.closeReason && <Alert tone="neutral" title="Closed">{detail.closeReason}</Alert>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button size="sm" variant="secondary" iconStart="link" onClick={() => secureLink(detail)}>Copy secure link</Button>
            {detail.phone && <Button size="sm" variant="secondary" iconStart="message-circle" onClick={() => { try { window.open(waLink(detail), "_blank"); } catch (_) {} }}>WhatsApp</Button>}
            {reqStatus(detail) !== "closed" && <Button size="sm" variant="ghost" iconStart="x" onClick={() => { setDismiss(detail); setReason(""); }} style={{ color: "var(--danger-fg)" }}>Dismiss…</Button>}
          </div>
        </div>}
      </Drawer>

      {/* Secure booking link: shown so the operator can copy/share even if the
          clipboard write was blocked. */}
      <Modal open={!!linkModal} title="Secure booking link"
        description={linkModal ? "Share this with " + (linkModal.name || "the customer") + ". It opens their private, reserved booking (72-hour hold)." : ""}
        onClose={() => setLinkModal(null)}
        actions={<><Button variant="secondary" onClick={() => setLinkModal(null)}>Done</Button><Button iconStart="link" onClick={() => { if (linkModal && copyText(linkModal.url)) setToast("Link copied to clipboard"); }}>Copy link</Button></>}>
        {linkModal && <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Alert tone="success" title="Copied to your clipboard">The link is on your clipboard. Paste it into your reply. Only someone with this link can open the booking.</Alert>
          <Input readOnly value={linkModal.url} onFocus={(e) => e.target.select()} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }} />
        </div>}
      </Modal>

      {/* Dismiss with reason → PATCH status Closed */}
      <Modal open={!!dismiss} tone="danger" title="Dismiss this request?"
        description={dismiss ? dismiss.customerName + " · " + dismiss.tour + (dismiss.requestedDate ? " · " + dismiss.requestedDate : "") : ""}
        onClose={() => { setDismiss(null); setReason(""); }}
        actions={<><Button variant="secondary" onClick={() => { setDismiss(null); setReason(""); }}>Keep it</Button><Button variant="danger" iconStart="x" onClick={doDismiss}>Dismiss request</Button></>}>
        {dismiss && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormField id="req-reason" label="Reason" hint="Kept for the record. Not sent to the customer.">
            <Textarea id="req-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>}
      </Modal>

      {toast && <div style={{ position: "fixed", bottom: 20, insetInline: 0, display: "flex", justifyContent: "center", zIndex: 800 }}><Toast tone="success" onClose={() => setToast(null)}>{toast}</Toast></div>}
    </div>
  );
}
Object.assign(window, { RequestsAdmin });
