// TRI-880 P0 · Email template renderer.
//
// A tiny, dependency-free renderer: templates are plain strings with `{{ token }}` placeholders. Each
// registered template supplies a `subject`, `html`, and `text` body. renderTemplate() interpolates the
// caller's vars into all three, HTML-escaping values in the html body (so caller data can never inject
// markup) and leaving the text/subject raw. A referenced token with no matching var throws — a bug in
// the caller or template surfaces loudly at render time, never as a half-filled email.
//
// Templates registered here:
//   • smoke_test / booking_pending (TRI-880) — the transport-slice pair; `booking_pending` is a
//     parametrised version of the DS `ui_kits/email/confirmation-email.html`.
//   • booking_confirmed / booking_cancelled / payment_failed / departure_reminder (TRI-889 P5.2) —
//     the booking-lifecycle variants, wired to their flows by src/notifications.ts. Each reuses the
//     booking_pending layout with a distinct eyebrow/status colour/copy for its lifecycle moment.
// Other notify features (P1 password reset, P2 review invites, P3 staff invites) register their own
// templates here and call sendEmail() when those slices are built.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateVars = Record<string, unknown>;

interface TemplateDef {
  subject: string;
  html: string;
  text: string;
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** HTML-escape a value for safe interpolation into an html body. */
function escapeHtml(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replace every `{{ token }}` in `tpl` with vars[token]. Missing keys throw (with the field + template
 * context). `escape` HTML-escapes each substituted value — always true for html bodies, false for
 * plain-text bodies and subjects.
 */
export function interpolate(tpl: string, vars: TemplateVars, opts: { escape: boolean; where?: string } = { escape: false }): string {
  return tpl.replace(TOKEN, (_m, key: string) => {
    if (!(key in vars) || vars[key] == null) {
      throw new Error(`email template${opts.where ? ` "${opts.where}"` : ''}: missing var "${key}"`);
    }
    const raw = vars[key];
    return opts.escape ? escapeHtml(raw) : String(raw);
  });
}

// ── Template registry ───────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  // Neutral connectivity/verification email — used by the send smoke path (npm run send-email) and the
  // automated smoke. Not a product email; safe to send to an internal address to prove delivery.
  smoke_test: {
    subject: 'TripKoach email transport check — {{ref}}',
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F1EDE6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2B2724">
  <table role="presentation" align="center" width="600" style="width:600px;max-width:100%;background:#fff;border-radius:14px;overflow:hidden">
    <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Transport check</td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 8px;font-size:22px;color:#1E1C1A">Email transport is live</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55">This is an automated deliverability check from the TripKoach API email transport (TRI-880).</p>
      <p style="margin:0;font-size:14px;color:#6F675E">Reference: <strong>{{ref}}</strong><br>Sent to: {{to}}<br>Environment: {{env}}</p>
    </td></tr>
    <tr><td style="background:#1E1C1A;padding:16px 28px;color:#A8A096;font-size:12px">TripKoach Ghana Ltd · Accra · automated message, no reply needed.</td></tr>
  </table>
</body></html>`,
    text: `TripKoach email transport check
================================

This is an automated deliverability check from the TripKoach API email transport (TRI-880).

Reference: {{ref}}
Sent to:   {{to}}
Environment: {{env}}

TripKoach Ghana Ltd · Accra · automated message, no reply needed.`,
  },

  // Parametrised from design-system/ui_kits/email/confirmation-email.html (booking-created / pending).
  // Registered to prove the renderer handles a real transactional layout. NOT wired to booking yet —
  // the P5 booking-email slice owns wiring this (and any subject/copy refinements) to sendEmail().
  booking_pending: {
    subject: 'Your TripKoach booking {{ref}} — spot reserved',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your TripKoach booking {{ref}}</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Booking received</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">Your spot is reserved, {{firstName}}</h1>
    <p style="margin:0;font-size:16px;line-height:1.55">We are holding {{travellers}} spot(s) on the {{tourTitle}} for {{departureLabel}}.</p>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0">
    <table role="presentation" width="100%" style="border:1px solid #E4DFD6;border-radius:10px">
      <tr><td style="padding:14px 16px;border-bottom:1px solid #F1EDE6">
        <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#6F675E;font-weight:700">Booking reference</div>
        <div style="font-size:20px;font-weight:800;letter-spacing:.06em;color:#1E1C1A;margin-top:2px">{{ref}}</div>
      </td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Tour</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{tourTitle}}</span></td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Departure</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{departureLabel}}</span></td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Travellers</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{travellers}}</span></td></tr>
      <tr><td style="padding:13px 16px;background:#F8F5F0;font-size:16px"><strong>Total due</strong><span style="float:right;font-weight:800;font-size:18px">{{totalDisplay}}</span><div style="clear:both"></div><div class="mut" style="margin-top:4px">Charged in US dollars. Final quote confirmed by your koach.</div></td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 0"><a class="btn" href="{{manageUrl}}">View this booking</a></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra · Prices in US dollars (USD)</p></td></tr>
</table>
</body></html>`,
    text: `Your spot is reserved, {{firstName}}

We are holding {{travellers}} spot(s) on the {{tourTitle}} for {{departureLabel}}.

Booking reference: {{ref}}
Tour: {{tourTitle}}
Departure: {{departureLabel}}
Travellers: {{travellers}}
Total due: {{totalDisplay}} (charged in US dollars — final quote confirmed by your koach)

View this booking: {{manageUrl}}

TripKoach Ghana Ltd · Accra · Prices in US dollars (USD)`,
  },

  // ── TRI-889 P5.2 booking-lifecycle variants ──────────────────────────────────────────────────
  // All four share the booking_pending layout (parametrised from ui_kits/email/confirmation-email.html):
  // dark header eyebrow + hero line + a details card + a CTA + dark footer. Each carries a distinct
  // eyebrow / status colour / copy for its lifecycle moment. Wired to flows by src/notifications.ts.

  // booking-confirmed — payment succeeded (webhook verify → paid). The receipt/"you're going" moment.
  booking_confirmed: {
    subject: 'Booking {{ref}} confirmed — you’re going to {{tourTitle}}',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Booking {{ref}} confirmed</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Booking confirmed</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">You’re going, {{firstName}} — it’s confirmed</h1>
    <p style="margin:0;font-size:16px;line-height:1.55">Payment received. Your {{travellers}} spot(s) on the {{tourTitle}} for {{departureLabel}} are locked in.</p>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0">
    <table role="presentation" width="100%" style="background:#EEF6EE;border:1px solid #BEE0BE;border-radius:10px">
      <tr><td style="padding:14px 16px">
        <span style="display:inline-block;background:#EEF6EE;border:1px solid #BEE0BE;color:#1E6B33;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px">● Confirmed &amp; paid</span>
        <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#1E6B33">We’ve emailed this as your receipt. Your guide will call the day before with pickup details.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0">
    <table role="presentation" width="100%" style="border:1px solid #E4DFD6;border-radius:10px">
      <tr><td style="padding:14px 16px;border-bottom:1px solid #F1EDE6">
        <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#6F675E;font-weight:700">Booking reference</div>
        <div style="font-size:20px;font-weight:800;letter-spacing:.06em;color:#1E1C1A;margin-top:2px">{{ref}}</div>
      </td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Tour</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{tourTitle}}</span></td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Departure</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{departureLabel}}</span></td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Travellers</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{travellers}}</span></td></tr>
      <tr><td style="padding:13px 16px;background:#F8F5F0;font-size:16px"><strong>Total paid</strong><span style="float:right;font-weight:800;font-size:18px">{{totalDisplay}}</span><div style="clear:both"></div></td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 0"><a class="btn" href="{{manageUrl}}">View this booking</a></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra · Prices in US dollars (USD)</p></td></tr>
