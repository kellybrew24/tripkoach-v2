import React from "react";
import { Icon } from "../icons/Icon.jsx";
export function EmptyState({ icon = "compass", title, body, action }) {
  return (
    <div className="tk-empty">
      <span className="tk-empty__mark"><Icon name={icon} size={26} /></span>
      <div className="tk-stack" style={{ gap: "var(--space-1)" }}>
        <p className="tk-h4">{title}</p>
        {body && <p className="tk-body-sm tk-muted" style={{ maxWidth: "38ch" }}>{body}</p>}
      </div>
      {action}
    </div>
  );
}
