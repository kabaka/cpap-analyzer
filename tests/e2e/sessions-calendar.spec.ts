import { test, expect, type Page } from '@playwright/test';

/**
 * Sessions index — Table ⇄ Calendar view toggle, calendar metric selector, and
 * table page-size toggle (E2E).
 *
 * The Sessions index gained a `SegmentedControl` view toggle (Table | Calendar),
 * a calendar-only Metric selector (AHI | Usage | Leak), and a table-only "Rows
 * per page" selector (25 | 50 | 100). All three pieces of state live in the URL
 * query string (`?view=`, `?metric=`, `?size=`), with the default for each
 * represented by the ABSENCE of its param (clean URLs), mirroring the existing
 * `?page=N` convention. The calendar is the upgraded CalendarHeatmap rendered as
 * a `role="grid"` of `role="gridcell"`s whose aria-labels carry the date plus
 * the metric/state.
 *
 * Data-injection setup/teardown mirrors `sessions.spec.ts` exactly: Session +
 * NightlyAggregate records are written straight into the app's IndexedDB via
 * page.evaluate() (after one load creates the schema) to avoid file-import
 * flakiness, then we navigate to the target route.
 *
 * Selectors are role + accessible-name based (no CSS-module hashes):
 *  - View toggle:   role="radiogroup" aria-label "View"; radios "Table view" /
 *                   "Calendar view".
 *  - Metric:        role="radiogroup" aria-label "Metric"; radios
 *                   "Apnea–Hypopnea Index" / "Usage hours" / "Median leak".
 *  - Rows per page: role="radiogroup" aria-label "Rows per page"; radios
 *                   "25 rows per page" / "50 rows per page" / "100 rows per page".
 *  - Calendar:      role="grid"; role="gridcell" cells whose aria-label contains
 *                   the date plus the metric (value cells) or "no recorded
 *                   session" (gap cells).
 */

// ── Constants (mirror sessions.spec.ts) ──

const DB_NAME = 'cpap-analyzer';
const MACHINE_ID = '23241654214';
const MACHINE_MODEL = 'AirSense 11 AutoSet';

// ── Test Data Factories (copied verbatim from sessions.spec.ts) ──

/** Return a YYYY-MM-DD string for N days before today (local time). */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build a minimal Session record. */
function makeSession(id: string, date: string, durationMinutes = 480, usageMinutes = 420) {
  return {
    id,
    machineId: MACHINE_ID,
    machineModel: MACHINE_MODEL,
    machineType: 'cpap' as const,
    firmwareVersion: '3.0.2',
    date,
    startTime: `${date}T22:00:00Z`,
    endTime: `${date}T06:00:00Z`,
    durationMinutes,
    usageMinutes,
    importedAt: new Date().toISOString(),
    sourceHash: `hash-${id}`,
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
  };
}

