import { test, expect, type Page } from '@playwright/test';

/**
 * Event Explorer — Session Scope E2E Tests
 *
 * Covers the session-scoping behaviour wired between Session Detail and the
 * Event Explorer:
 *
 *  1. Scope via URL param: `/explore/events?sessions=<id>` loads ONLY that
 *     session's events and shows a "Session scope" chip with its calendar date.
 *  2. Out-of-range session still resolves: a session whose date falls OUTSIDE
 *     the app's default global date range still loads its events when scoped by
 *     id (the scoped path bypasses the date range — see useExplorerEvents).
 *  3. Remove scope chip: clicking the chip's × clears the scope, drops the
 *     `session` URL param, and hides the chip.
 *  4. End-to-end from Session Detail: the over-cap "View all in Event Explorer"
 *     link navigates to `/explore/events?sessions=<id>` and lands scoped.
 *  5. Wall-clock time: the event grid's Time cell shows the seeded event's
 *     wall-clock time (computed timezone-independently to match EventTable).
 *
 * Data is injected directly into IndexedDB via page.evaluate(), reusing the
 * exact record shapes and seeding helpers established in sessions.spec.ts.
 */

// ── Constants ──

const DB_NAME = 'cpap-analyzer';
const MACHINE_ID = '23241654214';
const MACHINE_MODEL = 'AirSense 11 AutoSet';

// ── Date helpers ──

/** Return a YYYY-MM-DD string for N days before today (local time). */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Test Data Factories (mirrors sessions.spec.ts) ──

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
 * Expected scope-chip date label for a session, computed exactly as the
 * QueryBuilder's `fmtSessionDate` does: parse the session `startTime` (ISO) as a
 * Date and format with `toLocaleDateString(undefined, { year, month:'short',
 * day })`. Using the same parse + formatter keeps the assertion correct under
 * the runner's timezone (the UTC `…T22:00:00Z` start may shift the local
 * calendar day, which we faithfully mirror here).
 */
