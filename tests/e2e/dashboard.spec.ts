import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard E2E Tests — Signal Deck
 *
 * Tests the full dashboard lifecycle against the "Signal Deck" home layout:
 * 1. Empty state → import wizard → populated dashboard transition
 * 2. Signal small-multiples + Session log values after data injection
 * 3. 30D / 90D analysis-window switching (segmented control) changes the
 *    Session-log row count
 * 4. Severity surfacing (a mild-AHI night is labelled "mild" in the deck)
 *
 * Data is injected directly into IndexedDB via page.evaluate() to avoid
 * browser-specific quirks with webkitdirectory file inputs.
 */

// ── Constants ──

const DB_NAME = 'cpap-analyzer';
// Note: no DB_VERSION constant. The seed helper opens the app DB with a
// version-less indexedDB.open(name) so it attaches to whatever schema version
// the app has already created. Pinning a version here breaks whenever the app
// bumps its schema (a version-less open never throws VersionError on migration).
const MACHINE_ID = '23241654214';
const MACHINE_MODEL = 'AirSense 11 AutoSet';

// ── Test Data Factories ──

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

// ── IndexedDB Helpers ──

/**
 * Inject sessions and aggregates into the app's IndexedDB.
 * The app must have loaded at least once to create the schema.
 */
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

          for (const session of sessions) {
            sessionsStore.put(session);
          }
          for (const aggregate of aggregates) {
            aggregatesStore.put(aggregate);
          }

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
 * Load the app to create DB schema, inject data, then reload to pick it up.
 * Returns after the dashboard heading is visible (data loaded).
 */
