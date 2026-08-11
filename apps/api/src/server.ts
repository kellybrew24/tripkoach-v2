// Fastify app: the six Phase 1 read endpoints (consumer /api/v1) + the Phase 3 admin realm (/api/admin).
// Consumer read paths are untouched (flag-off byte-identical); the admin realm is an encapsulated plugin.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { listRegions, listTours, getTourBySlug, getAvailability, getReviews } from './catalog.ts';
import { createBookingService, BookingError, type CreateBookingInput, type QuoteInput } from './booking.ts';
import { createPaystackClient, type PaystackClient } from './paystack.ts';
import { registerAdmin } from './admin-routes.ts';
import { createNotificationService } from './notifications.ts';
import { registerConsumer } from './consumer-routes.ts';
import { resolveUserSession } from './consumer-auth.ts';
import { createReviewsService, ReviewError } from './reviews.ts';
import { listBlogPosts, getBlogPost } from './content.ts';
import { submitEnquiry, submitTourInterest, type EnquiryInput, type InterestInput } from './enquiries.ts';
import type { Storage } from './storage.ts';

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

/** Map a thrown BookingError/ReviewError to the shared {error:{code,message}} envelope + its HTTP status. */
function sendBookingError(reply: any, err: unknown): any {
  if (err instanceof BookingError) {
    return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ReviewError) {
    return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message, field: err.field } });
  }
  reply.log?.error?.(err);
  return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
}

