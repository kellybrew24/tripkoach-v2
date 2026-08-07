// Fastify app: the six Phase 1 read endpoints (consumer /api/v1) + the Phase 3 admin realm (/api/admin).
// Consumer read paths are untouched (flag-off byte-identical); the admin realm is an encapsulated plugin.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { listRegions, listTours, getTourBySlug, getAvailability, getReviews } from './catalog.ts';
import { createBookingService, BookingError, type CreateBookingInput } from './booking.ts';
import { createPaystackClient, type PaystackClient } from './paystack.ts';
import { registerAdmin } from './admin-routes.ts';

/** Normalise a query value that may be absent, a single string ("a,b"), or an array into string[]. */
function asArray(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const out = arr.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function notFound(reply: any, message: string) {
  return reply.code(404).send({ error: { code: 'not_found', message } });
}

/** Map a thrown BookingError to the shared {error:{code,message}} envelope + its HTTP status. */
function sendBookingError(reply: any, err: unknown): any {
  if (err instanceof BookingError) {
    return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message } });
  }
  reply.log?.error?.(err);
  return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
}

export function buildServer(db: Db, cfg: Config, paystack?: PaystackClient): FastifyInstance {
  const app = Fastify({ logger: cfg.env !== 'test' });

  // Keep the raw JSON body available for Paystack webhook HMAC verification, while still parsing JSON
  // for every other route. (Signature is computed over the exact bytes Paystack sent.)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    if (body === '' || body == null) return done(null, undefined);
    try { done(null, JSON.parse(body as string)); }
    catch (e) { (e as any).statusCode = 400; done(e as Error, undefined); }
  });

  // Cookie support for the admin session (parses Cookie header; adds reply.setCookie/clearCookie).
  // Read-only for consumer routes → /api/v1 responses are unchanged.
  app.register(cookie);

  const bookings = createBookingService(db, cfg, paystack ?? createPaystackClient(cfg.paystack));

  // Caddy proxies /api/* verbatim (no strip, TRI-862), so the public health check is /api/health.
  // We also expose /health for direct localhost/systemd checks. Both return the same payload.
  const health = async () => ({ status: 'ok', db: db.driver, time: new Date().toISOString() });
  app.get('/health', health);
  app.get('/api/health', health);

  app.register(async (api) => {
    api.get('/regions', async () => ({ regions: await listRegions(db) }));

    api.get('/tours', async (req) => {
      const q = req.query as Record<string, unknown>;
      return listTours(db, {
        region: asArray(q.region),
        category: asArray(q.category),
        price: asArray(q.price),
        duration: asArray(q.duration),
        q: q.q != null ? String(q.q) : undefined,
        sort: q.sort != null ? String(q.sort) : undefined,
        page: q.page != null ? Number(q.page) : undefined,
        pageSize: q.pageSize != null ? Number(q.pageSize) : undefined,
      });
    });

    api.get('/tours/:slug', async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const tour = await getTourBySlug(db, slug);
      return tour ?? notFound(reply, `tour "${slug}" not found`);
    });

    // Path uses :slug (shared param name at this position, per Fastify's router); the resolver
    // accepts either a slug or a UUID, honouring the Phase 0 contract's /tours/:id/* shape.
    api.get('/tours/:slug/availability', async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const out = await getAvailability(db, slug);
      return out ?? notFound(reply, `tour "${slug}" not found`);
    });

    api.get('/tours/:slug/reviews', async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const out = await getReviews(db, slug);
      return out ?? notFound(reply, `tour "${slug}" not found`);
    });

    // ── Phase 2 write paths (TRI-866): booking + Paystack payments ──
    api.post('/bookings', async (req, reply) => {
      try {
        const out = await bookings.create(req.body as CreateBookingInput);
        return reply.code(201).send(out);
      } catch (e) { return sendBookingError(reply, e); }
    });

    api.get('/bookings/:ref', async (req, reply) => {
      const { ref } = req.params as { ref: string };
      const out = await bookings.getByRef(ref);
      return out ?? notFound(reply, `booking "${ref}" not found`);
    });

    api.post('/bookings/:ref/payment/init', async (req, reply) => {
      try {
        const { ref } = req.params as { ref: string };
        const body = (req.body ?? {}) as { channel?: string };
        return await bookings.initPayment(ref, { channel: body.channel });
      } catch (e) { return sendBookingError(reply, e); }
    });

    api.post('/bookings/:ref/payment/verify', async (req, reply) => {
      try {
        const { ref } = req.params as { ref: string };
        const body = (req.body ?? {}) as { reference?: string };
        return await bookings.verifyPayment(ref, body.reference);
      } catch (e) { return sendBookingError(reply, e); }
    });

    // Paystack webhook. HMAC-SHA512 over the raw body; idempotent. FE never calls this.
    api.post('/payments/webhook', async (req, reply) => {
      try {
        const raw = (req as any).rawBody ?? '';
        const sig = req.headers['x-paystack-signature'] as string | undefined;
        return await bookings.handleWebhook(raw, sig);
      } catch (e) { return sendBookingError(reply, e); }
    });

    // Cron-callable expiry sweep: release unpaid holds past their reservation window. DevOps triggers it.
    api.post('/internal/expire-holds', async (_req, reply) => {
      try {
        return await bookings.expireHolds();
      } catch (e) { return sendBookingError(reply, e); }
    });
  }, { prefix: cfg.apiPrefix });

  // ── Phase 3 admin write/auth realm (TRI-869), mounted under cfg.adminPrefix (default /api/admin) ──
  registerAdmin(app, db, cfg);

  return app;
}