async function setupDashboardWithData(
  page: Page,
  sessions: ReturnType<typeof makeSession>[],
  aggregates: ReturnType<typeof makeAggregate>[],
): Promise<void> {
  // First load: creates the DB schema
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();

  // Inject data
  await injectTestData(page, sessions, aggregates);

  // Reload so hooks re-fetch and find the data
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

// ── Test Groups ──

test.describe('Dashboard — Empty State → Import → Dashboard Transition', () => {
  test('navigates from empty state to import wizard and back to populated dashboard', async ({
    page,
  }) => {
    // 1. Visit / — verify empty state
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'CPAP Analyzer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Your Data' })).toBeVisible();
    await expect(
      page.getByText('All data processing happens locally. Nothing leaves your device.'),
    ).toBeVisible();

    // 2. Click CTA → navigate to import wizard
    await page.getByRole('button', { name: 'Import Your Data' }).click();
    await expect(page).toHaveURL(/\/data\/import$/);
    await expect(page.getByRole('heading', { name: /import data/i })).toBeVisible();

    // 3. Verify import wizard renders at "Select" step
    const stepNav = page.getByRole('navigation', { name: /import progress steps/i });
    await expect(stepNav).toBeVisible();
    await expect(stepNav.getByText('Select')).toBeVisible();

    // 4. Inject data into IndexedDB (simulating a completed import)
    const date = daysAgoStr(2);
    const session = makeSession('sess-transition-1', date);
    const aggregate = makeAggregate('agg-transition-1', 'sess-transition-1', date, 4.1, 5.0, 7.5);
    await injectTestData(page, [session], [aggregate]);

    // 5. Navigate back to dashboard — should show the populated Signal Deck,
    //    not the empty state.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CPAP Analyzer' })).not.toBeVisible();

    // The deck's analysis-window control and Session log should be present.
    await expect(page.getByRole('radio', { name: 'Last 30 days' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Session log' })).toBeVisible();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  });
});

test.describe('Dashboard — Signal Deck Values After Import', () => {
  test('small-multiples and Session log show the injected values', async ({ page }) => {
    const date = daysAgoStr(3);
    const session = makeSession('sess-vals-1', date, 480, 420);
    // AHI 5.2, leakMedian 4.5, usageHours 7.0. A single night, so the pooled
    // (usage-hours-weighted) mean AHI equals the night's AHI → 5.2.
    const aggregate = makeAggregate('agg-vals-1', 'sess-vals-1', date, 5.2, 4.5, 7.0);

    await setupDashboardWithData(page, [session], [aggregate]);

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Signal small-multiples panel: AHI cell shows the pooled value.
    const smallMultiples = page
      .getByRole('heading', { name: 'Signal small-multiples' })
      .locator('..');
    await expect(smallMultiples).toBeVisible();
    await expect(smallMultiples.getByText('AHI', { exact: true })).toBeVisible();
    await expect(smallMultiples.getByText('5.2')).toBeVisible();

    // Session log renders exactly one row carrying the injected AHI (the AHI
    // cell's accessible name embeds the numeric value and severity word).
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.getByRole('cell', { name: /AHI 5\.2/ })).toBeVisible();
  });

  test('renders the Session log table with its column headers', async ({ page }) => {
    const date = daysAgoStr(1);
    const session = makeSession('sess-log-1', date, 450, 400);
    const aggregate = makeAggregate('agg-log-1', 'sess-log-1', date, 2.8, 3.5, 6.7);

    await setupDashboardWithData(page, [session], [aggregate]);

    // Session log heading (replaces the old "Recent Sessions").
    await expect(page.getByRole('heading', { name: 'Session log' })).toBeVisible();

    // Native <th scope="col"> headers — Date, Dur, Usage, AHI, Leak, Events,
    // Event mix. These are NOT sortable (no aria-sort / column-click sort).
    await expect(page.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Dur' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Usage' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'AHI' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Leak' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Events' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Event mix' })).toBeVisible();

    // One data row.
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  });

  test('surfaces "mild" severity for a mild-AHI night', async ({ page }) => {
    const date = daysAgoStr(2);
    const session = makeSession('sess-severity-1', date);
    // AHI 5.2 → mild severity (5 ≤ AHI < 15).
    const aggregate = makeAggregate('agg-severity-1', 'sess-severity-1', date, 5.2);

    await setupDashboardWithData(page, [session], [aggregate]);

    // The Verdict card's deterministic range summary names the pooled severity
    // as visible text, e.g. "pooled AHI is 5.2/h (mild)".
    const verdict = page.getByRole('region', { name: 'Good-night rate verdict' });
    await expect(verdict.getByText(/\(mild\)/i)).toBeVisible();

    // The Session-log AHI cell also carries the severity word in its accessible
    // name, so colour is never the sole severity signal.
    await expect(page.getByRole('cell', { name: /AHI 5\.2, Mild/i })).toBeVisible();
  });
});

test.describe('Dashboard — Window Switching (30D / 90D)', () => {
  // The deck header's SegmentedControl toggles the global analysis window
  // between the 30-day (default) and 90-day presets. Nights inside 30 days show
  // under 30D; nights between 30 and 90 days only appear once 90D is selected.
  //
  // Expected Session-log row counts:
  //   30D (default) → 3 (nights at 5, 12, 20 days ago)
  //   90D           → 5 (adds nights at 45 and 60 days ago)

  function createWindowedSessions() {
    const withinDays = [5, 12, 20]; // inside the default 30-day window
    const olderDays = [45, 60]; // outside 30 days, inside 90 days
    const allDays = [...withinDays, ...olderDays];

    const sessions = allDays.map((d, i) => makeSession(`sess-win-${i}`, daysAgoStr(d), 480, 420));
    const aggregates = allDays.map((d, i) =>
      makeAggregate(`agg-win-${i}`, `sess-win-${i}`, daysAgoStr(d), 3.0 + i, 4.0 + i, 7.0),
    );

    return { sessions, aggregates };
  }

  test('default 30D window shows only the nights within 30 days', async ({ page }) => {
    const { sessions, aggregates } = createWindowedSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    // 30D is the default preset and is the selected segment.
    await expect(page.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Only the three within-30-day nights render in the Session log.
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(3);
  });

  test('switching to 90D reveals the older nights', async ({ page }) => {
    const { sessions, aggregates } = createWindowedSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    const rows = page.getByRole('table').locator('tbody tr');

    // Default 30D → 3 rows.
    await expect(rows).toHaveCount(3);

    // Toggle to the 90-day window via the segmented control.
    await page.getByRole('radio', { name: 'Last 90 days' }).click();
    await expect(page.getByRole('radio', { name: 'Last 90 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // The two older nights (45d, 60d) now join the three recent ones → 5 rows.
    await expect(rows).toHaveCount(5);
  });
});
