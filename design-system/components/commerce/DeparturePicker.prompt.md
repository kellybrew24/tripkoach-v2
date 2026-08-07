Choose from the scheduled departures of a tour. Deliberately not a calendar: travellers pick from what actually runs.

```jsx
<DeparturePicker departures={departures} value={sel} onChange={setSel} />
```

Sold-out rows stay visible but disabled so the list does not shift; date and price stay legible at 4.5:1.
