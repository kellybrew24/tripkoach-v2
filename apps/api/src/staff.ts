// TRI-895 P3 · Staff management (invite → provision → accept) + admin MFA (TOTP).
//
// Wires audit item A4 (staff management) and the admin-MFA-only board decision (TRI-878). RBAC is already
// enforced by the route guards (perm('users.manage')); this service owns the data + side-effects:
//   • Staff CRUD              — list / invite / patch role+status / disable / re-enable / resend-invite
//   • Invite → provision      — create an 'invited' staff_user + an opaque token (hashed in staff_invite),
//                               email the accept-link via the shared sendEmail() lib (mock when key unset)
//   • Accept (public)         — redeem the token → set an argon2id password → status 'active' (can log in)
//   • MFA                     — enroll TOTP → verify → recovery codes → disable → regenerate; plus the
//                               login-challenge verify used by POST /auth/mfa
//
// Every mutation writes an audit_log row (see auth.audit), mirroring the rest of the admin realm.

import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { audit, hashPassword, verifyPassword } from './auth.ts';
import { sendEmail } from './email.ts';
import { generateSecret, otpauthUri, verifyTotp } from './totp.ts';
import { initials, formatReviewDate } from './util.ts';
import { AdminError, ValidationError, type Actor } from './admin.ts';

const notFound = (what: string) => new AdminError('not_found', `${what} not found`, 404);
const conflict = (msg: string) => new AdminError('conflict', msg, 409);

const ROLES = ['admin', 'operator', 'viewer'] as const;
type Role = (typeof ROLES)[number];
const RECOVERY_CODE_COUNT = 10;

type Body = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── tiny validators (local; mirror admin.ts style) ───────────────────────────────────────────
function reqEmail(b: Body): string {
  const v = b.email;
  if (typeof v !== 'string' || v.trim() === '') throw new ValidationError('"email" is required', 'email');
  const email = v.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new ValidationError('"email" is not a valid address', 'email');
  }
  return email;
}
function optName(b: Body): string | null {
  const v = b.name;
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new ValidationError('"name" must be a string', 'name');
  if (v.length > 200) throw new ValidationError('"name" is too long', 'name');
  return v.trim();
}
function reqRole(b: Body, field = 'role'): Role {
  const v = b[field];
  if (typeof v !== 'string' || !(ROLES as readonly string[]).includes(v)) {
    throw new ValidationError(`"${field}" must be one of: ${ROLES.join(', ')}`, field);
  }
  return v as Role;
}

