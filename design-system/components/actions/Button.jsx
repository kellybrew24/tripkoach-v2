import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function Button({
  variant = "primary", size = "md", block = false, loading = false, disabled = false,
  iconStart, iconEnd, as = "button", href, children, className = "", ...rest
}) {
  const Tag = as === "a" ? "a" : "button";
  const cls = [
    "tk-btn", `tk-btn--${variant}`, size !== "md" && `tk-btn--${size}`,
    block && "tk-btn--block", loading && "tk-btn--loading", className
  ].filter(Boolean).join(" ");
  return (
    <Tag className={cls} href={Tag === "a" ? href : undefined}
      disabled={Tag === "button" ? disabled || loading : undefined}
      aria-disabled={Tag === "a" && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined} {...rest}>
      {iconStart && <Icon name={iconStart} size={size === "sm" ? 16 : 18} className="tk-btn__icon" />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={size === "sm" ? 16 : 18} className="tk-btn__icon" />}
      {loading && <span className="tk-btn__spinner"><span className="tk-spinner" /><span className="tk-sr-only">Working…</span></span>}
    </Tag>
  );
}