function expectedChipDate(startIso: string): string {
  return new Date(startIso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Expected full time string rendered by EventTable for an event, mirroring the
 * component's `formatWallClockTime` EXACTLY.
 *
 * EventTable computes `wallInstant = sessionWallClockEpoch(startIso) +
 * (event.timestamp - rawStart)` and formats it with
 * `toLocaleString(undefined, { …, hour:'2-digit', minute:'2-digit',
 * second:'2-digit', timeZone:'UTC' })`, where `sessionWallClockEpoch` re-anchors
 * the session start's LOCAL wall-clock fields to a UTC instant. We reproduce the
 * same arithmetic AND the same formatter (including `timeZone: 'UTC'` and the
 * runner's locale), so the expected string matches whether the locale renders
 * 12- or 24-hour clocks — and stays independent of the runner's timezone.
 */
function expectedWallClock(startIso: string, timestamp: number): string {
  const start = new Date(startIso);
  const wallStart = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    start.getHours(),
    start.getMinutes(),
    start.getSeconds(),
    start.getMilliseconds(),
  );
  const rawStart = start.getTime();
  const wallInstant = new Date(wallStart + (timestamp - rawStart));
  return wallInstant.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
}

// ── IndexedDB Helpers (identical shape to sessions.spec.ts) ──

/**
 * Inject sessions, aggregates, and (optionally) events into the app's IndexedDB.
 * The app must have loaded at least once to create the schema. Uses a
 * version-less `indexedDB.open(name)` so it attaches to whatever schema version
 * the app already created.
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
 * Load the app to create DB schema, inject data, then navigate to the target
 * route. Mirrors `setupWithData` in sessions.spec.ts.
 */
async function setupWithData(
  page: Page,
  sessions: ReturnType<typeof makeSession>[],
  aggregates: ReturnType<typeof makeAggregate>[],
  targetRoute: string,
  events: ReturnType<typeof makeEvent>[] = [],
): Promise<void> {
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await injectTestData(page, sessions, aggregates, events);
  await page.goto(targetRoute);
}

// ── Shared two-session fixture ──

/**
 * Two sessions, each with a distinct set of events. Session A is the one we
 * scope to; session B exists only to prove it is EXCLUDED by the scope.
 *
 * Both sessions land inside the default global date range (last 30 days) so the
 * unscoped explorer would normally load both — the scope is what narrows the
 * loaded set to A.
 */
function createTwoSessions() {
  const dateA = daysAgoStr(3);
  const dateB = daysAgoStr(6);

  const sessionA = makeSession('scope-sess-A', dateA, 480, 420);
  const sessionB = makeSession('scope-sess-B', dateB, 480, 420);

  const aggA = makeAggregate('scope-agg-A', 'scope-sess-A', dateA, 5.0, 4.5, 7.0);
  const aggB = makeAggregate('scope-agg-B', 'scope-sess-B', dateB, 4.0, 4.5, 7.0);

  const startA = new Date(sessionA.startTime).getTime();
  const startB = new Date(sessionB.startTime).getTime();

  // Session A: 3 events. Session B: 2 events. Distinct counts make the
  // "only A's events" assertion unambiguous.
  const eventsA = [
    makeEvent('a-evt-1', 'scope-sess-A', startA + 5 * 60 * 1000, 'ObstructiveApnea', 18),
    makeEvent('a-evt-2', 'scope-sess-A', startA + 30 * 60 * 1000, 'Hypopnea', 12),
    makeEvent('a-evt-3', 'scope-sess-A', startA + 60 * 60 * 1000, 'CentralApnea', 15),
  ];
  const eventsB = [
    makeEvent('b-evt-1', 'scope-sess-B', startB + 10 * 60 * 1000, 'Hypopnea', 9),
    makeEvent('b-evt-2', 'scope-sess-B', startB + 40 * 60 * 1000, 'ObstructiveApnea', 22),
  ];

  return {
    sessionA,
    sessionB,
    aggA,
    aggB,
    eventsA,
    eventsB,
    allEvents: [...eventsA, ...eventsB],
  };
}

/** Locator for the data rows of the Event Explorer's matched-events grid. */
function eventGridDataRows(page: Page) {
  const grid = page.getByRole('grid', { name: 'Matched events' });
  // The header row is also role="row"; data rows are the ones with gridcells.
  return grid.getByRole('row').filter({ has: page.getByRole('gridcell') });
}

// ── Tests ──

test.describe('Event Explorer — scope via URL param', () => {
  test('loads only the scoped session’s events and shows the scope chip', async ({ page }) => {
    const { sessionA, sessionB, aggA, aggB, eventsA, allEvents } = createTwoSessions();

    await setupWithData(
      page,
      [sessionA, sessionB],
      [aggA, aggB],
      `/explore/events?sessions=${sessionA.id}`,
      allEvents,
    );

    // The Explorer mounts in its ready state.
    await expect(page.getByRole('heading', { name: /^event explorer$/i })).toBeVisible({
      timeout: 10_000,
    });

    // Grid shows EXACTLY session A's events (3), not session B's (would be 5 total).
    const dataRows = eventGridDataRows(page);
    await expect(dataRows).toHaveCount(eventsA.length);

    // Matched count strip reflects the scoped total.
    await expect(page.getByText(new RegExp(`\\b${eventsA.length}\\b`)).first()).toBeVisible();

    // Session-scope chip is present with session A's calendar date.
    const scopeGroup = page.getByRole('group', { name: 'Session scope filter' });
    await expect(scopeGroup).toBeVisible();
    await expect(scopeGroup).toContainText(expectedChipDate(sessionA.startTime));

    // The "Session scope" section heading is shown.
    await expect(page.getByRole('heading', { name: 'Session scope' })).toBeVisible();
  });
});

test.describe('Event Explorer — out-of-range scoped session still resolves', () => {
  // Approach note: rather than driving the global date-range selector (which
  // mirrors to the URL via a debounced sync and is awkward to coordinate with
  // a direct deep-link), we seed session A ~400 days in the past. The app's
  // DEFAULT global date range is the last 30 days, so A is comfortably OUTSIDE
  // it. The unscoped explorer would therefore load ZERO of A's events; the fact
  // that the scoped deep-link still surfaces them proves the by-id load path
  // ignores the global date range (useExplorerEvents session-scoped branch).
  test('a session outside the default date range still loads its events when scoped', async ({
    page,
  }) => {
    const oldDate = daysAgoStr(400); // far outside the default last-30-days window
    const sessionA = makeSession('old-sess-A', oldDate, 480, 420);
    const aggA = makeAggregate('old-agg-A', 'old-sess-A', oldDate, 5.0, 4.5, 7.0);
    const startA = new Date(sessionA.startTime).getTime();
    const eventsA = [
      makeEvent('old-evt-1', 'old-sess-A', startA + 5 * 60 * 1000, 'ObstructiveApnea', 18),
      makeEvent('old-evt-2', 'old-sess-A', startA + 30 * 60 * 1000, 'Hypopnea', 12),
    ];

    // Control: confirm the UNSCOPED explorer shows the no-events empty state for
    // this far-past session (it is excluded by the default range).
    await setupWithData(page, [sessionA], [aggA], '/explore/events', eventsA);
    await expect(page.getByRole('heading', { name: /^event explorer$/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name: /no events in this date range/i })).toBeVisible({
      timeout: 10_000,
    });

    // Now deep-link scoped to that same out-of-range session: its events appear.
    await page.goto(`/explore/events?sessions=${sessionA.id}`);
    await expect(page.getByRole('heading', { name: /^event explorer$/i })).toBeVisible({
      timeout: 10_000,
    });

    const dataRows = eventGridDataRows(page);
    await expect(dataRows).toHaveCount(eventsA.length);

    // The scope chip still carries the (old) session date.
    await expect(page.getByRole('group', { name: 'Session scope filter' })).toContainText(
      expectedChipDate(sessionA.startTime),
    );
  });
});

test.describe('Event Explorer — remove scope chip', () => {
  test('clicking the chip × clears the scope and drops the session param', async ({ page }) => {
    const { sessionA, sessionB, aggA, aggB, allEvents } = createTwoSessions();

    await setupWithData(
      page,
      [sessionA, sessionB],
      [aggA, aggB],
      `/explore/events?sessions=${sessionA.id}`,
      allEvents,
    );

    await expect(page.getByRole('heading', { name: /^event explorer$/i })).toBeVisible({
      timeout: 10_000,
    });

    // Precondition: scoped (chip present, URL carries the session param).
    const scopeChip = page.getByRole('group', { name: 'Session scope filter' });
    await expect(scopeChip).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]sessions=${sessionA.id}(&|$)`));

    // Remove the scope via the chip's × control (labelled with the session date).
    const removeBtn = page.getByRole('button', {
      name: new RegExp(`Remove session scope ${expectedChipDate(sessionA.startTime)}`),
    });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // The session param is dropped from the URL and the chip disappears.
    await expect(page).not.toHaveURL(/[?&]sessions=/);
    await expect(scopeChip).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Session scope' })).toHaveCount(0);

    // The explorer now reflects the UNSCOPED set (both sessions' events load
    // since both fall within the default range): 5 rows.
    await expect(eventGridDataRows(page)).toHaveCount(allEvents.length);
  });
});

test.describe('Event Explorer — end-to-end from Session Detail', () => {
  // Seed a session with > EVENTS_LIST_CAP (50) events so the over-cap footer
  // renders the "View all in Event Explorer" link that carries the session id.
  test('the Session Detail "View all" link lands scoped to that session', async ({ page }) => {
    const date = daysAgoStr(4);
    const session = makeSession('detail-sess', date, 480, 420);
    const aggregate = makeAggregate('detail-agg', 'detail-sess', date, 8.0, 4.5, 7.0);
    const start = new Date(session.startTime).getTime();

    const TOTAL = 60; // > EVENTS_LIST_CAP (50)
    const types = ['ObstructiveApnea', 'CentralApnea', 'Hypopnea'];
    const events = Array.from({ length: TOTAL }, (_, i) =>
      makeEvent(
        `de-evt-${String(i).padStart(3, '0')}`,
        'detail-sess',
        start + i * 60 * 1000, // 1-minute spacing
        types[i % types.length]!,
        10 + (i % 3) * 5,
      ),
    );

    await setupWithData(page, [session], [aggregate], '/sessions/detail-sess', events);

    // The over-cap "View all in Event Explorer" link points at the scoped URL.
    const viewAll = page.getByRole('link', { name: /View all in Event Explorer/ });
    await expect(viewAll).toBeVisible({ timeout: 10_000 });
    await expect(viewAll).toHaveAttribute('href', /\/explore\/events\?sessions=detail-sess$/);

    // Follow the link.
    await viewAll.click();

    // We land on the Event Explorer, scoped to this session. The global
    // useURLStateSync hook may append its own `start`/`end` (and singular
    // `session`) params, so assert the scope param is present rather than that
    // it is the sole/leading param.
    await expect(page).toHaveURL(/[?&]sessions=detail-sess(&|$)/);
    await expect(page.getByRole('heading', { name: /^event explorer$/i })).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the scoped by-id load to finish before inspecting the filter rail:
    // while `loading` is true the Explorer renders a skeleton and the QueryBuilder
    // (and its scope chip) is not yet mounted. The grid's first data row only
    // appears once loading completes, so this gates the assertions below and
    // avoids racing the (slower on Firefox/WebKit) IndexedDB by-id load.
    await expect(eventGridDataRows(page).first()).toBeVisible({ timeout: 10_000 });

    // The scope chip is present, carrying this session's calendar date.
    await expect(page.getByRole('group', { name: 'Session scope filter' })).toContainText(
      expectedChipDate(session.startTime),
    );
  });
});

test.describe('Event Explorer — wall-clock time column', () => {
  test('the Time cell shows the seeded event’s wall-clock time', async ({ page }) => {
    const date = daysAgoStr(3);
    const session = makeSession('clock-sess', date, 480, 420);
    const aggregate = makeAggregate('clock-agg', 'clock-sess', date, 5.0, 4.5, 7.0);
    const start = new Date(session.startTime).getTime();

    // Single event +90 minutes after the session start. With a 22:00 wall-clock
    // start that lands at 23:30:07 wall-clock (we add a 7s offset to exercise
    // the seconds field too).
    const ts = start + 90 * 60 * 1000 + 7 * 1000;
    const event = makeEvent('clock-evt', 'clock-sess', ts, 'ObstructiveApnea', 18);

    await setupWithData(page, [session], [aggregate], `/explore/events?sessions=${session.id}`, [
      event,
    ]);

    await expect(page.getByRole('heading', { name: /^event explorer$/i })).toBeVisible({
      timeout: 10_000,
    });

    const grid = page.getByRole('grid', { name: 'Matched events' });
    // The Time column header exists.
    await expect(grid.getByRole('columnheader', { name: /^Time/ })).toBeVisible();

    const row = eventGridDataRows(page).first();
    await expect(row).toBeVisible();

    // The first gridcell is the Time cell; it shows the full wall-clock time
    // string (computed with the same arithmetic + formatter as the component,
    // so it matches regardless of the runner's locale or timezone).
    const timeCell = row.getByRole('gridcell').first();
    await expect(timeCell).toHaveText(expectedWallClock(session.startTime, ts));
  });
});
