import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function Pagination({ page = 1, pages = 1, onChange, resultsLabel }) {
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <nav aria-label="Pagination" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap" }}>
      {resultsLabel && <p className="tk-caption" aria-live="polite">{resultsLabel}</p>}
      <div className="tk-pagination">
        <button className="tk-page" disabled={page === 1} onClick={() => onChange && onChange(page - 1)} aria-label="Previous page"><Icon name="chevron-left" size={16} /></button>
        {nums.map((n, i) => n === "…"
          ? <span key={"e" + i} className="tk-caption" style={{ padding: "0 4px" }}>…</span>
          : <button key={n} className="tk-page" aria-current={n === page ? "page" : undefined}
              aria-label={"Page " + n} onClick={() => onChange && onChange(n)}>{n}</button>)}
        <button className="tk-page" disabled={page === pages} onClick={() => onChange && onChange(page + 1)} aria-label="Next page"><Icon name="chevron-right" size={16} /></button>
      </div>
    </nav>
  );
}
