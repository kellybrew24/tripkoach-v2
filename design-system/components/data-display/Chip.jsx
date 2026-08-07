import React from "react";
import { Icon } from "../icons/Icon.jsx";
export function Chip({ children, active = false, onRemove, ...rest }) {
  return (
    <button type="button" className="tk-chip" aria-pressed={active} {...rest}>
      {children}
      {onRemove && (
        <span className="tk-chip__x" aria-hidden="true"><Icon name="x" size={11} /></span>
      )}
    </button>
  );
}
