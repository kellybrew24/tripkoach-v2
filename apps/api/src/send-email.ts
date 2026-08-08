// TRI-880 P0 · Email send CLI — a real, one-shot ops deliverability check for the transport.
//
//   npm run send-email -- to@example.com          # sends the smoke_test template via Resend
//   EMAIL_DRY_RUN=true npm run send-email -- x@y   # renders + logs 'skipped', dispatches nothing
//
// Uses the same sendEmail() lib + send-log as every product flow will. DevOps runs this once after
// wiring RESEND_API_KEY / EMAIL_FROM on the box to confirm live delivery + DKIM/SPF alignment.
//
// Exit codes (for cron/monitor): 0 = 'sent' or 'skipped' (transport intentionally disabled);
// 1 = 'failed' (provider/network error — the send-log row records why) or a bad invocation.

import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { sendEmail, isEmailEnabled } from './email.ts';

const to = process.argv[2] || process.env.EMAIL_SMOKE_TO;
if (!to) {
  console.error('[send-email] usage: npm run send-email -- <recipient@example.com>  (or set EMAIL_SMOKE_TO)');
  process.exit(1);
}

const cfg = loadConfig();
const db = await createDb(cfg);
try {
  const stamp = new Date().toISOString();
  const ref = `SMOKE-${stamp.replace(/[^0-9]/g, '').slice(0, 14)}`;
  console.log(`[send-email] ${stamp} provider=${cfg.email.providerName} enabled=${isEmailEnabled(cfg.email)} from=${cfg.email.from ?? '(unset)'} to=${to}`);
  const result = await sendEmail(db, cfg, {
    to,
    template: 'smoke_test',
    vars: { ref, to, env: cfg.env },
    relatedType: 'smoke',
    relatedId: ref,
  }, { log: (m) => console.log(m) });
  console.log(`[send-email] done status=${result.status} id=${result.id} providerMessageId=${result.providerMessageId ?? '—'}${result.error ? ` error="${result.error}"` : ''}`);
  process.exitCode = result.status === 'failed' ? 1 : 0;
} catch (e) {
  console.error(`[send-email] FATAL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
