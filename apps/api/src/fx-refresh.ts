// TRI-873 Phase 4 · FX refresh cron entrypoint. Invoke once/day (DevOps installs the cron):
//
//   npm run fx-refresh            # from apps/api, uses DATABASE_URL from the environment
//   node --experimental-strip-types src/fx-refresh.ts
//
// Exit codes (for cron/monitor alerting): 0 = rate applied ('ok') or override in force; 1 = a guard
// tripped ('fetch_failed' / 'out_of_bounds') — the DB kept its last-known-good, checkout is unaffected,
// but ops should investigate. The process opens a DB connection, runs one refresh, and closes.

import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { refreshFxRate } from './fx.ts';

const cfg = loadConfig();
const db = await createDb(cfg);
try {
  const stamp = new Date().toISOString();
  console.log(`[fx-refresh] ${stamp} provider=${cfg.fx.providerName} url=${cfg.fx.providerUrl} buffer=${cfg.fx.bufferPct}% maxDev=${cfg.fx.maxDeviationPct}%`);
  const result = await refreshFxRate(db, cfg, { log: (m) => console.log(m) });
  console.log(`[fx-refresh] done status=${result.status} appliedRate=${result.appliedRate} effective=${result.effectiveRate ?? '—'} raw=${result.rawRate ?? '—'}`);
  // 'ok' and 'override' are healthy; guard trips are non-zero so cron surfaces them.
  process.exitCode = (result.status === 'ok' || result.status === 'override') ? 0 : 1;
} catch (e) {
  // Unexpected error (e.g. DB down). Never leaves a bad rate — nothing was written on this path.
  console.error(`[fx-refresh] FATAL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
