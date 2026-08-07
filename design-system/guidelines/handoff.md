# Hand-off notes

## Two surfaces, one system
This design system spans a **customer app** and a **staff admin console**. They are one product: same
`styles.css`, same token layer, same primitives. The relationship:

- The customer surface is **mobile-first** (design at 390px, verify at 768/1280). The admin surface is
  **desktop-first** app-shell (`AppShell`: dark left nav + top bar + max-1440 content), degrading to a
  collapsed icon rail below 960px.
- The admin adds a **compact type scale** (`--text-dense-*`, `--text-kpi-*`) and **table-neutral tokens**
  (`--table-*`, `--shell-*`, `--chart-*`) in `tokens/admin.css`, plus `css/admin.css` for the shell, data
  table, drawer, KPI, media manager, role matrix and timeline. Nothing here overrides the customer layer.
- **Status colour is shared and authoritative on both surfaces.** A Pending badge (gold), Confirmed (green),
  Cancelled (neutral), Paid/Failed/Refunded look and mean the same in a customer's bookings list and in the
  operator's data table — they render from the same `--status-*` tokens and the same `StatusBadge`.
- Reused primitives on the admin: `StatusBadge`, `Price`/`formatMoney`, `FormField`+inputs, `Modal`, `Toast`,
  `Alert`, `Tabs`, `Badge`, `Button`, `Icon`, `EmptyState`, `BookingRow`. Admin-only components live in
  `components/admin/`.
- Both surfaces honour the same dark theme (`[data-theme="dark"]`); the admin nav rail stays dark regardless.

## How the pieces fit
`styles.css` → `tokens/*` (custom properties) → `css/*` (component classes) → `components/*` (React, className only).
Components never hard-code a colour, size or duration; they reference semantic tokens. Semantic tokens
reference palette tokens. Re-theming means overriding the semantic layer only.

## Naming conventions
- CSS classes: `tk-<block>__<element>--<modifier>` (`tk-btn--primary`, `tk-summary__line`).
- Tokens: `--<concern>-<role>` for semantics (`--action-primary-bg`, `--status-pending-fg`), `--<hue>-<step>`
  for palette (`--gold-600`).
- Components: PascalCase named exports; props are camelCase; state props take the union of the real states
  (`status="pending" | "confirmed" | …`) rather than booleans.

## Theming
Light is the default on `:root`. Dark is a single scope, `[data-theme="dark"]`, that redefines the semantic
layer only. To brand a partner or a future country, override the semantic block — no component changes.

## Currency and localisation
- **GHS is the currency of record.** Prices are stored and charged in Ghana cedis. `formatMoney` renders
  `GH₵` plus `toLocaleString`, integer cedis (no pesewa decimals) — change `decimals` if pesewas are needed.
- USD is display-only and always marked "≈ … approximate". The conversion rate used in the kits is a
  placeholder (GH₵15.6 = $1) — wire it to a real rate service with a timestamp before shipping.
- `CurrencyToggle` changes display only; checkout always states the GHS charge amount.
- Copy is UK-leaning English ("traveller", "cancelled"). Strings are not extracted yet; when localisation
  starts, note that Twi and Ga run longer than English — the layouts leave room but the badges do not.

## Assumptions made (please confirm)
1. **Payment deadline** is "5 days before departure", and free cancellation ends 7 days before. Both are
   invented placeholders that appear in copy and policy blocks.
2. **Pay-later instructions** name bank transfer and mobile money to "TripKoach Ltd, 024 555 0100". Real
   payment instructions must replace this string everywhere it appears.
3. **Booking reference format** is `TK-####`.
4. **Booking fees / taxes** are shown as optional lines in `OrderSummary` but are zero in every example — we
   assumed prices are all-inclusive.
5. **Promo codes** are designed but flagged off; `PromoCode` renders collapsed until a discount engine exists.
6. **Ratings** come from reviews; below 3 reviews we hide the rating entirely rather than show a thin average.
7. **Font**: Manrope from Google Fonts. No font files were supplied — if TripKoach has a brand typeface, send
   the files and we will swap the token. Manrope is loaded via a Google Fonts `@import`; self-host a latin
   subset before launch to avoid a third-party round trip on slow connections.
8. **Icons**: Lucide, substituted because no icon set was supplied.
9. **Imagery**: all photography is placeholder. We need real tour photos (3:2 and 16:10 crops, WebP, ≤120KB
   for cards) before this system can be judged visually.
10. **9 regions** are listed from the brief; the region list in `data.js` is a guess at names.

## Open questions
- What are the real pay-later instructions and deadline?
- Is there a booking fee, and is VAT shown separately?
- Do you want a Twi or Ga language option in v1?
- Should sold-out departures be hidden after the date passes, or kept with a "next departure" prompt?
- When Paystack goes live, is mobile money a separate payment mode or part of the Paystack sheet?
- Do you have a brand typeface, or is Manrope acceptable as the permanent choice?
