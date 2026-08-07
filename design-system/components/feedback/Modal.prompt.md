Focus-trapping dialog for decisions that must not be missed — cancelling a booking above all.

```jsx
<Modal open tone="danger" title="Cancel this booking?"
  description="Your 4 spots on 12 Sep will be released. Free cancellation ends 5 Sep."
  actions={<><Button variant="secondary">Keep booking</Button><Button variant="danger">Yes, cancel</Button></>} />
```

Escape and scrim click close. The destructive button never carries the default focus.
