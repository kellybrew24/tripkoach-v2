import React from "react";
export function Radio({ id, name, label, description, card = false, checked, trailing, ...rest }) {
  return (
    <label className={["tk-choice", card && "tk-choice--card"].filter(Boolean).join(" ")} htmlFor={id} data-checked={!!checked}>
      <input type="radio" id={id} name={name} checked={checked} {...rest} />
      <span className="tk-choice__text" style={{ flex: 1 }}>
        <span className="tk-choice__label">{label}</span>
        {description && <span className="tk-help">{description}</span>}
      </span>
      {trailing}
    </label>
  );
}
