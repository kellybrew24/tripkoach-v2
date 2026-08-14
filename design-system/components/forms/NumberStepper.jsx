import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function NumberStepper({ id, value, min = 1, max = 12, onChange, label = "Travellers", unitLabel, disabled }) {
  const set = (v) => onChange && onChange(Math.min(max, Math.max(min, v)));
  // Add/Remove always act on exactly ONE item, so the button labels read as the
  // singular unit (e.g. "Add one traveller"). Fall back to stripping a trailing
  // "s" from the group label when no explicit unitLabel is given (TRI-1169).
  const one = (unitLabel || label.replace(/s$/i, "")).toLowerCase();
  return (
    <div className="tk-stepper" role="group" aria-labelledby={`${id}-label`}>
      <span className="tk-sr-only" id={`${id}-label`}>{label}</span>
      <button type="button" className="tk-stepper__btn" onClick={() => set(value - 1)}
        disabled={disabled || value <= min} aria-label={`Remove one ${one}`}>
        <Icon name="minus" size={18} />
      </button>
      <output className="tk-stepper__value" aria-live="polite" htmlFor={id}>{value}</output>
      <button type="button" className="tk-stepper__btn" onClick={() => set(value + 1)}
        disabled={disabled || value >= max} aria-label={`Add one ${one}`}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
