# Transactional email spec

One email is sent today: **booking created**. It renders in Gmail Android, Gmail web, Outlook and Apple Mail.

## Rules
- 600px table layout, single column, no flexbox or grid, no external CSS.
- System font stack only — no webfont. Manrope is not loaded in email.
- Colours are hard-coded hex copies of the tokens (email cannot read CSS custom properties):
  ink `#1E1C1A`, paper `#FFFFFF`, page `#F1EDE6`, muted `#6F675E`, pending `#8A4E0F` on `#FDF7EE` with `#F2D5A5` border.
- Status is stated in words as well as colour; the pending block repeats the payment instruction in full because
  many recipients never open the app.
- One primary button ("View this booking") as a padded anchor, ≥44px tall.
- Logo is the badge PNG at 36px with real alt text. No background images.
- Total appears twice: as a line item and as "Total due", always with the GHS symbol and the approximate USD note.

## Hierarchy
1. Reassurance headline ("Your spot is reserved, Ama")
2. Status + how to pay (the one thing that needs action)
3. Reference and booking facts
4. Primary action
5. What happens next (3 steps)
6. Change/cancel and contact
7. Legal footer with currency statement

## Future variants
Confirmed (payment received, green block, receipt lines) · Cancelled (neutral block, no action) ·
Payment failed (red block, retry link) · Departure reminder (48 hours before).
