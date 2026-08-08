// TRI-869 Phase 3 · Admin write/read service. Every mutation validates its input, runs guarded by a
// permission (see routes), and writes an audit_log row. Money crosses the wire as whole-currency numbers
// with an explicit currency (mirroring the Phase 1 read contract); it is stored as integer minor units.

import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { fromMinor, toMinor, slugify, formatReviewDate, initials } from './util.ts';
import { audit } from './auth.ts';

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

// ─────────────────────────────────────────────────────────────────────────────
export function createAdminService(db: Db, _cfg: Config) {
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
              t.base_price_minor, t.rating_cached, t.review_count_cached, t.published,
              (SELECT COUNT(*) FROM departure d WHERE d.tour_id = t.id) AS departures
         FROM tour t JOIN region r ON r.id = t.region_id
        ORDER BY t.title`);
    return rows.map((t) => ({
      id: t.slug, uuid: t.id, title: t.title, region: t.region,
      category: t.category_label, categoryEnum: t.category, currency: t.currency,
      price: fromMinor(t.base_price_minor), rating: t.rating_cached == null ? null : Number(t.rating_cached),
      reviews: Number(t.review_count_cached || 0), published: t.published, departures: Number(t.departures),
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
    else { const p = optMoney(body, 'price'); if (p != null) set('base_price_minor', toMinor(p)); }

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
      guideId: r.guide_id ?? null, notes: r.notes_internal ?? null,
    };
  }

  async function listDepartures(opts: { tourId?: string } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.tourId) {
      params.push(opts.tourId);
      where.push(`(t.slug = $${params.length} OR t.id::text = $${params.length})`);
    }
    const { rows } = await db.query(
      `SELECT d.*, t.slug AS tour_slug, t.title AS tour_title, p.slug AS package_slug
         FROM departure d JOIN tour t ON t.id = d.tour_id
         LEFT JOIN tour_package p ON p.id = d.package_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY d.depart_on NULLS LAST, d.created_at`, params);
    return rows.map(departureDTO);
  }

  async function getDeparture(id: string) {
    const { rows } = await db.query(
      `SELECT d.*, t.slug AS tour_slug, t.title AS tour_title, p.slug AS package_slug
         FROM departure d JOIN tour t ON t.id = d.tour_id
         LEFT JOIN tour_package p ON p.id = d.package_id WHERE d.id = $1`, [id]);
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
    const guideId = optStr(body, 'guideId', 64) ?? null;
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
    if (body.guideId !== undefined) set('guide_id', optStr(body, 'guideId', 64) ?? null);
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
      await q.query(`UPDATE booking SET status='cancelled', cancel_reason=$1, updated_at=now() WHERE id=$2`, [reason, cur.id]);
      return { before: cur, seatsReleased: held ? Number(cur.party_size) : 0 };
    });
    await audit(db, { actorId: actor.id, action: 'booking.cancel', targetType: 'booking', targetId: ref, before: { status: result.before.status }, after: { status: 'cancelled', cancel_reason: reason, seatsReleased: result.seatsReleased }, ip: actor.ip });
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
  function paymentDTO(r: any) {
    return {
      id: r.ref, ref: r.ref, bookingRef: r.booking_ref, customer: r.customer_name ?? null,
      amount: fromMinor(r.amount_minor), currency: r.currency, method: r.method, status: r.status,
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

  // Refund is FLAG-only here: record the intent (in payment.raw + audit_log). Actual Paystack refund
  // execution is a deliberate follow-up (see README) — status is NOT flipped to 'refunded'.
  async function flagRefund(ref: string, body: unknown, actor: Actor) {
    const reason = isPlainObject(body) ? optStr(body, 'reason', 1000) ?? null : null;
    const cur = (await db.query(`SELECT id, ref, status, raw FROM payment WHERE ref=$1`, [ref])).rows[0];
    if (!cur) throw notFound('payment');
    if (cur.status === 'refunded') throw conflict('payment is already refunded');
    const intent = { requestedBy: actor.id, reason, at: new Date().toISOString(), status: 'requested' };
    await db.query(
      `UPDATE payment SET raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('refund_intent', $1::jsonb) WHERE id=$2`,
      [JSON.stringify(intent), cur.id]);
    await audit(db, { actorId: actor.id, action: 'payment.refund_requested', targetType: 'payment', targetId: ref, before: { status: cur.status }, after: { refundIntent: intent }, ip: actor.ip });
    return { refundRequested: true, payment: await getPayment(ref) };
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

  return {
    listRegions, createRegion, updateRegion, deleteRegion,
    listTours, getTour, createTour, updateTour, setTourPublished, deleteTour,
    listDepartures, getDeparture, createDeparture, updateDeparture, cancelDeparture,
    listBookings, getBooking, confirmBooking, cancelBooking,
    listPayments, getPayment, flagRefund,
    listReviews, moderateReview, replyReview,
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
