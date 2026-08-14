// TRI-1029 · Consumer two-factor authentication (TOTP) service.
//
// The customer-facing analogue of the admin MFA in staff.ts. Same RFC-6238 spine (totp.ts) and the same
// enroll → verify → recovery-codes → challenge → disable lifecycle, but scoped to user_account and its
// per-user factor/recovery tables (migration 027). Reuses the shared argon2id hashing (auth.ts) to store
// recovery codes and the shared audit trail. Typed errors are ConsumerError so the consumer route layer's
// existing error handler maps them to the {error:{code,message}} envelope.
//
// The login GATE reuses session.mfa_pending (migration 015, shared session table): verifyLogin returns a
// half-auth signal for a 2FA-enabled account and the route mints an mfa_pending session; this service only
// owns enrollment/management + the second-factor verification used by the login challenge and by disable.

import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import type { Config } from './config.ts';
import { hashPassword, verifyPassword, audit } from './auth.ts';
import { generateSecret, otpauthUri, verifyTotp } from './totp.ts';
import { ConsumerError } from './consumer.ts';

const RECOVERY_CODE_COUNT = 10;
// Consumer-facing issuer label the authenticator app shows (cfg.mfaIssuer is "TripKoach Admin" — the
// customer app is just "TripKoach"). Kept here rather than a new env var to avoid config churn.
const CONSUMER_ISSUER = 'TripKoach';

const conflict = (message: string) => new ConsumerError('conflict', message, 409);
const validation = (message: string, field?: string) => new ConsumerError('validation', message, 400, field);
const notFound = (what: string) => new ConsumerError('not_found', `${what} not found`, 404);

