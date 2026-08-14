// TRI-918 · Media service: validate an uploaded image → content-address it → publish to R2 → record it.
//
// The pipeline, in order:
//   1. VALIDATE   — sniff the real format from magic bytes (never trust the client's Content-Type or the
//                   filename extension), enforce the type allow-list + max size, best-effort parse the
//                   pixel dimensions.
//   2. ADDRESS    — key = <prefix>/<sha[0:2]>/<sha256>.<ext>. Deterministic from the bytes, so identical
//                   content re-uploaded returns the existing asset instead of a duplicate object.
//   3. PUBLISH    — PUT the bytes to the R2 bucket behind cdn.tripkoach.com with an immutable cache header
//                   (safe because the key is content-fingerprinted — new bytes ⇒ new key, never in-place).
//   4. RECORD     — insert a media_asset row (status 'ready') and return the canonical public URL.
//
// A row is written 'validating' first and flipped to 'ready'/'failed' around the R2 PUT so a publish error
// leaves an auditable failed row rather than a silent drop.

import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import type { Storage } from './storage.ts';
import { audit } from './auth.ts';

// uploaded_by FKs staff_user, so a non-staff uploader (a consumer uploading their own avatar, TRI-943)
// passes id:null — the media row carries no staff uploader; the user linkage lives in the caller's audit
// trail (avatar_moderation_action + audit_log actor_type='user').
export interface MediaActor { id: string | null; ip: string | null }

