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
  };
}
