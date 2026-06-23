import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateImportTree, type ImportTreeInfo } from '../fixtures/generators/fixture-generator';

/**
 * Import Wizard E2E — full UI import flow + regression locks.
 *
 * Where `import-pipeline.spec.ts` verifies browser capabilities and buffer
 * transfer, this spec drives the *real* Import Wizard UI end-to-end: it uploads
 * a synthetic SD-card directory through the wizard's `webkitdirectory` file
 * input, lets the real worker-pool import pipeline run, and asserts the
 * outcome against the wizard summary AND the IndexedDB-backed Sessions view.
 *
 * It locks in two bug fixes:
 *
 *   1. **Multiple sessions per calendar day import successfully.** The fixture
 *      tree contains two recordings on the SAME calendar date, 90 minutes apart
 *      (>30 min ⇒ SessionBuilder splits them). Previously the 2nd same-day
 *      session failed on a `machineId_date` uniqueness storage error. We verify
 *      BOTH sessions are created — via the redesigned summary's "Sessions
 *      imported" stat AND the Sessions list/count UI.
 *
 *   2. **Empty / header-only CSL stubs are skipped quietly.** The tree includes
 *      a 256-byte CSL (Cheyne-Stokes) header-only stub with no signal/data
 *      block. Skipping it is a non-fatal WARNING, not an error: under the
 *      redesigned summary (ADR 0026) this surfaces as the "Import finished with
 *      issues" partial-success variant — NOT the "Import failed" error variant,
 *      and NOT an expandable per-file *error* list (only true errors populate
 *      `recentErrors`).
 *
 * Data flows through the genuine pipeline (scan → worker-pool parse → per-day
 * build → atomic store), so this also exercises the atomic-write / per-day
 * streaming behaviour from the same pass.
 *
 * ── Redesigned import UI (ADR 0026) ─────────────────────────────────────────
 * The importing step now renders the multi-stage {@link
 * import('@/components/import/ImportStageList')} under an "Importing data…"
 * heading; the terminal step renders {@link
 * import('@/components/import/ImportSummary')} whose heading is one of
 * "Import complete" (clean success) / "Import finished with issues" (partial
 * success — warnings and/or recoverable errors) / "Import failed" (fatal).
 * The headline stats are a small grid of value/label pairs; for a CPAP import
 * the labels are "Sessions imported" and "Skipped (duplicates)". This fixture
 * (empty CSL stub ⇒ warning) yields the "finished with issues" variant.
 *
 * Synthetic data only — no real PHI. The fixture tree is (re)generated fresh in
 * `beforeAll` with a recent recording date so the sessions fall inside the
 * app's default 30-day window and are visible without widening the range.
 */

// The hidden directory input is the only <input type="file"> on the wizard.
const FILE_INPUT = 'input[type="file"]';

/**
 * The redesigned summary heading: success / partial-success / failure variants.
 * This fixture (an empty CSL stub is skipped as a warning) lands on the
 * partial-success "finished with issues" variant; the regex tolerates the clean
 * "complete" variant too so the spec is robust to fixture tweaks, but NEVER the
 * "failed" variant (a skipped empty stub must never read as a fatal import).
 */
const SUMMARY_HEADING_RE = /^Import (complete|finished with issues)$/;

let tree: ImportTreeInfo;

// Playwright requires the first hook arg to be an object-destructuring pattern
// even when no fixtures are used; we only need `testInfo` for the worker index.
// eslint-disable-next-line no-empty-pattern
test.beforeAll(({}, testInfo) => {
  // Regenerate the tree so the recording date is always recent (within the
  // default 30-day window) regardless of when CI runs. Each parallel worker
  // writes to its OWN temp directory so concurrent runs never race on the same
  // files (the rebuild deletes + recreates the DATALOG folder).
  const outDir = path.join(os.tmpdir(), `cpap-import-tree-w${testInfo.workerIndex}`);
  tree = generateImportTree(outDir);
  // Sanity-check the fixtures actually landed on disk before any browser work.
  const csl = path.join(tree.treeDir, 'DATALOG', tree.yyyymmdd, `${tree.yyyymmdd}_220000_CSL.edf`);
  expect(fs.existsSync(csl)).toBe(true);
  expect(fs.statSync(csl).size).toBe(256);
});

/**
 * Read the numeric value rendered next to a summary label in the redesigned
 * {@link ImportSummary} stat grid. Each stat is a `.item` containing a `.value`
 * span followed by a `.label` span (CSS-module hashed, so matched by substring).
 * Returns `null` when no stat carries that label (the grid only renders the
 * stats the caller supplies — for CPAP: "Sessions imported" + "Skipped
 * (duplicates)").
 */
async function summaryValueFor(page: Page, label: string): Promise<string | null> {
  // Scope to the stat item whose `.label` span has exactly this text, then read
  // its sibling `.value`. `:text-is` pins the exact label so "Sessions imported"
  // never collides with any superstring.
  const item = page.locator(
    `#main-content [class*="item"]:has([class*="label"]:text-is("${label}"))`,
  );
  if ((await item.count()) === 0) return null;
  return (await item.locator('[class*="value"]').first().textContent())?.trim() ?? null;
}

