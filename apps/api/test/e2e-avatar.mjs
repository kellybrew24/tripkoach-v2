// TRI-943 live E2E — real request round-trip against the running dev API (127.0.0.1:3020), incl. a REAL
// R2 upload (cdn.tripkoach.com) and an admin moderation-queue action. Run ON the dev box.
//   env: BASE (http://127.0.0.1:3020), MFA_SECRET (admin's confirmed mfa_factor.secret, base32)
import { totp } from '../src/totp.ts';

const BASE = process.env.BASE || 'http://127.0.0.1:3020';
const MFA_SECRET = process.env.MFA_SECRET;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : '  ← ' + extra}`); };

// A tiny 1×1 PNG (real magic bytes) — but make it unique per run so we get a fresh (non-deduped) R2 object.
const PNG_BASE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// Append a unique tEXt-ish tail so the sha differs each run (still a valid PNG — trailing bytes after IEND
// are ignored by decoders). Keeps the sniffer happy while defeating content-address dedupe.
const uniq = process.env.RUN_TAG || String(process.hrtime.bigint());
const PNG = Buffer.concat([PNG_BASE, Buffer.from(`\n#tri943-${uniq}`)]);

function cookieJar() {
  const jar = {};
  return {
    header: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    absorb: (res) => { const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []; for (const c of sc) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } },
  };
}
async function req(method, path, { jar, json, raw, ctype } = {}) {
  const headers = {};
  if (jar) headers.cookie = jar.header();
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  else if (raw) { headers['content-type'] = ctype || 'application/octet-stream'; body = raw; }
  const res = await fetch(BASE + path, { method, headers, body });
  if (jar) jar.absorb(res);
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, body: data };
}

const stamp = Date.now();
const emailA = `e2e-ava-${stamp}@example.com`;
const emailB = `e2e-rep-${stamp}@example.com`;

console.log('\n[TRI-943 live E2E — consumer avatar]');
const jarA = cookieJar(), jarB = cookieJar();
let sA = await req('POST', '/api/v1/auth/signup', { jar: jarA, json: { email: emailA, password: 'E2e-Str0ng!', name: 'E2E Ava' } });
ok('signup owner → 201', sA.status === 201, JSON.stringify(sA.body));
let sB = await req('POST', '/api/v1/auth/signup', { jar: jarB, json: { email: emailB, password: 'E2e-Str0ng!', name: 'E2E Rep' } });
ok('signup reporter → 201', sB.status === 201, JSON.stringify(sB.body));

// REAL upload → R2 → cdn URL, auto-approved.
const up = await req('POST', '/api/v1/me/avatar?filename=e2e.png', { jar: jarA, raw: PNG, ctype: 'image/png' });
ok('upload avatar → 200', up.status === 200, JSON.stringify(up.body));
ok('avatar auto-approved', up.body?.avatarStatus === 'approved', JSON.stringify(up.body));
ok('avatar url is a real cdn.tripkoach.com object', /^https:\/\/cdn\.tripkoach\.com\/media\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/.test(up.body?.avatarUrl || ''), up.body?.avatarUrl);

// The object is actually fetchable from the CDN (proves the R2 PUT round-tripped).
let cdnOk = false;
try { const r = await fetch(up.body.avatarUrl, { method: 'HEAD' }); cdnOk = r.ok; } catch {}
ok('avatar object is live on the CDN (HEAD 200)', cdnOk, up.body?.avatarUrl);

const meA = await req('GET', '/api/v1/me', { jar: jarA });
ok('/me exposes approved avatarUrl', meA.body?.user?.avatarStatus === 'approved' && meA.body?.user?.avatarUrl === up.body.avatarUrl);

// Reporter cannot report own; reports owner → auto-hidden.
const badTypes = await req('POST', '/api/v1/me/avatar', { jar: jarA, raw: Buffer.from('not-an-image'), ctype: 'image/png' });
ok('non-image bytes rejected → 415', badTypes.status === 415, JSON.stringify(badTypes.body));

const rep = await req('POST', `/api/v1/avatars/${sA.body.user.id}/report`, { jar: jarB, json: { reason: 'E2E inappropriate' } });
ok('report owner avatar → 200 hidden', rep.status === 200 && rep.body?.hidden === true, JSON.stringify(rep.body));
const meHidden = await req('GET', '/api/v1/me', { jar: jarA });
ok('/me hides avatarUrl after report (status=hidden)', meHidden.body?.user?.avatarUrl === null && meHidden.body?.user?.avatarStatus === 'hidden', JSON.stringify(meHidden.body?.user));

console.log('\n[TRI-943 live E2E — admin moderation queue]');
const jarAdmin = cookieJar();
const login = await req('POST', '/api/admin/auth/login', { jar: jarAdmin, json: { email: process.env.ADMIN_EMAIL || 'admin@tripkoach.com', password: process.env.ADMIN_PASSWORD } });
ok('admin login → mfaRequired', login.status === 200 && login.body?.mfaRequired === true, JSON.stringify(login.body));
const code = totp(MFA_SECRET);
const mfa = await req('POST', '/api/admin/auth/mfa', { jar: jarAdmin, json: { code } });
ok('admin MFA challenge → full session', mfa.status === 200 && Array.isArray(mfa.body?.permissions), JSON.stringify(mfa.body).slice(0, 80));

const queue = await req('GET', '/api/admin/moderation/avatars?status=pending,hidden', { jar: jarAdmin });
ok('moderation queue → 200', queue.status === 200 && Array.isArray(queue.body?.items), JSON.stringify(queue.body).slice(0, 80));
const item = queue.body?.items?.find((i) => i.userId === sA.body.user.id);
ok('reported avatar is in the queue with reason + real url', !!item && item.avatarStatus === 'hidden' && item.lastReportReason === 'E2E inappropriate' && /^https:\/\/cdn/.test(item.avatarUrl || ''), JSON.stringify(item));

const approve = await req('POST', `/api/admin/moderation/avatars/${sA.body.user.id}`, { jar: jarAdmin, json: { action: 'approve', reason: 'E2E ok' } });
ok('admin approve → approved + url restored', approve.status === 200 && approve.body?.avatarStatus === 'approved' && /^https:\/\/cdn/.test(approve.body?.avatarUrl || ''), JSON.stringify(approve.body));
const meRestored = await req('GET', '/api/v1/me', { jar: jarA });
ok('/me url restored after admin approve', !!meRestored.body?.user?.avatarUrl);

const reject = await req('POST', `/api/admin/moderation/avatars/${sA.body.user.id}`, { jar: jarAdmin, json: { action: 'reject', reason: 'E2E reject' } });
ok('admin reject → rejected, /me url null', reject.body?.avatarStatus === 'rejected' && (await req('GET', '/api/v1/me', { jar: jarA })).body?.user?.avatarUrl === null);

// Cleanup: owner clears their avatar.
const del = await req('DELETE', '/api/v1/me/avatar', { jar: jarA });
ok('owner DELETE avatar → null/null', del.status === 200 && del.body?.avatarUrl === null && del.body?.avatarStatus === null, JSON.stringify(del.body));

console.log(`\n${fail === 0 ? '✅' : '❌'} E2E: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
