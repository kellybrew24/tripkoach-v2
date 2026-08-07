Vertical status-change / activity history for a booking or record. Each event has a typed icon, an actor and a timestamp.

```jsx
<AuditTimeline events={[
  {type:"created",text:"Booking created via website",actor:"System",time:"22 Aug, 09:14"},
  {type:"confirmed",text:"Marked <strong>Confirmed</strong>",actor:"Kofi A.",time:"22 Aug, 10:02",tone:"success"},
  {type:"email",text:"Confirmation email resent",actor:"Ama O.",time:"22 Aug, 10:03"},
]} />
```
