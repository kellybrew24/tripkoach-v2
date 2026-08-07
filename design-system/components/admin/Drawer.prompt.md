Right-side sheet for quick detail/edit without leaving the list. Closes on Escape or scrim click; footer sticks for save/cancel. For long, section-heavy edits (a whole tour) prefer a full-page form instead.

```jsx
<Drawer open={open} title="Booking TK-4821" subtitle="Confirm or cancel" onClose={close}
  footer={<><Button variant="secondary" onClick={close}>Close</Button><Button onClick={confirm}>Confirm booking</Button></>}>
  {/* detail content */}
</Drawer>
```
