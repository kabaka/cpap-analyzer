import { test, expect, type Page } from '@playwright/test';

/**
 * Google Health (Fitbit) heavy-intraday import — E2E regression guard.
 *
 * ── What this covers, and why it exists ─────────────────────────────────────
 *
 * The Google Health import routes its HEAVY data types — chief among them
 * `heart_rate_intraday` (~5-second-cadence HR, the single biggest payload) —
 * through a real {@link import('@/services/workers/WorkerPool')} over the real
 * {@link import('@/services/workers/fitbitParser.worker')}, with each file's
 * `ArrayBuffer` TRANSFERRED in and a `Comlink.proxy(onProgress)` callback passed
 * across the worker boundary (ADR 0027).
 *
 * A Comlink bug in the worker's timeout wrapper
 * ({@link import('@/services/workers/createWorker')}'s `withTimeout`) was nesting
 * the call's argument list, so the `Comlink.proxy(callback)` lost its top-level
 * proxy marker and Comlink tried to `structuredClone` the callback — throwing a
 * `DataCloneError`. The orchestrator's broad per-file/per-type catch then
 * SWALLOWED that as a recoverable parser error and pressed on, so the intraday
 * import silently stored ZERO records while the wizard still reported a finished
 * import. There was NO end-to-end coverage of this path: every existing
 * GoogleHealthImportService test injects a fake/no pool and runs the parser
 * cores inline, so none of them ever cross the real `createWorker` boundary.
 *
 * This spec drives the GENUINE pipeline through the running app:
 *   scan → ImportController.startFitbit → GoogleHealthImportService.import →
 *   real WorkerPool → fitbitParser.worker (real Comlink transfer + proxied
 *   progress) → IndexedDB store → wizard terminal summary
 * and asserts that the heavy `heart_rate_intraday` type imports a NON-ZERO
 * record count and the import lands on the SUCCESS summary — never the
 * `Import failed` (DataCloneError) variant. That is exactly the journey that
 * silently failed.
 *
 * ── How the directory is driven (the feasibility key) ───────────────────────
 *
 * Unlike the CPAP source (a hidden `webkitdirectory` file input the EDF specs
 * inject a file LIST into), the Google Health source has NO file-input path. It
 * is gated entirely on `window.showDirectoryPicker()` returning a
 * `FileSystemDirectoryHandle`, which the scanner + import service walk with the
 * standard READ surface only — `getDirectoryHandle()`, `getFileHandle()`,
 * `getFile()`, and the `values()`/`entries()` async iterators. Playwright cannot
 * drive the native directory picker, but it does NOT need to: in Chromium an
 * OPFS root (`navigator.storage.getDirectory()`) is a genuine, spec-compliant
 * `FileSystemDirectoryHandle` exposing that exact read surface. So we:
 *
 *   1. Build a tiny Google-Health-shaped tree in OPFS (real handle, real files).
 *   2. Override `window.showDirectoryPicker` to hand the app that OPFS root.
 *
 * The app then runs its real scan + import against a real directory handle —
 * only the handle's SOURCE differs from a user-picked folder, and the code under
 * test treats both identically (it only ever reads). This is the directory-tree
 * analogue of the EDF specs' file-list injection.
 *
 * ── Engine scope ────────────────────────────────────────────────────────────
 *
 * Chromium only. The OPFS write API (`createWritable`) and a populated
 * `showDirectoryPicker` flow are reliably available there; WebKit/Firefox under
 * Playwright lack the full writable-OPFS + directory-handle surface this
 * fixture-build needs, and (as the sibling import specs document) WebKit cannot
 * drive a programmatic import to begin with. The cross-engine worker/clone
 * contract is locked deterministically at the unit layer (the real-Comlink proxy
 * test + the clone-failure test). Synthetic data only — no real PHI.
 */

// ── Fixture: a tiny heart_rate_intraday day ────────────────────────────────

/** Recording date for the synthetic intraday-HR day (arbitrary, stable). */
const HR_DATE = '2026-06-01';

