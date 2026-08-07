A single KPI tile for the dashboard: label, big tabular value, optional delta with direction. Lay several in a responsive grid.

```jsx
<StatCard label="Bookings this week" value="38" icon="ticket" delta="+12%" deltaDir="up" hint="vs last week" />
<StatCard label="Expected revenue" value="$24,180" icon="wallet" delta="+8%" deltaDir="up" />
```

Direction colour (green up / red down) is backed by an arrow icon so meaning never rests on colour alone.
