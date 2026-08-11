const NS = window.TripKoachDesignSystem_c9e4af;
const { AuditTimeline, Button, EmptyState, Spinner, SearchField, Select, escapeHtml } = NS;

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
// TRI-1066: use the one shared DS escaper (NS.escapeHtml) instead of a local
// ad-hoc copy. `auditText` builds trusted markup (the actor is bolded) so it is
// passed to AuditTimeline via the `html` opt-in; every interpolated, possibly
// user-controlled value goes through auditEsc first.
const auditEsc = escapeHtml;

// TRI-997 · Turn a raw "<entity>.<verb>" action code into a plain-English past-
// tense phrase. `SELF` verbs describe an action on the actor themselves (sign in,
// MFA, trust device) so they read as a full clause and ignore the target entity.
const VERB = {
  create: "created", update: "updated", delete: "deleted",
  cancel: "cancelled", confirm: "confirmed", reschedule: "rescheduled",
  publish: "published", unpublish: "unpublished",
  refund: "refunded", refund_failed: "failed to refund", mark_paid: "marked as paid",
  deactivate: "deactivated", reply: "replied to", approve: "approved", reject: "rejected",
  invite: "invited", disable: "disabled", enable: "re-enabled", resend_invite: "re-sent an invite to",
  resend_confirmation: "re-sent the confirmation for",
  login: "signed in", login_failed: "failed to sign in", logout: "signed out",
  mfa_challenge: "was prompted for two-factor", mfa_failed: "failed two-factor",
  mfa_enroll_required: "was asked to set up two-factor", device_trusted: "trusted a device",
};
const SELF = { login: 1, login_failed: 1, logout: 1, mfa_challenge: 1, mfa_failed: 1, mfa_enroll_required: 1, device_trusted: 1 };
// Human label for a target_type; falls back to the code with underscores spaced.
const ENTITY = {
  booking: "booking", staff_user: "staff member", tour: "tour", departure: "departure",
  region: "region", guide: "guide", payment: "payment", promo_code: "promo code", review: "review",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prefer a friendly name carried in the before/after payload (title/name/code/…)
// over an opaque UUID target id. Booking/payment ids are human refs, so keep them.
function targetLabel(it) {
  const bags = [it.after, it.before];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const key of ["title", "name", "code", "slug", "ref", "email", "date"]) {
      if (bag[key]) return String(bag[key]);
    }
  }
  const id = it.targetId;
  if (id && !UUID_RE.test(String(id))) return String(id);
  return null;
}
function prettify(s) { return String(s || "").replace(/[._]/g, " ").trim(); }

// One-line human summary rendered as HTML into AuditTimeline (actor bolded).
// e.g. "Samuel cancelled booking TRK-8FA2." / "qa-bot signed in."
function auditText(it) {
  const parts = String(it.action || "").split(".");
  const verbKey = parts.slice(1).join(".") || parts[0] || "";
  const vp = VERB[verbKey] || prettify(verbKey) || "acted";
  const actor = "<strong>" + auditEsc(it.actor || "System") + "</strong>";
  if (SELF[verbKey]) return actor + " " + auditEsc(vp) + ".";
  const ent = it.targetType ? (ENTITY[it.targetType] || prettify(it.targetType)) : "";
  const lbl = targetLabel(it);
  let s = actor + " " + auditEsc(vp);
  if (ent) s += " " + auditEsc(ent);
  if (lbl) s += " “" + auditEsc(lbl) + "”";
  return s + ".";
}

const PAGE_SIZE = 50;

