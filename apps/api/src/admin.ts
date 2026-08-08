// TRI-869 Phase 3 · Admin write/read service. Every mutation validates its input, runs guarded by a
// permission (see routes), and writes an audit_log row. Money crosses the wire as whole-currency numbers
// with an explicit currency (mirroring the Phase 1 read contract); it is stored as integer minor units.

import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import type { PaystackClient } from './paystack.ts';
import { fromMinor, toMinor, slugify, formatReviewDate, initials } from './util.ts';
import { blocksToText, textToBlocks } from './content.ts';
import { audit } from './auth.ts';
import type { NotificationService } from './notifications.ts';

export interface Actor { id: string; ip: string | null }

// ── Errors ───────────────────────────────────────────────────────────────────
export class AdminError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
export class ValidationError extends AdminError {
  field?: string;
  constructor(message: string, field?: string) {
    super('validation', message, 400);
    this.field = field;
  }
}
const notFound = (what: string) => new AdminError('not_found', `${what} not found`, 404);
const conflict = (msg: string) => new AdminError('conflict', msg, 409);

// ── Tiny validators (fail-fast; no external schema lib) ──────────────────────
type Body = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);

function reqStr(b: Body, field: string, max = 2000): string {
  const v = b[field];
  if (typeof v !== 'string' || v.trim() === '') throw new ValidationError(`"${field}" is required`, field);
  if (v.length > max) throw new ValidationError(`"${field}" is too long`, field);
  return v.trim();
}
function optStr(b: Body, field: string, max = 20000): string | undefined {
  const v = b[field];
  if (v == null) return undefined;
  if (typeof v !== 'string') throw new ValidationError(`"${field}" must be a string`, field);
  if (v.length > max) throw new ValidationError(`"${field}" is too long`, field);
  return v;
}
function optBool(b: Body, field: string): boolean | undefined {
  const v = b[field];
  if (v == null) return undefined;
  if (typeof v !== 'boolean') throw new ValidationError(`"${field}" must be a boolean`, field);
  return v;
}
function optInt(b: Body, field: string, min?: number): number | undefined {
  const v = b[field];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) throw new ValidationError(`"${field}" must be an integer`, field);
  if (min != null && n < min) throw new ValidationError(`"${field}" must be >= ${min}`, field);
  return n;
}
/** Whole-currency amount (e.g. 65 or 65.50) → validated number. */
function optMoney(b: Body, field: string): number | undefined {
  const v = b[field];
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`"${field}" must be a non-negative amount`, field);
  return n;
}
function optArrStr(b: Body, field: string): string[] | undefined {
  const v = b[field];
  if (v == null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new ValidationError(`"${field}" must be an array of strings`, field);
  }
  return v as string[];
}
/** Passthrough JSON array (itinerary / pricing_display are authored [label,text] pairs). */
function optJsonArr(b: Body, field: string): unknown[] | undefined {
  const v = b[field];
  if (v == null) return undefined;
  if (!Array.isArray(v)) throw new ValidationError(`"${field}" must be an array`, field);
  return v;
}
function optEnum<T extends string>(b: Body, field: string, allowed: readonly T[]): T | undefined {
  const v = b[field];
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new ValidationError(`"${field}" must be one of: ${allowed.join(', ')}`, field);
  }
  return v as T;
}

// ── Category + date helpers ──────────────────────────────────────────────────
const CAT_LABEL: Record<string, string> = {
  city: 'City Tour', cultural: 'Cultural Discovery', adventure: 'Adventure', luxury: 'Luxury',
};
const LABEL_CAT: Record<string, string> = {
  'city tour': 'city', 'cultural discovery': 'cultural', 'adventure': 'adventure', 'luxury': 'luxury',
};
/** Accept either the display label ("City Tour") or the enum ("city") → { enum, label }. */
function normalizeCategory(raw: string): { enumv: string; label: string } {
  const key = raw.toLowerCase().trim();
  if (LABEL_CAT[key]) return { enumv: LABEL_CAT[key], label: CAT_LABEL[LABEL_CAT[key]] };
  if (CAT_LABEL[key]) return { enumv: key, label: CAT_LABEL[key] };
  throw new ValidationError(`unknown category "${raw}"`, 'category');
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-08-15" → "Sat 15 Aug 2026" (the human date_label the read contract exposes). */
function humanDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ── Refund-ref codes + date-range bounds (TRI-897) ──────────────────────────
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I (mirrors booking.ts)
function refCode(n: number): string {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += REF_ALPHABET[b[i] % 32];
  return s;
}
/** Inclusive day bounds for a reconciliation date range. Accepts YYYY-MM-DD (UTC day) or full ISO. */
function dayStart(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00.000Z` : new Date(iso).toISOString();
}
function dayEnd(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T23:59:59.999Z` : new Date(iso).toISOString();
}

// Whether Phase-2 (008) FX columns exist on `payment`. Detected once per Db; lets the admin payment views
// surface usd/ghs/fx when 008 has landed, while this branch still migrates & smoke-tests standalone.
const fxCache = new WeakMap<Db, Promise<boolean>>();
function hasFxColumns(db: Db): Promise<boolean> {
  let p = fxCache.get(db);
  if (!p) {
    p = db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'payment' AND column_name = 'usd_amount_minor'`,
    ).then((r) => r.rows.length > 0);
    fxCache.set(db, p);
  }
  return p;
}

// Per-txn FX provenance cols land in migration 010 (TRI-873). Guarded separately so the admin view is
// safe even against a DB where 008 applied but 010 hasn't.
const fxProvCache = new WeakMap<Db, Promise<boolean>>();
function hasFxProvenanceColumns(db: Db): Promise<boolean> {
  let p = fxProvCache.get(db);
  if (!p) {
    p = db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'payment' AND column_name = 'fx_source'`,
    ).then((r) => r.rows.length > 0);
    fxProvCache.set(db, p);
  }
  return p;
}

