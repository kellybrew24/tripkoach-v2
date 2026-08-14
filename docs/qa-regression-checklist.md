# QA pre-cutover regression checklist — TripKoach v2

**TRI-1109 (P1).** QA is ad-hoc per-ticket today. This is the standing checklist to
run **before any batched prod cutover (TRI-1057)** and after any high-risk deploy.
A written pass is the bar for now; the ⚙ items are automation candidates (the repo
already has `scripts/smoke-live.mjs`, `smoke-admin-live.mjs`, `live-e2e-*.mjs` to
build on).

**How to run:** execute against **dev** first (`dev.tripkoach.com` /
`admin.dev.tripkoach.com`), then repeat the read-only + non-destructive steps on
prod during the cutover window. Use the QA bot account
(`qa-bot@tripkoach.dev`, `secrets/tripkoach-dev-qa-admin.env`) — **never** Samuel's
admin (TRI-993). For payments use the Paystack TEST path / simulated
`charge.success` webhook with a valid HMAC (TRI-1035 lesson).

Record: date, env, git sha, tester, pass/fail per row, and a link to evidence
(screenshot / curl output) for each critical flow.

---

## A. Platform health (do first)
- [ ] `GET /api/health` returns `{status:'ok'}` on the target env. ⚙
- [ ] Public `/config.js` has `USE_LIVE_API:true` and expected FX display rate. ⚙
- [ ] Web SPA and Admin SPA load (200, no console errors, correct `config.js`). ⚙
- [ ] Caddy security headers present (TRI-1053) and TLS valid.

## B. Admin login + MFA (critical — auth spine)
- [ ] Admin login with correct password succeeds; wrong password is rejected.
- [ ] Show-password toggle does not break login (use `#a-email`/`#a-pw`; TRI-990). 
- [ ] MFA challenge is enforced for an MFA-enabled admin; valid TOTP passes,
      invalid is rejected.
- [ ] Recovery/backup code path works once and is then consumed.
- [ ] Login rate-limit + lockout triggers after N failures and recovers (TRI-1054/1061). ⚙
- [ ] Trusted-device skip works and expires at **14 days** (TRI-1085/983).
- [ ] Admin-recovery flow (clear-lockout / recovery-codes / reset-MFA) requires
      step-up TOTP and writes an audit entry (TRI-1080/1082).
- [ ] Post-logout back-button does not resurrect an authed view (bfcache, TRI-1059). ⚙

## C. Booking → payment → webhook (critical — revenue path)
- [ ] Browse tours, open a tour, select a departure, reach checkout.
- [ ] Checkout shows correct per-tour price + currency (USD of record / GHS display,
      rate 12 unless settings override; TRI-931/932/1033).
- [ ] Cancellation-policy terms render inline and **Pay is disabled until ticked**
      (TRI-1100).
- [ ] Promo code applies and adjusts total (TRI-1013).
- [ ] Payment initialises against Paystack; `public_token` (`?t=`) is minted on the
      booking (TRI-1095).
- [ ] Simulated `charge.success` webhook with valid HMAC marks booking paid;
      **invalid HMAC is rejected**; refund/pay events are audited (TRI-1062). ⚙
- [ ] Confirmation page + receipt render at `/booking/:ref` with the logo badge
      (TRI-1099/938).
- [ ] Booking confirmation email sends (or logs 'skipped' if transport unconfigured)
      with branding + logo (TRI-1102).

## D. Guest booking lookup (critical — hardened surface)
- [ ] Guest lookup `GET /bookings/:ref?t=<token>` resolves with a valid token.
- [ ] Same ref **without** a valid token is rejected for token-gated bookings
      (`token_required=true`); legacy rows still resolve ref-only (TRI-1095).
- [ ] Per-IP rate limit (100/min) on guest lookup holds; PII is dropped from logs
      (TRI-1063).
- [ ] Authenticated owner resolves their booking via session, no token needed.

## E. Consumer account
- [ ] Sign-up / login; consumer 2FA enroll + challenge (TRI-1029). 
- [ ] Consumer login rate-limit holds (TRI-1055). ⚙
- [ ] Account → reviews list and review submit work (TRI-1016/1014).
- [ ] Delete-account flow works and revokes access (TRI-1012).

## F. Admin console core (regression sweep)
- [ ] Bookings / Tours / Customers / Guides lists load, paginate past the cap,
      and **sort** on each column (TRI-1097/1043/1041).
- [ ] Customers export produces correct data (TRI-1008).
- [ ] RBAC: a read-only role cannot perform writes; writes are audited (TRI-1011/988).
- [ ] Audit timeline renders and escapes HTML (no injection, TRI-1066/997).
- [ ] Reporting / reconciliation export runs (TRI-898/1006).

## G. Content / leads
- [ ] Contact + pickup + tour date-interest leads submit and notify ops
      (TRI-1015/1018).
- [ ] Blog CMS renders published posts; keep-reading works (TRI-917/995).

---

## Sign-off
- [ ] All **critical** sections (B, C, D) fully pass on dev.
- [ ] Critical read-only + non-destructive checks re-run on prod during the window.
- [ ] Evidence linked; failures triaged and either fixed or explicitly waived by CTO.
- [ ] Rollback path (`docs/rollback.md`) confirmed available before go-live.

**Automation next steps:** promote the ⚙ rows into an executable smoke suite built
on the existing `scripts/smoke-live.mjs` / `smoke-admin-live.mjs` / `live-e2e-*.mjs`
so the health + auth + webbook-HMAC + guest-token checks run on every deploy.
Tracked as a follow-up, not required for the first cutover.
