// TRI-943 · Customer avatar upload + image moderation service (parent TRI-942 → TRI-857).
//
// Board posture — TRI-1185 Option B "approve-before-visible" (default): a valid avatar lands 'pending' and
// is NOT public until an admin approves it via the moderation queue. It still clears the hardened automated
// gate (magic-byte + type allow-list + size + dimension caps in the media pipeline) plus the moderateImage()
// seam below (returns { allowed:true } in v1; a future paid classifier swaps that seam's body — no caller
// changes). Setting env AVATAR_APPROVE_BEFORE_VISIBLE=false restores the v1 Option A "show-then-moderate"
// behaviour byte-for-byte (a valid avatar goes LIVE immediately; report/admin action hides it).
//
// Storage is NOT re-invented here: the upload rides the TRI-918 media pipeline (validate → SHA-256 dedupe →
// SigV4 PUT to Cloudflare R2 → immutable cdn.tripkoach.com URL, recorded in media_asset). This service owns
// only the moderation state on user_account + the avatar_moderation_action audit trail.

import type { Db } from './db.ts';
import type { Config } from './config.ts';
import type { MediaService } from './media.ts';
import { MediaError } from './media.ts';
import { audit } from './auth.ts';

// ── Hardened avatar limits (stricter than the general media library) ─────────────────────────────────────
// Avatars are user-generated and public-facing, so the allow-list drops GIF (no animated avatars) and the
// size/dimension caps are tighter than the 10MB library ceiling. Overridable via env for ops tuning.
const num = (v: string | undefined, d: number) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : d; };
export const AVATAR_MAX_BYTES = num(process.env.AVATAR_MAX_BYTES, 5 * 1024 * 1024);   // ~5MB
export const AVATAR_MAX_DIMENSION = num(process.env.AVATAR_MAX_DIMENSION, 4096);      // 4096×4096
export const AVATAR_ALLOWED_TYPES = (process.env.AVATAR_ALLOWED_TYPES || 'image/jpeg,image/png,image/webp')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Report abuse guard: at most this many reports per reporter within the window (any targets).
const REPORT_WINDOW_SECONDS = num(process.env.AVATAR_REPORT_WINDOW_SECONDS, 3600);
const REPORT_MAX_PER_WINDOW = num(process.env.AVATAR_REPORT_MAX_PER_WINDOW, 5);

