# Mobile app UI kit

The primary TripKoach surface: a 390px Android screen, the device most customers in Ghana book on.
`index.html` is a click-through of the whole journey — pick a screen on the right, toggle states with the chips.

## Screens
| Screen | File | Covers |
| --- | --- | --- |
| Browse | `screens-browse.jsx` | catalogue grid, search, filter sheet, active-filter chips, sort, results count, pagination, skeleton, no-results, offline banner |
| Tour detail | `screens-tour.jsx` | gallery, highlights, itinerary/includes/meeting point/policy accordion, departure picker, sticky booking bar |
| Auth | `screens-auth.jsx` | sign-in interstitial that preserves the booking, log in (with wrong-credentials error), sign up (with email-taken error and live password rules), complete profile |
| Checkout | `screens-checkout.jsx` | 5-step wizard — Departure, Travellers, Review, Payment, Done — with stepper, back-navigation, per-step validation, persistent price summary, pay-later default, confirmation |
| Bookings | `screens-bookings.jsx` | list with status tabs, loading, empty, booking detail, cancellation policy, destructive cancel dialog, cancelled state, toast, account dashboard, 404 / offline / server error |

## Notes
- Every screen composes published components from the design system; nothing is re-implemented locally.
- Data lives in `data.js` so screens stay presentational.
- The device bezel comes from `android-frame.jsx` (starter component) and is not part of the design system.
