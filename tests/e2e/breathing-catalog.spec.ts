import { test, expect, type Page } from '@playwright/test';

import {
  currentDetectionId,
  daysAgoStr,
  installHeldWorkerPool,
  releaseHeldCompute,
  clickUntilPhase,
  gotoCatalogHeld,
  opfsSupported,
  seedCachedNight,
  seedOpfsMissNight,
  type SeedEpisodeSpec,
} from './_support/breathing';

/**
 * E2E coverage for the redesigned Explore → Breathing Patterns **Episode
 * Catalog** (persisted cache + unbounded streaming + cancel/resume).
 *
 * Spec: docs/design/breathing-catalog-streaming-ux.md — §11 acceptance
 * checklist, §9 canonical copy table, §6 accessibility. Assertions match the
 * canonical copy strings verbatim where the spec pins them.
 *
 * Data strategy (see tests/e2e/_support/breathing.ts):
 *  - Cache-seeded nights (`breathing_detections` L2 hits) drive the warm-cache,
 *    filter, drill-down, empty-state and a11y scenarios — fully deterministic,
 *    no OPFS I/O, no worker compute.
 *  - One OPFS "miss" night + a held worker-pool stub parks the run in the
 *    `computing` phase to drive Cancel / Resume without arbitrary sleeps.
 *
 * The catalog `[data-phase]` attribute on the status line is the load-bearing
 * state signal used for web-first phase assertions.
 */

const ROUTE = '/explore/breathing';

const KNOWN_NOISE = [
  /React Router/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
  /Breathing-detection cache write failed/i, // best-effort persist on miss
];
function isRealError(text: string): boolean {
  return !KNOWN_NOISE.some((re) => re.test(text));
}

/** Catalog status line — carries `data-phase` and the canonical status copy. */
function statusLine(page: Page) {
  return page.locator('[data-phase]');
}

async function bootApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
}

