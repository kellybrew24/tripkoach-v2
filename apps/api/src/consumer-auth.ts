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
/** Create a server-side consumer session; returns its id (the opaque cookie bearer). */
export async function createUserSession(
  db: Db, cfg: Config, userId: string,
  meta: { ip?: string; userAgent?: string; trustedDevice?: boolean } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO session (subject_type, subject_id, expires_at, trusted_device, ip, user_agent)
     VALUES ('user', $1, now() + ($2 * interval '1 minute'), $3, $4, $5)
     RETURNING id`,
    [userId, cfg.consumer.sessionIdleMinutes, !!meta.trustedDevice, meta.ip ?? null, meta.userAgent ?? null],
  );
  return rows[0].id;
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
        AND s.revoked_at IS NULL AND s.expires_at > now()`,
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
// Secure/SameSite reuse the shared COOKIE_* posture (same browser + TLS as admin); the cookie is scoped
// to the consumer API prefix so it never leaks onto the admin realm.
export function setUserCookie(reply: FastifyReply, cfg: Config, sessionId: string): void {
  reply.setCookie(cfg.consumer.cookieName, sessionId, {
    httpOnly: true,
    secure: cfg.adminCookieSecure,
    sameSite: cfg.adminCookieSameSite,
    path: cfg.apiPrefix,
    maxAge: cfg.consumer.sessionIdleMinutes * 60,
  });
}

export function clearUserCookie(reply: FastifyReply, cfg: Config): void {
  reply.clearCookie(cfg.consumer.cookieName, { path: cfg.apiPrefix });
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
