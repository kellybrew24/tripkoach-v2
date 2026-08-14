#!/usr/bin/env node
// =============================================================================
// TripKoach v2 — supply-chain audit gate.  TRI-1123 (parent TRI-1121, memo #3).
//
// Runs `npm audit --omit=dev --json` in a target workspace dir and FAILS
// (exit 1) if any advisory of severity HIGH or CRITICAL is present and is NOT
// covered by a documented allow-list entry.  Dev-only advisories are excluded
// (--omit=dev) and MODERATE/LOW never block — matching the P1 policy in
// TRI-1107 memo #3: gate on the exploitable stuff, don't wall the team behind
// unfixable transitive lows.
//
// WHY A SCRIPT (not bare `npm audit --audit-level=high`): the bare command has
// no allow-list, so a single unfixable transitive HIGH would block every PR
// indefinitely.  This adds a reviewable, EXPIRING allow-list so exceptions are
// explicit, justified, and force re-review instead of rotting forever.  It is
// dependency-free (no audit-ci / better-npm-audit install in CI) so the gate
// itself pulls no new supply-chain surface.
//
// Usage:
//   node scripts/ci/audit-gate.mjs <workspaceDir> [allowlistFile]
//     workspaceDir   dir containing package.json + package-lock.json (default ".")
//     allowlistFile  JSON allow-list (default "<repoRoot>/.audit-allowlist.json")
//
// Allow-list file format (all fields but `id` optional):
//   { "allow": [
//       { "id": "GHSA-xxxx-xxxx-xxxx", "reason": "no fix yet; not reachable",
//         "expires": "2026-12-31", "package": "foo" }
//   ] }
//   `id` may be a GHSA id, a numeric npm advisory source id, or a package name.
//   An entry with a past `expires` date is IGNORED (the exception lapses and the
//   advisory blocks again) so allowances can't silently outlive their fix window.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCK = new Set(['high', 'critical']);
const workspaceDir = resolve(process.argv[2] || '.');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowlistFile = resolve(process.argv[3] || `${repoRoot}/.audit-allowlist.json`);

// `date` is passed in (Date.now is fine here — this runs in CI, not the workflow harness).
const today = new Date().toISOString().slice(0, 10);

function loadAllowlist() {
  if (!existsSync(allowlistFile)) return { ids: new Set(), packages: new Set(), entries: [] };
  let raw;
  try {
    raw = JSON.parse(readFileSync(allowlistFile, 'utf8'));
  } catch (e) {
    console.error(`audit-gate: cannot parse allow-list ${allowlistFile}: ${e.message}`);
    process.exit(2);
  }
  const ids = new Set();
  const packages = new Set();
  const active = [];
  for (const e of raw.allow || []) {
    if (e.expires && e.expires < today) {
      console.log(`audit-gate: allow-list entry EXPIRED (ignored): ${e.id} (expired ${e.expires})`);
      continue;
    }
    active.push(e);
    if (e.id) ids.add(String(e.id).toUpperCase());
    if (e.package) packages.add(String(e.package));
  }
  return { ids, packages, entries: active };
}

function runAudit(dir) {
  try {
    const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (err) {
    // `npm audit` exits non-zero when vulns are found but still prints JSON to stdout.
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch { /* fall through */ }
    }
    console.error(`audit-gate: npm audit failed to run in ${dir}: ${err.message}`);
    process.exit(2);
  }
}

function ghsaFromUrl(url) {
  const m = /GHSA-[0-9a-z-]+/i.exec(url || '');
  return m ? m[0].toUpperCase() : null;
}

const allow = loadAllowlist();
const report = runAudit(workspaceDir);
const vulns = report.vulnerabilities || {};

const blocking = [];
for (const [name, v] of Object.entries(vulns)) {
  if (!BLOCK.has(v.severity)) continue;

  // Collect every identifier this vuln can be allow-listed by.
  const ids = new Set();
  for (const via of v.via || []) {
    if (typeof via === 'object') {
      if (via.source != null) ids.add(String(via.source).toUpperCase());
      const g = ghsaFromUrl(via.url);
      if (g) ids.add(g);
    }
  }

  const allowedById = [...ids].some((id) => allow.ids.has(id));
  const allowedByPkg = allow.packages.has(name);
  if (allowedById || allowedByPkg) {
    console.log(`audit-gate: ALLOW-LISTED ${v.severity} in "${name}" (${[...ids].join(', ') || 'no-id'})`);
    continue;
  }

  const titles = (v.via || [])
    .filter((x) => typeof x === 'object')
    .map((x) => `${x.title || x.name} <${x.url || 'no-url'}>`);
  blocking.push({ name, severity: v.severity, ids: [...ids], titles });
}

const dirLabel = workspaceDir === repoRoot ? '. (root)' : workspaceDir.replace(`${repoRoot}/`, '');
if (blocking.length === 0) {
  console.log(`audit-gate: PASS — no un-allow-listed high/critical advisories in ${dirLabel}`);
  process.exit(0);
}

console.error(`\naudit-gate: FAIL — ${blocking.length} high/critical advisory group(s) in ${dirLabel}:`);
for (const b of blocking) {
  console.error(`\n  ✗ [${b.severity}] ${b.name}  ids=[${b.ids.join(', ') || 'none'}]`);
  for (const t of b.titles) console.error(`      - ${t}`);
}
console.error(
  `\nTo resolve: run \`npm audit fix\` in ${dirLabel}, or — if no fix exists — add an ` +
    `EXPIRING allow-list entry to .audit-allowlist.json with a reason (see docs/SUPPLY-CHAIN.md).`,
);
process.exit(1);
