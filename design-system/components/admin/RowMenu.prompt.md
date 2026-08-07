The three-dots row-action menu for DataTable rows. Pass `items` (label, icon, onClick, `danger` for destructive, `divider` for a separator). Handles open/close, outside-click, Escape, and stops row-click propagation so opening the menu doesn't trigger the row.

```jsx
<RowMenu label={"Actions for " + r.ref} items={[
  { label: "View details", icon: "eye", onClick: () => open(r) },
  { label: "Resend confirmation", icon: "mail", onClick: () => resend(r) },
  { divider: true },
  { label: "Cancel booking", icon: "x", danger: true, onClick: () => cancel(r) },
]} />
```
