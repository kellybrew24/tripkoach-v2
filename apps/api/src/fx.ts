// TRI-873 Phase 4 · Automated daily USD→GHS FX refresh.
//
// A cron (`npm run fx-refresh`, see fx-refresh.ts) calls refreshFxRate() once/day. It fetches the
// mid-market USD→GHS rate from an env-configurable provider (default: exchangerate-api.com's free,
// no-key open endpoint), applies FX_BUFFER_PCT, and writes the EFFECTIVE rate into
// `settings.usd_to_ghs_charge_rate`. The payment path is unchanged: booking.ts resolveChargeRate keeps
// its precedence (env PAYSTACK_USD_TO_GHS_RATE → settings.usd_to_ghs_charge_rate → display), so in prod
// (no env override set) the automated value drives every charge with zero code change to checkout.
//
// GUARDS (all required):
//   1. Sanity bounds — reject a fetch deviating > FX_MAX_DEVIATION_PCT from last-known-good; keep LKG.
//   2. Fallback     — on fetch failure / out-of-bounds, retain last-known-good. Never write 0/crash.
//   3. Override      — PAYSTACK_USD_TO_GHS_RATE env pins the rate (ops kill-switch); refresh records it
//                      as 'override' and does NOT touch settings (env already wins at runtime).
//   4. Persistence   — every attempt is written to fx_rate_history (source, fetched_at, raw, buffer,
//                      effective, status, note) for audit + last-known-good lookup.
// Every run logs its outcome (which guard tripped) to stdout so the cron captures it.

import type { Db } from './db.ts';
import type { Config, FxConfig } from './config.ts';

export type FxStatus = 'ok' | 'out_of_bounds' | 'fetch_failed' | 'override';

export interface FxRefreshResult {
  status: FxStatus;
  source: string;
  rawRate: number | null;        // mid-market GHS-per-USD as fetched (null on fetch_failed)
  bufferPct: number;
  effectiveRate: number | null;  // rate written to settings on 'ok'/'override'; null when a guard kept LKG
  appliedRate: number;           // the rate now in force for charges (settings/override), for logging
  lastKnownGood: number | null;
  note: string;
}

// ── Provider: fetch the mid-market rate for cfg.fx.targetCurrency ────────────────────────────
// Injectable so smoke/tests never hit the network. Default impl reads the exchangerate-api.com
// open endpoint shape: { result: 'success', base_code: 'USD', rates: { GHS: <number>, … } }.
export interface FxProvider {
  fetchRate(): Promise<{ rate: number; source: string }>;
}

