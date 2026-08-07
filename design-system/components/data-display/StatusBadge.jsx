import React from "react";
import { Badge } from "./Badge.jsx";

const LABELS = {
  pending: "Pending", confirmed: "Confirmed", cancelled: "Cancelled",
  paid: "Paid", failed: "Payment failed", refunded: "Refunded",
};

export function StatusBadge({ status, size = "sm", withHint = false }) {
  const HINTS = {
    pending: "Awaiting payment", confirmed: "Your spot is held", cancelled: "No longer active",
    paid: "Payment received", failed: "We could not take payment", refunded: "Money returned",
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
      <Badge tone={status} size={size} dot>{LABELS[status]}</Badge>
      {withHint && <span className="tk-caption">{HINTS[status]}</span>}
    </span>
  );
}
