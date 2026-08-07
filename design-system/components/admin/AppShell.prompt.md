The admin app frame: collapsible grouped left nav on ink, sticky top bar with global search / notifications / user menu, and a max-1440 content area. `PageHeader` gives every page a breadcrumb, title and primary-action slot.

```jsx
<AppShell groups={NAV_GROUPS} current="bookings" onNavigate={go} user={{name:"Kofi A.",role:"Operator",initials:"KA"}} notifications={3}>
  <PageHeader title="Bookings" subtitle="142 total" breadcrumbs={[{label:"Home",onClick:goHome},{label:"Bookings"}]}
    actions={<Button size="sm" iconStart="download">Export</Button>} />
  {/* page content */}
</AppShell>
```

Below 960px the nav auto-collapses to icons. The nav rail is always dark, independent of the light/dark content theme, so operators can find it instantly.
