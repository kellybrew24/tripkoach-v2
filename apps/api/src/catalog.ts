// Read-path service. All catalogue queries live here; routes just parse params and call these.
// Response shapes are the Phase 1 contract consumed by the SPA API client (TRI-861) — keep them stable.

import type { Db } from './db.ts';
import { fromMinor, formatReviewDate, initials } from './util.ts';

// ── Regions ──────────────────────────────────────────────────────────────
export interface RegionDTO { name: string; slug: string; tourCount: number; note: string | null }

export async function listRegions(db: Db): Promise<RegionDTO[]> {
  const { rows } = await db.query(
    `SELECT r.name, r.slug, r.note,
            COUNT(t.id) FILTER (WHERE t.published) AS tour_count
     FROM region r
     LEFT JOIN tour t ON t.region_id = r.id
     WHERE r.active
     GROUP BY r.id, r.name, r.slug, r.note
     ORDER BY r.name`,
  );
  return rows.map((r) => ({ name: r.name, slug: r.slug, tourCount: Number(r.tour_count), note: r.note ?? null }));
}

// ── Tours: browse (list) ───────────────────────────────────────────────────
export interface ToursQuery {
  region?: string[]; category?: string[]; price?: string[]; duration?: string[];
  q?: string; sort?: string; page?: number; pageSize?: number;
}
export interface TourCardDTO {
  id: string; title: string; region: string; duration: string; category: string;
  price: number; currency: string; rating: number | null; reviews: number;
  spotsLeft: number | null; tag: string | null; image: string | null;
  // TRI-998: does this tour have at least one bookable (upcoming, not cancelled/
  // completed/past) departure? The board default is to keep a tour with none
  // discoverable, so browse still lists it — the card just carries the signal.
  hasUpcomingDepartures: boolean;
}

// TRI-998: a departure is "bookable" — an upcoming, purchasable slot — only when it is
// still scheduled or sold_out AND its date is today or later (an undated fixture departure
// counts as upcoming). Cancelled/completed and past departures are excluded from the public
// read path so the tour page can render a graceful "no upcoming departures" empty state
// instead of a booking box over an empty picker with a live "Reserve my spot" button.
const BOOKABLE_DEPARTURE_SQL =
  `d.status IN ('scheduled','sold_out') AND (d.depart_on IS NULL OR d.depart_on >= CURRENT_DATE)`;
export interface TourListDTO {
  items: TourCardDTO[]; page: number; pageSize: number; total: number; totalPages: number;
}

// Price bands mirror the SPA FilterPanel exactly (screens-web.jsx PRICE_BANDS), on the "from" price.
const PRICE_BAND_SQL: Record<string, string> = {
  'Under $200': 't.base_price_minor < 20000',
  '$200 to $600': 't.base_price_minor BETWEEN 20000 AND 60000',
  '$600 to $1,200': 't.base_price_minor > 60000 AND t.base_price_minor <= 120000',
  '$1,200+': 't.base_price_minor > 120000',
};
// Duration bands mirror the SPA DURATIONS regex tests, applied to the authored duration string.
const DURATION_BAND_SQL: Record<string, string> = {
  'Half day': `t.duration ~* 'half day|hrs'`,
  'Full day': `t.duration ~* 'full day'`,
  'Multi-day': `t.duration ~* 'days|nights?'`,
};
const SORT_SQL: Record<string, string> = {
  featured: 't.created_at ASC',
  popular: 't.review_count_cached DESC NULLS LAST, t.rating_cached DESC NULLS LAST',
  rating: 't.rating_cached DESC NULLS LAST',
  price_asc: 't.base_price_minor ASC',
  price_desc: 't.base_price_minor DESC',
  title: 't.title ASC',
};

function orGroup(labels: string[], map: Record<string, string>): string | null {
  const parts = labels.map((l) => map[l]).filter(Boolean);
  return parts.length ? `(${parts.join(' OR ')})` : null;
}

