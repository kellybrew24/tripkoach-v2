// TRI-1124 (#5) · Mail-velocity gate — a uniform per-IP + per-target throttle for EVERY mail-triggering
// endpoint (password-reset, resend-verify, admin reset, booking-resend, review-request).
//
// WHY a dedicated gate rather than only @fastify/rate-limit (TRI-1054/1055/1063): that plugin throttles
// per-ROUTE with a SINGLE key (req.ip). Email-bombing needs a SECOND dimension — the *target* (the inbox
// being mailed) — so one attacker rotating IPs can't blast a single victim, and a compromised staff session
// can't resend-bomb one customer from inside the per-IP budget. This gate enforces BOTH keys with one shared
// policy, so coverage is uniform across public and authenticated mail paths. It sits ALONGSIDE the per-IP
// @fastify/rate-limit already on the public auth routes (defense in depth), not instead of it.
//
// Storage is a per-process in-memory sliding window — correct for the single API instance (same model as
// TRI-1054's in-memory login limiter). No DB, no dependency. Inert under `test` so smoke/e2e can loop freely.

import type { Config } from './config.ts';
import { maskEmail } from './util.ts';

/** Thrown when a velocity budget is exhausted. statusCode 429 so the realms' setErrorHandler maps it to the
 *  shared { error: { code: 'rate_limited', ... } } envelope (same shape @fastify/rate-limit produces). */
export class RateLimitError extends Error {
  statusCode = 429;
  code = 'rate_limited';
  constructor(message = 'Too many requests. Please wait a bit and try again.') { super(message); }
}

interface GatePolicy {
  windowMs: number;   // sliding window length
  ipMax: number;      // max mail triggers per IP per window
  targetMax: number;  // max mail triggers per target (inbox/resource) per window
  /** Global rolling send-volume threshold: when total triggers in the window exceed this, log an ALERT
   *  (a cheap Resend-spend/abuse tripwire — TRI-1107 flagged the missing velocity alarm). */
  alertVolume: number;
}

function num(v: string | undefined, d: number): number {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export function mailGatePolicy(): GatePolicy {
  return {
    windowMs: num(process.env.MAIL_RATE_WINDOW_MS, 15 * 60 * 1000),  // 15 min
    ipMax: num(process.env.MAIL_RATE_IP_MAX, 20),
    targetMax: num(process.env.MAIL_RATE_TARGET_MAX, 5),
    alertVolume: num(process.env.MAIL_RATE_ALERT_VOLUME, 200),
  };
}

export interface MailGate {
  /** Record + check one mail-trigger. Throws RateLimitError when the IP OR the target budget is exhausted.
   *  `now` is injectable for deterministic tests. A null/absent key skips that dimension (e.g. no IP). */
  check(input: { ip?: string | null; target?: string | null }, now?: number): void;
  /** Test/introspection helper: current counts for a key set. */
  __peek?(): { ipKeys: number; targetKeys: number };
}

/** Build the shared gate. `log` receives the volume ALERT line. Disabled (no-op) under `test`. */
export function createMailGate(cfg: Config, log: (m: string) => void = () => {}): MailGate {
  if (cfg.env === 'test') {
    return { check: () => {}, __peek: () => ({ ipKeys: 0, targetKeys: 0 }) };
  }
  const policy = mailGatePolicy();
  const ipHits = new Map<string, number[]>();
  const targetHits = new Map<string, number[]>();
  const volume: number[] = [];
  let lastAlert = 0;

  // Drop timestamps older than the window; returns the surviving list length after appending `now`.
  function bump(store: Map<string, number[]>, key: string, now: number): number {
    const cutoff = now - policy.windowMs;
    const arr = (store.get(key) ?? []).filter((t) => t > cutoff);
    arr.push(now);
    store.set(key, arr);
    return arr.length;
  }

  // Opportunistic prune so idle keys don't accumulate unbounded across a long-lived process.
  function prune(now: number): void {
    const cutoff = now - policy.windowMs;
    for (const [k, arr] of ipHits) { const f = arr.filter((t) => t > cutoff); if (f.length) ipHits.set(k, f); else ipHits.delete(k); }
    for (const [k, arr] of targetHits) { const f = arr.filter((t) => t > cutoff); if (f.length) targetHits.set(k, f); else targetHits.delete(k); }
  }

  return {
    check({ ip, target }, now = Date.now()) {
      // Normalise the target so "A@B.com" and "a@b.com " share a bucket. Non-email targets (resource ids
      // like "booking:REF") are used verbatim.
      const tgt = target ? (target.includes('@') ? target.trim().toLowerCase() : target) : null;

      if (tgt) {
        const n = bump(targetHits, tgt, now);
        if (n > policy.targetMax) {
          throw new RateLimitError('Too many messages requested for this recipient. Please wait a few minutes.');
        }
      }
      if (ip) {
        const n = bump(ipHits, ip, now);
        if (n > policy.ipMax) {
          throw new RateLimitError('Too many email requests from your network. Please wait a few minutes.');
        }
      }

      // Global volume tripwire (rolling window). Rate-limited to one ALERT per window so logs don't flood.
      const cutoff = now - policy.windowMs;
      while (volume.length && volume[0] <= cutoff) volume.shift();
      volume.push(now);
      if (volume.length > policy.alertVolume && now - lastAlert > policy.windowMs) {
        lastAlert = now;
        log(`[mail-gate] ALERT: ${volume.length} mail triggers in the last ${Math.round(policy.windowMs / 60000)}min (threshold ${policy.alertVolume}). Possible abuse/Resend spend spike. last target=${maskEmail(tgt)}`);
      }
      if (ipHits.size + targetHits.size > 5000) prune(now);
    },
    __peek: () => ({ ipKeys: ipHits.size, targetKeys: targetHits.size }),
  };
}
