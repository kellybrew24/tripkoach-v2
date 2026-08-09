// TRI-869 Phase 3 · Admin realm routes, mounted under cfg.adminPrefix (default /api/admin) as an
// encapsulated Fastify plugin so the consumer /api/v1 read paths stay byte-identical. AuthN via session
// cookie; every write is guarded by a permission preHandler and audited inside the service.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import {
  verifyPassword, createSession, revokeSession, resolveSession,
  resolvePendingSession, clearMfaPending,
  clearMfaEnrollPending, mfaEnforcedFor, makeRequireAuthAllowingEnroll,
  setSessionCookie, clearSessionCookie, permissionsFor,
  makeRequireAuth, makeRequirePermission, audit, type Permission,
  verifyTrustedDevice, issueTrustedDevice, sessionWasTrusted,
  revokeTrustedDevices, setTrustCookie, clearTrustCookie,
} from './auth.ts';
import { createAdminService, AdminError, ValidationError } from './admin.ts';
import type { NotificationService } from './notifications.ts';
import { createReviewsService, ReviewError, type ReviewsService } from './reviews.ts';
import { createStaffService } from './staff.ts';
import { createPaystackClient, type PaystackClient } from './paystack.ts';
import { createMediaService, MediaError } from './media.ts';
import { createStorage, type Storage } from './storage.ts';
import { createAvatarService, AvatarError } from './avatar.ts';

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

