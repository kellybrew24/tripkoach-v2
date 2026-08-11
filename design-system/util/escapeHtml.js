// TRI-1066 (OWASP A03): single canonical HTML escaper for the design system,
// exported on the DS namespace (window.TripKoachDesignSystem_*.escapeHtml) and
// reused by both apps — the admin audit-log summaries and the web printable
// receipt — instead of each screen re-defining its own ad-hoc escaper.
//
// Escapes the full set of HTML-significant characters (& < > " ') so the result
// is safe in both element-content and attribute contexts.
//
// NOTE: _ds_bundle.js is hand-maintained. This file is the source of record for
// the `util/escapeHtml.js` block in that bundle; keep the two in sync.
export function escapeHtml(v) {
  return String(v == null ? "" : v).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
