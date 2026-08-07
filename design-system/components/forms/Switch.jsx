import React from "react";
export function Switch({ id, label, checked, disabled, description, ...rest }) {
  return (
    <div>
      <label className="tk-switch" htmlFor={id}>
        <input type="checkbox" role="switch" id={id} checked={checked} disabled={disabled} className="tk-sr-only" {...rest} />
        <span className="tk-switch__track"><span className="tk-switch__thumb" /></span>
        <span className="tk-choice__label">{label}</span>
      </label>
      {description && <p className="tk-help" style={{ marginTop: 4 }}>{description}</p>}
    </div>
  );
}