export class AvatarError extends Error {
  code: string;
  httpStatus: number;
  field?: string;
  constructor(code: string, message: string, httpStatus = 400, field?: string) {
    super(message);
    this.name = 'AvatarError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

export interface AvatarActor { id: string; ip: string | null }

// TRI-1185 board posture — Option B "approve-before-visible" (default): an avatar is served publicly ONLY
// once an admin has approved it. A freshly-uploaded avatar sits 'pending' and the FE renders the default DS
// placeholder until an admin approves; rejected/hidden ⇒ null as before. Setting the env
// AVATAR_APPROVE_BEFORE_VISIBLE=false restores the v1 Option A "show-then-moderate" behaviour byte-for-byte
// (a 'pending' avatar is served immediately). Read once at module load so avatarUrlFor() (used standalone by
// the /me serializer) and the upload gate below agree without threading a flag through every caller.
export const AVATAR_APPROVE_BEFORE_VISIBLE =
  (process.env.AVATAR_APPROVE_BEFORE_VISIBLE ?? 'true').toLowerCase() !== 'false';
const isVisible = (status: string | null | undefined) =>
  AVATAR_APPROVE_BEFORE_VISIBLE ? status === 'approved' : status === 'approved' || status === 'pending';
export function avatarUrlFor(status: string | null | undefined, url: string | null | undefined): string | null {
  return isVisible(status) ? (url ?? null) : null;
}

export function createAvatarService(db: Db, cfg: Config, media: MediaService) {
  // ── Automated moderation seam (Option A gate) ──────────────────────────────────────────────────────────
  // v1: the hardened validation already ran in media.upload; this returns allowed:true so the avatar goes
  // live. The paid classifier plugs in HERE (return { allowed:false, labels:[...] } to defer to 'pending')
  // without touching any caller. Kept async so a network classifier drops in cleanly.
  async function moderateImage(_mediaId: string): Promise<{ allowed: boolean; labels: string[] }> {
    return { allowed: true, labels: [] };
  }

  async function loadAvatar(userId: string) {
    return (await db.query(
      `SELECT u.id, u.avatar_media_id, u.avatar_status, u.avatar_updated_at, am.url AS avatar_url
         FROM user_account u LEFT JOIN media_asset am ON am.id = u.avatar_media_id
        WHERE u.id = $1`, [userId])).rows[0] ?? null;
  }

  async function logAction(
    q: Db, e: { userId: string; mediaId: string | null; action: string; actorType: 'admin' | 'system' | 'customer'; actorId: string | null; reason?: string | null },
  ) {
    await q.query(
      `INSERT INTO avatar_moderation_action (user_id, media_id, action, actor_type, actor_id, reason)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [e.userId, e.mediaId, e.action, e.actorType, e.actorId, e.reason ?? null]);
  }

  // ── Upload my avatar (authed customer) ───────────────────────────────────────────────────────────────
  async function uploadAvatar(userId: string, bytes: Buffer, meta: { filename?: string | null; declaredType?: string | null }, actor: AvatarActor) {
    // Hardened validation happens inside media.upload against the sniffed (magic-byte) type — we pass the
    // stricter avatar allow-list + size + dimension caps so a mismatch is a clean 4xx before any R2 PUT.
    const { asset } = await media.upload(
      { bytes, filename: meta.filename ?? null, declaredType: meta.declaredType ?? null, altText: `avatar:${userId}` },
      // uploaded_by must be null (it FKs staff_user; a consumer isn't staff). The user linkage is carried by
      // the avatar_moderation_action rows + the user.avatar_upload audit entry below.
      { id: null, ip: actor.ip },
      { maxBytes: AVATAR_MAX_BYTES, maxDimension: AVATAR_MAX_DIMENSION, allowedTypes: AVATAR_ALLOWED_TYPES },
    );

    // TRI-1185 gate. Option B (default, AVATAR_APPROVE_BEFORE_VISIBLE): a clean automated pass lands
    // 'pending' and enters the admin moderation queue — the avatar is NOT public until an admin approves;
    // a future classifier reject (seam returning allowed:false) auto-rejects. Option A (flag off) preserves
    // v1 exactly: clean ⇒ 'approved' (live immediately), classifier reject ⇒ 'pending'.
    const gate = await moderateImage(asset.id);
    const status = AVATAR_APPROVE_BEFORE_VISIBLE
      ? (gate.allowed ? 'pending' : 'rejected')
      : (gate.allowed ? 'approved' : 'pending');
    // Audit-trail row that matches the resulting status. Under Option A this collapses to the original
    // approve/auto_flag pair (byte-identical); Option B adds the "submitted for review" pending row.
    const logMeta: { action: 'approve' | 'reject' | 'auto_flag'; reason: string } =
      status === 'approved'
        ? { action: 'approve', reason: 'auto-approved (hardened validation passed)' }
        : status === 'rejected'
          ? { action: 'reject', reason: `auto-rejected: ${gate.labels.join(',')}` }
          : { action: 'auto_flag', reason: gate.allowed
              ? 'submitted for review — pending admin approval (approve-before-visible)'
              : `auto-flagged: ${gate.labels.join(',')}` };

    await db.tx(async (q) => {
      await q.query(
        `UPDATE user_account SET avatar_media_id = $2, avatar_status = $3, avatar_updated_at = now(), updated_at = now() WHERE id = $1`,
        [userId, asset.id, status]);
      await logAction(q, {
        userId, mediaId: asset.id,
        action: logMeta.action, actorType: 'system', actorId: null,
        reason: logMeta.reason,
      });
    });
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.avatar_upload', targetType: 'user_account', targetId: userId, after: { mediaId: asset.id, status }, ip: actor.ip });
    return { avatarUrl: avatarUrlFor(status, asset.url), avatarStatus: status };
  }

  // ── Clear my avatar back to the default (authed customer) ────────────────────────────────────────────
  async function deleteAvatar(userId: string, actor: AvatarActor) {
    const cur = await loadAvatar(userId);
    if (!cur) throw new AvatarError('not_found', 'account not found', 404);
    if (cur.avatar_media_id) {
      await db.tx(async (q) => {
        await q.query(
          `UPDATE user_account SET avatar_media_id = NULL, avatar_status = NULL, avatar_updated_at = now(), updated_at = now() WHERE id = $1`,
          [userId]);
        await logAction(q, { userId, mediaId: cur.avatar_media_id, action: 'remove', actorType: 'customer', actorId: userId, reason: 'cleared by owner' });
      });
      await audit(db, { actorType: 'user', actorId: userId, action: 'user.avatar_remove', targetType: 'user_account', targetId: userId, ip: actor.ip });
    }
    return { avatarUrl: null, avatarStatus: null };
  }

  // ── Report someone else's avatar (authed customer) ───────────────────────────────────────────────────
  // Option A auto-hide-on-report: the FIRST report on a visible avatar flips it to 'hidden' and enqueues it
  // for admin review. Rate-limited per reporter to prevent report-bombing.
  async function reportAvatar(reporterId: string, targetUserId: string, reason: string | null, actor: AvatarActor) {
    if (reporterId === targetUserId) throw new AvatarError('invalid_target', 'You cannot report your own avatar.', 400);
    const target = await loadAvatar(targetUserId);
    if (!target) throw new AvatarError('not_found', 'account not found', 404);
    if (!target.avatar_media_id) throw new AvatarError('no_avatar', 'That account has no avatar to report.', 404);

    // Rate-limit: cap reports per reporter within the window (across all targets).
    const recent = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM avatar_moderation_action
        WHERE action = 'report' AND actor_type = 'customer' AND actor_id = $1
          AND created_at > now() - ($2 * interval '1 second')`,
      [reporterId, REPORT_WINDOW_SECONDS])).rows[0].n);
    if (recent >= REPORT_MAX_PER_WINDOW) {
      throw new AvatarError('rate_limited', 'Too many reports. Please try again later.', 429);
    }

    const cleanReason = (reason ?? '').toString().trim().slice(0, 1000) || null;
    const alreadyHidden = target.avatar_status === 'hidden' || target.avatar_status === 'rejected';
    await db.tx(async (q) => {
      await logAction(q, { userId: targetUserId, mediaId: target.avatar_media_id, action: 'report', actorType: 'customer', actorId: reporterId, reason: cleanReason });
      // First report on a still-visible avatar auto-hides it and records the system auto_flag.
      if (!alreadyHidden) {
        await q.query(
          `UPDATE user_account SET avatar_status = 'hidden', avatar_updated_at = now(), updated_at = now() WHERE id = $1`,
          [targetUserId]);
        await logAction(q, { userId: targetUserId, mediaId: target.avatar_media_id, action: 'auto_flag', actorType: 'system', actorId: null, reason: 'auto-hidden on customer report' });
      }
    });
    await audit(db, { actorType: 'user', actorId: reporterId, action: 'user.avatar_report', targetType: 'user_account', targetId: targetUserId, after: { autoHidden: !alreadyHidden, reason: cleanReason }, ip: actor.ip });
    return { ok: true, hidden: !alreadyHidden };
  }