export async function listTours(db: Db, query: ToursQuery): Promise<TourListDTO> {
  const where: string[] = ['t.published'];
  const params: unknown[] = [];

  if (query.region?.length) {
    params.push(query.region);
    where.push(`r.name = ANY($${params.length})`);
  }
  if (query.category?.length) {
    // accept either the display label ("City Tour") or the enum ("city")
    params.push(query.category);
    where.push(`(t.category_label = ANY($${params.length}) OR t.category = ANY($${params.length}))`);
  }
  if (query.q) {
    params.push(`%${query.q}%`);
    where.push(`(t.title ILIKE $${params.length} OR r.name ILIKE $${params.length} OR t.category_label ILIKE $${params.length})`);
  }
  const priceCond = query.price?.length ? orGroup(query.price, PRICE_BAND_SQL) : null;
  if (priceCond) where.push(priceCond);
  const durCond = query.duration?.length ? orGroup(query.duration, DURATION_BAND_SQL) : null;
  if (durCond) where.push(durCond);

  const whereSql = where.join(' AND ');
  const sort = SORT_SQL[query.sort || 'featured'] || SORT_SQL.featured;
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(60, Math.max(1, query.pageSize || 12));
  const offset = (page - 1) * pageSize;

  const countRes = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM tour t JOIN region r ON r.id = t.region_id WHERE ${whereSql}`, params);
  const total = Number(countRes.rows[0].n);

  params.push(pageSize); const limIdx = params.length;
  params.push(offset); const offIdx = params.length;
  const { rows } = await db.query(
    `SELECT t.slug, t.title, r.name AS region, t.duration, t.category_label, t.currency,
            t.base_price_minor, t.rating_cached, t.review_count_cached, t.spots_left_hint, t.tag, t.image,
            EXISTS (SELECT 1 FROM departure d WHERE d.tour_id = t.id AND ${BOOKABLE_DEPARTURE_SQL} AND COALESCE(d.visibility,'public')='public') AS has_upcoming
     FROM tour t JOIN region r ON r.id = t.region_id
     WHERE ${whereSql}
     ORDER BY ${sort}
     LIMIT $${limIdx} OFFSET $${offIdx}`, params);

  return {
    items: rows.map(toCard),
    page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function toCard(r: any): TourCardDTO {
  return {
    id: r.slug, title: r.title, region: r.region, duration: r.duration, category: r.category_label,
    price: fromMinor(r.base_price_minor), currency: r.currency,
    rating: r.rating_cached == null ? null : Number(r.rating_cached),
    reviews: Number(r.review_count_cached || 0),
    spotsLeft: r.spots_left_hint == null ? null : Number(r.spots_left_hint),
    tag: r.tag ?? null, image: r.image ?? null,
    hasUpcomingDepartures: !!r.has_upcoming,
  };
}

// ── Tour detail ─────────────────────────────────────────────────────────────
export async function getTourBySlug(db: Db, slug: string): Promise<any | null> {
  const { rows } = await db.query(
    `SELECT t.*, r.name AS region_name
     FROM tour t JOIN region r ON r.id = t.region_id
     WHERE t.slug = $1 AND t.published`, [slug]);
  const t = rows[0];
  if (!t) return null;

  const tiers = await tiersForTour(db, t.id);
  const packages = await packagesForTour(db, t.id);
  const departures = await departuresForTour(db, t.id);
  const stats = await reviewStats(db, t.id);

  return {
    id: t.slug,
    title: t.title,
    region: t.region_name,
    duration: t.duration,
    category: t.category_label,
    price: fromMinor(t.base_price_minor),
    currency: t.currency,
    rating: t.rating_cached == null ? null : Number(t.rating_cached),
    reviews: Number(t.review_count_cached || 0),
    spotsLeft: t.spots_left_hint == null ? null : Number(t.spots_left_hint),
    tag: t.tag ?? null,
    image: t.image ?? null,
    images: t.images ?? [],
    blurb: t.blurb ?? '',
    highlights: t.highlights ?? [],
    included: t.included ?? [],
    excluded: t.excluded ?? [],
    pricing: t.pricing_display ?? [],
    itinerary: t.itinerary ?? [],
    tiers,
    packages,
    defaultPackage: await defaultPackageSlug(db, t.default_package_id),
    departures,
    // TRI-998: `departures` is already filtered to bookable slots, so an empty array
    // means "no upcoming departures" — the FE swaps the picker + Reserve CTA for a
    // graceful empty state and enquiry CTA rather than launching a broken checkout.
    hasUpcomingDepartures: departures.length > 0,
    reviewStats: stats,
  };
}

async function tiersForTour(db: Db, tourId: string) {
  const { rows } = await db.query(
    `SELECT min_pax, price_minor FROM price_tier WHERE tour_id = $1 ORDER BY min_pax`, [tourId]);
  return rows.map((r) => ({ minPax: Number(r.min_pax), price: fromMinor(r.price_minor) }));
}

async function packagesForTour(db: Db, tourId: string) {
  const { rows } = await db.query(
    `SELECT id, slug, name, tag, blurb, duration, stops, includes
     FROM tour_package WHERE tour_id = $1 ORDER BY created_at`, [tourId]);
  const out = [];
  for (const p of rows) {
    const tr = await db.query(
      `SELECT min_pax, price_minor FROM price_tier WHERE package_id = $1 ORDER BY min_pax`, [p.id]);
    out.push({
      id: p.slug, name: p.name, tag: p.tag ?? null, blurb: p.blurb ?? '', duration: p.duration ?? null,
      stops: p.stops ?? [], includes: p.includes ?? [],
      tiers: tr.rows.map((r) => ({ minPax: Number(r.min_pax), price: fromMinor(r.price_minor) })),
    });
  }
  return out;
}

async function defaultPackageSlug(db: Db, packageId: string | null): Promise<string | null> {
  if (!packageId) return null;
  const { rows } = await db.query(`SELECT slug FROM tour_package WHERE id = $1`, [packageId]);
  return rows[0]?.slug ?? null;
}

// ── Availability (departures for a tour by slug or id) ──────────────────────
async function resolveTourId(db: Db, idOrSlug: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT id FROM tour WHERE slug = $1 OR id::text = $1 LIMIT 1`, [idOrSlug]);
  return rows[0]?.id ?? null;
}

