The standard TripKoach action; one primary per screen, everything else secondary or ghost.

```jsx
<Button variant="primary" size="lg" block iconEnd="arrow-right">Continue to travellers</Button>
<Button variant="secondary">Back</Button>
<Button variant="danger" loading>Cancel booking</Button>
```

Labels are verbs that name the outcome ("Reserve my spot", not "Submit"). Destructive actions always sit behind a confirm dialog.
