import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard E2E Tests — Phase 5
 *
 * Tests the full dashboard lifecycle:
 * 1. Empty state → import wizard → dashboard transition
 * 2. KPI card values after data injection
 * 3. Date range preset switching with different session counts
 * 4. Session table column sorting
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

    // 5. Navigate back to dashboard — should show populated dashboard, not empty state
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CPAP Analyzer' })).not.toBeVisible();

    // KPI cards should be present
    const kpiSection = page.locator('section[aria-label="Key performance indicators"]');
    await expect(kpiSection).toBeVisible();
    await expect(kpiSection.getByText('AHI')).toBeVisible();
    await expect(kpiSection.getByText('Compliance')).toBeVisible();
  });
});

test.describe('Dashboard — KPI Values After Import', () => {
  test('displays correct KPI values from injected data', async ({ page }) => {
    const date = daysAgoStr(3);
    const session = makeSession('sess-kpi-1', date, 480, 420);
    const aggregate = makeAggregate('agg-kpi-1', 'sess-kpi-1', date, 5.2, 8.1, 7.0);

    await setupDashboardWithData(page, [session], [aggregate]);

    // Verify dashboard heading
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Verify KPI section exists
    const kpiSection = page.locator('section[aria-label="Key performance indicators"]');
    await expect(kpiSection).toBeVisible();

    // AHI card — value should be 5.2
    await expect(kpiSection.getByText('5.2')).toBeVisible();
    await expect(kpiSection.getByText('events/hr')).toBeVisible();

    // Leak Rate card — value should be 8.1
    await expect(kpiSection.getByText('8.1')).toBeVisible();
    await expect(kpiSection.getByText('L/min')).toBeVisible();

    // Usage card — value should be 7.0
    await expect(kpiSection.getByText('7.0')).toBeVisible();
    await expect(kpiSection.getByText('hrs/night')).toBeVisible();

    // Compliance card — 1 compliant session out of 1 = 100%
    await expect(kpiSection.getByRole('article', { name: /Compliance: 100 %/ })).toBeVisible();
  });

  test('shows Recent Sessions section with session table', async ({ page }) => {
    const date = daysAgoStr(1);
    const session = makeSession('sess-table-1', date, 450, 400);
    const aggregate = makeAggregate('agg-table-1', 'sess-table-1', date, 2.8, 3.5, 6.7);

    await setupDashboardWithData(page, [session], [aggregate]);

    // Recent Sessions heading
    await expect(page.getByRole('heading', { name: 'Recent Sessions' })).toBeVisible();

    // Table should be rendered with column headers
    await expect(page.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Duration' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Usage' })).toBeVisible();

    // At least one data row should exist
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('renders severity badge for mild AHI', async ({ page }) => {
    const date = daysAgoStr(2);
    const session = makeSession('sess-severity-1', date);
    // AHI 5.2 → mild severity (5 ≤ AHI < 15)
    const aggregate = makeAggregate('agg-severity-1', 'sess-severity-1', date, 5.2);

    await setupDashboardWithData(page, [session], [aggregate]);

    const kpiSection = page.locator('section[aria-label="Key performance indicators"]');
    await expect(kpiSection.getByText('mild')).toBeVisible();
  });
});

test.describe('Dashboard — Date Range Preset Switching', () => {
  // Create sessions across different date ranges:
  // - 2 sessions within last 7 days
  // - 2 sessions within last 30 days but outside 7 days
  // - 1 session outside 30 days but within 90 days
  //
  // Expected counts:
  //   Last 7 days  → 2
  //   Last 30 days → 4 (default)
  //   Last 90 days → 5
  //   All time     → 5

  function createMultiRangeSessions() {
    const recentDate1 = daysAgoStr(1);
    const recentDate2 = daysAgoStr(3);
    const midDate1 = daysAgoStr(15);
    const midDate2 = daysAgoStr(20);
    const oldDate1 = daysAgoStr(60);

    const sessions = [
      makeSession('sess-range-r1', recentDate1, 480, 420),
      makeSession('sess-range-r2', recentDate2, 450, 400),
      makeSession('sess-range-m1', midDate1, 420, 380),
      makeSession('sess-range-m2', midDate2, 400, 350),
      makeSession('sess-range-o1', oldDate1, 500, 450),
    ];

    const aggregates = [
      makeAggregate('agg-range-r1', 'sess-range-r1', recentDate1, 3.0, 4.0, 7.5),
      makeAggregate('agg-range-r2', 'sess-range-r2', recentDate2, 4.0, 5.0, 6.5),
      makeAggregate('agg-range-m1', 'sess-range-m1', midDate1, 5.0, 6.0, 8.0),
      makeAggregate('agg-range-m2', 'sess-range-m2', midDate2, 2.0, 3.0, 5.0),
      makeAggregate('agg-range-o1', 'sess-range-o1', oldDate1, 6.0, 7.0, 7.0),
    ];

    return { sessions, aggregates };
  }

  test('default 30-day range shows correct session count', async ({ page }) => {
    const { sessions, aggregates } = createMultiRangeSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    // Default is "Last 30 days" → 4 sessions
    await expect(page.locator('tbody tr')).toHaveCount(4);
  });

  test('switching to "Last 7 days" reduces session count', async ({ page }) => {
    const { sessions, aggregates } = createMultiRangeSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    // Default shows 4 sessions
    await expect(page.locator('tbody tr')).toHaveCount(4);

    // Open the date range selector and switch to "Last 7 days"
    await page.getByRole('combobox', { name: 'Date range' }).click();
    await page.getByRole('option', { name: 'Last 7 days' }).click();

    // Should now show only 2 sessions
    await expect(page.locator('tbody tr')).toHaveCount(2);
  });

  test('switching to "All time" shows all sessions', async ({ page }) => {
    const { sessions, aggregates } = createMultiRangeSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    // Default shows 4 sessions
    await expect(page.locator('tbody tr')).toHaveCount(4);

    // Switch to "All time"
    await page.getByRole('combobox', { name: 'Date range' }).click();
    await page.getByRole('option', { name: 'All time' }).click();

    // Should show all 5 sessions
    await expect(page.locator('tbody tr')).toHaveCount(5);
  });

  test('switching presets updates table row count', async ({ page }) => {
    const { sessions, aggregates } = createMultiRangeSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    // Default (30d) → 4 rows
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(4);

    // Switch to "Last 7 days" → 2 rows
    await page.getByRole('combobox', { name: 'Date range' }).click();
    await page.getByRole('option', { name: 'Last 7 days' }).click();
    await expect(rows).toHaveCount(2);

    // Switch to "All time" → 5 rows
    await page.getByRole('combobox', { name: 'Date range' }).click();
    await page.getByRole('option', { name: 'All time' }).click();
    await expect(rows).toHaveCount(5);
  });
});

