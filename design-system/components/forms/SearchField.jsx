import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function SearchField({ id = "search", value = "", onChange, onClear, placeholder = "Search tours, regions, experiences", ...rest }) {
  return (
    <div className={["tk-input-group", value && "tk-input-group--trail"].filter(Boolean).join(" ")} role="search">
      <span className="tk-input-group__lead"><Icon name="search" size={18} /></span>
      <input id={id} type="search" className="tk-input" value={value} onChange={onChange}
        placeholder={placeholder} aria-label="Search tours" style={{ paddingInlineStart: "var(--space-10)" }} {...rest} />
      {value && (
        <span className="tk-input-group__trail">
          <button type="button" className="tk-iconbtn" onClick={onClear} aria-label="Clear search"><Icon name="x" size={18} /></button>
        </span>
      )}
    </div>
  );
}