// The catalog requires OPFS (full-resolution airflow). The Linux headless WebKit
// build ships without `navigator.storage`, so the OPFS-dependent scenarios are
// skipped there and the §8.2 unsupported state is asserted in its own block.
// Chromium + Firefox support OPFS and run the full matrix. (Real Safari supports
// OPFS — this is purely a headless-Linux WebKit limitation.)
test.describe('Episode catalog — requires OPFS (skipped where unsupported)', () => {
  test.beforeEach(async ({ page }) => {
    const supported = await opfsSupported(page);
    test.skip(!supported, 'Browser lacks OPFS (navigator.storage.getDirectory).');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1 & 2. Warm cache: catalog renders, progress completes, dual-count complete
  //        copy; the reading-cache phase resolves the seeded nights.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — warm cache render & completion', () => {
    test('renders seeded episodes and shows the dual-count complete copy', async ({ page }) => {
      await bootApp(page);

      const dateA = daysAgoStr(3);
      const dateB = daysAgoStr(5);
      const idA = await currentDetectionId(page, 'sess-A');
      const idB = await currentDetectionId(page, 'sess-B');
      await seedCachedNight(page, {
        sessionId: 'sess-A',
        date: dateA,
        detectionId: idA,
        episodes: [{ type: 'PeriodicBreathing', confidence: 0.9 }],
      });
      await seedCachedNight(page, {
        sessionId: 'sess-B',
        date: dateB,
        detectionId: idB,
        episodes: [{ type: 'CheyneStokes', confidence: 0.7 }],
      });

      await page.goto(ROUTE);
      await expect(page.getByRole('heading', { name: /breathing patterns/i })).toBeVisible();

      // Catalog reaches the terminal complete phase.
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });

      // Both seeded nights stream in as rows.
      await expect(page.getByRole('cell', { name: dateA })).toBeVisible();
      await expect(page.getByRole('cell', { name: dateB })).toBeVisible();

      // Canonical §9 "Complete" copy: dual count "showing X of Y from M of N nights".
      await expect(statusLine(page)).toContainText('Showing 2 of 2 episodes from 2 of 2 nights.');

      // The progress / Cancel controls are gone on completion.
      await expect(page.getByRole('button', { name: 'Cancel breathing analysis' })).toHaveCount(0);
    });

    test('a fully-cached range resolves through the reading-cache phase (no compute)', async ({
      page,
    }) => {
      await bootApp(page);
      const date = daysAgoStr(4);
      const id = await currentDetectionId(page, 'sess-warm');
      await seedCachedNight(page, {
        sessionId: 'sess-warm',
        date,
        detectionId: id,
        episodes: [{ type: 'PeriodicBreathing', confidence: 0.85 }],
      });

      await page.goto(ROUTE);
      // A fully warm range never enters `computing`; it ends at `complete`.
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });
      await expect(page.getByRole('cell', { name: date })).toBeVisible();
      // nightsCached reflected in the complete copy (1 of 1 nights).
      await expect(statusLine(page)).toContainText('from 1 of 1 night.');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Filters (Pattern / Min confidence / Sort) update the table WITHOUT
  //    restarting analysis; the dual-count copy separates filtered vs analysed.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — filters do not restart analysis', () => {
    async function seedMixed(page: Page): Promise<{ pbDate: string; csrDate: string }> {
      const pbDate = daysAgoStr(3);
      const csrDate = daysAgoStr(6);
      const idPb = await currentDetectionId(page, 'sess-pb');
      const idCsr = await currentDetectionId(page, 'sess-csr');
      const pb: SeedEpisodeSpec = { type: 'PeriodicBreathing', confidence: 0.4 };
      const csr: SeedEpisodeSpec = { type: 'CheyneStokes', confidence: 0.95 };
      await seedCachedNight(page, {
        sessionId: 'sess-pb',
        date: pbDate,
        detectionId: idPb,
        episodes: [pb],
      });
      await seedCachedNight(page, {
        sessionId: 'sess-csr',
        date: csrDate,
        detectionId: idCsr,
        episodes: [csr],
      });
      return { pbDate, csrDate };
    }

    test('pattern + confidence filters re-filter live; phase stays complete', async ({ page }) => {
      await bootApp(page);
      const { pbDate, csrDate } = await seedMixed(page);

      await page.goto(ROUTE);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });
      await expect(statusLine(page)).toContainText('Showing 2 of 2 episodes from 2 of 2 nights.');

      // Filter to Cheyne-Stokes only — table now shows 1 row, analysis NOT restarted.
      // The Pattern <Select> (Radix combobox) has no aria-label; its accessible
      // name is empty, so target it by its current value text "All".
      await page.getByRole('combobox').filter({ hasText: 'All' }).click();
      await page.getByRole('option', { name: 'Cheyne-Stokes' }).click();

      await expect(page.getByRole('cell', { name: csrDate })).toBeVisible();
      await expect(page.getByRole('cell', { name: pbDate })).toHaveCount(0);
      // Dual count: filtered (1) vs detected total (2). Phase must remain complete.
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete');
      await expect(statusLine(page)).toContainText('Showing 1 of 2 episodes');

      // Analysis did NOT restart: no Cancel control reappears (a restart would
      // re-enter reading-cache/computing and show Cancel), and the progress bar —
      // which the view keeps visible at completion — stays at 100% (valuenow ==
      // valuemax) rather than resetting to a fresh run.
      await expect(page.getByRole('button', { name: 'Cancel breathing analysis' })).toHaveCount(0);
      const bar = page.getByRole('progressbar');
      const now = await bar.getAttribute('aria-valuenow');
      const max = await bar.getAttribute('aria-valuemax');
      expect(now).toBe(max);
    });

    test('raising min confidence past all episodes shows the filtered-empty copy', async ({
      page,
    }) => {
      await bootApp(page);
      await seedMixed(page); // PB 0.40, CSR 0.95

      await page.goto(ROUTE);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });

      // Drag the Min-confidence slider to 100% via keyboard (End key).
      const slider = page.getByRole('slider');
      await slider.focus();
      await slider.press('End');

      // Canonical §8.1(3) filtered-out-complete copy.
      await expect(statusLine(page)).toContainText('No episodes match the current filters.');
      await expect(statusLine(page)).toContainText('2 episodes detected across the range');
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Cancel during a run keeps partial results + shows Resume; Resume completes.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — cancel keeps partial results, resume completes', () => {
    test('cancel parks the run, keeps cached rows, shows Resume; resume reaches complete', async ({
      page,
    }) => {
      await installHeldWorkerPool(page);
      await bootApp(page);

      // One cached night (streams in immediately) + one OPFS miss (parks compute).
      const cachedDate = daysAgoStr(2);
      const missDate = daysAgoStr(8);
      const idCached = await currentDetectionId(page, 'sess-cached');
      await seedCachedNight(page, {
        sessionId: 'sess-cached',
        date: cachedDate,
        detectionId: idCached,
        episodes: [{ type: 'PeriodicBreathing', confidence: 0.8 }],
      });
      await seedOpfsMissNight(page, 'sess-miss', missDate);

      // Park the run in a held computing phase with Cancel visible.
      await gotoCatalogHeld(page, ROUTE);
      const cancel = page.getByRole('button', { name: 'Cancel breathing analysis' });
      await expect(cancel).toBeVisible();
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'computing');

      // The already-cached night is on screen even mid-run (partial results).
      await expect(page.getByRole('cell', { name: cachedDate })).toBeVisible();

      // Cancel → cancelled state, partial rows kept, Resume offered.
      await clickUntilPhase(page, cancel, 'cancelled');
      const resume = page.getByRole('button', { name: /Resume breathing analysis/ });
      await expect(resume).toBeVisible();
      // Canonical §8.4 cancelled copy + the still-cached row.
      await expect(statusLine(page)).toContainText('Analysis cancelled.');
      await expect(statusLine(page)).toContainText('not yet analyzed.');
      await expect(page.getByRole('cell', { name: cachedDate })).toBeVisible();

      // Resume → releasing the held compute drives the run to complete. Release any
      // already-held promise first, click Resume, then release the resumed pass.
      await releaseHeldCompute(page);
      await resume.click();
      await releaseHeldCompute(page);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });
      // The cached row survives through to completion.
      await expect(page.getByRole('cell', { name: cachedDate })).toBeVisible();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. The "(truncated to keep the page responsive)" message is GONE.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — no truncation message', () => {
    test('a large cached range shows no "truncated" copy', async ({ page }) => {
      await bootApp(page);

      // Seed 28 cached nights (all within the default last-30-days range) — a
      // large, fully-streamed catalog. The old code appended a "(truncated…)" note
      // for capped ranges; we assert it is gone for any size.
      for (let i = 1; i <= 28; i++) {
        const date = daysAgoStr(i);
        const sid = `sess-big-${i}`;
        const id = await currentDetectionId(page, sid);
        await seedCachedNight(page, {
          sessionId: sid,
          date,
          detectionId: id,
          episodes: i % 3 === 0 ? [{ type: 'PeriodicBreathing', confidence: 0.6 }] : [],
        });
      }

      // The default range is the last 30 days, so ~30 of the 75 seeded nights are
      // in scope — already well past the old 60-night cap's behaviour of appending
      // a "(truncated…)" note once the in-scope count was large. We assert the
      // removed copy never appears regardless of how many nights stream in.
      await page.goto(ROUTE);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 20_000 });

      // The removed copy must never appear, regardless of range size.
      await expect(page.getByText(/truncated/i)).toHaveCount(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Drill-down: episode row → Open link routes to the signal viewer with the
  //    episode time range query params.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — drill-down to signal viewer', () => {
    test('row select shows detail; Open routes to /sessions/:id/signals with time range', async ({
      page,
    }) => {
      await bootApp(page);
      const date = daysAgoStr(3);
      const id = await currentDetectionId(page, 'sess-drill');
      await seedCachedNight(page, {
        sessionId: 'sess-drill',
        date,
        detectionId: id,
        episodes: [{ type: 'PeriodicBreathing', confidence: 0.9 }],
      });

      await page.goto(ROUTE);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });

      // Selecting the night populates the "Selected episode" detail card.
      await page.getByRole('button', { name: date }).click();
      await expect(page.getByRole('heading', { name: 'Selected episode' })).toBeVisible();
      await expect(page.getByText('Periodic breathing (candidate)')).toBeVisible();

      // The row's "Open" link carries the episode's start/end as query params.
      const openLink = page.getByRole('link', { name: /Open/ }).first();
      await expect(openLink).toHaveAttribute(
        'href',
        new RegExp(`/sessions/sess-drill/signals\\?t=\\d+&te=\\d+`),
      );
      await openLink.click();
      await expect(page).toHaveURL(/\/sessions\/sess-drill\/signals\?t=\d+&te=\d+/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Empty / none-detected states (canonical §8.1 copy).
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — empty states', () => {
    test('no sessions in range → "No sessions in the selected date range" copy', async ({
      page,
    }) => {
      await bootApp(page);
      await page.goto(ROUTE);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });
      await expect(statusLine(page)).toContainText(
        'No sessions in the selected date range. Adjust the date range to analyze your therapy nights.',
      );
      await expect(page.getByRole('progressbar')).toHaveCount(0);
    });

    test('analyzed nights with no episodes → "none detected" finding copy', async ({ page }) => {
      await bootApp(page);
      const date = daysAgoStr(3);
      const id = await currentDetectionId(page, 'sess-none');
      // Cached record with an empty episode list = analyzed, none found.
      await seedCachedNight(page, { sessionId: 'sess-none', date, detectionId: id, episodes: [] });

      await page.goto(ROUTE);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });
      await expect(statusLine(page)).toContainText(
        'No candidate periodic-breathing or Cheyne-Stokes episodes were detected across 1 analyzed night.',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Accessibility smoke: progressbar ARIA + keyboard-operable Cancel/Resume.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — accessibility', () => {
    test('progressbar exposes role + valuemin/max/now/text matching the phase copy', async ({
      page,
    }) => {
      await installHeldWorkerPool(page);
      await bootApp(page);
      await seedOpfsMissNight(page, 'sess-a11y', daysAgoStr(5));

      await gotoCatalogHeld(page, ROUTE);
      // Parked in computing → the progress bar is present.
      const bar = page.getByRole('progressbar');
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute('aria-valuemin', '0');
      await expect(bar).toHaveAttribute('aria-valuemax', '1'); // nightsTotal = 1
      await expect(bar).toHaveAttribute('aria-valuenow', /\d+/);
      await expect(bar).toHaveAttribute('aria-label', 'Breathing analysis progress');
      // valuetext is a sentence (UX §6.1), not a bare ratio.
      await expect(bar).toHaveAttribute('aria-valuetext', /nights/);
    });

    test('Cancel and Resume are keyboard-operable', async ({ page }) => {
      await installHeldWorkerPool(page);
      await bootApp(page);
      await seedOpfsMissNight(page, 'sess-kbd', daysAgoStr(5));

      await gotoCatalogHeld(page, ROUTE);
      const cancel = page.getByRole('button', { name: 'Cancel breathing analysis' });
      await expect(cancel).toBeVisible();

      // Cancel is reachable from the keyboard; Enter activates it (re-pressing if
      // a keypress is dropped mid-render — polls the phase, no fixed sleeps).
      await cancel.focus();
      await expect(cancel).toBeFocused();
      for (let i = 0; i < 4; i++) {
        await cancel.press('Enter').catch(() => {});
        const phase = await statusLine(page).getAttribute('data-phase');
        if (phase === 'cancelled') break;
      }
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'cancelled');

      // UX spec §6.5 / §11 acceptance: pressing Cancel must MOVE focus to the new
      // Resume control so a keyboard/SR user is never dropped onto <body>. The
      // view captures focus intent at the moment Cancel is pressed (a one-shot
      // ref), then moves focus once the phase parks at `cancelled` — robust to the
      // activating button unmounting and focus transiently falling to <body>.
      const resume = page.getByRole('button', { name: /Resume breathing analysis/ });
      await expect(resume).toBeVisible();
      await expect(resume).toBeFocused();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Console hygiene — no real application errors across the catalog journey.
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('Episode catalog — console hygiene', () => {
    test('no real console errors rendering a cached catalog', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isRealError(msg.text())) errors.push(msg.text());
      });
      page.on('pageerror', (err) => {
        if (isRealError(err.message)) errors.push(err.message);
      });

      await bootApp(page);
      const date = daysAgoStr(3);
      const id = await currentDetectionId(page, 'sess-clean');
      await seedCachedNight(page, {
        sessionId: 'sess-clean',
        date,
        detectionId: id,
        episodes: [{ type: 'PeriodicBreathing', confidence: 0.8 }],
      });
      await page.goto(ROUTE);
      await expect(statusLine(page)).toHaveAttribute('data-phase', 'complete', { timeout: 15_000 });

      expect(errors).toEqual([]);
    });
  });
}); // end "requires OPFS" wrapper