test.describe('Dashboard — Session Table Sort', () => {
  function createSortTestSessions() {
    const date1 = daysAgoStr(1);
    const date2 = daysAgoStr(5);
    const date3 = daysAgoStr(10);

    const sessions = [
      makeSession('sess-sort-1', date1, 480, 420), // 8h duration
      makeSession('sess-sort-2', date2, 360, 330), // 6h duration
      makeSession('sess-sort-3', date3, 540, 500), // 9h duration
    ];

    const aggregates = [
      makeAggregate('agg-sort-1', 'sess-sort-1', date1, 3.0, 4.0, 7.0),
      makeAggregate('agg-sort-2', 'sess-sort-2', date2, 5.0, 6.0, 5.5),
      makeAggregate('agg-sort-3', 'sess-sort-3', date3, 2.0, 3.0, 8.3),
    ];

    return { sessions, aggregates };
  }

  test('Date column defaults to descending sort', async ({ page }) => {
    const { sessions, aggregates } = createSortTestSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    const dateHeader = page.getByRole('columnheader', { name: 'Date' });
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');

    // Other columns should have aria-sort="none"
    const durationHeader = page.getByRole('columnheader', { name: 'Duration' });
    await expect(durationHeader).toHaveAttribute('aria-sort', 'none');
  });

  test('clicking Date column toggles sort direction', async ({ page }) => {
    const { sessions, aggregates } = createSortTestSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    const dateHeader = page.getByRole('columnheader', { name: 'Date' });

    // Initial: descending
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');

    // Click → ascending
    await dateHeader.click();
    await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');

    // Click again → descending
    await dateHeader.click();
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
  });

  test('clicking a different column changes sort target', async ({ page }) => {
    const { sessions, aggregates } = createSortTestSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    const dateHeader = page.getByRole('columnheader', { name: 'Date' });
    const durationHeader = page.getByRole('columnheader', { name: 'Duration' });

    // Initial: Date descending
    await expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(durationHeader).toHaveAttribute('aria-sort', 'none');

    // Click Duration → Duration becomes descending, Date becomes none
    await durationHeader.click();
    await expect(durationHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(dateHeader).toHaveAttribute('aria-sort', 'none');

    // Click Duration again → toggles to ascending
    await durationHeader.click();
    await expect(durationHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  test('sort indicators (▲/▼) appear on active sort column', async ({ page }) => {
    const { sessions, aggregates } = createSortTestSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    const dateHeader = page.getByRole('columnheader', { name: 'Date' });

    // Default: descending arrow
    await expect(dateHeader.getByText('▼')).toBeVisible();

    // Click → ascending arrow
    await dateHeader.click();
    await expect(dateHeader.getByText('▲')).toBeVisible();

    // Switch to Duration
    const durationHeader = page.getByRole('columnheader', { name: 'Duration' });
    await durationHeader.click();
    await expect(durationHeader.getByText('▼')).toBeVisible();

    // Date column should no longer have a sort arrow
    await expect(dateHeader.getByText('▲')).not.toBeVisible();
    await expect(dateHeader.getByText('▼')).not.toBeVisible();
  });

  test('table always shows all rows regardless of sort', async ({ page }) => {
    const { sessions, aggregates } = createSortTestSessions();
    await setupDashboardWithData(page, sessions, aggregates);

    const rows = page.locator('tbody tr');

    // 3 rows initially
    await expect(rows).toHaveCount(3);

    // Sort by Date ascending — still 3 rows
    await page.getByRole('columnheader', { name: 'Date' }).click();
    await expect(rows).toHaveCount(3);

    // Sort by Duration — still 3 rows
    await page.getByRole('columnheader', { name: 'Duration' }).click();
    await expect(rows).toHaveCount(3);

    // Sort by Usage — still 3 rows
    await page.getByRole('columnheader', { name: 'Usage' }).click();
    await expect(rows).toHaveCount(3);
  });
});
