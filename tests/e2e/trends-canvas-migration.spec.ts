import { test, expect, type Page } from '@playwright/test';

/**
 * Trends — Canvas2D migration end-to-end coverage (ADR 0025)
 *
 * The six Trends charts were migrated from Recharts/SVG to a Canvas2D base
 * (series/grid/axes) + transparent overlay-canvas crosshair + retained HTML/SVG
 * chrome (figure/title/footnote/SR table/legend/tooltip/clinician prompt/
 * settings-change markers), with NO intended appearance or feature change.
 *
 * This spec locks the migration's USER-OBSERVABLE behavior through the real
 * router, store, and IndexedDB-backed `useNightlyAggregates` hook:
 *
 *   (a) the chart canvases render and the page is interactive,
 *   (b) the synced hover state crosses the stacked charts (hover one chart →
 *       another chart's tooltip reflects the same active night — they share
 *       `SyncedChartContext`),
 *   (c) click-to-navigate from a chart goes to that night's session detail,
 *   (d) the settings-change marker's native title/aria-label hover affordance
 *       still exists over the canvas,
 *   (e) the Event Breakdown legend and (when the central trend is rising) the
 *       clinician prompt render.
 *
 * Seeding mirrors `trends-central-safety.spec.ts` (version-less IndexedDB
 * injection, same factories), so the two specs stay consistent. The
 * safety-critical clinician-prompt gate itself lives in that sibling spec; this
 * one covers the rest of the migration surface.
 */

// ── Constants ──

const DB_NAME = 'cpap-analyzer';

// ── Date helpers (local calendar day, matching src/utils/formatDate.ts) ──

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Test data factories (kept in sync with trends-central-safety.spec.ts) ──

function makeSession(id: string, date: string) {
  return {
    id,
    machineId: 'TEST-MACHINE',
    machineModel: 'AirSense 11 AutoSet',
    machineType: 'cpap' as const,
    firmwareVersion: '3.0.2',
    date,
    startTime: `${date}T22:00:00Z`,
    endTime: `${date}T06:00:00Z`,
    durationMinutes: 480,
    usageMinutes: 420,
    importedAt: new Date().toISOString(),
    sourceHash: `hash-${id}`,
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
  };
}

interface AggregateOpts {
  centralIndex: number;
  configuredMinPressure?: number | null;
  configuredMaxPressure?: number | null;
  eprLevel?: number | null;
}

function makeAggregate(id: string, sessionId: string, date: string, opts: AggregateOpts) {
  const usageHours = 7;
  const centralCount = Math.round(opts.centralIndex * usageHours);
  return {
    id,
    sessionId,
    machineId: 'TEST-MACHINE',
    date,
    ahi: 3.2 + opts.centralIndex,
    ahiObstructive: 1.0,
    ahiCentral: opts.centralIndex,
    ahiMixed: 0.0,
    ahiHypopnea: 1.5,
    ahiRera: 0,
    eventCount: 12 + centralCount,
    eventsByType: {
      obstructive: 8,
      central: centralCount,
      mixed: 0,
      hypopnea: 6,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10.5,
    pressureMedian: 10.0,
    pressureP95: 12.5,
    pressureMax: 14.0,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 4.5,
    leakP95: 12.0,
    leakMax: 25.0,
    leakDurationMinutes: 5,
    tidalVolumeMean: null,
    tidalVolumeMedian: null,
    minuteVentMean: null,
    respRateMean: null,
    respRateMedian: null,
    spo2Mean: null,
    spo2Median: null,
    spo2Min: null,
    spo2Below90Percent: null,
    oxygenDesaturationIndex: null,
    usageHours,
    maskOnTimeMinutes: 420,
    complianceStatus: 'compliant' as const,
    configuredMinPressure: opts.configuredMinPressure ?? null,
    configuredMaxPressure: opts.configuredMaxPressure ?? null,
    eprLevel: opts.eprLevel ?? null,
    notes: '',
    tags: [],
  };
}

/**
 * 8 consecutive nights (newest = index 0). All nights carry a benign, flat
 * central index so the rising-central clinician prompt does NOT fire — this
 * spec exercises the general migration surface, not the safety gate (which has
 * its own spec). A single configured-max-pressure change is introduced on the
 * 6th-oldest night so EXACTLY ONE settings-change marker is rendered, giving the
 * affordance test (d) a deterministic target.
 */
function createStableData() {
  const sessions = Array.from({ length: 8 }, (_, i) => makeSession(`sess-${i}`, daysAgoStr(i)));
  // daysAgoStr(7) is oldest, daysAgoStr(0) newest. Older half runs max=12,
  // newer half runs max=15 → one change on the boundary night (index 3).
  const aggregates = sessions.map((s, i) =>
    makeAggregate(`agg-${i}`, s.id, s.date, {
      centralIndex: 0.5,
      configuredMinPressure: 6,
      configuredMaxPressure: i < 4 ? 15 : 12,
    }),
  );
  return { sessions, aggregates };
}

/** Rising-central variant (reuses the safety spec's qualifying shape) so test
 *  (e) can also confirm the clinician prompt renders post-migration. */
function createRisingCentralData() {
  const sessions = Array.from({ length: 8 }, (_, i) => makeSession(`sess-${i}`, daysAgoStr(i)));
  const aggregates = sessions.map((s, i) =>
    makeAggregate(`agg-${i}`, s.id, s.date, { centralIndex: i < 4 ? 4.0 : 0.5 }),
  );
  return { sessions, aggregates };
}

// ── IndexedDB injection (version-less open; attaches to the app's schema) ──

async function injectData(
  page: Page,
  sessions: ReturnType<typeof makeSession>[],
  aggregates: ReturnType<typeof makeAggregate>[],
): Promise<void> {
  await page.evaluate(
    ({ dbName, sessions, aggregates }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['sessions', 'nightly_aggregates'], 'readwrite');
          const sessionsStore = tx.objectStore('sessions');
          const aggregatesStore = tx.objectStore('nightly_aggregates');
          for (const session of sessions) sessionsStore.put(session);
          for (const aggregate of aggregates) aggregatesStore.put(aggregate);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Transaction failed'));
          };
        };
      });
    },
    { dbName: DB_NAME, sessions, aggregates },
  );
}

