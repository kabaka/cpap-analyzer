import { test, expect, type Page } from '@playwright/test';

/**
 * Analysis Views E2E Tests — Phase 9
 *
 * Verifies that the analysis UI views and chart library render correctly
 * in real browsers with injected IndexedDB data. Tests cover:
 *
 * 1. Navigation — all analysis view routes render correct headings
 * 2. Empty state — views show appropriate empty state when no data
 * 3. Data-injected rendering — charts and tables render with seeded data
 * 4. Parameter changes — metric/window/filter/grouping controls update UI
 * 5. Tab navigation — StatisticalAnalysis tabs switch content
 * 6. Chart containers — title, "View as Table" toggle, "Export PNG" button
 * 7. Theme changes — charts survive theme toggle without crash
 * 8. No console errors — no real application errors during navigation
 * 9. Chart export — PNG export button is present and clickable
 */

// ── Theme dropdown helpers ──
// The Phase 1 chrome redesign replaced the old single cycling "Switch theme"
// button with a dropdown menu: an icon trigger named "Theme: <Setting>" that
// opens Light/Dark/System `menuitemradio` options. Mirrors tests/e2e/theme.spec.ts.

const themeTrigger = (page: Page) => page.getByRole('button', { name: /^Theme:/ });
const themeOption = (page: Page, name: 'Light' | 'Dark' | 'System') =>
  page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) });

async function selectTheme(page: Page, name: 'Light' | 'Dark' | 'System') {
  await themeTrigger(page).click();
  // Radix renders the menu into a portal on open; wait for it to mount.
  await expect(page.getByRole('menuitemradio').first()).toBeVisible();
  await themeOption(page, name).click();
}

// ── Constants ──

const DB_NAME = 'cpap-analyzer';
// Note: no DB_VERSION constant. The seed helper opens the app DB with a
// version-less indexedDB.open(name) so it attaches to whatever schema version
// the app has already created. Pinning a version here breaks whenever the app
// bumps its schema (a version-less open never throws VersionError on migration).

// ── Test Data Factories ──

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

function makeAggregate(
  id: string,
  sessionId: string,
  date: string,
  overrides: Partial<{
    ahi: number;
    pressureMean: number;
    pressureMedian: number;
    pressureP95: number;
    leakMedian: number;
    usageHours: number;
  }> = {},
) {
  return {
    id,
    sessionId,
    machineId: 'TEST-MACHINE',
    date,
    ahi: overrides.ahi ?? 3.2,
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
    pressureMean: overrides.pressureMean ?? 10.5,
    pressureMedian: overrides.pressureMedian ?? 10.0,
    pressureP95: overrides.pressureP95 ?? 12.5,
    pressureMax: 14.0,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: overrides.leakMedian ?? 4.5,
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
    usageHours: overrides.usageHours ?? 7.0,
    maskOnTimeMinutes: 420,
    complianceStatus: 'compliant' as const,
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
  };
}

function makeEvent(
  id: string,
  sessionId: string,
  timestamp: number,
  type: string,
  duration: number,
) {
  return {
    id,
    sessionId,
    type,
    timestamp,
    duration,
    severity: null,
    pressure: 10.5,
    epap: null,
    ipap: null,
    leak: 4.5,
    spo2: null,
    clusterId: null,
  };
}

// ── Shared test data ──

function createTestSessions(count = 14) {
  return Array.from({ length: count }, (_, i) => makeSession(`sess-${i}`, daysAgoStr(i)));
}

function createTestAggregates(sessions: ReturnType<typeof makeSession>[]) {
  return sessions.map((s, i) =>
    makeAggregate(`agg-${i}`, s.id, s.date, {
      ahi: 2.0 + i * 0.8,
      pressureMean: 9.0 + i * 0.3,
      pressureMedian: 8.8 + i * 0.3,
      pressureP95: 11.0 + i * 0.2,
      leakMedian: 3.0 + i * 0.5,
      usageHours: 5.5 + (i % 4) * 0.5,
    }),
  );
}

