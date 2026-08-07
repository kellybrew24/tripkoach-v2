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

const APPS = {
  web: {
    kit: join(ROOT, "apps/web/kit"),
    // Load order mirrors ui_kits/web/index.html exactly.
    screens: ["screens-home.jsx", "screens-pages.jsx", "screens-blog.jsx", "screens-account.jsx", "screens-web.jsx"],
    app: "app.jsx",
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
    // Load order mirrors ui_kits/admin/index.html exactly.
    screens: ["screens-auth.jsx", "screens-dashboard.jsx", "screens-bookings.jsx", "screens-tours.jsx", "screens-more.jsx"],
    app: "app.jsx",
    // data.js (window.TK_DATA) must load before admin-data.js (which reads it).
    data: ["data.js", "admin-data.js"],
    title: "TripKoach Ops — admin console",
    bodyBg: "var(--shell-content-bg)",
    headCss: "",
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
  // 1b. Component namespace: the DS ships _ds_bundle.js as an all-in-one PREVIEW
  //     bundle — the ~60 primitives PLUS all three click-through kit apps PLUS
  //     three `ReactDOM.createRoot(#root).render(...)` calls that fire on load and
  //     fight over #root. We consume it only for the `window.TripKoachDesignSystem_*`
  //     component namespace, so strip those preview-only auto-renders. Our own
  //     app.js performs the single real render. (design-system/ stays untouched.)
  const bundle = readFileSync(join(DS, "_ds_bundle.js"), "utf8")
    .split("\n")
    .filter((l) => !/ReactDOM\.createRoot\(document\.getElementById\("root"\)\)\.render\(/.test(l))
    .join("\n");
  writeFileSync(join(dist, "_ds_bundle.js"), bundle);
  // 2. Self-hosted production React.
  for (const f of ["react.production.min.js", "react-dom.production.min.js"]) {
    cpSync(join(ROOT, "vendor/react", f), join(dist, "vendor", f));
  }
  // 3. Data fixtures (plain JS, window-assigning — used verbatim).
  for (const d of cfg.data) cpSync(join(cfg.kit, d), join(dist, "data", d));

  // 4. Build-time-transpiled application script (screens + app, in kit order).
  let appJs = "/* Built by scripts/build.mjs — do not edit. Sources live in apps/" + name + "/kit + design-system/. */\n";
  for (const f of [...cfg.screens, cfg.app]) appJs += wrapFile(cfg.kit, f);
  writeFileSync(join(dist, "app.js"), appJs);

  // 5. Production index.html.
  const dataTags = cfg.data.map((d) => `<script src="data/${d}"></script>`).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cfg.title}</title>
<link rel="stylesheet" href="styles.css">
<style>body{margin:0;background:${cfg.bodyBg}}
${cfg.headCss}</style>
</head>
<body>
<div id="root"></div>
<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
<script src="_ds_bundle.js"></script>
${dataTags}
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
