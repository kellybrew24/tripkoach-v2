import React from "react";
import { Icon } from "../icons/Icon.jsx";

/* Kebab (three-dots) row-action menu for data tables. Opens a small dropdown of
   actions; closes on outside click or Escape. Stops row-click propagation. */
export function RowMenu({ items = [], label = "Row actions", align = "end" }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <span style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="tk-iconbtn-plain" style={{ width: 32, height: 32 }} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(o => !o)}>
        <Icon name="ellipsis" size={18} />
      </button>
      {open && (
        <div className="tk-menu" role="menu" style={{ position: "absolute", top: "calc(100% + 4px)", [align === "end" ? "right" : "left"]: 0, width: 200 }}>
          {items.map((it, i) => it.divider
            ? <div key={i} style={{ height: 1, background: "var(--border-subtle)", margin: "4px 0" }} />
            : <button key={i} type="button" role="menuitem" className="tk-menu__item"
                style={it.danger ? { color: "var(--danger-fg)" } : undefined}
                onClick={() => { setOpen(false); it.onClick && it.onClick(); }}>
                {it.icon && <Icon name={it.icon} size={16} />}{it.label}
              </button>)}
        </div>
      )}
    </span>
  );
}