async function seedAndOpenTrends(
  page: Page,
  data: {
    sessions: ReturnType<typeof makeSession>[];
    aggregates: ReturnType<typeof makeAggregate>[];
  },
): Promise<void> {
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await injectData(page, data.sessions, data.aggregates);
  await page.goto('/trends');
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible({ timeout: 15_000 });
}

// ═══════════════════════════════════════════════════════════════════════════

test.describe('Trends — Canvas2D migration (ADR 0025)', () => {
  // ── (a) canvases render + page interactive ────────────────────────────────
  test('renders the six charts as canvases with HTML chrome and is interactive', async ({
    page,
  }) => {
    await seedAndOpenTrends(page, createStableData());

    // Each chart sits in a role="figure" panel with a retained HTML title.
    const figures = page.getByRole('figure');
    await expect(figures.first()).toBeVisible({ timeout: 15_000 });
    // AHI, Usage, Leak Rate, Pressure, Event Breakdown, Settings = 6 panels.
    await expect(figures).toHaveCount(6);

    // The visible chart headings survive the migration (titles per component).
    for (const title of [
      'AHI',
      'Usage Hours',
      'Leak Rate',
      'Pressure',
      'Event Breakdown',
      'Machine Settings',
    ]) {
      await expect(page.getByRole('heading', { name: title, exact: true, level: 3 })).toBeVisible();
    }

    // Charts are now <canvas> (a base + an overlay per interactive chart). The
    // 5 data charts each contribute 2 canvases; assert we have a healthy count
    // of canvases actually attached and sized > 0 (i.e. the renderer ran).
    const canvasCount = await page.locator('section[role="figure"] canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(10);

    const sized = await page
      .locator('section[role="figure"] canvas')
      .first()
      .evaluate((el) => {
        const c = el as HTMLCanvasElement;
        return c.width > 0 && c.height > 0;
      });
    expect(sized).toBe(true);

    // SR data tables (the non-visual content the canvas conveys graphically)
    // are retained; the AHI table caption is a stable anchor.
    await expect(page.getByText(/rolling median and typical nightly range/i)).toBeAttached();
  });

  // ── (b) synced hover crosses the stacked charts ──────────────────────────
  test('hovering one chart drives the synced active night across charts', async ({ page }) => {
    await seedAndOpenTrends(page, createStableData());

    // The interactive hit surface is the role="presentation" wrapper over each
    // chart's canvas pair. The first belongs to the AHI chart.
    const ahiSurface = page.locator('div[role="presentation"]').first();
    await expect(ahiSurface).toBeVisible();

    const box = await ahiSurface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Hover near the right edge (a recent, known night). The plot has a 48px
    // right gutter; stay left of it so we land on a real category.
    const hoverX = box.x + box.width - 60;
    const hoverY = box.y + box.height / 2;
    await page.mouse.move(hoverX, hoverY);

    // The hovered chart (AHI) surfaces its median-led tooltip (role="status").
    const ahiTooltip = page.getByText(/Rolling median AHI:/i);
    await expect(ahiTooltip).toBeVisible({ timeout: 5_000 });

    // SYNC PROOF: the Event Breakdown chart — a DIFFERENT chart — renders ITS
    // tooltip from the same shared SyncedChartContext active index. So hovering
    // AHI must surface the Event Breakdown tooltip too, for the SAME night.
    const ahiDate =
      (await ahiTooltip.locator('xpath=ancestor::div[@role="status"]').first().textContent()) ?? '';
    const isoMatch = ahiDate.match(/\d{4}-\d{2}-\d{2}/);
    expect(isoMatch, 'AHI tooltip should show an ISO night date').not.toBeNull();

    const breakdownTooltip = page
      .getByText(/Obstructive:/)
      .locator('xpath=ancestor::div[@role="status"]')
      .first();
    await expect(breakdownTooltip).toBeVisible({ timeout: 5_000 });
    if (isoMatch) {
      await expect(breakdownTooltip).toContainText(isoMatch[0]);
    }

    // Moving the pointer off the chart clears the synced state (tooltips hide).
    await page.mouse.move(box.x - 50, box.y - 50);
    await expect(ahiTooltip).toBeHidden({ timeout: 5_000 });
  });

  // ── (c) click-to-navigate to the session/day ─────────────────────────────
  test('clicking a chart navigates to that night’s session detail', async ({ page }) => {
    await seedAndOpenTrends(page, createStableData());

    const ahiSurface = page.locator('div[role="presentation"]').first();
    const box = await ahiSurface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Click the right-most category (newest night → sess-0, the first session
    // chronologically-newest). We assert we land on SOME /sessions/:id route,
    // not the exact id, to stay resilient to hit-test rounding at the edge.
    await page.mouse.click(box.x + box.width - 60, box.y + box.height / 2);

    await expect(page).toHaveURL(/\/sessions\/sess-\d+/, { timeout: 10_000 });
  });

  // ── (d) settings-change marker affordance over the canvas ─────────────────
  test('settings-change marker keeps its native title/aria-label hover affordance', async ({
    page,
  }) => {
    await seedAndOpenTrends(page, createStableData());

    // The marker overlay carries an invisible wider hit-rect with role="img"
    // plus a native title + aria-label (e.g. "2026-… : max 15 → 12"). The seeded
    // data has exactly one configured-max-pressure change, so EXACTLY ONE marker
    // exists per chart that renders the overlay (AHI, Leak, Pressure, Event
    // Breakdown each render it). Assert the affordance exists and is described.
    const markers = page.getByRole('img', { name: /\d{4}-\d{2}-\d{2}/ });
    await expect(markers.first()).toBeAttached({ timeout: 15_000 });

    const first = markers.first();
    const title = await first.getAttribute('title');
    const ariaLabel = await first.getAttribute('aria-label');
    expect(title, 'marker should keep its native title affordance').toBeTruthy();
    expect(ariaLabel, 'marker should keep its aria-label').toBeTruthy();
    // The human-readable diff is surfaced (configured max pressure changed).
    expect(title).toMatch(/max\b.*\d+(\.\d+)?\s*→\s*\d+(\.\d+)?/i);
    expect(ariaLabel).toBe(title);
  });

  // ── (e) Event Breakdown legend + clinician prompt render ──────────────────
  test('Event Breakdown legend renders all series after migration', async ({ page }) => {
    await seedAndOpenTrends(page, createStableData());

    // Scope to the Event Breakdown figure so we read its legend, not stray text.
    const panel = page
      .getByRole('figure')
      .filter({ has: page.getByRole('heading', { name: 'Event Breakdown' }) });
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // The bottom legend (replacing the Recharts <Legend>) lists every series as
    // a list item. Match the <li> by its text (the legend is aria-hidden chrome
    // mirrored by the SR table, so target the list items directly).
    for (const label of [
      'Obstructive',
      'Central (modeled)',
      'Hypopnea',
      'Mixed',
      'RERA (modeled)',
    ]) {
      await expect(panel.locator('li', { hasText: label })).toHaveCount(1);
    }

    // The low-reliability caveat footnote is retained as HTML chrome.
    await expect(panel.getByText(/modeled inferences/i)).toBeVisible();
  });

  test('rising central trend still surfaces the clinician prompt + legend after migration', async ({
    page,
  }) => {
    await seedAndOpenTrends(page, createRisingCentralData());

    const panel = page
      .getByRole('figure')
      .filter({ has: page.getByRole('heading', { name: 'Event Breakdown' }) });

    // Prompt (role="status") coexists with the migrated canvas chart + legend.
    const prompt = page.getByTestId('central-clinician-prompt');
    await expect(prompt).toBeVisible({ timeout: 15_000 });
    await expect(prompt).toHaveAttribute('role', 'status');
    await expect(panel.getByText('Central (modeled)', { exact: true })).toBeAttached();
  });
});
