// Fastify app: the six Phase 1 read endpoints. No write/booking/payment routes (Phase 2/3).
// Consumer routes live under cfg.apiPrefix (default /api/v1); admin realm is added in Phase 3.

import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { listRegions, listTours, getTourBySlug, getAvailability, getReviews } from './catalog.ts';

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

export function buildServer(db: Db, cfg: Config): FastifyInstance {
  const app = Fastify({ logger: cfg.env !== 'test' });

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
  }, { prefix: cfg.apiPrefix });

  return app;
}
