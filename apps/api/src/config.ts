// Runtime config. Same-origin deploy: the SPA hits `/api/v1`, Caddy reverse-proxies to this service
// bound on localhost:<PORT>. Secrets (DATABASE_URL) come from the environment / secret store — never code.

export interface Config {
  port: number;
  host: string;
  /** 'pg' → real Postgres via DATABASE_URL; 'pglite' → in-process WASM Postgres (local dev/smoke, no Docker). */
  dbDriver: 'pg' | 'pglite';
  databaseUrl: string | undefined;
  /** PGlite data dir; 'memory://' for ephemeral. */
  pgliteData: string;
  env: string;
  apiPrefix: string;
  /** Run migrations automatically on boot (handy in dev; DevOps may run them as a deploy step in prod). */
  autoMigrate: boolean;
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  // Default to pglite when no DATABASE_URL is present so local dev/smoke needs no external Postgres.
  const dbDriver = (process.env.DB_DRIVER as 'pg' | 'pglite') || (databaseUrl ? 'pg' : 'pglite');
  return {
    // DevOps (TRI-862) proxies /api/* verbatim → 127.0.0.1:3020 on the dev box. Match that by default.
    port: Number(process.env.PORT || 3020),
    host: process.env.HOST || '127.0.0.1',
    dbDriver,
    databaseUrl,
    pgliteData: process.env.PGLITE_DATA || 'memory://',
    env: process.env.NODE_ENV || 'development',
    apiPrefix: process.env.API_PREFIX || '/api/v1',
    autoMigrate: process.env.AUTO_MIGRATE ? process.env.AUTO_MIGRATE === 'true' : dbDriver === 'pglite',
  };
}
