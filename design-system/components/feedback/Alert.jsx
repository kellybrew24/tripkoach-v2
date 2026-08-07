import React from "react";
import { Icon } from "../icons/Icon.jsx";
const ICON = { info: "info", success: "circle-check-big", warning: "triangle-alert", error: "circle-alert" };
export function Alert({ tone = "info", title, children, action, onDismiss }) {
  return (
    <div className={`tk-alert tk-alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="tk-alert__icon"><Icon name={ICON[tone]} size={18} /></span>
      <div style={{ flex: 1 }}>
        {title && <strong className="tk-alert__title">{title}</strong>}
        <div className="tk-alert__body">{children}</div>
        {action && <div style={{ marginTop: "var(--space-3)" }}>{action}</div>}
      </div>
      {onDismiss && <button type="button" className="tk-iconbtn" onClick={onDismiss} aria-label="Dismiss" style={{ width: 32, height: 32 }}><Icon name="x" size={16} /></button>}
    </div>
  );
}
