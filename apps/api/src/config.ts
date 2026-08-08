// Runtime config. Same-origin deploy: the SPA hits `/api/v1`, Caddy reverse-proxies to this service
// bound on localhost:<PORT>. Secrets (DATABASE_URL) come from the environment / secret store — never code.

export interface Config {
  port: number;
  host: string;
  /** 'pg' → real Postgres via DATABASE_URL; 'pglite' → in-process WASM Postgres (local dev/smoke, no Docker). */
  dbDriver: 'pg' | 'pglite';
  databaseUrl: string | undefined;
  /** PGlite data dir; 'memory://' for ephemeral. */
  pgliteData: string;
  env: string;
  apiPrefix: string;
  /** Public base URL of the consumer web SPA (no trailing slash). Used to build absolute links in
   *  outbound email (e.g. the tokenized review-invite URL). Same-origin deploy → the SPA's own origin. */
  webUrl: string;
  /** Run migrations automatically on boot (handy in dev; DevOps may run them as a deploy step in prod). */
  autoMigrate: boolean;
  /** Online seat-hold window in minutes (booking.reservation_expires_at = now() + this). */
  reservationHoldMinutes: number;
  paystack: PaystackConfig;
  /** Admin write/auth realm mount point (Caddy proxies /api/* verbatim on admin.dev.tripkoach.com). */
  adminPrefix: string;
  /** Session cookie name for the admin realm (httpOnly + Secure + SameSite). */
  adminCookieName: string;
  /** Secure flag on the admin session cookie. True everywhere the SPA is served over HTTPS (the dev box
   *  is HTTPS via Caddy). Set COOKIE_SECURE=false only for local plain-HTTP testing. */
  adminCookieSecure: boolean;
  adminCookieSameSite: 'lax' | 'strict' | 'none';
  /** Idle-timeout for admin sessions, minutes. The console signs staff out after inactivity (sliding). */
  adminSessionIdleMinutes: number;
  /** Consumer (subject_type='user') auth — TRI-881. Cookie + session/reset windows for the client SPA. */
  consumer: ConsumerConfig;
  /** Public origin of the admin console (used to build the invite accept-link in staff invite emails). */
  adminBaseUrl: string;
  /** How long a staff invite token stays valid, hours (TRI-895). */
  staffInviteExpiryHours: number;
  /** Issuer label shown in the authenticator app for admin TOTP factors (TRI-895). */
  mfaIssuer: string;
  /** Roles for which MFA is REQUIRED (TRI-912): a factor-less login by one of these roles is issued an
   *  enroll-gated half-auth session that can reach only the MFA enroll endpoints until a factor is set.
   *  Roles outside this set keep MFA optional. Default enforces admin+operator; viewer stays optional. */
  mfaEnforcedRoles: readonly string[];
  fx: FxConfig;
  email: EmailConfig;
  notify: NotifyConfig;
}

// Transactional notifications (TRI-889). Governs the booking-lifecycle emails + the departure-reminder
// cron. Dispatch itself flows through the shared email transport (EmailConfig) — when that is disabled
// (no RESEND_API_KEY / EMAIL_FROM) every notification renders + logs 'skipped' and nothing is sent.
export interface NotifyConfig {
  /** Public web origin used to build booking-management links in emails (no trailing slash). */
  webBaseUrl: string;
  /** Departure-reminder lead time: email travellers whose paid booking departs this many days out. */
  reminderDaysBefore: number;
}

// Consumer accounts & auth (TRI-881). Mirrors the admin session model (revocable, sliding idle expiry)
// but on subject_type='user', with a longer default idle window suited to a customer-facing app and its
// own cookie. Cookie Secure/SameSite reuse the shared COOKIE_* env (same browser/TLS posture as admin).
export interface ConsumerConfig {
  /** Session cookie name for the consumer realm (httpOnly + Secure + SameSite). */
  cookieName: string;
  /** Idle-timeout for consumer sessions, minutes (sliding). Default 14 days. */
  sessionIdleMinutes: number;
  /** Password-reset token lifetime, minutes. Default 60. */
  resetTokenTtlMinutes: number;
  /** Public app origin used to build the password-reset link in the email (no trailing slash). */
  appBaseUrl: string;
}

