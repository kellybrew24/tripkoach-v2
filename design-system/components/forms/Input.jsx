import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function Input({ iconStart, trailing, state, className = "", ...rest }) {
  const input = (
    <input className={["tk-input", className].filter(Boolean).join(" ")} data-state={state} {...rest} />
  );
  if (!iconStart && !trailing) return input;
  return (
    <div className={["tk-input-group", trailing && "tk-input-group--trail"].filter(Boolean).join(" ")}>
      {iconStart && <span className="tk-input-group__lead"><Icon name={iconStart} size={18} /></span>}
      {input}
      {trailing && <span className="tk-input-group__trail">{trailing}</span>}
    </div>
  );
}
