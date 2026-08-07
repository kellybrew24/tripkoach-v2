import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { StatusBadge } from "../data-display/StatusBadge.jsx";

export function ConfirmationPanel({ reference, status = "pending", title, subtitle, children, actions }) {
  return (
    <section className="tk-confirm" aria-labelledby="confirm-title">
      <span className="tk-confirm__mark"><Icon name="circle-check-big" size={32} /></span>
      <h1 className="tk-h2" id="confirm-title">{title}</h1>
      {subtitle && <p className="tk-body tk-muted" style={{ maxWidth: "42ch" }}>{subtitle}</p>}
      <StatusBadge status={status} size="lg" />
      <p className="tk-confirm__ref"><span className="tk-sr-only">Booking reference </span>{reference}</p>
      {children}
      {actions && <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: "100%", maxWidth: 360 }}>{actions}</div>}
    </section>
  );
}
