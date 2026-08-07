import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function NumberStepper({ id, value, min = 1, max = 12, onChange, label = "Travellers", disabled }) {
  const set = (v) => onChange && onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="tk-stepper" role="group" aria-labelledby={`${id}-label`}>
      <span className="tk-sr-only" id={`${id}-label`}>{label}</span>
      <button type="button" className="tk-stepper__btn" onClick={() => set(value - 1)}
        disabled={disabled || value <= min} aria-label={`Remove one ${label.toLowerCase()}`}>
        <Icon name="minus" size={18} />
      </button>
      <output className="tk-stepper__value" aria-live="polite" htmlFor={id}>{value}</output>
      <button type="button" className="tk-stepper__btn" onClick={() => set(value + 1)}
        disabled={disabled || value >= max} aria-label={`Add one ${label.toLowerCase()}`}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}