export function buildServer(db: Db, cfg: Config, paystack?: PaystackClient, storage?: Storage): FastifyInstance {
  // trustProxy so req.ip is the real client (Caddy proxies /api/* and sets X-Forwarded-For); without
  // it every request looks like it came from 127.0.0.1 and the per-IP login rate limit (TRI-1054)
  // would bucket all operators together. Also gives the audit log real client IPs.
  const app = Fastify({ logger: cfg.env !== 'test', trustProxy: true });

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

  // TRI-1054 [SEC-H2]: brute-force protection for the admin login. Registered global:false so only
  // routes that opt in (config.rateLimit — currently just POST /api/admin/auth/login) are throttled;
  // every other endpoint is untouched. The in-memory store is per-instance, which is fine for the
  // single API process. Errors are shaped into the app's { error: { code, message } } envelope.
  // The plugin THROWS the errorResponseBuilder result, so it must be a real Error carrying statusCode
  // 429 (a plain object would land in the admin error handler with no status → 500). The admin realm's
  // setErrorHandler maps that 429 into the { error: { code: 'rate_limited', ... } } envelope.
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => {
      const err = new Error(`Too many attempts. Try again in about ${Math.ceil(context.ttl / 1000)} seconds.`);
      (err as any).statusCode = 429;
      return err;
    },
  });

  // Transactional booking-lifecycle emails (TRI-889 P5.2). Inert when the email transport is unconfigured
  // (no RESEND_API_KEY / EMAIL_FROM) — every send renders + logs 'skipped'. Never throws to its callers.
  const notifier = createNotificationService(db, cfg, { log: (m) => app.log.info(m) });
  // Shared Paystack client — also handed to the admin realm so refund execution (TRI-897) can call it.
  const paystackClient = paystack ?? createPaystackClient(cfg.paystack);
  const bookings = createBookingService(db, cfg, paystackClient, notifier);
  const reviews = createReviewsService(db, cfg);

  // Caddy proxies /api/* verbatim (no strip, TRI-862), so the public health check is /api/health.
  // We also expose /health for direct localhost/systemd checks. Both return the same payload.
  const health = async () => ({ status: 'ok', db: db.driver, time: new Date().toISOString() });
  app.get('/health', health);
  app.get('/api/health', health);

  app.register(async (api) => {
    // TRI-1063 [A01/F2]: the /api/v1 public plugin has no error handler of its own, so shape
    // @fastify/rate-limit's thrown 429 (from the guest booking-lookup route below) into the public
    // { error: { code, message } } envelope. Any other error is re-thrown so Fastify's default handling
    // is unchanged for every other /api/v1 read route.
    api.setErrorHandler((err: any, _req, reply) => {
      if (err?.statusCode === 429) {
        return reply.code(429).send({ error: { code: 'rate_limited', message: err.message || 'Too many requests. Please wait and try again.' } });
      }
      throw err;
    });

    // TRI-1063 [A01/F2]: per-IP throttle for the UNAUTHENTICATED guest booking lookup (GET /bookings/:ref).
    // The ref is only ~30 bits of randomBytes entropy and the endpoint discloses booking PII, so without a
    // limit the space is probeable. @fastify/rate-limit is registered global:false in server.ts (trustProxy →
    // req.ip is the real client behind Caddy); a route is throttled only where it opts in via config.rateLimit.
    // 100 / minute per IP sits far above the FE confirmation poll (≤6 GETs per booking + receipt reloads) yet
    // makes brute-forcing the ref space hopeless. Empty under `test` so the smoke/e2e suites can poll freely
    // from one loopback IP (mirrors the TRI-1054/1055 opt-in). Payment init/verify keep their own POST paths.
    const bookingLookupRateLimit: Record<string, unknown> = cfg.env === 'test'
      ? {}
      : { config: { rateLimit: { max: 100, timeWindow: '1 minute' } } };

    // ── TRI-939 · Public config for the consumer SPA. Surfaces the customer-facing USD→GHS
    //    DISPLAY rate (settings.usd_to_ghs_display_rate) so the web app converts "from GH₵…"
    //    figures from a single settings-driven source instead of a hardcoded constant that
    //    drifts. Never exposes the charge rate. Falls back to 12 if settings are unreadable. ──
    api.get('/config', async () => {
      let displayRate = 12;
      let currencyOfRecord = 'USD';
      let secondaryDisplayCurrency = 'GHS';
      try {
        const { rows } = await db.query<{ display: string | null; cor: string | null; sdc: string | null }>(
          `SELECT usd_to_ghs_display_rate AS display, currency_of_record AS cor,
                  secondary_display_currency AS sdc FROM settings WHERE singleton = true`);
        const r = rows[0];
        const d = r?.display != null ? Number(r.display) : NaN;
        if (Number.isFinite(d) && d > 0) displayRate = d;
        if (r?.cor) currencyOfRecord = r.cor;
        if (r?.sdc) secondaryDisplayCurrency = r.sdc;
      } catch { /* settings unreadable → keep safe defaults */ }
      return { usdToGhsDisplayRate: displayRate, currencyOfRecord, secondaryDisplayCurrency };
    });

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

    // ── TRI-917 · Blog (published-only). The web kit renders these into window.TK_BLOG. ──
    api.get('/blog', async () => listBlogPosts(db));
    api.get('/blog/:slug', async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const out = await getBlogPost(db, slug);
      return out ?? notFound(reply, `post "${slug}" not found`);
    });

    // ── TRI-892 · Tokenized review redeem (consumer). Context for a valid unredeemed invite token,
    //    then a one-time submit that creates a verified pending review and burns the token. ──
    api.get('/reviews/redeem/:token', async (req, reply) => {
      try {
        const { token } = req.params as { token: string };
        return await reviews.getRedeemContext(token);
      } catch (e) { return sendBookingError(reply, e); }
    });

    api.post('/reviews/redeem/:token', async (req, reply) => {
      try {
        const { token } = req.params as { token: string };
        return await reviews.submitReview(token, req.body);
      } catch (e) { return sendBookingError(reply, e); }
    });

    // ── TRI-1015 · Public lead capture. The Contact + Airport-pickup "Send inquiry" forms POST here
    //    instead of discarding the visitor's details. Persists into `enquiry` + notifies ops by email. ──
    api.post('/enquiries', async (req, reply) => {
      try {
        const out = await submitEnquiry(db, cfg, (req.body ?? {}) as EnquiryInput, { log: (m) => app.log.info(m) });
        return reply.code(201).send(out);
      } catch (e) { return sendBookingError(reply, e); }
    });

    // ── TRI-1018 / TRI-999 · Empty-departures date-interest capture. The "No upcoming departures" booking
    //    box POSTs an email here to register interest in a future date for this tour (persists as an
    //    'interest' enquiry + notifies ops). Idempotent per (tour, email, intent). ──
    api.post('/tours/:id/interest', async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const out = await submitTourInterest(db, cfg, id, (req.body ?? {}) as InterestInput, { log: (m) => app.log.info(m) });
        return reply.code(out.created ? 201 : 200).send(out);
      } catch (e) { return sendBookingError(reply, e); }
    });

    // ── Phase 2 write paths (TRI-866): booking + Paystack payments ──
    api.post('/bookings', async (req, reply) => {
      try {
        // TRI-926: link the booking to the signed-in consumer when a valid session cookie is present, so it
        // shows up under /me/bookings ("my purchases"). Guest checkout still works (no cookie → userId null);
        // pre-existing guest bookings are linked at signup/login by email (linkGuestBookings).
        const sid = req.cookies?.[cfg.consumer.cookieName];
        const account = sid ? await resolveUserSession(db, cfg, sid).catch(() => null) : null;
        const out = await bookings.create(req.body as CreateBookingInput, { userId: account?.id ?? null });
        return reply.code(201).send(out);
      } catch (e) { return sendBookingError(reply, e); }
    });

    // TRI-1013: pre-payment price preview. Prices a booking + optional promo without creating one, so the
    // checkout can show the discount BEFORE the customer pays. Invalid promos come back as the booking-error
    // envelope (422) and the FE renders the "invalid" state.
    api.post('/bookings/quote', async (req, reply) => {
      try {
        return await bookings.previewQuote(req.body as QuoteInput);
      } catch (e) { return sendBookingError(reply, e); }
    });

    api.get('/bookings/:ref', bookingLookupRateLimit, async (req, reply) => {
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
  // paystackClient is shared with the booking service so refund execution (TRI-897) is stubbable in tests.
  registerAdmin(app, db, cfg, notifier, reviews, paystackClient, storage);

  // ── P1 consumer accounts & auth realm (TRI-881), mounted under cfg.apiPrefix (default /api/v1).
  // Encapsulated plugin: adds /auth/* + /me[...]; the Phase-1 read paths above are untouched. ──
  registerConsumer(app, db, cfg, storage);

  return app;
}