function createTestEvents(sessions: ReturnType<typeof makeSession>[]) {
  const types = ['ObstructiveApnea', 'CentralApnea', 'Hypopnea', 'ObstructiveApnea', 'Hypopnea'];
  const events: ReturnType<typeof makeEvent>[] = [];
  let eventIdx = 0;

  for (const session of sessions) {
    const baseTimestamp = new Date(`${session.date}T23:00:00Z`).getTime();
    // 5 events per session, spaced 30 minutes apart
    for (let j = 0; j < 5; j++) {
      events.push(
        makeEvent(
          `evt-${eventIdx}`,
          session.id,
          baseTimestamp + j * 30 * 60 * 1000,
          types[j % types.length]!,
          10 + (j % 3) * 5,
        ),
      );
      eventIdx++;
    }
  }

  return events;
}

// ── IndexedDB Helpers ──

async function injectTestData(
  page: Page,
  sessions: ReturnType<typeof makeSession>[],
  aggregates: ReturnType<typeof makeAggregate>[],
  events: ReturnType<typeof makeEvent>[] = [],
): Promise<void> {
  await page.evaluate(
    ({ dbName, sessions, aggregates, events }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const storeNames =
            events.length > 0
              ? ['sessions', 'nightly_aggregates', 'events']
              : ['sessions', 'nightly_aggregates'];
          const tx = db.transaction(storeNames, 'readwrite');
          const sessionsStore = tx.objectStore('sessions');
          const aggregatesStore = tx.objectStore('nightly_aggregates');
          for (const session of sessions) sessionsStore.put(session);
          for (const aggregate of aggregates) aggregatesStore.put(aggregate);
          if (events.length > 0) {
            const eventsStore = tx.objectStore('events');
            for (const event of events) eventsStore.put(event);
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
    { dbName: DB_NAME, sessions, aggregates, events },
  );
}

/**
 * Navigate to a route, injecting test data first.
 * Navigates to '/' first to initialise the DB schema, injects data,
 * then navigates to the target route.
 */
async function setupAndNavigate(
  page: Page,
  route: string,
  options?: { includeEvents?: boolean },
): Promise<void> {
  // First load to create the DB schema
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();

  const sessions = createTestSessions();
  const aggregates = createTestAggregates(sessions);
  const events = options?.includeEvents ? createTestEvents(sessions) : [];

  await injectTestData(page, sessions, aggregates, events);
  await page.goto(route);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Navigation — All analysis view routes render correctly
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Navigation', () => {
  test('statistical analysis route renders heading', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();
  });

  // Event Explorer (`/explore/events`) smoke navigation lives in
  // `tests/e2e/explore-views.spec.ts` (post-IA heading: `Event Explorer`).

  test('pressure optimization route renders heading', async ({ page }) => {
    await page.goto('/explore/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Empty State — Views show empty state when no data is present
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Empty State', () => {
  test('statistical analysis shows empty state without data', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    // StatisticalAnalysis always renders controls+tabs; with no data, descriptive stats table shows Count=0
    const table = page.locator('table[aria-label*="Descriptive statistics"]');
    await expect(table).toBeVisible({ timeout: 15_000 });
    const countRow = table.locator('tr', { hasText: 'Count' });
    await expect(countRow).toContainText('0');
  });

  // Event Explorer empty-state coverage lives in
  // `tests/e2e/explore-views.spec.ts` (asserts the post-IA "No events in this
  // date range" heading rather than the deleted EventAnalysis "No data
  // available" string).

  test('pressure optimization shows empty state without data', async ({ page }) => {
    await page.goto('/explore/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();

    // Wait for loading to finish and empty state text to appear
    await expect(page.getByText(/no data available/i)).toBeVisible({ timeout: 15_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Data-Injected Rendering — Charts and tables render with seeded data
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Data-Injected Rendering', () => {
  test('statistical analysis renders descriptive stats table with data', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    // Default tab is Descriptive Stats — wait for the statistics table
    const table = page.locator('table[aria-label*="Descriptive statistics"]');
    await expect(table).toBeVisible({ timeout: 15_000 });

    // Verify expected statistic rows
    await expect(table.getByText('Count')).toBeVisible();
    await expect(table.getByText('Mean')).toBeVisible();
    await expect(table.getByText('Median')).toBeVisible();
    await expect(table.getByText('Std Dev')).toBeVisible();
  });

  test('statistical analysis trends tab renders chart', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    // Switch to Trends tab
    const trendsTab = page.getByRole('tab', { name: 'Trends' });
    await trendsTab.click();
    await expect(trendsTab).toHaveAttribute('aria-selected', 'true');

    // Wait for chart container with title
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('statistical analysis distribution tab renders histogram', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');

    const distTab = page.getByRole('tab', { name: 'Distribution' });
    await distTab.click();
    await expect(distTab).toHaveAttribute('aria-selected', 'true');

    // Wait for histogram chart container
    await expect(page.locator('[role="figure"]').filter({ hasText: /Histogram/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('statistical analysis correlation tab renders heatmap', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');

    const corrTab = page.getByRole('tab', { name: 'Correlation' });
    await corrTab.click();
    await expect(corrTab).toHaveAttribute('aria-selected', 'true');

    // Wait for correlation matrix chart container
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /Correlation Matrix/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('statistical analysis hypothesis tab renders comparison', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');

    const hypoTab = page.getByRole('tab', { name: 'Hypothesis Testing' });
    await hypoTab.click();
    await expect(hypoTab).toHaveAttribute('aria-selected', 'true');

    // Wait for hypothesis testing content — use the subtitle which is unique
    await expect(page.getByText(/comparing the first half vs\./i)).toBeVisible({ timeout: 15_000 });
  });

  // EventAnalysis section/chart assertions (Total/Filtered Events cards,
  // Event Density Over Time, Event Duration Distribution) targeted the
  // deleted EventAnalysis UI. Equivalent coverage of the post-IA Event
  // Explorer lives in `src/views/Explore/EventExplorer/__tests__/` and the
  // explore-views smoke spec.

  test('pressure optimization renders sections with data', async ({ page }) => {
    await setupAndNavigate(page, '/explore/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();

    // Pressure-Response scatter should render
    await expect(page.getByText('Pressure-Response Relationship')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /AHI vs. Pressure/i }),
    ).toBeVisible();
  });

  test('pressure optimization renders variability section', async ({ page }) => {
    await setupAndNavigate(page, '/explore/pressure');

    await expect(page.getByText('Pressure Variability')).toBeVisible({ timeout: 15_000 });
    // Should show summary cards for mean pressure, range, CV
    await expect(page.getByText('Mean Pressure')).toBeVisible();
    await expect(page.getByText('Stability')).toBeVisible();
  });

  test('pressure optimization renders titration recommendations', async ({ page }) => {
    await setupAndNavigate(page, '/explore/pressure');

    await expect(page.getByText('Titration Recommendations')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Optimal Pressure Range').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Parameter Changes — Controls update displayed results
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Parameter Changes', () => {
  test('statistical analysis metric selector changes displayed metric', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    // Default metric is AHI — table should show AHI label
    const table = page.locator('table[aria-label*="Descriptive statistics"]');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table).toHaveAttribute('aria-label', /AHI/);

    // Change to Median Leak
    await page.locator('#metric-select').selectOption('leakMedian');

    // Table label should update
    await expect(page.locator('table[aria-label*="Median Leak"]')).toBeVisible({ timeout: 10_000 });
  });

  test('statistical analysis window selector updates trends', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');
    await page.getByRole('tab', { name: 'Trends' }).click();

    // Default window is 7 — chart title should reflect it
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Change window to 14
    await page.locator('#window-select').selectOption('14');

    // The section heading should reflect the new window
    await expect(page.getByText(/14-day rolling mean/i)).toBeVisible({ timeout: 10_000 });
  });

  // EventAnalysis filter and cluster-preset controls (`#event-filter`,
  // `#cluster-preset`) no longer exist post-IA. The Event Explorer's filter
  // surface is covered by `EventExplorer.test.tsx`.

  test('pressure optimization grouping selector changes box plot', async ({ page }) => {
    await setupAndNavigate(page, '/explore/pressure');

    // Wait for variability section
    await expect(page.getByText('Pressure Variability')).toBeVisible({ timeout: 15_000 });

    // Default is weekly — check for weekly chart
    await expect(page.locator('[role="figure"]').filter({ hasText: /Weekly/i })).toBeVisible({
      timeout: 10_000,
    });

    // Switch to monthly
    await page.locator('#grouping-select').selectOption('monthly');

    // Should now show monthly grouping
    await expect(page.locator('[role="figure"]').filter({ hasText: /Monthly/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Tab Navigation — StatisticalAnalysis tabs switch content correctly
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Tab Navigation', () => {
  test('tabs switch content panels correctly', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    const descriptiveTab = page.getByRole('tab', { name: 'Descriptive Stats' });
    const trendsTab = page.getByRole('tab', { name: 'Trends' });
    const distributionTab = page.getByRole('tab', { name: 'Distribution' });
    const correlationTab = page.getByRole('tab', { name: 'Correlation' });
    const hypothesisTab = page.getByRole('tab', { name: 'Hypothesis Testing' });

    // Default active tab: descriptive
    await expect(descriptiveTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-descriptive')).toBeVisible();

    // Click Trends
    await trendsTab.click();
    await expect(trendsTab).toHaveAttribute('aria-selected', 'true');
    await expect(descriptiveTab).not.toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-trends')).toBeVisible();

    // Click Distribution
    await distributionTab.click();
    await expect(distributionTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-distribution')).toBeVisible();

    // Click Correlation
    await correlationTab.click();
    await expect(correlationTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-correlation')).toBeVisible();

    // Click Hypothesis
    await hypothesisTab.click();
    await expect(hypothesisTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-hypothesis')).toBeVisible();

    // Click back to Descriptive
    await descriptiveTab.click();
    await expect(descriptiveTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-descriptive')).toBeVisible();
  });

  test('all tabs exist in the analysis sections nav', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    const tablist = page.locator('[role="tablist"][aria-label="Analysis sections"]');
    await expect(tablist).toBeVisible();

    await expect(tablist.getByRole('tab', { name: 'Descriptive Stats' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Trends' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Distribution' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Correlation' })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: 'Hypothesis Testing' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Chart Containers — Title, View as Table, Export PNG
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Chart Containers', () => {
  test('chart containers have titles and export buttons', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');

    // Navigate to Trends tab which has a chart
    await page.getByRole('tab', { name: 'Trends' }).click();

    const chartFigure = page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i });
    await expect(chartFigure).toBeVisible({ timeout: 15_000 });

    // Export PNG button should exist within the chart container
    const exportButton = chartFigure.getByLabel('Export chart as PNG');
    await expect(exportButton).toBeVisible();
  });

  test('export PNG button is enabled when chart is visible', async ({ page }) => {
    await setupAndNavigate(page, '/explore/correlations');

    await page.getByRole('tab', { name: 'Trends' }).click();

    const chartFigure = page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i });
    await expect(chartFigure).toBeVisible({ timeout: 15_000 });

    const exportButton = chartFigure.getByLabel('Export chart as PNG');
    await expect(exportButton).toBeEnabled();
  });

  test('export PNG button is clickable without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await setupAndNavigate(page, '/explore/correlations');

    await page.getByRole('tab', { name: 'Trends' }).click();

    const chartFigure = page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i });
    await expect(chartFigure).toBeVisible({ timeout: 15_000 });

    const exportButton = chartFigure.getByLabel('Export chart as PNG');
    await expect(exportButton).toBeEnabled();

    // Click export — it may or may not trigger a download depending on SVG presence,
    // but should not throw errors
    await exportButton.click();

    // No real errors from the click
    const realErrors = consoleErrors.filter(
      (msg) => !msg.includes('React Router') && !msg.includes('DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });

  // EventAnalysis chart container assertions ("Events Per Night" figure)
  // targeted the deleted EventAnalysis UI. Event Explorer renders a different
  // results surface — its export controls are covered by its unit tests.

  test('pressure optimization charts have export buttons', async ({ page }) => {
    await setupAndNavigate(page, '/explore/pressure');

    const scatterChart = page.locator('[role="figure"]').filter({ hasText: /AHI vs. Pressure/i });
    await expect(scatterChart).toBeVisible({ timeout: 15_000 });

    const exportButton = scatterChart.getByLabel('Export chart as PNG');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Theme Changes — Charts survive theme toggle
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Theme Changes', () => {
  test('statistical analysis charts survive theme toggle', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await setupAndNavigate(page, '/explore/correlations');

    // Navigate to Trends tab which has a chart
    await page.getByRole('tab', { name: 'Trends' }).click();
    const chartFigure = page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i });
    await expect(chartFigure).toBeVisible({ timeout: 15_000 });

    // Force a theme change via the dropdown menu (Light → Dark).
    await selectTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Chart should still be visible after theme change
    await expect(chartFigure).toBeVisible();

    // Toggle back to Light.
    await selectTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Chart should still be visible
    await expect(chartFigure).toBeVisible();

    // No real app errors
    const realErrors = consoleErrors.filter(
      (msg) => !msg.includes('React Router') && !msg.includes('DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });

  // EventAnalysis theme-toggle chart assertion targeted the deleted UI.

  test('pressure optimization charts survive theme toggle', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await setupAndNavigate(page, '/explore/pressure');

    const scatterChart = page.locator('[role="figure"]').filter({ hasText: /AHI vs. Pressure/i });
    await expect(scatterChart).toBeVisible({ timeout: 15_000 });

    // Force a theme change to dark via the dropdown menu.
    await selectTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await expect(scatterChart).toBeVisible();

    const realErrors = consoleErrors.filter(
      (msg) => !msg.includes('React Router') && !msg.includes('DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Console Error Monitoring — No real errors across views with data
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — No Console Errors', () => {
  test('no console errors across all analysis views with data', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // First load to create DB schema
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    // Inject test data
    const sessions = createTestSessions();
    const aggregates = createTestAggregates(sessions);
    const events = createTestEvents(sessions);
    await injectTestData(page, sessions, aggregates, events);

    // Visit each analysis view. `/explore/events` (Event Explorer) is
    // exercised by `tests/e2e/explore-views.spec.ts`.
    const routes = [
      { path: '/explore/correlations', heading: /statistical analysis/i },
      { path: '/explore/pressure', heading: /pressure optimization/i },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
      // Wait for loading to finish
      await page.waitForTimeout(2000);
    }

    // Filter out React Router / DevTools noise
    const realErrors = consoleErrors.filter(
      (msg) =>
        !msg.includes('React Router') &&
        !msg.includes('DevTools') &&
        !msg.includes('Download the React DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });

  test('no console errors when switching statistical analysis tabs', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await setupAndNavigate(page, '/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    // Wait for initial load
    const table = page.locator('table[aria-label*="Descriptive statistics"]');
    await expect(table).toBeVisible({ timeout: 15_000 });

    // Cycle through all tabs
    const tabNames = [
      'Trends',
      'Distribution',
      'Correlation',
      'Hypothesis Testing',
      'Descriptive Stats',
    ];
    for (const tabName of tabNames) {
      await page.getByRole('tab', { name: tabName }).click();
      // Give time for async data loading
      await page.waitForTimeout(1000);
    }

    const realErrors = consoleErrors.filter(
      (msg) =>
        !msg.includes('React Router') &&
        !msg.includes('DevTools') &&
        !msg.includes('Download the React DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Controls Accessibility — Toolbars and ARIA attributes
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Controls Accessibility', () => {
  test('statistical analysis has labeled controls toolbar', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    const toolbar = page.locator('[role="toolbar"][aria-label="Analysis controls"]');
    await expect(toolbar).toBeVisible();

    // Metric select
    await expect(page.locator('#metric-select')).toBeVisible();
    await expect(page.locator('label[for="metric-select"]')).toBeVisible();

    // Window select
    await expect(page.locator('#window-select')).toBeVisible();
    await expect(page.locator('label[for="window-select"]')).toBeVisible();
  });

  // EventAnalysis controls toolbar (`#event-filter`, `#cluster-preset`) no
  // longer exists post-IA. Event Explorer's query builder is unit-tested.

  test('pressure optimization has labeled controls toolbar', async ({ page }) => {
    await setupAndNavigate(page, '/explore/pressure');

    const toolbar = page.locator('[role="toolbar"][aria-label="Pressure analysis controls"]');
    await expect(toolbar).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('#grouping-select')).toBeVisible();
  });

  test('statistical analysis metric select has all options', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    const metricSelect = page.locator('#metric-select');
    await expect(metricSelect).toBeVisible();

    // Verify all metric options exist
    const options = metricSelect.locator('option');
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toHaveText('AHI');
    await expect(options.nth(1)).toHaveText('Median Leak');
    await expect(options.nth(2)).toHaveText('Mean Pressure');
    await expect(options.nth(3)).toHaveText('Usage');
  });

  test('statistical analysis window select has all options', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    const windowSelect = page.locator('#window-select');
    await expect(windowSelect).toBeVisible();

    const options = windowSelect.locator('option');
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toHaveText('3 days');
    await expect(options.nth(1)).toHaveText('7 days');
    await expect(options.nth(2)).toHaveText('14 days');
    await expect(options.nth(3)).toHaveText('30 days');
  });

  // EventAnalysis filter/cluster-preset options enumerations targeted the
  // deleted UI's `<option>` lists. The Event Explorer query builder exposes
  // a different filter surface, covered by its unit tests.

  test('pressure optimization grouping select has all options', async ({ page }) => {
    await setupAndNavigate(page, '/explore/pressure');

    const groupingSelect = page.locator('#grouping-select');
    await expect(groupingSelect).toBeVisible({ timeout: 15_000 });

    const options = groupingSelect.locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText('Weekly');
    await expect(options.nth(1)).toHaveText('Monthly');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Event Analysis — Summary Cards (REMOVED post-IA)
//
// The EventAnalysis summary cards (`Total Events` / `Filtered Events` /
// `Nights Analyzed`) belonged to the deleted EventAnalysis view. The Event
// Explorer surfaces equivalent counts through a different UI shape (matched
// count strip + table) covered by
// `src/views/Explore/EventExplorer/__tests__/EventExplorer.test.tsx` and the
// `tests/e2e/explore-views.spec.ts` smoke spec.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 11. Cross-View Integration — Multiple views in sequence
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Cross-View Navigation', () => {
  test('navigating between analysis views preserves data and avoids errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Setup with data including events
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    const sessions = createTestSessions();
    const aggregates = createTestAggregates(sessions);
    const events = createTestEvents(sessions);
    await injectTestData(page, sessions, aggregates, events);

    // Visit Statistical Analysis
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();
    const table = page.locator('table[aria-label*="Descriptive statistics"]');
    await expect(table).toBeVisible({ timeout: 15_000 });

    // Event Explorer (`/explore/events`) cross-view navigation is exercised
    // by `tests/e2e/explore-views.spec.ts`; including it here would assert
    // against the deleted EventAnalysis heading and "Total Events" card.

    // Navigate to Pressure Optimization
    await page.goto('/explore/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();
    await expect(page.getByText('Pressure-Response Relationship')).toBeVisible({ timeout: 15_000 });

    // Back to Statistical Analysis
    await page.goto('/explore/correlations');
    await expect(page.locator('table[aria-label*="Descriptive statistics"]')).toBeVisible({
      timeout: 15_000,
    });

    const realErrors = consoleErrors.filter(
      (msg) =>
        !msg.includes('React Router') &&
        !msg.includes('DevTools') &&
        !msg.includes('Download the React DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });
});
