import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateImportTree, type ImportTreeInfo } from '../fixtures/generators/fixture-generator';

/**
 * Import-redesign E2E — the persistent background-import experience.
 *
 * Covers the redesigned import surfaces (ADR 0026) end-to-end through the real
 * worker-pool pipeline, using the SAME synthetic SD-card fixture tree the
 * existing `import-wizard.spec.ts` uses (2 same-day sessions + 1 empty CSL stub).
 * The fixture import runs the genuine scan → parse → build → store pipeline, so
 * these tests exercise the actual progress lifecycle, not a mock.
 *
 * The surfaces under test:
 *   - {@link import('@/components/import/ImportStageList')} — the multi-stage
 *     progress list (all stages visible from t=0) shown on the wizard's importing
 *     step, replacing the old single bar.
 *   - {@link import('@/components/import/ImportStatusDock')} — the persistent
 *     bottom-LEFT pill, mounted app-wide via RootLayout, that survives navigation,
 *     expands to a panel, has a CONFIRMED cancel, and raises a completion toast.
 *   - {@link import('@/components/import/ImportSummary')} — the terminal summary.
 *
 * ── Driving / determinism constraints ──────────────────────────────────────
 *
 * 1. The directory picker (`showDirectoryPicker`) is NOT automatable in
 *    Playwright. As `import-pipeline`/`import-wizard` already establish, we drive
 *    the genuine `onFileInput → startFileImport` pipeline by stripping
 *    `webkitdirectory` from the hidden file input and injecting the fixture EDFs
 *    as a file list. The scanner derives day-grouping from EDF headers + filename
 *    timestamps, not `webkitRelativePath`, so this is faithful.
 *
 * 2. WebKit's Playwright driver does not fire the file-input `change` event for
 *    programmatic `setInputFiles`, so the wizard never leaves the Select step
 *    there (documented in `import-wizard.spec.ts`). We skip WebKit and cover
 *    Chromium + Firefox; the dock/store/controller logic is unit/integration
 *    tested cross-engine.
 *
 * 3. The 5-file synthetic import is FAST (~2–4 s). Surfaces that require catching
 *    the job mid-flight are handled deterministically: the persistent dock pill
 *    appears the instant a job is active (running state) and is asserted while
 *    running BEFORE letting it settle; terminal surfaces (summary, toast, dock
 *    state) are asserted via Playwright's auto-waiting after the job settles.
 *    Assertions that would depend on a precise in-flight instant (e.g. a specific
 *    progress percentage, or that a cancel landed before the job finished) are
 *    deliberately avoided or scoped to the deterministic part of the journey —
 *    see the per-test notes and the skipped busy-notice journey below.
 *
 * Synthetic data only — no real PHI.
 */

const FILE_INPUT = 'input[type="file"]';

/** The four CPAP import stages, rendered from t=0 (pending → active → done). */
const CPAP_STAGE_LABELS = [
  'Scanning files',
  'Parsing files',
  'Building days',
  'Storing sessions',
] as const;

let tree: ImportTreeInfo;

// Playwright requires an object-destructuring first arg even when unused.
// eslint-disable-next-line no-empty-pattern
test.beforeAll(({}, testInfo) => {
  // Each parallel worker writes its OWN tree so concurrent runs never race on
  // the same files. Regenerated fresh so the recording date is always recent.
  const outDir = path.join(os.tmpdir(), `cpap-import-redesign-w${testInfo.workerIndex}`);
  tree = generateImportTree(outDir);
});

/** Absolute paths of every .edf file in the generated day-folder. */
function fixtureFilePaths(): string[] {
  const dayDir = path.join(tree.treeDir, 'DATALOG', tree.yyyymmdd);
  return fs
    .readdirSync(dayDir)
    .filter((f) => f.toLowerCase().endsWith('.edf'))
    .map((f) => path.join(dayDir, f));
}

/**
 * Inject the fixture EDFs through the wizard's hidden file input, driving the
 * real import pipeline. Assumes the wizard's Select step is mounted.
 */
async function startImport(page: Page): Promise<void> {
  await page.locator(FILE_INPUT).evaluate((el) => {
    (el as HTMLInputElement).removeAttribute('webkitdirectory');
  });
  await page.locator(FILE_INPUT).setInputFiles(fixtureFilePaths());
}

/** The persistent dock pill (collapsed), addressed by its accessible name. */
function dockPill(page: Page) {
  return page.getByRole('button', { name: /CPAP import:.*open details/i });
}

/**
 * SPA-navigate to another section by CLICKING a nav link. A `page.goto` would do
 * a full reload and tear down the in-memory ImportController (the dock would not
 * survive) — so the "survives navigation" guarantee is specifically about
 * client-side routing. `force` because the active import causes frequent
 * repaints that can otherwise stall Playwright's actionability wait.
 */
