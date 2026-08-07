Loading placeholder that mirrors the real layout so nothing shifts when data lands.

```jsx
<Skeleton height={180} radius="var(--radius-card)" />
<Skeleton lines={3} height={12} />
```

Always pair with an aria-busy region and a visually hidden "Loading tours" status.
