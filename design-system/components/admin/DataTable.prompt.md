The workhorse of the admin: sticky-header, sortable, selectable data table with zebra rows, density toggle, per-row actions, skeleton loading and an empty slot. Wrap in `tk-tablewrap` with a `tk-tabletools`/`tk-bulkbar` header for filters and bulk actions.

```jsx
<DataTable density="compact" selectable selected={sel} onSelectedChange={setSel}
  sort={sort} onSortChange={setSort} onRowClick={openBooking}
  columns={[
    { key:"ref", header:"Reference", strong:true, sortable:true },
    { key:"customer", header:"Customer" },
    { key:"total", header:"Amount", align:"end", sortable:true, render:r=><Price amount={r.total} currency="USD" /> },
    { key:"status", header:"Status", render:r=><StatusBadge status={r.status} /> },
  ]}
  rows={rows} getRowId={r=>r.ref}
  rowActions={r=><IconButton icon="ellipsis" label="Row actions" variant="ghost" size="sm" />} />
```

Column headers are real buttons when sortable (aria-sort reflects state). Checkbox cells stop row-click propagation. Keep the primary identifier in the `strong` column so scanning is fast.
