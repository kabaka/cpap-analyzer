#!/usr/bin/env node
// Compute and print the next CalVer version from the local git tag history.
//
// Usage:
//   node scripts/release/compute-version.mjs            # prints "2026.06.1"
//   node scripts/release/compute-version.mjs --github   # also writes GITHUB_OUTPUT
//
// This is the dry-run tool: run it locally (after `git fetch --tags`) to see
// what version the next release would cut, without changing anything. In CI it
// is invoked with --github so the workflow can read `version`/`prefix`/`micro`
// from the step outputs.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { computeNextVersion } from './lib.mjs';

/**
 * Read all git tag names. Returns [] if git fails (e.g. shallow clone with no
 * tags) rather than throwing, so a brand-new repo computes `.0` cleanly.
 * @returns {string[]}
 */
function readGitTags() {
  try {
    const out = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' });
    return out.split('\n').filter((t) => t.trim().length > 0);
  } catch {
    return [];
  }
}

function main() {
  const tags = readGitTags();
  const { version, prefix, micro } = computeNextVersion(tags, new Date());

  const emitGithub = process.argv.includes('--github');
  if (emitGithub && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\nprefix=${prefix}\nmicro=${micro}\n`,
    );
  }

  // Always print the bare version to stdout for human/script consumption.
  process.stdout.write(`${version}\n`);
}

main();
