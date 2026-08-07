Every price in TripKoach renders through this component; it guarantees the symbol, the code and the per-person/total qualifier are never dropped.

```jsx
<Price amount={450} unit="per person" from />
<Price amount={1800} size="lg" unit="total" approxAmount={115} srPrefix="Total" />
<Price amount={1620} was={1800} unit="total" />
```

Rule: the charge currency (GHS) is always the large number. A USD figure is only ever the small approximate line.
