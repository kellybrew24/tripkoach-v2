import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function BottomNav({ items = [], current, onSelect }) {
  return (
    <nav className="tk-bottomnav" aria-label="Primary">
      {items.map((i) => (
        <button key={i.id} type="button" className="tk-bottomnav__item"
          aria-current={current === i.id ? "page" : undefined} onClick={() => onSelect && onSelect(i.id)}>
          <span className="tk-bottomnav__ico"><Icon name={i.icon} size={20} /></span>
          {i.label}
          {i.badge ? <span className="tk-sr-only">, {i.badge} updates</span> : null}
        </button>
      ))}
    </nav>
  );
}
