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
import {
  createUserSession, revokeUserSession, setUserCookie, clearUserCookie, makeRequireUser,
} from './consumer-auth.ts';

export function registerConsumer(app: FastifyInstance, db: Db, cfg: Config): void {
  const svc = createConsumerService(db, cfg);
  const requireUser = makeRequireUser(db, cfg);
  const authed = { preHandler: requireUser };
  const body = (req: FastifyRequest) => (req.body ?? {}) as unknown;
  const ipOf = (req: FastifyRequest) => ({ ip: req.ip ?? null });

  app.register(async (api) => {
    // Map service errors to the shared { error: { code, message } } envelope.
    api.setErrorHandler((err: any, _req, reply) => {
      if (err instanceof ConsumerError) {
        return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } });
      }
      if (err?.statusCode === 400) {
        return reply.code(400).send({ error: { code: 'bad_request', message: err.message } });
      }
      api.log.error(err);
      return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
    });

    // ── Signup (creates the account, links guest bookings, opens a session) ──
    const signup = async (req: FastifyRequest, reply: FastifyReply) => {
      const out = await svc.signup(body(req), ipOf(req));
      const sid = await createUserSession(db, cfg, out.user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
      setUserCookie(reply, cfg, sid);
      return reply.code(201).send(out);
    };
    api.post('/auth/signup', signup);
    api.post('/auth/register', signup); // FE kits reference both names — alias to one handler

    // ── Login ──
    api.post('/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
      const out = await svc.verifyLogin(body(req), ipOf(req));
      const sid = await createUserSession(db, cfg, out.user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
      setUserCookie(reply, cfg, sid);
      return out;
    });

    // ── Logout ──
    api.post('/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
      const sid = req.cookies?.[cfg.consumer.cookieName];
      if (sid) await revokeUserSession(db, sid);
      clearUserCookie(reply, cfg);
      return { ok: true };
    });

    // ── Password reset (public; request is always 200 to avoid user enumeration) ──
    api.post('/auth/password-reset/request', async (req: FastifyRequest) => svc.requestPasswordReset(body(req), ipOf(req)));
    api.post('/auth/password-reset/consume', async (req: FastifyRequest) => svc.consumePasswordReset(body(req), ipOf(req)));

    // ── Profile + preferences (authed) ──
    api.get('/me', authed, async (req: FastifyRequest) => ({ user: await svc.getProfile(req.account!.id) }));
    api.patch('/me', authed, async (req: FastifyRequest) => ({ user: await svc.updateProfile(req.account!.id, body(req), ipOf(req)) }));
    api.post('/me/password', authed, async (req: FastifyRequest) => svc.changePassword(req.account!.id, body(req), ipOf(req)));

    // ── Notification preferences (authed) ──
    api.get('/me/notifications', authed, async (req: FastifyRequest) => ({ notifications: await svc.getNotificationPrefs(req.account!.id) }));
    api.put('/me/notifications', authed, async (req: FastifyRequest) => ({ notifications: await svc.updateNotificationPrefs(req.account!.id, body(req), ipOf(req)) }));

    // ── My bookings (authed) ──
    api.get('/me/bookings', authed, async (req: FastifyRequest) => ({ bookings: await svc.listMyBookings(req.account!.id) }));
  }, { prefix: cfg.apiPrefix });
}