function departureDTO(r: any) {
  return {
    id: r.id,
    date: r.date_label,
    time: r.time_label ?? '',
    // Null price = tier-priced departure (price varies by party size, like production).
    // Pass null through rather than coercing to 0 so the FE falls back to the group-tier
    // step-function instead of showing "$0". (TRI-932)
    price: r.price_minor == null ? null : fromMinor(r.price_minor),
    spotsLeft: Math.max(0, Number(r.seats_total) - Number(r.seats_reserved)),
    status: r.status,
    // Track / route this departure belongs to (TRI-992). Null when the tour has no
    // per-track packages — the FE renders those under an ungrouped "Standard" bucket.
    packageSlug: r.package_slug ?? null,
    packageName: r.package_name ?? null,
  };
}

async function departuresForTour(db: Db, tourId: string) {
  const { rows } = await db.query(
    `SELECT d.id, d.date_label, d.time_label, d.price_minor, d.seats_total, d.seats_reserved, d.status,
            p.slug AS package_slug, p.name AS package_name
     FROM departure d
     LEFT JOIN tour_package p ON p.id = d.package_id
     WHERE d.tour_id = $1 AND ${BOOKABLE_DEPARTURE_SQL}
       AND COALESCE(d.visibility, 'public') = 'public'
     ORDER BY d.depart_on NULLS LAST, d.created_at`, [tourId]);
  return rows.map(departureDTO);
}

export async function getAvailability(db: Db, idOrSlug: string): Promise<{ tourId: string; departures: any[] } | null> {
  const tourId = await resolveTourId(db, idOrSlug);
  if (!tourId) return null;
  return { tourId, departures: await departuresForTour(db, tourId) };
}

// ── Reviews (public: approved only) ─────────────────────────────────────────
async function reviewStats(db: Db, tourId: string): Promise<{ count: number; avg: number }> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS avg
     FROM review WHERE tour_id = $1 AND status = 'approved'`, [tourId]);
  return { count: Number(rows[0].count), avg: Number(rows[0].avg) };
}

export async function getReviews(db: Db, idOrSlug: string): Promise<{ tourId: string; stats: any; reviews: any[] } | null> {
  const tourId = await resolveTourId(db, idOrSlug);
  if (!tourId) return null;
  const { rows } = await db.query(
    `SELECT id, author_name, rating, title, text, verified, reply, created_at
     FROM review WHERE tour_id = $1 AND status = 'approved'
     ORDER BY created_at DESC`, [tourId]);
  const reviews = rows.map((r) => ({
    id: r.id,
    author: r.author_name,
    initials: initials(r.author_name),
    rating: Number(r.rating),
    date: formatReviewDate(r.created_at),
    verified: !!r.verified,
    title: r.title ?? '',
    text: r.text ?? '',
    reply: r.reply ?? null,
  }));
  return { tourId, stats: await reviewStats(db, tourId), reviews };
}
