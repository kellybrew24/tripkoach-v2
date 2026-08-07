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
            <span dangerouslySetInnerHTML={{ __html: e.text }} />
            <div className="tk-timeline__meta">{e.actor ? e.actor + " · " : ""}{e.time}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