/** Build a minimal NightlyAggregate record. */
function makeAggregate(
  id: string,
  sessionId: string,
  date: string,
  ahi = 3.2,
  leakMedian = 4.5,
  usageHours = 7.0,
) {
  return {
    id,
    sessionId,
    machineId: MACHINE_ID,
    date,
    ahi,
    ahiObstructive: 1.0,
    ahiCentral: 0.5,
    ahiMixed: 0.2,
    ahiHypopnea: 1.5,
    ahiRera: 0,
    eventCount: 12,
    eventsByType: {
      obstructive: 4,
      central: 2,
      mixed: 1,
      hypopnea: 5,
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
    leakMedian,
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
    maskOnTimeMinutes: usageHours * 60,
    complianceStatus: (usageHours >= 4 ? 'compliant' : 'non-compliant') as
      | 'compliant'
      | 'non-compliant',
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
  };
}

// ── IndexedDB Helpers (copied verbatim from sessions.spec.ts) ──

async function injectTestData(
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

/**
 * Load the app to create DB schema, inject data, then navigate to the target
 * route. Returns after the page has settled with the injected data.
 */
async function setupWithData(
  page: Page,
  sessions: ReturnType<typeof makeSession>[],
  aggregates: ReturnType<typeof makeAggregate>[],
  targetRoute = '/sessions',
): Promise<void> {
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await injectTestData(page, sessions, aggregates);
  await page.goto(targetRoute);
}

// ── Shared role-based locators ──

const viewToggle = (page: Page) => page.getByRole('radiogroup', { name: 'View' });
const metricToggle = (page: Page) => page.getByRole('radiogroup', { name: 'Metric' });
const sizeToggle = (page: Page) => page.getByRole('radiogroup', { name: 'Rows per page' });

const calendarGrid = (page: Page) => page.getByRole('grid', { name: /Calendar heatmap/i });

// ── Shared data builders ──

/**
 * Three sessions on distinct recent days, all inside the default last-30-days
 * window so no date-range change is needed.
 */
function createTestSessions() {
  const date1 = daysAgoStr(2);
  const date2 = daysAgoStr(5);
  const date3 = daysAgoStr(10);

  const sessions = [
    makeSession('sess-1', date1, 480, 420),
    makeSession('sess-2', date2, 360, 330),
    makeSession('sess-3', date3, 540, 500),
  ];
  const aggregates = [
    makeAggregate('agg-1', 'sess-1', date1, 3.2, 4.5, 7.0),
    makeAggregate('agg-2', 'sess-2', date2, 8.5, 6.0, 5.5),
    makeAggregate('agg-3', 'sess-3', date3, 2.1, 3.0, 8.3),
  ];
  return { sessions, aggregates, dates: [date1, date2, date3] };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Toggle Table ⇄ Calendar
// ────────────────────────────────────────────────────────────────────────────

test.describe('Sessions view toggle (Table ⇄ Calendar)', () => {
  test('switches between table and calendar and reflects ?view in the URL', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // Default: Table view — the table is present, the calendar grid is not, and
    // the URL carries no `view` param.
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(calendarGrid(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]view=/);
    await expect(viewToggle(page).getByRole('radio', { name: 'Table view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Switch to Calendar.
    await viewToggle(page).getByRole('radio', { name: 'Calendar view' }).click();

    // Calendar grid appears; the data table is gone; URL gains ?view=calendar.
    await expect(calendarGrid(page)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]view=calendar(&|$)/);
    await expect(viewToggle(page).getByRole('radio', { name: 'Calendar view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Switch back to Table — the calendar disappears and the `view` param is
    // dropped (Table is the default → clean URL).
    await viewToggle(page).getByRole('radio', { name: 'Table view' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(calendarGrid(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]view=/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2 & 3. Calendar renders nights + gaps, and cell navigation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Sessions calendar grid', () => {
  test('renders session nights and at least one gap cell', async ({ page }) => {
    // Two sessions a few days apart so the rendered window (the global range)
    // necessarily contains days with NO session → guaranteed gap cells.
    const dateA = daysAgoStr(3);
    const dateB = daysAgoStr(8);
    const sessions = [makeSession('cal-a', dateA), makeSession('cal-b', dateB)];
    const aggregates = [
      makeAggregate('cal-agg-a', 'cal-a', dateA, 4.0, 4.5, 7.0),
      makeAggregate('cal-agg-b', 'cal-b', dateB, 6.0, 5.0, 6.5),
    ];

    await setupWithData(page, sessions, aggregates, '/sessions?view=calendar');

    const grid = calendarGrid(page);
    await expect(grid).toBeVisible();

    // The default metric is AHI → value cells carry the AHI metric name in their
    // aria-label. Assert both seeded nights render as value cells.
    await expect(grid.getByRole('gridcell', { name: /AHI \(events\/h\)/ }).first()).toBeVisible();
    const valueCells = grid.getByRole('gridcell', { name: /AHI \(events\/h\)/ });
    expect(await valueCells.count()).toBeGreaterThanOrEqual(2);

    // At least one gap cell ("no recorded session") sits between/around the
    // seeded nights inside the rendered window.
    const gapCells = grid.getByRole('gridcell', { name: /no recorded session/ });
    expect(await gapCells.count()).toBeGreaterThanOrEqual(1);
  });

  test('clicking a session-day cell navigates to that session detail', async ({ page }) => {
    const dateA = daysAgoStr(3);
    const sessions = [makeSession('nav-sess', dateA)];
    const aggregates = [makeAggregate('nav-agg', 'nav-sess', dateA, 4.0, 4.5, 7.0)];

    await setupWithData(page, sessions, aggregates, '/sessions?view=calendar');

    const grid = calendarGrid(page);
    await expect(grid).toBeVisible();

    // Click the single session-day value cell → navigates to its detail.
    await grid
      .getByRole('gridcell', { name: /AHI \(events\/h\)/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/sessions\/nav-sess(\?|$)/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('keyboard Enter on a session-day cell navigates to that session detail', async ({
    page,
  }) => {
    const dateA = daysAgoStr(3);
    const sessions = [makeSession('kbd-sess', dateA)];
    const aggregates = [makeAggregate('kbd-agg', 'kbd-sess', dateA, 4.0, 4.5, 7.0)];

    await setupWithData(page, sessions, aggregates, '/sessions?view=calendar');

    const grid = calendarGrid(page);
    await expect(grid).toBeVisible();

    const valueCell = grid.getByRole('gridcell', { name: /AHI \(events\/h\)/ }).first();
    await valueCell.focus();
    await expect(valueCell).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sessions\/kbd-sess(\?|$)/);
  });

  test('clicking a gap cell does NOT navigate', async ({ page }) => {
    const dateA = daysAgoStr(3);
    const dateB = daysAgoStr(8);
    const sessions = [makeSession('gap-a', dateA), makeSession('gap-b', dateB)];
    const aggregates = [
      makeAggregate('gap-agg-a', 'gap-a', dateA, 4.0, 4.5, 7.0),
      makeAggregate('gap-agg-b', 'gap-b', dateB, 6.0, 5.0, 6.5),
    ];

    await setupWithData(page, sessions, aggregates, '/sessions?view=calendar');

    const grid = calendarGrid(page);
    await expect(grid).toBeVisible();

    // Click a gap cell — it is non-actionable, so we stay on /sessions in
    // calendar view (no /sessions/:id navigation).
    await grid
      .getByRole('gridcell', { name: /no recorded session/ })
      .first()
      .click();

    // Still on the sessions index in calendar view; no detail route.
    await expect(page).toHaveURL(/\/sessions(\?.*)?$/);
    await expect(page).not.toHaveURL(/\/sessions\/[^/?]+/);
    await expect(calendarGrid(page)).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Metric selector
// ────────────────────────────────────────────────────────────────────────────

test.describe('Sessions calendar metric selector', () => {
  test('switching metric updates ?metric and the legend caption; absent in table view', async ({
    page,
  }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    // In Table view the Metric selector is NOT present; the date search box IS.
    await expect(metricToggle(page)).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: /filter/i })).toBeVisible();

    // Switch to Calendar — Metric selector appears, the date search box is gone.
    await viewToggle(page).getByRole('radio', { name: 'Calendar view' }).click();
    await expect(metricToggle(page)).toBeVisible();
    await expect(page.getByRole('searchbox', { name: /filter/i })).toHaveCount(0);

    // Default metric AHI → no `metric` param; the heatmap legend is the AHI
    // legend. We assert on the legend LIST's accessible name (`<metric> legend`)
    // rather than getByText — the metric string also appears inside SVG <title>
    // / gridcell aria-labels (hidden nodes), and getByText would resolve to one
    // of those. The legend list name is unique and visible.
    await expect(page).not.toHaveURL(/[?&]metric=/);
    await expect(page.getByRole('list', { name: 'AHI (events/h) legend' })).toBeVisible();

    // Switch to Usage → ?metric=usage and the usage legend.
    await metricToggle(page).getByRole('radio', { name: 'Usage hours' }).click();
    await expect(page).toHaveURL(/[?&]metric=usage(&|$)/);
    await expect(page.getByRole('list', { name: 'Usage (hours) legend' })).toBeVisible();

    // Switch to Leak → ?metric=leak and the leak legend.
    await metricToggle(page).getByRole('radio', { name: 'Median leak' }).click();
    await expect(page).toHaveURL(/[?&]metric=leak(&|$)/);
    await expect(page.getByRole('list', { name: 'Leak median (L/min) legend' })).toBeVisible();

    // Switch back to AHI → the `metric` param is dropped (AHI is the default).
    await metricToggle(page).getByRole('radio', { name: 'Apnea–Hypopnea Index' }).click();
    await expect(page).not.toHaveURL(/[?&]metric=/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Page-size toggle (table)
// ────────────────────────────────────────────────────────────────────────────

test.describe('Sessions table page-size toggle', () => {
  // 40 sessions, all inside the default last-30-days window would not fit (only
  // 30 days), so we deliberately keep them within the last 28 days but allow two
  // per some days is messy — instead inject 40 distinct days and widen the range
  // is needed. To avoid the debounced ?start/&end race entirely we keep 28 days
  // (1 per day) which yields > 25 rows under the DEFAULT range: that's enough to
  // exercise 25 vs 50 (page 2 disappears at 50).
  function createManySessions(count: number) {
    const sessions = [];
    const aggregates = [];
    for (let i = 1; i <= count; i++) {
      const date = daysAgoStr(i);
      const id = `ps-sess-${String(i).padStart(3, '0')}`;
      sessions.push(makeSession(id, date));
      aggregates.push(makeAggregate(`ps-agg-${String(i).padStart(3, '0')}`, id, date));
    }
    return { sessions, aggregates };
  }

  test('switching from 25 to 50 rows shows more rows, sets ?size=50, and resets to page 1', async ({
    page,
  }) => {
    // 28 sessions in the last 28 days → all inside the default 30-day window, so
    // no date-range change (and no debounced URL write) is required.
    const { sessions, aggregates } = createManySessions(28);
    await setupWithData(page, sessions, aggregates, '/sessions');

    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // Default page size 25 → 25 rows on page 1, pagination present (28 > 25), and
    // no `size` param.
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await expect(page).not.toHaveURL(/[?&]size=/);
    await expect(page.getByText('Showing 1–25 of 28 sessions')).toBeVisible();
    await expect(sizeToggle(page).getByRole('radio', { name: '25 rows per page' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Go to page 2 first so we can prove the size change resets the page.
    await page.getByRole('button', { name: 'Page 2' }).click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);

    // Switch to 50 rows.
    await sizeToggle(page).getByRole('radio', { name: '50 rows per page' }).click();

    // URL gains size=50 and the page param is dropped (reset to page 1).
    await expect(page).toHaveURL(/[?&]size=50(&|$)/);
    await expect(page).not.toHaveURL(/[?&]page=/);

    // All 28 rows now fit on a single page (≤ 50), and pagination collapses to a
    // single page (the "Page 2" button disappears).
    const rows = page.locator('tbody tr');
    expect(await rows.count()).toBeLessThanOrEqual(50);
    expect(await rows.count()).toBeGreaterThan(25);
    await expect(page.getByRole('button', { name: 'Page 2' })).toHaveCount(0);
    await expect(sizeToggle(page).getByRole('radio', { name: '50 rows per page' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('page-size selector is not present in calendar view', async ({ page }) => {
    const { sessions, aggregates } = createManySessions(28);
    await setupWithData(page, sessions, aggregates, '/sessions?view=calendar');

    await expect(calendarGrid(page)).toBeVisible();
    await expect(sizeToggle(page)).toHaveCount(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. URL deep-link + browser Back/Forward
// ────────────────────────────────────────────────────────────────────────────

test.describe('Sessions view URL deep-link & history', () => {
  test('deep-link to ?view=calendar&metric=leak lands in calendar/leak', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions?view=calendar&metric=leak');

    // Calendar grid is shown and the Leak metric is selected.
    await expect(calendarGrid(page)).toBeVisible();
    await expect(metricToggle(page).getByRole('radio', { name: 'Median leak' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('list', { name: 'Leak median (L/min) legend' })).toBeVisible();
    // Calendar cells reflect the leak metric in their aria-labels.
    await expect(
      calendarGrid(page)
        .getByRole('gridcell', { name: /Leak median \(L\/min\)/ })
        .first(),
    ).toBeVisible();
  });

  test('browser Back/Forward restores the view across a table→calendar switch', async ({
    page,
  }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    // Start in Table.
    await expect(page.locator('tbody tr')).toHaveCount(3);

    // The view toggle uses { replace: true } (does NOT push history). To get a
    // restorable history entry we deep-link to the calendar via a fresh
    // navigation (push), which the existing urlPage regression mirrors for
    // page-state restoration through Back.
    await page.goto('/sessions?view=calendar');
    await expect(calendarGrid(page)).toBeVisible();
    await expect(page).toHaveURL(/[?&]view=calendar(&|$)/);

    // Back → returns to the plain table URL and the table view.
    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]view=/);
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(calendarGrid(page)).toHaveCount(0);

    // Forward → calendar restored.
    await page.goForward();
    await expect(page).toHaveURL(/[?&]view=calendar(&|$)/);
    await expect(calendarGrid(page)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Accessibility smoke
// ────────────────────────────────────────────────────────────────────────────

test.describe('Sessions view a11y smoke', () => {
  test('view toggle radios are keyboard reachable and operable', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    // The selected "Table view" radio is the group's single tab stop (roving
    // tabindex): it carries tabindex=0 while the unselected segment is -1.
    const tableRadio = viewToggle(page).getByRole('radio', { name: 'Table view' });
    const calendarRadio = viewToggle(page).getByRole('radio', { name: 'Calendar view' });
    await expect(tableRadio).toHaveAttribute('tabindex', '0');
    await expect(calendarRadio).toHaveAttribute('tabindex', '-1');

    // Focus the tab stop and drive selection with the keyboard. ArrowRight in the
    // radiogroup pattern selects "Calendar view", which flips the view. We assert
    // on the OBSERVABLE effects (selection state, the revealed calendar, the URL)
    // rather than DOM `:focus`, keeping the check independent of OS-level window
    // activation across the Chromium/Firefox/WebKit matrix.
    await tableRadio.focus();
    await page.keyboard.press('ArrowRight');

    await expect(calendarRadio).toHaveAttribute('aria-checked', 'true');
    await expect(tableRadio).toHaveAttribute('aria-checked', 'false');
    // Roving tabindex moved with the selection.
    await expect(calendarRadio).toHaveAttribute('tabindex', '0');
    await expect(calendarGrid(page)).toBeVisible();
    await expect(page).toHaveURL(/[?&]view=calendar(&|$)/);
  });

  test('arrow keys move focus between calendar gridcells', async ({ page }) => {
    // A contiguous run of nights so an adjacent cell in the grid is also a
    // session cell (ArrowRight moves +1 day). Use 4 consecutive days.
    const sessions = [];
    const aggregates = [];
    const dates: string[] = [];
    for (let i = 5; i >= 2; i--) {
      const date = daysAgoStr(i);
      dates.push(date);
      const id = `a11y-${i}`;
      sessions.push(makeSession(id, date));
      aggregates.push(makeAggregate(`a11y-agg-${i}`, id, date, 4.0, 4.5, 7.0));
    }

    await setupWithData(page, sessions, aggregates, '/sessions?view=calendar');

    const grid = calendarGrid(page);
    await expect(grid).toBeVisible();

    // Focus the roving tab stop (the most-recent session cell by default) and
    // capture which date it is, then ArrowLeft to move one day earlier.
    const firstCell = grid.getByRole('gridcell', { name: /AHI \(events\/h\)/ }).last();
    await firstCell.focus();
    const beforeLabel = await firstCell.getAttribute('aria-label');

    await page.keyboard.press('ArrowLeft');

    // Focus moved to a DIFFERENT gridcell (one day earlier). We assert the
    // focused element is a gridcell with a different aria-label, keeping the
    // check engine-agnostic (no reliance on exact date arithmetic in the test).
    const focused = page.locator('[role="gridcell"]:focus');
    await expect(focused).toHaveCount(1);
    const afterLabel = await focused.getAttribute('aria-label');
    expect(afterLabel).not.toBeNull();
    expect(afterLabel).not.toEqual(beforeLabel);
  });
});
