// Raw-SQL migration runner (node-pg-migrate style: ordered .sql files, tracked in schema_migrations).
// Deliberately dependency-light so DevOps can also apply the same files to the real dev Postgres.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { createDb, type Db } from './db.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (q) => {
      await q.exec(sql);   // migration files contain multiple statements
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
    log(`applied ${file}`);
  }
  return applied;
}

// CLI entry: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const db = await createDb(cfg);
  try {
    const applied = await migrate(db, (m) => console.log(`[migrate] ${m}`));
    console.log(applied.length ? `[migrate] ${applied.length} migration(s) applied` : '[migrate] up to date');
  } finally {
    await db.close();
  }
}
