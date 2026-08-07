// Thin data-access layer. Phase 0 chose "explicit SQL where it matters, no ORM magic hiding the lock."
// We expose a single `Db` interface backed by either node-postgres (prod, real Postgres via DATABASE_URL)
// or PGlite (local dev/smoke — real Postgres compiled to WASM, so identical SQL semantics, no Docker).
// The Phase 2 no-oversell reserve transaction (SELECT … FOR UPDATE) runs unchanged on both.

import type { Config } from './config.ts';

export interface QueryResult<R = any> {
  rows: R[];
  rowCount: number;
}

export interface Db {
  query<R = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  /** Run a batch of one-or-more statements (simple protocol; no params). Used for migration files. */
  exec(sql: string): Promise<void>;
  /** Run fn inside a single transaction (BEGIN/COMMIT, ROLLBACK on throw), on one connection. */
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: 'pg' | 'pglite';
}

export async function createDb(cfg: Config): Promise<Db> {
  return cfg.dbDriver === 'pg' ? createPgDb(cfg) : createPgliteDb(cfg);
}

// ── node-postgres (production / real dev Postgres) ──────────────────────────
async function createPgDb(cfg: Config): Promise<Db> {
  if (!cfg.databaseUrl) throw new Error('DB_DRIVER=pg requires DATABASE_URL');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });

  const wrap = (run: (t: string, p?: unknown[]) => Promise<any>): Db => ({
    driver: 'pg',
    async query(text, params) {
      const r = await run(text, params);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    async exec(sql) { await run(sql); },   // no params → pg uses the simple protocol (multi-statement OK)
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const scoped = wrap((t, p) => client.query(t, p as any[]));
        const out = await fn(scoped);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  });

  return wrap((t, p) => (p === undefined ? pool.query(t) : pool.query(t, p as any[])));
}

// ── PGlite (local dev / smoke — WASM Postgres, no external server) ──────────
async function createPgliteDb(cfg: Config): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const client = await PGlite.create(cfg.pgliteData);

  const db: Db = {
    driver: 'pglite',
    async query(text, params) {
      const r = await client.query(text, params as any[]);
      const rows = (r.rows as any[]) ?? [];
      return { rows: rows as any[], rowCount: (r as any).affectedRows ?? rows.length };
    },
    async exec(sql) { await client.exec(sql); },  // simple protocol, handles multi-statement files
    async tx(fn) {
      // PGlite is single-connection; emulate with explicit BEGIN/COMMIT on the same client.
      await client.exec('BEGIN');
      try {
        const out = await fn(db);
        await client.exec('COMMIT');
        return out;
      } catch (e) {
        await client.exec('ROLLBACK');
        throw e;
      }
    },
    async close() { await client.close(); },
  };
  return db;
}
