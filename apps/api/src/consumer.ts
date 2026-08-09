// TRI-881 P1 · Consumer account service. All data logic for the customer-facing account spine lives here;
// the route layer (consumer-routes.ts) parses/serialises and owns the session cookie. Mirrors the admin
// service's shape (tiny fail-fast validators, typed errors, audit rows) but on user_account.
//
// Covers audit gaps: C8 (signup), C10 (password reset), C13 (profile/preferences), C17 (notification
// prefs), C14 (link guest bookings → authed "my bookings"). Reuses the shared argon2id hashing (auth.ts)
// and the shared email transport (email.ts, TRI-880) for the reset email.

import { randomBytes, createHash } from 'node:crypto';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { hashPassword, verifyPassword, audit } from './auth.ts';
import { revokeAllUserSessions } from './consumer-auth.ts';
import { sendEmail, type SendOptions } from './email.ts';
import { avatarUrlFor } from './avatar.ts';
import { fromMinor } from './util.ts';

// ── Errors (mapped to the shared {error:{code,message}} envelope by the route layer) ──
export class ConsumerError extends Error {
  code: string;
  httpStatus: number;
  field?: string;
  constructor(code: string, message: string, httpStatus = 400, field?: string) {
    super(message);
    this.name = 'ConsumerError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.field = field;
  }
}
const validation = (message: string, field?: string) => new ConsumerError('validation', message, 400, field);
const conflict = (message: string) => new ConsumerError('conflict', message, 409);
const notFound = (what: string) => new ConsumerError('not_found', `${what} not found`, 404);

// ── Tiny validators ──────────────────────────────────────────────────────────
type Body = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normEmail(v: unknown): string {
  if (typeof v !== 'string' || !EMAIL_RE.test(v.trim())) throw validation('a valid email is required', 'email');
  return v.trim().toLowerCase();
}
function checkPassword(v: unknown): string {
  if (typeof v !== 'string' || v.length < 8) throw validation('password must be at least 8 characters', 'password');
  if (v.length > 200) throw validation('password is too long', 'password');
  return v;
}
function optStr(b: Body, field: string, max = 2000): string | undefined {
  const v = b[field];
  if (v == null) return undefined;
  if (typeof v !== 'string') throw validation(`"${field}" must be a string`, field);
  const t = v.trim();
  if (t.length > max) throw validation(`"${field}" is too long`, field);
  return t;
}
function optBool(b: Body, field: string): boolean | undefined {
  const v = b[field];
  if (v == null) return undefined;
  if (typeof v !== 'boolean') throw validation(`"${field}" must be a boolean`, field);
  return v;
}
const firstNameOf = (name: string | null, email: string) =>
  (name && name.trim().split(/\s+/)[0]) || email.split('@')[0];

// ── Notification preferences vocabulary (must match the CHECKs in 004_people.sql) ──
export const NOTIF_CHANNELS = ['email', 'whatsapp'] as const;
export const NOTIF_TYPES = [
  'booking_confirmations', 'payment_reminders', 'departure_reminders',
  'review_reminders', 'marketing_offers', 'urgent_updates', 'koach_messages',
] as const;
export type NotifChannel = (typeof NOTIF_CHANNELS)[number];
export type NotifType = (typeof NOTIF_TYPES)[number];
// Sensible signup defaults: everything on except marketing (opt-in only).
const NOTIF_DEFAULT = (type: NotifType): boolean => type !== 'marketing_offers';

