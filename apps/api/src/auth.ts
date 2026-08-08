// TRI-869 Phase 3 · Admin authN/authZ. Session-cookie auth against staff_user (argon2id), server-side
// sessions (revocable + sliding idle expiry), and a role→permission resolver used by the route guards.
// Tables come from Phase 1 migration 006 (staff_user, role_permission, session, audit_log).

import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { Config } from './config.ts';

// The full permission vocabulary (must match the CHECK in 006_staff_rbac_auth.sql).
export const ALL_PERMISSIONS = [
  'tours.view', 'tours.edit',
  'bookings.view', 'bookings.manage', 'bookings.cancel',
  'payments.refund', 'customers.view',
  'promos.manage', 'users.manage', 'settings.manage',
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export interface StaffContext {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'operator' | 'viewer';
  jobTitle: string | null;
  permissions: Set<string>;
}

// Attach the resolved staff context to the request for downstream handlers.
declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffContext;
  }
}

// ── Password hashing (argon2id, OWASP-recommended params) ────────────────────
// Pure-WASM (hash-wasm): no native build, runs identically on the dev box and in the PGlite smoke.
const ARGON = { parallelism: 1, iterations: 2, memorySize: 19456 /* KiB = 19 MiB */, hashLength: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ password, salt: randomBytes(16), outputType: 'encoded', ...ARGON });
}

export async function verifyPassword(password: string, encodedHash: string | null | undefined): Promise<boolean> {
  if (!encodedHash) return false;
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    return false; // malformed stored hash → treat as no-match, never throw into the login path
  }
}

// ── Permission resolution ────────────────────────────────────────────────────
// admin is all-locked-on in the app (per the 006 comment); operator/viewer consult the role_permission matrix.
export async function permissionsFor(db: Db, role: string): Promise<Set<string>> {
  if (role === 'admin') return new Set(ALL_PERMISSIONS);
  const { rows } = await db.query<{ permission: string }>(
    `SELECT permission FROM role_permission WHERE role = $1 AND allowed = true`, [role]);
  return new Set(rows.map((r) => r.permission));
}

// ── Sessions ─────────────────────────────────────────────────────────────────
/** Create a server-side staff session; returns its id (used as the opaque cookie bearer). When
 *  `mfaPending` is true the session is a half-auth login state (see resolveSession / clearMfaPending). */
