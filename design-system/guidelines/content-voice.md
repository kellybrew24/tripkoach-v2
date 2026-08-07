# Content and voice

## Principles
Warm, plain, specific. Say what happens, what it costs, and what to do next. Never sell at the reader, never
manufacture urgency, never leave a number without its currency.

Second person and active voice. Sentence case everywhere. No exclamation marks, no emoji.

## CTA labels
| Context | Label |
| --- | --- |
| Tour card | View · Book |
| Tour detail, nothing selected | Select a departure |
| Tour detail, departure selected | Reserve my spot |
| Wizard steps 1–3 | Continue |
| Wizard payment step | Confirm booking |
| Confirmation | View in my bookings · Save details · Browse more tours |
| Booking detail | Download details · Cancel booking |
| Cancel dialog | Keep booking · Yes, cancel |
| Auth gate | Log in · Create an account |
| Empty results | Clear filters |

## Form labels, placeholders, helper text
- Full name — placeholder "Ama Mensah" — help "As it appears on your ID"
- Email address — placeholder "you@example.com" — help "We send your booking confirmation here"
- Phone number — prefix "GH +233", placeholder "24 123 4567" — help "For urgent updates about your departure"
- Password — help is a live checklist: "8+ characters", "A letter", "A number"
- Special requests (optional) — placeholder "Anything we should know? Dietary needs, mobility, celebrations…"
- Promo code — placeholder "HARMATTAN10"
- Optional fields are marked "(optional)"; required fields are not marked, except on forms that are mostly optional.

## Validation and error messages
| Situation | Message |
| --- | --- |
| Empty required name | Enter a name for traveller 3 |
| Bad email | Enter a valid email address |
| Wrong credentials | That email and password do not match. Check them and try again, or reset your password. |
| Email already registered | That email is already registered — log in instead |
| Weak password | Use at least 8 characters, with a letter and a number |
| Too many travellers | Only 3 spots are left on this departure |
| Invalid promo | That code is not valid or has expired. |
| Card declined | Your bank turned down the charge. Try another card, or switch to pay later — your spots are still held. |
| Server error | Something went wrong on our side. Nothing was charged and no booking was made. Please try again in a moment. |
| Offline | You are offline. Showing tours saved on this device. Prices may have changed. |
| Error summary heading | Check these before continuing |

## Pay-later explanation
> **Nothing is charged today.** Your booking is held as Pending. Pay by bank transfer or mobile money to
> TripKoach Ltd, 024 555 0100, quoting your reference, at least 5 days before departure. We confirm within one
> working day.

Short form for the order summary: "You will be charged GH₵1,800 when you pay. Nothing is taken today."
Pay-now short form: "You will be charged GH₵1,800 now."

## Booking status descriptions
| Status | Badge | One-line description |
| --- | --- | --- |
| Pending | Pending | Awaiting payment — your spots are held |
| Confirmed | Confirmed | Your spot is held and paid for |
| Cancelled | Cancelled | No longer active. Nothing is owed |
| Paid (future) | Paid | Payment received |
| Payment failed (future) | Payment failed | We could not take payment. Your spots are still held |
| Refunded (future) | Refunded | Money returned to your original payment method |

## Cancellation and refund phrasing
> Free cancellation until 7 days before departure. Between 7 and 2 days, half the total is held. Inside
> 48 hours the booking is non-refundable.

While payments are off: "Nothing has been charged, so cancelling now costs you nothing."
When payments go live, append: "Refunds reach your account within 5 to 10 working days."

## Confirmation copy
Headline "Your spot is reserved" (pay later) or "You're all set" (paid).
Subtitle names the tour, the date and the email it was sent to.
Next steps are always three numbered lines: pay, we confirm, your guide calls the day before.

## Empty states
- No results — "No tours match those filters" / "Try widening the price range or clearing a region — there are 12 tours running this month."
- No bookings — "No bookings yet" / "When you reserve a tour it shows up here, with your reference and what to pay."
- 404 — "We cannot find that page" / "The link may be old, or the tour may no longer run."
- Offline — "You are offline" / "We will load your bookings as soon as you are back on a connection."

## Currency wording
Primary is always Ghana cedis: `GH₵1,800`. A converted figure is always prefixed "≈", suffixed "USD", and
paired with the sentence "approximate. You will be charged in Ghana cedis." Never show USD alone on a
checkout or confirmation screen.
