#!/usr/bin/env node
/**
 * TripKoach v2 static build.
 *
 * Turns the tripv2 design-system click-through kits (ui_kits/web, ui_kits/admin)
 * into real, static, single-page applications — WITHOUT the prototype-only
 * runtime dependencies the kits ship with:
 *
 *   kit (prototype)                 →  this build (production)
 *   -----------------------------      -----------------------------------
 *   React *development* UMD via CDN →  React *production* UMD, self-hosted
 *   @babel/standalone in the browser→  JSX transpiled once, at build time
 *   <script type="text/babel">      →  a single plain classic <script>
 *
 * Fidelity: nothing in the design system is edited. The screen files and
 * app.jsx are used verbatim; we only change HOW they are loaded. The kits
 * rely on a shared global scope (screen components are `function`
 * declarations that other screens/app.jsx reference by bare name, and each
 * screen re-reads the component namespace `window.TripKoachDesignSystem_*`).
 * We reproduce that exactly: every screen file is wrapped in its own IIFE
 * (so per-file locals like `NS`/`IMG` never collide) and its top-level
 * declarations are re-exported onto `window` (so cross-file references still
 * resolve, just like a browser sharing one classic-script global object).
 *
 * Usage: node scripts/build.mjs [web|admin]   (no arg = both)
 */
import esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DS = join(ROOT, "design-system");
const SHIM = join(ROOT, "shim");

// Runtime shim shared by both apps (TRI-861). config.js MUST load first (before
// the data fixtures and app.js); tk-api.js before app.js. tk-boot.js is per-app
// (it holds the app-specific read wiring) and is copied from each kit dir.
const SHARED_SHIM = ["config.js", "tk-api.js"];

const APPS = {
  web: {
    kit: join(ROOT, "apps/web/kit"),
    // Load order mirrors ui_kits/web/index.html exactly.
    screens: ["screens-home.jsx", "screens-pages.jsx", "screens-blog.jsx", "screens-account.jsx", "screens-web.jsx"],
    app: "app.jsx",
    // Web-only shims. Loaded after tk-api.js (they use TK_API) and before app.js.
    // Admin never books, holds consumer accounts, or redeems review invites, so
    // these are NOT in SHARED_SHIM — the admin build is untouched.
    //   tk-booking.js (TRI-867): booking + Paystack-checkout client.
    //   tk-auth.js    (TRI-882): consumer accounts & auth client.
    //   tk-reviews.js (TRI-894): tokenized review-invite redeem/submit client.
    extraShim: ["tk-booking.js", "tk-auth.js", "tk-reviews.js"],
    // data.js (window.TK_DATA / TK_IMG) must load before blog.js.
    data: ["data.js", "blog.js"],
    title: "TripKoach — guided tours across Ghana",
    bodyBg: "var(--bg-page)",
    // Responsive layer lifted verbatim from ui_kits/web/index.html <style>.
    headCss: `main{min-height:60vh}
.tk-only-mobile{display:none}
@media (max-width:1023px){.tk-only-mobile{display:inline-flex}.tk-hide-mobile{display:none !important}}
@media (max-width:960px){
  #root [style*="1fr 380px"],#root [style*="1fr 360px"],#root [style*="240px 1fr"],
  #root [style*="1.05fr 0.95fr"],#root [style*="1.1fr 0.9fr"]{grid-template-columns:1fr !important}
  #root [style*="repeat(3"],#root [style*="repeat(4"]{grid-template-columns:repeat(2,1fr) !important}
}
@media (max-width:600px){
  #root [style*="grid-template-columns"]{grid-template-columns:1fr !important}
  #root .tk-blogfeature{flex-direction:column !important}
  #root .tk-blogfeature .tk-media{flex:0 0 auto !important;width:100% !important;aspect-ratio:16/10 !important}
  #root .tk-login{min-height:auto !important}
  .tk-display{font-size:clamp(30px,8vw,44px) !important}
}`,
  },
  admin: {
    kit: join(ROOT, "apps/admin/kit"),
    // Load order mirrors ui_kits/admin/index.html exactly. qr.jsx (TRI-911)
    // defines the self-contained MFA QR encoder + <MfaQr> and must load before
    // screens-more.jsx, which renders it in the enrollment drawer.
    screens: ["qr.jsx", "screens-auth.jsx", "screens-dashboard.jsx", "screens-bookings.jsx", "screens-tours.jsx", "screens-more.jsx", "screens-blog-admin.jsx", "screens-audit.jsx"],
    app: "app.jsx",
    // data.js (window.TK_DATA) must load before admin-data.js (which reads it).
    data: ["data.js", "admin-data.js"],
    title: "TripKoach Ops — admin console",
    bodyBg: "var(--shell-content-bg)",
    // TRI-978 #1: app-shell scroll fix (app layer; design-system/ stays pristine).
    // The DS shell let the whole window scroll while the sidebar (height:100vh,
    // overflow-y:auto) grew its OWN scrollbar whenever its nav content exceeded the
    // viewport — two competing scrollbars, and the content read as "trapped inside
    // the nav's scroll". Lock the document to the viewport and make the main column
    // the single content scroll region: the topbar stays pinned (it's sticky within
    // the main column) and the sidebar only scrolls internally when it genuinely
    // overflows. The lock is scoped with :has(.tk-shell) so the full-bleed auth
    // screens (login/MFA, no shell) keep their natural document scroll. Fixed
    // drawers/modals/toasts are position:fixed (no transformed ancestor) so the
    // shell's overflow:hidden does not clip them.
    headCss: `html:has(.tk-shell),body:has(.tk-shell){height:100%;overflow:hidden}
.tk-shell{height:100vh;overflow:hidden;grid-template-rows:minmax(0,1fr)}
.tk-shell__main{overflow-y:auto;min-height:0}`,
  },
};

