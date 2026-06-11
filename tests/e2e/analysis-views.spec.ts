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
    await page.goto('/analysis/statistical');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();
  });

  test('event analysis route renders heading', async ({ page }) => {
    await page.goto('/analysis/events');
    await expect(page.getByRole('heading', { name: /event analysis/i })).toBeVisible();
  });

  test('pressure optimization route renders heading', async ({ page }) => {
    await page.goto('/analysis/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Empty State — Views show empty state when no data is present
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Empty State', () => {
  test('statistical analysis shows empty state without data', async ({ page }) => {
    await page.goto('/analysis/statistical');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

    // StatisticalAnalysis always renders controls+tabs; with no data, descriptive stats table shows Count=0
    const table = page.locator('table[aria-label*="Descriptive statistics"]');
    await expect(table).toBeVisible({ timeout: 15_000 });
    const countRow = table.locator('tr', { hasText: 'Count' });
    await expect(countRow).toContainText('0');
  });

  test('event analysis shows empty state without data', async ({ page }) => {
    await page.goto('/analysis/events');
    await expect(page.getByRole('heading', { name: /event analysis/i })).toBeVisible();

    // Wait for loading to finish and empty state text to appear
    await expect(page.getByText(/no data available/i)).toBeVisible({ timeout: 15_000 });
  });

  test('pressure optimization shows empty state without data', async ({ page }) => {
    await page.goto('/analysis/pressure');
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
    await setupAndNavigate(page, '/analysis/statistical');
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
    await setupAndNavigate(page, '/analysis/statistical');
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
    await setupAndNavigate(page, '/analysis/statistical');

    const distTab = page.getByRole('tab', { name: 'Distribution' });
    await distTab.click();
    await expect(distTab).toHaveAttribute('aria-selected', 'true');

    // Wait for histogram chart container
    await expect(page.locator('[role="figure"]').filter({ hasText: /Histogram/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('statistical analysis correlation tab renders heatmap', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/statistical');

    const corrTab = page.getByRole('tab', { name: 'Correlation' });
    await corrTab.click();
    await expect(corrTab).toHaveAttribute('aria-selected', 'true');

    // Wait for correlation matrix chart container
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /Correlation Matrix/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('statistical analysis hypothesis tab renders comparison', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/statistical');

    const hypoTab = page.getByRole('tab', { name: 'Hypothesis Testing' });
    await hypoTab.click();
    await expect(hypoTab).toHaveAttribute('aria-selected', 'true');

    // Wait for hypothesis testing content — use the subtitle which is unique
    await expect(page.getByText(/comparing the first half vs\./i)).toBeVisible({ timeout: 15_000 });
  });

  test('event analysis renders sections with injected events', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });
    await expect(page.getByRole('heading', { name: /event analysis/i })).toBeVisible();

    // Summary cards should show event counts
    await expect(page.getByText('Total Events')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Filtered Events')).toBeVisible();
    await expect(page.getByText('Nights Analyzed')).toBeVisible();

    // Event Density section should have a chart
    await expect(page.getByText('Event Density Over Time')).toBeVisible();
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /Events Per Night/i }),
    ).toBeVisible();
  });

  test('event analysis renders duration distribution section', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    await expect(page.getByText('Event Duration Distribution')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /Mean Duration/i }),
    ).toBeVisible();
  });

  test('pressure optimization renders sections with data', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();

    // Pressure-Response scatter should render
    await expect(page.getByText('Pressure-Response Relationship')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[role="figure"]').filter({ hasText: /AHI vs. Pressure/i }),
    ).toBeVisible();
  });

  test('pressure optimization renders variability section', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/pressure');

    await expect(page.getByText('Pressure Variability')).toBeVisible({ timeout: 15_000 });
    // Should show summary cards for mean pressure, range, CV
    await expect(page.getByText('Mean Pressure')).toBeVisible();
    await expect(page.getByText('Stability')).toBeVisible();
  });

  test('pressure optimization renders titration recommendations', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/pressure');

    await expect(page.getByText('Titration Recommendations')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Optimal Pressure Range').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Parameter Changes — Controls update displayed results
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Parameter Changes', () => {
  test('statistical analysis metric selector changes displayed metric', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/statistical');
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
    await setupAndNavigate(page, '/analysis/statistical');
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

  test('event analysis filter changes filtered event count', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    // Wait for summary cards
    await expect(page.getByText('Filtered Events')).toBeVisible({ timeout: 15_000 });

    // Get the "Total Events" count
    const totalCard = page.locator('text=Total Events').locator('..');
    const totalText = await totalCard.textContent();

    // Filter to ObstructiveApnea only
    await page.locator('#event-filter').selectOption('ObstructiveApnea');

    // Filtered Events count should be less than total (or equal if all are obstructive)
    const filteredCard = page.locator('text=Filtered Events').locator('..');
    await expect(filteredCard).not.toHaveText(totalText ?? '', { timeout: 10_000 });
  });

  test('event analysis cluster preset changes cluster results', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    // Wait for cluster section to appear — target the section heading (h2) specifically
    await expect(page.locator('h2', { hasText: /event clusters/i })).toBeVisible({
      timeout: 15_000,
    });

    // Default preset is "balanced" — change to "strict"
    await page.locator('#cluster-preset').selectOption('strict');

    // Cluster heading updates to reflect the preset
    await expect(page.locator('h2', { hasText: /Event Clusters \(strict\)/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('pressure optimization grouping selector changes box plot', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/pressure');

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
    await setupAndNavigate(page, '/analysis/statistical');
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
    await page.goto('/analysis/statistical');
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
    await setupAndNavigate(page, '/analysis/statistical');

    // Navigate to Trends tab which has a chart
    await page.getByRole('tab', { name: 'Trends' }).click();

    const chartFigure = page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i });
    await expect(chartFigure).toBeVisible({ timeout: 15_000 });

    // Export PNG button should exist within the chart container
    const exportButton = chartFigure.getByLabel('Export chart as PNG');
    await expect(exportButton).toBeVisible();
  });

  test('export PNG button is enabled when chart is visible', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/statistical');

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

    await setupAndNavigate(page, '/analysis/statistical');

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

  test('event analysis charts have export buttons', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    // Event Density chart should have export button
    const densityChart = page.locator('[role="figure"]').filter({ hasText: /Events Per Night/i });
    await expect(densityChart).toBeVisible({ timeout: 15_000 });

    const exportButton = densityChart.getByLabel('Export chart as PNG');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();
  });

  test('pressure optimization charts have export buttons', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/pressure');

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

    await setupAndNavigate(page, '/analysis/statistical');

    // Navigate to Trends tab which has a chart
    await page.getByRole('tab', { name: 'Trends' }).click();
    const chartFigure = page.locator('[role="figure"]').filter({ hasText: /Rolling Average/i });
    await expect(chartFigure).toBeVisible({ timeout: 15_000 });

    // Toggle theme: system → light → dark
    const themeToggle = page.getByRole('button', { name: /switch theme/i });
    await themeToggle.click(); // system → light
    await themeToggle.click(); // light → dark
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Chart should still be visible after theme change
    await expect(chartFigure).toBeVisible();

    // Toggle back: dark → system
    await themeToggle.click();

    // Chart should still be visible
    await expect(chartFigure).toBeVisible();

    // No real app errors
    const realErrors = consoleErrors.filter(
      (msg) => !msg.includes('React Router') && !msg.includes('DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });

  test('event analysis charts survive theme toggle', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    const densityChart = page.locator('[role="figure"]').filter({ hasText: /Events Per Night/i });
    await expect(densityChart).toBeVisible({ timeout: 15_000 });

    // Toggle theme to dark
    const themeToggle = page.getByRole('button', { name: /switch theme/i });
    await themeToggle.click(); // system → light
    await themeToggle.click(); // light → dark

    // Chart still visible
    await expect(densityChart).toBeVisible();

    const realErrors = consoleErrors.filter(
      (msg) => !msg.includes('React Router') && !msg.includes('DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });

  test('pressure optimization charts survive theme toggle', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await setupAndNavigate(page, '/analysis/pressure');

    const scatterChart = page.locator('[role="figure"]').filter({ hasText: /AHI vs. Pressure/i });
    await expect(scatterChart).toBeVisible({ timeout: 15_000 });

    // Toggle theme to dark
    const themeToggle = page.getByRole('button', { name: /switch theme/i });
    await themeToggle.click();
    await themeToggle.click();

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

    // Visit each analysis view
    const routes = [
      { path: '/analysis/statistical', heading: /statistical analysis/i },
      { path: '/analysis/events', heading: /event analysis/i },
      { path: '/analysis/pressure', heading: /pressure optimization/i },
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

    await setupAndNavigate(page, '/analysis/statistical');
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
    await page.goto('/analysis/statistical');
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

  test('event analysis has labeled controls toolbar', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    const toolbar = page.locator('[role="toolbar"][aria-label="Event analysis controls"]');
    await expect(toolbar).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('#event-filter')).toBeVisible();
    await expect(page.locator('#cluster-preset')).toBeVisible();
  });

  test('pressure optimization has labeled controls toolbar', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/pressure');

    const toolbar = page.locator('[role="toolbar"][aria-label="Pressure analysis controls"]');
    await expect(toolbar).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('#grouping-select')).toBeVisible();
  });

  test('statistical analysis metric select has all options', async ({ page }) => {
    await page.goto('/analysis/statistical');
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
    await page.goto('/analysis/statistical');
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

  test('event analysis filter select has all options', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    const filterSelect = page.locator('#event-filter');
    await expect(filterSelect).toBeVisible({ timeout: 15_000 });

    const options = filterSelect.locator('option');
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toHaveText('All Events');
    await expect(options.nth(1)).toHaveText('Obstructive Apnea');
    await expect(options.nth(2)).toHaveText('Central Apnea');
    await expect(options.nth(3)).toHaveText('Hypopnea');
  });

  test('event analysis cluster preset has all options', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    const presetSelect = page.locator('#cluster-preset');
    await expect(presetSelect).toBeVisible({ timeout: 15_000 });

    const options = presetSelect.locator('option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText('Strict');
    await expect(options.nth(1)).toHaveText('Balanced');
    await expect(options.nth(2)).toHaveText('Lenient');
  });

  test('pressure optimization grouping select has all options', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/pressure');

    const groupingSelect = page.locator('#grouping-select');
    await expect(groupingSelect).toBeVisible({ timeout: 15_000 });

    const options = groupingSelect.locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveText('Weekly');
    await expect(options.nth(1)).toHaveText('Monthly');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Event Analysis — Summary Cards
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Views — Event Summary Cards', () => {
  test('event analysis summary cards show correct counts', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    // Wait for summary cards
    await expect(page.getByText('Total Events')).toBeVisible({ timeout: 15_000 });

    // 14 sessions × 5 events = 70 total events
    const totalCard = page.locator('text=Total Events').locator('..');
    await expect(totalCard).toContainText('70');

    // All filters → Filtered Events = Total Events
    const filteredCard = page.locator('text=Filtered Events').locator('..');
    await expect(filteredCard).toContainText('70');

    // 14 nights analysed
    const nightsCard = page.locator('text=Nights Analyzed').locator('..');
    await expect(nightsCard).toContainText('14');
  });

  test('event analysis summary cards update when filter changes', async ({ page }) => {
    await setupAndNavigate(page, '/analysis/events', { includeEvents: true });

    await expect(page.getByText('Total Events')).toBeVisible({ timeout: 15_000 });

    // Filter to Obstructive only
    await page.locator('#event-filter').selectOption('ObstructiveApnea');

    // Filtered count should be less than total (28 of 70 — events at index 0 and 3 are Obstructive)
    const filteredCard = page.locator('text=Filtered Events').locator('..');
    await expect(filteredCard).toContainText('28');

    // Total should remain the same
    const totalCard = page.locator('text=Total Events').locator('..');
    await expect(totalCard).toContainText('70');
  });
});

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
    await page.goto('/analysis/statistical');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();
    const table = page.locator('table[aria-label*="Descriptive statistics"]');
    await expect(table).toBeVisible({ timeout: 15_000 });

    // Navigate to Event Analysis
    await page.goto('/analysis/events');
    await expect(page.getByRole('heading', { name: /event analysis/i })).toBeVisible();
    await expect(page.getByText('Total Events')).toBeVisible({ timeout: 15_000 });

    // Navigate to Pressure Optimization
    await page.goto('/analysis/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();
    await expect(page.getByText('Pressure-Response Relationship')).toBeVisible({ timeout: 15_000 });

    // Back to Statistical Analysis
    await page.goto('/analysis/statistical');
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
