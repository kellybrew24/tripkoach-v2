// TRI-881 P1 · Consumer authN. The customer-facing analogue of the admin auth in auth.ts: session-cookie
// auth against user_account (argon2id), server-side sessions (revocable + sliding idle expiry) on
// subject_type='user'. This closes gap G-ConsumerSession — the session table already permitted 'user'
// (migration 006), but until now only the admin realm had a code path that created/resolved sessions.
//
// We deliberately reuse the primitives from auth.ts (hashPassword / verifyPassword) rather than fork the
// crypto, and mirror its session shape. What differs: the subject is a user_account (no role/permission
// vocabulary — consumers are all equal), the cookie name/path/idle window come from cfg.consumer, and the
// resolved context (UserContext) is attached to req.account.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { Config } from './config.ts';

export interface UserContext {
  id: string;
  email: string;
  name: string | null;
}

// Attach the resolved consumer-account context to the request for downstream handlers. Named `account`
// so it never collides with the admin realm's req.staff (a request only ever carries one or the other).
declare module 'fastify' {
  interface FastifyRequest {
    account?: UserContext;
  }
}

// ── Sessions (subject_type='user') ───────────────────────────────────────────
/** Create a server-side consumer session; returns its id (the opaque cookie bearer).
 *  `mfaPending` mints a half-auth session (TRI-1029): it resolves to NO context (resolveUserSession
 *  skips it) until the /auth/mfa login challenge clears the flag — the second-factor gate. */
export async function createUserSession(
  db: Db, cfg: Config, userId: string,
  meta: { ip?: string; userAgent?: string; trustedDevice?: boolean; mfaPending?: boolean } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO session (subject_type, subject_id, expires_at, trusted_device, ip, user_agent, mfa_pending)
     VALUES ('user', $1, now() + ($2 * interval '1 minute'), $3, $4, $5, $6)
     RETURNING id`,
    [userId, cfg.consumer.sessionIdleMinutes, !!meta.trustedDevice, meta.ip ?? null, meta.userAgent ?? null, !!meta.mfaPending],
  );
  return rows[0].id;
}

/** Resolve a live but MFA-PENDING consumer session → the pending user's id (for the /auth/mfa challenge).
 *  null unless the session is live, unrevoked, and still awaiting its second factor. */
export async function resolvePendingUserSession(
  db: Db, sessionId: string,
): Promise<{ sessionId: string; userId: string; failedLoginCount: number; lockedUntil: Date | null } | null> {
  if (!sessionId) return null;
  const { rows } = await db.query<any>(
    // TRI-1061: also surface the per-account lockout state (added to user_account in mig 030) so the
    // /auth/mfa challenge can reject a locked account and feed MFA failures into the same counter.
    `SELECT s.id AS session_id, s.subject_id AS user_id, u.failed_login_count, u.locked_until
       FROM session s JOIN user_account u ON u.id = s.subject_id
      WHERE s.id = $1 AND s.subject_type = 'user' AND s.mfa_pending = true
        AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sessionId],
  );
  const r = rows[0];
  return r ? {
    sessionId: r.session_id, userId: r.user_id,
    failedLoginCount: r.failed_login_count ?? 0,
    lockedUntil: r.locked_until ? new Date(r.locked_until) : null,
  } : null;
}

/** Clear the MFA-pending flag on a session (called after a successful login challenge) + slide the window. */
export async function clearUserMfaPending(db: Db, cfg: Config, sessionId: string): Promise<void> {
  await db.query(
    `UPDATE session SET mfa_pending = false, last_seen_at = now(),
            expires_at = now() + ($2 * interval '1 minute') WHERE id = $1`,
    [sessionId, cfg.consumer.sessionIdleMinutes],
  );
}

export async function revokeUserSession(db: Db, sessionId: string): Promise<void> {
  await db.query(`UPDATE session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

/** Revoke every live session for a user (used after a password reset / change). Returns rows revoked. */
export async function revokeAllUserSessions(db: Db, userId: string): Promise<number> {
  const r = await db.query(
    `UPDATE session SET revoked_at = now()
      WHERE subject_type = 'user' AND subject_id = $1 AND revoked_at IS NULL`, [userId]);
  return r.rowCount ?? 0;
}

/** Resolve a live consumer session → UserContext, applying sliding idle expiry. null if absent/expired/revoked. */
export async function resolveUserSession(db: Db, cfg: Config, sessionId: string): Promise<UserContext | null> {
  if (!sessionId) return null;
  const { rows } = await db.query<any>(
    `SELECT s.id AS session_id, u.id, u.email, u.name
       FROM session s
       JOIN user_account u ON u.id = s.subject_id
      WHERE s.id = $1 AND s.subject_type = 'user'
        AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.mfa_pending = false
        AND u.deleted_at IS NULL`,
    [sessionId],
  );
  const r = rows[0];
  if (!r) return null;

  // Sliding expiry: extend the idle window and stamp activity on the session.
  await db.query(
    `UPDATE session SET last_seen_at = now(), expires_at = now() + ($2 * interval '1 minute') WHERE id = $1`,
    [r.session_id, cfg.consumer.sessionIdleMinutes],
  );
  return { id: r.id, email: r.email, name: r.name ?? null };
}

// ── Cookie helpers ───────────────────────────────────────────────────────────
// Secure/SameSite reuse the shared COOKIE_* posture (same browser + TLS as admin). Path is '/' (required
// by the __Host- prefix, TRI-1056); realm separation is by distinct origin (app. vs admin.), not path.
export function setUserCookie(reply: FastifyReply, cfg: Config, sessionId: string): void {
  reply.setCookie(cfg.consumer.cookieName, sessionId, {
    httpOnly: true,
    secure: cfg.adminCookieSecure,
    sameSite: cfg.adminCookieSameSite,
    // TRI-1056: Path MUST be '/' for the __Host- prefix. The consumer SPA reads the session only via
    // same-origin /api fetches (which SameSite=strict still carries), so strict doesn't break the app.
    path: '/',
    maxAge: cfg.consumer.sessionIdleMinutes * 60,
  });
}

export function clearUserCookie(reply: FastifyReply, cfg: Config): void {
  reply.clearCookie(cfg.consumer.cookieName, { path: '/' });
}

// ── Route guard (Fastify preHandler) ─────────────────────────────────────────
/** preHandler: require a valid consumer session; attaches req.account. 401 otherwise. */
export function makeRequireUser(db: Db, cfg: Config) {
  return async function requireUser(req: FastifyRequest, reply: FastifyReply) {
    const sid = req.cookies?.[cfg.consumer.cookieName];
    const account = sid ? await resolveUserSession(db, cfg, sid) : null;
    if (!account) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
    }
    req.account = account;
  };
}
