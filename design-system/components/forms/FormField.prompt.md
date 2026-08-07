Wraps any control with its label, helper text and inline error, and wires the ARIA between them.

```jsx
<FormField id="email" label="Email address" help="We send your booking confirmation here" error={errors.email}>
  <Input type="email" name="email" placeholder="you@example.com" />
</FormField>
```

Errors are specific and actionable: "Enter a date of birth for traveller 2", never "Invalid input".
