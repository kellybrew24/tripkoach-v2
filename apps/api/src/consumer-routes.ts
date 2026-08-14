// TRI-881 P1 · Consumer accounts & auth routes, mounted under cfg.apiPrefix (default /api/v1) as an
// encapsulated Fastify plugin — the existing Phase-1 read paths and Phase-2 booking writes stay
// byte-identical; this plugin adds ONLY the /auth/* and /me[...] surface. AuthN is a session cookie
// (subject_type='user'); mutations are audited inside the service.
//
// The session cookie is minted here (not in the service) so the service stays transport-agnostic:
// signup/login return a UserContext, the route creates the session + sets the cookie.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { createConsumerService, ConsumerError } from './consumer.ts';
import { createConsumerMfaService } from './consumer-mfa.ts';
import {
  createUserSession, revokeUserSession, setUserCookie, clearUserCookie, makeRequireUser, resolveUserSession,
  resolvePendingUserSession, clearUserMfaPending,
} from './consumer-auth.ts';
import { audit, accountLockedUntil, recordFailedLogin, recordMfaFailure, lockoutMessage } from './auth.ts';
import { createMediaService, MediaError } from './media.ts';
import { createStorage, type Storage } from './storage.ts';
import { createAvatarService, AvatarError, AVATAR_MAX_BYTES } from './avatar.ts';
import { createMailGate, type MailGate } from './rate-gate.ts';

