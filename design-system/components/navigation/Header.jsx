import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { Logo } from "./Logo.jsx";
import { Button } from "../actions/Button.jsx";
import { IconButton } from "../actions/IconButton.jsx";

export function Header({ items = [], current, signedIn = false, onMenu, logoSrc, compact = false, right }) {
  return (
    <header className="tk-header">
      <div className="tk-container tk-header__inner">
        {compact && <IconButton icon="menu" label="Open menu" onClick={onMenu} />}
        <Logo size={compact ? 30 : 34} wordmark={!compact} src={logoSrc} />
        <nav className="tk-header__nav" aria-label="Main">
          {items.map((i) => (
            <a key={i.href} className="tk-navlink" href={i.href} aria-current={current === i.href ? "page" : undefined}>{i.label}</a>
          ))}
        </nav>
        <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {right}
          {signedIn
            ? <IconButton icon="user" label="Your account" variant="outline" />
            : <>
                <Button variant="ghost" size="sm" className="tk-hide-mobile">Log in</Button>
                <Button variant="primary" size="sm">Sign up</Button>
              </>}
        </div>
      </div>
    </header>
  );
}
