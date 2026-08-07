import React from "react";
import { Icon } from "../icons/Icon.jsx";
const ICON = { info: "info", success: "circle-check-big", error: "circle-alert" };
export function Toast({ tone = "info", children, onClose }) {
  return (
    <div className={`tk-toast tk-toast--${tone}`} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      <span className="tk-toast__icon"><Icon name={ICON[tone]} size={18} /></span>
      <span style={{ fontSize: "var(--text-body-sm-size)", lineHeight: 1.45 }}>{children}</span>
      {onClose && <button type="button" className="tk-toast__close" onClick={onClose} aria-label="Dismiss"><Icon name="x" size={16} /></button>}
    </div>
  );
}
