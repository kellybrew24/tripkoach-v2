import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function Accordion({ items = [], defaultOpen = [] }) {
  const [open, setOpen] = React.useState(new Set(defaultOpen));
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  return (
    <div>
      {items.map((it) => {
        const isOpen = open.has(it.id);
        return (
          <div className="tk-accordion" key={it.id}>
            <h3 style={{ margin: 0 }}>
              <button type="button" className="tk-accordion__btn" aria-expanded={isOpen}
                aria-controls={"acc-" + it.id} id={"acc-btn-" + it.id} onClick={() => toggle(it.id)}>
                {it.title}
                <Icon name="chevron-down" size={18} className="tk-accordion__mark" />
              </button>
            </h3>
            <div className="tk-accordion__panel" id={"acc-" + it.id} role="region"
              aria-labelledby={"acc-btn-" + it.id} hidden={!isOpen}>{it.content}</div>
          </div>
        );
      })}
    </div>
  );
}