export async function createSession(
  db: Db, cfg: Config, staffId: string,
  meta: { ip?: string; userAgent?: string; trustedDevice?: boolean; mfaPending?: boolean },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO session (subject_type, subject_id, expires_at, trusted_device, ip, user_agent, mfa_pending)
     VALUES ('staff', $1, now() + ($2 * interval '1 minute'), $3, $4, $5, $6)
     RETURNING id`,
    [staffId, cfg.adminSessionIdleMinutes, !!meta.trustedDevice, meta.ip ?? null, meta.userAgent ?? null, !!meta.mfaPending],
  );
  return rows[0].id;
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.query(`UPDATE session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

/** A live-but-unpromoted session awaiting its second factor (POST /auth/mfa). Returns null unless the
 *  session is live (not expired/revoked), its staff user is active, AND it is still mfa_pending. */
export async function resolvePendingSession(
  db: Db, sessionId: string,
): Promise<{ sessionId: string; staffId: string } | null> {
  if (!sessionId) return null;
  const { rows } = await db.query<any>(
    `SELECT s.id AS session_id, u.id AS staff_id, u.status
       FROM session s JOIN staff_user u ON u.id = s.subject_id
      WHERE s.id = $1 AND s.subject_type = 'staff'
        AND s.revoked_at IS NULL AND s.expires_at > now() AND s.mfa_pending = true`,
    [sessionId],
  );
  const r = rows[0];
  if (!r || r.status !== 'active') return null;
  return { sessionId: r.session_id, staffId: r.staff_id };
}

/** Promote a pending session to fully authenticated once the second factor has verified. */
export async function clearMfaPending(db: Db, sessionId: string): Promise<void> {
  await db.query(`UPDATE session SET mfa_pending = false, last_seen_at = now() WHERE id = $1`, [sessionId]);
}

/** Resolve a live staff session → full StaffContext, applying sliding idle expiry. null if absent/expired/revoked. */
export async function resolveSession(db: Db, cfg: Config, sessionId: string): Promise<StaffContext | null> {
  if (!sessionId) return null;
  const { rows } = await db.query<any>(
    `SELECT s.id AS session_id, u.id, u.email, u.name, u.role, u.job_title, u.status
       FROM session s
       JOIN staff_user u ON u.id = s.subject_id
      WHERE s.id = $1 AND s.subject_type = 'staff'
        AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.mfa_pending = false`,   // a half-auth (awaiting 2FA) session is NOT authenticated
    [sessionId],
  );
  const r = rows[0];
  if (!r || r.status !== 'active') return null;

  // Sliding expiry: extend the idle window and stamp activity on both the session and the user.
  await db.query(
    `UPDATE session SET last_seen_at = now(), expires_at = now() + ($2 * interval '1 minute') WHERE id = $1`,
    [r.session_id, cfg.adminSessionIdleMinutes],
  );
  await db.query(`UPDATE staff_user SET last_active_at = now() WHERE id = $1`, [r.id]);

  return {
    id: r.id, email: r.email, name: r.name ?? null, role: r.role, jobTitle: r.job_title ?? null,
    permissions: await permissionsFor(db, r.role),
  };
}

// ── Cookie helpers ───────────────────────────────────────────────────────────
export function setSessionCookie(reply: FastifyReply, cfg: Config, sessionId: string): void {
  reply.setCookie(cfg.adminCookieName, sessionId, {
    httpOnly: true,
    secure: cfg.adminCookieSecure,
    sameSite: cfg.adminCookieSameSite,
    path: cfg.adminPrefix,
    maxAge: cfg.adminSessionIdleMinutes * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply, cfg: Config): void {
  reply.clearCookie(cfg.adminCookieName, { path: cfg.adminPrefix });
}

// ── Route guards (Fastify preHandlers) ───────────────────────────────────────
function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: 'unauthorized', message: 'Authentication required' } });
}
function forbidden(reply: FastifyReply, permission: string) {
  return reply.code(403).send({ error: { code: 'forbidden', message: `Missing permission: ${permission}` } });
}

/** preHandler: require a valid staff session; attaches req.staff. 401 otherwise. */
export function makeRequireAuth(db: Db, cfg: Config) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const sid = req.cookies?.[cfg.adminCookieName];
    const staff = sid ? await resolveSession(db, cfg, sid) : null;
    if (!staff) return unauthorized(reply);
    req.staff = staff;
  };
}

/** preHandler factory: require auth AND a specific permission. 401 no session, 403 missing permission. */
export function makeRequirePermission(db: Db, cfg: Config, permission: Permission) {
  const requireAuth = makeRequireAuth(db, cfg);
  return async function requirePermission(req: FastifyRequest, reply: FastifyReply) {
    await requireAuth(req, reply);
    if (reply.sent) return;                       // requireAuth already answered 401
    if (!req.staff!.permissions.has(permission)) return forbidden(reply, permission);
  };
}

// ── Audit log (written on every mutation) ────────────────────────────────────
export async function audit(
  db: Db,
  entry: {
    actorId: string | null; action: string;
    /** Who acted. Defaults to 'staff' (admin realm); the consumer realm (TRI-881) passes 'user'. */
    actorType?: string;
    targetType?: string; targetId?: string | null;
    before?: unknown; after?: unknown; ip?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, target_type, target_id, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorType ?? 'staff',
      entry.actorId, entry.action, entry.targetType ?? null, entry.targetId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ip ?? null,
    ],
  );
}
