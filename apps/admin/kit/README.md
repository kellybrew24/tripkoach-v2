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
from the real `TK_DATA` catalogue (USD, real tour titles). This is the **flag-off** (fixtures) path — byte-identical
to the prototype when `config.js` ships `USE_LIVE_API:false`.

## Live API wiring (TRI-870, behind `USE_LIVE_API`)
Same pattern as the consumer app (TRI-861): `shim/config.js` (`window.TK_CONFIG`) + `shim/tk-api.js` transport +
per-app `tk-boot.js`. `tk-boot.js` here adds the **admin auth gate + write-path shim**:

- **Base:** the admin realm lives under `/api/admin` (Caddy proxies `/api/*` verbatim, same-origin session cookie).
  The base is derived from the shared `TK_CONFIG.apiBase` (`/api/v1` → `/api/admin`); `TK_CONFIG.adminApiBase` overrides.
- **Auth gate (`window.TK_BOOT`):** on boot it calls `GET /api/admin/me`. Authenticated → hydrate the fixture globals
  (`TK_DATA.tours/regions`, `TK_ADMIN.*`, `TK_REVIEWS`) from the admin endpoints, then mount. `401/403` → mount the
  app on the **login** screen. `window.TK_ADMIN_SESSION` = the session (`{staff, role, permissions}`) or `{unauthenticated:true}`.
- **Login:** `screens-auth.jsx` posts `POST /api/admin/auth/login`; on success `window.TK_ADMIN_ENTER(me)` records the
  session + hydrates, then routes to the dashboard (or the MFA challenge if the server asks). Sign-out revokes via
  `POST /api/admin/auth/logout`. A mid-session `401` from any write → session-expired → login.
- **Writes (`window.TK_ADMIN_API` + `window.TK_ADMIN_ACT`):** every mutation (tour CRUD, region create, departure
  add/cancel, booking confirm/cancel, payment mark-paid / refund-flag, promo save, settings save, staff invite) routes
  through `TK_ADMIN_ACT(call, optimistic)`. Flag off → runs the optimistic (prototype) path synchronously. Flag on →
  calls the guarded endpoint, applies the optimistic UI **only on success**, and surfaces `401` (→ re-login), `403`
  (permission-denied) and `422`/validation errors in the DS toast. USD is the currency of record; the server owns FX
  (usd/ghs/fx columns from Phase 2 are carried through on bookings/payments).

Verify: `npm run smoke` (flag off, byte-identical render) + `npm run smoke:admin-live` (mock `/api/admin` API:
login gate, hydration, write-path, 403 handling). Exact request/response shapes are firmed with Backend (TRI-869)
and re-run live once the admin API deploys (TRI-871).

## Admin-specific components (in the design system)
`AppShell` (`SideNav`/`TopBar`/`PageHeader`), `DataTable`, `FilterBar`, `StatCard`, `MiniChart`, `MediaManager`,
`RoleMatrix`, `AuditTimeline`, `Drawer` — styled by `css/admin.css` and `tokens/admin.css`.

## Notes
- The nav rail is always dark, independent of the light/dark content theme.
- Status colours (Pending/Confirmed/Cancelled/Paid/Failed/Refunded) are the **same tokens** the customer app
  uses, so a badge means the same thing on both surfaces.
- The bottom control bar is a demo device, not part of the product.
- Charts are dependency-free token-styled SVG (`MiniChart`); the donut prints values so meaning never rests on colour.
