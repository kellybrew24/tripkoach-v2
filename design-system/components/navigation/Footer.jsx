import React from "react";
import { Logo } from "./Logo.jsx";

export function Footer({ columns = [], logoSrc, note = "TripKoach Ltd · Accra, Ghana · Prices in Ghana cedis (GHS)" }) {
  return (
    <footer className="tk-footer">
      <div className="tk-container" style={{ display: "grid", gap: "var(--space-8)", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <div className="tk-stack" style={{ gap: "var(--space-3)" }}>
          <Logo tone="inverse" src={logoSrc} size={34} />
          <p style={{ fontSize: "var(--text-body-sm-size)", color: "var(--n-400)", maxWidth: "30ch" }}>
            Guided tours across Ghana, run by local guides who live where they show you.
          </p>
        </div>
        {columns.map((c) => (
          <div key={c.title}>
            <h3>{c.title}</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {c.links.map((l) => <li key={l.label}><a href={l.href}>{l.label}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="tk-container" style={{ marginTop: "var(--space-8)", paddingTop: "var(--space-5)", borderTop: "1px solid rgba(255,255,255,.12)" }}>
        <p style={{ fontSize: "var(--text-caption-size)", color: "var(--n-400)" }}>{note}</p>
      </div>
    </footer>
  );
}
