const NS = window.TripKoachDesignSystem_c9e4af;
const { AuditTimeline, Button, EmptyState, Spinner } = NS;

// Map a backend audit action string to one of AuditTimeline's known icon types.
// Unmatched actions fall back to a neutral "note".
const AUDIT_ICON = [
  ["refund", "refunded"], ["mark_paid", "paid"], ["paid", "paid"],
  ["cancel", "cancelled"], ["confirm", "confirmed"], ["fail", "failed"],
  ["invite", "created"], ["create", "created"], ["email", "email"], ["send", "email"],
];
function auditType(action) {
  const a = String(action || "").toLowerCase();
  for (const [needle, type] of AUDIT_ICON) if (a.indexOf(needle) > -1) return type;
  return "note";
}
function auditTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function auditEsc(s) {
  return String(s == null ? "" : s).replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}
// A one-line human summary: "<actor> did <action> · <target>". Actor name is
// bolded inline; the timeline's meta line carries the actor's email + timestamp.
function auditText(it) {
  const action = auditEsc(String(it.action || "").replace(/[._]/g, " "));
  const tgt = it.targetType ? " · " + auditEsc(it.targetType) + (it.targetId ? " " + auditEsc(it.targetId) : "") : "";
  return "<strong>" + auditEsc(it.actor || "System") + "</strong> " + action + tgt;
}

// Read-only audit log (A16, backend TRI-898 GET /admin/audit-log). Paginated,
// newest first. Only ever reached when live (the nav entry is live-gated); off
// the flag it degrades to an informational empty state and makes no request.
function AuditLogAdmin({ go }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [items, setItems] = React.useState([]);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [status, setStatus] = React.useState(LIVE ? "loading" : "idle");

  const fetchPage = React.useCallback((p, append) => {
    if (!LIVE || !window.TK_ADMIN_API) { setStatus("idle"); return; }
    setStatus(append ? "more" : "loading");
    window.TK_ADMIN_API.listAuditLog({ page: p, pageSize: 50 }).then(
      (r) => {
        const list = (r && r.items) || [];
        setItems((prev) => (append ? prev.concat(list) : list));
        setTotalPages((r && r.totalPages) || 1);
        setTotal((r && typeof r.total === "number") ? r.total : list.length);
        setPage(p);
        setStatus("ok");
      },
      () => setStatus("error")
    );
  }, [LIVE]);

  React.useEffect(() => { fetchPage(1, false); }, [fetchPage]);

  if (!LIVE) {
    return <EmptyState icon="shield-check" title="Audit log"
      body="Every staff action across the console is recorded here once connected to the live service." />;
  }
  if (status === "loading") {
    return <div style={{ padding: 48, display: "grid", placeItems: "center" }}><Spinner /></div>;
  }
  if (status === "error") {
    return <EmptyState icon="triangle-alert" title="Couldn't load the audit log"
      body="Something went wrong reaching the console service."
      action={<Button onClick={() => fetchPage(1, false)}>Try again</Button>} />;
  }

  const events = items.map((it) => ({
    type: auditType(it.action),
    text: auditText(it),
    actor: it.actorEmail || null,
    time: auditTime(it.createdAt),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p className="tk-caption" style={{ margin: 0 }}>A read-only record of who changed what, newest first.</p>
        <span className="tk-caption">{total} {total === 1 ? "entry" : "entries"}</span>
      </div>
      {events.length === 0
        ? <EmptyState icon="shield-check" title="No activity yet"
            body="Staff actions across the console will appear here as they happen." />
        : <div className="tk-card"><div className="tk-card__body"><AuditTimeline events={events} /></div></div>}
      {page < totalPages && (
        <div style={{ display: "grid", placeItems: "center" }}>
          <Button variant="secondary" loading={status === "more"} onClick={() => fetchPage(page + 1, true)}>Load more</Button>
        </div>
      )}
    </div>
  );
}
Object.assign(window, { AuditLogAdmin });
