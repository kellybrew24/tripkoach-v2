import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function Breadcrumbs({ items = [] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="tk-breadcrumbs" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((it, i) => (
          <li key={it.label} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {i > 0 && <Icon name="chevron-right" size={13} />}
            {it.href && i < items.length - 1
              ? <a href={it.href}>{it.label}</a>
              : <span aria-current="page">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
