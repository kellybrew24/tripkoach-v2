import React from "react";
import { Icon } from "../icons/Icon.jsx";

export function DataTable({
  columns = [], rows = [], getRowId = (r) => r.id, density = "default", zebra = true,
  sort, onSortChange, selectable = false, selected = [], onSelectedChange,
  rowActions, onRowClick, loading = false, skeletonRows = 6, empty,
}) {
  const allSel = selectable && rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => onSelectedChange && onSelectedChange(allSel ? [] : rows.map(getRowId));
  const toggleOne = (id) => onSelectedChange && onSelectedChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const setSort = (key) => { if (!onSortChange) return; const dir = sort && sort.key === key && sort.dir === "asc" ? "desc" : "asc"; onSortChange({ key, dir }); };

  if (!loading && rows.length === 0 && empty) return <div className="tk-tablewrap" style={{ padding: 8 }}>{empty}</div>;

  return (
    <div className="tk-table-scroll">
      <table className="tk-table" data-density={density} data-zebra={zebra}>
        <thead>
          <tr>
            {selectable && <th className="tk-checkcell"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all rows" /></th>}
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align === "end" ? "end" : "start", width: c.width }}
                aria-sort={sort && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : (c.sortable ? "none" : undefined)}
                onClick={c.sortable ? () => setSort(c.key) : undefined}>
                {c.header}{c.sortable && <span className="tk-sortmark"><Icon name={sort && sort.key === c.key && sort.dir === "desc" ? "chevron-down" : "chevron-up"} size={12} /></span>}
              </th>
            ))}
            {rowActions && <th className="tk-rowkebab" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr className="tk-skelrow" key={i} aria-hidden="true">
                  {selectable && <td className="tk-checkcell" />}
                  {columns.map((c) => <td key={c.key}><span className="tk-skeleton" style={{ display: "block", height: 12, borderRadius: 4 }} /></td>)}
                  {rowActions && <td />}
                </tr>
              ))
            : rows.map((r) => {
                const id = getRowId(r);
                return (
                  <tr key={id} data-selected={selected.includes(id)} onClick={onRowClick ? () => onRowClick(r) : undefined} style={{ cursor: onRowClick ? "pointer" : undefined }}>
                    {selectable && <td className="tk-checkcell" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(id)} onChange={() => toggleOne(id)} aria-label={"Select row " + id} /></td>}
                    {columns.map((c) => (
                      <td key={c.key} className={[c.align === "end" ? "tk-num" : "", c.strong ? "tk-td-strong" : ""].join(" ")}>
                        {c.render ? c.render(r) : r[c.key]}
                      </td>
                    ))}
                    {rowActions && <td className="tk-rowkebab" onClick={(e) => e.stopPropagation()}>{rowActions(r)}</td>}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {loading && <span className="tk-sr-only" role="status">Loading rows</span>}
    </div>
  );
}
