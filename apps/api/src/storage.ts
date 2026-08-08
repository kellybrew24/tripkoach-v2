// TRI-918 · Object storage client for Cloudflare R2 (S3-compatible), fronted by cdn.tripkoach.com.
//
// Deliberately dependency-free — this service ships only fastify/pg/hash-wasm (see package.json), and the
// house style is to hand-roll crypto (TOTP, the QR encoder) rather than pull an SDK. So instead of the
// ~90-package @aws-sdk/client-s3 tree we sign a single PUT with AWS Signature V4 using node:crypto and
// send it with global fetch. That's all R2 needs to publish an object.
//
// Credentials come from the environment only (never code/logs/commits): the R2 token file the board
// supplied drops straight into the systemd EnvironmentFile — R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY. When any of those is missing the storage layer reports `enabled=false` and the
// media routes answer 503 (same safe-when-unconfigured posture as the email transport).

import { createHash, createHmac } from 'node:crypto';
import type { MediaConfig } from './config.ts';

export interface PutResult {
  /** Provider ETag (quoted hex) when returned. */
  etag: string | null;
}

export interface Storage {
  readonly enabled: boolean;
  /** PUT `body` at `key` in the bucket with the given content-type + cache-control. Throws on non-2xx. */
  put(key: string, body: Uint8Array, opts: { contentType: string; cacheControl?: string }): Promise<PutResult>;
}

const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();
const sha256hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

// RFC-3986 encode a single path segment (encodeURIComponent leaves !*'() — S3 wants those encoded too).
function encodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// yyyymmddThhmmssZ + yyyymmdd, both UTC, derived from one instant.
function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260808T101530Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function createStorage(cfg: MediaConfig): Storage {
  const enabled = cfg.enabled;

  async function put(key: string, body: Uint8Array, opts: { contentType: string; cacheControl?: string }): Promise<PutResult> {
    if (!enabled) throw new Error('storage is not configured (missing R2 credentials)');
    const endpoint = cfg.endpoint!;
    const url = new URL(endpoint);
    const host = url.host;
    // Path-style addressing: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
    const canonicalUri = '/' + [cfg.bucket!, ...key.split('/')].map(encodeSegment).join('/');
    const requestUrl = `${url.protocol}//${host}${canonicalUri}`;

    const { amzDate, dateStamp } = amzDates(new Date());
    const payloadHash = sha256hex(body);
    const cacheControl = opts.cacheControl ?? cfg.cacheControl;

    // Signed headers (sorted by lowercased name). We sign exactly what we send below.
    const headers: Record<string, string> = {
      'cache-control': cacheControl,
      'content-type': opts.contentType,
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const signedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h].trim()}\n`).join('');
    const signedHeadersStr = signedHeaders.join(';');

    const canonicalRequest = [
      'PUT', canonicalUri, '', canonicalHeaders, signedHeadersStr, payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

    const kDate = hmac('AWS4' + cfg.secretAccessKey!, dateStamp);
    const kRegion = hmac(kDate, cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    let res: Response;
    try {
      res = await fetch(requestUrl, {
        method: 'PUT',
        headers: {
          'Cache-Control': cacheControl,
          'Content-Type': opts.contentType,
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
          Authorization: authorization,
        },
        body,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // R2 returns an XML error body; surface a trimmed hint but never the credentials.
      const text = await res.text().catch(() => '');
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? '';
      throw new Error(`R2 PUT failed: ${res.status} ${res.statusText}${code ? ` (${code})` : ''}`);
    }
    return { etag: res.headers.get('etag') };
  }

  return { enabled, put };
}
