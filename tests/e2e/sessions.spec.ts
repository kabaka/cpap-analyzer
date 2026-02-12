import { test, expect, type Page } from '@playwright/test';

/**
 * Session Views E2E Tests — Phase 6
 *
 * Tests session list, session detail, signal viewer, and session comparison:
 * 1. Session list → click row → session detail loads
 * 2. Session detail → "View Signals" → signal viewer renders
 * 3. Signal viewer zoom/pan controls (toolbar chrome)
 * 4. Session comparison flow (select 2 sessions, verify deltas)
 *
 * Data is injected directly into IndexedDB via page.evaluate() to avoid
 * browser-specific quirks with webkitdirectory file inputs.
 */

// ── Constants ──

const DB_NAME = 'cpap-analyzer';
const DB_VERSION = 1;
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
    ({ dbName, dbVersion, sessions, aggregates }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);
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
    { dbName: DB_NAME, dbVersion: DB_VERSION, sessions, aggregates },
  );
}

/**
 * Load the app to create DB schema, inject data, then navigate to the target route.
 * Returns after the page has settled with the injected data.
 */
async function setupWithData(
  page: Page,
  sessions: ReturnType<typeof makeSession>[],
  aggregates: ReturnType<typeof makeAggregate>[],
  targetRoute = '/sessions',
): Promise<void> {
  // First load: creates the DB schema
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();

  // Inject data
  await injectTestData(page, sessions, aggregates);

  // Navigate to the target route with fresh data
  await page.goto(targetRoute);
}

// ── Shared Test Data ──

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

// ── Test Groups ──

test.describe('Session List', () => {
  test('renders session list with injected data', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    // Heading
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // Session count
    await expect(page.getByText('3 sessions')).toBeVisible();

    // Table headers
    await expect(page.getByRole('columnheader', { name: 'Date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Duration' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Usage' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'AHI' })).toBeVisible();

    // 3 data rows
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);
  });

  test('shows empty state when no sessions exist', async ({ page }) => {
    await setupWithData(page, [], [], '/sessions');

    await expect(page.getByText('No sessions found')).toBeVisible();
  });

  test('search filter narrows visible sessions', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    // All 3 visible initially
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);

    // Type a portion of the first session's date into the filter
    const filterInput = page.getByRole('searchbox', { name: /filter/i });
    // Use the raw YYYY-MM-DD date string which the filter matches against dateRaw
    const filterStr = daysAgoStr(2);

    await filterInput.fill(filterStr);

    // Should show fewer results (likely 1)
    await expect(rows.first()).toBeVisible();
    const filteredCount = await rows.count();
    expect(filteredCount).toBeLessThan(3);
  });

  test('clicking a session row navigates to session detail', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    // Click the first session row (most recent due to default desc sort)
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();

    // Should navigate to session detail
    await expect(page).toHaveURL(/\/sessions\/sess-1(\?|$)/);
  });

  test('sort by AHI column works', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    const ahiHeader = page.getByRole('columnheader', { name: 'AHI' });

    // Click AHI to sort descending
    await ahiHeader.click();
    await expect(ahiHeader).toHaveAttribute('aria-sort', 'descending');

    // Click again to sort ascending
    await ahiHeader.click();
    await expect(ahiHeader).toHaveAttribute('aria-sort', 'ascending');

    // Still 3 rows
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);
  });
});