/** Transpile one kit file and wrap it so it reproduces the kit's shared-global scope. */
function wrapFile(kitDir, file) {
  const src = readFileSync(join(kitDir, file), "utf8");
  const { code } = esbuild.transformSync(src, {
    loader: "jsx",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    // Keep sloppy mode: bare cross-file identifiers resolve against the global object.
    supported: { "arrow": true },
  });
  // Collect top-level declaration names from the ORIGINAL source (column-0 decls).
  const names = new Set();
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(m[1]);
  }
  const exports = [...names].map((n) => `try{window.${n}=${n}}catch(_){}`).join("");
  return `\n/* ==== ${file} ==== */\n;(function(){\n${code}\n${exports}\n})();\n`;
}

function buildApp(name) {
  const cfg = APPS[name];
  if (!cfg) throw new Error(`unknown app: ${name}`);
  const dist = join(ROOT, "apps", name, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, "vendor"), { recursive: true });
  mkdirSync(join(dist, "data"), { recursive: true });

  // 1. Shared DS layer (pristine copies).
  for (const p of ["styles.css", "tokens", "css", "assets"]) {
    cpSync(join(DS, p), join(dist, p), { recursive: true });
  }
  // 1a. Self-host Manrope. The DS ships tokens/fonts.css with a Google-Fonts
  //     @import (a third-party round trip on every load). We keep design-system/
  //     pristine and instead rewrite the COPY in dist: vendor the Manrope latin
  //     subset (one variable woff2, weights 400–800) and swap the @import for a
  //     local @font-face. Same precedent as stripping the bundle's auto-renders.
  mkdirSync(join(dist, "fonts"), { recursive: true });
  cpSync(join(ROOT, "vendor/fonts/manrope-latin.woff2"), join(dist, "fonts/manrope-latin.woff2"));
  const fontsCssPath = join(dist, "tokens", "fonts.css");
  const fontFace = `@font-face{font-family:"Manrope";font-style:normal;font-weight:400 800;font-display:swap;src:url("../fonts/manrope-latin.woff2") format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;
  const fontsCss = readFileSync(fontsCssPath, "utf8")
    .replace(/^\s*@import\s+url\([^)]*\);\s*$/m, fontFace);
  if (!fontsCss.includes("@font-face")) throw new Error("[build] failed to self-host Manrope: @import not found in tokens/fonts.css");
  writeFileSync(fontsCssPath, fontsCss);
  // 1b. Component namespace: the DS ships _ds_bundle.js as an all-in-one PREVIEW
  //     bundle — the ~60 primitives PLUS all three click-through kit apps PLUS
  //     three `ReactDOM.createRoot(#root).render(...)` calls that fire on load and
  //     fight over #root. We consume it only for the `window.TripKoachDesignSystem_*`
  //     component namespace, so strip those preview-only auto-renders. Our own
  //     app.js performs the single real render. (design-system/ stays untouched.)
  let bundle = readFileSync(join(DS, "_ds_bundle.js"), "utf8")
    .split("\n")
    .filter((l) => !/ReactDOM\.createRoot\(document\.getElementById\("root"\)\)\.render\(/.test(l))
    .join("\n");
  // 1c. Dead control (TRI-973): the DS TopBar renders a global "search" input
  //     that is wired to nothing (no onSearch prop, no state) — a preview-only
  //     affordance. The board asked to remove it from the admin shell. Strip the
  //     .tk-topbar__search subtree from the admin bundle COPY only. The topbar's
  //     actions cluster keeps its right edge via `margin-inline-start:auto`, so
  //     removing the flex spacer leaves the header layout unchanged. Same
  //     precedent as the auto-render strip above; design-system/ stays pristine.
  if (name === "admin") {
    const before = bundle;
    bundle = bundle.replace(
      /\/\*#__PURE__\*\/React\.createElement\("div",\s*\{\s*className:\s*"tk-topbar__search"[\s\S]*?(?=\/\*#__PURE__\*\/React\.createElement\("div",\s*\{\s*className:\s*"tk-topbar__actions")/,
      "",
    );
    if (bundle === before || bundle.includes('"tk-topbar__search"')) {
      throw new Error("[build] TRI-973: failed to strip dead top-bar search from admin bundle");
    }
  }
  writeFileSync(join(dist, "_ds_bundle.js"), bundle);
  // 2. Self-hosted production React.
  for (const f of ["react.production.min.js", "react-dom.production.min.js"]) {
    cpSync(join(ROOT, "vendor/react", f), join(dist, "vendor", f));
  }
  // 3. Data fixtures (plain JS, window-assigning — used verbatim).
  for (const d of cfg.data) cpSync(join(cfg.kit, d), join(dist, "data", d));

  // 3a. Runtime shim (TRI-861): shared config + API client, plus the per-app
  //     boot gate. Copied verbatim (NOT transpiled — these are plain classic
  //     scripts, no JSX). config.js ships with USE_LIVE_API off, so the built
  //     app is byte-for-byte the fixture prototype until DevOps overwrites
  //     config.js at deploy to point at the same-origin /api proxy.
  for (const f of SHARED_SHIM) cpSync(join(SHIM, f), join(dist, f));
  for (const f of cfg.extraShim || []) cpSync(join(SHIM, f), join(dist, f));
  cpSync(join(cfg.kit, "tk-boot.js"), join(dist, "tk-boot.js"));

  // 4. Build-time-transpiled application script (screens + app, in kit order).
  let appJs = "/* Built by scripts/build.mjs — do not edit. Sources live in apps/" + name + "/kit + design-system/. */\n";
  for (const f of [...cfg.screens, cfg.app]) appJs += wrapFile(cfg.kit, f);
  writeFileSync(join(dist, "app.js"), appJs);

  // 5. Production index.html.
  const dataTags = cfg.data.map((d) => `<script src="data/${d}"></script>`).join("\n");
  const extraShimTags = (cfg.extraShim || []).map((f) => `<script src="${f}"></script>`).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/">
<title>${cfg.title}</title>
<link rel="preload" href="fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="styles.css">
<style>body{margin:0;background:${cfg.bodyBg}}
${cfg.headCss}</style>
</head>
<body>
<div id="root"></div>
<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
<script src="_ds_bundle.js"></script>
<script src="config.js"></script>
${dataTags}
<script src="tk-api.js"></script>
${extraShimTags ? extraShimTags + "\n" : ""}<script src="tk-boot.js"></script>
<script src="app.js"></script>
</body>
</html>
`;
  writeFileSync(join(dist, "index.html"), html);
  console.log(`[build] ${name}: dist ready (${cfg.screens.length + 1} kit files → app.js)`);
}

const arg = process.argv[2];
const targets = arg ? [arg] : ["web", "admin"];
for (const t of targets) buildApp(t);
