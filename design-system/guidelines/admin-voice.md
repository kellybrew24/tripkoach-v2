# Admin voice & microcopy

The customer voice reassures; the **admin voice is efficient**. Staff use this console all day for
repetitive, sometimes high-stakes work. Copy is clear, concise, action-oriented, and jargon-free. State
what a control does and what will happen — especially before anything destructive.

## Principles
- **Verb-first, specific.** "Confirm booking", "Cancel departure", "Add departure", "Send invite" — never "Submit" or "OK".
- **Consequences before confirmation.** Destructive dialogs lead with what changes: "This releases 4 spots on Sat 12 Sep and emails the customer."
- **Numbers are exact.** "5 pending", "71% capacity", "2 over 24h" — no "several" or "a lot".
- **Neutral, not chirpy.** No exclamation marks, no praise for routine actions. A quiet toast is enough.
- **Name the actor and time** in history: "Marked Confirmed · Kofi A. · 22 Aug, 10:02".

## Table headers
Short nouns, Title case off: Reference, Customer, Tour, Departure, Pax, Amount, Booking, Payment, Created,
Capacity, Left, Status, Role, Last active. Prefer "Pax" and "Left" in dense tables where space is tight.

## Buttons & actions
| Context | Label |
| --- | --- |
| Pending booking | Confirm booking · Cancel booking |
| Confirmed booking | Resend confirmation · Cancel booking |
| Tour list | Create tour · (row) Departures · Delete |
| Tour editor | Save changes / Create tour · Discard |
| Departure | Add departure · Adjust capacity · Cancel departure |
| Payments | Mark paid · Issue refund · Export for reconciliation |
| Promo codes | New promo code · Save code |
| Staff | Invite staff · Send invite |
| Bulk bar | Export · Resend confirmation · Clear |

## Destructive-dialog language
- **Cancel booking:** "Cancel booking TK-4821? This releases 4 travellers on Sat 12 Sep. The customer is emailed automatically." Require a reason (recorded in history).
- **Cancel departure:** "Cancel this departure? Accra City Tour on Sat 22 Aug has 4 booked travellers." Warn: "All 4 bookings will be marked for cancellation and the customers emailed."
- **Delete tour:** "Delete Accra City Tour? This removes the tour and its departures from the catalogue. Existing bookings are kept but it can no longer be booked. Consider setting it to Draft instead."
- Confirm buttons restate the verb ("Yes, cancel booking", "Delete tour"); the safe choice is always the secondary button and comes first.

## Status descriptions (admin)
| State | Meaning shown to staff |
| --- | --- |
| Pending | Awaiting payment — spots are held |
| Confirmed | Paid or manually confirmed — spot secured |
| Cancelled | Closed; spots released. Reason recorded |
| Paid / Unpaid | Payment received / still outstanding (pay-later) |
| Failed | A charge attempt was declined — needs review |
| Refunded | Money returned to the customer |
| Departure: Scheduled / Nearly full / Sold out | Bookable / ≥90% capacity / at capacity |
| Staff: Active / Invited / Disabled | Can sign in / invite sent, not yet accepted / access revoked |

## Empty, loading, error, permission states
- **Empty (list):** name the thing and the first action. "No promo codes / Create a code to run a seasonal discount."
- **Empty (dashboard):** "No activity yet / Once tours are published and bookings come in, this fills with today's numbers."
- **Loading:** skeleton rows/cards; announce "Loading rows" to screen readers. Never a blocking spinner on a full page.
- **403 permission denied:** "You don't have access to this / This area needs a permission your role doesn't have. Ask an administrator." Offer "Back to dashboard".
- **Session expired:** "Your session expired / For security, we sign staff out after 30 minutes of inactivity. Nothing you saved was lost."
- **Sign-in failed:** say attempts remaining; on lockout: "Account temporarily locked / Try again in 15 minutes, or contact an administrator."

## Toasts
Past-tense, factual, dismissible: "Booking TK-4821 confirmed", "Tour saved", "Invite sent", "Departure cancelled — 4 bookings flagged for refund". No emoji, no "Success!".
