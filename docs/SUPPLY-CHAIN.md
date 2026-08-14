# Supply-chain / dependency scanning

**Ticket:** TRI-1123 (parent TRI-1121 · source TRI-1107 memo #3). **Scope:** repo / CI
only — no app code, **not** a prod deploy, does **not** ride TRI-1057.

Two mechanisms keep vulnerable / drifting dependencies out of `main`:

| Mechanism | File | When |
|-----------|------|------|
| PR audit gate | `.github/workflows/supply-chain.yml` + `scripts/ci/audit-gate.mjs` | every PR to `main` (also push to `main` + manual dispatch) |
| Dependabot | `.github/dependabot.yml` | weekly, opens update PRs (which the gate then checks) |

## What the gate blocks

For **each workspace that owns a lockfile** — root `/` (esbuild/jsdom toolchain that
builds web + admin) and `/apps/api` (Fastify/pg) — the CI job runs:

1. **`npm ci`** — installs strictly from the lockfile and **fails on lockfile drift**
   (a `package.json` change not reflected in `package-lock.json`). This is the
   lockfile-integrity check.
2. **`node scripts/ci/audit-gate.mjs <dir>`** — runs `npm audit --omit=dev --json` and
   **fails the PR** if any **HIGH or CRITICAL** advisory affects a *production*
   dependency and is **not** allow-listed.

Deliberately **not** blocked:
- **Dev-only** advisories (`--omit=dev`) — e.g. the current `esbuild` *moderate*. Build
  tooling isn't shipped to users; walling PRs on it just trains people to bypass the gate.
- **Moderate / Low** severities — reported by `npm audit` but never fail the job, so the
  team isn't blocked indefinitely on unfixable transitive lows.

> web + admin have **no** own `package.json`/lockfile — they build from the **root**
> lockfile, so the root row covers them. If a per-app lockfile is ever added, add a matrix
> row in `supply-chain.yml` **and** a `directory` entry in `dependabot.yml`.

## How to allow-list an exception

Use this **only** when a HIGH/CRITICAL advisory has **no fix available** (e.g. an
unfixable transitive dep). Prefer `npm audit fix` / a version bump first.

Add an entry to **`.audit-allowlist.json`** (repo root):

```jsonc
{ "allow": [
  { "id": "GHSA-xxxx-xxxx-xxxx",   // GHSA id, numeric npm advisory id, OR package name
    "package": "some-transitive",  // optional: also matches the whole package by name
    "reason": "no upstream fix; sink not reachable from our code paths — TRI-####",
    "expires": "2026-12-31" }      // YYYY-MM-DD — REQUIRED in practice (see below)
] }
```

- `id` matches by GHSA id, the numeric npm advisory `source` id, **or** a package name.
- **`expires` is how we avoid rotting exceptions:** once the date passes, the entry is
  ignored, the advisory blocks again, and someone must re-review it. Always set a near
  date (≤ 90 days) and reference the tracking ticket in `reason`.
- Keep the list **empty** whenever possible. As of TRI-1123 it *is* empty — both
  lockfiles are clean at HIGH/CRITICAL.

## Verifying the gate (smoke test)

Proven at build time (TRI-1123): a lockfile seeded with `lodash@4.17.4` + `minimist@0.0.8`
(known criticals) makes `audit-gate.mjs` exit **1**; adding those ids to the allow-list
makes it exit **0**; an **expired** allow-list entry lapses and it exits **1** again. To
re-run locally against a workspace:

```bash
node scripts/ci/audit-gate.mjs .          # root  → PASS today
node scripts/ci/audit-gate.mjs apps/api   # api   → PASS today
```

## Dependabot

`.github/dependabot.yml` opens **weekly** PRs (Mondays) for three ecosystems:
`npm` in `/`, `npm` in `/apps/api`, and `github-actions` in `/`. Minor + patch bumps are
**grouped** into one PR per ecosystem to cut noise; majors open separately for real review.
PRs are labelled `security` + `deps`. Every Dependabot PR is checked by the audit gate
above, so a bump that introduces a HIGH/CRITICAL can't merge.

> Labels `security` and `deps` must exist in the repo, else Dependabot skips them (it
> still opens the PR). Create once: `gh label create security` / `gh label create deps`.
