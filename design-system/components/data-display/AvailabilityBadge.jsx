import React from "react";
export function AvailabilityBadge({ spotsLeft, threshold = 5 }) {
  if (spotsLeft <= 0) return <span className="tk-badge tk-badge--cancelled">Sold out</span>;
  if (spotsLeft <= threshold)
    return <span className="tk-badge tk-badge--pending">{spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left</span>;
  return <span className="tk-badge tk-badge--confirmed">Available</span>;
}
