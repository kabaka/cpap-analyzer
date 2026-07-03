#!/usr/bin/env node
// Cut a release IN THE WORKING TREE: transform CHANGELOG.md and bump
// package.json for `<version>`, and write the just-released changelog section to
// a notes file for the GitHub Release body.
//
// This script performs FILE mutations only — it does not run git or gh. The
// workflow stages, commits, tags, pushes, and publishes (where the GITHUB_TOKEN
// credential lives); keeping those out of here means the testable logic stays
// free of side effects beyond the two files it owns.
//
// Usage:
//   node scripts/release/cut-release.mjs --version 2026.06.1 \
//     [--date 2026-06-18] [--notes /tmp/notes.md] [--github]
//
// Exit/decision protocol:
//   - If `## [Unreleased]` has no releasable content (only `_Nothing yet._` /
//     whitespace), NOTHING is written. The script prints `released=false` and,
//     with --github, sets `released=false` on GITHUB_OUTPUT. Exit code is still
//     0 — an empty Unreleased is a normal no-op (docs/chore deploy), not a
//     failure. The deploy proceeds; no release is cut.
//   - Otherwise it transforms the files, writes the notes, prints
//     `released=true`, and (with --github) sets `released=true` plus `version`.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isoDate, hasReleasableContent, splitUnreleased } from './lib.mjs';
import { cutReleaseChangelog, bumpPackageVersion, computeNextVersion } from './lib.mjs';

/** Minimal `--flag value` / `--flag` parser (no deps). */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function emitGithubOutput(pairs) {
  if (!process.env.GITHUB_OUTPUT) return;
  const body = Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(process.cwd());
  const changelogPath = resolve(root, 'CHANGELOG.md');
  const pkgPath = resolve(root, 'package.json');

  const now = new Date();
  const date = typeof args.date === 'string' ? args.date : isoDate(now);

  const changelog = readFileSync(changelogPath, 'utf8');

  // Gate first: if there is nothing to release, no-op cleanly.
  const { unreleasedBody } = splitUnreleased(changelog);
  if (!hasReleasableContent(unreleasedBody)) {
    process.stdout.write('released=false\n');
    if (args.github) emitGithubOutput({ released: 'false' });
    return; // exit 0 — intentional no-op, deploy still proceeds.
  }

  // Resolve the version. Prefer an explicit --version (the workflow always
  // passes the version it computed from tags). If omitted, derive it here from
  // the local git tags so a local dry-run is self-contained.
  let version = typeof args.version === 'string' ? args.version : '';
  if (!version) {
    let tags = [];
    try {
      tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' })
        .split('\n')
        .filter((t) => t.trim().length > 0);
    } catch {
      tags = [];
    }
    version = computeNextVersion(tags, now).version;
  }

  const { changelog: nextChangelog, releasedSection } = cutReleaseChangelog(
    changelog,
    version,
    date,
  );
  writeFileSync(changelogPath, nextChangelog, 'utf8');

  const pkgJson = readFileSync(pkgPath, 'utf8');
  writeFileSync(pkgPath, bumpPackageVersion(pkgJson, version), 'utf8');

  // Write the release notes (the section we just cut) for the Release body.
  const notesPath = typeof args.notes === 'string' ? resolve(root, args.notes) : null;
  if (notesPath) {
    writeFileSync(notesPath, `${releasedSection}\n`, 'utf8');
  }

  process.stdout.write('released=true\n');
  if (args.github) emitGithubOutput({ released: 'true', version });
}

main();
