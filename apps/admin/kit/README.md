# Admin console (TripKoach Ops)

The desktop-first back office for TripKoach staff. Shares the token/foundation layer with the customer app but
runs on an app-shell: persistent dark left nav + top bar + a max-1440 content area, with detail/edit **drawers**
and full-page edit forms.

`index.html` is a click-through of every area — use the bottom **Admin** bar to jump between screens and toggle
states (login error/locked, MFA bad-code, dashboard loading/empty, bookings loading).

## Screens
| Area | File | Covers |
| --- | --- | --- |
| Auth | `screens-auth.jsx` | Staff login, **MFA** 6-digit challenge, forgot/reset, sign-in error, account lockout, session-expired |
| Dashboard | `screens-dashboard.jsx` | KPI stat cards, 7-day line + status donut charts, "needs attention" pending table, upcoming departures, quick actions, loading + empty states |
| Bookings | `screens-bookings.jsx` | Filterable data table (status tabs, search, bulk select/export), booking **detail drawer** with confirm / cancel (reason capture) + payment badges + audit timeline |
| Tours | `screens-tours.jsx` | Tours data table (live/draft), full-page **create/edit** with sectioned form + **media manager**, delete confirm; **departures & inventory** table with capacity bars + cancel-departure impact |
| More | `screens-more.jsx` | Customers (+ privacy-aware detail drawer & history), Payments & reconciliation, Promo codes (+ editor drawer), Staff & roles (+ **role matrix** + invite), Settings (tabbed), 403 permission-denied |

## Data
`admin-data.js` builds synthetic-but-consistent bookings, customers, payments, promos, staff and departures
from the real `TK_DATA` catalogue (USD, real tour titles).

## Admin-specific components (in the design system)
`AppShell` (`SideNav`/`TopBar`/`PageHeader`), `DataTable`, `FilterBar`, `StatCard`, `MiniChart`, `MediaManager`,
`RoleMatrix`, `AuditTimeline`, `Drawer` — styled by `css/admin.css` and `tokens/admin.css`.

## Notes
- The nav rail is always dark, independent of the light/dark content theme.
- Status colours (Pending/Confirmed/Cancelled/Paid/Failed/Refunded) are the **same tokens** the customer app
  uses, so a badge means the same thing on both surfaces.
- The bottom control bar is a demo device, not part of the product.
- Charts are dependency-free token-styled SVG (`MiniChart`); the donut prints values so meaning never rests on colour.