/**
 * A handful of intraday HR samples in Fitbit's `Global Export Data` shape:
 * each entry is `{ dateTime: "MM/DD/YY HH:MM:SS", value: { bpm, confidence } }`.
 * The parser groups by each sample's own calendar date, so all of these collapse
 * into a SINGLE stored `heart_rate_intraday` record for 2026-06-01 — i.e. the
 * heavy type stores exactly 1 record. Kept to 6 samples so the file is bytes,
 * not megabytes (the bug was about the path, not the volume).
 */
const HR_SAMPLES = [
  { dateTime: '06/01/26 23:00:00', value: { bpm: 58, confidence: 2 } },
  { dateTime: '06/01/26 23:00:05', value: { bpm: 59, confidence: 2 } },
  { dateTime: '06/01/26 23:00:10', value: { bpm: 61, confidence: 1 } },
  { dateTime: '06/01/26 23:00:15', value: { bpm: 60, confidence: 2 } },
  { dateTime: '06/01/26 23:00:20', value: { bpm: 62, confidence: 0 } },
  { dateTime: '06/01/26 23:00:25', value: { bpm: 63, confidence: 2 } },
] as const;

/**
 * Build a Google-Health-shaped OPFS tree and override `showDirectoryPicker` to
 * return its root. Runs in the page so it touches the page's real OPFS + window.
 *
 * Layout (matches `scanner.ts`'s recognised sources):
 *   <root>/Global Export Data/heart_rate-2026-06-01.json   → heart_rate_intraday
 *   <root>/Sleep Score/sleep_score.csv                     → sleep_score
 *
 * The scanner needs ≥2 known subdirectories to recognise a folder as the export
 * root, so the tiny `Sleep Score/sleep_score.csv` is included purely to satisfy
 * root detection (it is NOT selected for import). `heart_rate-*.json` under
 * `Global Export Data` is the heavy, worker-parsed type under test.
 */
async function seedGoogleHealthOpfs(
  page: Page,
  hrDate: string,
  hrSamples: readonly { dateTime: string; value: { bpm: number; confidence: number } }[],
): Promise<void> {
  await page.evaluate(
    async ({ date, samples }) => {
      const root = await navigator.storage.getDirectory();

      // Start from a clean root so re-runs (or a retried test) never accumulate
      // stale entries that could perturb scan counts.
      const rootIter = root as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>;
      };
      for await (const [name] of rootIter.entries()) {
        await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      }

      // Global Export Data/heart_rate-<date>.json — the heavy, worker-parsed type.
      const ged = await root.getDirectoryHandle('Global Export Data', { create: true });
      const hr = await ged.getFileHandle(`heart_rate-${date}.json`, { create: true });
      const hrW = await hr.createWritable();
      await hrW.write(JSON.stringify(samples));
      await hrW.close();

      // Sleep Score/sleep_score.csv — second known subdir, for root detection only.
      const ss = await root.getDirectoryHandle('Sleep Score', { create: true });
      const ssf = await ss.getFileHandle('sleep_score.csv', { create: true });
      const ssW = await ssf.createWritable();
      await ssW.write('sleep_log_entry_id,timestamp,overall_score\n');
      await ssW.close();

      // Hand the app this OPFS root in place of the native directory picker.
      (
        window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker = () => Promise.resolve(root);
    },
    { date: hrDate, samples: hrSamples as unknown[] },
  );
}

/**
 * Read the numeric value rendered next to a summary label in the terminal
 * {@link import('@/components/import/ImportSummary')} stat grid. Mirrors the
 * helper in `import-wizard.spec.ts`: each stat is an `.item` with a `.value`
 * span and a `.label` span (CSS-module hashed → matched by substring). Returns
 * `null` when no stat carries that exact label.
 */
async function summaryValueFor(page: Page, label: string): Promise<string | null> {
  const item = page.locator(
    `#main-content [class*="item"]:has([class*="label"]:text-is("${label}"))`,
  );
  if ((await item.count()) === 0) return null;
  return (await item.locator('[class*="value"]').first().textContent())?.trim() ?? null;
}

