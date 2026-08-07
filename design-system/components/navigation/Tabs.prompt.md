Horizontal, scrollable filter tabs — booking status filters, tour detail sections.

```jsx
<Tabs value={tab} onChange={setTab} tabs={[{id:"all",label:"All",count:6},{id:"pending",label:"Pending",count:2}]} />
```

Arrow keys move between tabs, Home/End jump to the ends; the panel gets role="tabpanel" and tabIndex={0}.
