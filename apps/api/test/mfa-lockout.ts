// TRI-1061 / TRI-1170 · MFA brute-force lockout regression (in-process PGlite, no Docker).
// Run: node --experimental-strip-types test/mfa-lockout.ts
// Proves the 030-superset `session.mfa_failed_count` column and the net-new `recordMfaFailure` helper:
// counter climbs per wrong /auth/mfa code and the pending session is revoked at MFA_MAX_ATTEMPTS.
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { recordMfaFailure, MFA_MAX_ATTEMPTS } from '../src/auth.ts';

const cfg = { ...loadConfig(), dbDriver: 'pglite' as const, pgliteData: 'memory://', env: 'test' };
const db = await createDb(cfg);
await migrate(db, () => {});

const u = await db.query<{ id: string }>(
  `INSERT INTO user_account (email, password_hash, name) VALUES ('mfa@t.dev','x','T') RETURNING id`);
const uid = u.rows[0].id;
const s = await db.query<{ id: string }>(
  `INSERT INTO session (subject_type, subject_id, expires_at, mfa_pending)
   VALUES ('user', $1, now() + interval '30 min', true) RETURNING id`, [uid]);
const sid = s.rows[0].id;

for (let i = 1; i < MFA_MAX_ATTEMPTS; i++) {
  const r = await recordMfaFailure(db, sid);
  assert.equal(r.count, i, `attempt ${i} count`);
  assert.equal(r.revoked, false, `attempt ${i} must not revoke yet`);
}
const capped = await recordMfaFailure(db, sid);
assert.equal(capped.count, MFA_MAX_ATTEMPTS, 'cap count');
assert.equal(capped.revoked, true, 'session revoked at cap');
const chk = await db.query<{ revoked_at: Date | null }>(`SELECT revoked_at FROM session WHERE id=$1`, [sid]);
assert.ok(chk.rows[0].revoked_at != null, 'revoked_at persisted');
assert.deepEqual(await recordMfaFailure(db, sid), { count: MFA_MAX_ATTEMPTS, revoked: true }, 'idempotent post-revoke');

await db.close();
console.log(`✓ MFA lockout: ${MFA_MAX_ATTEMPTS} wrong codes revoke the pending session (session.mfa_failed_count)`);
