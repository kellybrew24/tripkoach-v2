Faceted filter row that sits above a DataTable: facet dropdowns on the left, removable applied-filter chips and "Clear all" on the right. Slot a SearchField or date-range control as children.

```jsx
<FilterBar facets={[{id:"status",label:"Status",active:true,onClick:openStatus},{id:"tour",label:"Tour",onClick:openTour}]}
  applied={[{id:"pending",label:"Status: Pending",onRemove:clearStatus}]} onClear={clearAll}>
  <SearchField value={q} onChange={setQ} placeholder="Search reference or customer" />
</FilterBar>
```
