// TRI-880 P0 · Email template renderer.
//
// A tiny, dependency-free renderer: templates are plain strings with `{{ token }}` placeholders. Each
// registered template supplies a `subject`, `html`, and `text` body. renderTemplate() interpolates the
// caller's vars into all three, HTML-escaping values in the html body (so caller data can never inject
// markup) and leaving the text/subject raw. A referenced token with no matching var throws — a bug in
// the caller or template surfaces loudly at render time, never as a half-filled email.
//
// Scope (TRI-880): transport only. We register ONE neutral `smoke_test` template (used by the send
// smoke path) plus `booking_pending`, a parametrised version of the DS `ui_kits/email/confirmation-
// email.html`, to prove the renderer handles a real transactional template. NEITHER is wired into any
// product flow yet — the booking/departure/reset/invite emails (P1/P2/P3/P5) register their own
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
