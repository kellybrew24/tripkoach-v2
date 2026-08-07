import React from "react";

export function Spinner({ size = 20, label = "Loading", inline = false }) {
  return (
    <span role="status" aria-live="polite" style={{ display: inline ? "inline-flex" : "flex", justifyContent: "center", alignItems: "center" }}>
      <span className="tk-spinner" style={{ width: size, height: size, borderWidth: size > 24 ? 3 : 2 }} />
      <span className="tk-sr-only">{label}</span>
    </span>
  );
}