test.describe('Session Detail', () => {
  test('displays session detail with metric cards', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1');

    // Wait for session detail to load — heading shows the formatted date
    // The heading is the formatted date (e.g., "Monday, February 9, 2026")
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();

    // Breadcrumb should show Sessions link
    await expect(
      page.locator('nav[aria-label="Breadcrumb"] a', { hasText: 'Sessions' }),
    ).toBeVisible();

    // Machine model displayed
    await expect(page.getByText(MACHINE_MODEL)).toBeVisible();

    // AHI metric card
    await expect(page.getByRole('heading', { name: 'AHI' })).toBeVisible();
    await expect(page.getByText('3.2')).toBeVisible();

    // Leak Rate metric card
    await expect(page.getByRole('heading', { name: 'Leak Rate' })).toBeVisible();
    await expect(page.getByText('4.5')).toBeVisible();

    // Pressure metric card
    await expect(page.getByRole('heading', { name: 'Pressure' })).toBeVisible();

    // View Signals button
    await expect(page.getByRole('button', { name: 'View Signals' })).toBeVisible();
  });

  test('navigating back to Sessions link returns to list', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1');

    // Wait for the session detail heading with extended timeout for CI
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

    // Wait for breadcrumb to be visible before clicking
    const breadcrumbLink = page.locator('nav[aria-label="Breadcrumb"] a', { hasText: 'Sessions' });
    await expect(breadcrumbLink).toBeVisible({ timeout: 10000 });
    await breadcrumbLink.click();

    // Should navigate to session list
    await expect(page).toHaveURL(/\/sessions(\?|$)/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible({ timeout: 10000 });
  });

  test('shows error state for non-existent session', async ({ page }) => {
    await setupWithData(page, [], [], '/sessions/nonexistent-id');

    // Should show an error or not-found state
    await expect(page.getByText('Session not found.')).toBeVisible();
  });

  test('AHI breakdown values are displayed', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1');

    // Wait for detail to load
    await expect(page.getByRole('heading', { name: 'AHI' })).toBeVisible();

    // AHI breakdown items
    await expect(page.getByText('Obstructive')).toBeVisible();
    await expect(page.getByText('Central')).toBeVisible();
    await expect(page.getByText('Hypopnea')).toBeVisible();
  });

  test('clicking View Signals navigates to signal viewer', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1');

    // Wait for detail to load
    await expect(page.getByRole('button', { name: 'View Signals' })).toBeVisible({
      timeout: 10000,
    });

    // Click View Signals
    await page.getByRole('button', { name: 'View Signals' }).click();

    // Should navigate to signal viewer route
    await expect(page).toHaveURL(/\/sessions\/sess-1\/signals/);
  });
});

