/* ==========================================================================
 * TRI-874 Phase 4 — stamp the PRODUCTION config.js into the built dists.
 *
 * The build (scripts/build.mjs) is intentionally flag-agnostic: it copies the
 * default shim/config.js (USE_LIVE_API OFF) so the freshly built app.js /
 * rendered HTML stay byte-identical to the DS baseline. The runtime flag lives
 * ONLY in config.js, so flipping it needs no rebuild — we just overwrite the
 * one config.js file in each dist.
 *
 * This script overwrites apps/{web,admin}/dist/config.js with shim/config.prod.js
 * (USE_LIVE_API=true, env=prod, same-origin relative apiBase). Run AFTER `build`.
 *
 *   npm run build:prod   →   build + stamp   →   prod-ready dist
 * ======================================================================== */
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_CONFIG = join(ROOT, "shim", "config.prod.js");

if (!existsSync(PROD_CONFIG)) {
  console.error(`[stamp-prod] missing ${PROD_CONFIG}`);
  process.exit(1);
}

let stamped = 0;
for (const app of ["web", "admin"]) {
  const target = join(ROOT, "apps", app, "dist", "config.js");
  const dist = join(ROOT, "apps", app, "dist");
  if (!existsSync(dist)) {
    console.error(`[stamp-prod] ${app}: dist not found — run \`npm run build\` first`);
    process.exit(1);
  }
  cpSync(PROD_CONFIG, target);
  console.log(`[stamp-prod] ${app}: config.js → USE_LIVE_API=true, env=prod, apiBase=/api/v1 (same-origin)`);
  stamped++;
}
console.log(`[stamp-prod] done — ${stamped} dist(s) stamped for production.`);