</table>
</body></html>`,
    text: `You're going, {{firstName}} — booking {{ref}} is confirmed.

Payment received. Your {{travellers}} spot(s) on the {{tourTitle}} for {{departureLabel}} are locked in.

Booking reference: {{ref}}
Tour: {{tourTitle}}
Departure: {{departureLabel}}
Travellers: {{travellers}}
Total paid: {{totalDisplay}}

Your guide will call the day before with pickup details.
View this booking: {{manageUrl}}

TripKoach Ghana Ltd · Accra · Prices in US dollars (USD)`,
  },

  // booking-cancelled — admin/booking cancel. {{reason}} is always supplied (caller passes a phrase or '').
  booking_cancelled: {
    subject: 'Your TripKoach booking {{ref}} has been cancelled',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Booking {{ref}} cancelled</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Booking cancelled</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">Your booking has been cancelled, {{firstName}}</h1>
    <p style="margin:0;font-size:16px;line-height:1.55">Booking {{ref}} for the {{tourTitle}} ({{departureLabel}}) is now cancelled and any held spots have been released.{{reason}}</p>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0">
    <table role="presentation" width="100%" style="border:1px solid #E4DFD6;border-radius:10px">
      <tr><td style="padding:14px 16px;border-bottom:1px solid #F1EDE6">
        <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#6F675E;font-weight:700">Booking reference</div>
        <div style="font-size:20px;font-weight:800;letter-spacing:.06em;color:#1E1C1A;margin-top:2px">{{ref}}</div>
      </td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Tour</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{tourTitle}}</span></td></tr>
      <tr><td style="padding:11px 16px;font-size:14px"><span style="color:#6F675E">Departure</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{departureLabel}}</span></td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 0"><a class="btn" href="{{manageUrl}}">Book another date</a></td></tr>
  <tr><td class="pad" style="padding:18px 28px 0"><p class="mut" style="margin:0">If you were charged, any refund is handled separately by our team. Reply to this email or call 024 555 0100 (Mon–Sat, 8am–6pm GMT) with any questions.</p></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra</p></td></tr>
</table>
</body></html>`,
    text: `Your booking has been cancelled, {{firstName}}.

Booking {{ref}} for the {{tourTitle}} ({{departureLabel}}) is now cancelled and any held spots have been released.{{reason}}

Booking reference: {{ref}}
Tour: {{tourTitle}}
Departure: {{departureLabel}}

If you were charged, any refund is handled separately by our team.
Book another date: {{manageUrl}}

TripKoach Ghana Ltd · Accra`,
  },

  // payment-failed — a Paystack charge failed/abandoned. Nudge to retry; the seat hold may still be live.
  payment_failed: {
    subject: 'Payment didn’t go through for booking {{ref}}',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment issue — booking {{ref}}</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Payment not completed</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">We couldn’t process your payment, {{firstName}}</h1>
    <p style="margin:0;font-size:16px;line-height:1.55">Your payment for the {{tourTitle}} ({{departureLabel}}) didn’t go through. Your spots aren’t confirmed yet — you can try again below.</p>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0">
    <table role="presentation" width="100%" style="background:#FDECEC;border:1px solid #F2C4C4;border-radius:10px">
      <tr><td style="padding:14px 16px">
        <span style="display:inline-block;background:#FDECEC;border:1px solid #F2C4C4;color:#A32222;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px">● Payment failed</span>
        <p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#A32222">No charge was taken. Amount outstanding: <strong>{{totalDisplay}}</strong>.</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0">
    <table role="presentation" width="100%" style="border:1px solid #E4DFD6;border-radius:10px">
      <tr><td style="padding:14px 16px;border-bottom:1px solid #F1EDE6">
        <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#6F675E;font-weight:700">Booking reference</div>
        <div style="font-size:20px;font-weight:800;letter-spacing:.06em;color:#1E1C1A;margin-top:2px">{{ref}}</div>
      </td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Tour</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{tourTitle}}</span></td></tr>
      <tr><td style="padding:11px 16px;font-size:14px"><span style="color:#6F675E">Departure</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{departureLabel}}</span></td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 0"><a class="btn" href="{{manageUrl}}">Try payment again</a></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra · Prices in US dollars (USD)</p></td></tr>
