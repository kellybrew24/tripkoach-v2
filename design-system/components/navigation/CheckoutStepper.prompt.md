Checkout progress. Labels show from 768px; on mobile the dots plus the live "Step 2 of 5" line carry the meaning.

```jsx
<CheckoutStepper steps={["Departure","Travellers","Review","Payment","Done"]} current={1} onStepClick={goTo} />
```
