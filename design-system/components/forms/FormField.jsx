import React from "react";
import { Icon } from "../icons/Icon.jsx";

/** Label + control + helper/error wrapper. Every input in TripKoach is wrapped in one. */
export function FormField({ id, label, optional = false, required = false, help, error, success, children }) {
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-error` : undefined;
  return (
    <div className="tk-field">
      <label className="tk-label" htmlFor={id}>
        {label}
        {optional && <span className="tk-label__opt"> (optional)</span>}
        {required && <span className="tk-label__req" aria-hidden="true">*</span>}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children, {
            id,
            "aria-describedby": [helpId, errId].filter(Boolean).join(" ") || undefined,
            "aria-invalid": error ? true : undefined,
            "aria-required": required || undefined,
          })
        : children}
      {help && !error && <p className="tk-help" id={helpId}>{help}</p>}
      {success && !error && <p className="tk-help" style={{ color: "var(--success-fg)" }}><Icon name="check" size={13} /> {success}</p>}
      {error && (
        <p className="tk-error" id={errId} role="alert">
          <Icon name="circle-alert" size={14} style={{ marginTop: 1 }} />{error}
        </p>
      )}
    </div>
  );
}
