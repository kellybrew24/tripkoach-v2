The single source of truth for how a booking or payment state is worded and coloured — never re-label these.

```jsx
<StatusBadge status="pending" withHint />
```

Pending = gold (we are waiting on the customer). Confirmed/Paid = green. Cancelled = neutral, not red — a cancellation is not an error. Failed = red.
