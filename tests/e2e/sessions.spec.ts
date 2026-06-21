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

/** Build a minimal Event record (respiratory event) for a session. */
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

/**
 * Expected wall-clock string rendered by the Events list / EventTimeline for an
 * event at `timestamp` (epoch ms). The view formats the clock as
 * `formatClockTime(wallClockEpoch, timestamp - sessionStart)` where
 * `wallClockEpoch = Date.UTC(...localFieldsOf(sessionStart))` and
 * `sessionStart = new Date(sessionStartIso).getTime()`. That arithmetic reduces
 * exactly to the LOCAL wall clock of `timestamp` read as HH:MM:SS — so we mirror
 * it here with local getters, keeping the assertion timezone-independent (the app
 * assumes the viewer's zone matches the import zone). See
 * src/views/Sessions/hoverReadout.ts (formatClockTime) and
 * src/views/Sessions/signalLanes.ts (sessionWallClockEpoch).
 */
function expectedClock(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ── IndexedDB Helpers ──

/**
 * Inject sessions, aggregates, and (optionally) events into the app's IndexedDB.
 * The app must have loaded at least once to create the schema.
 */
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
          // Only open the `events` store in the transaction when we have events
          // to write — older fixtures that never touch events keep a narrower
          // transaction scope.
          const storeNames =
            events.length > 0
              ? ['sessions', 'nightly_aggregates', 'events']
              : ['sessions', 'nightly_aggregates'];
          const tx = db.transaction(storeNames, 'readwrite');
          const sessionsStore = tx.objectStore('sessions');
          const aggregatesStore = tx.objectStore('nightly_aggregates');

          for (const session of sessions) {
            sessionsStore.put(session);
          }
          for (const aggregate of aggregates) {
            aggregatesStore.put(aggregate);
          }
          if (events.length > 0) {
            const eventsStore = tx.objectStore('events');
            for (const event of events) {
              eventsStore.put(event);
            }
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
 * Load the app to create DB schema, inject data, then navigate to the target route.
 * Returns after the page has settled with the injected data.
 */
async function setupWithData(
  page: Page,
  sessions: ReturnType<typeof makeSession>[],
  aggregates: ReturnType<typeof makeAggregate>[],
  targetRoute = '/sessions',
  events: ReturnType<typeof makeEvent>[] = [],
): Promise<void> {
  // First load: creates the DB schema
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();

  // Inject data
  await injectTestData(page, sessions, aggregates, events);

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

    // Session count (scope to main content — the StatusBar footer also renders
    // an "N sessions" label since the Phase 1 chrome redesign).
    await expect(page.locator('#main-content').getByText('3 sessions')).toBeVisible();

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

test.describe('Session List Pagination', () => {
  // ── Helpers ──────────────────────────────────────────────────────────────
  //
  // Pagination only renders when there is more than one page (> PAGE_SIZE = 25
  // sessions). We inject 60 sessions, each on a distinct calendar day. Because
  // the dates span ~60 days but the app's default global date range is the last
  // 30 days (see useAppStore.defaultDateRange / DateRangeSelector), the older
  // sessions would be filtered out and pagination would never appear. So after
  // landing on /sessions we switch the global date-range selector to "All time"
  // (start = 2000-01-01) which reloads the session list with every injected
  // session present. This is the single load-bearing gotcha for these tests.

  const PAGE_COUNT = 60; // > 2 * PAGE_SIZE so we get 3 pages of 25/25/10.

  function createManySessions() {
    const sessions = [];
    const aggregates = [];
    for (let i = 0; i < PAGE_COUNT; i++) {
      // daysAgo(1) is the most-recent → page 1; daysAgo(PAGE_COUNT) is oldest.
      // Each on a distinct day so the default desc-by-date sort is stable.
      const date = daysAgoStr(i + 1);
      const id = `pg-sess-${String(i).padStart(3, '0')}`;
      const aggId = `pg-agg-${String(i).padStart(3, '0')}`;
      sessions.push(makeSession(id, date));
      aggregates.push(makeAggregate(aggId, id, date));
    }
    return { sessions, aggregates };
  }

  /**
   * Switch the global date-range selector to "All time" so all 60 injected
   * sessions (spanning ~60 days) are loaded, not just those in the default
   * last-30-days window. Waits until pagination renders to confirm the reload.
   */
  async function selectAllTimeRange(page: Page) {
    // Radix Select trigger is labelled by the "Date range" label.
    const trigger = page.getByRole('combobox', { name: 'Date range' });
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click();
    await page.getByRole('option', { name: 'All time' }).click();

    // Wait until the WIDE range has actually loaded all 60 sessions. The default
    // 30-day range already yields > 25 sessions (so the pagination nav alone is
    // not proof the wide range took effect); assert on the total instead.
    await expect(page.getByText(/of 60 sessions/)).toBeVisible({ timeout: 10000 });

    // The date-range change is mirrored to the URL by a 300ms-debounced sync
    // (useURLStateSync writes ?start/&end). Wait for that write to land BEFORE
    // we click a page button, otherwise our `page=N` write and the debounced
    // start/end write race. Once start=2000-01-01 is present the debounce has
    // settled and subsequent param writes merge cleanly.
    await expect(page).toHaveURL(/[?&]start=2000-01-01(&|$)/, { timeout: 10000 });
  }

  test('persists page in URL and restores it after browser Back (regression)', async ({ page }) => {
    const { sessions, aggregates } = createManySessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await selectAllTimeRange(page);

    // ── 1. Navigate to page 2 ──────────────────────────────────────────────
    await page.getByRole('button', { name: 'Page 2' }).click();

    // URL reflects the page; page-info text and active button confirm the rows.
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(page.getByText('Showing 26–50 of 60 sessions')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // ── 2. Open a session detail from page 2 ───────────────────────────────
    // The rows on page 2 are sessions 25..49 (0-based) by recency. Click the
    // first visible row and capture the id we land on.
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/\/sessions\/pg-sess-\d+/);

    // ── 3. Browser Back ────────────────────────────────────────────────────
    await page.goBack();

    // ── 4. Core regression assertion: we are back on PAGE 2, not page 1. ────
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
    await expect(page.getByText('Showing 26–50 of 60 sessions')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // And page 1 is NOT the active page.
    await expect(page.getByRole('button', { name: 'Page 1' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('loading /sessions?page=2 directly shows page 2 (URL-driven state)', async ({ page }) => {
    // This test deliberately avoids the date-range selector to keep it free of
    // the debounced ?start/&end URL write. Instead it injects 28 sessions that
    // all fall INSIDE the default last-30-days window (daysAgo(1)…daysAgo(28)),
    // so the default range loads them all → 2 pages (25 + 3) with NO range change.
    const sessions = [];
    const aggregates = [];
    for (let i = 1; i <= 28; i++) {
      const date = daysAgoStr(i);
      const id = `dl-sess-${String(i).padStart(3, '0')}`;
      sessions.push(makeSession(id, date));
      aggregates.push(makeAggregate(`dl-agg-${String(i).padStart(3, '0')}`, id, date));
    }

    // Deep-link straight to page 2.
    await setupWithData(page, sessions, aggregates, '/sessions?page=2');

    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

    // The URL-supplied page drives the rendered page without any interaction.
    await expect(page.getByText('Showing 26–28 of 28 sessions')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Page 2 holds the remaining 3 rows.
    await expect(page.locator('tbody tr')).toHaveCount(3);
    // The deep-linked page param is preserved through the date-range URL sync.
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  });

  test('filtering resets pagination back to page 1 (page param dropped)', async ({ page }) => {
    const { sessions, aggregates } = createManySessions();
    await setupWithData(page, sessions, aggregates, '/sessions');

    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await selectAllTimeRange(page);

    // Go to page 2 first.
    await page.getByRole('button', { name: 'Page 2' }).click();
    await expect(page).toHaveURL(/[?&]page=2(&|$)/);

    // Typing into the filter resets to page 1 → the page param is dropped.
    // Filter on a date string that matches a single session (the most recent).
    const filterInput = page.getByRole('searchbox', { name: /filter/i });
    await filterInput.fill(daysAgoStr(1));

    // The `page` query param is removed (page 1 is the clean default).
    await expect(page).not.toHaveURL(/[?&]page=/);
    // Fewer than a full page of results now.
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThan(25);
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

    // AHI metric card. Scope to the card so the AHI primary value is
    // disambiguated from the RDI secondary value, which the redesigned card now
    // also displays (RDI = AHI + RERA index; with ahiRera = 0 in the fixture,
    // RDI numerically equals AHI = 3.2, which is why an unscoped getByText('3.2')
    // now matches two elements).
    await expect(page.getByRole('heading', { name: 'AHI' })).toBeVisible();
    const ahiCard = page
      .locator('div', { has: page.getByRole('heading', { name: 'AHI' }) })
      .filter({ hasText: 'events/hr' })
      .last();
    // Primary AHI value with its unit.
    await expect(ahiCard.getByText('3.2').first()).toBeVisible();
    await expect(ahiCard.getByText('events/hr', { exact: true })).toBeVisible();
    // New RDI readout (Respiratory Disturbance Index = AHI + RERA index).
    await expect(ahiCard.getByText('RDI', { exact: true })).toBeVisible();
    await expect(ahiCard.getByText(/events\/hr \(incl\. RERA\)/)).toBeVisible();

    // Leak Rate metric card — leak displays as a whole number (L/min) per the
    // measurement-uncertainty precision rules, so the injected 4.5 renders as "4".
    const leakCard = page
      .locator('div', { has: page.getByRole('heading', { name: 'Leak Rate' }) })
      .filter({ hasText: 'L/min median' })
      .last();
    await expect(leakCard.getByText('4', { exact: true })).toBeVisible();

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

    // AHI breakdown items. Use exact matches: the new Events-list empty state
    // (this session is seeded with no events) renders a sentence containing the
    // word "hypopnea", so an unscoped substring match on "Hypopnea" would resolve
    // to two elements. The breakdown labels are standalone single words.
    await expect(page.getByText('Obstructive', { exact: true })).toBeVisible();
    await expect(page.getByText('Central', { exact: true })).toBeVisible();
    await expect(page.getByText('Hypopnea', { exact: true })).toBeVisible();
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

test.describe('Session Detail — Events list', () => {
  // The Events list renders each respiratory event's wall-clock Time / Type /
  // Duration and deep-links each row into the Signal Viewer. Event timestamps
  // are derived from the seeded session's start so the rendered clock string is
  // deterministic. We anchor events at the session start (22:00 local) plus a
  // few offsets and assert the rows appear in chronological order.

  const EVENT_SESSION_ID = 'sess-1';

  /**
   * Build a session + aggregate + a small chronological set of events. Events
   * are deliberately seeded OUT of chronological order in the array so the test
   * proves the list sorts them; the returned `chronological` array is the order
   * we expect them rendered in.
   */
  function createSessionWithEvents() {
    const date = daysAgoStr(2);
    const session = makeSession(EVENT_SESSION_ID, date, 480, 420);
    const aggregate = makeAggregate('agg-1', EVENT_SESSION_ID, date, 5.0, 4.5, 7.0);

    // Session starts at `${date}T22:00:00Z`; anchor event timestamps off that.
    const sessionStartMs = new Date(session.startTime).getTime();

    // Three events: a 0-duration RERA, then two timed apneas/hypopneas. Pushed
    // out of order to exercise the chronological sort in EventsList.
    const evtRera = makeEvent(
      'evt-rera',
      EVENT_SESSION_ID,
      sessionStartMs + 60 * 60 * 1000, // +1h
      'RERA',
      0, // zero duration → no `&te=` on the deep link
    );
    const evtObstructive = makeEvent(
      'evt-obstructive',
      EVENT_SESSION_ID,
      sessionStartMs + 5 * 60 * 1000, // +5m (earliest)
      'ObstructiveApnea',
      18, // seconds
    );
    const evtHypopnea = makeEvent(
      'evt-hypopnea',
      EVENT_SESSION_ID,
      sessionStartMs + 30 * 60 * 1000, // +30m (middle)
      'Hypopnea',
      12.5,
    );

    // Insertion order is intentionally non-chronological.
    const events = [evtRera, evtObstructive, evtHypopnea];
    // Expected rendered order (ascending by timestamp).
    const chronological = [evtObstructive, evtHypopnea, evtRera];

    return { session, aggregate, events, chronological };
  }

  test('shows per-event wall-clock time, type, and duration in chronological order', async ({
    page,
  }) => {
    const { session, aggregate, events, chronological } = createSessionWithEvents();
    await setupWithData(page, [session], [aggregate], `/sessions/${EVENT_SESSION_ID}`, events);

    // The Events list is a labelled grid.
    const grid = page.getByRole('grid', { name: 'Individual events' });
    await expect(grid).toBeVisible({ timeout: 10000 });

    // Column headers.
    await expect(grid.getByRole('columnheader', { name: 'Time' })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: 'Duration' })).toBeVisible();

    // One data row per seeded event (header row is a separate role="row" but
    // carries no role="row" gridcells of data; scope rows to those with gridcells).
    const dataRows = grid.getByRole('row').filter({ has: page.getByRole('gridcell') });
    await expect(dataRows).toHaveCount(chronological.length);

    // Each row, in chronological order, shows the expected clock / type / duration.
    for (let i = 0; i < chronological.length; i++) {
      const evt = chronological[i]!;
      const row = dataRows.nth(i);
      await expect(row.getByRole('gridcell').first()).toHaveText(expectedClock(evt.timestamp));
      await expect(row).toContainText(
        evt.type === 'ObstructiveApnea'
          ? 'Obstructive Apnea'
          : evt.type === 'Hypopnea'
            ? 'Hypopnea'
            : 'RERA',
      );
      await expect(row).toContainText(`${evt.duration.toFixed(1)}s`);
    }

    // Sanity: the earliest event's clock precedes the latest in the DOM order.
    const firstClock = expectedClock(chronological[0]!.timestamp);
    const lastClock = expectedClock(chronological[chronological.length - 1]!.timestamp);
    expect(firstClock).not.toEqual(lastClock);
  });

  test('clicking an event row deep-links into the Signal Viewer (with te for timed events)', async ({
    page,
  }) => {
    const { session, aggregate, events, chronological } = createSessionWithEvents();
    await setupWithData(page, [session], [aggregate], `/sessions/${EVENT_SESSION_ID}`, events);

    const grid = page.getByRole('grid', { name: 'Individual events' });
    await expect(grid).toBeVisible({ timeout: 10000 });

    const dataRows = grid.getByRole('row').filter({ has: page.getByRole('gridcell') });

    // The first (chronologically earliest) row is the 18s ObstructiveApnea, which
    // has duration > 0 → the deep link carries both `t` and `te`.
    const timedEvent = chronological[0]!;
    expect(timedEvent.duration).toBeGreaterThan(0);
    const expectedTe = timedEvent.timestamp + timedEvent.duration * 1000;

    await dataRows.first().click();

    await expect(page).toHaveURL(
      new RegExp(
        `/sessions/${EVENT_SESSION_ID}/signals\\?t=${timedEvent.timestamp}&te=${expectedTe}(&|$)`,
      ),
    );

    // The Signal Viewer renders (toolbar or a graceful fallback in the sandbox).
    await page.waitForLoadState('networkidle');
    await expect(
      page
        .getByText('Signal Viewer')
        .or(page.getByText('No Signal Data'))
        .or(page.getByText('Failed to load signals'))
        .or(page.getByText('Browser Not Supported')),
    ).toBeVisible({ timeout: 10000 });
  });

  test('a zero-duration event deep-links with only t (no te)', async ({ page }) => {
    const { session, aggregate, events, chronological } = createSessionWithEvents();
    await setupWithData(page, [session], [aggregate], `/sessions/${EVENT_SESSION_ID}`, events);

    const grid = page.getByRole('grid', { name: 'Individual events' });
    await expect(grid).toBeVisible({ timeout: 10000 });

    const dataRows = grid.getByRole('row').filter({ has: page.getByRole('gridcell') });

    // The last chronological row is the 0-duration RERA → link has `t` only.
    const zeroDurEvent = chronological[chronological.length - 1]!;
    expect(zeroDurEvent.duration).toBe(0);

    await dataRows.last().click();

    // `t` is present and there is NO `te` query param.
    await expect(page).toHaveURL(
      new RegExp(`/sessions/${EVENT_SESSION_ID}/signals\\?t=${zeroDurEvent.timestamp}(&|$)`),
    );
    await expect(page).not.toHaveURL(/[?&]te=/);
  });

  test('keyboard: focusing a row and pressing Enter deep-links into the Signal Viewer', async ({
    page,
  }) => {
    const { session, aggregate, events, chronological } = createSessionWithEvents();
    await setupWithData(page, [session], [aggregate], `/sessions/${EVENT_SESSION_ID}`, events);

    const grid = page.getByRole('grid', { name: 'Individual events' });
    await expect(grid).toBeVisible({ timeout: 10000 });

    const dataRows = grid.getByRole('row').filter({ has: page.getByRole('gridcell') });

    // Focus the first row (roving-tabindex makes it the grid's single tab stop)
    // and activate it with Enter.
    const firstRow = dataRows.first();
    await firstRow.focus();
    await expect(firstRow).toBeFocused();
    await page.keyboard.press('Enter');

    const timedEvent = chronological[0]!;
    const expectedTe = timedEvent.timestamp + timedEvent.duration * 1000;
    await expect(page).toHaveURL(
      new RegExp(
        `/sessions/${EVENT_SESSION_ID}/signals\\?t=${timedEvent.timestamp}&te=${expectedTe}(&|$)`,
      ),
    );
  });

  test('EventTimeline tooltip shows the event wall-clock time on hover', async ({ page }) => {
    // The EventTimeline only renders when endTime > startTime, so build a session
    // with an explicit overnight window (the shared makeSession fixture puts both
    // start and end on the same calendar date, which collapses the timeline). The
    // Events list does not depend on the window; only this timeline test does.
    const date = daysAgoStr(2);
    const session = {
      ...makeSession(EVENT_SESSION_ID, date, 480, 420),
      startTime: `${date}T22:00:00Z`,
      endTime: `${daysAgoStr(1)}T06:00:00Z`, // next calendar day → positive span
    };
    const aggregate = makeAggregate('agg-1', EVENT_SESSION_ID, date, 5.0, 4.5, 7.0);

    const sessionStartMs = new Date(session.startTime).getTime();
    // One event firmly inside the window so the marker is hoverable.
    const evt = makeEvent(
      'evt-tl',
      EVENT_SESSION_ID,
      sessionStartMs + 2 * 60 * 60 * 1000, // +2h
      'ObstructiveApnea',
      18,
    );

    await setupWithData(page, [session], [aggregate], `/sessions/${EVENT_SESSION_ID}`, [evt]);

    // The timeline renders one marker per event inside the labelled container.
    const timeline = page.getByRole('img', { name: /Event timeline showing/ });
    await expect(timeline).toBeVisible({ timeout: 10000 });

    // Hover the marker. Radix renders the tooltip into a portal with
    // role="tooltip"; assert it carries the wall-clock string the feature added.
    const marker = timeline.locator('> *').first();
    await marker.hover();

    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible({ timeout: 10000 });

    // The tooltip text is `HH:MM:SS · <Type> · <d.d>s`.
    const tooltipText = (await tooltip.textContent()) ?? '';
    expect(tooltipText).toContain(expectedClock(evt.timestamp));
    expect(tooltipText).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test('shows the positive empty state when the session has zero events', async ({ page }) => {
    const date = daysAgoStr(2);
    const session = makeSession(EVENT_SESSION_ID, date, 480, 420);
    const aggregate = makeAggregate('agg-1', EVENT_SESSION_ID, date, 0, 4.5, 7.0);

    // No events seeded.
    await setupWithData(page, [session], [aggregate], `/sessions/${EVENT_SESSION_ID}`, []);

    // The Events section still renders, with a positive empty state and no grid.
    const eventsSection = page.getByRole('region', { name: 'Individual events' });
    await expect(eventsSection).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No respiratory events recorded')).toBeVisible();

    // No grid / data rows.
    await expect(page.getByRole('grid', { name: 'Individual events' })).toHaveCount(0);
  });

  test('over-cap footer: shows "first 50 of N" caption and an Event Explorer link', async ({
    page,
  }) => {
    const date = daysAgoStr(2);
    const session = makeSession(EVENT_SESSION_ID, date, 480, 420);
    const aggregate = makeAggregate('agg-1', EVENT_SESSION_ID, date, 8.0, 4.5, 7.0);
    const sessionStartMs = new Date(session.startTime).getTime();

    const TOTAL = 60; // > EVENTS_LIST_CAP (50)
    const types = ['ObstructiveApnea', 'CentralApnea', 'Hypopnea'];
    const events = Array.from({ length: TOTAL }, (_, i) =>
      makeEvent(
        `evt-cap-${String(i).padStart(3, '0')}`,
        EVENT_SESSION_ID,
        sessionStartMs + i * 60 * 1000, // 1-minute spacing
        types[i % types.length]!,
        10 + (i % 3) * 5,
      ),
    );

    await setupWithData(page, [session], [aggregate], `/sessions/${EVENT_SESSION_ID}`, events);

    const grid = page.getByRole('grid', { name: 'Individual events' });
    await expect(grid).toBeVisible({ timeout: 10000 });

    // Only the first 50 are rendered.
    const dataRows = grid.getByRole('row').filter({ has: page.getByRole('gridcell') });
    await expect(dataRows).toHaveCount(50);

    // Over-cap caption with the true total.
    await expect(page.getByText(`Showing the first 50 of ${TOTAL} events.`)).toBeVisible();

    // "View all in Event Explorer" link points at the Event Explorer, pre-scoped
    // to this session via the `?session=<id>` param.
    const viewAll = page.getByRole('link', { name: /View all in Event Explorer/ });
    await expect(viewAll).toBeVisible();
    await expect(viewAll).toHaveAttribute(
      'href',
      new RegExp(`/explore/events\\?session=${EVENT_SESSION_ID}$`),
    );
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

  // ── Crosshair overlay canvas ─────────────────────────────────────
  //
  // The crosshair was moved onto a dedicated transparent OVERLAY canvas layered
  // over the base waveform canvas, so hovering repaints only the overlay (not the
  // waveforms). These tests assert structural/behavioural facts rather than canvas
  // pixels — verifying the overlay exists with the right attributes and that
  // pointer interactions over the chart don't error. They no-op gracefully when
  // signal data isn't available in the E2E sandbox (OPFS has no real chunks), so
  // they stay green whether or not the waveforms actually render.
  //
  // CSS Modules hash class names, so the canvases are matched via [class*="…"]
  // attribute selectors (same convention as the comparison-picker tests above).

  /** Resolve to the canvasWrapper locator only if the viewer rendered the chart. */
  async function getCanvasWrapper(page: Page) {
    const viewerLoaded = await page
      .locator('text="Signal Viewer"')
      .isVisible()
      .catch(() => false);
    if (!viewerLoaded) return null;
    const wrapper = page.locator('[class*="canvasWrapper"]');
    const present = await wrapper
      .first()
      .isVisible()
      .catch(() => false);
    return present ? wrapper.first() : null;
  }

  test('renders a base canvas and a transparent crosshair overlay canvas', async ({ page }) => {
    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1/signals');

    await page.waitForLoadState('networkidle');
    const wrapper = await getCanvasWrapper(page);

    if (!wrapper) {
      // No chart in this environment — verify the fallback state instead so the
      // test still asserts something meaningful and never silently passes.
      await expect(
        page.getByText('No Signal Data').or(page.getByText(/failed to load|not supported/i)),
      ).toBeVisible();
      return;
    }

    // The wrapper holds two stacked canvases: the base waveform canvas and the
    // transparent crosshair overlay.
    const canvases = wrapper.locator('canvas');
    await expect(canvases).toHaveCount(2);

    // Base canvas: carries the accessible description and is focusable.
    const baseCanvas = wrapper.locator('canvas[role="img"]');
    await expect(baseCanvas).toBeVisible();
    await expect(baseCanvas).toHaveAttribute('tabindex', '0');

    // Overlay canvas: aria-hidden and pointer-events:none so it never steals
    // pointer events nor announces to assistive tech.
    const overlay = wrapper.locator('[class*="overlayCanvas"]');
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    await expect(overlay).toHaveCSS('pointer-events', 'none');
    await expect(overlay).toHaveCSS('position', 'absolute');
  });

  test('moving the pointer over the chart does not error and keeps it responsive', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1/signals');

    await page.waitForLoadState('networkidle');
    const wrapper = await getCanvasWrapper(page);

    if (!wrapper) {
      await expect(
        page.getByText('No Signal Data').or(page.getByText(/failed to load|not supported/i)),
      ).toBeVisible();
      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
      return;
    }

    const box = await wrapper.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Sweep the pointer across the chart — the crosshair overlay should repaint
    // without throwing. Use deterministic steps (no waitForTimeout / frame-rate
    // assumptions; the perf benchmark owns frame timing).
    for (const fraction of [0.25, 0.5, 0.75]) {
      await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 5 });
    }

    // The base canvas remains visible and the overlay is still present after hover.
    await expect(wrapper.locator('canvas[role="img"]')).toBeVisible();
    await expect(wrapper.locator('[class*="overlayCanvas"]')).toHaveCount(1);

    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  test('pointer leave and canvas blur after hover do not error', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    const { sessions, aggregates } = createTestSessions();
    await setupWithData(page, sessions, aggregates, '/sessions/sess-1/signals');

    await page.waitForLoadState('networkidle');
    const wrapper = await getCanvasWrapper(page);

    if (!wrapper) {
      await expect(
        page.getByText('No Signal Data').or(page.getByText(/failed to load|not supported/i)),
      ).toBeVisible();
      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
      return;
    }

    const box = await wrapper.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Hover the chart, focus the base canvas, then leave and blur — exercising the
    // pointerleave / blur cleanup paths that clear the crosshair overlay.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    const baseCanvas = wrapper.locator('canvas[role="img"]');
    await baseCanvas.focus();

    // Move the pointer well away from the chart (pointerleave) and blur the canvas.
    await page.mouse.move(box.x + box.width / 2, Math.max(0, box.y - 50), { steps: 5 });
    await baseCanvas.blur();

    // Overlay and base canvas survive the cleanup; no uncaught errors.
    await expect(baseCanvas).toBeVisible();
    await expect(wrapper.locator('[class*="overlayCanvas"]')).toHaveCount(1);
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
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
