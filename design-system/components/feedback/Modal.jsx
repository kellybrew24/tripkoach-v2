import React from "react";
import { Icon } from "../icons/Icon.jsx";
export function Modal({ open, title, description, tone = "default", children, actions, onClose, labelledBy = "tk-modal-title" }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="tk-scrim" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={["tk-modal", tone === "danger" && "tk-modal--danger"].filter(Boolean).join(" ")}
        role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {tone === "danger" && <span className="tk-modal__mark"><Icon name="triangle-alert" size={22} /></span>}
        <div className="tk-stack" style={{ gap: "var(--space-2)" }}>
          <h2 className="tk-h4" id={labelledBy}>{title}</h2>
          {description && <p className="tk-body-sm tk-muted">{description}</p>}
        </div>
        {children}
        <div className="tk-modal__actions">{actions}</div>
      </div>
    </div>
  );
}
