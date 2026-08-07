import React from "react";
export function ProgressBar({ value, max = 100, label }) {
  return (
    <div className="tk-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className="tk-progress__bar" style={{ width: `${Math.round((value / max) * 100)}%` }} />
    </div>
  );
}
