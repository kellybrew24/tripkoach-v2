import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function Drawer({ open, title, subtitle, onClose, footer, children, width }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="tk-drawer-scrim" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <aside className="tk-drawer" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <div className="tk-drawer__head">
          <div><h2 className="tk-h4" style={{ margin: 0 }}>{title}</h2>{subtitle && <p className="tk-caption" style={{ margin: "4px 0 0" }}>{subtitle}</p>}</div>
          <button type="button" className="tk-iconbtn-plain" aria-label="Close" onClick={onClose}><Icon name="x" size={20} /></button>
        </div>
        <div className="tk-drawer__body">{children}</div>
        {footer && <div className="tk-drawer__foot">{footer}</div>}
      </aside>
    </div>
  );
}