// Read-only audit log (A16, backend TRI-898 GET /admin/audit-log). Now human-
// readable (plain-English sentences) and searchable/filterable server-side by
// actor, action, entity, free-text and a date range (TRI-997). Newest first,
// paginated via "Load more". Only ever reached when live (nav entry is live-
// gated); off the flag it degrades to an informational empty state.
function AuditLogAdmin({ go }) {
  const LIVE = !!(window.TK_CONFIG && window.TK_CONFIG.USE_LIVE_API);
  const [items, setItems] = React.useState([]);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [facets, setFacets] = React.useState({ actions: [], actors: [], targetTypes: [] });
  const [status, setStatus] = React.useState(LIVE ? "loading" : "idle");

  // Filter state. `q` is the live input; `qDebounced` is what actually fires a
  // request so typing doesn't hammer the endpoint.
  const [q, setQ] = React.useState("");
  const [qDebounced, setQDebounced] = React.useState("");
  const [action, setAction] = React.useState("");
  const [actorId, setActorId] = React.useState("");
  const [targetType, setTargetType] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters = React.useMemo(() => ({
    q: qDebounced || undefined, action: action || undefined, actorId: actorId || undefined,
    targetType: targetType || undefined, from: from || undefined, to: to || undefined,
  }), [qDebounced, action, actorId, targetType, from, to]);

  const fetchPage = React.useCallback((p, append) => {
    if (!LIVE || !window.TK_ADMIN_API) { setStatus("idle"); return; }
    setStatus(append ? "more" : "loading");
    window.TK_ADMIN_API.listAuditLog(Object.assign({ page: p, pageSize: PAGE_SIZE }, filters)).then(
      (r) => {
        const list = (r && r.items) || [];
        setItems((prev) => (append ? prev.concat(list) : list));
        setTotalPages((r && r.totalPages) || 1);
        setTotal((r && typeof r.total === "number") ? r.total : list.length);
        if (r && r.facets) setFacets(r.facets);
        setPage(p);
        setStatus("ok");
      },
      () => setStatus("error")
    );
  }, [LIVE, filters]);

  // Re-run from page 1 whenever a filter changes (and on first mount).
  React.useEffect(() => { fetchPage(1, false); }, [fetchPage]);

  if (!LIVE) {
    return <EmptyState icon="shield-check" title="Audit log"
      body="Every staff action across the console is recorded here once connected to the live service." />;
  }

  const hasFilter = !!(qDebounced || action || actorId || targetType || from || to);
  const clearFilters = () => { setQ(""); setQDebounced(""); setAction(""); setActorId(""); setTargetType(""); setFrom(""); setTo(""); };

  const actorOptions = [{ value: "", label: "All staff" }].concat(
    (facets.actors || []).map((a) => ({ value: a.id, label: a.name || a.email || a.id })));
  const actionOptions = [{ value: "", label: "All actions" }].concat(
    (facets.actions || []).map((a) => ({ value: a, label: prettify(a) })));
  const entityOptions = [{ value: "", label: "All entities" }].concat(
    (facets.targetTypes || []).map((t) => ({ value: t, label: ENTITY[t] || prettify(t) })));

  const filterBar = (
    <div className="tk-card"><div className="tk-card__body" style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
      <div style={{ flex: "2 1 240px", minWidth: 200 }}>
        <label className="tk-caption" style={{ display: "block", marginBottom: 4 }}>Search</label>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")}
          placeholder="Search actor, action, entity or details" />
      </div>
      <div style={{ flex: "1 1 150px", minWidth: 140 }}>
        <label className="tk-caption" style={{ display: "block", marginBottom: 4 }}>Actor</label>
        <Select value={actorId} onChange={(e) => setActorId(e.target.value)} options={actorOptions} />
      </div>
      <div style={{ flex: "1 1 150px", minWidth: 140 }}>
        <label className="tk-caption" style={{ display: "block", marginBottom: 4 }}>Action</label>
        <Select value={action} onChange={(e) => setAction(e.target.value)} options={actionOptions} />
      </div>
      <div style={{ flex: "1 1 130px", minWidth: 120 }}>
        <label className="tk-caption" style={{ display: "block", marginBottom: 4 }}>Entity</label>
        <Select value={targetType} onChange={(e) => setTargetType(e.target.value)} options={entityOptions} />
      </div>
      <div style={{ flex: "0 1 150px", minWidth: 130 }}>
        <label className="tk-caption" style={{ display: "block", marginBottom: 4 }}>From</label>
        <input type="date" className="tk-input" value={from} max={to || undefined}
          onChange={(e) => setFrom(e.target.value)} style={{ width: "100%" }} />
      </div>
      <div style={{ flex: "0 1 150px", minWidth: 130 }}>
        <label className="tk-caption" style={{ display: "block", marginBottom: 4 }}>To</label>
        <input type="date" className="tk-input" value={to} min={from || undefined}
          onChange={(e) => setTo(e.target.value)} style={{ width: "100%" }} />
      </div>
      {hasFilter && (
        <Button variant="ghost" size="sm" iconStart="x" onClick={clearFilters}>Clear</Button>
      )}
    </div></div>
  );

  const events = items.map((it) => ({
    type: auditType(it.action),
    // `html` (not `text`): auditText returns escaped markup with the actor bolded.
    html: auditText(it),
    actor: it.actorEmail || null,
    time: auditTime(it.createdAt),
  }));

  let body;
  if (status === "loading") {
    body = <div style={{ padding: 48, display: "grid", placeItems: "center" }}><Spinner /></div>;
  } else if (status === "error") {
    body = <EmptyState icon="triangle-alert" title="Couldn't load the audit log"
      body="Something went wrong reaching the console service."
      action={<Button onClick={() => fetchPage(1, false)}>Try again</Button>} />;
  } else if (events.length === 0) {
    body = <EmptyState icon="shield-check" title={hasFilter ? "No matching activity" : "No activity yet"}
      body={hasFilter ? "No audit entries match these filters. Try widening the date range or clearing filters."
        : "Staff actions across the console will appear here as they happen."}
      action={hasFilter ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined} />;
  } else {
    body = (
      <>
        <div className="tk-card"><div className="tk-card__body"><AuditTimeline events={events} /></div></div>
        {page < totalPages && (
          <div style={{ display: "grid", placeItems: "center" }}>
            <Button variant="secondary" loading={status === "more"} onClick={() => fetchPage(page + 1, true)}>Load more</Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="tk-row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p className="tk-caption" style={{ margin: 0 }}>A read-only, plain-English record of who changed what, newest first.</p>
        <span className="tk-caption">{total} {total === 1 ? "entry" : "entries"}{hasFilter ? " match" : ""}</span>
      </div>
      {filterBar}
      {body}
    </div>
  );
}
Object.assign(window, { AuditLogAdmin });