// Refund linkage columns (013, TRI-897). Guarded like the FX detectors so the admin service is safe
// against a DB where 013 hasn't landed yet (refund execution then degrades to an error, never a crash).
const refundColCache = new WeakMap<Db, Promise<boolean>>();
function hasRefundColumns(db: Db): Promise<boolean> {
  let p = refundColCache.get(db);
  if (!p) {
    p = db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'payment' AND column_name = 'refund_provider_id'`,
    ).then((r) => r.rows.length > 0);
    refundColCache.set(db, p);
  }
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
export function createAdminService(db: Db, cfg: Config, paystack: PaystackClient, notifier?: NotificationService) {
  // ── Regions ────────────────────────────────────────────────────────────────
  async function listRegions() {
    const { rows } = await db.query(
      `SELECT r.id, r.name, r.slug, r.note, r.active,
              COUNT(t.id) FILTER (WHERE t.published) AS tour_count
         FROM region r LEFT JOIN tour t ON t.region_id = r.id
        GROUP BY r.id ORDER BY r.name`);
    return rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, note: r.note ?? null,
      active: r.active, tourCount: Number(r.tour_count),
    }));
  }

  async function createRegion(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const name = reqStr(body, 'name', 120);
    const note = optStr(body, 'note', 2000) ?? null;
    const active = optBool(body, 'active') ?? true;
    const slug = slugify(name);
    const dup = await db.query(`SELECT 1 FROM region WHERE name = $1 OR slug = $2`, [name, slug]);
    if (dup.rows.length) throw conflict(`region "${name}" already exists`);
    const { rows } = await db.query(
      `INSERT INTO region (name, slug, note, active) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, slug, note, active]);
    await audit(db, { actorId: actor.id, action: 'region.create', targetType: 'region', targetId: rows[0].id, after: { name, slug, note, active }, ip: actor.ip });
    return { id: rows[0].id, name, slug, note, active, tourCount: 0 };
  }

  async function updateRegion(id: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = (await db.query(`SELECT * FROM region WHERE id = $1`, [id])).rows[0];
    if (!cur) throw notFound('region');
    const name = optStr(body, 'name', 120);
    const note = body.note === undefined ? undefined : (optStr(body, 'note', 2000) ?? null);
    const active = optBool(body, 'active');
    const next = {
      name: name ?? cur.name, slug: name ? slugify(name) : cur.slug,
      note: note === undefined ? cur.note : note, active: active === undefined ? cur.active : active,
    };
    await db.query(`UPDATE region SET name=$1, slug=$2, note=$3, active=$4, updated_at=now() WHERE id=$5`,
      [next.name, next.slug, next.note, next.active, id]);
    await audit(db, { actorId: actor.id, action: 'region.update', targetType: 'region', targetId: id, before: { name: cur.name, note: cur.note, active: cur.active }, after: next, ip: actor.ip });
    return { id, ...next };
  }

  async function deleteRegion(id: string, actor: Actor) {
    const cur = (await db.query(`SELECT * FROM region WHERE id = $1`, [id])).rows[0];
    if (!cur) throw notFound('region');
    const used = await db.query(`SELECT COUNT(*)::int AS n FROM tour WHERE region_id = $1`, [id]);
    if (Number(used.rows[0].n) > 0) throw conflict('region still has tours; reassign or deactivate instead');
    await db.query(`DELETE FROM region WHERE id = $1`, [id]);
    await audit(db, { actorId: actor.id, action: 'region.delete', targetType: 'region', targetId: id, before: { name: cur.name }, ip: actor.ip });
    return { ok: true };
  }

  // ── Tours ────────────────────────────────────────────────────────────────
  async function listTours() {
    const { rows } = await db.query(
      `SELECT t.id, t.slug, t.title, r.name AS region, t.category, t.category_label, t.currency,
              t.base_price_minor, t.rating_cached, t.review_count_cached, t.published, t.image,
              (SELECT COUNT(*) FROM departure d WHERE d.tour_id = t.id) AS departures
         FROM tour t JOIN region r ON r.id = t.region_id
        ORDER BY t.title`);
    return rows.map((t) => ({
      id: t.slug, uuid: t.id, title: t.title, region: t.region,
      category: t.category_label, categoryEnum: t.category, currency: t.currency,
      price: fromMinor(t.base_price_minor), rating: t.rating_cached == null ? null : Number(t.rating_cached),
      reviews: Number(t.review_count_cached || 0), published: t.published, departures: Number(t.departures),
      image: t.image ?? null, // TRI-928: cover thumbnail for the tours list
    }));
  }

  async function resolveTourRow(idOrSlug: string) {
    const { rows } = await db.query(
      `SELECT t.*, r.name AS region_name FROM tour t JOIN region r ON r.id = t.region_id
        WHERE t.slug = $1 OR t.id::text = $1 LIMIT 1`, [idOrSlug]);
    return rows[0] ?? null;
  }

  async function tourDetail(t: any) {
    const tiers = (await db.query(`SELECT min_pax, price_minor FROM price_tier WHERE tour_id=$1 ORDER BY min_pax`, [t.id]))
      .rows.map((r) => ({ minPax: Number(r.min_pax), price: fromMinor(r.price_minor) }));
    const pkgRows = (await db.query(`SELECT * FROM tour_package WHERE tour_id=$1 ORDER BY created_at`, [t.id])).rows;
    const packages = [];
    for (const p of pkgRows) {
      const pt = (await db.query(`SELECT min_pax, price_minor FROM price_tier WHERE package_id=$1 ORDER BY min_pax`, [p.id]))
        .rows.map((r) => ({ minPax: Number(r.min_pax), price: fromMinor(r.price_minor) }));
      packages.push({ id: p.slug, name: p.name, tag: p.tag ?? null, blurb: p.blurb ?? '', duration: p.duration ?? null, stops: p.stops ?? [], includes: p.includes ?? [], tiers: pt });
    }
    const defPkg = t.default_package_id
      ? (await db.query(`SELECT slug FROM tour_package WHERE id=$1`, [t.default_package_id])).rows[0]?.slug ?? null : null;
    return {
      id: t.slug, uuid: t.id, title: t.title, region: t.region_name, regionId: t.region_id,
      category: t.category_label, categoryEnum: t.category, duration: t.duration, currency: t.currency,
      price: fromMinor(t.base_price_minor), tag: t.tag ?? null, spotsLeft: t.spots_left_hint ?? null,
      image: t.image ?? null, images: t.images ?? [], blurb: t.blurb ?? '',
      highlights: t.highlights ?? [], included: t.included ?? [], excluded: t.excluded ?? [],
      pricing: t.pricing_display ?? [], itinerary: t.itinerary ?? [],
      tiers, packages, defaultPackage: defPkg, published: t.published,
      rating: t.rating_cached == null ? null : Number(t.rating_cached), reviews: Number(t.review_count_cached || 0),
    };
  }

  async function getTour(idOrSlug: string) {
    const t = await resolveTourRow(idOrSlug);
    if (!t) throw notFound('tour');
    return tourDetail(t);
  }

  // Parse the tiers array from a write body → validated [{minPax, priceMinor}] with a computed "from" price.
  function parseTiers(body: Body, field = 'tiers'): { minPax: number; priceMinor: number }[] | undefined {
    const raw = body[field];
    if (raw == null) return undefined;
    if (!Array.isArray(raw)) throw new ValidationError(`"${field}" must be an array`, field);
    return raw.map((row, i) => {
      if (!isPlainObject(row)) throw new ValidationError(`"${field}[${i}]" must be an object`, field);
      const minPax = optInt(row, 'minPax', 1);
      const price = optMoney(row, 'price');
      if (minPax == null) throw new ValidationError(`"${field}[${i}].minPax" is required`, field);
      if (price == null) throw new ValidationError(`"${field}[${i}].price" is required`, field);
      return { minPax, priceMinor: toMinor(price) };
    });
  }

  async function replaceTiers(q: Db, tourId: string, tiers: { minPax: number; priceMinor: number }[]) {
    await q.query(`DELETE FROM price_tier WHERE tour_id = $1`, [tourId]);
    for (const t of tiers) {
      await q.query(`INSERT INTO price_tier (tour_id, min_pax, price_minor) VALUES ($1,$2,$3)`, [tourId, t.minPax, t.priceMinor]);
    }
  }

  async function replacePackages(q: Db, tourId: string, packages: Body[]) {
    await q.query(`UPDATE tour SET default_package_id = NULL WHERE id = $1`, [tourId]);
    await q.query(`DELETE FROM tour_package WHERE tour_id = $1`, [tourId]);
    for (const p of packages) {
      const name = reqStr(p, 'name', 200);
      const slug = optStr(p, 'slug', 120) ? slugify(String(p.slug)) : slugify(name);
      const pr = await q.query(
        `INSERT INTO tour_package (tour_id, slug, name, tag, blurb, duration, stops, includes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tourId, slug, name, optStr(p, 'tag', 120) ?? null, optStr(p, 'blurb') ?? '', optStr(p, 'duration', 120) ?? null,
         optArrStr(p, 'stops') ?? [], optArrStr(p, 'includes') ?? []]);
      const ptiers = parseTiers(p, 'tiers');
      for (const t of ptiers ?? []) {
        await q.query(`INSERT INTO price_tier (package_id, min_pax, price_minor) VALUES ($1,$2,$3)`, [pr.rows[0].id, t.minPax, t.priceMinor]);
      }
    }
  }

  // Resolve a region reference: accept regionId (uuid) or region name (created must already exist).
  async function resolveRegionId(body: Body): Promise<string> {
    const rid = optStr(body, 'regionId', 64);
    if (rid) {
      const r = await db.query(`SELECT id FROM region WHERE id::text = $1`, [rid]);
      if (!r.rows.length) throw new ValidationError(`unknown regionId "${rid}"`, 'regionId');
      return r.rows[0].id;
    }
    const name = reqStr(body, 'region', 120);
    const r = await db.query(`SELECT id FROM region WHERE name = $1`, [name]);
    if (!r.rows.length) throw new ValidationError(`unknown region "${name}" — create it first`, 'region');
    return r.rows[0].id;
  }

  async function createTour(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const title = reqStr(body, 'title', 300);
    const slug = optStr(body, 'slug', 200) ? slugify(String(body.slug)) : slugify(title);
    const regionId = await resolveRegionId(body);
    const { enumv, label } = normalizeCategory(reqStr(body, 'category', 120));
    const duration = reqStr(body, 'duration', 200);
    const currency = (optStr(body, 'currency', 3) ?? 'USD').toUpperCase();
    const tiers = parseTiers(body);
    const flatPrice = optMoney(body, 'price');
    const basePriceMinor = tiers?.length ? Math.min(...tiers.map((t) => t.priceMinor))
      : flatPrice != null ? toMinor(flatPrice) : null;
    if (basePriceMinor == null) throw new ValidationError('provide "price" or a non-empty "tiers" array', 'price');

    const dup = await db.query(`SELECT 1 FROM tour WHERE slug = $1`, [slug]);
    if (dup.rows.length) throw conflict(`tour slug "${slug}" already in use`);

    const images = optArrStr(body, 'images');
    const image = optStr(body, 'image', 1000) ?? images?.[0] ?? null;

    const id = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO tour (slug, title, region_id, category, category_label, duration, blurb, highlights,
            included, excluded, itinerary, pricing_display, images, image, currency, base_price_minor,
            tag, spots_left_hint, published)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [slug, title, regionId, enumv, label, duration, optStr(body, 'blurb') ?? '',
         optArrStr(body, 'highlights') ?? [], optArrStr(body, 'included') ?? [], optArrStr(body, 'excluded') ?? [],
         JSON.stringify(optJsonArr(body, 'itinerary') ?? []), JSON.stringify(optJsonArr(body, 'pricing') ?? []),
         images ?? [], image, currency, basePriceMinor,
         optStr(body, 'tag', 120) ?? null, optInt(body, 'spotsLeft', 0) ?? null, optBool(body, 'published') ?? false]);
      const tid = rows[0].id;
      if (tiers) await replaceTiers(q, tid, tiers);
      if (Array.isArray(body.packages)) {
        await replacePackages(q, tid, body.packages as Body[]);
        const defSlug = optStr(body, 'defaultPackage', 120);
        if (defSlug) await q.query(`UPDATE tour SET default_package_id = (SELECT id FROM tour_package WHERE tour_id=$1 AND slug=$2) WHERE id=$1`, [tid, slugify(defSlug)]);
      }
      return tid;
    });
    const detail = await getTour(id);
    await audit(db, { actorId: actor.id, action: 'tour.create', targetType: 'tour', targetId: id, after: { slug, title, published: detail.published }, ip: actor.ip });
    return detail;
  }

  async function updateTour(idOrSlug: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = await resolveTourRow(idOrSlug);
    if (!cur) throw notFound('tour');

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    const title = optStr(body, 'title', 300); if (title != null) set('title', title);
    if (body.region !== undefined || body.regionId !== undefined) set('region_id', await resolveRegionId(body));
    if (body.category !== undefined) { const c = normalizeCategory(reqStr(body, 'category', 120)); set('category', c.enumv); set('category_label', c.label); }
    const duration = optStr(body, 'duration', 200); if (duration != null) set('duration', duration);
    const blurb = optStr(body, 'blurb'); if (blurb != null) set('blurb', blurb);
    const highlights = optArrStr(body, 'highlights'); if (highlights) set('highlights', highlights);
    const included = optArrStr(body, 'included'); if (included) set('included', included);
    const excluded = optArrStr(body, 'excluded'); if (excluded) set('excluded', excluded);
    const itinerary = optJsonArr(body, 'itinerary'); if (itinerary) set('itinerary', JSON.stringify(itinerary));
    const pricing = optJsonArr(body, 'pricing'); if (pricing) set('pricing_display', JSON.stringify(pricing));
    const images = optArrStr(body, 'images'); if (images) set('images', images);
    const image = optStr(body, 'image', 1000); if (image != null) set('image', image);
    if (body.currency !== undefined) set('currency', reqStr(body, 'currency', 3).toUpperCase());
    if (body.tag !== undefined) set('tag', optStr(body, 'tag', 120) ?? null);
    if (body.spotsLeft !== undefined) set('spots_left_hint', optInt(body, 'spotsLeft', 0) ?? null);
    if (body.published !== undefined) set('published', optBool(body, 'published'));

    const tiers = parseTiers(body);
    if (tiers?.length) set('base_price_minor', Math.min(...tiers.map((t) => t.priceMinor)));
    else {
      const p = optMoney(body, 'price');
      if (p != null) {
        // Don't let a tier-less save clobber the advertised "from" price of a tiered
        // tour (TRI-932): its base MUST track the cheapest tier, not a stray `price`
        // field. Only honour an explicit `price` for tours that have no tiers.
        const { rows } = await db.query<{ m: string | null }>(
          'SELECT MIN(price_minor) AS m FROM price_tier WHERE tour_id = $1', [cur.id]);
        const minTier = rows[0]?.m != null ? Number(rows[0].m) : null;
        set('base_price_minor', minTier != null ? minTier : toMinor(p));
      }
    }

    await db.tx(async (q) => {
      if (sets.length) { params.push(cur.id); await q.query(`UPDATE tour SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}`, params); }
      if (tiers) await replaceTiers(q, cur.id, tiers);
      if (Array.isArray(body.packages)) {
        await replacePackages(q, cur.id, body.packages as Body[]);
        const defSlug = optStr(body, 'defaultPackage', 120);
        if (defSlug) await q.query(`UPDATE tour SET default_package_id = (SELECT id FROM tour_package WHERE tour_id=$1 AND slug=$2) WHERE id=$1`, [cur.id, slugify(defSlug)]);
      }
    });
    const detail = await getTour(cur.id);
    await audit(db, { actorId: actor.id, action: 'tour.update', targetType: 'tour', targetId: cur.id, before: { title: cur.title, published: cur.published }, after: { title: detail.title, published: detail.published }, ip: actor.ip });
    return detail;
  }

  async function setTourPublished(idOrSlug: string, published: boolean, actor: Actor) {
    const cur = await resolveTourRow(idOrSlug);
    if (!cur) throw notFound('tour');
    await db.query(`UPDATE tour SET published=$1, updated_at=now() WHERE id=$2`, [published, cur.id]);
    await audit(db, { actorId: actor.id, action: published ? 'tour.publish' : 'tour.unpublish', targetType: 'tour', targetId: cur.id, before: { published: cur.published }, after: { published }, ip: actor.ip });
    return getTour(cur.id);
  }

  async function deleteTour(idOrSlug: string, actor: Actor) {
    const cur = await resolveTourRow(idOrSlug);
    if (!cur) throw notFound('tour');
    const b = await db.query(`SELECT COUNT(*)::int AS n FROM booking WHERE tour_id = $1`, [cur.id]);
    if (Number(b.rows[0].n) > 0) throw conflict('tour has bookings; unpublish (set to draft) instead of deleting');
    await db.query(`DELETE FROM tour WHERE id = $1`, [cur.id]);  // cascades departures/packages/tiers
    await audit(db, { actorId: actor.id, action: 'tour.delete', targetType: 'tour', targetId: cur.id, before: { slug: cur.slug, title: cur.title }, ip: actor.ip });
    return { ok: true };
  }

  // ── Departures / schedules ─────────────────────────────────────────────────
  function departureDTO(r: any) {
    const seatsTotal = Number(r.seats_total), seatsReserved = Number(r.seats_reserved);
    return {
      id: r.id, tourId: r.tour_slug ?? r.tour_id, tour: r.tour_title ?? null,
      packageId: r.package_slug ?? null, date: r.date_label, departOn: r.depart_on, time: r.time_label ?? '',
      price: fromMinor(r.price_minor), currency: r.currency, capacity: seatsTotal, seatsTotal,
      booked: seatsReserved, spotsLeft: Math.max(0, seatsTotal - seatsReserved), status: r.status,
      guideId: r.guide_id ?? null, guide: r.guide_name ?? null, notes: r.notes_internal ?? null,
    };
  }

  // Validate a guideId reference (nicer error than a raw FK violation). Empty/absent → null (unassigned).
  async function resolveGuideId(body: Body): Promise<string | null | undefined> {
    if (body.guideId === undefined) return undefined;   // field omitted → don't touch
    const gid = optStr(body, 'guideId', 64);
    if (!gid) return null;                                // explicit null/'' → clear the assignment
    const g = await db.query(`SELECT 1 FROM guide WHERE id::text = $1`, [gid]);
    if (!g.rows.length) throw new ValidationError(`unknown guideId "${gid}"`, 'guideId');
    return gid;
  }

  async function listDepartures(opts: { tourId?: string } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.tourId) {
      params.push(opts.tourId);
      where.push(`(t.slug = $${params.length} OR t.id::text = $${params.length})`);
    }
    const { rows } = await db.query(
      `SELECT d.*, t.slug AS tour_slug, t.title AS tour_title, p.slug AS package_slug, g.name AS guide_name
         FROM departure d JOIN tour t ON t.id = d.tour_id
         LEFT JOIN tour_package p ON p.id = d.package_id
         LEFT JOIN guide g ON g.id = d.guide_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY d.depart_on NULLS LAST, d.created_at`, params);
    return rows.map(departureDTO);
  }

  async function getDeparture(id: string) {
    const { rows } = await db.query(
      `SELECT d.*, t.slug AS tour_slug, t.title AS tour_title, p.slug AS package_slug, g.name AS guide_name
         FROM departure d JOIN tour t ON t.id = d.tour_id
         LEFT JOIN tour_package p ON p.id = d.package_id
         LEFT JOIN guide g ON g.id = d.guide_id WHERE d.id = $1`, [id]);
    return rows[0] ? departureDTO(rows[0]) : null;
  }

  async function createDeparture(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const tour = await resolveTourRow(reqStr(body, 'tourId', 200));
    if (!tour) throw new ValidationError('unknown tourId', 'tourId');
    let packageId: string | null = null;
    const pkgRef = optStr(body, 'packageId', 200);
    if (pkgRef) {
      const p = await db.query(`SELECT id FROM tour_package WHERE tour_id=$1 AND (slug=$2 OR id::text=$2)`, [tour.id, pkgRef]);
      if (!p.rows.length) throw new ValidationError(`unknown packageId "${pkgRef}" for this tour`, 'packageId');
      packageId = p.rows[0].id;
    }
    const dateIso = reqStr(body, 'date', 40);        // "YYYY-MM-DD" from <input type=date>
    const dateLabel = optStr(body, 'dateLabel', 120) ?? humanDate(dateIso);
    const time = optStr(body, 'time', 120) ?? null;
    const capacity = optInt(body, 'capacity', 1) ?? optInt(body, 'seatsTotal', 1);
    if (capacity == null) throw new ValidationError('"capacity" is required', 'capacity');
    const price = optMoney(body, 'price');
    const currency = (optStr(body, 'currency', 3) ?? tour.currency ?? 'USD').toUpperCase();
    const status = optEnum(body, 'status', ['scheduled', 'sold_out', 'completed', 'cancelled'] as const) ?? 'scheduled';
    const guideId = (await resolveGuideId(body)) ?? null;
    const notes = optStr(body, 'notes', 4000) ?? null;

    const { rows } = await db.query(
      `INSERT INTO departure (tour_id, package_id, guide_id, depart_on, date_label, time_label, price_minor,
          currency, seats_total, seats_reserved, status, notes_internal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11) RETURNING id`,
      [tour.id, packageId, guideId, dateIso, dateLabel, time, price != null ? toMinor(price) : null, currency, capacity, status, notes]);
    await audit(db, { actorId: actor.id, action: 'departure.create', targetType: 'departure', targetId: rows[0].id, after: { tour: tour.slug, date: dateLabel, capacity, status }, ip: actor.ip });
    return (await getDeparture(rows[0].id))!;
  }

  async function updateDeparture(id: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = (await db.query(`SELECT * FROM departure WHERE id = $1`, [id])).rows[0];
    if (!cur) throw notFound('departure');
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    const capacity = optInt(body, 'capacity', 0) ?? optInt(body, 'seatsTotal', 0);
    if (capacity != null) {
      if (capacity < Number(cur.seats_reserved)) throw conflict(`capacity ${capacity} is below ${cur.seats_reserved} already-reserved seats`);
      set('seats_total', capacity);
    }
    if (body.price !== undefined) { const p = optMoney(body, 'price'); set('price_minor', p != null ? toMinor(p) : null); }
    if (body.time !== undefined) set('time_label', optStr(body, 'time', 120) ?? null);
    if (body.dateLabel !== undefined) set('date_label', reqStr(body, 'dateLabel', 120));
    if (body.status !== undefined) set('status', optEnum(body, 'status', ['scheduled', 'sold_out', 'completed', 'cancelled'] as const));
    if (body.guideId !== undefined) set('guide_id', (await resolveGuideId(body)) ?? null);
    if (body.notes !== undefined) set('notes_internal', optStr(body, 'notes', 4000) ?? null);
    if (!sets.length) throw new ValidationError('no updatable fields provided');

    params.push(id);
    await db.query(`UPDATE departure SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}`, params);
    await audit(db, { actorId: actor.id, action: 'departure.update', targetType: 'departure', targetId: id, before: { seats_total: cur.seats_total, status: cur.status }, after: { capacity, status: body.status }, ip: actor.ip });
    return (await getDeparture(id))!;
  }

  async function cancelDeparture(id: string, body: unknown, actor: Actor) {
    const reason = isPlainObject(body) ? optStr(body, 'reason', 500) : undefined;
    const cur = (await db.query(`SELECT * FROM departure WHERE id = $1`, [id])).rows[0];
    if (!cur) throw notFound('departure');
    await db.query(`UPDATE departure SET status='cancelled', updated_at=now() WHERE id=$1`, [id]);
    await audit(db, { actorId: actor.id, action: 'departure.cancel', targetType: 'departure', targetId: id, before: { status: cur.status }, after: { status: 'cancelled', reason: reason ?? null }, ip: actor.ip });
    return (await getDeparture(id))!;
  }

  // ── Bookings (admin views + status transitions) ─────────────────────────────
  const CANCEL_REASONS = ['customer_request', 'non_payment', 'departure_cancelled', 'duplicate'] as const;
  const REASON_ALIAS: Record<string, string> = {
    'customer request': 'customer_request', 'non-payment': 'non_payment', 'non payment': 'non_payment',
    'departure cancelled': 'departure_cancelled', 'duplicate': 'duplicate', 'duplicate booking': 'duplicate',
  };
  function normalizeReason(raw: string): string {
    const key = raw.toLowerCase().trim();
    const v = REASON_ALIAS[key] ?? key;
    if (!(CANCEL_REASONS as readonly string[]).includes(v)) {
      throw new ValidationError(`reason must be one of: ${CANCEL_REASONS.join(', ')}`, 'reason');
    }
    return v;
  }

  function bookingRow(r: any) {
    return {
      ref: r.ref, status: r.status, payment: r.payment_state,
      customer: r.customer_name ?? null, customerId: r.customer_id ?? null,
      tour: r.tour_title, tourId: r.tour_slug, region: r.region_name,
      departureId: r.departure_id, date: r.date_label, travellers: Number(r.party_size),
      unit: fromMinor(r.unit_price_minor), total: fromMinor(r.total_minor), currency: r.currency,
      created: r.created_at,
    };
  }

  async function listBookings(opts: { status?: string; q?: string; page?: number; pageSize?: number } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.status && opts.status !== 'all') {
      params.push(opts.status); where.push(`b.status = $${params.length}`);
    }
    if (opts.q) {
      params.push(`%${opts.q}%`);
      where.push(`(b.ref ILIKE $${params.length} OR c.name ILIKE $${params.length} OR t.title ILIKE $${params.length})`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const total = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM booking b JOIN tour t ON t.id=b.tour_id LEFT JOIN customer c ON c.id=b.customer_id ${whereSql}`, params)).rows[0].n);
    params.push(pageSize); const lim = params.length;
    params.push((page - 1) * pageSize); const off = params.length;
    const { rows } = await db.query(
      `SELECT b.*, t.title AS tour_title, t.slug AS tour_slug, r.name AS region_name,
              c.name AS customer_name, d.date_label
         FROM booking b JOIN tour t ON t.id=b.tour_id JOIN region r ON r.id=t.region_id
         JOIN departure d ON d.id=b.departure_id LEFT JOIN customer c ON c.id=b.customer_id
        ${whereSql} ORDER BY b.created_at DESC LIMIT $${lim} OFFSET $${off}`, params);
    return { items: rows.map(bookingRow), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async function getBooking(ref: string) {
    const { rows } = await db.query(
      `SELECT b.*, t.title AS tour_title, t.slug AS tour_slug, r.name AS region_name,
              c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, d.date_label
         FROM booking b JOIN tour t ON t.id=b.tour_id JOIN region r ON r.id=t.region_id
         JOIN departure d ON d.id=b.departure_id LEFT JOIN customer c ON c.id=b.customer_id
        WHERE b.ref = $1`, [ref]);
    const b = rows[0];
    if (!b) throw notFound('booking');
    const travellers = (await db.query(`SELECT is_lead, name, email, phone FROM booking_traveller WHERE booking_id=$1 ORDER BY is_lead DESC`, [b.id]))
      .rows.map((t) => ({ isLead: t.is_lead, name: t.name, email: t.email ?? null, phone: t.phone ?? null }));
    const payments = (await paymentsForBooking(b.id));
    return {
      ...bookingRow(b),
      customerEmail: b.customer_email ?? null, customerPhone: b.customer_phone ?? null,
      specialRequests: b.special_requests ?? null, cancelReason: b.cancel_reason ?? null,
      reservationExpiresAt: b.reservation_expires_at ?? null,
      travellers, payments,
    };
  }

  async function confirmBooking(ref: string, actor: Actor) {
    const cur = (await db.query(`SELECT * FROM booking WHERE ref=$1`, [ref])).rows[0];
    if (!cur) throw notFound('booking');
    if (!['reserved', 'pending'].includes(cur.status)) throw conflict(`cannot confirm a booking in "${cur.status}" state`);
    await db.query(`UPDATE booking SET status='confirmed', updated_at=now() WHERE id=$1`, [cur.id]);
    await audit(db, { actorId: actor.id, action: 'booking.confirm', targetType: 'booking', targetId: cur.ref, before: { status: cur.status }, after: { status: 'confirmed' }, ip: actor.ip });
    return getBooking(ref);
  }

  async function cancelBooking(ref: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const reason = normalizeReason(reqStr(body, 'reason', 500));
    const result = await db.tx(async (q) => {
      const cur = (await q.query(`SELECT * FROM booking WHERE ref=$1 FOR UPDATE`, [ref])).rows[0];
      if (!cur) throw notFound('booking');
      if (cur.status === 'cancelled') throw conflict('booking is already cancelled');
      // Release held seats if this booking was holding inventory.
      const held = ['reserved', 'pending', 'confirmed'].includes(cur.status);
      if (held) {
        await q.query(`SELECT seats_reserved FROM departure WHERE id=$1 FOR UPDATE`, [cur.departure_id]);
        await q.query(`UPDATE departure SET seats_reserved = GREATEST(0, seats_reserved - $1), updated_at=now() WHERE id=$2`, [cur.party_size, cur.departure_id]);
      }
      // Release the promo redemption (TRI-896 C7): a cancelled booking frees the code it used.
      if (cur.promo_code_id) {
        await q.query(`UPDATE promo_code SET used_count = GREATEST(0, used_count - 1), updated_at=now() WHERE id=$1`, [cur.promo_code_id]);
      }
      await q.query(`UPDATE booking SET status='cancelled', cancel_reason=$1, updated_at=now() WHERE id=$2`, [reason, cur.id]);
      return { before: cur, seatsReleased: held ? Number(cur.party_size) : 0 };
    });
    await audit(db, { actorId: actor.id, action: 'booking.cancel', targetType: 'booking', targetId: ref, before: { status: result.before.status }, after: { status: 'cancelled', cancel_reason: reason, seatsReleased: result.seatsReleased }, ip: actor.ip });
    // Notify the traveller their booking was cancelled (fire-and-forget; never throws). TRI-889 P5.2.
    if (notifier) await notifier.bookingCancelled(ref, { reason });
    return { ...(await getBooking(ref)), seatsReleased: result.seatsReleased };
  }

  // ── Payments (admin views + refund FLAG) ────────────────────────────────────
  async function paymentSelect() {
    const fx = await hasFxColumns(db);
    const prov = await hasFxProvenanceColumns(db);
    const fxCols = fx ? 'p.usd_amount_minor, p.fx_rate_used, p.ghs_amount_minor'
      : 'NULL::int AS usd_amount_minor, NULL::numeric AS fx_rate_used, NULL::int AS ghs_amount_minor';
    const provCols = prov ? 'p.fx_source, p.fx_rate_at'
      : 'NULL::text AS fx_source, NULL::timestamptz AS fx_rate_at';
    return `${fxCols}, ${provCols}`;
  }
  // The per-payment `amount` is expressed in the row's `currency`. TRI-931: initPayment persists GHS
  // charge rows with amount_minor = USD-minor (kept as the USD-of-record) while the real GHS charge lives
  // in ghs_amount_minor — so `amount_minor` alone, labelled GHS, understated the charge by the FX rate
  // (~15.6×). Refund rows conversely store the GHS figure directly in amount_minor with ghs_amount_minor
  // NULL. So for GHS rows prefer ghs_amount_minor when present, else fall back to amount_minor (refunds /
  // legacy). Non-GHS rows use amount_minor verbatim.
  function displayAmountMinor(r: any): number {
    if (r.currency === 'GHS' && r.ghs_amount_minor != null) return Number(r.ghs_amount_minor);
    return Number(r.amount_minor);
  }
  function paymentDTO(r: any) {
    return {
      id: r.ref, ref: r.ref, bookingRef: r.booking_ref, customer: r.customer_name ?? null,
      amount: fromMinor(displayAmountMinor(r)), currency: r.currency, method: r.method, status: r.status,
      providerRef: r.provider_ref ?? null, created: r.created_at,
      usdAmount: r.usd_amount_minor == null ? null : fromMinor(r.usd_amount_minor),
      fxRate: r.fx_rate_used == null ? null : Number(r.fx_rate_used),
      ghsAmount: r.ghs_amount_minor == null ? null : Number(r.ghs_amount_minor) / 100,
      fxSource: r.fx_source ?? null,
      fxRateAt: r.fx_rate_at ?? null,
      refundIntent: r.raw?.refund_intent ?? null,
    };
  }

  async function paymentsForBooking(bookingId: string) {
    const fxCols = await paymentSelect();
    const { rows } = await db.query(
      `SELECT p.ref, p.amount_minor, p.currency, p.method, p.status, p.provider_ref, p.raw, p.created_at,
              ${fxCols}, b.ref AS booking_ref, c.name AS customer_name
         FROM payment p JOIN booking b ON b.id=p.booking_id LEFT JOIN customer c ON c.id=b.customer_id
        WHERE p.booking_id=$1 ORDER BY p.created_at`, [bookingId]);
    return rows.map(paymentDTO);
  }

  async function listPayments(opts: { status?: string; q?: string; page?: number; pageSize?: number } = {}) {
    const fxCols = await paymentSelect();
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.status && opts.status !== 'all') { params.push(opts.status); where.push(`p.status = $${params.length}`); }
    if (opts.q) { params.push(`%${opts.q}%`); where.push(`(p.ref ILIKE $${params.length} OR b.ref ILIKE $${params.length} OR c.name ILIKE $${params.length})`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const total = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM payment p JOIN booking b ON b.id=p.booking_id LEFT JOIN customer c ON c.id=b.customer_id ${whereSql}`, params)).rows[0].n);
    params.push(pageSize); const lim = params.length;
    params.push((page - 1) * pageSize); const off = params.length;
    const { rows } = await db.query(
      `SELECT p.ref, p.amount_minor, p.currency, p.method, p.status, p.provider_ref, p.raw, p.created_at,
              ${fxCols}, b.ref AS booking_ref, c.name AS customer_name
         FROM payment p JOIN booking b ON b.id=p.booking_id LEFT JOIN customer c ON c.id=b.customer_id
        ${whereSql} ORDER BY p.created_at DESC LIMIT $${lim} OFFSET $${off}`, params);
    return { items: rows.map(paymentDTO), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async function getPayment(ref: string) {
    const fxCols = await paymentSelect();
    const { rows } = await db.query(
      `SELECT p.ref, p.amount_minor, p.currency, p.method, p.status, p.provider_ref, p.raw, p.created_at,
              ${fxCols}, b.ref AS booking_ref, c.name AS customer_name
         FROM payment p JOIN booking b ON b.id=p.booking_id LEFT JOIN customer c ON c.id=b.customer_id
        WHERE p.ref=$1`, [ref]);
    if (!rows[0]) throw notFound('payment');
    return paymentDTO(rows[0]);
  }

  // ── Refund EXECUTION (TRI-897): real Paystack refund → linked negative row + status flip + audit ──
  // Money-touching. Idempotent by construction: (a) the original is flipped to 'refunded' so a repeat
  // call 409s, and (b) the refund row is keyed on the Paystack refund id via a partial-unique index, so
  // an admin retry or a racing refund webhook records the refund at most once.
  async function executeRefund(ref: string, body: unknown, actor: Actor) {
    if (!(await hasRefundColumns(db))) {
      throw new AdminError('not_ready', 'refund execution requires migration 013', 503);
    }
    const b = isPlainObject(body) ? body : {};
    const reason = optStr(b, 'reason', 1000) ?? null;
    const partial = optMoney(b, 'amount'); // whole units of the CHARGED currency (GHS); omit → full refund

    const cur = (await db.query(
      `SELECT id, ref, booking_id, amount_minor, currency, method, status, provider_ref, ghs_amount_minor
         FROM payment WHERE ref=$1`, [ref])).rows[0];
    if (!cur) throw notFound('payment');
    if (cur.status === 'refunded') throw conflict('payment is already refunded');
    if (cur.status !== 'paid') throw conflict(`only paid payments can be refunded (status is ${cur.status})`);

    // Refund in the charged currency (GHS for a Paystack card/MoMo txn); omitting the amount asks Paystack
    // for a full refund of the original transaction, which sidesteps any USD-of-record vs GHS mismatch.
    const chargedCurrency = cur.currency;
    const amountMinor = partial != null ? toMinor(partial) : undefined;

    let result;
    try {
      result = await paystack.refund({
        transaction: cur.provider_ref || cur.ref, // Paystack txn id if we have it, else our reference
        amountMinor,
        currency: chargedCurrency,
        merchantNote: reason ?? `Refund of ${cur.ref} by admin`,
      });
    } catch (e) {
      await audit(db, { actorId: actor.id, action: 'payment.refund_failed', targetType: 'payment', targetId: ref, before: { status: cur.status }, after: { error: (e as Error).message, amount: partial ?? null }, ip: actor.ip });
      const status = (e as any)?.status ?? 502;
      throw new AdminError('paystack_error', (e as Error).message, status);
    }

    const refundedMinor = result.amountMinor || amountMinor || Number(cur.ghs_amount_minor ?? cur.amount_minor);
    // A Paystack refund is 'processed' immediately in some cases, 'pending' in others (settled async via
    // the refund.processed webhook). Either way the money is committed to being returned, so we flip the
    // original to 'refunded' now; the webhook then reconciles idempotently (no double row, no double flip).
    await db.tx(async (q) => {
      await insertUniquePayRef(q, 'RFN', async (rfnRef) => {
        await q.query(
          `INSERT INTO payment (ref, booking_id, amount_minor, currency, method, status,
                                provider_ref, raw, refund_of, refund_provider_id)
           VALUES ($1,$2,$3,$4,$5,'refunded',$6,$7,$8,$9)
           ON CONFLICT (refund_provider_id) WHERE refund_provider_id IS NOT NULL DO NOTHING`,
          [rfnRef, cur.booking_id, -Math.abs(refundedMinor), chargedCurrency, cur.method,
           result.id, JSON.stringify({ refund: result.raw, reason, paystackStatus: result.status }),
           cur.id, result.id]);
      });
      await q.query(`UPDATE payment SET status='refunded' WHERE id=$1`, [cur.id]);
      await q.query(
        `UPDATE booking SET payment_state='refunded', updated_at=now() WHERE id=$1`, [cur.booking_id]);
    });

    await audit(db, {
      actorId: actor.id, action: 'payment.refunded', targetType: 'payment', targetId: ref,
      before: { status: 'paid' },
      after: { status: 'refunded', refundId: result.id, paystackStatus: result.status, amountMinor: -Math.abs(refundedMinor), currency: chargedCurrency, partial: partial ?? null, reason },
      ip: actor.ip,
    });
    return { refunded: true, refundId: result.id, paystackStatus: result.status, payment: await getPayment(ref) };
  }

  // ── Manual mark-paid (TRI-897): record an offline/bank settlement against a payment row ──
  // For payments taken outside Paystack (bank transfer, cash). Flips the payment + booking to paid and
  // confirms the booking, exactly like a Paystack success — but the actor + note are audited.
  async function markPaid(ref: string, body: unknown, actor: Actor) {
    const b = isPlainObject(body) ? body : {};
    const note = optStr(b, 'note', 1000) ?? null;
    const cur = (await db.query(
      `SELECT id, ref, booking_id, status FROM payment WHERE ref=$1`, [ref])).rows[0];
    if (!cur) throw notFound('payment');
    if (cur.status === 'paid') throw conflict('payment is already paid');
    if (cur.status === 'refunded') throw conflict('payment is refunded and cannot be marked paid');

    await db.tx(async (q) => {
      await q.query(
        `UPDATE payment SET status='paid',
                raw = COALESCE(raw,'{}'::jsonb) || jsonb_build_object('manual_settlement', $2::jsonb)
          WHERE id=$1`,
        [cur.id, JSON.stringify({ by: actor.id, note, at: new Date().toISOString() })]);
      await q.query(
        `UPDATE booking SET status='confirmed', payment_state='paid', updated_at=now() WHERE id=$1`,
        [cur.booking_id]);
    });
    await audit(db, {
      actorId: actor.id, action: 'payment.mark_paid', targetType: 'payment', targetId: ref,
      before: { status: cur.status }, after: { status: 'paid', note }, ip: actor.ip,
    });
    return { markedPaid: true, payment: await getPayment(ref) };
  }

  // ── Reconciliation export (TRI-897): payments + refunds over a date range for finance ──
  // Rows are charges (positive) and refund rows (negative). Returns structured rows + summary totals;
  // the route serialises to CSV. Amounts are whole-currency numbers (charges USD-of-record; refunds are
  // in the charged currency they were issued in) — `currency` on each row disambiguates.
  async function reconciliationReport(opts: { from?: string; to?: string } = {}) {
    const fxCols = await paymentSelect();
    const hasRefund = await hasRefundColumns(db);
    const refundCols = hasRefund ? 'p.refund_of, p.refund_provider_id'
      : 'NULL::uuid AS refund_of, NULL::text AS refund_provider_id';
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.from) { params.push(dayStart(opts.from)); where.push(`p.created_at >= $${params.length}`); }
    if (opts.to) { params.push(dayEnd(opts.to)); where.push(`p.created_at <= $${params.length}`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await db.query(
      `SELECT p.ref, p.amount_minor, p.currency, p.method, p.status, p.provider_ref, p.raw, p.created_at,
              ${fxCols}, ${refundCols}, b.ref AS booking_ref, c.name AS customer_name
         FROM payment p JOIN booking b ON b.id=p.booking_id LEFT JOIN customer c ON c.id=b.customer_id
        ${whereSql} ORDER BY p.created_at ASC`, params);

    const items = rows.map((r) => {
      const isRefund = r.refund_of != null || r.status === 'refunded' && Number(r.amount_minor) < 0;
      return {
        ref: r.ref, bookingRef: r.booking_ref, customer: r.customer_name ?? null,
        type: isRefund ? 'refund' : 'charge', method: r.method, status: r.status,
        currency: r.currency, amount: fromMinor(displayAmountMinor(r)),
        usdAmount: r.usd_amount_minor == null ? null : fromMinor(r.usd_amount_minor),
        fxRate: r.fx_rate_used == null ? null : Number(r.fx_rate_used),
        ghsAmount: r.ghs_amount_minor == null ? null : Number(r.ghs_amount_minor) / 100,
        providerRef: r.provider_ref ?? null,
        refundProviderId: r.refund_provider_id ?? null,
        created: r.created_at,
      };
    });
    // Summaries by currency (minor units → whole units), plus counts. Refund rows carry negative amounts.
    // Gross counts positive captured rows — 'paid' AND 'refunded' (a fully-refunded charge flips to
    // 'refunded' but the money was still captured); the linked negative refund row nets it back out.
    const byCurrency: Record<string, { grossMinor: number; refundMinor: number; charges: number; refunds: number }> = {};
    for (const r of rows) {
      const cur = byCurrency[r.currency] ?? (byCurrency[r.currency] = { grossMinor: 0, refundMinor: 0, charges: 0, refunds: 0 });
      const amt = displayAmountMinor(r); // TRI-931: sum the real charged amount (GHS), not USD-minor mislabelled GHS
      if (amt < 0) { cur.refundMinor += amt; cur.refunds += 1; }
      else if (r.status === 'paid' || r.status === 'refunded') { cur.grossMinor += amt; cur.charges += 1; }
    }
    const summary = Object.entries(byCurrency).map(([currency, s]) => ({
      currency, grossPaid: fromMinor(s.grossMinor), refunded: fromMinor(s.refundMinor),
      net: fromMinor(s.grossMinor + s.refundMinor), charges: s.charges, refunds: s.refunds,
    }));
    return { from: opts.from ?? null, to: opts.to ?? null, count: items.length, items, summary };
  }

  // Unique-ref insert helper for admin-side inserts (refund rows). Retries on a UNIQUE ref collision.
  async function insertUniquePayRef(q: Db, prefix: string, run: (ref: string) => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ref = `${prefix}-${refCode(6)}`;
      try { await run(ref); return; }
      catch (e: any) {
        if (/unique|duplicate/i.test(String(e?.message ?? e))) continue;
        throw e;
      }
    }
    throw new AdminError('ref_collision', 'Could not allocate a unique reference', 500);
  }

  // ── Reviews (moderation) ─────────────────────────────────────────────────
  // Reuses the Phase-1 review states (pending/approved/rejected) + the `reply` column — no schema.
  // Public /api/v1/tours/:slug/reviews reads live `status='approved'`, so a transition flips public
  // visibility immediately; we also recompute the tour's cached rating/count (no trigger maintains them).
  const REVIEW_SELECT = `
    SELECT r.id, r.tour_id, t.slug AS tour_slug, t.title AS tour_title,
           r.author_name, r.rating, r.title, r.text, r.verified, r.status, r.reply, r.created_at
      FROM review r JOIN tour t ON t.id = r.tour_id`;

  function mapReviewRow(r: any) {
    return {
      id: r.id,
      tourId: r.tour_slug,          // friendly id; the admin SPA's mapReview also accepts tourSlug/tour_id
      tourSlug: r.tour_slug,
      tour: r.tour_title,
      author: r.author_name,
      initials: initials(r.author_name),
      rating: Number(r.rating),
      date: formatReviewDate(r.created_at),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      verified: !!r.verified,
      status: r.status,
      title: r.title ?? '',
      text: r.text ?? '',
      reply: r.reply ?? null,
    };
  }

  async function recomputeTourReviewCache(q: Db, tourId: string) {
    await q.query(
      `UPDATE tour SET
         review_count_cached = (SELECT COUNT(*)::int FROM review WHERE tour_id = $1 AND status = 'approved'),
         rating_cached       = (SELECT ROUND(AVG(rating)::numeric, 1) FROM review WHERE tour_id = $1 AND status = 'approved')
       WHERE id = $1`, [tourId]);
  }

  async function loadReview(id: string) {
    const r = (await db.query(`${REVIEW_SELECT} WHERE r.id = $1`, [id])).rows[0];
    if (!r) throw notFound('review');
    return r;
  }

  const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;

  async function listReviews(filter: { status?: string } = {}) {
    const status = filter.status && REVIEW_STATUSES.includes(filter.status as any) ? filter.status : undefined;
    const where = status ? ` WHERE r.status = $1` : '';
    const { rows } = await db.query(`${REVIEW_SELECT}${where} ORDER BY r.created_at DESC`, status ? [status] : []);
    // Counts are always computed over ALL reviews (the admin UI's tabs/badges rely on the full picture,
    // independent of any active filter).
    const cRows = (await db.query(
      `SELECT status, COUNT(*)::int AS n FROM review GROUP BY status`)).rows as Array<{ status: string; n: number }>;
    const counts = { pending: 0, approved: 0, rejected: 0 } as Record<string, number>;
    for (const c of cRows) if (c.status in counts) counts[c.status] = Number(c.n);
    const total = counts.pending + counts.approved + counts.rejected;
    return { reviews: rows.map(mapReviewRow), counts, stats: { total, published: counts.approved, pending: counts.pending, rejected: counts.rejected } };
  }

  // approve → approved · reject → rejected · unpublish/restore → pending (hidden, back in the queue).
  const STATUS_FOR: Record<string, string> = { approve: 'approved', reject: 'rejected', unpublish: 'pending', restore: 'pending' };

  async function moderateReview(id: string, action: keyof typeof STATUS_FOR, actor: Actor) {
    const next = STATUS_FOR[action];
    if (!next) throw new ValidationError(`unknown review action: ${action}`);
    const cur = await loadReview(id);
    await db.tx(async (q) => {
      await q.query(`UPDATE review SET status = $1, updated_at = now() WHERE id = $2`, [next, id]);
      await recomputeTourReviewCache(q, cur.tour_id);
    });
    await audit(db, { actorId: actor.id, action: `review.${action}`, targetType: 'review', targetId: id, before: { status: cur.status }, after: { status: next }, ip: actor.ip });
    return { review: mapReviewRow(await loadReview(id)) };
  }

  async function replyReview(id: string, body: unknown, actor: Actor) {
    const reply = isPlainObject(body) ? (optStr(body, 'reply', 4000) ?? null) : null;
    const cur = await loadReview(id);
    await db.query(`UPDATE review SET reply = $1, updated_at = now() WHERE id = $2`, [reply, id]);
    await audit(db, { actorId: actor.id, action: 'review.reply', targetType: 'review', targetId: id, before: { reply: cur.reply ?? null }, after: { reply }, ip: actor.ip });
    return { review: mapReviewRow(await loadReview(id)) };
  }

  // ── Guides (TRI-896 A12) ─────────────────────────────────────────────────
  // The field roster. A real guide here is what departure.guide_id points at (FK from mig 004), so this
  // CRUD is what unblocks assigning a guide to a departure.
  const GUIDE_STATUS = ['active', 'leave', 'disabled'] as const;
  function guideDTO(g: any) {
    return {
      id: g.id, name: g.name, email: g.email ?? null, phone: g.phone ?? null, base: g.base ?? '',
      regions: g.regions ?? [], languages: g.languages ?? [], status: g.status,
      rating: g.rating == null ? null : Number(g.rating), trips: Number(g.trips_led ?? 0),
      bio: g.bio ?? '',
    };
  }
  function optRating(b: Body): number | undefined {
    const v = b.rating;
    if (v == null || v === '') return undefined;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 5) throw new ValidationError('"rating" must be between 0 and 5', 'rating');
    return Math.round(n * 10) / 10; // numeric(2,1)
  }

  async function listGuides() {
    const { rows } = await db.query(
      `SELECT g.*, (SELECT COUNT(*) FROM departure d WHERE d.guide_id = g.id) AS departure_count
         FROM guide g ORDER BY g.name`);
    return { guides: rows.map((g) => ({ ...guideDTO(g), departures: Number(g.departure_count) })) };
  }

  async function getGuide(id: string) {
    const g = (await db.query(`SELECT * FROM guide WHERE id::text = $1`, [id])).rows[0];
    if (!g) throw notFound('guide');
    return guideDTO(g);
  }

  async function createGuide(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const name = reqStr(body, 'name', 200);
    const email = optStr(body, 'email', 320) ?? null;
    const phone = optStr(body, 'phone', 60) ?? null;
    const base = optStr(body, 'base', 200) ?? null;
    const regions = optArrStr(body, 'regions') ?? [];
    const languages = optArrStr(body, 'languages') ?? [];
    const status = optEnum(body, 'status', GUIDE_STATUS) ?? 'active';
    const rating = optRating(body) ?? null;
    const tripsLed = optInt(body, 'tripsLed', 0) ?? optInt(body, 'trips', 0) ?? 0;
    const bio = optStr(body, 'bio', 4000) ?? null;
    const { rows } = await db.query(
      `INSERT INTO guide (name, email, phone, base, regions, languages, status, rating, trips_led, bio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [name, email, phone, base, regions, languages, status, rating, tripsLed, bio]);
    await audit(db, { actorId: actor.id, action: 'guide.create', targetType: 'guide', targetId: rows[0].id, after: { name, base, status }, ip: actor.ip });
    return getGuide(rows[0].id);
  }

  async function updateGuide(id: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = (await db.query(`SELECT * FROM guide WHERE id::text = $1`, [id])).rows[0];
    if (!cur) throw notFound('guide');
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    const name = optStr(body, 'name', 200); if (name != null) set('name', name);
    if (body.email !== undefined) set('email', optStr(body, 'email', 320) ?? null);
    if (body.phone !== undefined) set('phone', optStr(body, 'phone', 60) ?? null);
    if (body.base !== undefined) set('base', optStr(body, 'base', 200) ?? null);
    const regions = optArrStr(body, 'regions'); if (regions) set('regions', regions);
    const languages = optArrStr(body, 'languages'); if (languages) set('languages', languages);
    if (body.status !== undefined) set('status', optEnum(body, 'status', GUIDE_STATUS));
    if (body.rating !== undefined) set('rating', optRating(body) ?? null);
    if (body.tripsLed !== undefined || body.trips !== undefined) set('trips_led', optInt(body, 'tripsLed', 0) ?? optInt(body, 'trips', 0) ?? 0);
    if (body.bio !== undefined) set('bio', optStr(body, 'bio', 4000) ?? null);
    if (!sets.length) throw new ValidationError('no updatable fields provided');

    params.push(cur.id);
    await db.query(`UPDATE guide SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}`, params);
    await audit(db, { actorId: actor.id, action: 'guide.update', targetType: 'guide', targetId: cur.id, before: { name: cur.name, status: cur.status }, after: { name: name ?? cur.name }, ip: actor.ip });
    return getGuide(cur.id);
  }

  async function deleteGuide(id: string, actor: Actor) {
    const cur = (await db.query(`SELECT * FROM guide WHERE id::text = $1`, [id])).rows[0];
    if (!cur) throw notFound('guide');
    // FK is ON DELETE SET NULL, so any departures the guide led simply become "Assign later". We surface
    // the reassignment count in the audit trail rather than blocking.
    const dep = await db.query(`SELECT COUNT(*)::int AS n FROM departure WHERE guide_id = $1`, [cur.id]);
    await db.query(`DELETE FROM guide WHERE id = $1`, [cur.id]);
    await audit(db, { actorId: actor.id, action: 'guide.delete', targetType: 'guide', targetId: cur.id, before: { name: cur.name }, after: { departuresUnassigned: Number(dep.rows[0].n) }, ip: actor.ip });
    return { ok: true, departuresUnassigned: Number(dep.rows[0].n) };
  }

  // ── Promo codes (TRI-896 A13) ────────────────────────────────────────────
  const PROMO_TYPES = ['percent', 'fixed'] as const;
  // Fixed amounts are stored in minor units (per the 003 schema); the API speaks whole-currency numbers.
  function promoDTO(p: any) {
    const scopeLabel = p.scope === 'all' ? 'All tours'
      : p.scope === 'category' ? `Category: ${CAT_LABEL[p.scope_ref] ?? p.scope_ref}`
      : p.scope_ref;
    return {
      id: p.id, code: p.code, type: p.type,
      value: p.type === 'fixed' ? fromMinor(Number(p.value)) : Number(p.value),
      currency: p.currency ?? null,
      scope: p.scope, scopeRef: p.scope_ref ?? null, tours: scopeLabel,
      from: p.valid_from ?? null, to: p.valid_to ?? null,
      usageLimit: p.usage_limit == null ? null : Number(p.usage_limit),
      limit: p.usage_limit == null ? null : Number(p.usage_limit),
      used: Number(p.used_count ?? 0), active: p.active,
    };
  }

  function optDate(b: Body, field: string, alias?: string): string | null | undefined {
    const raw = b[field] ?? (alias ? b[alias] : undefined);
    if (raw === undefined) return undefined;
    if (raw == null || raw === '') return null;
    if (typeof raw !== 'string') throw new ValidationError(`"${field}" must be a date string`, field);
    const d = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
    if (isNaN(d.getTime())) throw new ValidationError(`"${field}" is not a valid date`, field);
    return d.toISOString();
  }

  // Resolve the promo scope from either explicit {scope, scopeRef} or the FE's fuzzy "tours" display string.
  async function resolvePromoScope(body: Body): Promise<{ scope: string; scopeRef: string | null }> {
    const explicit = optEnum(body, 'scope', ['all', 'category', 'tour'] as const);
    const refRaw = optStr(body, 'scopeRef', 200) ?? (explicit ? undefined : optStr(body, 'tours', 200));
    if (explicit) {
      if (explicit === 'all') return { scope: 'all', scopeRef: null };
      const ref = optStr(body, 'scopeRef', 200) ?? optStr(body, 'tours', 200);
      if (!ref) throw new ValidationError(`"scopeRef" is required for scope "${explicit}"`, 'scopeRef');
      if (explicit === 'category') return { scope: 'category', scopeRef: normalizeCategory(ref).enumv };
      return { scope: 'tour', scopeRef: await resolvePromoTourSlug(ref) };
    }
    // Lenient: interpret the "Applies to" display string.
    const tours = refRaw?.trim();
    if (!tours || /^all( tours)?$/i.test(tours)) return { scope: 'all', scopeRef: null };
    const key = tours.toLowerCase();
    if (LABEL_CAT[key] || CAT_LABEL[key]) return { scope: 'category', scopeRef: normalizeCategory(tours).enumv };
    return { scope: 'tour', scopeRef: await resolvePromoTourSlug(tours) };
  }
  async function resolvePromoTourSlug(ref: string): Promise<string> {
    const t = await db.query(`SELECT slug FROM tour WHERE slug=$1 OR id::text=$1 OR title=$1 LIMIT 1`, [ref]);
    if (!t.rows.length) throw new ValidationError(`unknown tour "${ref}" for promo scope`, 'scopeRef');
    return t.rows[0].slug;
  }

  function parsePromoValue(body: Body, type: string): { value: number; currency: string | null } {
    if (type === 'percent') {
      const v = optInt(body, 'value', 0);
      if (v == null) throw new ValidationError('"value" is required', 'value');
      if (v > 100) throw new ValidationError('percent "value" must be 0–100', 'value');
      return { value: v, currency: null };
    }
    const amt = optMoney(body, 'value');
    if (amt == null) throw new ValidationError('"value" is required', 'value');
    const currency = (optStr(body, 'currency', 3) ?? 'USD').toUpperCase();
    return { value: toMinor(amt), currency };
  }

  async function resolvePromoRow(idOrCode: string) {
    const { rows } = await db.query(`SELECT * FROM promo_code WHERE code = $1 OR id::text = $1 LIMIT 1`, [idOrCode.toUpperCase()]);
    return rows[0] ?? null;
  }

  async function listPromos() {
    const { rows } = await db.query(`SELECT * FROM promo_code ORDER BY created_at DESC`);
    return { promos: rows.map(promoDTO) };
  }

  async function getPromo(idOrCode: string) {
    const p = await resolvePromoRow(idOrCode);
    if (!p) throw notFound('promo code');
    return promoDTO(p);
  }

  async function createPromo(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const codeRaw = reqStr(body, 'code', 60).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(codeRaw)) throw new ValidationError('code must be uppercase letters/digits (no spaces)', 'code');
    const type = optEnum(body, 'type', PROMO_TYPES) ?? 'percent';
    const { value, currency } = parsePromoValue(body, type);
    const { scope, scopeRef } = await resolvePromoScope(body);
    const validFrom = optDate(body, 'validFrom', 'from') ?? null;
    const validTo = optDate(body, 'validTo', 'to') ?? null;
    const usageLimit = optInt(body, 'usageLimit', 0) ?? optInt(body, 'limit', 0) ?? null;
    const active = optBool(body, 'active') ?? true;

    const dup = await db.query(`SELECT 1 FROM promo_code WHERE code = $1`, [codeRaw]);
    if (dup.rows.length) throw conflict(`promo code "${codeRaw}" already exists`);

    const { rows } = await db.query(
      `INSERT INTO promo_code (code, type, value, currency, scope, scope_ref, valid_from, valid_to, usage_limit, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [codeRaw, type, value, currency, scope, scopeRef, validFrom, validTo, usageLimit, active]);
    await audit(db, { actorId: actor.id, action: 'promo.create', targetType: 'promo_code', targetId: rows[0].id, after: { code: codeRaw, type, scope, active }, ip: actor.ip });
    return getPromo(codeRaw);
  }

  async function updatePromo(idOrCode: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = await resolvePromoRow(idOrCode);
    if (!cur) throw notFound('promo code');
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    // type + value move together (fixed↔percent changes the stored units/currency).
    const type = optEnum(body, 'type', PROMO_TYPES);
    if (type || body.value !== undefined) {
      const effType = type ?? cur.type;
      set('type', effType);
      if (body.value !== undefined) {
        const { value, currency } = parsePromoValue(body, effType);
        set('value', value);
        set('currency', currency);
      } else if (type && type !== cur.type) {
        throw new ValidationError('changing "type" requires a new "value"', 'value');
      }
    }
    if (body.scope !== undefined || body.scopeRef !== undefined || body.tours !== undefined) {
      const { scope, scopeRef } = await resolvePromoScope(body);
      set('scope', scope); set('scope_ref', scopeRef);
    }
    const vf = optDate(body, 'validFrom', 'from'); if (vf !== undefined) set('valid_from', vf);
    const vt = optDate(body, 'validTo', 'to'); if (vt !== undefined) set('valid_to', vt);
    if (body.usageLimit !== undefined || body.limit !== undefined) set('usage_limit', optInt(body, 'usageLimit', 0) ?? optInt(body, 'limit', 0) ?? null);
    if (body.active !== undefined) set('active', optBool(body, 'active'));
    if (!sets.length) throw new ValidationError('no updatable fields provided');

    params.push(cur.id);
    await db.query(`UPDATE promo_code SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}`, params);
    await audit(db, { actorId: actor.id, action: 'promo.update', targetType: 'promo_code', targetId: cur.id, before: { code: cur.code, active: cur.active }, after: { code: cur.code }, ip: actor.ip });
    return getPromo(cur.code);
  }

  async function deactivatePromo(idOrCode: string, actor: Actor) {
    const cur = await resolvePromoRow(idOrCode);
    if (!cur) throw notFound('promo code');
    await db.query(`UPDATE promo_code SET active = false, updated_at=now() WHERE id=$1`, [cur.id]);
    await audit(db, { actorId: actor.id, action: 'promo.deactivate', targetType: 'promo_code', targetId: cur.id, before: { active: cur.active }, after: { active: false }, ip: actor.ip });
    return { ok: true, promo: await getPromo(cur.code) };
  }

  // ── Settings (org config incl the customer-facing DISPLAY rate) ──────────────
  // TRI-898 · The settings row carries TWO distinct USD→GHS rates that must never be conflated:
  //   • usd_to_ghs_display_rate  — customer-facing "approximate" figure (mig 007, default 15.6). Editable
  //       here; the consumer read path uses it for pricing hints (C19). Purely informational, never charged.
  //   • usd_to_ghs_charge_rate   — the live-converged rate that actually builds Paystack charges (mig 008),
  //       driven by the daily FX cron (TRI-873, provenance in fx_rate_history mig 010). READ-ONLY here so an
  //       ops edit to the display figure can never move real money. This resolves the FX-doc discrepancy.
  async function chargeRateProvenance(): Promise<{ source: string | null; at: string | null; note: string | null }> {
    try {
      const { rows } = await db.query(
        `SELECT source, fetched_at, note FROM fx_rate_history WHERE status = 'ok' ORDER BY fetched_at DESC LIMIT 1`);
      const r = rows[0];
      return { source: r?.source ?? null, at: r?.fetched_at ?? null, note: r?.note ?? null };
    } catch {
      return { source: null, at: null, note: null };   // 010 not applied → no provenance, still safe
    }
  }

  async function settingsDTO() {
    const s = (await db.query(`SELECT * FROM settings WHERE singleton = true`)).rows[0];
    if (!s) throw notFound('settings');
    const displayRate = Number(s.usd_to_ghs_display_rate);
    const chargeRate = s.usd_to_ghs_charge_rate == null ? null : Number(s.usd_to_ghs_charge_rate);
    const prov = await chargeRateProvenance();
    return {
      businessName: s.business_name ?? null,
      address: s.address ?? null,
      supportPhone: s.support_phone ?? null,
      supportEmail: s.support_email ?? null,
      currencyOfRecord: s.currency_of_record,
      displayCurrency: s.secondary_display_currency,
      secondaryDisplayCurrency: s.secondary_display_currency,
      usdToGhsDisplayRate: displayRate,
      cancellationPolicy: s.cancellation_policy_text ?? null,
      cancellationPolicyText: s.cancellation_policy_text ?? null,
      paymentDeadlineDays: Number(s.payment_deadline_days),
      flags: s.flags ?? {},
      updatedAt: s.updated_at,
      // Both FX rates surfaced side-by-side, each clearly labelled with its purpose + editability.
      fx: {
        displayRate: {
          value: displayRate,
          editable: true,
          purpose: 'Customer-facing approximate USD→GHS figure shown for pricing hints (C19). Never charged.',
        },
        chargeRate: {
          value: chargeRate,
          editable: false,
          source: prov.source,
          establishedAt: prov.at,
          note: prov.note,
          purpose: 'Live-converged USD→GHS rate used to build Paystack charges. Driven by the daily FX cron (TRI-873); edit via FX automation, not here.',
        },
      },
    };
  }

  async function getSettings() {
    return settingsDTO();
  }

  async function updateSettings(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    // Guard the charge rate explicitly: it is cron-driven, never hand-edited through the settings screen.
    if (body.usdToGhsChargeRate !== undefined || body.usd_to_ghs_charge_rate !== undefined || body.chargeRate !== undefined) {
      throw new ValidationError(
        'the USD→GHS charge rate is managed by the daily FX cron and cannot be edited here — only the display rate is editable',
        'usdToGhsChargeRate');
    }
    const cur = (await db.query(`SELECT * FROM settings WHERE singleton = true`)).rows[0];
    if (!cur) throw notFound('settings');

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.businessName !== undefined) set('business_name', optStr(body, 'businessName', 300) ?? null);
    if (body.address !== undefined) set('address', optStr(body, 'address', 2000) ?? null);
    if (body.supportPhone !== undefined) set('support_phone', optStr(body, 'supportPhone', 120) ?? null);
    if (body.supportEmail !== undefined) set('support_email', optStr(body, 'supportEmail', 320) ?? null);
    if (body.currencyOfRecord !== undefined) set('currency_of_record', reqStr(body, 'currencyOfRecord', 3).toUpperCase());
    // FE sends displayCurrency; accept secondaryDisplayCurrency too.
    const dispCur = body.displayCurrency !== undefined ? 'displayCurrency'
      : body.secondaryDisplayCurrency !== undefined ? 'secondaryDisplayCurrency' : undefined;
    if (dispCur) set('secondary_display_currency', reqStr(body, dispCur, 3).toUpperCase());
    if (body.usdToGhsDisplayRate !== undefined) {
      const rate = optMoney(body, 'usdToGhsDisplayRate');
      if (rate == null || rate <= 0) throw new ValidationError('"usdToGhsDisplayRate" must be a positive number', 'usdToGhsDisplayRate');
      set('usd_to_ghs_display_rate', rate);
    }
    const cancelField = body.cancellationPolicy !== undefined ? 'cancellationPolicy'
      : body.cancellationPolicyText !== undefined ? 'cancellationPolicyText' : undefined;
    if (cancelField) set('cancellation_policy_text', optStr(body, cancelField, 20000) ?? null);
    if (body.paymentDeadlineDays !== undefined) {
      const d = optInt(body, 'paymentDeadlineDays');
      if (d == null || ![3, 5, 7].includes(d)) throw new ValidationError('"paymentDeadlineDays" must be one of: 3, 5, 7', 'paymentDeadlineDays');
      set('payment_deadline_days', d);
    }
    if (body.flags !== undefined) {
      if (!isPlainObject(body.flags)) throw new ValidationError('"flags" must be an object', 'flags');
      set('flags', JSON.stringify(body.flags));
    }
    if (!sets.length) throw new ValidationError('no updatable settings fields provided');

    await db.query(`UPDATE settings SET ${sets.join(', ')}, updated_at = now() WHERE singleton = true`, params);
    await audit(db, {
      actorId: actor.id, action: 'settings.update', targetType: 'settings', targetId: 'singleton',
      before: { usd_to_ghs_display_rate: Number(cur.usd_to_ghs_display_rate), payment_deadline_days: Number(cur.payment_deadline_days) },
      after: { fields: sets.map((s) => s.split(' = ')[0]) }, ip: actor.ip,
    });
    return settingsDTO();
  }

  // ── Customers (A11) — ops-side booker records + their bookings ────────────────
  function customerRow(r: any) {
    return {
      id: r.id, name: r.name, email: r.email ?? null, phone: r.phone ?? null,
      country: r.country ?? null, userId: r.user_id ?? null,
      joined: r.joined_at, createdAt: r.created_at,
      bookings: Number(r.booking_count ?? 0),
      totalSpend: fromMinor(Number(r.total_spend_minor ?? 0)),
      // TRI-941: account state derived from the linked user_account (guests have no account → both null).
      hasAccount: !!r.user_id,
      emailVerified: r.user_id ? !!r.email_verified_at : null,
      emailVerifiedAt: r.email_verified_at ?? null,
      // TRI-943: avatar moderation surface. Admin sees the real image + status even when hidden from public.
      avatarStatus: r.user_id ? (r.avatar_status ?? null) : null,
      avatarUrl: r.user_id ? (r.avatar_url ?? null) : null,
    };
  }

  async function listCustomers(opts: { q?: string; page?: number; pageSize?: number } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.q) {
      params.push(`%${opts.q}%`);
      where.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const total = Number((await db.query(`SELECT COUNT(*)::int AS n FROM customer c ${whereSql}`, params)).rows[0].n);
    params.push(pageSize); const lim = params.length;
    params.push((page - 1) * pageSize); const off = params.length;
    // Per-customer booking count + lifetime spend (paid bookings only) derived at read time.
    const { rows } = await db.query(
      `SELECT c.*, u.email_verified_at, u.avatar_status, am.url AS avatar_url,
              (SELECT COUNT(*) FROM booking b WHERE b.customer_id = c.id) AS booking_count,
              (SELECT COALESCE(SUM(b.total_minor),0) FROM booking b
                 WHERE b.customer_id = c.id AND b.payment_state = 'paid') AS total_spend_minor
         FROM customer c LEFT JOIN user_account u ON u.id = c.user_id
              LEFT JOIN media_asset am ON am.id = u.avatar_media_id ${whereSql}
        ORDER BY c.created_at DESC LIMIT $${lim} OFFSET $${off}`, params);
    return { items: rows.map(customerRow), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async function getCustomer(id: string) {
    const c = (await db.query(
      `SELECT c.*, u.email_verified_at, u.avatar_status, am.url AS avatar_url,
              (SELECT COUNT(*) FROM booking b WHERE b.customer_id = c.id) AS booking_count,
              (SELECT COALESCE(SUM(b.total_minor),0) FROM booking b
                 WHERE b.customer_id = c.id AND b.payment_state = 'paid') AS total_spend_minor
         FROM customer c LEFT JOIN user_account u ON u.id = c.user_id
              LEFT JOIN media_asset am ON am.id = u.avatar_media_id WHERE c.id::text = $1`, [id])).rows[0];
    if (!c) throw notFound('customer');
    const bookings = (await db.query(
      `SELECT b.ref, b.status, b.payment_state, b.party_size, b.total_minor, b.currency, b.created_at,
              t.title AS tour_title, t.slug AS tour_slug, d.date_label
         FROM booking b JOIN tour t ON t.id = b.tour_id JOIN departure d ON d.id = b.departure_id
        WHERE b.customer_id = $1 ORDER BY b.created_at DESC`, [c.id])).rows;
    return {
      ...customerRow(c),
      bookings: bookings.map((b) => ({
        ref: b.ref, status: b.status, payment: b.payment_state,
        tour: b.tour_title, tourId: b.tour_slug, date: b.date_label,
        travellers: Number(b.party_size), total: fromMinor(b.total_minor), currency: b.currency,
        created: b.created_at,
      })),
    };
  }

  // ── Audit-log read (A16) — paginated, read-only, for the AuditTimeline screen ─
  async function listAuditLog(opts: { action?: string; targetType?: string; targetId?: string; actorId?: string; page?: number; pageSize?: number } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    const eq = (col: string, val?: string) => { if (val) { params.push(val); where.push(`${col} = $${params.length}`); } };
    eq('a.action', opts.action);
    eq('a.target_type', opts.targetType);
    eq('a.target_id', opts.targetId);
    eq('a.actor_id', opts.actorId);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize || 50));
    const total = Number((await db.query(`SELECT COUNT(*)::int AS n FROM audit_log a ${whereSql}`, params)).rows[0].n);
    params.push(pageSize); const lim = params.length;
    params.push((page - 1) * pageSize); const off = params.length;
    const { rows } = await db.query(
      `SELECT a.id, a.actor_type, a.actor_id, a.action, a.target_type, a.target_id,
              a.before, a.after, a.ip, a.created_at, u.name AS actor_name, u.email AS actor_email
         FROM audit_log a LEFT JOIN staff_user u ON u.id = a.actor_id
        ${whereSql} ORDER BY a.created_at DESC LIMIT $${lim} OFFSET $${off}`, params);
    const items = rows.map((r) => ({
      id: r.id, action: r.action,
      actorType: r.actor_type, actorId: r.actor_id ?? null,
      actor: r.actor_name ?? r.actor_email ?? (r.actor_type === 'staff' ? 'Staff' : 'System'),
      actorEmail: r.actor_email ?? null,
      targetType: r.target_type ?? null, targetId: r.target_id ?? null,
      before: r.before ?? null, after: r.after ?? null,
      ip: r.ip ?? null, createdAt: r.created_at,
    }));
    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  // ── Dashboard aggregates (A15) — summary counts for the console home ──────────
  const RANGE_DAYS: Record<string, number | null> = { '7d': 7, '30d': 30, '90d': 90, ytd: null, all: null };
  async function getDashboard(opts: { range?: string } = {}) {
    const range = opts.range && opts.range in RANGE_DAYS ? opts.range : '30d';
    // created_at window for booking/revenue metrics (ytd = since Jan 1; all = no bound).
    let sinceSql = 'true';
    if (range === 'ytd') sinceSql = `b.created_at >= date_trunc('year', now())`;
    else if (range !== 'all') sinceSql = `b.created_at >= now() - interval '${RANGE_DAYS[range]} days'`;

    // Booking counts by status within the window + total.
    const byStatus = (await db.query(
      `SELECT b.status, COUNT(*)::int AS n FROM booking b WHERE ${sinceSql} GROUP BY b.status`)).rows;
    const bookingsByStatus: Record<string, number> = {};
    let bookingsTotal = 0;
    for (const r of byStatus) { bookingsByStatus[r.status] = Number(r.n); bookingsTotal += Number(r.n); }

    // Revenue: USD of record (paid bookings) + GHS actually charged (paid payments, guarded pre-008).
    const usdRow = (await db.query(
      `SELECT COALESCE(SUM(b.total_minor),0)::bigint AS usd_minor
         FROM booking b WHERE ${sinceSql} AND b.payment_state = 'paid'`)).rows[0];
    const revenueUsd = fromMinor(Number(usdRow.usd_minor));
    let revenueGhs: number | null = null;
    if (await hasFxColumns(db)) {
      const ghsRow = (await db.query(
        `SELECT COALESCE(SUM(p.ghs_amount_minor),0)::bigint AS ghs_minor
           FROM payment p JOIN booking b ON b.id = p.booking_id
          WHERE p.status = 'paid' AND (${sinceSql})`)).rows[0];
      revenueGhs = Number(ghsRow.ghs_minor) / 100;
    }

    // Upcoming departures (scheduled, dated today or later) + next few.
    const upcomingCount = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM departure d
        WHERE d.status = 'scheduled' AND (d.depart_on IS NULL OR d.depart_on >= current_date)`)).rows[0].n);
    const upcoming = (await db.query(
      `SELECT d.id, d.date_label, d.depart_on, d.seats_total, d.seats_reserved, t.title AS tour_title, t.slug AS tour_slug
         FROM departure d JOIN tour t ON t.id = d.tour_id
        WHERE d.status = 'scheduled' AND (d.depart_on IS NULL OR d.depart_on >= current_date)
        ORDER BY d.depart_on NULLS LAST, d.created_at LIMIT 5`)).rows.map((d) => ({
          id: d.id, tour: d.tour_title, tourId: d.tour_slug, date: d.date_label, departOn: d.depart_on,
          seatsTotal: Number(d.seats_total), booked: Number(d.seats_reserved),
          spotsLeft: Math.max(0, Number(d.seats_total) - Number(d.seats_reserved)),
        }));

    // Seat utilisation across upcoming scheduled departures.
    const seatRow = (await db.query(
      `SELECT COALESCE(SUM(d.seats_total),0)::int AS total, COALESCE(SUM(d.seats_reserved),0)::int AS reserved
         FROM departure d
        WHERE d.status = 'scheduled' AND (d.depart_on IS NULL OR d.depart_on >= current_date)`)).rows[0];
    const seatsTotal = Number(seatRow.total), seatsReserved = Number(seatRow.reserved);
    const occupancyPct = seatsTotal > 0 ? Math.round((seatsReserved / seatsTotal) * 1000) / 10 : 0;

    return {
      range,
      bookings: { total: bookingsTotal, byStatus: bookingsByStatus },
      revenue: { usd: revenueUsd, currency: 'USD', ghs: revenueGhs, ghsCurrency: 'GHS' },
      departures: { upcoming: upcomingCount, next: upcoming },
      occupancy: { seatsTotal, seatsReserved, spotsLeft: Math.max(0, seatsTotal - seatsReserved), utilizationPct: occupancyPct },
    };
  }

  // ── Blog / CMS (TRI-917) ─────────────────────────────────────────────────
  // The console authors stories here; the consumer web reads only status='published' (src/content.ts).
  // Body is stored as a jsonb block array; the editor round-trips it through the plain-text projection
  // (blocksToText / textToBlocks) so authors work in a friendly format without a rich-text dependency.
  const BLOG_STATUS = ['draft', 'published'] as const;

  function blogListDTO(p: any) {
    return {
      id: p.id, slug: p.slug, tag: p.tag ?? null, status: p.status,
      published: p.status === 'published',
      readTime: p.read_time == null || p.read_time === '' ? null : Number(p.read_time),
      date: formatReviewDate(p.published_at) || '',
      title: p.title, excerpt: p.excerpt ?? '', hero: p.hero_url ?? null,
      updated: formatReviewDate(p.updated_at) || '',
    };
  }
  function blogDetailDTO(p: any) {
    const body = Array.isArray(p.body) ? p.body : [];
    return {
      ...blogListDTO(p),
      heroAlt: p.hero_alt ?? null, author: p.author ?? null,
      body, bodyText: blocksToText(body),
    };
  }

  // Body arrives as either `bodyText` (the editor's plain-text form) or `body` (a raw block array).
  function readBlogBody(body: Body): unknown[] | undefined {
    if (typeof body.bodyText === 'string') return textToBlocks(body.bodyText);
    if (Array.isArray(body.body)) return body.body;
    return undefined;
  }
  // Publish state may come as `status` ('draft'|'published') or a boolean `published`.
  function readBlogStatus(body: Body): string | undefined {
    const s = optEnum(body, 'status', BLOG_STATUS);
    if (s) return s;
    const pub = optBool(body, 'published');
    return pub == null ? undefined : (pub ? 'published' : 'draft');
  }

  async function loadBlog(idOrSlug: string) {
    const { rows } = await db.query(`SELECT * FROM blog_post WHERE id::text = $1 OR slug = $1 LIMIT 1`, [idOrSlug]);
    return rows[0] ?? null;
  }

  async function listBlog() {
    const { rows } = await db.query(
      `SELECT * FROM blog_post ORDER BY published_at DESC NULLS LAST, updated_at DESC`);
    return { posts: rows.map(blogListDTO) };
  }

  async function getBlog(idOrSlug: string) {
    const p = await loadBlog(idOrSlug);
    if (!p) throw notFound('post');
    return blogDetailDTO(p);
  }

  async function createBlog(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const title = reqStr(body, 'title', 300);
    let slug = optStr(body, 'slug', 200);
    slug = slug ? slugify(slug) : slugify(title);
    if (!slug) throw new ValidationError('could not derive a slug from the title', 'slug');
    if ((await db.query(`SELECT 1 FROM blog_post WHERE slug = $1`, [slug])).rows.length) {
      throw conflict(`a post with slug "${slug}" already exists`);
    }
    const tag = optStr(body, 'tag', 120) ?? null;
    const excerpt = optStr(body, 'excerpt', 2000) ?? null;
    const hero = optStr(body, 'hero', 1000) ?? optStr(body, 'heroUrl', 1000) ?? null;
    const heroAlt = optStr(body, 'heroAlt', 1000) ?? null;
    const author = optStr(body, 'author', 200) ?? null;
    const readTime = optInt(body, 'readTime', 0);
    const status = readBlogStatus(body) ?? 'draft';
    const blocks = readBlogBody(body) ?? [];
    // Publishing with no explicit date stamps "now"; a draft keeps the authored date (or null).
    let publishedAt = optDate(body, 'publishedAt', 'date');
    if (publishedAt === undefined) publishedAt = status === 'published' ? new Date().toISOString() : null;

    const { rows } = await db.query(
      `INSERT INTO blog_post (slug, tag, read_time, published_at, title, excerpt, hero_url, hero_alt, author, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [slug, tag, readTime == null ? null : String(readTime), publishedAt, title, excerpt, hero, heroAlt, author, JSON.stringify(blocks), status]);
    await audit(db, { actorId: actor.id, action: 'blog.create', targetType: 'blog_post', targetId: rows[0].id, after: { slug, title, status }, ip: actor.ip });
    return getBlog(rows[0].id);
  }

  async function updateBlog(idOrSlug: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = await loadBlog(idOrSlug);
    if (!cur) throw notFound('post');
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    const title = optStr(body, 'title', 300); if (title != null) set('title', title.trim());
    if (body.slug !== undefined) {
      const s = slugify(optStr(body, 'slug', 200) ?? '');
      if (!s) throw new ValidationError('slug cannot be empty', 'slug');
      if (s !== cur.slug && (await db.query(`SELECT 1 FROM blog_post WHERE slug=$1 AND id<>$2`, [s, cur.id])).rows.length) {
        throw conflict(`a post with slug "${s}" already exists`);
      }
      set('slug', s);
    }
    if (body.tag !== undefined) set('tag', optStr(body, 'tag', 120) ?? null);
    if (body.excerpt !== undefined) set('excerpt', optStr(body, 'excerpt', 2000) ?? null);
    if (body.hero !== undefined || body.heroUrl !== undefined) set('hero_url', optStr(body, 'hero', 1000) ?? optStr(body, 'heroUrl', 1000) ?? null);
    if (body.heroAlt !== undefined) set('hero_alt', optStr(body, 'heroAlt', 1000) ?? null);
    if (body.author !== undefined) set('author', optStr(body, 'author', 200) ?? null);
    if (body.readTime !== undefined) { const rt = optInt(body, 'readTime', 0); set('read_time', rt == null ? null : String(rt)); }
    const blocks = readBlogBody(body); if (blocks !== undefined) set('body', JSON.stringify(blocks));
    const status = readBlogStatus(body);
    if (status !== undefined) {
      set('status', status);
      // First-time publish with no stored date → stamp now; keep any existing/authored date otherwise.
      if (status === 'published' && !cur.published_at && optDate(body, 'publishedAt', 'date') === undefined) set('published_at', new Date().toISOString());
    }
    const pd = optDate(body, 'publishedAt', 'date'); if (pd !== undefined) set('published_at', pd);
    if (!sets.length) throw new ValidationError('no updatable fields provided');

    params.push(cur.id);
    await db.query(`UPDATE blog_post SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
    await audit(db, { actorId: actor.id, action: 'blog.update', targetType: 'blog_post', targetId: cur.id, before: { slug: cur.slug, status: cur.status }, after: { title: title ?? cur.title, status: status ?? cur.status }, ip: actor.ip });
    return getBlog(cur.id);
  }

  async function setBlogPublished(idOrSlug: string, published: boolean, actor: Actor) {
    const cur = await loadBlog(idOrSlug);
    if (!cur) throw notFound('post');
    const status = published ? 'published' : 'draft';
    const stampNow = published && !cur.published_at;
    await db.query(
      `UPDATE blog_post SET status = $1${stampNow ? ', published_at = now()' : ''}, updated_at = now() WHERE id = $2`,
      [status, cur.id]);
    await audit(db, { actorId: actor.id, action: published ? 'blog.publish' : 'blog.unpublish', targetType: 'blog_post', targetId: cur.id, before: { status: cur.status }, after: { status }, ip: actor.ip });
    return getBlog(cur.id);
  }

  async function deleteBlog(idOrSlug: string, actor: Actor) {
    const cur = await loadBlog(idOrSlug);
    if (!cur) throw notFound('post');
    await db.query(`DELETE FROM blog_post WHERE id = $1`, [cur.id]);
    await audit(db, { actorId: actor.id, action: 'blog.delete', targetType: 'blog_post', targetId: cur.id, before: { slug: cur.slug, title: cur.title }, ip: actor.ip });
    return { ok: true };
  }

  return {
    listRegions, createRegion, updateRegion, deleteRegion,
    listTours, getTour, createTour, updateTour, setTourPublished, deleteTour,
    listDepartures, getDeparture, createDeparture, updateDeparture, cancelDeparture,
    listBookings, getBooking, confirmBooking, cancelBooking,
    listPayments, getPayment, executeRefund, markPaid, reconciliationReport,
    listReviews, moderateReview, replyReview,
    listGuides, getGuide, createGuide, updateGuide, deleteGuide,
    listPromos, getPromo, createPromo, updatePromo, deactivatePromo,
    getSettings, updateSettings,
    listCustomers, getCustomer,
    listAuditLog,
    getDashboard,
    listBlog, getBlog, createBlog, updateBlog, setBlogPublished, deleteBlog,
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