// ── token helpers ────────────────────────────────────────────────────────────────────────────
/** Opaque invite token — 32 random bytes, URL-safe. Only its sha256 is stored (staff_invite.token_hash). */
function newInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: sha256(raw) };
}
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function createStaffService(db: Db, cfg: Config) {
  // ── DTOs ──────────────────────────────────────────────────────────────────
  function staffDTO(r: any) {
    const name: string | null = r.name ?? null;
    return {
      id: r.id,
      name,
      email: r.email,
      role: r.role,
      status: r.status,
      jobTitle: r.job_title ?? null,
      mfaEnabled: !!r.mfa_enabled,
      initials: initials(name || r.email),
      lastActiveAt: r.last_active_at ?? null,
      last: r.last_active_at ? formatReviewDate(r.last_active_at) : '—',
      createdAt: r.created_at,
    };
  }

  async function getStaffRow(id: string) {
    const { rows } = await db.query(`SELECT * FROM staff_user WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async function listStaff() {
    const { rows } = await db.query(
      `SELECT * FROM staff_user ORDER BY (status='disabled'), name NULLS LAST, email`);
    return rows.map(staffDTO);
  }

  // ── Last-admin safety: never let the console lose its only usable admin ─────
  async function countOtherActiveAdmins(exceptId: string): Promise<number> {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM staff_user WHERE role='admin' AND status='active' AND id <> $1`, [exceptId]);
    return Number(rows[0].n);
  }

  // ── Invite → provision ──────────────────────────────────────────────────────
  async function issueInvite(staffUserId: string, email: string, invitedBy: string | null) {
    const { raw, hash } = newInviteToken();
    const { rows } = await db.query<{ id: string; expires_at: string }>(
      `INSERT INTO staff_invite (staff_user_id, token_hash, invited_by, email, expires_at)
       VALUES ($1,$2,$3,$4, now() + ($5 * interval '1 hour'))
       RETURNING id, expires_at`,
      [staffUserId, hash, invitedBy, email, cfg.staffInviteExpiryHours]);
    return { inviteId: rows[0].id, raw, expiresAt: rows[0].expires_at };
  }

  function acceptUrlFor(raw: string): string {
    return `${cfg.adminBaseUrl}/accept-invite?token=${raw}`;
  }

  // The invite response. The raw token / accept-link is surfaced ONLY when the email was not actually
  // dispatched (transport disabled in dev, or a send failure) so an admin can still complete the flow
  // manually and the smoke can redeem it. When the email is genuinely 'sent', we withhold the token —
  // it lives only in the recipient's inbox.
  function inviteResponse(inviteId: string, expiresAt: string, raw: string, emailStatus: string) {
    const base: any = { id: inviteId, expiresAt, emailStatus };
    if (emailStatus !== 'sent') { base.acceptUrl = acceptUrlFor(raw); base.token = raw; }
    return base;
  }

  async function sendInviteEmail(to: string, name: string | null, role: string, invite: { inviteId: string; raw: string }) {
    const acceptUrl = acceptUrlFor(invite.raw);
    // Best-effort: sendEmail never throws for a dispatch failure / disabled transport (it logs a send-log
    // row). Programmer errors (bad template/var) would throw — surfaced in dev, caught by the route's 500.
    return sendEmail(db, cfg, {
      to,
      template: 'staff_invite',
      vars: {
        name: name || to,
        role,
        acceptUrl,
        expiryHours: cfg.staffInviteExpiryHours,
      },
      relatedType: 'staff_invite',
      relatedId: invite.inviteId,
    });
  }

  async function inviteStaff(body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const email = reqEmail(body);
    const name = optName(body);
    // Default new invites to 'operator' unless a role is given (admin is deliberately explicit).
    const role: Role = body.role == null || body.role === '' ? 'operator' : reqRole(body);
    const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim().slice(0, 200) || null : null;

    const existing = (await db.query(`SELECT * FROM staff_user WHERE lower(email) = $1`, [email])).rows[0];
    if (existing) {
      if (existing.status === 'active') throw conflict(`${email} is already an active staff member`);
      if (existing.status === 'disabled') throw conflict(`${email} is disabled — re-enable the account instead of re-inviting`);
      // status 'invited': refresh role/name and re-issue a fresh invite (older tokens simply expire).
      await db.query(
        `UPDATE staff_user SET role=$2, name=COALESCE($3, name), job_title=COALESCE($4, job_title), updated_at=now() WHERE id=$1`,
        [existing.id, role, name, jobTitle]);
      const invite = await issueInvite(existing.id, email, actor.id);
      const emailResult = await sendInviteEmail(email, name ?? existing.name, role, invite);
      await audit(db, { actorId: actor.id, action: 'staff.invite_resent', targetType: 'staff_user', targetId: existing.id, after: { email, role, inviteId: invite.inviteId, emailStatus: emailResult.status }, ip: actor.ip });
      const row = await getStaffRow(existing.id);
      return { staff: staffDTO(row), invite: inviteResponse(invite.inviteId, invite.expiresAt, invite.raw, emailResult.status) };
    }

    const { rows } = await db.query(
      `INSERT INTO staff_user (email, name, role, job_title, status)
       VALUES ($1,$2,$3,$4,'invited') RETURNING *`,
      [email, name, role, jobTitle]);
    const staff = rows[0];
    const invite = await issueInvite(staff.id, email, actor.id);
    const emailResult = await sendInviteEmail(email, name, role, invite);
    await audit(db, { actorId: actor.id, action: 'staff.invite', targetType: 'staff_user', targetId: staff.id, after: { email, role, inviteId: invite.inviteId, emailStatus: emailResult.status }, ip: actor.ip });
    return { staff: staffDTO(staff), invite: inviteResponse(invite.inviteId, invite.expiresAt, invite.raw, emailResult.status) };
  }

  async function resendInvite(id: string, actor: Actor) {
    const staff = await getStaffRow(id);
    if (!staff) throw notFound('staff member');
    if (staff.status !== 'invited') throw conflict(`can only resend invites for a pending (invited) account; ${staff.email} is ${staff.status}`);
    const invite = await issueInvite(staff.id, staff.email, actor.id);
    const emailResult = await sendInviteEmail(staff.email, staff.name, staff.role, invite);
    await audit(db, { actorId: actor.id, action: 'staff.invite_resent', targetType: 'staff_user', targetId: staff.id, after: { email: staff.email, inviteId: invite.inviteId, emailStatus: emailResult.status }, ip: actor.ip });
    return { staff: staffDTO(staff), invite: inviteResponse(invite.inviteId, invite.expiresAt, invite.raw, emailResult.status) };
  }

  // Cancel a pending invite outright (TRI-996). The account never accepted, so we
  // remove the placeholder staff_user entirely — staff_invite rows cascade away
  // (006/015 ON DELETE CASCADE) and no sessions/uploads can exist yet. Only
  // 'invited' accounts are eligible; active/disabled must go through disable.
  async function revokeInvite(id: string, actor: Actor) {
    const cur = await getStaffRow(id);
    if (!cur) throw notFound('staff member');
    if (cur.status !== 'invited') throw conflict(`can only revoke a pending (invited) invite; ${cur.email} is ${cur.status} — disable the account instead`);
    await db.query(`DELETE FROM staff_user WHERE id=$1`, [id]);
    await audit(db, { actorId: actor.id, action: 'staff.invite_revoked', targetType: 'staff_user', targetId: id, before: { email: cur.email, role: cur.role, status: cur.status }, ip: actor.ip });
    return { ok: true, id, email: cur.email };
  }

  // ── Accept (PUBLIC — no session; the token IS the credential) ────────────────
  async function findLiveInvite(token: string) {
    if (typeof token !== 'string' || token.trim() === '') throw new ValidationError('"token" is required', 'token');
    const hash = sha256(token.trim());
    const { rows } = await db.query(
      `SELECT i.*, u.email AS user_email, u.name AS user_name, u.role AS user_role, u.status AS user_status
         FROM staff_invite i JOIN staff_user u ON u.id = i.staff_user_id
        WHERE i.token_hash = $1`, [hash]);
    return rows[0] ?? null;
  }

  /** Read-only preview for the accept screen: who the invite is for + whether it's still redeemable. */
  async function previewInvite(token: string) {
    const inv = await findLiveInvite(token);
    if (!inv) return { valid: false, reason: 'not_found' as const };
    if (inv.accepted_at) return { valid: false, reason: 'already_accepted' as const };
    if (new Date(inv.expires_at).getTime() <= Date.now()) return { valid: false, reason: 'expired' as const };
    if (inv.user_status !== 'invited') return { valid: false, reason: 'not_pending' as const };
    return { valid: true as const, email: inv.user_email, name: inv.user_name ?? null, role: inv.user_role, expiresAt: inv.expires_at };
  }

  async function acceptInvite(body: unknown) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) throw new ValidationError('"token" is required', 'token');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 10) throw new ValidationError('password must be at least 10 characters', 'password');
    if (password.length > 200) throw new ValidationError('password is too long', 'password');
    const name = optName(body);

    const inv = await findLiveInvite(token);
    if (!inv) throw new AdminError('invalid_token', 'This invite link is invalid.', 400);
    if (inv.accepted_at) throw conflict('This invite has already been used.');
    if (new Date(inv.expires_at).getTime() <= Date.now()) throw new AdminError('expired', 'This invite link has expired. Ask an admin to resend it.', 410);
    if (inv.user_status !== 'invited') throw conflict('This account is no longer awaiting acceptance.');

    const hash = await hashPassword(password);
    await db.tx(async (q) => {
      await q.query(
        `UPDATE staff_user SET password_hash=$2, name=COALESCE($3, name), status='active', updated_at=now() WHERE id=$1`,
        [inv.staff_user_id, hash, name]);
      await q.query(`UPDATE staff_invite SET accepted_at=now() WHERE id=$1`, [inv.id]);
      // Invalidate any other outstanding invites for this user (older resends).
      await q.query(`UPDATE staff_invite SET expires_at=now() WHERE staff_user_id=$1 AND accepted_at IS NULL AND id <> $2`, [inv.staff_user_id, inv.id]);
    });
    await audit(db, { actorId: inv.staff_user_id, action: 'staff.invite_accepted', targetType: 'staff_user', targetId: inv.staff_user_id, after: { email: inv.user_email }, ip: null });
    return { ok: true, email: inv.user_email, role: inv.user_role };
  }

  // ── Update role / status; disable / enable ───────────────────────────────────
  async function updateStaff(id: string, body: unknown, actor: Actor) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = await getStaffRow(id);
    if (!cur) throw notFound('staff member');

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    let nextRole = cur.role;
    let nextStatus = cur.status;
    if (body.role !== undefined) { nextRole = reqRole(body); set('role', nextRole); }
    if (body.name !== undefined) set('name', optName(body));
    if (body.jobTitle !== undefined) set('job_title', typeof body.jobTitle === 'string' ? body.jobTitle.trim().slice(0, 200) || null : null);
    if (body.status !== undefined) {
      const status = body.status;
      if (status !== 'active' && status !== 'disabled') {
        throw new ValidationError('"status" can only be set to "active" or "disabled" here (use the invite flow for pending accounts)', 'status');
      }
      if (status === 'active' && cur.status === 'invited') {
        throw conflict('this account has not accepted its invite yet — resend the invite instead of activating it');
      }
      nextStatus = status;
      set('status', status);
    }

    // Last-admin guard: block demoting/disabling the only remaining active admin.
    const losingAdmin = cur.role === 'admin' && cur.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active');
    if (losingAdmin && (await countOtherActiveAdmins(cur.id)) === 0) {
      throw conflict('this is the last active admin — promote another admin before changing this account');
    }

    if (!sets.length) throw new ValidationError('no updatable fields provided (role, name, jobTitle, status)');
    params.push(id);
    await db.query(`UPDATE staff_user SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}`, params);
    await audit(db, { actorId: actor.id, action: 'staff.update', targetType: 'staff_user', targetId: id, before: { role: cur.role, status: cur.status }, after: { role: nextRole, status: nextStatus }, ip: actor.ip });
    return staffDTO(await getStaffRow(id));
  }

  async function setStatus(id: string, status: 'active' | 'disabled', actor: Actor) {
    const cur = await getStaffRow(id);
    if (!cur) throw notFound('staff member');
    if (status === 'active' && cur.status === 'invited') {
      throw conflict('this account has not accepted its invite yet — resend the invite instead');
    }
    if (status === 'disabled' && cur.role === 'admin' && cur.status === 'active' && (await countOtherActiveAdmins(cur.id)) === 0) {
      throw conflict('this is the last active admin — promote another admin before disabling this account');
    }
    if (cur.status === status) return staffDTO(cur);
    await db.query(`UPDATE staff_user SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);
    if (status === 'disabled') {
      // Revoke all live sessions so a disabled staff member is signed out everywhere immediately.
      await db.query(`UPDATE session SET revoked_at=now() WHERE subject_type='staff' AND subject_id=$1 AND revoked_at IS NULL`, [id]);
    }
    await audit(db, { actorId: actor.id, action: status === 'disabled' ? 'staff.disable' : 'staff.enable', targetType: 'staff_user', targetId: id, before: { status: cur.status }, after: { status }, ip: actor.ip });
    return staffDTO(await getStaffRow(id));
  }

  // ── MFA (TOTP) ───────────────────────────────────────────────────────────────
  function genRecoveryCodes(): string[] {
    // 10 codes of the form "abcd-efgh" (lowercase base32-ish, unambiguous). Shown ONCE at generation.
    const out: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const hex = randomBytes(5).toString('hex'); // 10 hex chars
      out.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
    }
    return out;
  }
  const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

  async function storeRecoveryCodes(q: Db, staffId: string, codes: string[]) {
    await q.query(`DELETE FROM recovery_code WHERE staff_user_id=$1`, [staffId]);
    for (const c of codes) {
      const h = await hashPassword(normalizeRecovery(c));
      await q.query(`INSERT INTO recovery_code (staff_user_id, code_hash) VALUES ($1,$2)`, [staffId, h]);
    }
  }

  /** Begin enrollment: issue a fresh secret + a PENDING factor. Returns the secret + otpauth URI. */
  async function enrollMfa(staffId: string, actor: Actor) {
    const staff = await getStaffRow(staffId);
    if (!staff) throw notFound('staff member');
    if (staff.mfa_enabled) throw conflict('MFA is already enabled — disable it first to re-enroll');
    const secret = generateSecret();
    // Replace any prior unconfirmed factor; a fresh enroll supersedes an abandoned one.
    await db.query(`DELETE FROM mfa_factor WHERE staff_user_id=$1 AND confirmed_at IS NULL`, [staffId]);
    await db.query(`INSERT INTO mfa_factor (staff_user_id, type, secret) VALUES ($1,'totp',$2)`, [staffId, secret]);
    await audit(db, { actorId: actor.id, action: 'staff.mfa_enroll_started', targetType: 'staff_user', targetId: staffId, ip: actor.ip });
    return { secret, otpauthUri: otpauthUri(secret, staff.email, cfg.mfaIssuer), issuer: cfg.mfaIssuer };
  }

  /** Confirm enrollment with a live code → enable MFA + return the one-time recovery codes. */
  async function verifyMfaEnrollment(staffId: string, code: string, actor: Actor) {
    const factor = (await db.query(
      `SELECT * FROM mfa_factor WHERE staff_user_id=$1 AND confirmed_at IS NULL ORDER BY added_at DESC LIMIT 1`, [staffId])).rows[0];
    if (!factor) throw conflict('no pending MFA enrollment — start enroll first');
    if (!verifyTotp(factor.secret, String(code ?? ''))) {
      throw new ValidationError('that code did not match — check your authenticator app and try again', 'code');
    }
    const codes = genRecoveryCodes();
    await db.tx(async (q) => {
      await q.query(`UPDATE mfa_factor SET confirmed_at=now() WHERE id=$1`, [factor.id]);
      // Drop any other (older) factors so exactly one confirmed factor remains.
      await q.query(`DELETE FROM mfa_factor WHERE staff_user_id=$1 AND id <> $2`, [staffId, factor.id]);
      await q.query(`UPDATE staff_user SET mfa_enabled=true, updated_at=now() WHERE id=$1`, [staffId]);
      await storeRecoveryCodes(q, staffId, codes);
    });
    await audit(db, { actorId: actor.id, action: 'staff.mfa_enabled', targetType: 'staff_user', targetId: staffId, ip: actor.ip });
    return { enabled: true, recoveryCodes: codes };
  }

  /** Disable MFA. Requires a valid current TOTP or recovery code (self-service safety). */
  async function disableMfa(staffId: string, code: string, actor: Actor) {
    const staff = await getStaffRow(staffId);
    if (!staff) throw notFound('staff member');
    if (!staff.mfa_enabled) return { enabled: false };
    const ok = await verifyChallenge(staffId, String(code ?? ''));
    if (!ok) throw new ValidationError('enter a current authenticator or recovery code to turn off two-factor', 'code');
    await db.tx(async (q) => {
      await q.query(`DELETE FROM mfa_factor WHERE staff_user_id=$1`, [staffId]);
      await q.query(`DELETE FROM recovery_code WHERE staff_user_id=$1`, [staffId]);
      await q.query(`UPDATE staff_user SET mfa_enabled=false, updated_at=now() WHERE id=$1`, [staffId]);
    });
    await audit(db, { actorId: actor.id, action: 'staff.mfa_disabled', targetType: 'staff_user', targetId: staffId, ip: actor.ip });
    return { enabled: false };
  }

  async function regenerateRecoveryCodes(staffId: string, actor: Actor) {
    const staff = await getStaffRow(staffId);
    if (!staff) throw notFound('staff member');
    if (!staff.mfa_enabled) throw conflict('enable MFA before generating recovery codes');
    const codes = genRecoveryCodes();
    await db.tx(async (q) => { await storeRecoveryCodes(q, staffId, codes); });
    await audit(db, { actorId: actor.id, action: 'staff.mfa_recovery_regenerated', targetType: 'staff_user', targetId: staffId, ip: actor.ip });
    return { recoveryCodes: codes };
  }

  /**
   * Verify a login/second-factor code for a staff member: a live TOTP OR an unused recovery code
   * (consumed on use). Used by the login challenge (POST /auth/mfa) and by disableMfa. Returns boolean;
   * never throws for a wrong code.
   */
  async function verifyChallenge(staffId: string, code: string): Promise<boolean> {
    const cleaned = (code ?? '').trim();
    if (!cleaned) return false;
    const factor = (await db.query(
      `SELECT * FROM mfa_factor WHERE staff_user_id=$1 AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC LIMIT 1`, [staffId])).rows[0];
    if (factor && verifyTotp(factor.secret, cleaned)) return true;
    // Fall back to recovery codes (single-use).
    const normalized = normalizeRecovery(cleaned);
    if (!normalized) return false;
    const { rows } = await db.query(
      `SELECT id, code_hash FROM recovery_code WHERE staff_user_id=$1 AND used_at IS NULL`, [staffId]);
    for (const rc of rows) {
      if (await verifyPassword(normalized, rc.code_hash)) {
        await db.query(`UPDATE recovery_code SET used_at=now() WHERE id=$1`, [rc.id]);
        return true;
      }
    }
    return false;
  }

  /** MFA status for the current staff member (drives the console's security panel). */
  async function mfaStatus(staffId: string) {
    const staff = await getStaffRow(staffId);
    if (!staff) throw notFound('staff member');
    const remaining = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM recovery_code WHERE staff_user_id=$1 AND used_at IS NULL`, [staffId])).rows[0].n);
    const pending = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM mfa_factor WHERE staff_user_id=$1 AND confirmed_at IS NULL`, [staffId])).rows[0].n) > 0;
    return { enabled: !!staff.mfa_enabled, pendingEnrollment: pending, recoveryCodesRemaining: remaining };
  }

  // ── Self-update (PATCH /me) ───────────────────────────────────────────────────
  // Any staff may update their own name. Job title is admin-only: non-admins cannot set it on themselves.
  async function updateSelf(id: string, body: unknown, actorRole: string) {
    if (!isPlainObject(body)) throw new ValidationError('body must be an object');
    const cur = await getStaffRow(id);
    if (!cur) throw notFound('staff member');

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.name !== undefined) set('name', optName(body));
    if (body.jobTitle !== undefined) {
      if (actorRole !== 'admin') throw new AdminError('forbidden', 'only admins may set their own job title', 403);
      set('job_title', typeof body.jobTitle === 'string' ? body.jobTitle.trim().slice(0, 200) || null : null);
    }

    if (!sets.length) throw new ValidationError('no updatable fields provided (name, jobTitle)');
    params.push(id);
    await db.query(`UPDATE staff_user SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length}`, params);
    await audit(db, { actorId: id, action: 'staff.update_self', targetType: 'staff_user', targetId: id, before: { name: cur.name, job_title: cur.job_title }, after: { name: body.name ?? cur.name, job_title: body.jobTitle ?? cur.job_title }, ip: null });
    return staffDTO(await getStaffRow(id));
  }

  return {
    listStaff, inviteStaff, resendInvite, revokeInvite, previewInvite, acceptInvite, updateStaff, updateSelf, setStatus,
    enrollMfa, verifyMfaEnrollment, disableMfa, regenerateRecoveryCodes, verifyChallenge, mfaStatus,
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
