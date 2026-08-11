import React from "react";
import { Icon } from "../icons/Icon.jsx";
const ICON = { created: "plus", confirmed: "check", cancelled: "x", paid: "wallet", refunded: "receipt", email: "mail", note: "info", failed: "triangle-alert" };

export function AuditTimeline({ events = [] }) {
  return (
    <ol className="tk-timeline">
      {events.map((e, i) => (
        <li className="tk-timeline__item" key={i}>
          <span className="tk-timeline__dot" style={e.tone ? { color: "var(--" + e.tone + "-fg)", borderColor: "var(--" + e.tone + "-border)", background: "var(--" + e.tone + "-bg)" } : undefined}>
            <Icon name={ICON[e.type] || "info"} size={13} />
          </span>
          <div className="tk-timeline__body">
            {/* TRI-1066 (A03): escape `text` by default so a future caller that
                passes an unescaped user-controlled string (customer name, enquiry
                body, …) can't inject markup. Only `html` is rendered raw — an
                explicit opt-in for callers that intentionally pass trusted markup
                (e.g. the audit screen bolds the actor via escapeHtml-built HTML). */}
            {e.html != null
              ? <span dangerouslySetInnerHTML={{ __html: e.html }} />
              : <span>{e.text}</span>}
            <div className="tk-timeline__meta">{e.actor ? e.actor + " · " : ""}{e.time}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
