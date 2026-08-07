import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function RoleMatrix({ roles = [], permissions = [], value = {}, onToggle, readOnly = false }) {
  const has = (perm, role) => !!(value[perm] && value[perm][role]);
  return (
    <div className="tk-tablewrap">
      <table className="tk-matrix">
        <thead><tr><th>Permission</th>{roles.map(r => <th key={r.id}>{r.label}</th>)}</tr></thead>
        <tbody>
          {permissions.map((perm) => (
            <tr key={perm.id}>
              <td>{perm.label}{perm.hint && <div className="tk-caption" style={{ fontWeight: 400 }}>{perm.hint}</div>}</td>
              {roles.map((r) => {
                const locked = r.locked || perm.lockedFor === r.id;
                const on = locked ? true : has(perm.id, r.id);
                return (
                  <td key={r.id}>
                    <button type="button" disabled={readOnly || locked} aria-pressed={on} aria-label={perm.label + " for " + r.label}
                      onClick={() => onToggle && onToggle(perm.id, r.id)}
                      style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid " + (on ? "var(--success-solid)" : "var(--border-default)"), background: on ? "var(--success-solid)" : "transparent", color: "#fff", display: "grid", placeItems: "center", cursor: locked || readOnly ? "not-allowed" : "pointer", opacity: locked ? .6 : 1 }}>
                      {on && <Icon name="check" size={15} />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
