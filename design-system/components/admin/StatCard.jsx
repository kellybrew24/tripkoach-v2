import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function StatCard({ label, value, icon, delta, deltaDir = "flat", hint, loading = false }) {
  if (loading) return (
    <div className="tk-kpi" aria-busy="true"><span className="tk-skeleton" style={{ height: 12, width: "50%", borderRadius: 4 }} /><span className="tk-skeleton" style={{ height: 30, width: "70%", borderRadius: 6, marginTop: 6 }} /></div>
  );
  return (
    <div className="tk-kpi">
      <span className="tk-kpi__label">{icon && <Icon name={icon} size={15} style={{ color: "var(--text-subtle)" }} />}{label}</span>
      <span className="tk-kpi__value">{value}</span>
      {delta != null && (
        <span className={"tk-kpi__delta tk-kpi__delta--" + deltaDir}>
          <Icon name={deltaDir === "up" ? "chevron-up" : deltaDir === "down" ? "chevron-down" : "minus"} size={13} />{delta}
          {hint && <span className="tk-muted" style={{ fontWeight: 400, marginInlineStart: 4 }}>{hint}</span>}
        </span>
      )}
    </div>
  );
}