// Outbound email transport (TRI-880). The shared sendEmail() lib dispatches through this. Provider is
// Resend (reusing the legacy stack's account/domain send.tripkoach.com — DKIM/SPF live). Secrets come
// from the environment / secret store — never code.
export interface EmailConfig {
  /** Provider display name recorded in email_message.provider. */
  providerName: string;
  /** Provider API base; overridable so smoke/tests never hit the network. */
  apiBase: string;
  /** Resend API key. When unset (or dryRun), the transport is disabled → emails render + log 'skipped'. */
  apiKey: string | undefined;
  /** Default From header, e.g. 'TripKoach <bookings@send.tripkoach.com>'. Required to actually send. */
  from: string | undefined;
  /** Default Reply-To header (optional). */
  replyTo: string | undefined;
  /** Force-disable dispatch even when an API key is present (render + log 'skipped'). Ops safety valve. */
  dryRun: boolean;
  /** Network timeout for the provider call, ms. */
  timeoutMs: number;
}

// Automated daily USD→GHS FX refresh (TRI-873). The cron fetches the mid-market rate, applies the
// buffer, and writes the effective rate into settings.usd_to_ghs_charge_rate. Vendor is env-swappable.
export interface FxConfig {
  /** Provider display name recorded in fx_rate_history.source (swap alongside providerUrl). */
  providerName: string;
  /** JSON rates endpoint keyed by ISO currency. Default: exchangerate-api.com free open endpoint (no key). */
  providerUrl: string;
  /** Target currency to read from the provider's `rates` map. */
  targetCurrency: string;
  /** Buffer % added on top of the mid-market rate → effective charge rate. Default 1.75. */
  bufferPct: number;
  /** Reject a fetched rate deviating more than this % from last-known-good. Default 5. */
  maxDeviationPct: number;
  /** Network timeout for the provider fetch, ms. */
  timeoutMs: number;
}

// Paystack (TEST-only in this slice). Secrets come from env — never code. See .env.example / secret store.
export interface PaystackConfig {
  secretKey: string | undefined;
  publicKey: string | undefined;
  /** HMAC key for webhook signature verification. Falls back to secretKey (Paystack signs with it). */
  webhookSecret: string | undefined;
  /** Paystack API base; overridable so smoke/tests never hit the network. */
  baseUrl: string;
  /** Explicit env override for the USD→GHS charge rate. When set, WINS over settings.*_rate. */
  chargeRateOverride: number | undefined;
}