  // ── Admin: moderation queue ──────────────────────────────────────────────────────────────────────────
  // Lists avatars in the requested statuses (default the actionable ones: pending + hidden) with the owner,
  // the media, and the most-recent report reason so an admin can decide without extra round-trips.
  async function listQueue(opts: { status?: string } = {}) {
    const requested = (opts.status ?? 'pending,hidden')
      .split(',').map((s) => s.trim().toLowerCase())
      // 'flagged' is a UI synonym for 'hidden' (auto-flagged into the queue).
      .map((s) => (s === 'flagged' ? 'hidden' : s))
      .filter((s) => ['pending', 'hidden', 'rejected', 'approved'].includes(s));
    const statuses = requested.length ? [...new Set(requested)] : ['pending', 'hidden'];
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.name, u.email, u.avatar_status, u.avatar_updated_at,
              am.id AS media_id, am.url AS avatar_url, am.content_type, am.width, am.height, am.byte_size,
              (SELECT reason FROM avatar_moderation_action r
                WHERE r.user_id = u.id AND r.action = 'report' ORDER BY r.created_at DESC LIMIT 1) AS last_report_reason,
              (SELECT COUNT(*)::int FROM avatar_moderation_action r
                WHERE r.user_id = u.id AND r.action = 'report') AS report_count
         FROM user_account u JOIN media_asset am ON am.id = u.avatar_media_id
        WHERE u.avatar_status = ANY($1)
        ORDER BY u.avatar_updated_at DESC NULLS LAST`, [statuses]);
    return {
      items: rows.map((r) => ({
        userId: r.user_id, name: r.name ?? null, email: r.email,
        avatarStatus: r.avatar_status,
        avatarUrl: r.avatar_url, // admin always sees the actual image (even when hidden from the public)
        media: { id: r.media_id, contentType: r.content_type, width: r.width ?? null, height: r.height ?? null, byteSize: r.byte_size },
        lastReportReason: r.last_report_reason ?? null,
        reportCount: Number(r.report_count ?? 0),
        updatedAt: r.avatar_updated_at,
      })),
      statuses,
    };
  }

  // ── Admin: moderate an avatar (content.manage) ───────────────────────────────────────────────────────
  // approve → live again; reject → declined (hidden from /me + public); remove → hidden (queued/removed).
  async function moderate(targetUserId: string, action: 'approve' | 'reject' | 'remove', reason: string | null, actor: AvatarActor) {
    const target = await loadAvatar(targetUserId);
    if (!target) throw new AvatarError('not_found', 'account not found', 404);
    if (!target.avatar_media_id) throw new AvatarError('no_avatar', 'That account has no avatar to moderate.', 404);
    const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'hidden';
    const cleanReason = (reason ?? '').toString().trim().slice(0, 1000) || null;
    await db.tx(async (q) => {
      await q.query(
        `UPDATE user_account SET avatar_status = $2, avatar_updated_at = now(), updated_at = now() WHERE id = $1`,
        [targetUserId, nextStatus]);
      await logAction(q, { userId: targetUserId, mediaId: target.avatar_media_id, action, actorType: 'admin', actorId: actor.id, reason: cleanReason });
    });
    // Also write the shared admin audit-log entry (parity with every other admin write).
    await audit(db, { actorId: actor.id, action: `avatar.${action}`, targetType: 'user_account', targetId: targetUserId, before: { status: target.avatar_status }, after: { status: nextStatus, reason: cleanReason }, ip: actor.ip });
    return { userId: targetUserId, avatarStatus: nextStatus, avatarUrl: avatarUrlFor(nextStatus, target.avatar_url) };
  }

  return { moderateImage, uploadAvatar, deleteAvatar, reportAvatar, listQueue, moderate };
}

export type AvatarService = ReturnType<typeof createAvatarService>;
