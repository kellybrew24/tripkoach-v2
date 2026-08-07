import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function PasswordInput({ id, rules = [], ...rest }) {
  const [show, setShow] = React.useState(false);
  return (
    <>
      <div className="tk-input-group tk-input-group--trail">
        <input id={id} className="tk-input" type={show ? "text" : "password"} autoComplete="new-password" {...rest} />
        <span className="tk-input-group__trail">
          <button type="button" className="tk-iconbtn" onClick={() => setShow(!show)}
            aria-pressed={show} aria-label={show ? "Hide password" : "Show password"}>
            <Icon name={show ? "eye-off" : "eye"} size={18} />
          </button>
        </span>
      </div>
      {rules.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {rules.map((r) => (
            <li key={r.label} className="tk-help" style={{ display: "flex", gap: 4, alignItems: "center", color: r.met ? "var(--success-fg)" : "var(--text-muted)" }}>
              <Icon name={r.met ? "check" : "minus"} size={12} />{r.label}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