// ═══════════════════════════════════════════════════════════════════════════
// OPFS-unsupported environment (§8.2). Runs only where OPFS is missing (e.g.
// headless Linux WebKit); asserts the catalog surfaces an inline error state
// rather than a progress bar or table.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Episode catalog — OPFS unsupported state', () => {
  test('renders the unavailable-in-this-browser error, no progress bar', async ({ page }) => {
    const supported = await opfsSupported(page);
    test.skip(supported, 'Browser supports OPFS — covered by the main matrix.');

    await page.goto(ROUTE);
    // The hook detects the OPFS capability gate; the status line is in the
    // terminal `error` phase. The view presents the canonical §9 copy (mapping the
    // hook's terse technical string to the patient-facing message), not the raw
    // hook string — see §8.2/§9 of the streaming-UX spec.
    await expect(statusLine(page)).toHaveAttribute('data-phase', 'error', { timeout: 15_000 });
    // The visible error paragraph carries the canonical §9 copy (the polite live
    // region also carries the same text).
    await expect(
      page.getByText(/Breathing analysis isn't available in this browser/i).last(),
    ).toBeVisible();
    await expect(
      page.getByText(/Origin Private File System \(OPFS\) to read your full-resolution/i).last(),
    ).toBeVisible();
    // No progress bar / Cancel in the capability-failure state (§8.2).
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel breathing analysis' })).toHaveCount(0);
  });
});
