// Service bootstrap: connect DB, (optionally) migrate + seed, then serve the read API on localhost.
// Caddy reverse-proxies /api/* to this port on the dev host (DevOps, TRI DevOps issue).

import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { buildServer } from './server.ts';
import { migrate } from './migrate.ts';

const cfg = loadConfig();
const db = await createDb(cfg);

if (cfg.autoMigrate) {
  const applied = await migrate(db, (m) => console.log(`[migrate] ${m}`));
  if (applied.length) console.log(`[migrate] ${applied.length} migration(s) applied`);
  // Auto-seed an empty pglite dev DB so `npm run dev` is one command.
  if (cfg.dbDriver === 'pglite') {
    const { rows } = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM region');
    if (Number(rows[0].n) === 0) {
      const { seed } = await import('./seed.ts');
      await seed(db, undefined, (m) => console.log(`[seed] ${m}`));
    }
  }
}

const app = buildServer(db, cfg);
try {
  await app.listen({ port: cfg.port, host: cfg.host });
  console.log(`[api] listening on http://${cfg.host}:${cfg.port} (db=${db.driver}, prefix=${cfg.apiPrefix})`);
} catch (err) {
  app.log.error(err);
  await db.close();
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
