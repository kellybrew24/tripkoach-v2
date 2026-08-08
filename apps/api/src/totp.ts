// TRI-895 P3 · RFC-6238 TOTP (time-based one-time password) — dependency-free, node:crypto only.
//
// Admin MFA uses an authenticator app (Google Authenticator / 1Password / Authy). The server stores a
// per-staff shared secret (base32) in mfa_factor.secret; the app derives the same 6-digit code from that
// secret + the current 30s time-step. We implement the standard here rather than pull an npm dependency,
// matching the codebase's zero-extra-dep posture (see email.ts / fx.ts). HMAC-SHA1 + 6 digits + 30s is
// the near-universal authenticator default and what the otpauth:// URI below advertises.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DIGITS = 6;
const PERIOD = 30;                 // seconds per time-step
const ALGO = 'sha1';
// RFC 4648 base32 alphabet (no padding on our secrets — authenticator apps accept unpadded).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Generate a new random base32 TOTP secret (default 20 bytes = 160 bits, per RFC 4226 §4). */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 secret (case-insensitive, ignores spaces/padding) → bytes. Throws on bad chars. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The HOTP/TOTP code for a given secret + counter (RFC 4226 dynamic truncation). */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // counter is < 2^53; write as a big-endian 64-bit value (high 32 bits then low 32 bits).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac(ALGO, secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** Current TOTP code for a base32 secret at time `now` (ms). Mainly for tests / provisioning previews. */
export function totp(secretB32: string, now: number = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(now / 1000 / PERIOD));
}

/**
 * Constant-time verify a submitted 6-digit code against a base32 secret, allowing ±`window` time-steps
 * (default ±1 = 30s of clock skew each way, the RFC-recommended tolerance). Non-numeric / wrong-length
 * input returns false without throwing.
 */
export function verifyTotp(secretB32: string, code: string, opts: { now?: number; window?: number } = {}): boolean {
  const now = opts.now ?? Date.now();
  const window = opts.window ?? 1;
  const cleaned = (code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  let secret: Buffer;
  try {
    secret = base32Decode(secretB32);
  } catch {
    return false;
  }
  const step = Math.floor(now / 1000 / PERIOD);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secret, step + i);
    // constant-time compare (both are fixed 6-char ASCII strings)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) return true;
  }
  return false;
}

/** otpauth:// provisioning URI the authenticator app scans (QR) or accepts as a manual link. */
export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: ALGO.toUpperCase(),
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
