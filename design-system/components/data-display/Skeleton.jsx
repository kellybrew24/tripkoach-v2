import React from "react";
export function Skeleton({ width = "100%", height = 16, radius, lines = 1, className = "" }) {
  if (lines > 1) {
    return (
      <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {Array.from({ length: lines }).map((_, i) => (
          <span key={i} className="tk-skeleton"
            style={{ width: i === lines - 1 ? "62%" : width, height, borderRadius: radius }} />
        ))}
      </div>
    );
  }
  return <span aria-hidden="true" className={["tk-skeleton", className].filter(Boolean).join(" ")}
    style={{ display: "block", width, height, borderRadius: radius }} />;
}
