import React from "react";
import { Icon } from "../icons/Icon.jsx";
export function Rating({ value, count, size = 14 }) {
  return (
    <span className="tk-rating">
      <Icon name="star" size={size} className="tk-rating__star" style={{ fill: "currentColor" }} />
      <span className="tk-num">{value.toFixed(1)}</span>
      {count != null && <span className="tk-rating__count">({count})</span>}
      {count != null && <span className="tk-sr-only">out of 5, from {count} review{count === 1 ? "" : "s"}</span>}
    </span>
  );
}