export function createConsumerService(db: Db, cfg: Config) {
  // ── Profile DTO ────────────────────────────────────────────────────────────
  function profileDTO(u: any) {
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      phone: u.phone ?? null,
      country: u.country ?? null,
      photoUrl: u.photo_url ?? null,
      emergencyName: u.emergency_name ?? null,
      emergencyPhone: u.emergency_phone ?? null,
      dietaryNeeds: u.dietary_needs ?? null,
      language: u.language,
      displayCurrency: u.display_currency,
      dataSaver: u.data_saver,
      twoFactorEnabled: u.two_factor_enabled,
      emailVerified: !!u.email_verified_at,       // TRI-941: soft email-verification signal (never a gate)
      emailVerifiedAt: u.email_verified_at ?? null,
      // TRI-943: avatar. avatarUrl is null when rejected/hidden (FE renders the default placeholder).
      avatarStatus: u.avatar_status ?? null,
      avatarUrl: avatarUrlFor(u.avatar_status, u.avatar_url),
      createdAt: u.created_at,
    };
  }

  async function loadUser(userId: string): Promise<any | null> {
    // LEFT JOIN the avatar's media_asset so the profile DTO can surface its CDN url (TRI-943).
    return (await db.query(
      `SELECT u.*, am.url AS avatar_url
         FROM user_account u LEFT JOIN media_asset am ON am.id = u.avatar_media_id
        WHERE u.id = $1`, [userId])).rows[0] ?? null;
  }

  async function getProfile(userId: string) {
    const u = await loadUser(userId);
    if (!u) throw notFound('account');
    return profileDTO(u);
  }

  // ── Seed default notification prefs for a new account (idempotent) ──
  async function seedNotificationPrefs(q: Db, userId: string) {
    for (const channel of NOTIF_CHANNELS) {
      for (const type of NOTIF_TYPES) {
        await q.query(
          `INSERT INTO notification_preference (user_id, channel, type, enabled)
           VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, channel, type) DO NOTHING`,
          [userId, channel, type, NOTIF_DEFAULT(type)]);
      }
    }
  }

  // ── Link guest bookings/customers to a freshly-signed-in account by contact email ──
  // A guest who booked with email X, then creates/uses an account with email X, gets those bookings
  // attached. Matches on the lead traveller's email OR the ops customer row's email. Idempotent.
  async function linkGuestBookings(q: Db, userId: string, email: string): Promise<number> {
    await q.query(
      `UPDATE customer SET user_id = $1, updated_at = now()
        WHERE user_id IS NULL AND lower(email) = lower($2)`, [userId, email]);
    const r = await q.query(
      `UPDATE booking b SET user_id = $1, updated_at = now()
        WHERE b.user_id IS NULL
          AND ( EXISTS (SELECT 1 FROM booking_traveller bt
                         WHERE bt.booking_id = b.id AND bt.is_lead AND lower(bt.email) = lower($2))
             OR EXISTS (SELECT 1 FROM customer c
                         WHERE c.id = b.customer_id AND lower(c.email) = lower($2)) )`,
      [userId, email]);
    return r.rowCount ?? 0;
  }

  // ── Email verification — issue a token + send the "verify your email" email (TRI-941) ──────────────
  // Mirrors the password-reset issuance: opaque token, store ONLY its sha256, email an absolute link.
  // Reused by signup (enforceRateLimit=false) and resend (enforceRateLimit=true). Never throws for a
  // transport failure — the token is persisted and the failure is visible in the send-log. Returns a
  // small status so the resend endpoint can report throttling without leaking account state.
  async function issueVerificationEmail(
    user: { id: string; email: string; name: string | null },
    meta: { ip?: string | null } = {},
    opts: { enforceRateLimit?: boolean } = {},
    sendOpts?: SendOptions,
  ): Promise<{ sent: boolean; throttled: boolean; alreadyVerified: boolean }> {
    // Already verified → nothing to do (idempotent no-op).
    const fresh = (await db.query(`SELECT email_verified_at FROM user_account WHERE id = $1`, [user.id])).rows[0];
    if (fresh?.email_verified_at) return { sent: false, throttled: false, alreadyVerified: true };

    // Resend rate-limit: if a token was issued for this account within the window, don't issue another.
    if (opts.enforceRateLimit) {
      const recent = await db.query(
        `SELECT 1 FROM email_verification_token
          WHERE user_id = $1 AND created_at > now() - ($2 * interval '1 second') LIMIT 1`,
        [user.id, cfg.consumer.verifyResendMinSeconds]);
      if (recent.rows.length) return { sent: false, throttled: true, alreadyVerified: false };
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { rows } = await db.query(
      `INSERT INTO email_verification_token (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, now() + ($3 * interval '1 minute'), $4) RETURNING id`,
      [user.id, tokenHash, cfg.consumer.verifyTokenTtlMinutes, meta.ip ?? null]);
    const tokenId = rows[0].id;

    const verifyUrl = `${cfg.consumer.appBaseUrl}/verify-email?token=${token}`;
    // Track the real dispatch outcome. sendEmail never throws for a transport failure — it returns a
    // 'failed'/'skipped' status — so we must inspect the result rather than assume success. Reporting
    // `sent: true` unconditionally is exactly what made a failed resend look "sent" to the board (TRI-941).
    // Only a 'failed' status is a real dispatch failure. 'skipped' means the transport is intentionally
    // disabled (dev/unconfigured) — not a user-facing error — so it counts as dispatched. A thrown error
    // (should not happen; sendEmail swallows transport faults) also counts as not dispatched.
    let dispatched = false;
    try {
      const res = await sendEmail(db, cfg, {
        to: user.email,
        template: 'verify_email',
        vars: {
          firstName: firstNameOf(user.name, user.email),
          verifyUrl,
          ttlHours: Math.round(cfg.consumer.verifyTokenTtlMinutes / 60),
        },
        relatedType: 'email_verification',
        relatedId: tokenId,
      }, sendOpts);
      dispatched = res.status !== 'failed';
      if (res.status === 'failed') {
        console.error(`[consumer] verification email dispatch FAILED for token ${tokenId}: ${res.error ?? ''}`);
      }
    } catch (e) {
      console.error(`[consumer] verification email dispatch error for token ${tokenId}: ${(e as Error).message}`);
    }
    await audit(db, { actorType: 'user', actorId: user.id, action: 'user.verification_email_sent', targetType: 'user_account', targetId: user.id, after: { tokenId, dispatched }, ip: meta.ip ?? null });
    return { sent: dispatched, throttled: false, alreadyVerified: false };
  }

  // ── Signup ─────────────────────────────────────────────────────────────────
  async function signup(rawBody: unknown, meta: { ip?: string | null } = {}) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const email = normEmail(rawBody.email);
    const password = checkPassword(rawBody.password);
    const name = optStr(rawBody, 'name', 200) ?? null;
    const phone = optStr(rawBody, 'phone', 60) ?? null;
    const country = optStr(rawBody, 'country', 120) ?? null;
    if (rawBody.agreedTerms !== undefined && rawBody.agreedTerms !== true) {
      throw validation('Terms must be agreed to create an account', 'agreedTerms');
    }

    const exists = await db.query(`SELECT 1 FROM user_account WHERE lower(email) = $1`, [email]);
    if (exists.rows.length) throw conflict('An account with that email already exists.');

    const passwordHash = await hashPassword(password);
    const result = await db.tx(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO user_account (email, password_hash, name, phone, country)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [email, passwordHash, name, phone, country]);
      const u = rows[0];
      await seedNotificationPrefs(q, u.id);
      const linked = await linkGuestBookings(q, u.id, email);
      return { u, linked };
    });
    await audit(db, { actorType: 'user', actorId: result.u.id, action: 'user.signup', targetType: 'user_account', targetId: result.u.id, after: { email, linkedBookings: result.linked }, ip: meta.ip ?? null });
    // TRI-941: fire the "verify your email" email after the account is committed. Best-effort — a send
    // failure never fails signup (issueVerificationEmail swallows transport errors).
    await issueVerificationEmail({ id: result.u.id, email: result.u.email, name: result.u.name ?? null }, meta);
    return { user: profileDTO(result.u), linkedBookings: result.linked };
  }

  // ── Login (verify only — the route mints the session). Also links any new guest bookings. ──
  async function verifyLogin(rawBody: unknown, meta: { ip?: string | null } = {}) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const email = typeof rawBody.email === 'string' ? rawBody.email.trim().toLowerCase() : '';
    const password = typeof rawBody.password === 'string' ? rawBody.password : '';
    if (!email || !password) throw validation('email and password are required');

    const u = (await db.query(`SELECT * FROM user_account WHERE lower(email) = $1 AND deleted_at IS NULL`, [email])).rows[0];
    const ok = u && u.password_hash && (await verifyPassword(password, u.password_hash));
    if (!ok) {
      await audit(db, { actorType: 'user', actorId: u?.id ?? null, action: 'user.login_failed', targetType: 'user_account', targetId: u?.id ?? null, after: { email }, ip: meta.ip ?? null });
      throw new ConsumerError('invalid_credentials', 'That email and password do not match.', 401);
    }
    const linked = await linkGuestBookings(db, u.id, u.email);
    await audit(db, { actorType: 'user', actorId: u.id, action: 'user.login', targetType: 'user_account', targetId: u.id, after: linked ? { linkedBookings: linked } : undefined, ip: meta.ip ?? null });
    return { user: profileDTO(u), linkedBookings: linked };
  }

  // ── Profile update ─────────────────────────────────────────────────────────
  async function updateProfile(userId: string, rawBody: unknown, meta: { ip?: string | null } = {}) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const cur = await loadUser(userId);
    if (!cur) throw notFound('account');

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (rawBody.email !== undefined) {
      const email = normEmail(rawBody.email);
      if (email !== cur.email.toLowerCase()) {
        const dup = await db.query(`SELECT 1 FROM user_account WHERE lower(email) = $1 AND id <> $2`, [email, userId]);
        if (dup.rows.length) throw conflict('That email is already in use.');
        set('email', email);
      }
    }
    const strFields: Array<[string, string, number]> = [
      ['name', 'name', 200], ['phone', 'phone', 60], ['country', 'country', 120],
      ['photoUrl', 'photo_url', 2000], ['emergencyName', 'emergency_name', 200],
      ['emergencyPhone', 'emergency_phone', 60], ['dietaryNeeds', 'dietary_needs', 2000],
      ['language', 'language', 12], ['displayCurrency', 'display_currency', 3],
    ];
    for (const [key, col, max] of strFields) {
      if (rawBody[key] !== undefined) {
        const v = optStr(rawBody, key, max);
        set(col, key === 'displayCurrency' && v ? v.toUpperCase() : (v ?? null));
      }
    }
    const dataSaver = optBool(rawBody, 'dataSaver');
    if (dataSaver !== undefined) set('data_saver', dataSaver);

    if (!sets.length) return profileDTO(cur);
    params.push(userId);
    const { rows } = await db.query(
      `UPDATE user_account SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`, params);
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.profile_update', targetType: 'user_account', targetId: userId, after: { fields: sets.map((s) => s.split(' = ')[0]) }, ip: meta.ip ?? null });
    return profileDTO(rows[0]);
  }

  // ── Change password (authed; requires current password) ──
  async function changePassword(userId: string, rawBody: unknown, meta: { ip?: string | null } = {}) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const cur = await loadUser(userId);
    if (!cur) throw notFound('account');
    const current = typeof rawBody.currentPassword === 'string' ? rawBody.currentPassword : '';
    if (!(await verifyPassword(current, cur.password_hash))) {
      throw new ConsumerError('invalid_credentials', 'Your current password is incorrect.', 401, 'currentPassword');
    }
    const next = checkPassword(rawBody.newPassword);
    await db.query(`UPDATE user_account SET password_hash = $2, updated_at = now() WHERE id = $1`, [userId, await hashPassword(next)]);
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.password_change', targetType: 'user_account', targetId: userId, ip: meta.ip ?? null });
    return { ok: true };
  }

  // ── Delete my account (TRI-1012) ──
  // Soft-delete + anonymize. We keep the user_account row (booking / customer / audit FKs point at it
  // via ON DELETE SET NULL and hard-deleting would orphan that history), stamp deleted_at, scrub every
  // PII column, rewrite the email to a unique unusable tombstone (so the real address frees up for a
  // fresh signup), drop notification prefs, anonymize the ops-side customer mirror, and revoke every
  // live session. resolveUserSession() gates on deleted_at, so the account can never authenticate again.
  //
  // Refuses while the caller has active (reserved/pending/confirmed) bookings — the UI promises
  // "Active bookings must be cancelled first" so refunds can be processed before the record is scrubbed.
  async function deleteAccount(userId: string, meta: { ip?: string | null } = {}) {
    const cur = await loadUser(userId);
    if (!cur) throw notFound('account');
    if (cur.deleted_at) return { ok: true, sessionsRevoked: 0, alreadyDeleted: true }; // idempotent

    const active = await db.query(
      `SELECT count(*)::int AS n FROM booking
        WHERE user_id = $1 AND status IN ('reserved','pending','confirmed')`, [userId]);
    if ((active.rows[0]?.n ?? 0) > 0) {
      throw new ConsumerError('active_bookings',
        'Cancel your upcoming bookings before deleting your account so we can process any refunds.', 409);
    }

    await db.tx(async (q) => {
      await q.query(
        `UPDATE user_account SET
           email = 'deleted+' || id::text || '@deleted.tripkoach.invalid',
           password_hash = NULL, name = NULL, phone = NULL, country = NULL,
           photo_url = NULL, emergency_name = NULL, emergency_phone = NULL, dietary_needs = NULL,
           avatar_media_id = NULL, avatar_status = NULL, avatar_updated_at = NULL,
           two_factor_enabled = false, email_verified_at = NULL,
           deleted_at = now(), updated_at = now()
         WHERE id = $1`, [userId]);
      // Notification prefs hold no PII but are meaningless post-deletion — clear them.
      await q.query(`DELETE FROM notification_preference WHERE user_id = $1`, [userId]);
      // Anonymize the ops-side customer mirror (kept so booking history still resolves a name).
      await q.query(
        `UPDATE customer SET name = 'Deleted user', email = NULL, phone = NULL, updated_at = now()
          WHERE user_id = $1`, [userId]);
    });

    const sessionsRevoked = await revokeAllUserSessions(db, userId);
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.account_deleted', targetType: 'user_account', targetId: userId, after: { sessionsRevoked }, ip: meta.ip ?? null });
    return { ok: true, sessionsRevoked };
  }

  // ── Notification preferences (read/write) ──
  async function getNotificationPrefs(userId: string) {
    const { rows } = await db.query(
      `SELECT channel, type, enabled FROM notification_preference WHERE user_id = $1`, [userId]);
    // Build a complete { channel: { type: bool } } map, defaulting any missing row.
    const out: Record<string, Record<string, boolean>> = {};
    for (const channel of NOTIF_CHANNELS) {
      out[channel] = {};
      for (const type of NOTIF_TYPES) out[channel][type] = NOTIF_DEFAULT(type);
    }
    for (const r of rows) {
      if (out[r.channel] && r.type in out[r.channel]) out[r.channel][r.type] = r.enabled;
    }
    return out;
  }

  async function updateNotificationPrefs(userId: string, rawBody: unknown, meta: { ip?: string | null } = {}) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const u = await loadUser(userId);
    if (!u) throw notFound('account');
    const updates: Array<{ channel: NotifChannel; type: NotifType; enabled: boolean }> = [];
    for (const channel of NOTIF_CHANNELS) {
      const group = rawBody[channel];
      if (group == null) continue;
      if (!isPlainObject(group)) throw validation(`"${channel}" must be an object of type→boolean`, channel);
      for (const [type, enabled] of Object.entries(group)) {
        if (!(NOTIF_TYPES as readonly string[]).includes(type)) throw validation(`unknown notification type "${type}"`, channel);
        if (typeof enabled !== 'boolean') throw validation(`"${channel}.${type}" must be a boolean`, channel);
        updates.push({ channel: channel as NotifChannel, type: type as NotifType, enabled });
      }
    }
    if (!updates.length) throw validation('no notification preferences provided');
    await db.tx(async (q) => {
      for (const u2 of updates) {
        await q.query(
          `INSERT INTO notification_preference (user_id, channel, type, enabled)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, channel, type) DO UPDATE SET enabled = EXCLUDED.enabled`,
          [userId, u2.channel, u2.type, u2.enabled]);
      }
    });
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.notifications_update', targetType: 'user_account', targetId: userId, after: { changed: updates.length }, ip: meta.ip ?? null });
    return getNotificationPrefs(userId);
  }

  // ── "My bookings" (authed) ──────────────────────────────────────────────────
  async function listMyBookings(userId: string) {
    // Reviews are invite-token only (TRI-892): an invite is minted per eligible booking when the
    // departure is ended, and the verified review is submitted against that one-time token. Surface
    // the owner's own invite state here so the Bookings "Leave a review" CTA can submit the REAL
    // review (open) / say it's already in (submitted) / explain the emailed link is pending (none) —
    // instead of collecting a rating and silently discarding it (TRI-1014).
    const { rows } = await db.query(
      `SELECT b.ref, b.status, b.payment_state, b.party_size, b.total_minor, b.currency,
              b.reservation_expires_at, b.created_at,
              t.slug AS tour_slug, t.title AS tour_title,
              d.id AS departure_id, d.date_label, d.time_label,
              ri.token AS review_token, ri.redeemed_at AS review_redeemed_at
         FROM booking b
         JOIN tour t ON t.id = b.tour_id
         JOIN departure d ON d.id = b.departure_id
         LEFT JOIN review_invite ri ON ri.booking_id = b.id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC`, [userId]);
    return rows.map((b) => ({
      ref: b.ref,
      status: b.status,
      paymentState: b.payment_state,
      total: fromMinor(Number(b.total_minor)),
      currency: b.currency,
      partySize: Number(b.party_size),
      reservationExpiresAt: b.reservation_expires_at ? new Date(b.reservation_expires_at).toISOString() : null,
      createdAt: b.created_at,
      tour: { slug: b.tour_slug, title: b.tour_title },
      departure: { id: b.departure_id, date: b.date_label, time: b.time_label ?? '' },
      // `open` carries the live one-time token so the owner can submit; `submitted` never leaks it.
      review: !b.review_token
        ? { state: 'none' as const }
        : b.review_redeemed_at
          ? { state: 'submitted' as const }
          : { state: 'open' as const, token: b.review_token },
    }));
  }

  // ── Password reset — request (always 200, no user enumeration) ──
  // Generates an opaque token, stores ONLY its sha256, emails the reset link. If the email is unknown we
  // still return ok and send nothing (so callers can't probe which emails have accounts).
  async function requestPasswordReset(rawBody: unknown, meta: { ip?: string | null } = {}, sendOpts?: SendOptions) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const email = normEmail(rawBody.email);
    const u = (await db.query(`SELECT id, email, name FROM user_account WHERE lower(email) = $1`, [email])).rows[0];
    if (!u) return { ok: true }; // silent no-op for unknown emails

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { rows } = await db.query(
      `INSERT INTO password_reset_token (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, now() + ($3 * interval '1 minute'), $4) RETURNING id`,
      [u.id, tokenHash, cfg.consumer.resetTokenTtlMinutes, meta.ip ?? null]);
    const tokenId = rows[0].id;

    const resetUrl = `${cfg.consumer.appBaseUrl}/reset-password?token=${token}`;
    // Dispatch the reset email. sendEmail records its own send-log row and never throws for a dispatch
    // failure (records 'failed'); it only throws on misconfiguration (e.g. no EMAIL_FROM). We catch that
    // so a transport misconfig can never turn a reset request into a 500 or leak account existence — the
    // token is already persisted and the failure is visible in logs/send-log for ops.
    try {
      await sendEmail(db, cfg, {
        to: u.email,
        template: 'password_reset',
        vars: {
          firstName: firstNameOf(u.name, u.email),
          resetUrl,
          ttlMinutes: cfg.consumer.resetTokenTtlMinutes,
        },
        relatedType: 'password_reset',
        relatedId: tokenId,
      }, sendOpts);
    } catch (e) {
      console.error(`[consumer] password-reset email dispatch error for token ${tokenId}: ${(e as Error).message}`);
    }
    await audit(db, { actorType: 'user', actorId: u.id, action: 'user.password_reset_requested', targetType: 'user_account', targetId: u.id, after: { tokenId }, ip: meta.ip ?? null });
    return { ok: true };
  }

  // ── Password reset — consume (set the new password, single-use, revoke all sessions) ──
  async function consumePasswordReset(rawBody: unknown, meta: { ip?: string | null } = {}) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const token = typeof rawBody.token === 'string' ? rawBody.token.trim() : '';
    if (!token) throw validation('reset token is required', 'token');
    const newPassword = checkPassword(rawBody.password);
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const row = (await db.query(
      `SELECT id, user_id, expires_at, consumed_at FROM password_reset_token WHERE token_hash = $1`,
      [tokenHash])).rows[0];
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new ConsumerError('invalid_token', 'This reset link is invalid or has expired.', 400, 'token');
    }
    const passwordHash = await hashPassword(newPassword);
    await db.tx(async (q) => {
      // Consume atomically: the WHERE consumed_at IS NULL makes a double-submit a no-op.
      const consumed = await q.query(
        `UPDATE password_reset_token SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
        [row.id]);
      if (consumed.rowCount === 0) throw new ConsumerError('invalid_token', 'This reset link has already been used.', 400, 'token');
      await q.query(`UPDATE user_account SET password_hash = $2, updated_at = now() WHERE id = $1`, [row.user_id, passwordHash]);
      // Any other outstanding reset tokens for this user are now void.
      await q.query(`UPDATE password_reset_token SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [row.user_id]);
    });
    const revoked = await revokeAllUserSessions(db, row.user_id);
    await audit(db, { actorType: 'user', actorId: row.user_id, action: 'user.password_reset', targetType: 'user_account', targetId: row.user_id, after: { sessionsRevoked: revoked }, ip: meta.ip ?? null });
    return { ok: true };
  }

  // ── Email verification — consume (stamp email_verified_at, single-use burn) (TRI-941) ──────────────
  // Returns a status the FE landing page renders: 'verified' (just now) or 'already_verified'. An
  // invalid/expired/used token throws invalid_token (400) → FE shows the "expired, resend" state.
  async function verifyEmail(rawBody: unknown, meta: { ip?: string | null } = {}) {
    if (!isPlainObject(rawBody)) throw validation('body must be an object');
    const token = typeof rawBody.token === 'string' ? rawBody.token.trim() : '';
    if (!token) throw validation('verification token is required', 'token');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const row = (await db.query(
      `SELECT id, user_id, expires_at, consumed_at FROM email_verification_token WHERE token_hash = $1`,
      [tokenHash])).rows[0];
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new ConsumerError('invalid_token', 'This verification link is invalid or has expired.', 400, 'token');
    }

    let alreadyVerified = false;
    await db.tx(async (q) => {
      // Consume atomically — a double-submit is a no-op (WHERE consumed_at IS NULL).
      const consumed = await q.query(
        `UPDATE email_verification_token SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
        [row.id]);
      if (consumed.rowCount === 0) throw new ConsumerError('invalid_token', 'This verification link has already been used.', 400, 'token');
      // Stamp verification only if not already verified (keep the original timestamp sticky).
      const stamp = await q.query(
        `UPDATE user_account SET email_verified_at = now(), updated_at = now()
          WHERE id = $1 AND email_verified_at IS NULL RETURNING id`, [row.user_id]);
      alreadyVerified = stamp.rowCount === 0;
      // Void any other outstanding verification tokens for this user.
      await q.query(`UPDATE email_verification_token SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [row.user_id]);
    });
    await audit(db, { actorType: 'user', actorId: row.user_id, action: 'user.email_verified', targetType: 'user_account', targetId: row.user_id, after: { alreadyVerified }, ip: meta.ip ?? null });
    return { ok: true, status: alreadyVerified ? 'already_verified' : 'verified' };
  }

  // ── Email verification — resend (authed by userId, or public by email; always ok, rate-limited) ────
  // Public callers pass { email } and always get { ok: true } (no user enumeration). Authed callers pass
  // the resolved userId. Rate-limited inside issueVerificationEmail (verifyResendMinSeconds).
  async function resendVerification(target: { userId?: string; email?: unknown }, meta: { ip?: string | null } = {}) {
    let user: { id: string; email: string; name: string | null } | undefined;
    if (target.userId) {
      const u = (await db.query(`SELECT id, email, name FROM user_account WHERE id = $1`, [target.userId])).rows[0];
      if (u) user = { id: u.id, email: u.email, name: u.name ?? null };
    } else {
      const email = normEmail(target.email);
      const u = (await db.query(`SELECT id, email, name FROM user_account WHERE lower(email) = $1`, [email])).rows[0];
      if (u) user = { id: u.id, email: u.email, name: u.name ?? null };
    }
    if (!user) return { ok: true }; // unknown email → silent no-op (no enumeration)
    const res = await issueVerificationEmail(user, meta, { enforceRateLimit: true });
    // Surface a delivery failure ONLY on the authed path (userId known) so the FE can say "couldn't send,
    // try again" instead of a false "sent". The email path stays silent (a deliveryFailed flag keyed on
    // account existence would leak enumeration), and a throttle isn't a failure.
    const deliveryFailed = !!target.userId && !res.sent && !res.throttled && !res.alreadyVerified;
    return {
      ok: true,
      ...(res.alreadyVerified ? { alreadyVerified: true } : {}),
      ...(res.throttled ? { throttled: true } : {}),
      ...(deliveryFailed ? { deliveryFailed: true } : {}),
    };
  }

  return {
    signup, verifyLogin, getProfile, updateProfile, changePassword, deleteAccount,
    getNotificationPrefs, updateNotificationPrefs, listMyBookings,
    requestPasswordReset, consumePasswordReset,
    verifyEmail, resendVerification, issueVerificationEmail,
    // exposed for tests / route-layer session minting after signup
    linkGuestBookings,
  };
}

export type ConsumerService = ReturnType<typeof createConsumerService>;
