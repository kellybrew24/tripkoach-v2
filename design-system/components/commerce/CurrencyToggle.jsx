import React from "react";
export function CurrencyToggle({ value = "GHS", onChange, options = ["GHS", "USD"] }) {
  return (
    <div className="tk-currency-toggle" role="group" aria-label="Display currency">
      {options.map((c) => (
        <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange && onChange(c)}>{c}</button>
      ))}
    </div>
  );
}
