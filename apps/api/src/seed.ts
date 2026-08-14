// Seeds the dev DB from the v2 consumer SPA fixtures (apps/web/kit/data.js). Idempotent: wipes the
// catalogue/review tables and re-inserts. Booking/payment/staff tables are left empty in Phase 1.

import { loadConfig } from './config.ts';
import { createDb, type Db } from './db.ts';
import { loadFixtures, type Fixtures } from './fixtures.ts';
import { toMinor, slugify, categoryEnum, parseDisplayDate } from './util.ts';

// Pre-prod guard (TRI-1116): seed() TRUNCATES the catalogue + every review. Running it against prod would
// wipe real customer reviews/bookings-linked data and re-inject demo fixtures. Refuse unless the operator
// explicitly opts in. Trips on NODE_ENV=production OR a DATABASE_URL whose db name ends in `_prod`.
export function assertSeedAllowed(env = process.env): void {
  if (env.ALLOW_DESTRUCTIVE_SEED === 'true') return;
  const nodeEnv = env.NODE_ENV || 'development';
  const dbName = (() => { try { return new URL(env.DATABASE_URL || '').pathname.replace(/^\//, ''); } catch { return ''; } })();
  const looksProd = nodeEnv === 'production' || /(^|[_-])prod(uction)?$/.test(dbName);
  if (looksProd) {
    throw new Error(
      `seed(): refusing to wipe/re-seed what looks like a production database ` +
      `(NODE_ENV=${nodeEnv}, db="${dbName || 'unknown'}"). This deletes tour/review/departure/region rows. ` +
      `Set ALLOW_DESTRUCTIVE_SEED=true only if you truly intend to reset it.`);
  }
}

export async function seed(db: Db, fx: Fixtures = loadFixtures(), log: (m: string) => void = () => {}): Promise<void> {
  assertSeedAllowed();
  // Wipe in FK-safe order (Phase 1 seeds catalogue + reviews only).
  await db.query('DELETE FROM review');
  await db.query('DELETE FROM departure');
  await db.query('DELETE FROM price_tier');
  await db.query('DELETE FROM tour_package');
  await db.query('DELETE FROM tour');
  await db.query('DELETE FROM region');

  // ── Regions: fixtures list ∪ any region a tour references. tourCount is derived at read time. ──
  const regionNames = new Set<string>(fx.regions);
  for (const t of fx.tours) if (t.region) regionNames.add(t.region);
  const regionId = new Map<string, string>();
  for (const name of regionNames) {
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO region (name, slug) VALUES ($1, $2) RETURNING id',
      [name, slugify(name)],
    );
    regionId.set(name, rows[0].id);
  }
  log(`regions: ${regionId.size}`);

  // ── Tours (+ packages, tiers, departures) ──
  const tourId = new Map<string, string>();
  let packageCount = 0, tierCount = 0, departureCount = 0;
  for (const t of fx.tours) {
    const rid = regionId.get(t.region);
    if (!rid) throw new Error(`tour ${t.id}: region "${t.region}" not seeded`);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO tour
         (slug, title, region_id, category, category_label, duration, blurb, highlights, included,
          excluded, itinerary, pricing_display, images, image, currency, base_price_minor, tag,
          spots_left_hint, rating_cached, review_count_cached, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true)
       RETURNING id`,
      [
        t.id, t.title, rid, categoryEnum(t.category), t.category, t.duration, t.blurb || '',
        t.highlights || [], t.included || [], t.excluded || [],
        JSON.stringify(t.itinerary || []), JSON.stringify(t.pricing || []),
        t.image ? [t.image] : [], t.image || null, t.currency || 'USD', toMinor(t.price),
        t.tag || null, t.spotsLeft ?? null, t.rating ?? null, t.reviews ?? 0,
      ],
    );
    const id = rows[0].id;
    tourId.set(t.id, id);

    // tour-level price tiers (the IIFE in data.js sets t.tiers for every tour)
    for (const tier of t.tiers || []) {
      await db.query('INSERT INTO price_tier (tour_id, min_pax, price_minor) VALUES ($1,$2,$3)',
        [id, tier.minPax, toMinor(tier.price)]);
      tierCount++;
    }

    // packages + their tiers
    const pkgId = new Map<string, string>();
    for (const p of t.packages || []) {
      const pr = await db.query<{ id: string }>(
        `INSERT INTO tour_package (tour_id, slug, name, tag, blurb, duration, stops, includes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [id, p.id, p.name, p.tag || null, p.blurb || '', p.duration || null, p.stops || [], p.includes || []],
      );
      pkgId.set(p.id, pr.rows[0].id);
      packageCount++;
      for (const tier of p.tiers || []) {
        await db.query('INSERT INTO price_tier (package_id, min_pax, price_minor) VALUES ($1,$2,$3)',
          [pr.rows[0].id, tier.minPax, toMinor(tier.price)]);
        tierCount++;
      }
    }
    if (t.defaultPackage && pkgId.has(t.defaultPackage)) {
      await db.query('UPDATE tour SET default_package_id = $1 WHERE id = $2', [pkgId.get(t.defaultPackage), id]);
    }

    // departures — synthesize capacity from the fixture's spotsLeft (no capacity is authored).
    for (const d of t.departures || []) {
      const spotsLeft = d.spotsLeft ?? 0;
      const seatsTotal = Math.max(spotsLeft, 12);
      const seatsReserved = seatsTotal - spotsLeft;
      const status = spotsLeft <= 0 ? 'sold_out' : 'scheduled';
      const on = parseDisplayDate(d.date);
      await db.query(
        `INSERT INTO departure
           (tour_id, date_label, time_label, depart_on, price_minor, currency, seats_total, seats_reserved, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, d.date, d.time || null, on ? on.toISOString() : null, toMinor(d.price),
         t.currency || 'USD', seatsTotal, seatsReserved, status],
      );
      departureCount++;
    }
  }
  log(`tours: ${tourId.size} · packages: ${packageCount} · tiers: ${tierCount} · departures: ${departureCount}`);

  // ── Reviews (public read filters status=approved; pending/rejected kept for admin moderation) ──
  let reviewCount = 0;
  for (const r of fx.reviews) {
    const tid = tourId.get(r.tourId);
    if (!tid) continue; // review references a tour not in the catalogue → skip
    const created = parseDisplayDate(r.date);
    await db.query(
      `INSERT INTO review (tour_id, author_name, rating, title, text, verified, status, reply, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, r.author, r.rating, r.title || null, r.text || '', !!r.verified, r.status,
       r.reply || null, created ? created.toISOString() : new Date().toISOString()],
    );
    reviewCount++;
  }
  log(`reviews: ${reviewCount}`);

  // Reconcile cached rating/review_count from approved reviews so the catalogue matches public reads.
  await db.query(`
    UPDATE tour t SET
      review_count_cached = c.n,
      rating_cached = c.avg
    FROM (
      SELECT tour_id, COUNT(*)::int AS n, ROUND(AVG(rating)::numeric, 1) AS avg
      FROM review WHERE status = 'approved' GROUP BY tour_id
    ) c
    WHERE c.tour_id = t.id`);
}

// CLI: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const db = await createDb(cfg);
  try {
    const { migrate } = await import('./migrate.ts');
    if (cfg.autoMigrate) await migrate(db, (m) => console.log(`[migrate] ${m}`));
    await seed(db, loadFixtures(), (m) => console.log(`[seed] ${m}`));
    console.log('[seed] done');
  } finally {
    await db.close();
  }
}