export class MediaError extends Error {
  code: string;
  httpStatus: number;
  field?: string;
  constructor(code: string, message: string, httpStatus = 400, field?: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}

interface Sniffed { contentType: string; ext: string; width: number | null; height: number | null }

// ── Format detection from magic bytes (the only trustworthy source of an upload's real type) ──────────
function sniffImage(buf: Buffer): Sniffed | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg', ...jpegDims(buf) };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 24 && buf.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') {
    // IHDR width/height are big-endian uint32 at offsets 16/20.
    return { contentType: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF87a" / "GIF89a"; logical-screen width/height are little-endian uint16 at 6/8.
  if (buf.length >= 10 && (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a')) {
    return { contentType: 'image/gif', ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP: "RIFF"...."WEBP"
  if (buf.length >= 16 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', ext: 'webp', ...webpDims(buf) };
  }
  return null;
}

// JPEG: walk the marker segments to the first Start-Of-Frame (SOFn) and read its 16-bit height/width.
function jpegDims(buf: Buffer): { width: number | null; height: number | null } {
  let off = 2; // skip SOI (FF D8)
  const n = buf.length;
  while (off + 9 < n) {
    if (buf[off] !== 0xff) { off++; continue; }
    let marker = buf[off + 1];
    while (marker === 0xff && off + 1 < n) { off++; marker = buf[off + 1]; } // skip fill bytes
    off += 2;
    // Standalone markers (RSTn, SOI, EOI, TEM) carry no length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (off + 2 > n) break;
    const segLen = buf.readUInt16BE(off);
    // SOF0..SOF15 except DHT(C4)/JPG(C8)/DAC(CC) are frame headers: [len][precision][height][width]...
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF && off + 7 <= n) {
      return { height: buf.readUInt16BE(off + 3), width: buf.readUInt16BE(off + 5) };
    }
    off += segLen; // advance past this segment's payload
  }
  return { width: null, height: null };
}

// WebP: three chunk layouts — VP8X (extended, 24-bit dims-1), VP8L (lossless, 14-bit packed), VP8 (lossy).
function webpDims(buf: Buffer): { width: number | null; height: number | null } {
  const fourcc = buf.toString('latin1', 12, 16);
  try {
    if (fourcc === 'VP8X' && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    if (fourcc === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      // Lossy: 3-byte start code 9d 01 2a precedes 14-bit width/height (little-endian).
      if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
    }
  } catch { /* fall through to unknown */ }
  return { width: null, height: null };
}

// ── TRI-1124 (#9) · Metadata stripping (EXIF / GPS / XMP / IPTC / comments) ───────────────────────────
// Dependency-free rebuilders that copy only the pixel + essential structural bytes, dropping every metadata
// carrier. Best-effort: on any structural surprise we return the ORIGINAL buffer (never corrupt an image
// that already passed magic-byte + size + dimension validation). The dominant GPS-leak vector is JPEG EXIF
// from phone cameras; PNG text chunks and WebP EXIF/XMP are covered too. GIF carries no GPS metadata.

/** JPEG: walk marker segments from SOI, drop APP1..APP15 (EXIF/XMP/IPTC/ICC) + COM, copy the rest verbatim.
 *  Everything from the first SOS marker onward is entropy-coded scan data and is copied unchanged. */
function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) return buf;                 // desync → bail, keep original
    let marker = buf[i + 1];
    while (marker === 0xff && i + 1 < buf.length) { i++; marker = buf[i + 1]; } // skip fill bytes
    if (marker === 0xd9) { out.push(buf.subarray(i)); break; }      // EOI
    if (marker === 0xda) { out.push(buf.subarray(i)); break; }      // SOS → rest is scan data, copy all
    if (i + 3 >= buf.length) return buf;
    const len = buf.readUInt16BE(i + 2);             // segment length includes the 2 length bytes
    const segEnd = i + 2 + len;
    if (len < 2 || segEnd > buf.length) return buf;  // malformed length → bail
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe; // APP1..APP15 + COM(0xFE)
    if (!drop) out.push(buf.subarray(i, segEnd));
    i = segEnd;
  }
  return Buffer.concat(out);
}

/** PNG: keep critical + colour-safe ancillary chunks; drop metadata chunks (eXIf, tEXt, zTXt, iTXt). */
function stripPng(buf: Buffer): Buffer {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return buf;
  const DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const chunkEnd = i + 12 + len;                   // 4 len + 4 type + data + 4 crc
    if (len > buf.length || chunkEnd > buf.length) return buf; // malformed → bail
    if (!DROP.has(type)) out.push(buf.subarray(i, chunkEnd));
    i = chunkEnd;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

/** WebP (RIFF): drop 'EXIF' and 'XMP ' chunks, clear their VP8X presence flags, fix the RIFF size. */
function stripWebp(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return buf;
  const head = Buffer.from(buf.subarray(0, 12));     // RIFF + size + WEBP
  const chunks: Buffer[] = [];
  let i = 12;
  let dropped = false;
  while (i + 8 <= buf.length) {
    const fourcc = buf.toString('latin1', i, i + 4);
    const size = buf.readUInt32LE(i + 4);            // RIFF chunk sizes are little-endian
    const padded = size + (size & 1);                // chunks are 2-byte aligned
    const end = i + 8 + padded;
    if (end > buf.length) return buf;                // malformed → bail
    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      dropped = true;
    } else {
      const chunk = Buffer.from(buf.subarray(i, end));
      if (fourcc === 'VP8X') { chunk[8] = chunk[8] & ~0x0c; } // clear EXIF(bit3)+XMP(bit2) flags in the feature byte
      chunks.push(chunk);
    }
    i = end;
  }
  if (!dropped) return buf;                          // nothing to strip → keep original bytes as-is
  const body = Buffer.concat(chunks);
  head.writeUInt32LE(body.length + 4, 4);            // RIFF payload size = 'WEBP' + chunks
  return Buffer.concat([head, body]);
}

/** Route to the format-specific stripper; unknown/GIF pass through unchanged. */
function stripMetadata(buf: Buffer, contentType: string): Buffer {
  try {
    if (contentType === 'image/jpeg') return stripJpeg(buf);
    if (contentType === 'image/png') return stripPng(buf);
    if (contentType === 'image/webp') return stripWebp(buf);
  } catch { /* any surprise → fall back to the validated original */ }
  return buf;
}

function rowToAsset(r: any) {
  return {
    id: r.id,
    url: r.url,
    storageKey: r.storage_key,
    sha256: r.sha256,
    contentType: r.content_type,
    ext: r.ext,
    byteSize: r.byte_size,
    width: r.width ?? null,
    height: r.height ?? null,
    filename: r.original_filename ?? null,
    altText: r.alt_text ?? null,
    status: r.status,
    uploadedBy: r.uploaded_by ?? null,
    createdAt: r.created_at,
  };
}

export interface UploadInput {
  bytes: Buffer;
  filename?: string | null;
  altText?: string | null;
  /** The client-declared Content-Type — recorded as a hint only; the sniffed type is authoritative. */
  declaredType?: string | null;
}

// Per-call validation overrides. When omitted the media config defaults apply (admin library uploads use
// none). The avatar path (TRI-943) passes a stricter allow-list + a smaller size cap + a dimension cap so
// the SAME magic-byte-authoritative pipeline enforces them — validation stays inside the sniffer, never in
// a caller that could be bypassed. All caps are checked BEFORE the R2 PUT so a rejection wastes no upload.
export interface UploadLimits {
  /** Override the max byte size (defaults to cfg.media.maxBytes). */
  maxBytes?: number;
  /** Reject when the sniffed width OR height exceeds this many pixels. */
  maxDimension?: number;
  /** Override the allowed (sniffed) MIME types (defaults to cfg.media.allowedTypes). */
  allowedTypes?: readonly string[];
}

export function createMediaService(db: Db, cfg: Config, storage: Storage) {
  const m = cfg.media;

  async function getById(id: string) {
    const r = (await db.query(`SELECT * FROM media_asset WHERE id = $1`, [id])).rows[0];
    return r ? rowToAsset(r) : null;
  }

  async function list(opts: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const { rows } = await db.query(
      `SELECT * FROM media_asset WHERE status = 'ready' ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]);
    const total = Number((await db.query(`SELECT COUNT(*)::int AS n FROM media_asset WHERE status = 'ready'`)).rows[0].n);
    return { assets: rows.map(rowToAsset), total, limit, offset };
  }

  async function upload(input: UploadInput, actor: MediaActor, limits: UploadLimits = {}) {
    if (!storage.enabled) {
      throw new MediaError('storage_unconfigured', 'Image storage is not configured on this environment.', 503);
    }
    const maxBytes = limits.maxBytes != null ? Math.min(limits.maxBytes, m.maxBytes) : m.maxBytes;
    const allowedTypes = limits.allowedTypes ?? m.allowedTypes;
    const buf = input.bytes;
    if (!buf || buf.length === 0) throw new MediaError('empty', 'No image bytes were uploaded.', 400, 'file');
    if (buf.length > maxBytes) {
      throw new MediaError('too_large', `Image exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit.`, 413, 'file');
    }
    const sniff = sniffImage(buf);
    if (!sniff) {
      throw new MediaError('unsupported_type', 'File is not a recognised image (JPEG, PNG, WebP, or GIF).', 415, 'file');
    }
    if (!allowedTypes.includes(sniff.contentType)) {
      throw new MediaError('unsupported_type', `Images of type ${sniff.contentType} are not allowed.`, 415, 'file');
    }
    // Dimension cap (decompression-bomb guard): the avatar path passes a tight cap; every other upload
    // falls back to the general media ceiling (cfg.media.maxDimension, TRI-1124 #9) so NO path is uncapped.
    // Enforced from the header-sniffed dims BEFORE any decode, so a tiny file claiming huge dims is rejected
    // without allocating the pixel buffer. A valid image whose dims the sniffer couldn't read still passes.
    const maxDimension = limits.maxDimension ?? m.maxDimension;
    if (maxDimension != null && sniff.width != null && sniff.height != null &&
        (sniff.width > maxDimension || sniff.height > maxDimension)) {
      throw new MediaError('dimensions_too_large',
        `Image dimensions (${sniff.width}×${sniff.height}) exceed the ${maxDimension}×${maxDimension} limit.`, 400, 'file');
    }

    // TRI-1124 (#9): strip EXIF/GPS/XMP/IPTC metadata BEFORE the image is content-addressed and published.
    // Phone photos (avatars especially) carry GPS coordinates + device serials in EXIF; publishing them to a
    // public CDN would leak PII. We rebuild the file keeping only pixel data + essential structural chunks.
    // Done pre-hash so the stored object AND its content-addressed key reflect the sanitised bytes.
    const clean = stripMetadata(buf, sniff.contentType);

    const sha = createHash('sha256').update(clean).digest('hex');
    const storageKey = `${m.keyPrefix}/${sha.slice(0, 2)}/${sha}.${sniff.ext}`;
    const url = `${m.publicBase}/${storageKey}`;

    // Dedupe: identical content already published → return it (idempotent re-upload, no wasted PUT).
    const existing = (await db.query(
      `SELECT * FROM media_asset WHERE storage_key = $1 AND status = 'ready'`, [storageKey])).rows[0];
    if (existing) return { asset: rowToAsset(existing), deduped: true };

    const filename = (input.filename ?? '').toString().slice(0, 300) || null;
    const altText = (input.altText ?? '').toString().slice(0, 1000) || null;

    // Record the attempt first (auditable), then publish, then flip to ready.
    const { rows } = await db.query(
      `INSERT INTO media_asset
         (storage_key, url, sha256, content_type, ext, byte_size, width, height, original_filename, alt_text, status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'validating',$11)
       ON CONFLICT (storage_key) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [storageKey, url, sha, sniff.contentType, sniff.ext, clean.length, sniff.width, sniff.height, filename, altText, actor.id]);
    const id = rows[0].id;

    try {
      await storage.put(storageKey, clean, { contentType: sniff.contentType, cacheControl: m.cacheControl });
    } catch (e) {
      await db.query(`UPDATE media_asset SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
        [id, String((e as Error).message).slice(0, 500)]);
      await audit(db, { actorId: actor.id, action: 'media.publish_failed', targetType: 'media_asset', targetId: id, after: { storageKey }, ip: actor.ip });
      throw new MediaError('publish_failed', 'Could not publish the image to the CDN. Please retry.', 502);
    }

    const finalRow = (await db.query(
      `UPDATE media_asset SET status='ready', error=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [id])).rows[0];
    await audit(db, {
      actorId: actor.id, action: 'media.upload', targetType: 'media_asset', targetId: id,
      after: { url, contentType: sniff.contentType, byteSize: clean.length, width: sniff.width, height: sniff.height }, ip: actor.ip,
    });
    return { asset: rowToAsset(finalRow), deduped: false };
  }

  return { upload, list, getById };
}

export type MediaService = ReturnType<typeof createMediaService>;
// Exposed for unit testing the sniffer + metadata strippers without a DB/storage.
export const __test = { sniffImage, stripMetadata };
