Lightweight token-styled SVG charts (line, bar, donut) for the dashboard — no charting library. Always pass ariaLabel describing the trend; the donut legend prints values so meaning never rests on colour.

```jsx
<MiniChart type="line" ariaLabel="Bookings up over the last 7 days" data={[{label:"Mon",value:6},{label:"Tue",value:9}]} />
<MiniChart type="donut" ariaLabel="Bookings by status" data={[{label:"Confirmed",value:82},{label:"Pending",value:41}]} />
```
