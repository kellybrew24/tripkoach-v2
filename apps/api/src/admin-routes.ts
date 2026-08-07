// TRI-869 Phase 3 · Admin realm routes, mounted under cfg.adminPrefix (default /api/admin) as an
// encapsulated Fastify plugin so the consumer /api/v1 read paths stay byte-identical. AuthN via session
// cookie; every write is guarded by a permission preHandler and audited inside the service.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import {
  verifyPassword, createSession, revokeSession, resolveSession,
  setSessionCookie, clearSessionCookie, permissionsFor,
  makeRequireAuth, makeRequirePermission, audit, type Permission,
} from './auth.ts';
import { createAdminService, AdminError, ValidationError } from './admin.ts';

export function registerAdmin(app: FastifyInstance, db: Db, cfg: Config): void {
  const svc = createAdminService(db, cfg);
  const auth = makeRequireAuth(db, cfg);
  const perm = (p: Permission) => ({ preHandler: makeRequirePermission(db, cfg, p) });
  const actorOf = (req: FastifyRequest) => ({ id: req.staff!.id, ip: req.ip ?? null });
  const body = (req: FastifyRequest) => (req.body ?? {}) as unknown;
  const query = (req: FastifyRequest) => (req.query ?? {}) as Record<string, unknown>;
  const qStr = (q: Record<string, unknown>, k: string) => (q[k] != null ? String(q[k]) : undefined);
  const qNum = (q: Record<string, unknown>, k: string) => (q[k] != null ? Number(q[k]) : undefined);

  app.register(async (admin) => {
    // Map service errors to the shared { error: { code, message } } envelope.
    admin.setErrorHandler((err: any, _req, reply) => {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: { code: err.code, message: err.message, field: err.field } });
      }
      if (err instanceof AdminError) {
        return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message } });
      }
      if ((err as any).statusCode === 400) {
        return reply.code(400).send({ error: { code: 'bad_request', message: err.message } });
      }
      admin.log.error(err);
      return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
    });

    // ── AuthN ────────────────────────────────────────────────────────────────
    admin.post('/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      const password = typeof b.password === 'string' ? b.password : '';
      if (!email || !password) {
        return reply.code(400).send({ error: { code: 'validation', message: 'email and password are required' } });
      }
      const u = (await db.query(`SELECT * FROM staff_user WHERE lower(email) = $1`, [email])).rows[0];
      const ok = u && u.status === 'active' && (await verifyPassword(password, u.password_hash));
      if (!ok) {
        await audit(db, { actorId: u?.id ?? null, action: 'staff.login_failed', targetType: 'staff_user', targetId: u?.id ?? null, after: { email }, ip: req.ip ?? null });
        return reply.code(401).send({ error: { code: 'invalid_credentials', message: 'That email and password do not match.' } });
      }
      const sid = await createSession(db, cfg, u.id, {
        ip: req.ip, userAgent: req.headers['user-agent'], trustedDevice: b.trustDevice === true,
      });
      setSessionCookie(reply, cfg, sid);
      await audit(db, { actorId: u.id, action: 'staff.login', targetType: 'staff_user', targetId: u.id, ip: req.ip ?? null });
      return {
        staff: { id: u.id, email: u.email, name: u.name ?? null, role: u.role, jobTitle: u.job_title ?? null },
        permissions: [...await permissionsFor(db, u.role)],
      };
    });

    admin.post('/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
      const sid = req.cookies?.[cfg.adminCookieName];
      if (sid) {
        const staff = await resolveSession(db, cfg, sid).catch(() => null);
        await revokeSession(db, sid);
        if (staff) await audit(db, { actorId: staff.id, action: 'staff.logout', targetType: 'staff_user', targetId: staff.id, ip: req.ip ?? null });
      }
      clearSessionCookie(reply, cfg);
      return { ok: true };
    });

    admin.get('/me', { preHandler: auth }, async (req: FastifyRequest) => {
      const s = req.staff!;
      return {
        staff: { id: s.id, email: s.email, name: s.name, role: s.role, jobTitle: s.jobTitle },
        permissions: [...s.permissions],
      };
    });

    // ── Regions ────────────────────────────────────────────────────────────
    admin.get('/regions', perm('tours.view'), async () => ({ regions: await svc.listRegions() }));
    admin.post('/regions', perm('tours.edit'), async (req, reply) => reply.code(201).send(await svc.createRegion(body(req), actorOf(req))));
    admin.patch('/regions/:id', perm('tours.edit'), async (req) => svc.updateRegion((req.params as any).id, body(req), actorOf(req)));
    admin.delete('/regions/:id', perm('tours.edit'), async (req) => svc.deleteRegion((req.params as any).id, actorOf(req)));

    // ── Tours ────────────────────────────────────────────────────────────────
    admin.get('/tours', perm('tours.view'), async () => ({ tours: await svc.listTours() }));
    admin.get('/tours/:idOrSlug', perm('tours.view'), async (req) => svc.getTour((req.params as any).idOrSlug));
    admin.post('/tours', perm('tours.edit'), async (req, reply) => reply.code(201).send(await svc.createTour(body(req), actorOf(req))));
    admin.patch('/tours/:idOrSlug', perm('tours.edit'), async (req) => svc.updateTour((req.params as any).idOrSlug, body(req), actorOf(req)));
    admin.post('/tours/:idOrSlug/publish', perm('tours.edit'), async (req) => svc.setTourPublished((req.params as any).idOrSlug, true, actorOf(req)));
    admin.post('/tours/:idOrSlug/unpublish', perm('tours.edit'), async (req) => svc.setTourPublished((req.params as any).idOrSlug, false, actorOf(req)));
    admin.delete('/tours/:idOrSlug', perm('tours.edit'), async (req) => svc.deleteTour((req.params as any).idOrSlug, actorOf(req)));

    // ── Departures / schedules ─────────────────────────────────────────────────
    admin.get('/departures', perm('tours.view'), async (req) => ({ departures: await svc.listDepartures({ tourId: qStr(query(req), 'tourId') }) }));
    admin.post('/departures', perm('tours.edit'), async (req, reply) => reply.code(201).send(await svc.createDeparture(body(req), actorOf(req))));
    admin.patch('/departures/:id', perm('tours.edit'), async (req) => svc.updateDeparture((req.params as any).id, body(req), actorOf(req)));
    admin.post('/departures/:id/cancel', perm('tours.edit'), async (req) => svc.cancelDeparture((req.params as any).id, body(req), actorOf(req)));

    // ── Bookings (view + transitions) ──────────────────────────────────────────
    admin.get('/bookings', perm('bookings.view'), async (req) => {
      const q = query(req);
      return svc.listBookings({ status: qStr(q, 'status'), q: qStr(q, 'q'), page: qNum(q, 'page'), pageSize: qNum(q, 'pageSize') });
    });
    admin.get('/bookings/:ref', perm('bookings.view'), async (req) => svc.getBooking((req.params as any).ref));
    admin.post('/bookings/:ref/confirm', perm('bookings.manage'), async (req) => svc.confirmBooking((req.params as any).ref, actorOf(req)));
    admin.post('/bookings/:ref/cancel', perm('bookings.cancel'), async (req) => svc.cancelBooking((req.params as any).ref, body(req), actorOf(req)));

    // ── Payments (view + refund FLAG) ──────────────────────────────────────────
    admin.get('/payments', perm('bookings.view'), async (req) => {
      const q = query(req);
      return svc.listPayments({ status: qStr(q, 'status'), q: qStr(q, 'q'), page: qNum(q, 'page'), pageSize: qNum(q, 'pageSize') });
    });
    admin.get('/payments/:ref', perm('bookings.view'), async (req) => svc.getPayment((req.params as any).ref));
    admin.post('/payments/:ref/refund', perm('payments.refund'), async (req) => svc.flagRefund((req.params as any).ref, body(req), actorOf(req)));
  }, { prefix: cfg.adminPrefix });
}
