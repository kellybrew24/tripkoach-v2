import React from "react";
export function Badge({ tone = "neutral", size = "sm", dot = false, children, className = "", ...rest }) {
  return (
    <span className={["tk-badge", `tk-badge--${tone}`, size === "lg" && "tk-badge--lg", className].filter(Boolean).join(" ")} {...rest}>
      {dot && <span className="tk-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