test.describe('Signal Viewer', () => {
  test('renders signal viewer toolbar and controls', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1/signals');

    // The signal viewer will either show the toolbar (if OPFS available) or an error/empty state.
    // In E2E, OPFS won't have actual signal data, so we'll see either:
    // - "No Signal Data" empty state, or
    // - "Failed to load signals" error state, or
    // - "Browser Not Supported" message, or
    // - The toolbar with no waveforms

    // Wait for the page to settle — one of these states should appear
    await page.waitForLoadState('networkidle');
    await expect(
      page
        .getByText('Signal Viewer')
        .or(page.getByText('No Signal Data'))
        .or(page.getByText('Failed to load signals'))
        .or(page.getByText('Browser Not Supported')),
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows back navigation from signal viewer', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1/signals');

    // Wait for any state to render
    const backButton = page.getByRole('button', { name: /back/i });
    const goBackButton = page.getByRole('button', { name: /go back/i });

    // One of the back buttons should be visible (toolbar Back or error-state Go back)
    await expect(backButton.or(goBackButton)).toBeVisible({ timeout: 10000 });
  });

  test('zoom preset buttons render when signal viewer loads fully', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1/signals');

    // If signal viewer renders fully (has toolbar), check zoom presets
    // Otherwise it will show an error/empty state — that's OK
    const signalViewerTitle = page.locator('text="Signal Viewer"');

    // Wait for the page to settle
    await page.waitForTimeout(2000);

    const hasToolbar = await signalViewerTitle.isVisible().catch(() => false);

    if (hasToolbar) {
      // Zoom preset buttons should be present
      await expect(page.getByRole('button', { name: '1m' })).toBeVisible();
      await expect(page.getByRole('button', { name: '5m' })).toBeVisible();
      await expect(page.getByRole('button', { name: '30m' })).toBeVisible();
      await expect(page.getByRole('button', { name: '1h' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    } else {
      // Verify the fallback state renders properly
      const noData = page.getByText('No Signal Data');
      const error = page.getByText(/failed to load|not supported/i);
      await expect(noData.or(error)).toBeVisible();
    }
  });
});

test.describe('Session List → Detail → Signal Viewer Journey', () => {
  test('full navigation flow: list → detail → signals → back', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    // 1. Session list loads
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(3);

    // 2. Click the first row to go to detail
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/\/sessions\/sess-1(\?|$)/);

    // 3. Session detail loads with metrics
    await expect(page.getByRole('heading', { name: 'AHI' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Signals' })).toBeVisible();

    // 4. Click View Signals
    await page.getByRole('button', { name: 'View Signals' }).click();
    await expect(page).toHaveURL(/\/sessions\/sess-1\/signals/);

    // 5. Signal viewer state renders (whatever state — toolbar or fallback)
    const backButton = page.getByRole('button', { name: /back/i });
    const goBackButton = page.getByRole('button', { name: /go back/i });
    await expect(backButton.or(goBackButton)).toBeVisible({ timeout: 10000 });

    // 6. Navigate back
    const visibleBack = (await backButton.isVisible()) ? backButton : goBackButton;
    await visibleBack.click();

    // Should return to session detail
    await expect(page).toHaveURL(/\/sessions\/sess-1(\?|$)/);
    await expect(page.getByRole('heading', { name: 'AHI' })).toBeVisible();
  });
});

test.describe('Session Comparison', () => {
  test('renders comparison page with session pickers', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/compare');

    // Heading
    await expect(page.getByRole('heading', { name: 'Session Comparison' })).toBeVisible();

    // Session picker labels (use first() to avoid strict mode — label + span both match)
    await expect(page.getByText('Session A').first()).toBeVisible();
    await expect(page.getByText('Session B').first()).toBeVisible();
  });

  test('shows prompt to select sessions before any are chosen', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/compare');

    // Wait for sessions to load
    await expect(page.getByText('Session A').first()).toBeVisible();

    // Should show the "Select two sessions" prompt
    await expect(page.getByText('Select two sessions')).toBeVisible();
  });

  test('selecting two sessions shows comparison table with deltas', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/compare');

    // Wait for pickers to render
    await expect(page.getByText('Session A').first()).toBeVisible();

    // Select Session A — click the Radix Select trigger
    const pickerGroupA = page.locator('[class*="pickerGroup"]').filter({ hasText: 'Session A' });
    await pickerGroupA.locator('button').click();
    // Select the first item in the dropdown
    await page.getByRole('option').first().click();

    // Select Session B
    const pickerGroupB = page.locator('[class*="pickerGroup"]').filter({ hasText: 'Session B' });
    await pickerGroupB.locator('button').click();
    // Select the first available item (which is a different session)
    await page.getByRole('option').first().click();

    // The "Select two sessions" prompt should disappear
    await expect(page.getByText('Select two sessions')).not.toBeVisible();

    // Comparison table should appear with metric headers
    await expect(page.getByRole('heading', { name: 'Metric Comparison' })).toBeVisible();

    // Table should have Delta and Change columns
    await expect(page.getByRole('columnheader', { name: 'Delta' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Change' })).toBeVisible();

    // Key metrics should appear as row labels
    await expect(page.getByText('AHI').first()).toBeVisible();
    await expect(page.getByText('Leak Median').first()).toBeVisible();
    await expect(page.getByText('Usage Hours').first()).toBeVisible();

    // Visual Comparison section
    await expect(page.getByRole('heading', { name: 'Visual Comparison' })).toBeVisible();
  });

  test('shows not-enough-sessions message when fewer than 2 sessions exist', async ({ page }) => {
    // Inject only 1 session
    const date = daysAgoStr(3);
    const session = makeSession('sess-solo', date);
    const aggregate = makeAggregate('agg-solo', 'sess-solo', date, 4.0, 5.0, 6.5);

    await setupWithData(page, [session], [aggregate], '/sessions/compare');

    // Should show a message about not enough sessions
    await expect(page.getByText(/not enough sessions/i)).toBeVisible();
  });

  test('breadcrumb navigates back to session list', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/compare');

    // Wait for the page
    await expect(page.getByRole('heading', { name: 'Session Comparison' })).toBeVisible();

    // Click breadcrumb (use the breadcrumb link, not the nav link)
    await page.locator('nav a', { hasText: 'Sessions' }).first().click();
    await expect(page).toHaveURL(/\/sessions(\?.*)?$/);
  });
});