/** Absolute paths of every .edf file in the generated day-folder. */
function fixtureFilePaths(): string[] {
  const dayDir = path.join(tree.treeDir, 'DATALOG', tree.yyyymmdd);
  return fs
    .readdirSync(dayDir)
    .filter((f) => f.toLowerCase().endsWith('.edf'))
    .map((f) => path.join(dayDir, f));
}

/** Upload the fixture files through the wizard and wait for completion. */
async function runImport(page: Page): Promise<void> {
  await page.goto('/data/import');
  await expect(page.getByRole('heading', { name: /import data/i })).toBeVisible();

  // Upload the day-folder's EDF files as an explicit file list.
  //
  // Playwright requires a *directory* path for `webkitdirectory` inputs, so we
  // strip that attribute first, turning the element into an ordinary multi-file
  // input that accepts a file array. This drives the genuine `onFileInput` →
  // `startFileImport` pipeline; only the *injection* mechanism differs from a
  // human dragging a folder in.
  //
  // The scanner derives each file's day-group and session split points from the
  // EDF *headers* and filename timestamps — not from `webkitRelativePath` — so
  // the multi-session-per-day and empty-skip assertions hold identically with
  // or without the directory structure.
  await page.locator(FILE_INPUT).evaluate((el) => {
    (el as HTMLInputElement).removeAttribute('webkitdirectory');
  });
  await page.locator(FILE_INPUT).setInputFiles(fixtureFilePaths());

  // The wizard auto-advances through scan → import → terminal summary. Allow
  // generous time for worker-pool spin-up + parse on slower CI machines. The
  // redesigned terminal heading is the success/partial variant (never failure).
  await expect(
    page.locator('#main-content h2').filter({ hasText: SUMMARY_HEADING_RE }),
  ).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('Import Wizard — full directory import', () => {
  // WebKit's Playwright driver does not fire the `change` event on a file
  // <input> when files are injected programmatically (neither via
  // `setInputFiles` nor a dispatched event), so the wizard never leaves the
  // Select step there. The same regression is covered on Chromium + Firefox
  // (where the input change fires) and at the unit level in
  // src/services/import/__tests__/ImportService.test.ts. The sibling
  // sessions.spec.ts notes the same engine limitation and likewise injects data
  // directly rather than through the file input. See REPORT for the CI command.
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'WebKit cannot drive a file-input change event programmatically (Playwright limitation)',
  );

  test('imports a multi-session day and skips the empty CSL stub with zero errors', async ({
    page,
  }) => {
    await runImport(page);

    // ── Status is a success/partial summary, NEVER the failure variant. ──
    // Regression #2: a skipped empty CSL stub is a non-fatal warning, so the
    // redesigned summary shows the partial-success "Import finished with issues"
    // heading (this fixture) — and crucially never "Import failed".
    const heading = page.locator('#main-content h2').filter({ hasText: SUMMARY_HEADING_RE });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Import finished with issues');
    await expect(page.getByRole('heading', { name: 'Import failed' })).toHaveCount(0);

    // ── Both same-day sessions were created. ──
    // Regression #1: previously the 2nd session of a calendar day failed on the
    // machineId_date uniqueness constraint. We assert the POSITIVE count via the
    // redesigned summary's "Sessions imported" stat, not merely the absence of
    // an error.
    expect(await summaryValueFor(page, 'Sessions imported')).toBe(String(tree.expectedSessions));

    // The redesigned CPAP summary surfaces a "Skipped (duplicates)" stat; on a
    // first import of these fixtures nothing is a duplicate, so it reads 0.
    expect(await summaryValueFor(page, 'Skipped (duplicates)')).toBe('0');

    // ── The empty CSL stub is NOT surfaced as a hard error. ──
    // Only true errors populate `recentErrors`, which is what drives the
    // expandable "N file errors" disclosure — a skipped empty stub is a warning,
    // so no such disclosure (and no failure copy) appears.
    await expect(page.getByRole('button', { name: /file error/i })).toHaveCount(0);
    await expect(page.getByText(/import failed/i)).toHaveCount(0);
  });

  test('imported sessions are visible in the Sessions view (count + rows)', async ({ page }) => {
    await runImport(page);

    // From the completion screen, navigate to the dashboard, then to Sessions.
    await page.getByRole('button', { name: 'View Dashboard' }).click();

    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // The session count UI reflects BOTH same-day sessions. This is the
    // user-facing confirmation of the multi-session-per-day fix — verified via
    // the list/count UI, not just the wizard's internal counter.
    // Scope to main content — the StatusBar footer also renders an "N sessions"
    // label since the Phase 1 chrome redesign.
    await expect(
      page
        .locator('#main-content')
        .getByText(`${tree.expectedSessions} sessions`, { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(tree.expectedSessions);

    // Both rows share the same calendar date (same-day sessions).
    await expect(rows).toHaveCount(2);
  });

  test('dashboard renders imported data without crashing', async ({ page }) => {
    await runImport(page);

    await page.goto('/');
    // The dashboard must render its primary heading with imported data present
    // (no error boundary / blank screen). We assert a stable top-level heading.
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10_000 });

    // No uncaught error boundary fallback.
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
