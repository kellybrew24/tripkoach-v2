// TRI-869 Phase 3 · Admin realm routes, mounted under cfg.adminPrefix (default /api/admin) as an
// encapsulated Fastify plugin so the consumer /api/v1 read paths stay byte-identical. AuthN via session
// cookie; every write is guarded by a permission preHandler and audited inside the service.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import {
  verifyPassword, createSession, revokeSession, resolveSession,
  resolvePendingSession, clearMfaPending,
  setSessionCookie, clearSessionCookie, permissionsFor,
  makeRequireAuth, makeRequirePermission, audit, type Permission,
} from './auth.ts';
import { createAdminService, AdminError, ValidationError } from './admin.ts';
import type { NotificationService } from './notifications.ts';
import { createReviewsService, ReviewError, type ReviewsService } from './reviews.ts';
import { createStaffService } from './staff.ts';
import { createPaystackClient, type PaystackClient } from './paystack.ts';

// RFC-4180-ish CSV cell: quote when the value contains a comma, quote, or newline; double embedded quotes.
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// Serialise the reconciliation report to CSV: a header, one line per payment/refund row, then a blank
// line and per-currency summary rows so finance can eyeball gross/refunded/net without re-summing.
function reconciliationCsv(report: {
  items: Array<Record<string, unknown>>;
  summary: Array<Record<string, unknown>>;
}): string {
  const cols = ['ref', 'bookingRef', 'customer', 'type', 'method', 'status', 'currency', 'amount', 'usdAmount', 'fxRate', 'ghsAmount', 'providerRef', 'refundProviderId', 'created'];
  const lines = [cols.join(',')];
  for (const r of report.items) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  lines.push('');
  lines.push(['summary_currency', 'grossPaid', 'refunded', 'net', 'charges', 'refunds'].join(','));
  for (const s of report.summary) {
    lines.push([s.currency, s.grossPaid, s.refunded, s.net, s.charges, s.refunds].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function registerAdmin(app: FastifyInstance, db: Db, cfg: Config, notifier?: NotificationService, reviews?: ReviewsService, paystack?: PaystackClient): void {
  const svc = createAdminService(db, cfg, paystack ?? createPaystackClient(cfg.paystack), notifier);
  const reviewSvc = reviews ?? createReviewsService(db, cfg);
  const staffSvc = createStaffService(db, cfg);
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
      if (err instanceof ReviewError) {
        return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message, field: err.field } });
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
      const trust = b.trustDevice === true || b.trust === true;
      // MFA-enabled staff get a half-auth session (mfa_pending); the auth guard rejects it until the
      // second factor clears it via POST /auth/mfa. The cookie is set now so the challenge can find it.
      if (u.mfa_enabled) {
        const sid = await createSession(db, cfg, u.id, {
          ip: req.ip, userAgent: req.headers['user-agent'], trustedDevice: trust, mfaPending: true,
        });
        setSessionCookie(reply, cfg, sid);
        await audit(db, { actorId: u.id, action: 'staff.mfa_challenge', targetType: 'staff_user', targetId: u.id, ip: req.ip ?? null });
        return { mfaRequired: true };
      }
      const sid = await createSession(db, cfg, u.id, {
        ip: req.ip, userAgent: req.headers['user-agent'], trustedDevice: trust,
      });
      setSessionCookie(reply, cfg, sid);
      await audit(db, { actorId: u.id, action: 'staff.login', targetType: 'staff_user', targetId: u.id, ip: req.ip ?? null });
      return {
        staff: { id: u.id, email: u.email, name: u.name ?? null, role: u.role, jobTitle: u.job_title ?? null },
        permissions: [...await permissionsFor(db, u.role)],
      };
    });

    // ── MFA login challenge — completes a half-auth (mfa_pending) session ───────
    // The FE posts the 6-digit authenticator code (or a recovery code) here after login returned
    // { mfaRequired: true }. On success we clear mfa_pending and return the same { staff, permissions }
    // shape as a plain login, so the console hydrates identically (window.TK_ADMIN_ENTER).
    admin.post('/auth/mfa', async (req: FastifyRequest, reply: FastifyReply) => {
      const sid = req.cookies?.[cfg.adminCookieName];
      const pending = sid ? await resolvePendingSession(db, sid) : null;
      if (!pending) {
        return reply.code(401).send({ error: { code: 'no_challenge', message: 'No pending sign-in to verify. Please sign in again.' } });
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const code = typeof b.code === 'string' ? b.code : '';
      const ok = await staffSvc.verifyChallenge(pending.staffId, code);
      if (!ok) {
        await audit(db, { actorId: pending.staffId, action: 'staff.mfa_failed', targetType: 'staff_user', targetId: pending.staffId, ip: req.ip ?? null });
        return reply.code(401).send({ error: { code: 'invalid_code', message: "That code didn't match or has expired." } });
      }
      await clearMfaPending(db, pending.sessionId);
      const ctx = await resolveSession(db, cfg, pending.sessionId);
      await audit(db, { actorId: pending.staffId, action: 'staff.login', targetType: 'staff_user', targetId: pending.staffId, after: { mfa: true }, ip: req.ip ?? null });
      if (!ctx) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Session expired. Please sign in again.' } });
      return {
        staff: { id: ctx.id, email: ctx.email, name: ctx.name, role: ctx.role, jobTitle: ctx.jobTitle },
        permissions: [...ctx.permissions],
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
    // TRI-892 · End a departure & request reviews: mints a one-time review invite per eligible booking
    // and emails each traveller a tokenized review link. Idempotent (no double-issue). Guarded by tours.edit
    // like the other departure actions.
    admin.post('/departures/:id/request-reviews', perm('tours.edit'), async (req) => reviewSvc.requestReviews((req.params as any).id, actorOf(req)));

    // ── Bookings (view + transitions) ──────────────────────────────────────────
    admin.get('/bookings', perm('bookings.view'), async (req) => {
      const q = query(req);
      return svc.listBookings({ status: qStr(q, 'status'), q: qStr(q, 'q'), page: qNum(q, 'page'), pageSize: qNum(q, 'pageSize') });
    });
    admin.get('/bookings/:ref', perm('bookings.view'), async (req) => svc.getBooking((req.params as any).ref));
    admin.post('/bookings/:ref/confirm', perm('bookings.manage'), async (req) => svc.confirmBooking((req.params as any).ref, actorOf(req)));
    admin.post('/bookings/:ref/cancel', perm('bookings.cancel'), async (req) => svc.cancelBooking((req.params as any).ref, body(req), actorOf(req)));

    // ── Payments (view + REAL refund + manual settlement) ──────────────────────
    admin.get('/payments', perm('bookings.view'), async (req) => {
      const q = query(req);
      return svc.listPayments({ status: qStr(q, 'status'), q: qStr(q, 'q'), page: qNum(q, 'page'), pageSize: qNum(q, 'pageSize') });
    });
    admin.get('/payments/:ref', perm('bookings.view'), async (req) => svc.getPayment((req.params as any).ref));

    // ── Staff management (A4) — guarded by users.manage ─────────────────────────
    admin.get('/staff', perm('users.manage'), async () => ({ staff: await staffSvc.listStaff() }));
    admin.post('/staff', perm('users.manage'), async (req, reply) => reply.code(201).send(await staffSvc.inviteStaff(body(req), actorOf(req))));
    admin.patch('/staff/:id', perm('users.manage'), async (req) => staffSvc.updateStaff((req.params as any).id, body(req), actorOf(req)));
    admin.post('/staff/:id/resend-invite', perm('users.manage'), async (req) => staffSvc.resendInvite((req.params as any).id, actorOf(req)));
    admin.post('/staff/:id/disable', perm('users.manage'), async (req) => staffSvc.setStatus((req.params as any).id, 'disabled', actorOf(req)));
    admin.post('/staff/:id/enable', perm('users.manage'), async (req) => staffSvc.setStatus((req.params as any).id, 'active', actorOf(req)));

    // ── Invite accept (PUBLIC — the opaque token is the credential; no session) ──
    admin.get('/staff/accept', async (req) => ({ invite: await staffSvc.previewInvite(qStr(query(req), 'token') ?? '') }));
    admin.post('/staff/accept', async (req) => staffSvc.acceptInvite(body(req)));

    // ── Admin MFA (self-service; the current staff enrolls/manages their OWN factor) ──
    admin.get('/auth/mfa/status', { preHandler: auth }, async (req) => staffSvc.mfaStatus(req.staff!.id));
    admin.post('/auth/mfa/enroll', { preHandler: auth }, async (req) => staffSvc.enrollMfa(req.staff!.id, actorOf(req)));
    admin.post('/auth/mfa/verify', { preHandler: auth }, async (req) => {
      const b = body(req) as Record<string, unknown>;
      return staffSvc.verifyMfaEnrollment(req.staff!.id, typeof b.code === 'string' ? b.code : '', actorOf(req));
    });
    admin.post('/auth/mfa/disable', { preHandler: auth }, async (req) => {
      const b = body(req) as Record<string, unknown>;
      return staffSvc.disableMfa(req.staff!.id, typeof b.code === 'string' ? b.code : '', actorOf(req));
    });
    admin.post('/auth/mfa/recovery-codes', { preHandler: auth }, async (req) => staffSvc.regenerateRecoveryCodes(req.staff!.id, actorOf(req)));

    // ── Reviews (moderation) ───────────────────────────────────────────────────
    // The admin SPA hydrates the Reviews console from GET /reviews (all statuses → client-side tabs) and
    // moderates via approve/reject/reply/unpublish(+restore). unpublish/restore both map to 'pending'
    // (hidden from the public tour page, back in the queue) — no new state, per 005's status CHECK.
    admin.get('/reviews', perm('reviews.moderate'), async (req) => svc.listReviews({ status: qStr(query(req), 'status') }));
    admin.post('/reviews/:id/approve', perm('reviews.moderate'), async (req) => svc.moderateReview((req.params as any).id, 'approve', actorOf(req)));
    admin.post('/reviews/:id/reject', perm('reviews.moderate'), async (req) => svc.moderateReview((req.params as any).id, 'reject', actorOf(req)));
    admin.post('/reviews/:id/unpublish', perm('reviews.moderate'), async (req) => svc.moderateReview((req.params as any).id, 'unpublish', actorOf(req)));
    admin.post('/reviews/:id/restore', perm('reviews.moderate'), async (req) => svc.moderateReview((req.params as any).id, 'restore', actorOf(req)));
    admin.post('/reviews/:id/reply', perm('reviews.moderate'), async (req) => svc.replyReview((req.params as any).id, body(req), actorOf(req)));
    // ── Guides (TRI-896 A12) — the roster a departure's guide_id points at. Gated on the tours domain
    // (a guide is an operational resource assigned to departures). ──
    admin.get('/guides', perm('tours.view'), async () => svc.listGuides());
    admin.get('/guides/:id', perm('tours.view'), async (req) => svc.getGuide((req.params as any).id));
    admin.post('/guides', perm('tours.edit'), async (req, reply) => reply.code(201).send(await svc.createGuide(body(req), actorOf(req))));
    admin.patch('/guides/:id', perm('tours.edit'), async (req) => svc.updateGuide((req.params as any).id, body(req), actorOf(req)));
    admin.delete('/guides/:id', perm('tours.edit'), async (req) => svc.deleteGuide((req.params as any).id, actorOf(req)));

    // ── Promo codes (TRI-896 A13) — admin CRUD; consumer redemption lives in the booking path. ──
    admin.get('/promos', perm('promos.manage'), async () => svc.listPromos());
    admin.get('/promos/:id', perm('promos.manage'), async (req) => svc.getPromo((req.params as any).id));
    admin.post('/promos', perm('promos.manage'), async (req, reply) => reply.code(201).send(await svc.createPromo(body(req), actorOf(req))));
    admin.patch('/promos/:id', perm('promos.manage'), async (req) => svc.updatePromo((req.params as any).id, body(req), actorOf(req)));
    admin.delete('/promos/:id', perm('promos.manage'), async (req) => svc.deactivatePromo((req.params as any).id, actorOf(req)));
    // TRI-897: real Paystack refund (was flag-only) + manual offline settlement. Both money-touching →
    // guarded by payments.refund, both audit-logged inside the service.
    admin.post('/payments/:ref/refund', perm('payments.refund'), async (req) => svc.executeRefund((req.params as any).ref, body(req), actorOf(req)));
    admin.post('/payments/:ref/mark-paid', perm('payments.refund'), async (req) => svc.markPaid((req.params as any).ref, body(req), actorOf(req)));

    // ── Reconciliation export (finance): payments + refunds over a date range, JSON or CSV ──
    admin.get('/reports/reconciliation', perm('payments.refund'), async (req) => {
      const q = query(req);
      return svc.reconciliationReport({ from: qStr(q, 'from'), to: qStr(q, 'to') });
    });
    admin.get('/reports/reconciliation.csv', perm('payments.refund'), async (req, reply) => {
      const q = query(req);
      const report = await svc.reconciliationReport({ from: qStr(q, 'from'), to: qStr(q, 'to') });
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="reconciliation${report.from ? `-${report.from}` : ''}${report.to ? `_${report.to}` : ''}.csv"`);
      return reconciliationCsv(report);
    });

    // ── Settings (org config incl display rate; charge rate is read-only) ────────
    // TRI-898 · GET/PATCH the singleton settings row. settings.manage gates both. PATCH surfaces the
    // customer-facing DISPLAY rate for editing but the service rejects any attempt to touch the charge rate.
    admin.get('/settings', perm('settings.manage'), async () => svc.getSettings());
    admin.patch('/settings', perm('settings.manage'), async (req) => svc.updateSettings(body(req), actorOf(req)));

    // ── Customers (A11) ─────────────────────────────────────────────────────────
    admin.get('/customers', perm('customers.view'), async (req) => {
      const q = query(req);
      return svc.listCustomers({ q: qStr(q, 'q'), page: qNum(q, 'page'), pageSize: qNum(q, 'pageSize') });
    });
    admin.get('/customers/:id', perm('customers.view'), async (req) => svc.getCustomer((req.params as any).id));

    // ── Audit-log read (A16) — read-only; admin/settings-tier access ─────────────
    admin.get('/audit-log', perm('settings.manage'), async (req) => {
      const q = query(req);
      return svc.listAuditLog({
        action: qStr(q, 'action'), targetType: qStr(q, 'targetType'), targetId: qStr(q, 'targetId'),
        actorId: qStr(q, 'actorId'), page: qNum(q, 'page'), pageSize: qNum(q, 'pageSize'),
      });
    });

    // ── Dashboard aggregates (A15) ───────────────────────────────────────────────
    admin.get('/dashboard', perm('bookings.view'), async (req) => svc.getDashboard({ range: qStr(query(req), 'range') }));
  }, { prefix: cfg.adminPrefix });
}
