import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function FilterBar({ facets = [], applied = [], onClear, children }) {
  return (
    <div className="tk-tabletools">
      <div className="tk-filterbar">
        {facets.map((f) => (
          <button key={f.id} type="button" className={"tk-facet" + (f.active ? " tk-facet--active" : "")} onClick={f.onClick}>
            <Icon name={f.icon || "sliders-horizontal"} size={15} />{f.label}
            {f.count != null && <span className="tk-muted">({f.count})</span>}
            <Icon name="chevron-down" size={13} style={{ opacity: .6 }} />
          </button>
        ))}
        {children}
      </div>
      {applied.length > 0 && (
        <div className="tk-filterbar" style={{ marginInlineStart: "auto" }}>
          {applied.map((a) => (
            <span className="tk-appliedchip" key={a.id}>{a.label}<button type="button" aria-label={"Remove " + a.label} onClick={a.onRemove}><Icon name="x" size={13} /></button></span>
          ))}
          <button type="button" className="tk-facet" style={{ border: 0, background: "transparent", color: "var(--text-link)" }} onClick={onClear}>Clear all</button>
        </div>
      )}
    </div>
  );
}
