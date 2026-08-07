import React from "react";

/** The TripKoach badge. Only the supplied PNG is ever used as the mark — never redrawn. */
export function Logo({ size = 36, wordmark = true, tone = "ink", src = "assets/logo-badge.png", href = "#" }) {
  return (
    <a href={href} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", textDecoration: "none" }}
      aria-label="TripKoach home">
      <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} />
      {wordmark && (
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.03em",
          color: tone === "inverse" ? "var(--n-0)" : "var(--text-strong)" }}>TripKoach</span>
      )}
    </a>
  );
}
