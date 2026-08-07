// Paystack client (TEST-only in this slice). Thin wrapper over the two calls the booking flow needs:
// transaction/initialize and transaction/verify. Amounts are sent in GHS pesewas (integer minor units).
// The interface is injectable so the smoke test can stub the HTTP — no network in CI.
//
// Docs: https://paystack.com/docs/api/transaction/ · currency 'GHS', amount in the subunit (pesewas).

import type { PaystackConfig } from './config.ts';

export interface PaystackInitRequest {
  email: string;
  /** Amount in GHS pesewas (integer). */
  amountMinor: number;
  reference: string;
  currency?: string;             // 'GHS'
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];           // e.g. ['card','mobile_money']
}
export interface PaystackInitResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}
export interface PaystackVerifyResult {
  status: string;                // Paystack txn status: 'success' | 'failed' | 'abandoned' | ...
  reference: string;
  amountMinor: number;           // pesewas
  currency: string;
  providerRef: string;           // Paystack transaction id (data.id) as string
  raw: unknown;                  // full data payload
}

export interface PaystackClient {
  initialize(req: PaystackInitRequest): Promise<PaystackInitResult>;
  verify(reference: string): Promise<PaystackVerifyResult>;
}

export class PaystackError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'PaystackError';
    this.status = status;
  }
}

// Real HTTP client (production / TEST-key E2E). Uses global fetch (Node 20+).
export function createPaystackClient(cfg: PaystackConfig): PaystackClient {
  function auth(): string {
    if (!cfg.secretKey) throw new PaystackError('Paystack secret key not configured', 503);
    return `Bearer ${cfg.secretKey}`;
  }
  async function call(path: string, init: RequestInit): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: auth(), 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    } catch (e) {
      throw new PaystackError(`Paystack network error: ${(e as Error).message}`, 502);
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.status === false) {
      throw new PaystackError(body?.message || `Paystack HTTP ${res.status}`, res.ok ? 502 : res.status);
    }
    return body.data;
  }

  return {
    async initialize(req) {
      const data = await call('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email: req.email,
          amount: req.amountMinor,
          reference: req.reference,
          currency: req.currency ?? 'GHS',
          callback_url: req.callbackUrl,
          metadata: req.metadata,
          channels: req.channels,
        }),
      });
      return {
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
        reference: data.reference,
      };
    },
    async verify(reference) {
      const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
      return {
        status: data.status,
        reference: data.reference,
        amountMinor: Number(data.amount),
        currency: data.currency,
        providerRef: String(data.id),
        raw: data,
      };
    },
  };
}