async function spaNavigate(page: Page, linkName: string): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: linkName }).first().click({
    force: true,
  });
}

test.describe('Import redesign — persistent background import', () => {
  // See header note (2): WebKit cannot drive a programmatic file-input change.
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'WebKit cannot drive a file-input change event programmatically (Playwright limitation)',
  );

  test('shows the multi-stage progress list (all stages), then a terminal summary', async ({
    page,
  }) => {
    await page.goto('/data/import');
    await expect(page.getByRole('heading', { name: /import data/i })).toBeVisible();

    await startImport(page);

    // ── The importing step renders the multi-stage list, not a single bar. ──
    await expect(page.getByRole('heading', { name: 'Importing data…' })).toBeVisible({
      timeout: 10_000,
    });

    // EVERY stage is present from the start (pending ones included). This is the
    // core of the single-bar → stage-list redesign.
    const stageList = page
      .locator('#main-content ul')
      .filter({ hasText: CPAP_STAGE_LABELS[0] })
      .first();
    for (const label of CPAP_STAGE_LABELS) {
      await expect(stageList.getByText(label, { exact: true })).toBeVisible();
    }

    // The "Continue in background" affordance is offered on the importing step.
    await expect(page.getByRole('button', { name: 'Continue in background' })).toBeVisible();

    // ── Terminal summary appears (success or finished-with-issues). ──
    // This fixture surfaces import-level issues (the warning count is non-zero),
    // so the heading is the partial-success variant; the success variant shares
    // the "Import complete" prefix. Match either rather than over-fitting.
    const summaryHeading = page.locator('#main-content h2');
    await expect(summaryHeading).toHaveText(/^Import (complete|finished with issues|cancelled)$/, {
      timeout: 30_000,
    });

    // The terminal step offers the post-import CTAs.
    await expect(page.getByRole('button', { name: 'View Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import More' })).toBeVisible();
  });

  test('persists in the dock across navigation and re-opening the import page', async ({
    page,
  }) => {
    await page.goto('/data/import');
    await startImport(page);
    await expect(page.getByRole('heading', { name: 'Importing data…' })).toBeVisible({
      timeout: 10_000,
    });

    // The persistent dock pill is present on the import page too (mounted at the
    // RootLayout level), reflecting the running CPAP job.
    await expect(dockPill(page)).toBeVisible();

    // SPA-navigate AWAY — the dock survives (this is the redesign's headline).
    await spaNavigate(page, 'Sessions');
    await expect(page.getByRole('heading', { name: 'Sessions' }).first()).toBeVisible({
      timeout: 15_000,
    });

    // The pill is still visible on the new route and names the CPAP import +
    // its overall percentage (the exact % is time-dependent and intentionally
    // matched loosely).
    const pill = dockPill(page);
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAccessibleName(/CPAP import: \d+% — open details/);

    // Expand the pill into its panel and return to the import page from there.
    await pill.click();
    const panel = page.getByRole('region', { name: /CPAP import details/i });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Open import page' }).click();

    // Back on the wizard, the SAME job is adopted: either still importing or its
    // terminal summary — never reset to the Select step.
    await expect(page.getByRole('heading', { name: /import data/i })).toBeVisible();
    await expect
      .poll(
        async () => {
          const importing = await page.getByRole('heading', { name: 'Importing data…' }).count();
          const summary = await page
            .locator('#main-content h2')
            .filter({ hasText: /^Import (complete|finished with issues|cancelled)$/ })
            .count();
          return importing + summary;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    // The Select step's source cards must NOT be showing (the job was adopted).
    await expect(page.getByRole('button', { name: 'Import from CPAP SD card' })).toHaveCount(0);
  });

  test('dock cancel is confirmed via a dialog; "Keep importing" dismisses it', async ({ page }) => {
    await page.goto('/data/import');
    await startImport(page);

    // The dock pill's cancel affordance is the CONFIRMED one, and it is present
    // only WHILE the job runs. The pill appears the instant the job is active,
    // so we poll briefly for the running-state cancel control immediately after
    // start (before the fast synthetic import settles) rather than navigating
    // first — empirically this captures the running window reliably.
    const pillCancel = page.getByRole('button', { name: 'Cancel CPAP import' });
    await expect(pillCancel).toBeVisible({ timeout: 10_000 });

    // Requesting cancel opens a CONFIRMATION dialog (not an immediate cancel).
    await pillCancel.click();
    const dialog = page.getByRole('dialog', { name: 'Cancel import?' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('The import will stop. Data already saved is kept; the rest is discarded.'),
    ).toBeVisible();

    // The dialog offers both a destructive confirm and a non-destructive keep.
    await expect(dialog.getByRole('button', { name: 'Cancel import' })).toBeVisible();
    const keep = dialog.getByRole('button', { name: 'Keep importing' });
    await expect(keep).toBeVisible();

    // Choosing "Keep importing" dismisses the dialog WITHOUT cancelling.
    // (Asserting that a confirmed cancel actually lands a `cancelled` terminal
    // state is racy with the ~3 s synthetic import — see header note 3 — so the
    // *confirmation* contract is what we lock here.)
    await keep.click();
    await expect(dialog).toHaveCount(0);
  });

  test('completion raises a toast when finishing on another route (accessible)', async ({
    page,
  }) => {
    await page.goto('/data/import');
    await startImport(page);
    await expect(page.getByRole('heading', { name: 'Importing data…' })).toBeVisible({
      timeout: 10_000,
    });

    // Leave the import page so the terminal toast is NOT suppressed (the dock
    // suppresses the toast only while the user is on /data/import).
    await spaNavigate(page, 'Sessions');
    await expect(page.getByRole('heading', { name: 'Sessions' }).first()).toBeVisible({
      timeout: 15_000,
    });

    // The completion toast is a Radix toast item (exposed as a listitem) whose
    // title announces the CPAP import outcome. Match success OR finished-with-
    // issues; both are valid terminal toasts for this fixture.
    const toast = page
      .getByRole('listitem')
      .filter({ hasText: /CPAP import (complete|finished with issues)/i });
    await expect(toast.first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Import redesign — reduced motion', () => {
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'WebKit cannot drive a file-input change event programmatically (Playwright limitation)',
  );

  /**
   * Start an import in a context with the given reduced-motion preference and
   * return the running dock pill's icon element + its class. The dock pill
   * appears the instant the job is active, so the RUNNING (spinner) state is
   * reliably observable before the job settles.
   */
  async function pillIconWhileRunning(
    context: BrowserContext,
  ): Promise<{ animated: string | null; svgHtml: string }> {
    const page = await context.newPage();
    await page.goto('/data/import');
    await page.locator(FILE_INPUT).evaluate((el) => {
      (el as HTMLInputElement).removeAttribute('webkitdirectory');
    });
    await page.locator(FILE_INPUT).setInputFiles(fixtureFilePaths());

    const pill = dockPill(page);
    await expect(pill).toBeVisible({ timeout: 10_000 });
    // Stable hooks rather than hashed CSS-module substrings: the icon carries a
    // `data-testid` and reflects its motion state via `data-animated`.
    const icon = pill.getByTestId('import-dock-pill-icon');
    await expect(icon).toBeVisible();
    const animated = await icon.getAttribute('data-animated');
    const svgHtml = (await icon.innerHTML()) ?? '';
    return { animated, svgHtml };
  }

  test('the running spinner animates when motion is allowed', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'no-preference' });
    const { animated } = await pillIconWhileRunning(context);
    // The spinner is animating when motion is OK.
    expect(animated).toBe('true');
    await context.close();
  });

  test('the running spinner does NOT animate under prefers-reduced-motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const { animated, svgHtml } = await pillIconWhileRunning(context);
    // Rotation is disabled — the icon reports it is not animating.
    expect(animated).toBe('false');
    // And the static "circle-dot" variant is rendered in place of the spinner:
    // a concentric outer + inner circle (the spinner has no such pair of
    // <circle> elements). This locks the visual swap, not just the data flag.
    const circleCount = (svgHtml.match(/<circle/g) ?? []).length;
    expect(circleCount).toBeGreaterThanOrEqual(2);
    await context.close();
  });
});