export function createConsumerMfaService(db: Db, _cfg: Config) {
  // 10 codes of the form "abcd0-1efgh" (lowercase hex, unambiguous). Shown ONCE at generation.
  function genRecoveryCodes(): string[] {
    const out: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const hex = randomBytes(5).toString('hex'); // 10 hex chars
      out.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
    }
    return out;
  }
  const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

  async function storeRecoveryCodes(q: Db, userId: string, codes: string[]) {
    await q.query(`DELETE FROM user_recovery_code WHERE user_id=$1`, [userId]);
    for (const c of codes) {
      const h = await hashPassword(normalizeRecovery(c));
      await q.query(`INSERT INTO user_recovery_code (user_id, code_hash) VALUES ($1,$2)`, [userId, h]);
    }
  }

  async function loadUser(userId: string) {
    return (await db.query(`SELECT id, email, two_factor_enabled FROM user_account WHERE id=$1 AND deleted_at IS NULL`, [userId])).rows[0];
  }

  /** Current enrollment state for the account. */
  async function status(userId: string) {
    const u = await loadUser(userId);
    if (!u) throw notFound('account');
    return { enabled: !!u.two_factor_enabled };
  }

  /** Begin enrollment: issue a fresh secret + a PENDING factor. Returns the secret + otpauth URI (for QR). */
  async function enroll(userId: string, ip: string | null) {
    const u = await loadUser(userId);
    if (!u) throw notFound('account');
    if (u.two_factor_enabled) throw conflict('Two-factor is already on. Turn it off first to re-enroll.');
    const secret = generateSecret();
    // A fresh enroll supersedes any abandoned unconfirmed factor.
    await db.query(`DELETE FROM user_mfa_factor WHERE user_id=$1 AND confirmed_at IS NULL`, [userId]);
    await db.query(`INSERT INTO user_mfa_factor (user_id, type, secret) VALUES ($1,'totp',$2)`, [userId, secret]);
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.mfa_enroll_started', targetType: 'user_account', targetId: userId, ip });
    return { secret, otpauthUri: otpauthUri(secret, u.email, CONSUMER_ISSUER), issuer: CONSUMER_ISSUER };
  }

  /** Confirm enrollment with a live code → turn 2FA on + return the one-time recovery codes. */
  async function verifyEnroll(userId: string, code: unknown, ip: string | null) {
    const factor = (await db.query(
      `SELECT * FROM user_mfa_factor WHERE user_id=$1 AND confirmed_at IS NULL ORDER BY added_at DESC LIMIT 1`, [userId])).rows[0];
    if (!factor) throw conflict('Start setup first: no pending two-factor enrollment.');
    if (!verifyTotp(factor.secret, String(code ?? ''))) {
      throw validation('That code did not match. Check your authenticator app and try again.', 'code');
    }
    const codes = genRecoveryCodes();
    await db.tx(async (q) => {
      await q.query(`UPDATE user_mfa_factor SET confirmed_at=now() WHERE id=$1`, [factor.id]);
      // Keep exactly one confirmed factor.
      await q.query(`DELETE FROM user_mfa_factor WHERE user_id=$1 AND id <> $2`, [userId, factor.id]);
      await q.query(`UPDATE user_account SET two_factor_enabled=true, updated_at=now() WHERE id=$1`, [userId]);
      await storeRecoveryCodes(q, userId, codes);
    });
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.mfa_enabled', targetType: 'user_account', targetId: userId, ip });
    return { enabled: true, recoveryCodes: codes };
  }

  /** Turn 2FA off. Requires a valid current TOTP or recovery code (self-service safety). */
  async function disable(userId: string, code: unknown, ip: string | null) {
    const u = await loadUser(userId);
    if (!u) throw notFound('account');
    if (!u.two_factor_enabled) return { enabled: false };
    if (!(await verifyChallenge(userId, String(code ?? '')))) {
      throw validation('Enter a current authenticator or recovery code to turn off two-factor.', 'code');
    }
    await db.tx(async (q) => {
      await q.query(`DELETE FROM user_mfa_factor WHERE user_id=$1`, [userId]);
      await q.query(`DELETE FROM user_recovery_code WHERE user_id=$1`, [userId]);
      await q.query(`UPDATE user_account SET two_factor_enabled=false, updated_at=now() WHERE id=$1`, [userId]);
    });
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.mfa_disabled', targetType: 'user_account', targetId: userId, ip });
    return { enabled: false };
  }

  /** Regenerate the one-time recovery codes (invalidates the old set). */
  async function regenerateRecoveryCodes(userId: string, ip: string | null) {
    const u = await loadUser(userId);
    if (!u) throw notFound('account');
    if (!u.two_factor_enabled) throw conflict('Turn on two-factor before generating recovery codes.');
    const codes = genRecoveryCodes();
    await db.tx(async (q) => { await storeRecoveryCodes(q, userId, codes); });
    await audit(db, { actorType: 'user', actorId: userId, action: 'user.mfa_recovery_regenerated', targetType: 'user_account', targetId: userId, ip });
    return { recoveryCodes: codes };
  }

  /**
   * Verify a second-factor code: a live TOTP OR an unused recovery code (consumed on use). Used by the
   * login challenge (POST /auth/mfa) and by disable(). Returns boolean; never throws for a wrong code.
   */
  async function verifyChallenge(userId: string, code: string): Promise<boolean> {
    const cleaned = (code ?? '').trim();
    if (!cleaned) return false;
    const factor = (await db.query(
      `SELECT * FROM user_mfa_factor WHERE user_id=$1 AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC LIMIT 1`, [userId])).rows[0];
    if (factor && verifyTotp(factor.secret, cleaned)) return true;
    // Fall back to recovery codes (single-use).
    const normalized = normalizeRecovery(cleaned);
    if (!normalized) return false;
    const { rows } = await db.query(
      `SELECT id, code_hash FROM user_recovery_code WHERE user_id=$1 AND used_at IS NULL`, [userId]);
    for (const rc of rows) {
      if (await verifyPassword(normalized, rc.code_hash)) {
        await db.query(`UPDATE user_recovery_code SET used_at=now() WHERE id=$1`, [rc.id]);
        return true;
      }
    }
    return false;
  }

  return { status, enroll, verifyEnroll, disable, regenerateRecoveryCodes, verifyChallenge };
}

export type ConsumerMfaService = ReturnType<typeof createConsumerMfaService>;
