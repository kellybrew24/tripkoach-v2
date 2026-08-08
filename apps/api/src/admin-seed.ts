// TRI-869 Phase 3 · Bootstrap / update a staff user (the first admin) from the environment. No secret is
// ever hardcoded — the password comes from STAFF_PASSWORD (env / secret store). Idempotent by email.
//
//   STAFF_EMAIL=kwame@tripkoach.com STAFF_PASSWORD='…' STAFF_NAME='Kwame Boateng' \
//     DATABASE_URL=… node --experimental-strip-types src/admin-seed.ts
//
// Roles: admin (default) | operator | viewer. Run `npm run migrate` first so the RBAC matrix is seeded.

import { loadConfig } from './config.ts';
import { createDb, type Db } from './db.ts';
import { hashPassword } from './auth.ts';

export async function upsertStaff(
  db: Db,
  input: { email: string; password: string; name?: string; role?: string; jobTitle?: string },
): Promise<{ id: string; created: boolean }> {
  const role = input.role ?? 'admin';
  if (!['admin', 'operator', 'viewer'].includes(role)) throw new Error(`invalid role "${role}"`);
  const hash = await hashPassword(input.password);
  const { rows } = await db.query<{ id: string; created: boolean }>(
    `INSERT INTO staff_user (email, password_hash, name, role, job_title, status)
       VALUES ($1,$2,$3,$4,$5,'active')
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, name = COALESCE(EXCLUDED.name, staff_user.name),
       role = EXCLUDED.role, job_title = COALESCE(EXCLUDED.job_title, staff_user.job_title),
       status = 'active', updated_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [input.email.toLowerCase(), hash, input.name ?? null, role, input.jobTitle ?? null]);
  return rows[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const email = process.env.STAFF_EMAIL;
  const password = process.env.STAFF_PASSWORD;
  if (!email || !password) {
    console.error('[admin-seed] STAFF_EMAIL and STAFF_PASSWORD are required'); process.exit(1);
  }
  const cfg = loadConfig();
  const db = await createDb(cfg);
  try {
    const { migrate } = await import('./migrate.ts');
    if (cfg.autoMigrate) await migrate(db, (m) => console.log(`[migrate] ${m}`));
    const r = await upsertStaff(db, {
      email, password, name: process.env.STAFF_NAME, role: process.env.STAFF_ROLE, jobTitle: process.env.STAFF_JOB_TITLE,
    });
    console.log(`[admin-seed] ${r.created ? 'created' : 'updated'} staff ${email} (${process.env.STAFF_ROLE ?? 'admin'})`);
  } finally {
    await db.close();
  }
}
