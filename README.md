# TripKoach v2

Customer **web** app and staff **admin** console for TripKoach, built entirely
from the **tripv2 design system** (`design-system/`). One repo hosts the DS and
both apps so they consume the same component source and design tokens.

> Phase status: **DS-driven frontend only.** All data is mock/fixture (from the
> DS kits). No backend, database, or payment integration yet — those are a
> separate follow-up. DS fidelity is the acceptance bar: no off-DS components,
> colours, or fonts.

## Layout

```
design-system/     The tripv2 DS, verbatim (source of truth: tokens, css,
                   components/*, styles.css, _ds_bundle.js, guidelines/…).
                   Never hand-edited — re-theming happens in the token layer.
apps/
  web/kit/         Customer web screens from ui_kits/web (app.jsx, screens-*.jsx,
                   blog.js) + the shared catalogue fixture (data.js).
  admin/kit/       Admin console screens from ui_kits/admin (app.jsx, screens-*.jsx,
                   admin-data.js) + the shared catalogue fixture (data.js).
  {web,admin}/dist Build output (gitignored). Static — deploy as-is.
vendor/react/      Self-hosted React 18 production UMD (no CDN at runtime).
scripts/build.mjs  The static build (see below).
scripts/smoke.mjs  Headless render smoke test (jsdom).
```

## Build

```
npm install
npm run build        # → apps/web/dist and apps/admin/dist
npm run smoke        # headless render check of both apps
npm run verify       # build + smoke
```

Each `dist/` is a self-contained static site: `index.html`, `app.js`,
`styles.css` + `tokens/` + `css/` + `assets/`, `_ds_bundle.js`, `data/`, and
`vendor/` React. Serve it with any static file server.

## What the build does (and why it is DS-faithful)

The DS kits are **click-through prototypes**: they load React *development* UMD
from a CDN, transpile JSX in the browser with `@babel/standalone`, and render via
`<script type="text/babel">`. That is fine for a preview kit but wrong for a real
app on a low-end Android phone (the DS's primary user), which is exactly the
performance constraint the DS README calls out.

`scripts/build.mjs` turns the kits into real static apps **without editing a
single line of design-system source** — it only changes how the code is loaded:

| Kit (prototype)                    | This build (production)                     |
| ---------------------------------- | ------------------------------------------- |
| React *development* UMD via CDN    | React *production* UMD, self-hosted          |
| `@babel/standalone` in the browser | JSX transpiled once, at build time (esbuild) |
| `<script type="text/babel">` × N   | one plain classic `<script src="app.js">`    |
| `_ds_bundle.js` auto-renders 3 kits| preview auto-renders stripped; app renders once |

The kits share a global scope (screen components are `function` declarations that
`app.jsx` references by bare name; each screen re-reads the DS component namespace
`window.TripKoachDesignSystem_*`). The build reproduces that exactly: every screen
file is wrapped in its own IIFE (so per-file locals like `NS`/`IMG` never collide)
and its top-level declarations are re-exported onto `window`.

`_ds_bundle.js` is the DS's all-in-one preview bundle — the ~60 primitives **plus**
all three kit apps **plus** three `ReactDOM.createRoot(#root).render(...)` calls
that fight over `#root`. We consume it only for the component namespace and strip
those preview-only auto-renders at build time.

## API-client shim + live read paths (TRI-861)

The apps read their data from window-globals (`window.TK_DATA.tours`,
`window.TK_REVIEWS`, `window.TK_DATA.regions`, per-tour `t.departures`). Today
those come from the `data/*.js` fixtures. A thin runtime shim lets the **read**
screens hydrate from the live API instead — **behind a flag, DS screens verbatim,
still esbuild-static (no Vite)**:

```
shim/config.js     window.TK_CONFIG = { apiBase:"/api/v1", env, USE_LIVE_API }
                   Loaded first. Ships with USE_LIVE_API OFF (built app == fixture
                   prototype). DevOps overwrites this one file per host at deploy
                   to flip the flag on — no rebuild.
shim/tk-api.js     window.TK_API — dependency-free fetch wrapper. Same-origin,
                   credentials:"include" (session cookie), normalised errors.
apps/web/kit/tk-boot.js    Consumer read-path loader: fetches /regions, /tours,
                   /tours/:slug, /tours/:id/availability, /tours/:id/reviews,
                   maps API → the fixture global shape, then mounts the app.
                   DS-consistent loading + error(retry) states.
apps/admin/kit/tk-boot.js  Admin boot gate (scaffold): shim wired, live read
                   integration is a follow-up; renders from fixtures for now.
```

`app.jsx` renders through `window.TK_BOOT(render)` (the one entrypoint edit) —
flag off ⇒ immediate fixture render; flag on ⇒ hydrate-then-render. Screen files
are otherwise untouched.

```
npm run smoke:live   # stands up a mock API, flips the flag on, asserts the web
                     # read screens (home/browse/tour-detail) render from live
                     # data + the error state renders on API failure.
```

When the flag is off, `npm run smoke` render output is byte-identical to before
the shim — fixture behaviour is unchanged.

## Deploy

Static output ships over the existing dev design-system hosts (two independent
Caddy static services on the shared Hetzner box):

- **web → `dev.tripkoach.com`** (root `/var/www/tripkoach-dev-web`)
- **admin → `admin.dev.tripkoach.com`** (root `/var/www/tripkoach-dev-admin`)

Per-site `CF_API_TOKEN_TRIPKOACH` for TLS; pre-create `/var/log/caddy` files
before reload. See the deploy child issue for the SSH/rsync steps.

## Known follow-ups (tracked as issues)

- **Real routing / navigation.** The apps still carry the kit's dev "Screens"
  switcher (bottom tab bar on web, demo switch on admin) instead of real URL
  routing. Replace with a router before public launch.
- **Self-host Manrope.** `design-system/tokens/fonts.css` still `@import`s Google
  Fonts; self-host a latin subset before launch (DS handoff note).
- **Real content + assets.** Photography, pay-later string, payment deadline,
  `TK-####` ref format, promo/ratings rules are DS placeholders — see
  `design-system/guidelines/handoff.md` "Assumptions made (please confirm)".
- **Backend / payments.** Out of scope this phase; fixtures only.
