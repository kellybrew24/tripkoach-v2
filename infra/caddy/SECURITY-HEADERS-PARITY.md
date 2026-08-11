# Caddy security-header parity checklist (TRI-1064)

Source: TRI-1060 OWASP audit — Finding **A05/F3** (Security Misconfiguration —
config not version-controlled; prod header gap). This checklist lets a
reviewer confirm the four TripKoach vhosts serve the same security headers,
and lets the TRI-1057 cutover verify **prod == dev**.

The version-controlled config is [`Caddyfile.tripkoach`](./Caddyfile.tripkoach).
It is a **mirror** of the TripKoach blocks in the shared
`/etc/caddy/Caddyfile` on `168.119.117.136` — the server is the source of
truth; keep this file in sync on every change (procedure is in that file's
header).

## Current state (2026-08-11)

| Surface | Host | Sec-header import | `no-store` SPA doc | Status |
|---|---|---|---|---|
| dev web | `dev.tripkoach.com` | ✅ TRI-1053 | ✅ TRI-1059 | LIVE, hardened |
| dev admin | `admin.dev.tripkoach.com` | ✅ TRI-1053 | ✅ TRI-1059 | LIVE, hardened |
| prod web | `app.tripkoach.com` | ❌ pending | ❌ pending | **rides TRI-1057** |
| prod admin | `admin.tripkoach.com` | ❌ pending | ❌ pending | **rides TRI-1057** |

The only delta between the live prod blocks and the target is the two
`# PENDING TRI-1057` lines per prod block in `Caddyfile.tripkoach`
(the `import tripkoach_security_headers` + the `@spa_doc` / `header @spa_doc
Cache-Control "no-store"`).

## Verify-live checklist (run on dev now; on prod after TRI-1057 cutover)

For each host `H` in `dev.tripkoach.com`, `admin.dev.tripkoach.com`
(and, post-cutover, `app.tripkoach.com`, `admin.tripkoach.com`):

```sh
curl -sSI "https://H/" | tr -d '\r'
```

Assert on the response:

- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains`
      (max-age ≥ 31536000, includeSubDomains present)
- [ ] `Content-Security-Policy` contains `script-src 'self'`
      (NO `unsafe-inline`/`unsafe-eval` in `script-src`; NO `default-src *`)
- [ ] `X-Frame-Options: SAMEORIGIN` **and** CSP `frame-ancestors 'self'`
      (audit spec accepts DENY / `frame-ancestors 'none'`; we use the
      same-origin variant deliberately — admin is never framed cross-origin)
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()`
- [ ] NO `Server:` header (Caddy banner stripped)
- [ ] `Cache-Control: no-store` on the SPA document (`GET /` and any
      client-route path, e.g. `/browse`), but NOT on hashed assets
      (`GET /app.js` should keep normal caching)

One-shot parity diff (dev today, all four post-cutover):

```sh
for H in dev.tripkoach.com admin.dev.tripkoach.com; do
  echo "== $H =="
  curl -sSI "https://$H/" | tr -d '\r' \
    | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy|cache-control|^server:'
done
```

Deep check for CSP violations (headless Chrome, per TRI-1053):

```sh
/root/.agent-browser/browsers/chrome-151*/chrome --headless --no-sandbox \
  --enable-logging=stderr --v=1 --virtual-time-budget=9000 --dump-dom \
  "https://H/" 2>&1 | grep -iE 'content security policy|refused to|blocked|violat'
# expect zero matches; #root should render
```

## TRI-1057 cutover steps (prod hardening — do NOT run before the CEO window)

1. `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-tri1064-$(date +%Y%m%d-%H%M%S)`
2. In the `app.tripkoach.com` + `admin.tripkoach.com` blocks, add the two
   `# PENDING TRI-1057` lines exactly as in `Caddyfile.tripkoach`
   (the `import tripkoach_security_headers`, the `@spa_doc` matcher, and the
   `header @spa_doc Cache-Control "no-store"` inside `handle {}`).
3. `set -a; . /etc/sworvo/secrets.env; set +a`  (load CF token, else validate
   errors on empty token — that's an env error, not a syntax error)
4. `caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile`
5. `systemctl reload caddy`
6. Run the verify-live checklist above against the two prod hosts; confirm
   `prod == dev` header-for-header.
7. Update the state table in this file (prod rows → ✅ LIVE) and drop the
   `# PENDING TRI-1057` markers from `Caddyfile.tripkoach`.

Rollback: restore the `Caddyfile.bak-tri1064-*` backup + `systemctl reload caddy`.
