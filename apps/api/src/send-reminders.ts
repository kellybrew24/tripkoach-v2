// TRI-889 P5.2 · Departure-reminder cron entrypoint. Invoke once/day (DevOps installs the cron alongside
// the FX + expire-holds crons):
//
//   npm run send-reminders          # from apps/api, uses DATABASE_URL from the environment
//   node --experimental-strip-types src/send-reminders.ts
//
// Emails a departure reminder to every PAID booking whose departure is REMINDER_DAYS_BEFORE days out
// (default 3). Idempotent within a day (skips bookings already reminded today). Inert where the email
// transport is unconfigured (RESEND_API_KEY / EMAIL_FROM unset) — every send logs 'skipped', exit 0.
//
// Exit codes (for cron/monitor alerting): 0 = ran cleanly (any sends dispatched or skipped); 1 = one or
// more sends hit a provider/transport FAILURE (surfaced so ops can investigate deliverability).

import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { createNotificationService } from './notifications.ts';

const cfg = loadConfig();
const db = await createDb(cfg);
try {
  const stamp = new Date().toISOString();
  console.log(`[send-reminders] ${stamp} daysBefore=${cfg.notify.reminderDaysBefore} webBase=${cfg.notify.webBaseUrl}`);
  const notifier = createNotificationService(db, cfg, { log: (m) => console.log(m) });
  const res = await notifier.sendDepartureReminders({ log: (m) => console.log(m) });
  console.log(`[send-reminders] done target=${res.target} matched=${res.matched} sent=${res.sent} skipped=${res.skipped} failed=${res.failed}`);
  process.exitCode = res.failed > 0 ? 1 : 0;
} catch (e) {
  // sendDepartureReminders swallows its own errors, so this only fires on a bootstrap failure (e.g. DB down).
  console.error(`[send-reminders] FATAL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
