import React from "react";
export function Checkbox({ id, label, description, card = false, checked, ...rest }) {
  return (
    <label className={["tk-choice", card && "tk-choice--card"].filter(Boolean).join(" ")} htmlFor={id} data-checked={!!checked}>
      <input type="checkbox" id={id} checked={checked} {...rest} />
      <span className="tk-choice__text">
        <span className="tk-choice__label">{label}</span>
        {description && <span className="tk-help">{description}</span>}
      </span>
    </label>
  );
}
