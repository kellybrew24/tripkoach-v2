import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function ErrorSummary({ title = "Check these before continuing", errors = [] }) {
  const ref = React.useRef(null);
  React.useEffect(() => { if (errors.length && ref.current) ref.current.focus(); }, [errors.length]);
  if (!errors.length) return null;
  return (
    <div className="tk-errsummary" role="alert" tabIndex={-1} ref={ref}>
      <strong style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--danger-fg)" }}>
        <Icon name="circle-alert" size={18} />{title}
      </strong>
      <ul>
        {errors.map((e) => <li key={e.id}><a href={`#${e.id}`}>{e.message}</a></li>)}
      </ul>
    </div>
  );
}