function num(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  // Default to pglite when no DATABASE_URL is present so local dev/smoke needs no external Postgres.
  const dbDriver = (process.env.DB_DRIVER as 'pg' | 'pglite') || (databaseUrl ? 'pg' : 'pglite');
  return {
    // DevOps (TRI-862) proxies /api/* verbatim → 127.0.0.1:3020 on the dev box. Match that by default.
    port: Number(process.env.PORT || 3020),
    host: process.env.HOST || '127.0.0.1',
    dbDriver,
    databaseUrl,
    pgliteData: process.env.PGLITE_DATA || 'memory://',
    env: process.env.NODE_ENV || 'development',
    apiPrefix: process.env.API_PREFIX || '/api/v1',
    // Consumer SPA origin for absolute email links. Prod injects WEB_URL (e.g. https://app.tripkoach.com);
    // strip any trailing slash so callers can concatenate paths safely.
    webUrl: (process.env.WEB_URL || process.env.PUBLIC_WEB_URL || 'https://app.tripkoach.com').replace(/\/+$/, ''),
    autoMigrate: process.env.AUTO_MIGRATE ? process.env.AUTO_MIGRATE === 'true' : dbDriver === 'pglite',
    reservationHoldMinutes: num(process.env.RESERVATION_HOLD_MINUTES) ?? 30,
    paystack: {
      // Accept both the neutral names and the TRIPKOACH_* names DevOps injects from the secret file.
      secretKey: process.env.PAYSTACK_SECRET_KEY || process.env.TRIPKOACH_PAYSTACK_SECRET_KEY,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || process.env.TRIPKOACH_PAYSTACK_PUBLIC_KEY,
      webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || process.env.TRIPKOACH_PAYSTACK_WEBHOOK_SECRET,
      baseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
      chargeRateOverride: num(process.env.PAYSTACK_USD_TO_GHS_RATE),
    },
    adminPrefix: process.env.ADMIN_PREFIX || '/api/admin',
    adminCookieName: process.env.ADMIN_COOKIE_NAME || 'tk_admin_session',
    adminCookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : true,
    adminCookieSameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') || 'lax',
    adminSessionIdleMinutes: Number(process.env.ADMIN_SESSION_IDLE_MINUTES || 30),
    consumer: {
      cookieName: process.env.USER_COOKIE_NAME || 'tk_user_session',
      sessionIdleMinutes: num(process.env.USER_SESSION_IDLE_MINUTES) ?? 20_160, // 14 days
      resetTokenTtlMinutes: num(process.env.PASSWORD_RESET_TTL_MINUTES) ?? 60,
      appBaseUrl: (process.env.APP_BASE_URL || 'https://app.tripkoach.com').replace(/\/+$/, ''),
    },
    // Where the admin console is served — the invite email links to `${adminBaseUrl}/accept-invite?token=…`.
    // Default matches the dev console host (TRI-854); DevOps sets ADMIN_BASE_URL per environment.
    adminBaseUrl: (process.env.ADMIN_BASE_URL || 'https://admin.dev.tripkoach.com').replace(/\/+$/, ''),
    staffInviteExpiryHours: num(process.env.STAFF_INVITE_EXPIRY_HOURS) ?? 72,
    mfaIssuer: process.env.MFA_ISSUER || 'TripKoach Admin',
    // TRI-912: comma-separated roles that MUST have MFA. Default = admin,operator (viewer optional).
    // Set MFA_ENFORCED_ROLES='' to disable enforcement entirely (revert to opt-in MFA).
    mfaEnforcedRoles: (process.env.MFA_ENFORCED_ROLES ?? 'admin,operator')
      .split(',').map((r) => r.trim().toLowerCase()).filter(Boolean),
    fx: {
      providerName: process.env.FX_PROVIDER_NAME || 'open.er-api.com',
      providerUrl: process.env.FX_PROVIDER_URL || 'https://open.er-api.com/v6/latest/USD',
      targetCurrency: process.env.FX_TARGET_CURRENCY || 'GHS',
      bufferPct: num(process.env.FX_BUFFER_PCT) ?? 1.75,
      maxDeviationPct: num(process.env.FX_MAX_DEVIATION_PCT) ?? 5,
      timeoutMs: num(process.env.FX_TIMEOUT_MS) ?? 10_000,
    },
    email: {
      providerName: process.env.EMAIL_PROVIDER_NAME || 'resend',
      apiBase: process.env.EMAIL_API_BASE || 'https://api.resend.com',
      // Accept both the neutral name and the TRIPKOACH_* name DevOps injects from the secret file.
      apiKey: process.env.RESEND_API_KEY || process.env.TRIPKOACH_RESEND_API_KEY,
      from: process.env.EMAIL_FROM || process.env.TRIPKOACH_EMAIL_FROM,
      replyTo: process.env.EMAIL_REPLY_TO || process.env.TRIPKOACH_EMAIL_REPLY_TO,
      dryRun: process.env.EMAIL_DRY_RUN === 'true',
      timeoutMs: num(process.env.EMAIL_TIMEOUT_MS) ?? 10_000,
    },
    notify: {
      // Strip any trailing slash so `${webBaseUrl}/bookings/REF` never doubles up.
      webBaseUrl: (process.env.WEB_BASE_URL || process.env.TRIPKOACH_WEB_BASE_URL || 'https://app.tripkoach.com').replace(/\/+$/, ''),
      reminderDaysBefore: num(process.env.REMINDER_DAYS_BEFORE) ?? 3,
    },
  };
}