</table>
</body></html>`,
    text: `We couldn't process your payment, {{firstName}}.

Your payment for the {{tourTitle}} ({{departureLabel}}) didn't go through, so your spots aren't confirmed yet. No charge was taken.

Booking reference: {{ref}}
Tour: {{tourTitle}}
Departure: {{departureLabel}}
Amount outstanding: {{totalDisplay}}

Try payment again: {{manageUrl}}

TripKoach Ghana Ltd · Accra · Prices in US dollars (USD)`,
  },

  // departure-reminder — cron, N days before a paid booking's departure. {{daysLabel}} e.g. "in 3 days".
  departure_reminder: {
    subject: 'Your {{tourTitle}} departs {{departureLabel}} — see you soon',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reminder — {{tourTitle}} {{departureLabel}}</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Departure reminder</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">Your trip departs {{daysLabel}}, {{firstName}}</h1>
    <p style="margin:0;font-size:16px;line-height:1.55">Your {{tourTitle}} sets off {{departureLabel}}. Here’s a quick reminder so you’re ready.</p>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0">
    <table role="presentation" width="100%" style="border:1px solid #E4DFD6;border-radius:10px">
      <tr><td style="padding:14px 16px;border-bottom:1px solid #F1EDE6">
        <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#6F675E;font-weight:700">Booking reference</div>
        <div style="font-size:20px;font-weight:800;letter-spacing:.06em;color:#1E1C1A;margin-top:2px">{{ref}}</div>
      </td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Tour</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{tourTitle}}</span></td></tr>
      <tr><td style="padding:11px 16px;border-bottom:1px solid #F1EDE6;font-size:14px"><span style="color:#6F675E">Departure</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{departureLabel}}</span></td></tr>
      <tr><td style="padding:11px 16px;font-size:14px"><span style="color:#6F675E">Travellers</span><span style="float:right;font-weight:600;color:#1E1C1A;text-align:right">{{travellers}}</span></td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:20px 28px 0"><p class="mut" style="margin:0">Bring a valid ID, comfortable shoes, water and sun protection. Your guide will call the day before with exact pickup details.</p></td></tr>
  <tr><td class="pad" style="padding:18px 28px 0"><a class="btn" href="{{manageUrl}}">View your booking</a></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra</p></td></tr>
</table>
</body></html>`,
    text: `Your trip departs {{daysLabel}}, {{firstName}}.

Your {{tourTitle}} sets off {{departureLabel}}. A quick reminder so you're ready.

Booking reference: {{ref}}
Tour: {{tourTitle}}
Departure: {{departureLabel}}
Travellers: {{travellers}}

Bring a valid ID, comfortable shoes, water and sun protection. Your guide will call the day before with exact pickup details.

View your booking: {{manageUrl}}

TripKoach Ghana Ltd · Accra`,
  },

  // TRI-881 P1 · Consumer password reset (audit gap C10, web:ForgotWeb 4-stage flow). Sent by
  // consumer.requestPasswordReset() with { firstName, resetUrl, ttlMinutes }. The link carries the
  // single-use token; the FE reset page POSTs /auth/password-reset/consume with it.
  password_reset: {
    subject: 'Reset your TripKoach password',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset your TripKoach password</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Password reset</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">Reset your password, {{firstName}}</h1>
    <p style="margin:0 0 4px;font-size:16px;line-height:1.55">We received a request to reset the password on your TripKoach account. Tap the button below to choose a new one.</p>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 4px"><a class="btn" href="{{resetUrl}}">Choose a new password</a></td></tr>
  <tr><td class="pad" style="padding:12px 28px 0"><p class="mut" style="margin:0">This link expires in {{ttlMinutes}} minutes and can be used once. If you didn't ask to reset your password, you can safely ignore this email — your password won't change.</p></td></tr>
  <tr><td class="pad" style="padding:16px 28px 4px"><p class="mut" style="margin:0;word-break:break-all">Button not working? Paste this link into your browser:<br>{{resetUrl}}</p></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra · automated message, no reply needed.</p></td></tr>
</table>
</body></html>`,
    text: `Reset your password, {{firstName}}

We received a request to reset the password on your TripKoach account.
Open this link to choose a new one:

{{resetUrl}}

This link expires in {{ttlMinutes}} minutes and can be used once. If you didn't ask
to reset your password, you can safely ignore this email — your password won't change.

TripKoach Ghana Ltd · Accra · automated message, no reply needed.`,
  },

  // TRI-941 · Email verification. Sent by consumer.issueVerificationEmail() on signup + resend with
  // { firstName, verifyUrl, ttlHours }. The link carries the single-use token; the FE /verify-email page
  // POSTs /auth/verify-email with it. Enforcement is SOFT — this only confirms the address for a badge.
  verify_email: {
    subject: 'Verify your TripKoach email',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify your TripKoach email</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Verify your email</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">Welcome to TripKoach, {{firstName}}</h1>
    <p style="margin:0 0 4px;font-size:16px;line-height:1.55">Confirm this is your email address so we can send you booking updates and secure your account. Tap the button below to verify.</p>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 4px"><a class="btn" href="{{verifyUrl}}">Verify my email</a></td></tr>
  <tr><td class="pad" style="padding:12px 28px 0"><p class="mut" style="margin:0">This link expires in {{ttlHours}} hours and can be used once. You can keep browsing and booking without verifying — this just confirms your address.</p></td></tr>
  <tr><td class="pad" style="padding:16px 28px 4px"><p class="mut" style="margin:0;word-break:break-all">Button not working? Paste this link into your browser:<br>{{verifyUrl}}</p></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra · automated message, no reply needed.</p></td></tr>
</table>
</body></html>`,
    text: `Welcome to TripKoach, {{firstName}}

Confirm this is your email address so we can send you booking updates and secure your account.
Open this link to verify:

{{verifyUrl}}

This link expires in {{ttlHours}} hours and can be used once. You can keep browsing and
booking without verifying — this just confirms your address.

TripKoach Ghana Ltd · Accra · automated message, no reply needed.`,
  },

  // TRI-892 P2 · Review-invite email. Sent by the admin "end departure & request reviews" action to each
  // traveller with a one-time {{reviewUrl}} carrying their invite token. The token gates a verified review
  // (status=pending until an admin moderates it). Vars: firstName, tourTitle, departureLabel, reviewUrl.
  review_invite: {
    subject: 'How was {{tourTitle}}? Leave {{firstName}} a review',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review your TripKoach experience</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Share your experience</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">How was it, {{firstName}}?</h1>
    <p style="margin:0;font-size:16px;line-height:1.55">Thanks for joining the <strong>{{tourTitle}}</strong> on {{departureLabel}}. Your honest review helps other travellers — it only takes a minute.</p>
  </td></tr>
  <tr><td class="pad" style="padding:24px 28px 0"><a class="btn" href="{{reviewUrl}}">Write your review</a></td></tr>
  <tr><td class="pad" style="padding:16px 28px 0"><p class="mut" style="margin:0">This link is personal to you and can be used once. If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all;color:#1E1C1A">{{reviewUrl}}</span></p></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px;margin-top:24px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra · You're receiving this because you travelled with us.</p></td></tr>
</table>
</body></html>`,
    text: `How was it, {{firstName}}?

Thanks for joining the {{tourTitle}} on {{departureLabel}}. Your honest review helps other travellers — it only takes a minute.

Write your review (personal, one-time link):
{{reviewUrl}}

TripKoach Ghana Ltd · Accra · You're receiving this because you travelled with us.`,
  },

  // TRI-895 P3 · Staff invite. Sent when an admin invites a colleague; the {{acceptUrl}} carries the
  // one-time opaque token to the accept screen where they set a password (and enable MFA).
  staff_invite: {
    subject: 'You have been invited to the TripKoach admin console',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your TripKoach console invite</title>
<style>
body{margin:0;padding:24px 0;background:#F1EDE6;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#2B2724}
table{border-collapse:collapse}.w{width:600px;max-width:100%}
a.btn{display:block;background:#1E1C1A;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:15px 20px;border-radius:10px;text-align:center}
.mut{color:#6F675E;font-size:13px;line-height:1.5}
@media (max-width:620px){.w{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}
</style></head>
<body>
<table role="presentation" align="center" class="w" style="background:#FFFFFF;border-radius:14px;overflow:hidden">
  <tr><td style="background:#1E1C1A;padding:20px 28px;color:#F1EDE6;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700">Console invitation</td></tr>
  <tr><td class="pad" style="padding:32px 28px 8px">
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;letter-spacing:-.02em;color:#1E1C1A">You're invited, {{name}}</h1>
    <p style="margin:0;font-size:16px;line-height:1.55">You have been added to the TripKoach admin console as <strong>{{role}}</strong>. Set your password to activate your account — you'll be prompted to turn on two-factor authentication.</p>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 0"><a class="btn" href="{{acceptUrl}}">Set your password</a></td></tr>
  <tr><td class="pad" style="padding:14px 28px 0"><p class="mut" style="margin:0">This invite link expires in {{expiryHours}} hours. If it has expired, ask an administrator to resend it. If you weren't expecting this, you can ignore this email.</p></td></tr>
  <tr><td style="background:#1E1C1A;padding:20px 28px;margin-top:20px"><p style="margin:0;color:#A8A096;font-size:12px;line-height:1.6">TripKoach Ghana Ltd · Accra · Staff console — do not share this link.</p></td></tr>
</table>
</body></html>`,
    text: `You're invited, {{name}}

You have been added to the TripKoach admin console as {{role}}. Set your password to
activate your account — you'll be prompted to turn on two-factor authentication.

Set your password: {{acceptUrl}}

This invite link expires in {{expiryHours}} hours. If it has expired, ask an administrator to
resend it. If you weren't expecting this, you can ignore this email.

TripKoach Ghana Ltd · Accra · Staff console — do not share this link.`,
  },
} satisfies Record<string, TemplateDef>;

export type TemplateName = keyof typeof TEMPLATES;

/** True if `name` is a registered template. */
export function isTemplate(name: string): name is TemplateName {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, name);
}

/** Registered template names (for tooling / smoke). */
export function listTemplates(): TemplateName[] {
  return Object.keys(TEMPLATES) as TemplateName[];
}

/**
 * Render a registered template with `vars` → { subject, html, text }. Throws on an unknown template
 * name (programmer error) or a missing var referenced by the template (bad call / stale template).
 */
export function renderTemplate(name: string, vars: TemplateVars): RenderedEmail {
  if (!isTemplate(name)) {
    throw new Error(`unknown email template "${name}" (known: ${listTemplates().join(', ')})`);
  }
  const def = TEMPLATES[name];
  return {
    subject: interpolate(def.subject, vars, { escape: false, where: `${name}.subject` }),
    html: interpolate(def.html, vars, { escape: true, where: `${name}.html` }),
    text: interpolate(def.text, vars, { escape: false, where: `${name}.text` }),
  };
}
