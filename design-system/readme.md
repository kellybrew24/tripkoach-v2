# TripKoach Design System

TripKoach is a travel and tour company based in Accra, Ghana. Customers discover guided tours across Ghana's
regions, pick a scheduled departure, and book spots for one or more travellers. v1 covers **Ghana only —
9 explored regions**; the token and content layers are built so more countries, currencies and languages can be
added without a redesign.

The product is **heavily mobile-first**: the primary customer is on a mid- or low-end Android phone in Ghana or
West Africa, often on a metered or slow connection. Performance is a design constraint, not an optimisation
pass — one webfont, system-font fallback, lazy images with reserved boxes, cheap motion, and graceful
offline states. Desktop is fully supported but secondary.

**Real money is involved.** Booking and payment status must never be ambiguous, and a customer must always be
able to answer "what will I be charged, in which currency, and when?" from whatever screen they are on.

## Sources used

| Source | What it gave us |
| --- | --- |
| Written brief (TripKoach, product + brand) | Flow inventory, business rules (pay-later, Paystack sandbox, GHS/USD), tone, audience, accessibility bar |
| `uploads/logo-badge.png` (supplied, 160×145) | The only brand asset. Circular badge, charcoal `#303030`, gold star accents `#D08028`. Copied to `assets/logo-badge.png` |

No codebase, Figma file or existing UI was provided, so the component inventory below was authored from the
brief's Section 5 list. Colour, type and spacing systems are derived from the badge plus accessible defaults —
every assumption is recorded in `guidelines/handoff.md`.

---

## Visual foundations

**Colour.** Two brand colours, both taken from the badge: **ink** `#1E1C1A` (a warm near-black, not pure grey)
and **Kente gold** `#D08028`. Ink carries every primary action, heading and the footer; gold is the accent —
ratings, the active-nav underline, pending status, the empty-state mark, and a deep `#AE6413` variant when gold
needs to be a button. Neutrals are warm-tinted throughout (`#FDFBF8` page, `#F8F5F0` subtle, `#E4DFD6` border);
there is no blue-grey anywhere in the system. Semantic colours are green `#0E6E52`, amber-gold `#AE6413`,
red `#B3261E`, blue `#1A5F8A`, each with a matching 50-level wash and 200-level border. A **dark theme** ships
under `[data-theme="dark"]`, where gold-300 becomes the action colour.

**Status colour is a system, not decoration.** Gold = we are waiting on the customer (Pending). Green = settled
(Confirmed, Paid). Neutral grey = closed without fault (Cancelled — a cancellation is not an error, so it is
never red). Red = something went wrong (Payment failed). Blue = informational money movement (Refunded).

**Type.** One webfont: **Manrope** (variable, weights 400–800), with a system stack fallback that renders
immediately if the font is slow. Headings are 700–800 with tight negative tracking (−0.02 to −0.03em); body is
400/16px with 1.56 line-height and a 16px floor. Prices use `tabular-nums` so columns align, and money is set
in 800 weight — the number is the loudest thing on a booking screen after the page title.

**Spacing and shape.** 4px base scale, named steps. Radii: 10px controls, 14px cards, 20px sheets, pills for
badges and chips. Cards are white on warm paper with a 1px `#E4DFD6` border **and** a barely-there shadow
(`0 1px 2px rgba(30,28,26,.06)`) — the border does the work, the shadow adds warmth. Shadows are brown-black,
never blue-black, and never more than two layers.

**Backgrounds and imagery.** Flat colour, no gradients, no patterns, no textures. The only large colour field
is the gold-50 wash behind the web hero and the ink footer. Photography carries all the atmosphere: real places,
real guides, warm natural daylight, 3:2 in cards and 16:10 in heroes, always in a fixed box so nothing reflows
on a slow connection. No heavy filters, no cool grading, no stock-looking crowds.

**Motion.** 120ms for hover and press, 180ms for toggles and sheets, 260ms for toasts and modals; one easing
curve (`cubic-bezier(.2,.6,.2,1)`) for almost everything. Only opacity and small translates are animated —
never layout, never shadow. `prefers-reduced-motion` zeroes every duration globally.

**Interaction states.** Hover darkens ink buttons one step and tints ghost buttons with `--n-100`; secondary
buttons also darken their border. Press scales to 0.985 and darkens again — no colour inversion, no bounce.
Focus is a 3px solid ink ring at 2px offset (gold-300 on dark), applied through `:focus-visible` so mouse users
never see it and keyboard users always do. Disabled controls go to `--n-100` on `--n-400` and keep their size.
Selected cards (departures, payment mode) draw a 1px inset ink ring rather than changing colour.

**Transparency and blur.** Used in exactly two places: the modal scrim (`rgba(30,28,26,.60)`) and chip overlays
on photography. No frosted glass — it is expensive on low-end GPUs.

**Layout.** Mobile-first. Design at 390px; breakpoints at 480 / 768 / 1024 / 1280. Container maxes at 1200px.
Fixed elements: sticky header (56px mobile, 72px desktop), sticky bottom nav (64px), sticky booking/checkout bar
(76px) — all safe-area aware. Every tap target is at least 44×44.

---

## Content fundamentals

Warm, plain, and specific. TripKoach writes the way a good guide talks: it tells you what will happen, what it
costs, and what to do next, without selling at you.

- **Second person, active voice.** "Your spot is reserved." "We will email you payment instructions."
  The company is "we"; the customer is "you".
- **Sentence case everywhere** — buttons, labels, headings, badges. Uppercase is reserved for the overline
  style and status codes.
- **Buttons name the outcome**, never the mechanism: "Reserve my spot", "Confirm booking", "Yes, cancel",
  "View in my bookings". Never "Submit", "OK", "Click here".
