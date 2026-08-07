import React from "react";
export function Select({ options = [], placeholder, className = "", ...rest }) {
  return (
    <select className={["tk-select", className].filter(Boolean).join(" ")} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  );
}