/**
 * SKIPPED JOURNEY — "starting a second same-kind import while one runs is blocked
 * with a visible busy notice".
 *
 * Why skipped at the E2E layer: the busy notice (`busyNotice` in ImportWizard,
 * gated on `importController.isActive('cpap')`) is only reachable from the
 * wizard's SELECT step. But once an import starts, the wizard auto-advances to
 * the importing step (and adopts the running job on remount), so the file
 * input / drop zone that would trigger a second start is no longer mounted. With
 * the ~3 s synthetic import there is no reliable, non-racy way to (a) be on the
 * Select step while (b) a same-kind job is genuinely still active, without a
 * full page reload that would tear down the controller. Forcing it would yield a
 * flaky test, which the task explicitly forbids.
 *
 * This path is instead covered deterministically at the unit/integration layer:
 * `handleFileInput`/`handleBrowseFolder`/`handleDrop` short-circuit on
 * `importController.isActive(...)` and set the notice, and the controller's
 * "reject second same-kind import" behaviour is exercised in the ImportController
 * tests. If a stable `data-testid` is later added to keep the Select step's drop
 * zone reachable during an active job (see REPORT), this can be promoted to E2E.
 */
test.describe('Import redesign — second same-kind import blocked', () => {
  test.skip('busy notice when a second CPAP import is attempted while one runs', () => {
    // Intentionally skipped — see the describe-block comment above. Covered by
    // unit/integration tests on ImportWizard handlers + ImportController.
  });
});
