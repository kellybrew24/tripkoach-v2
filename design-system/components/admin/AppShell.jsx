import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function SideNav({ groups = [], current, onNavigate, collapsed, brand = "TripKoach", logoSrc }) {
  return (
    <nav className="tk-shell__nav" aria-label="Admin">
      <div className="tk-shell__brand">
        {logoSrc ? <img src={logoSrc} width={30} height={30} alt="" /> : null}
        <strong>{brand} <span style={{ color: "var(--gold-400)", fontWeight: 700 }}>Ops</span></strong>
      </div>
      {groups.map((g, gi) => (
        <div className="tk-navgroup" key={g.label || "g" + gi}>
          {g.label && <div className="tk-navgroup__label">{g.label}</div>}
          {g.items.map((it) => (
            <button key={it.id} type="button" className="tk-navitem"
              aria-current={current === it.id ? "page" : undefined}
              title={collapsed ? it.label : undefined}
              onClick={() => onNavigate && onNavigate(it.id)}>
              <span className="tk-navitem__ico"><Icon name={it.icon} size={19} /></span>
              <span className="tk-navitem__label">{it.label}</span>
              {it.badge != null && <span className="tk-navitem__badge">{it.badge}</span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function TopBar({ onToggleNav, searchPlaceholder = "Search bookings, tours, customers…", notifications = 0, notificationItems = [], onMarkAllRead, user, onSignOut, onProfile, onPreferences, children }) {
  const [menu, setMenu] = React.useState(null); // "notif" | "user" | null
  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);
  const stop = (e) => e.stopPropagation();
  const items = notificationItems.length ? notificationItems : [
    { icon: "ticket", text: "New booking TK-4821 — Accra City Tour", time: "2 min ago", tone: "pending" },
    { icon: "triangle-alert", text: "Payment failed on TK-4610", time: "1 hr ago", tone: "failed" },
    { icon: "calendar-days", text: "Cape Coast departure is 90% full", time: "3 hr ago", tone: "warning" },
  ];
  return (
    <header className="tk-topbar">
      <button type="button" className="tk-iconbtn-plain" aria-label="Toggle navigation" onClick={onToggleNav}><Icon name="menu" size={20} /></button>
      <div className="tk-topbar__search">
        <label className="tk-search" style={{ maxWidth: "none" }}>
          <Icon name="search" size={17} className="tk-search__icon" />
          <input type="search" placeholder={searchPlaceholder} aria-label="Global search" />
        </label>
      </div>
      <div className="tk-topbar__actions">
        {children}
        <div style={{ position: "relative" }} onClick={stop}>
          <button type="button" className="tk-iconbtn-plain" aria-haspopup="true" aria-expanded={menu === "notif"}
            aria-label={notifications ? notifications + " notifications" : "Notifications"} onClick={() => setMenu(menu === "notif" ? null : "notif")}>
            <Icon name="bell" size={19} />{notifications > 0 && <span className="tk-iconbtn-plain__dot" />}
          </button>
          {menu === "notif" && (
            <div className="tk-menu" role="menu" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                <strong style={{ fontSize: 13.5 }}>Notifications</strong><span className="tk-caption">{notifications} new</span>
              </div>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {items.map((n, i) => (
                  <button key={i} type="button" onClick={() => { setMenu(null); n.onClick && n.onClick(); }} style={{ display: "flex", gap: 10, padding: "11px 14px", borderTop: i ? "1px solid var(--border-subtle)" : "none", width: "100%", textAlign: "start", background: "transparent", border: 0, cursor: n.onClick ? "pointer" : "default" }}>
                    <span style={{ flex: "none", width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--" + (n.tone || "info") + "-bg)", color: "var(--" + (n.tone || "info") + "-fg)" }}><Icon name={n.icon} size={15} /></span>
                    <span style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.4 }}>{n.text}</div><div className="tk-caption" style={{ marginTop: 2 }}>{n.time}</div></span>
                    {n.unread && <span aria-label="Unread" style={{ flex: "none", alignSelf: "center", width: 8, height: 8, borderRadius: "50%", background: "var(--brand-gold-deep, var(--text-link))" }} />}
                    {n.onClick && <Icon name="chevron-right" size={14} style={{ color: "var(--text-subtle)", alignSelf: "center", flex: "none" }} />}
                  </button>
                ))}
              </div>
              <button type="button" className="tk-menu__item" disabled={!notifications} onClick={() => onMarkAllRead && onMarkAllRead()} style={{ justifyContent: "center", color: notifications ? "var(--text-link)" : "var(--text-subtle)", fontWeight: 600, borderTop: "1px solid var(--border-subtle)", cursor: notifications ? "pointer" : "default" }}>Mark all as read</button>
            </div>
          )}
        </div>
        <button type="button" className="tk-iconbtn-plain" aria-label="Help"><Icon name="info" size={19} /></button>
        <div style={{ position: "relative" }} onClick={stop}>
          <button type="button" aria-haspopup="true" aria-expanded={menu === "user"} onClick={() => setMenu(menu === "user" ? null : "user")}
            style={{ display: "flex", alignItems: "center", gap: 8, border: 0, background: "transparent", cursor: "pointer", paddingInlineStart: 6 }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--brand-wash)", color: "var(--brand-gold-deep)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13 }}>{(user && user.initials) || "TK"}</span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.1 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>{(user && user.name) || "Staff"}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{(user && user.role) || "Operator"}</span>
            </span>
            <Icon name="chevron-down" size={15} style={{ color: "var(--text-muted)" }} />
          </button>
          {menu === "user" && (
            <div className="tk-menu" role="menu" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 220 }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)" }}>{(user && user.name) || "Staff"}</div>
                <div className="tk-caption">{(user && user.email) || "staff@tripkoach.com"}</div>
              </div>
              <button type="button" className="tk-menu__item" onClick={() => { setMenu(null); onProfile && onProfile(); }}><Icon name="user" size={16} />Your profile</button>
              <button type="button" className="tk-menu__item" onClick={() => { setMenu(null); onPreferences && onPreferences(); }}><Icon name="settings" size={16} />Preferences</button>
              <button type="button" className="tk-menu__item" style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--danger-fg)" }} onClick={onSignOut}><Icon name="log-out" size={16} />Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function PageHeader({ title, subtitle, breadcrumbs = [], actions }) {
  return (
    <div>
      {breadcrumbs.length > 0 && (
        <nav className="tk-crumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((c, i) => (
            <React.Fragment key={c.label}>
              {i > 0 && <Icon name="chevron-right" size={12} />}
              {c.onClick ? <a href="#" onClick={(e) => { e.preventDefault(); c.onClick(); }}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="tk-pagehead">
        <div>
          <h1 className="tk-pagehead__title">{title}</h1>
          {subtitle && <p className="tk-pagehead__sub">{subtitle}</p>}
        </div>
        {actions && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{actions}</div>}
      </div>
    </div>
  );
}

export function AppShell({ groups, current, onNavigate, user, notifications, notificationItems, onMarkAllRead, onSignOut, onProfile, onPreferences, brand, logoSrc, topbarExtra, children }) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <div className="tk-shell" data-collapsed={collapsed}>
      <SideNav groups={groups} current={current} onNavigate={onNavigate} collapsed={collapsed} brand={brand} logoSrc={logoSrc} />
      <div className="tk-shell__main">
        <TopBar onToggleNav={() => setCollapsed(c => !c)} notifications={notifications} notificationItems={notificationItems} onMarkAllRead={onMarkAllRead} user={user} onSignOut={onSignOut} onProfile={onProfile} onPreferences={onPreferences}>{topbarExtra}</TopBar>
        <div className="tk-page">{children}</div>
      </div>
    </div>
  );
}
