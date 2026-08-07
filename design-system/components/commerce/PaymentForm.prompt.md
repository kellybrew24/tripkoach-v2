Payment step of checkout. Because payments run entirely through **Paystack**, this form collects **no card details** — TripKoach never sees or stores them (a PCI-scope and trust decision). Pay-now is a hosted-redirect hand-off to Paystack's secure checkout; pay-later holds the booking as Pending and emails instructions.

```jsx
<PaymentForm mode={mode} onModeChange={setMode} payNowEnabled amountLabel="$300" dueBy="5 days before departure" />
```

The `state` prop drives the hand-off UI: `idle` shows the Paystack panel, `processing` shows an "Opening Paystack…" spinner (set this while you create the transaction and redirect), `succeeded`/`failed` show the result banner on return. Failure copy always reassures ("Nothing was charged, your spots are still held"). The checkout's Pay button owns the actual redirect — label it "Pay <amount>" and open Paystack on click. Never add card `<input>`s here.