export function registerConsumer(app: FastifyInstance, db: Db, cfg: Config, storage?: Storage, mailGate?: MailGate): void {
  const svc = createConsumerService(db, cfg);
  // TRI-1124 (#5): per-IP + per-target mail-velocity gate. Shared instance passed from server.ts so the
  // per-target budget is unified with the admin realm; falls back to a local gate if invoked standalone.
  const gate = mailGate ?? createMailGate(cfg, (m) => app.log.warn(m));
  const emailOf = (req: FastifyRequest) => { const b = (req.body ?? {}) as any; return typeof b.email === 'string' ? b.email : null; };
  const mfaSvc = createConsumerMfaService(db, cfg);
  // TRI-943: avatar upload rides the shared TRI-918 R2 media pipeline. Storage is 'enabled' only when the
  // R2 credentials are present; unconfigured → the upload route answers 503 (same posture as admin media).
  const mediaSvc = createMediaService(db, cfg, storage ?? createStorage(cfg.media));
  const avatarSvc = createAvatarService(db, cfg, mediaSvc);
  const requireUser = makeRequireUser(db, cfg);
  const authed = { preHandler: requireUser };
  const body = (req: FastifyRequest) => (req.body ?? {}) as unknown;
  const ipOf = (req: FastifyRequest) => ({ ip: req.ip ?? null });

  // TRI-1055 [SEC-H3]: per-IP throttle on the unauthenticated auth routes (login, signup/register,
  // password-reset request). @fastify/rate-limit is registered global:false in server.ts (with
  // trustProxy so req.ip is the real client behind Caddy); a route is only throttled where it opts in
  // via config.rateLimit. 10 / minute per IP — generous for a human, a cheap wall against credential
  // stuffing / enumeration. Empty under `test` so the smoke/e2e suites can hit these routes many times
  // from one loopback IP (mirrors the admin login opt-in from TRI-1054). Email-verify resend already
  // has its own per-account throttle in the service, so it is intentionally left off the IP limiter.
  const authRateLimit: Record<string, unknown> = cfg.env === 'test'
    ? {}
    : { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.register(async (api) => {
    // Map service errors to the shared { error: { code, message } } envelope.
    api.setErrorHandler((err: any, _req, reply) => {
      if (err instanceof ConsumerError || err instanceof AvatarError || err instanceof MediaError) {
        return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } });
      }
      // Fastify raises FST_ERR_CTP_BODY_TOO_LARGE (413) when an avatar upload exceeds the route bodyLimit.
      if ((err as any).statusCode === 413 || (err as any).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return reply.code(413).send({ error: { code: 'too_large', message: 'Image exceeds the upload size limit.' } });
      }
      if (err?.statusCode === 400) {
        return reply.code(400).send({ error: { code: 'bad_request', message: err.message } });
      }
      // TRI-1055: @fastify/rate-limit throws a 429 Error when a per-IP auth limit is exceeded.
      if ((err as any).statusCode === 429) {
        return reply.code(429).send({ error: { code: 'rate_limited', message: err.message || 'Too many attempts. Please wait and try again.' } });
      }
      api.log.error(err);
      return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
    });

    // TRI-943: buffer raw avatar image bytes (the SPA sends the File/Blob directly; curl uses
    // --data-binary). Scoped to THIS consumer plugin — the JSON /auth + /me paths are untouched because
    // Fastify keeps the built-in application/json parser for every other content type.
    const AVATAR_CTYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/octet-stream'];
    api.addContentTypeParser(AVATAR_CTYPES, { parseAs: 'buffer' }, (_req, buf, done) => done(null, buf));

    // ── Signup (creates the account, links guest bookings, opens a session) ──
    const signup = async (req: FastifyRequest, reply: FastifyReply) => {
      const out = await svc.signup(body(req), ipOf(req));
      const sid = await createUserSession(db, cfg, out.user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
      setUserCookie(reply, cfg, sid);
      return reply.code(201).send(out);
    };
    api.post('/auth/signup', authRateLimit, signup);
    api.post('/auth/register', authRateLimit, signup); // FE kits reference both names — alias to one handler

    // ── Login ──
    // A 2FA-enabled account (TRI-1029) does not get a full session here: verifyLogin returns
    // { mfaRequired, pendingUserId } after the password check, and we mint a half-auth (mfa_pending)
    // session + set the cookie so POST /auth/mfa can find and complete it. The client sees only
    // { mfaRequired: true } and prompts for the authenticator code.
    api.post('/auth/login', authRateLimit, async (req: FastifyRequest, reply: FastifyReply) => {
      const out = await svc.verifyLogin(body(req), ipOf(req));
      if ((out as any).mfaRequired) {
        const sid = await createUserSession(db, cfg, (out as any).pendingUserId, { ip: req.ip, userAgent: req.headers['user-agent'], mfaPending: true });
        setUserCookie(reply, cfg, sid);
        return { mfaRequired: true };
      }
      const sid = await createUserSession(db, cfg, out.user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
      setUserCookie(reply, cfg, sid);
      return out;
    });

    // ── MFA login challenge (TRI-1029) — completes a half-auth (mfa_pending) session ──
    // Reads the pending session from the cookie, verifies the authenticator/recovery code, clears the
    // pending flag, and returns the same { user, linkedBookings } a normal login would. 401 if there's no
    // pending challenge or the code is wrong (the pending session is left intact so the user can retry).
    api.post('/auth/mfa', authRateLimit, async (req: FastifyRequest, reply: FastifyReply) => {
      const sid = req.cookies?.[cfg.consumer.cookieName];
      const pending = sid ? await resolvePendingUserSession(db, sid) : null;
      if (!pending) {
        return reply.code(401).send({ error: { code: 'no_challenge', message: 'No pending sign-in to verify. Please sign in again.' } });
      }
      // TRI-1061: MFA failures feed the same per-account lockout as password failures — reject a locked
      // account before spending a verify and kill the half-auth cookie so it can't be reused. The lock
      // helpers take a snake_case row; resolvePendingUserSession hands back camelCase, so adapt once here.
      const lockRow = { id: pending.userId, failed_login_count: pending.failedLoginCount, locked_until: pending.lockedUntil };
      const lockedUntil = accountLockedUntil(lockRow);
      if (lockedUntil) {
        await revokeUserSession(db, pending.sessionId);
        clearUserCookie(reply, cfg);
        await audit(db, { actorType: 'user', actorId: pending.userId, action: 'user.login_locked', targetType: 'user_account', targetId: pending.userId, after: { via: 'mfa' }, ip: req.ip ?? null });
        return reply.code(429).send({ error: { code: 'account_locked', message: lockoutMessage(lockedUntil) } });
      }
      const b = (body(req) ?? {}) as { code?: unknown };
      const ok = await mfaSvc.verifyChallenge(pending.userId, String(b.code ?? ''));
      if (!ok) {
        // TRI-1061: bump BOTH the per-account lockout (same counter as a password miss — mig 030) and the
        // per-session cap. The account lock stops IP-rotating guessers; the session cap forces a full
        // re-login even from a single IP.
        const justLocked = await recordFailedLogin(db, lockRow, 'user_account');
        const cap = await recordMfaFailure(db, pending.sessionId);
        await audit(db, { actorType: 'user', actorId: pending.userId, action: 'user.mfa_failed', targetType: 'user_account', targetId: pending.userId, after: { attempts: cap.count, locked: !!justLocked }, ip: req.ip ?? null });
        if (justLocked) {
          clearUserCookie(reply, cfg);
          return reply.code(429).send({ error: { code: 'account_locked', message: lockoutMessage(justLocked) } });
        }
        if (cap.revoked) {
          clearUserCookie(reply, cfg);
          return reply.code(401).send({ error: { code: 'too_many_attempts', message: 'Too many incorrect codes. Please sign in again.' } });
        }
        return reply.code(401).send({ error: { code: 'invalid_code', message: 'That code did not match. Try again, or use a recovery code.' } });
      }
      await clearUserMfaPending(db, cfg, pending.sessionId);
      return svc.completeMfaLogin(pending.userId, ipOf(req));
    });

    // ── Logout ──
    api.post('/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
      const sid = req.cookies?.[cfg.consumer.cookieName];
      if (sid) await revokeUserSession(db, sid);
      clearUserCookie(reply, cfg);
      return { ok: true };
    });

    // ── Password reset (public; request is always 200 to avoid user enumeration) ──
    // TRI-1124 (#5): per-IP + per-target mail gate on top of the per-IP authRateLimit — stops bombing a
    // single victim's inbox with reset mails (across rotating IPs) without leaking whether the account exists.
    api.post('/auth/password-reset/request', authRateLimit, async (req: FastifyRequest) => {
      gate.check({ ip: req.ip, target: emailOf(req) });
      return svc.requestPasswordReset(body(req), ipOf(req));
    });
    // TRI-1061: throttle consume too (defence-in-depth; the token is 256-bit but the endpoint was unthrottled).
    api.post('/auth/password-reset/consume', authRateLimit, async (req: FastifyRequest) => svc.consumePasswordReset(body(req), ipOf(req)));

    // ── Email verification (TRI-941) ──
    // Consume is public — the emailed link carries the single-use token; the FE /verify-email page POSTs it.
    // TRI-1061: per-IP throttle the token-consume too (defence-in-depth over the opaque token).
    api.post('/auth/verify-email', authRateLimit, async (req: FastifyRequest) => svc.verifyEmail(body(req), ipOf(req)));
    // Resend is public but session-aware: an authed caller resends to their own account; otherwise the
    // caller passes { email } and always gets { ok: true } (no enumeration). It has a per-account service
    // throttle (60s); TRI-1061 adds a per-IP limit on top to stop cross-account enumeration/email spam.
    api.post('/auth/resend-verification', authRateLimit, async (req: FastifyRequest) => {
      const sid = req.cookies?.[cfg.consumer.cookieName];
      const account = sid ? await resolveUserSession(db, cfg, sid) : null;
      const b = (body(req) ?? {}) as { email?: unknown };
      // TRI-1124 (#5): per-target gate keyed on the account (authed) or the requested inbox (public).
      gate.check({ ip: req.ip, target: account ? `user:${account.id}` : (typeof b.email === 'string' ? b.email : null) });
      return account
        ? svc.resendVerification({ userId: account.id }, ipOf(req))
        : svc.resendVerification({ email: b.email }, ipOf(req));
    });

    // ── Profile + preferences (authed) ──
    api.get('/me', authed, async (req: FastifyRequest) => ({ user: await svc.getProfile(req.account!.id) }));
    api.patch('/me', authed, async (req: FastifyRequest) => ({ user: await svc.updateProfile(req.account!.id, body(req), ipOf(req)) }));
    api.post('/me/password', authed, async (req: FastifyRequest) => svc.changePassword(req.account!.id, body(req), ipOf(req)));

    // ── Two-factor (TOTP) self-service (authed, TRI-1029) ──
    // status → { enabled }; enroll issues a secret + otpauth URI (the FE renders the QR client-side, never
    // sending the secret to a third party); verify confirms the first code + returns one-time recovery
    // codes; disable requires a current code; recovery-codes regenerates the set.
    const mfaCode = (req: FastifyRequest) => ((body(req) ?? {}) as { code?: unknown }).code;
    api.get('/auth/mfa/status', authed, async (req: FastifyRequest) => mfaSvc.status(req.account!.id));
    api.post('/auth/mfa/enroll', authed, async (req: FastifyRequest) => mfaSvc.enroll(req.account!.id, req.ip ?? null));
    api.post('/auth/mfa/verify', authed, async (req: FastifyRequest) => mfaSvc.verifyEnroll(req.account!.id, mfaCode(req), req.ip ?? null));
    api.post('/auth/mfa/disable', authed, async (req: FastifyRequest) => mfaSvc.disable(req.account!.id, mfaCode(req), req.ip ?? null));
    api.post('/auth/mfa/recovery-codes', authed, async (req: FastifyRequest) => mfaSvc.regenerateRecoveryCodes(req.account!.id, req.ip ?? null));
    // TRI-1012: delete my account — soft-delete/anonymize in the service, then kill this session +
    // clear the cookie so the browser is signed out immediately. 409 if active bookings remain.
    api.delete('/me', authed, async (req: FastifyRequest, reply: FastifyReply) => {
      const out = await svc.deleteAccount(req.account!.id, ipOf(req));
      const sid = req.cookies?.[cfg.consumer.cookieName];
      if (sid) await revokeUserSession(db, sid);
      clearUserCookie(reply, cfg);
      return out;
    });

    // ── Notification preferences (authed) ──
    api.get('/me/notifications', authed, async (req: FastifyRequest) => ({ notifications: await svc.getNotificationPrefs(req.account!.id) }));
    api.put('/me/notifications', authed, async (req: FastifyRequest) => ({ notifications: await svc.updateNotificationPrefs(req.account!.id, body(req), ipOf(req)) }));

    // ── My bookings (authed) ──
    api.get('/me/bookings', authed, async (req: FastifyRequest) => ({ bookings: await svc.listMyBookings(req.account!.id) }));

    // ── My reviews + pending review invites (authed, TRI-1016) ──
    api.get('/me/reviews', authed, async (req: FastifyRequest) => svc.listMyReviews(req.account!.id));

    // ── Avatar (TRI-943) ──────────────────────────────────────────────────────
    const avatarActor = (req: FastifyRequest) => ({ id: req.account!.id, ip: req.ip ?? null });
    // Upload my avatar. Raw image bytes in the body; filename via ?filename= or X-Filename. Hardened
    // validation + Option A auto-approve live inside the service.
    api.post('/me/avatar', {
      preHandler: requireUser,
      // Allow the avatar cap (+slack) past Fastify's 1MB default, scoped to this route only.
      bodyLimit: AVATAR_MAX_BYTES + 1024,
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const raw = req.body;
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.isBuffer((raw as any)?.data) ? (raw as any).data : null;
      if (!bytes) {
        return reply.code(415).send({ error: { code: 'unsupported_type', message: 'Send the raw image bytes with an image/* Content-Type.' } });
      }
      const q = (req.query ?? {}) as Record<string, unknown>;
      const filename = (q.filename != null ? String(q.filename) : undefined) ?? (req.headers['x-filename'] as string | undefined) ?? null;
      const declaredType = (req.headers['content-type'] as string | undefined) ?? null;
      return avatarSvc.uploadAvatar(req.account!.id, bytes, { filename, declaredType }, avatarActor(req));
    });
    // Clear my avatar back to the default placeholder.
    api.delete('/me/avatar', authed, async (req: FastifyRequest) => avatarSvc.deleteAvatar(req.account!.id, avatarActor(req)));

    // Report another customer's avatar → auto-hides on first report (rate-limited).
    api.post('/avatars/:userId/report', authed, async (req: FastifyRequest) => {
      const b = (req.body ?? {}) as { reason?: unknown };
      const reason = typeof b.reason === 'string' ? b.reason : null;
      return avatarSvc.reportAvatar(req.account!.id, (req.params as any).userId, reason, avatarActor(req));
    });
  }, { prefix: cfg.apiPrefix });
}