- **No exclamation marks, no emoji, no exotic punctuation.** Warmth comes from what is said, not from tone marks.
- **Money is always explicit.** "GH₵1,800 total", "GH₵450 per person", "≈ $115 USD, approximate. You will be
  charged in Ghana cedis." Never a bare number.
- **Errors say what to do**: "Enter a name for traveller 3", not "Invalid input". Failures reassure first when
  money is involved: "Nothing was charged and no booking was made."
- **Reassurance before instruction** on money screens: "Nothing is charged today" comes before the how-to-pay
  detail.
- **No manufactured urgency.** "3 spots left" appears only when three spots are genuinely left.
- **Ghanaian, not exoticised.** Places, guides and foods are named plainly — "red red and grilled tilapia at
  Hans Cottage", "Kente weaving at Bonwire". No "vibrant", no "hidden gem", no drum emoji.

Full microcopy set, including every validation message and the pay-later explanation, is in
`guidelines/content-voice.md`.

---

## Iconography

**Lucide** outline icons, 2px stroke, round caps, 24px grid — copied into `assets/icons/` as SVG files (50 of
them) and inlined as a path registry in `components/icons/Icon.jsx` so they inherit `currentColor`.
This is a **substitution**: the brief supplied no icon set. Lucide was chosen for its light stroke weight,
which matches the badge's thin line work, and its tiny per-icon cost. Flag for the team: swap in your own set
by replacing the registry.

Rules: icons are 16px in dense meta rows, 18–20px inline with text, 20–22px in navigation. They always sit
beside a text label except in `IconButton`, which requires an accessible name. Decorative icons are
`aria-hidden`. **No emoji anywhere** — rendering is inconsistent across Android versions and it undercuts the
credibility a payment product needs. No unicode symbols as icons, except the arrow-free "≈" in approximate
prices and "−" in discount lines.

---

## Index

| Path | What is in it |
| --- | --- |
| `styles.css` | The single entry point consumers link. Nothing but `@import` lines |
| `tokens/` | `fonts`, `palette`, `semantic` (light + dark), `typography`, `spacing`, `radius`, `elevation`, `motion`, `layout`, `zindex` |
| `css/` | Component stylesheets: `base`, `buttons`, `forms`, `cards`, `feedback`, `nav`, `commerce` |
| `components/` | React primitives, grouped by concern (below) |
| `ui_kits/mobile-app/` | Click-through of the whole journey on a 390px Android screen |
| `ui_kits/web/` | Desktop equivalents at 1280px, plus landing page, blog and content pages |
| `ui_kits/admin/` | The staff **admin console** — desktop app-shell: auth+MFA, dashboard, bookings, tours, departures, customers, payments, promos, staff & roles, settings |
| `ui_kits/email/` | Booking-confirmation email and its spec |
| `guidelines/` | Specimen cards plus `accessibility.md`, `content-voice.md`, `admin-voice.md`, `handoff.md` |
| `assets/` | `logo-badge.png` and `icons/` (50 Lucide SVGs) |
| `SKILL.md` | Agent-skill entry point |

### Components

**actions** — `Button`, `IconButton`, `Spinner`
**forms** — `FormField`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `NumberStepper`,
`PasswordInput`, `PhoneInput`, `SearchField`, `ErrorSummary`
**data-display** — `Badge`, `StatusBadge`, `AvailabilityBadge`, `Chip`, `Rating`, `Skeleton`, `EmptyState`
**commerce** — `Price` (+ `formatMoney`, `CURRENCIES`), `CurrencyToggle`, `TourCard`, `DeparturePicker`,
`OrderSummary`, `PromoCode`, `PaymentForm`, `ConfirmationPanel`, `BookingRow`
**feedback** — `Alert`, `Toast`, `Modal`, `ProgressBar`
**navigation** — `Logo`, `Header`, `BottomNav`, `Breadcrumbs`, `Tabs`, `Accordion`, `Pagination`, `Footer`,
`CheckoutStepper`
**icons** — `Icon`, `ICONS`
**admin** — `AppShell` (+ `SideNav`, `TopBar`, `PageHeader`), `DataTable`, `FilterBar`, `RowMenu`, `StatCard`, `MiniChart`,
`MediaManager`, `RoleMatrix`, `AuditTimeline`, `Drawer`

### The two surfaces

The system spans **one product, two surfaces** that share every token, font and primitive:

- **Customer app** — mobile-first (390px Android) and desktop web (landing, browse, tour detail, checkout,
  bookings, blog, content pages). Warm, reassuring, trust-first.
- **Admin console** (`ui_kits/admin/`) — desktop-first, data-dense back office on a persistent dark app-shell.
  Efficient and neutral. Uses the admin component set above plus a compact type scale and table-neutral tokens
  (`tokens/admin.css`). The nav rail is always dark, independent of the light/dark content theme. Reuses the
  same `StatusBadge`, `Price`, `FormField`, `Modal`, `Toast` as the customer app, so a Pending badge means the
  same thing on both. See `guidelines/admin-voice.md` for the operator microcopy.

Each component directory holds `<Name>.jsx`, `<Name>.d.ts` (props contract), `<Name>.prompt.md` (what and when),
and one `@dsCard` HTML sheet showing every state.

### Intentional additions

The brief listed components; these were added because the flows need them and nothing in the brief covers them:

- `Logo` — a lock-up wrapper so the supplied badge is never re-scaled or recoloured by hand.
- `Icon` — a wrapper over the copied Lucide set, so icons are never pasted as raw SVG into screens.
- `FormField` — the label/help/error wrapper that makes the ARIA wiring automatic rather than optional.
- `ErrorSummary` — required to meet WCAG 3.3.1 on the multi-step wizard.
- `Spinner`, `ProgressBar` — the loading vocabulary the brief asks for as "loaders".