export function createFxProvider(fx: FxConfig): FxProvider {
  return {
    async fetchRate() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fx.timeoutMs);
      let res: Response;
      try {
        res = await fetch(fx.providerUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } catch (e) {
        throw new Error(`FX provider network error: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`FX provider HTTP ${res.status}`);
      const body: any = await res.json().catch(() => null);
      if (!body) throw new Error('FX provider returned non-JSON body');
      // Tolerate a couple of common shapes; exchangerate-api open endpoint reports result:'success'.
      if (body.result && body.result !== 'success') {
        throw new Error(`FX provider result=${body.result}${body['error-type'] ? ` (${body['error-type']})` : ''}`);
      }
      const rates = body.rates ?? body.conversion_rates;
      const rate = rates ? Number(rates[fx.targetCurrency]) : NaN;
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`FX provider missing/invalid ${fx.targetCurrency} rate`);
      }
      return { rate, source: fx.providerName };
    },
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// Most recent successfully-applied effective rate (last-known-good). On the very first run there is
// no history → seed from settings.usd_to_ghs_charge_rate (the migration default is 15.6).
async function lastKnownGood(db: Db): Promise<{ rate: number; raw: number | null } | null> {
  const hist = await db.query<{ effective_rate: string; raw_rate: string | null }>(
    `SELECT effective_rate, raw_rate FROM fx_rate_history WHERE status = 'ok'
     ORDER BY fetched_at DESC LIMIT 1`);
  if (hist.rows[0]) {
    return { rate: Number(hist.rows[0].effective_rate), raw: hist.rows[0].raw_rate != null ? Number(hist.rows[0].raw_rate) : null };
  }
  const set = await db.query<{ charge: string | null }>(
    `SELECT usd_to_ghs_charge_rate AS charge FROM settings WHERE singleton = true`);
  const charge = set.rows[0]?.charge != null ? Number(set.rows[0].charge) : NaN;
  return Number.isFinite(charge) && charge > 0 ? { rate: charge, raw: null } : null;
}

async function record(
  db: Db, r: { source: string; rawRate: number | null; bufferPct: number; effectiveRate: number | null; status: FxStatus; note: string },
): Promise<void> {
  await db.query(
    `INSERT INTO fx_rate_history (source, raw_rate, buffer_pct, effective_rate, status, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [r.source, r.rawRate, r.bufferPct, r.effectiveRate, r.status, r.note]);
}

async function currentChargeRate(db: Db): Promise<number> {
  const { rows } = await db.query<{ charge: string | null }>(
    `SELECT usd_to_ghs_charge_rate AS charge FROM settings WHERE singleton = true`);
  const c = rows[0]?.charge != null ? Number(rows[0].charge) : NaN;
  return Number.isFinite(c) ? c : 0;
}

export interface RefreshOptions {
  provider?: FxProvider;
  log?: (m: string) => void;
}

/**
 * Run one FX refresh cycle. Returns the outcome; NEVER throws for an expected guard trip
 * (fetch failure / out-of-bounds / override) — the DB is left in a safe state (last-known-good kept).
 */
export async function refreshFxRate(db: Db, cfg: Config, opts: RefreshOptions = {}): Promise<FxRefreshResult> {
  const fx = cfg.fx;
  const log = opts.log ?? (() => {});
  const provider = opts.provider ?? createFxProvider(fx);
  const bufferPct = fx.bufferPct;

  // GUARD 3 — override kill-switch. When ops pin PAYSTACK_USD_TO_GHS_RATE, that env wins at runtime
  // regardless of settings, so we DON'T touch settings; we only record that the override is in force.
  const override = cfg.paystack.chargeRateOverride;
  if (override != null) {
    const note = `PAYSTACK_USD_TO_GHS_RATE override in force (=${override}); settings untouched`;
    await record(db, { source: 'env_override', rawRate: null, bufferPct: 0, effectiveRate: override, status: 'override', note });
    log(`[fx] override active: charge rate pinned to ${override} via PAYSTACK_USD_TO_GHS_RATE — no fetch`);
    return { status: 'override', source: 'env_override', rawRate: null, bufferPct: 0, effectiveRate: override, appliedRate: override, lastKnownGood: null, note };
  }

  const lkg = await lastKnownGood(db);

  // Fetch mid-market rate.
  let fetched: { rate: number; source: string };
  try {
    fetched = await provider.fetchRate();
  } catch (e) {
    // GUARD 2 — fallback. Keep last-known-good; never write 0. Record + alert.
    const note = `fetch failed: ${(e as Error).message}; retained last-known-good ${lkg?.rate ?? 'NONE'}`;
    await record(db, { source: fx.providerName, rawRate: null, bufferPct, effectiveRate: null, status: 'fetch_failed', note });
    const applied = await currentChargeRate(db);
    log(`[fx] FETCH_FAILED — ${note}. Charge rate stays ${applied}. ALERT.`);
    return { status: 'fetch_failed', source: fx.providerName, rawRate: null, bufferPct, effectiveRate: null, appliedRate: applied, lastKnownGood: lkg?.rate ?? null, note };
  }

  const rawRate = round6(fetched.rate);
  const effectiveRate = round6(rawRate * (1 + bufferPct / 100));

  // GUARD 1 — sanity bounds. Compare the mid-market fetch to the last-known-good mid-market (or, if we
  // only have an effective LKG from settings seed, back it out by the buffer). Skip on first run.
  if (lkg) {
    const lkgRaw = lkg.raw ?? round6(lkg.rate / (1 + bufferPct / 100));
    const deviation = Math.abs(rawRate - lkgRaw) / lkgRaw * 100;
    if (deviation > fx.maxDeviationPct) {
      const note = `fetched ${rawRate} deviates ${deviation.toFixed(2)}% from last-known-good ${lkgRaw} (max ${fx.maxDeviationPct}%); kept last-known-good`;
      await record(db, { source: fetched.source, rawRate, bufferPct, effectiveRate: null, status: 'out_of_bounds', note });
      const applied = await currentChargeRate(db);
      log(`[fx] OUT_OF_BOUNDS — ${note}. Charge rate stays ${applied}. ALERT.`);
      return { status: 'out_of_bounds', source: fetched.source, rawRate, bufferPct, effectiveRate: null, appliedRate: applied, lastKnownGood: lkg.rate, note };
    }
  }

  // Happy path — apply the effective rate to settings (drives charges via resolveChargeRate precedence).
  await db.query(
    `UPDATE settings SET usd_to_ghs_charge_rate = $1, updated_at = now() WHERE singleton = true`,
    [effectiveRate]);
  const note = lkg
    ? `applied ${effectiveRate} (mid ${rawRate} +${bufferPct}%), prev ${lkg.rate}`
    : `first run: applied ${effectiveRate} (mid ${rawRate} +${bufferPct}%), seeded from settings default`;
  await record(db, { source: fetched.source, rawRate, bufferPct, effectiveRate, status: 'ok', note });
  log(`[fx] OK — mid-market ${rawRate} +${bufferPct}% → charge rate ${effectiveRate} (source ${fetched.source})`);
  return { status: 'ok', source: fetched.source, rawRate, bufferPct, effectiveRate, appliedRate: effectiveRate, lastKnownGood: lkg?.rate ?? null, note };
}
