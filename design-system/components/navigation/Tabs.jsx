import React from "react";
export function Tabs({ tabs = [], value, onChange, idPrefix = "tab" }) {
  return (
    <div className="tk-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="tk-tab" id={idPrefix + "-" + t.id}
          aria-selected={value === t.id} aria-controls={idPrefix + "-panel-" + t.id}
          tabIndex={value === t.id ? 0 : -1} onClick={() => onChange && onChange(t.id)}>
          {t.label}{t.count != null && <span className="tk-muted"> ({t.count})</span>}
        </button>
      ))}
    </div>
  );
}
