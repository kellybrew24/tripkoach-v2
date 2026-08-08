// TRI-869 Phase 3 · Admin write/read service. Every mutation validates its input, runs guarded by a
// permission (see routes), and writes an audit_log row. Money crosses the wire as whole-currency numbers
// with an explicit currency (mirroring the Phase 1 read contract); it is stored as integer minor units.

import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { fromMinor, toMinor, slugify } from './util.ts';
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
      `SELECT c.*,
              (SELECT COUNT(*) FROM booking b WHERE b.customer_id = c.id) AS booking_count,
              (SELECT COALESCE(SUM(b.total_minor),0) FROM booking b
                 WHERE b.customer_id = c.id AND b.payment_state = 'paid') AS total_spend_minor
         FROM customer c ${whereSql}
        ORDER BY c.created_at DESC LIMIT $${lim} OFFSET $${off}`, params);
    return { items: rows.map(customerRow), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async function getCustomer(id: string) {
    const c = (await db.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM booking b WHERE b.customer_id = c.id) AS booking_count,
              (SELECT COALESCE(SUM(b.total_minor),0) FROM booking b
                 WHERE b.customer_id = c.id AND b.payment_state = 'paid') AS total_spend_minor
         FROM customer c WHERE c.id::text = $1`, [id])).rows[0];
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

  return {
    listRegions, createRegion, updateRegion, deleteRegion,
    listTours, getTour, createTour, updateTour, setTourPublished, deleteTour,
    listDepartures, getDeparture, createDeparture, updateDeparture, cancelDeparture,
    listBookings, getBooking, confirmBooking, cancelBooking,
    listPayments, getPayment, flagRefund,
    getSettings, updateSettings,
    listCustomers, getCustomer,
    listAuditLog,
    getDashboard,
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