test.describe('Google Health import — heavy intraday-HR through the real worker', () => {
  // Chromium-only: the OPFS writable + directory-handle surface this fixture
  // builds is reliably available there. See the file header for the rationale.
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Requires writable OPFS + showDirectoryPicker injection (Chromium only); cross-engine clone contract is unit-tested',
  );

  test('imports a non-zero intraday-HR record count and completes WITHOUT a DataCloneError', async ({
    page,
  }) => {
    await page.goto('/data/import');
    await expect(page.getByRole('heading', { name: /import data/i })).toBeVisible();

    // Build the OPFS export tree + stub the directory picker BEFORE selecting
    // the source. (The app is already loaded, so we seed directly rather than
    // via addInitScript — OPFS persists for the context and the picker override
    // only needs to exist by the time the source card is clicked.)
    await seedGoogleHealthOpfs(page, HR_DATE, HR_SAMPLES);

    // Select the Google Health source. This calls the stubbed
    // showDirectoryPicker → hands the app the OPFS root → runs the REAL scan,
    // which advances the wizard to the Preview step.
    await page.getByRole('button', { name: 'Import from Google Health (Fitbit)' }).click();

    // ── Preview: the heavy intraday-HR type was discovered by the real scan. ──
    // Its checkbox is `Include <label>` where the label is
    // FITBIT_DATA_TYPE_LABEL['heart_rate_intraday'] === 'Heart Rate (Intraday)'.
    const hrCheckbox = page.getByRole('checkbox', { name: 'Include Heart Rate (Intraday)' });
    await expect(hrCheckbox).toBeVisible({ timeout: 15_000 });

    // The wizard pre-selects EVERY scanned type. To keep this import a pure
    // exercise of the heavy worker path (and a clean, deterministic SUCCESS),
    // deselect everything else — leaving ONLY the intraday-HR type — so the
    // header-only Sleep Score stub (present solely for root detection) can never
    // contribute a warning that would flip the summary to the partial variant.
    const allChecked = page.getByRole('checkbox', { name: /^Include / });
    const total = await allChecked.count();
    for (let i = 0; i < total; i++) {
      const cb = allChecked.nth(i);
      const name = (await cb.getAttribute('aria-label')) ?? '';
      const isHr = name === 'Include Heart Rate (Intraday)';
      if (isHr && !(await cb.isChecked())) await cb.check();
      if (!isHr && (await cb.isChecked())) await cb.uncheck();
    }
    await expect(hrCheckbox).toBeChecked();

    // Kick off the genuine import: ImportController.startFitbit → real
    // GoogleHealthImportService.import → real WorkerPool → fitbitParser.worker.
    await page.getByRole('button', { name: /import \d+ selected data types/i }).click();

    // ── Terminal summary: SUCCESS, never the DataCloneError failure variant. ──
    // A clean import of valid samples (no warnings/errors) resolves to the
    // success "Import complete" heading. The regression made this land on
    // "Import failed" (DataCloneError) OR report complete-with-zero-records;
    // both are excluded below.
    const summaryHeading = page.locator('#main-content h2');
    await expect(summaryHeading).toHaveText('Import complete', { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Import failed' })).toHaveCount(0);

    // No per-file error disclosure — the swallowed DataCloneError used to surface
    // here (or, worse, not at all while records were silently dropped).
    await expect(page.getByRole('button', { name: /file error/i })).toHaveCount(0);

    // ── The heavy intraday-HR records were ACTUALLY imported (non-zero). ──
    // This is the load-bearing assertion: the bug stored ZERO while reporting a
    // finished import. The 6 same-day samples collapse to exactly 1 stored
    // `heart_rate_intraday` record, so "Records imported" must read a positive
    // integer (1 here). We assert strictly > 0 rather than pinning the exact
    // count, so the guard survives fixture tweaks but still fails hard on the
    // zero-record regression.
    const recordsImported = await summaryValueFor(page, 'Records imported');
    expect(recordsImported).not.toBeNull();
    const importedCount = Number((recordsImported ?? '0').replace(/[^\d]/g, ''));
    expect(importedCount).toBeGreaterThan(0);

    // And at least one data type was imported (the heavy intraday-HR type).
    const typesImported = await summaryValueFor(page, 'Data types imported');
    expect(Number((typesImported ?? '0').replace(/[^\d]/g, ''))).toBeGreaterThan(0);
  });
});
