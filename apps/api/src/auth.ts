// TRI-869 Phase 3 · Admin authN/authZ. Session-cookie auth against staff_user (argon2id), server-side
// sessions (revocable + sliding idle expiry), and a role→permission resolver used by the route guards.
// Tables come from Phase 1 migration 006 (staff_user, role_permission, session, audit_log).

import { randomBytes, createHash } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { Config } from './config.ts';

// The full permission vocabulary (must match the CHECK in 006_staff_rbac_auth.sql, as extended by
// 013_reviews_moderation_perm.sql which adds 'reviews.moderate').
export const ALL_PERMISSIONS = [
  'tours.view', 'tours.edit',
  'bookings.view', 'bookings.manage', 'bookings.cancel',
  'payments.refund', 'customers.view',
  'promos.manage', 'users.manage', 'settings.manage',
  'reviews.moderate', 'content.manage',
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
    /** TRI-912: set by requireAuthAllowingEnroll when the session is enroll-gated (factor-less enforced
     *  role). The /auth/mfa/verify handler reads it to promote the session on a successful enrollment. */
    mfaEnrollPending?: boolean;
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

// ── TRI-1054: brute-force account lockout ────────────────────────────────────
// Server-side lockout backing the (previously cosmetic) "attempts left" UI on the admin sign-in
// screen. After LOGIN_MAX_ATTEMPTS consecutive failed password attempts the account is locked for
// LOGIN_LOCK_MINUTES; any successful authentication clears the counter. This is the per-account,
// spoof-resistant half of SEC-H2 — the per-IP @fastify/rate-limit on the login route is the other.
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;

type LockableRow = { failed_login_count?: number | null; locked_until?: string | Date | null };

/** The active lock expiry for this staff row, or null when it is not currently locked. */
export function accountLockedUntil(u: LockableRow | null | undefined): Date | null {
  if (!u?.locked_until) return null;
  const until = u.locked_until instanceof Date ? u.locked_until : new Date(u.locked_until);
  return until.getTime() > Date.now() ? until : null;
}

/** Record a failed password attempt against a known staff row. A stale lock (already elapsed) resets
 *  the counter first, so each lock window starts fresh. On reaching the threshold the row is locked
 *  for LOGIN_LOCK_MINUTES. Returns the new lock expiry when the account just locked, else null. */
export async function recordFailedLogin(db: Db, u: { id: string } & LockableRow): Promise<Date | null> {
  const stale = accountLockedUntil(u) == null && u.locked_until != null;
  const base = stale ? 0 : (u.failed_login_count ?? 0);
  const newCount = base + 1;
  const doLock = newCount >= LOGIN_MAX_ATTEMPTS;
  const { rows } = await db.query<{ locked_until: Date | null }>(
    `UPDATE staff_user
        SET failed_login_count = $2,
            locked_until = CASE WHEN $3 THEN now() + ($4 * interval '1 minute') ELSE NULL END,
            updated_at = now()
      WHERE id = $1
      RETURNING locked_until`,
    [u.id, newCount, doLock, LOGIN_LOCK_MINUTES],
  );
  return doLock && rows[0]?.locked_until ? new Date(rows[0].locked_until) : null;
}

/** Clear the failed-attempt counter and any lock after a successful authentication. */
export async function resetFailedLogins(db: Db, staffId: string): Promise<void> {
  await db.query(
    `UPDATE staff_user SET failed_login_count = 0, locked_until = NULL, updated_at = now()
      WHERE id = $1 AND (failed_login_count <> 0 OR locked_until IS NOT NULL)`,
    [staffId],
  );
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
  meta: { ip?: string; userAgent?: string; trustedDevice?: boolean; mfaPending?: boolean; mfaEnrollPending?: boolean },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO session (subject_type, subject_id, expires_at, trusted_device, ip, user_agent, mfa_pending, mfa_enroll_pending)
     VALUES ('staff', $1, now() + ($2 * interval '1 minute'), $3, $4, $5, $6, $7)
     RETURNING id`,
    [staffId, cfg.adminSessionIdleMinutes, !!meta.trustedDevice, meta.ip ?? null, meta.userAgent ?? null, !!meta.mfaPending, !!meta.mfaEnrollPending],
  );
  return rows[0].id;
}

/** TRI-912: is MFA mandatory for this role? Consults the configured enforced-role set. */
export function mfaEnforcedFor(cfg: Config, role: string): boolean {
  return cfg.mfaEnforcedRoles.includes(role);
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.query(`UPDATE session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

/** A live-but-unpromoted session awaiting its second factor (POST /auth/mfa). Returns null unless the
 *  session is live (not expired/revoked), its staff user is active, AND it is still mfa_pending. */
export async function resolvePendingSession(
  db: Db, sessionId: string,
): Promise<{ sessionId: string; staffId: string; trustedDevice: boolean } | null> {
  if (!sessionId) return null;
  const { rows } = await db.query<any>(
    `SELECT s.id AS session_id, u.id AS staff_id, u.status, s.trusted_device
       FROM session s JOIN staff_user u ON u.id = s.subject_id
      WHERE s.id = $1 AND s.subject_type = 'staff'
        AND s.revoked_at IS NULL AND s.expires_at > now() AND s.mfa_pending = true`,
    [sessionId],
  );
  const r = rows[0];
  if (!r || r.status !== 'active') return null;
  return { sessionId: r.session_id, staffId: r.staff_id, trustedDevice: !!r.trusted_device };
}

/** Promote a pending session to fully authenticated once the second factor has verified. */
export async function clearMfaPending(db: Db, sessionId: string): Promise<void> {
  await db.query(`UPDATE session SET mfa_pending = false, last_seen_at = now() WHERE id = $1`, [sessionId]);
}

/** TRI-912: a live ENROLL-gated session — a factor-less login by an MFA-enforced role. It may reach only
 *  the /auth/mfa enroll+verify endpoints; every privileged route is 401 until a factor is confirmed and
 *  the session is promoted. Returns null unless live (not expired/revoked), staff active, AND enroll-pending. */
export async function resolveEnrollPendingSession(
  db: Db, sessionId: string,
): Promise<{ sessionId: string; staffId: string } | null> {
  if (!sessionId) return null;
  const { rows } = await db.query<any>(
    `SELECT s.id AS session_id, u.id AS staff_id, u.status
       FROM session s JOIN staff_user u ON u.id = s.subject_id
      WHERE s.id = $1 AND s.subject_type = 'staff'
        AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.mfa_pending = false AND s.mfa_enroll_pending = true`,
    [sessionId],
  );
  const r = rows[0];
  if (!r || r.status !== 'active') return null;
  return { sessionId: r.session_id, staffId: r.staff_id };
}

/** Promote an enroll-gated session to fully authenticated once a factor has been confirmed. */
export async function clearMfaEnrollPending(db: Db, sessionId: string): Promise<void> {
  await db.query(`UPDATE session SET mfa_enroll_pending = false, last_seen_at = now() WHERE id = $1`, [sessionId]);
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
        AND s.mfa_pending = false          -- a half-auth (awaiting 2FA) session is NOT authenticated
        AND s.mfa_enroll_pending = false`, // nor is an enroll-gated (factor-less enforced-role) session (TRI-912)
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
    // TRI-1056: Path MUST be '/' for the __Host- prefix (browsers reject a prefixed cookie scoped to a
    // sub-path). Sent only to the admin origin; httpOnly keeps it off the SPA's JS.
    path: '/',
    maxAge: cfg.adminSessionIdleMinutes * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply, cfg: Config): void {
  reply.clearCookie(cfg.adminCookieName, { path: '/' });
}

// ── Trusted devices (TRI-983 · "Trust this device for 30 days") ───────────────
// A trusted-device credential lets an MFA-enabled staffer skip the TOTP challenge on a device they have
// already verified, for a fixed 30-day window. It is deliberately SEPARATE from the session cookie: the
// session is short-lived (30-min sliding idle) and revoked on logout, whereas trust must survive logout
// and outlive the session. We store only the SHA-256 of the opaque token, scope every check to a single
// staff_id, and let logout keep the trust (so the next login on this device stays fast).
const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Did a given session row carry the "trust this device" intent (checkbox at login)? Used by the MFA
 *  completion handlers to decide whether to mint a trusted-device token after the factor verifies. */
export async function sessionWasTrusted(db: Db, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const { rows } = await db.query<{ trusted_device: boolean }>(
    `SELECT trusted_device FROM session WHERE id = $1`, [sessionId]);
  return !!rows[0]?.trusted_device;
}

/** Mint a trusted-device token for this staffer: random 32-byte secret, stored only as its SHA-256 hash
 *  with a 30-day TTL. Returns the RAW token for the caller to drop into the tk_admin_trust cookie. */
export async function issueTrustedDevice(
  db: Db, cfg: Config, staffId: string, meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO trusted_device (staff_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + ($3 * interval '1 day'), $4, $5)`,
    [staffId, sha256hex(token), cfg.trustedDeviceDays, meta.ip ?? null, meta.userAgent ?? null],
  );
  return token;
}

/** Honor a presented trusted-device cookie: true iff it matches a LIVE (not expired/revoked) row for THIS
 *  staff user. Scoping to staffId is the guard that a device trusted for account A can never skip MFA for
 *  account B. Stamps last_used_at on a hit. */
export async function verifyTrustedDevice(
  db: Db, staffId: string, token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM trusted_device
      WHERE staff_id = $1 AND token_hash = $2
        AND revoked_at IS NULL AND expires_at > now()`,
    [staffId, sha256hex(token)],
  );
  const hit = rows[0];
  if (!hit) return false;
  await db.query(`UPDATE trusted_device SET last_used_at = now() WHERE id = $1`, [hit.id]);
  return true;
}

/** Forget every trusted device for a staffer (e.g. when MFA is disabled). Idempotent. */
export async function revokeTrustedDevices(db: Db, staffId: string): Promise<void> {
  await db.query(
    `UPDATE trusted_device SET revoked_at = now() WHERE staff_id = $1 AND revoked_at IS NULL`, [staffId]);
}

export function setTrustCookie(reply: FastifyReply, cfg: Config, token: string): void {
  reply.setCookie(cfg.adminTrustCookieName, token, {
    httpOnly: true,
    secure: cfg.adminCookieSecure,
    sameSite: cfg.adminCookieSameSite,
    path: cfg.adminPrefix,
    maxAge: cfg.trustedDeviceDays * 24 * 60 * 60,
  });
}

export function clearTrustCookie(reply: FastifyReply, cfg: Config): void {
  reply.clearCookie(cfg.adminTrustCookieName, { path: cfg.adminPrefix });
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

/** TRI-912 preHandler: allow EITHER a full session OR an enroll-gated one (a factor-less enforced-role
 *  login). Used only by the /auth/mfa enroll+verify endpoints so a gated staffer can complete enrollment;
 *  every other route keeps the strict `requireAuth`. Attaches req.staff and req.mfaEnrollPending. */
export function makeRequireAuthAllowingEnroll(db: Db, cfg: Config) {
  return async function requireAuthAllowingEnroll(req: FastifyRequest, reply: FastifyReply) {
    const sid = req.cookies?.[cfg.adminCookieName];
    if (sid) {
      const staff = await resolveSession(db, cfg, sid);
      if (staff) { req.staff = staff; req.mfaEnrollPending = false; return; }
      const enroll = await resolveEnrollPendingSession(db, sid);
      if (enroll) {
        const { rows } = await db.query<any>(
          `SELECT id, email, name, role, job_title FROM staff_user WHERE id = $1`, [enroll.staffId]);
        const u = rows[0];
        if (u) {
          req.staff = { id: u.id, email: u.email, name: u.name ?? null, role: u.role, jobTitle: u.job_title ?? null,
            permissions: await permissionsFor(db, u.role) };
          req.mfaEnrollPending = true;
          return;
        }
      }
    }
    return unauthorized(reply);
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