export function registerAdmin(app: FastifyInstance, db: Db, cfg: Config, notifier?: NotificationService, reviews?: ReviewsService, paystack?: PaystackClient, storage?: Storage): void {
  const svc = createAdminService(db, cfg, paystack ?? createPaystackClient(cfg.paystack), notifier);
  const reviewSvc = reviews ?? createReviewsService(db, cfg);
  const staffSvc = createStaffService(db, cfg);
  // TRI-918: admin image upload → validation → R2 (cdn.tripkoach.com) publish. Storage is 'enabled' only
  // when the R2 credentials are present in the environment; unconfigured → the routes answer 503.
  const mediaSvc = createMediaService(db, cfg, storage ?? createStorage(cfg.media));
  // TRI-943: avatar moderation queue + actions (content.manage). Shares the media pipeline.
  const avatarSvc = createAvatarService(db, cfg, mediaSvc);
  const auth = makeRequireAuth(db, cfg);
  const authEnroll = makeRequireAuthAllowingEnroll(db, cfg); // TRI-912: enroll-gated sessions may reach /auth/mfa enroll
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
      if (err instanceof MediaError || err instanceof AvatarError) {
        return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message, field: err.field } });
      }
      // Fastify raises FST_ERR_CTP_BODY_TOO_LARGE (413) when an upload exceeds the route bodyLimit.
      if ((err as any).statusCode === 413 || (err as any).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return reply.code(413).send({ error: { code: 'too_large', message: 'Image exceeds the upload size limit.' } });
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
      // TRI-983: a device the operator previously chose to trust skips the second factor for 30 days. We
      // check the long-lived tk_admin_trust cookie against a live trusted_device row scoped to THIS staff
      // user; a match means we can issue a full session straight away instead of the mfa_pending half-auth.
      // (Scoping to u.id is what stops a trusted cookie for one account from skipping MFA for another.)
      if (u.mfa_enabled && await verifyTrustedDevice(db, u.id, req.cookies?.[cfg.adminTrustCookieName])) {
        const sid = await createSession(db, cfg, u.id, {
          ip: req.ip, userAgent: req.headers['user-agent'], trustedDevice: true,
        });
        setSessionCookie(reply, cfg, sid);
        await audit(db, { actorId: u.id, action: 'staff.login', targetType: 'staff_user', targetId: u.id, after: { mfa: 'skipped_trusted_device' }, ip: req.ip ?? null });
        return {
          staff: { id: u.id, email: u.email, name: u.name ?? null, role: u.role, jobTitle: u.job_title ?? null },
          permissions: [...await permissionsFor(db, u.role)],
        };
      }
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
      // TRI-912 enforcement: a factor-less staffer in an MFA-enforced role gets an ENROLL-gated half-auth
      // session. It can reach ONLY the /auth/mfa enroll+verify endpoints (authEnroll) until a factor is
      // confirmed, at which point that verify promotes the session to a full login. All other roles keep
      // MFA optional and fall through to a normal session below.
      if (mfaEnforcedFor(cfg, u.role)) {
        const sid = await createSession(db, cfg, u.id, {
          ip: req.ip, userAgent: req.headers['user-agent'], trustedDevice: trust, mfaEnrollPending: true,
        });
        setSessionCookie(reply, cfg, sid);
        await audit(db, { actorId: u.id, action: 'staff.mfa_enroll_required', targetType: 'staff_user', targetId: u.id, after: { role: u.role }, ip: req.ip ?? null });
        return {
          mfaEnrollmentRequired: true,
          staff: { id: u.id, email: u.email, name: u.name ?? null, role: u.role, jobTitle: u.job_title ?? null },
        };
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
      // TRI-983: the operator ticked "Trust this device for 30 days" at login — now that the factor has
      // verified, mint a trusted-device token and drop it in the long-lived tk_admin_trust cookie so the
      // next login on this device skips the challenge. Only issued after a real second-factor success.
      if (pending.trustedDevice) {
        const token = await issueTrustedDevice(db, cfg, pending.staffId, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
        setTrustCookie(reply, cfg, token);
        await audit(db, { actorId: pending.staffId, action: 'staff.device_trusted', targetType: 'staff_user', targetId: pending.staffId, ip: req.ip ?? null });
      }
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
    // TRI-970 · Move a paid/held booking to another departure of the same tour (availability-checked, audited).
    admin.post('/bookings/:ref/reschedule', perm('bookings.manage'), async (req) => svc.rescheduleBooking((req.params as any).ref, body(req), actorOf(req)));

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
    // TRI-912: these three use `authEnroll` so an enroll-gated (factor-less enforced-role) session can
    // complete enrollment. status/disable/recovery for a voluntary user still resolve as a full session.
    admin.get('/auth/mfa/status', { preHandler: authEnroll }, async (req) => staffSvc.mfaStatus(req.staff!.id));
    admin.post('/auth/mfa/enroll', { preHandler: authEnroll }, async (req) => staffSvc.enrollMfa(req.staff!.id, actorOf(req)));
    admin.post('/auth/mfa/verify', { preHandler: authEnroll }, async (req, reply) => {
      const b = body(req) as Record<string, unknown>;
      const result = await staffSvc.verifyMfaEnrollment(req.staff!.id, typeof b.code === 'string' ? b.code : '', actorOf(req));
      // If this cleared an enrollment gate, promote the half-auth session to a full login and hand back
      // the same { staff, permissions } shape a plain login returns, so the console enters immediately.
      if (req.mfaEnrollPending) {
        const sid = req.cookies?.[cfg.adminCookieName];
        if (sid) await clearMfaEnrollPending(db, sid);
        const s = req.staff!;
        // TRI-983: an enroll-gated login can also carry the "trust this device" intent (it was stored on
        // the half-auth session at login). The factor is now confirmed, so honor it the same way the
        // ordinary MFA-challenge path does.
        if (sid && await sessionWasTrusted(db, sid)) {
          const token = await issueTrustedDevice(db, cfg, s.id, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
          setTrustCookie(reply, cfg, token);
          await audit(db, { actorId: s.id, action: 'staff.device_trusted', targetType: 'staff_user', targetId: s.id, ip: req.ip ?? null });
        }
        await audit(db, { actorId: s.id, action: 'staff.login', targetType: 'staff_user', targetId: s.id, after: { mfa: true, viaEnrollGate: true }, ip: req.ip ?? null });
        return { ...result, staff: { id: s.id, email: s.email, name: s.name, role: s.role, jobTitle: s.jobTitle }, permissions: [...s.permissions] };
      }
      return result;
    });
    admin.post('/auth/mfa/disable', { preHandler: auth }, async (req, reply) => {
      const b = body(req) as Record<string, unknown>;
      const result = await staffSvc.disableMfa(req.staff!.id, typeof b.code === 'string' ? b.code : '', actorOf(req));
      // TRI-983: with MFA off there is no challenge to skip, so any trusted-device tokens are moot — forget
      // them all and clear this device's cookie so re-enabling MFA starts from a clean, fully-challenged state.
      await revokeTrustedDevices(db, req.staff!.id);
      clearTrustCookie(reply, cfg);
      return result;
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

    // ── Blog / CMS (TRI-917) — admin authoring CRUD, guarded by content.manage. Consumer render reads
    //    published-only under /api/v1/blog. ──
    admin.get('/blog', perm('content.manage'), async () => svc.listBlog());
    admin.get('/blog/:idOrSlug', perm('content.manage'), async (req) => svc.getBlog((req.params as any).idOrSlug));
    admin.post('/blog', perm('content.manage'), async (req, reply) => reply.code(201).send(await svc.createBlog(body(req), actorOf(req))));
    admin.patch('/blog/:idOrSlug', perm('content.manage'), async (req) => svc.updateBlog((req.params as any).idOrSlug, body(req), actorOf(req)));
    admin.post('/blog/:idOrSlug/publish', perm('content.manage'), async (req) => svc.setBlogPublished((req.params as any).idOrSlug, true, actorOf(req)));
    admin.post('/blog/:idOrSlug/unpublish', perm('content.manage'), async (req) => svc.setBlogPublished((req.params as any).idOrSlug, false, actorOf(req)));
    admin.delete('/blog/:idOrSlug', perm('content.manage'), async (req) => svc.deleteBlog((req.params as any).idOrSlug, actorOf(req)));

    // ── Media library (TRI-918) — admin image upload → validation → CDN (R2) publish, guarded by
    //    content.manage. The upload endpoint takes the RAW image bytes as the request body (the SPA sends
    //    the File/Blob directly; curl uses --data-binary), so we buffer image/* + octet-stream here. This
    //    parser is scoped to the admin realm — the consumer /api/v1 JSON paths are untouched. ──
    const IMAGE_CTYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/octet-stream'];
    admin.addContentTypeParser(IMAGE_CTYPES, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    admin.get('/media', perm('content.manage'), async (req) => {
      const q = query(req);
      return mediaSvc.list({ limit: qNum(q, 'limit'), offset: qNum(q, 'offset') });
    });
    admin.get('/media/:id', perm('content.manage'), async (req, reply) => {
      const asset = await mediaSvc.getById((req.params as any).id);
      return asset ?? reply.code(404).send({ error: { code: 'not_found', message: 'media asset not found' } });
    });
    admin.post('/media', {
      ...perm('content.manage'),
      // Allow the configured max image size (+slack) past Fastify's 1MB default, scoped to this route only.
      bodyLimit: cfg.media.maxBytes + 1024,
    }, async (req, reply) => {
      const raw = req.body;
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.isBuffer((raw as any)?.data) ? (raw as any).data : null;
      if (!bytes) {
        return reply.code(415).send({ error: { code: 'unsupported_type', message: 'Send the raw image bytes with an image/* Content-Type.' } });
      }
      const q = query(req);
      const filename = qStr(q, 'filename') ?? (req.headers['x-filename'] as string | undefined) ?? null;
      const altText = qStr(q, 'alt') ?? (req.headers['x-alt-text'] as string | undefined) ?? null;
      const declaredType = (req.headers['content-type'] as string | undefined) ?? null;
      const out = await mediaSvc.upload({ bytes, filename, altText, declaredType }, actorOf(req));
      return reply.code(out.deduped ? 200 : 201).send({ asset: out.asset, deduped: out.deduped });
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
    // TRI-972: customer-scoped activity/events timeline (bookings, cancellations, reschedules, refunds, reviews).
    admin.get('/customers/:id/activity', perm('customers.view'), async (req) => svc.getCustomerActivity((req.params as any).id));

    // ── Avatar moderation (TRI-943) — queue + actions, guarded by content.manage ─
    // Queue lists pending/hidden (auto-flagged) avatars with owner + media + last report reason. An admin
    // approve/reject/remove flips avatar_status; reject/remove hide the avatar from /me + public. Both the
    // avatar_moderation_action trail and the shared admin audit-log record the action.
    //
    // Canonical TRI-943 contract (documented in README, what the FE binds to):
    //   GET  /api/admin/moderation/avatars?status=pending,hidden
    //   POST /api/admin/moderation/avatars/:userId  { action: approve|reject|remove, reason }
    // REST-style aliases (/avatars/queue + /avatars/:userId/{approve,reject,remove}) are kept for callers
    // that prefer verb-per-path; both hit the same service.
    const avatarQueue = async (req: FastifyRequest) => avatarSvc.listQueue({ status: qStr(query(req), 'status') });
    const avatarModerate = (action: 'approve' | 'reject' | 'remove') =>
      async (req: FastifyRequest) => {
        const reason = typeof (body(req) as any).reason === 'string' ? (body(req) as any).reason : null;
        return avatarSvc.moderate((req.params as any).userId, action, reason, actorOf(req));
      };

    admin.get('/moderation/avatars', perm('content.manage'), avatarQueue);
    admin.post('/moderation/avatars/:userId', perm('content.manage'), async (req: FastifyRequest, reply: FastifyReply) => {
      const b = body(req) as Record<string, unknown>;
      const action = typeof b.action === 'string' ? b.action : '';
      if (!['approve', 'reject', 'remove'].includes(action)) {
        return reply.code(400).send({ error: { code: 'validation', message: 'action must be approve, reject, or remove', field: 'action' } });
      }
      const reason = typeof b.reason === 'string' ? b.reason : null;
      return avatarSvc.moderate((req.params as any).userId, action as 'approve' | 'reject' | 'remove', reason, actorOf(req));
    });

    admin.get('/avatars/queue', perm('content.manage'), avatarQueue);
    admin.post('/avatars/:userId/approve', perm('content.manage'), avatarModerate('approve'));
    admin.post('/avatars/:userId/reject', perm('content.manage'), avatarModerate('reject'));
    admin.post('/avatars/:userId/remove', perm('content.manage'), avatarModerate('remove'));

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
