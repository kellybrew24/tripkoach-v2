import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function IconButton({ icon, label, variant = "ghost", disabled, className = "", ...rest }) {
  return (
    <button type="button" aria-label={label} disabled={disabled}
      className={["tk-iconbtn", variant !== "ghost" && `tk-iconbtn--${variant}`, className].filter(Boolean).join(" ")} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}
