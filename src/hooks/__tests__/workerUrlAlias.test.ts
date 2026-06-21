/**
 * Build-blocker regression guard (B1).
 *
 * Vite's worker plugin does NOT resolve the `@/` path alias inside
 * `new Worker(new URL('@/...', import.meta.url))`: an aliased specifier produces
 * an unresolved worker entry and aborts `vite build`. This guard greps the
 * source tree and fails if any worker URL uses the alias, so the build can never
 * silently regress on a path the production build only exercises end-to-end.
 *
 * Kept deliberately cheap: a single recursive read + regex scan, no Vite or
 * worker runtime involved.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Resolve `src/` from the project root (Vitest's cwd) rather than
// `import.meta.url`, which is not a `file:` URL under the Vite transform.
const SRC_DIR = join(process.cwd(), 'src');

/**
 * Flag any `new Worker(new URL('@/...'` (or `@\` on Windows) — the alias inside
 * a worker URL is the exact pattern Vite cannot resolve. Tolerant of whitespace
 * between the tokens.
 */
const WORKER_ALIAS_RE = /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"`]@\//;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('worker URL alias guard (B1)', () => {
  it('uses no `@/` alias inside any new Worker(new URL(...)) call', () => {
    const offenders = collectSourceFiles(SRC_DIR).filter((file) =>
      WORKER_ALIAS_RE.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
