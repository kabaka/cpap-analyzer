import { test, expect, type Page } from '@playwright/test';

/**
 * Trends — Central-Apnea Safety Prompt (SAFETY-CRITICAL, consensus D6)
 *
 * Locks in the full-journey behavior of the measurement-uncertainty feature on
 * the Trends view's Event Breakdown chart:
 *
 *   When the central (Clear-Airway) apnea trend is RISING, the view MUST show a
 *   persistent, visible "discuss with your clinician" prompt
 *   (`data-testid="central-clinician-prompt"`), and that prompt MUST NOT be
 *   suppressed by the low-reliability ("modeled inference") caveat that qualifies
 *   the precision of the central/obstructive split.
 *
 * The caveat lowers the *precision* claim; it must never silence, hide, or dim
 * the rising-trend prompt. Under-reaction to treatment-emergent central apnea is
 * the dangerous failure mode (consensus D6, security S-1).
 *
 * Component-level coverage lives in
 * `src/views/Trends/charts/__tests__/EventBreakdownChart.test.tsx`. This spec
 * exercises the same guarantee end-to-end through the real router, store, and
 * IndexedDB-backed data hook (`useNightlyAggregates`), seeding data via the same
 * version-less IndexedDB injection pattern used by `analysis-views.spec.ts`.
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

// ── Test data factories ──

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

/**
 * Build a nightly aggregate with an explicit central index (events/h). The
 * detector (`detectRisingCentralTrend`) reads `ahiCentral` and weights by
 * `usageHours`; the chart's stacked series reads `eventsByType.central`. We keep
 * them consistent (central count ≈ index × usage hours) so the seeded data is
 * realistic, not just detector-bait.
 */
function makeAggregate(id: string, sessionId: string, date: string, centralIndex: number) {
  const usageHours = 7;
  const centralCount = Math.round(centralIndex * usageHours);
  return {
    id,
    sessionId,
    machineId: 'TEST-MACHINE',
    date,
    ahi: 3.2 + centralIndex,
    ahiObstructive: 1.0,
    ahiCentral: centralIndex,
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
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
  };
}

/**
 * 8 consecutive nights within the default 30-day window, chronologically split
 * into a benign earlier half (~0.5 central events/h) and an elevated later half
 * (~4.0 central events/h):
 *
 *   - 8 qualifying nights (usageHours ≥ MIN_CENTRAL_USAGE_HOURS) → 4 per half,
 *     clearing MIN_NIGHTS_PER_HALF (3).
 *   - later index (~4.0/h) ≥ RISING_ABSOLUTE_FLOOR (1.0) AND
 *     ≥ earlier index (~0.5/h) × (1 + RISING_RELATIVE_THRESHOLD = 1.25).
 *
 * `daysAgoStr(7)` is the OLDEST date and `daysAgoStr(0)` the NEWEST, so the
 * older dates carry the benign half and the newer dates carry the elevated half
 * — i.e. a genuinely *rising* trend once sorted ascending by date.
 */
function createRisingCentralData() {
  const benign = 0.5; // events/h
  const elevated = 4.0; // events/h
  // index 0..3 are the newer (elevated) nights; 4..7 the older (benign) nights.
  const sessions = Array.from({ length: 8 }, (_, i) => makeSession(`sess-${i}`, daysAgoStr(i)));
  const aggregates = sessions.map((s, i) =>
    makeAggregate(`agg-${i}`, s.id, s.date, i < 4 ? elevated : benign),
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

async function seedAndOpenTrends(page: Page): Promise<void> {
  // Load once to let the app create the DB schema, then inject and navigate.
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();

  const { sessions, aggregates } = createRisingCentralData();
  await injectData(page, sessions, aggregates);

  await page.goto('/trends');
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible({ timeout: 15_000 });
}

// ═══════════════════════════════════════════════════════════════════════════

test.describe('Trends — central-apnea safety prompt (D6)', () => {
  test('rising central trend surfaces a persistent clinician prompt', async ({ page }) => {
    await seedAndOpenTrends(page);

    const prompt = page.getByTestId('central-clinician-prompt');
    await expect(prompt).toBeVisible({ timeout: 15_000 });

    // Informational, conversation-prompting copy — not a diagnosis or therapy.
    await expect(prompt).toContainText(/discussing with your clinician/i);
    // Announced to assistive tech.
    await expect(prompt).toHaveAttribute('role', 'status');
  });

  test('low-reliability caveat and clinician prompt coexist — caveat does not hide the prompt', async ({
    page,
  }) => {
    await seedAndOpenTrends(page);

    // Scope to the Event Breakdown chart panel so we assert the caveat that
    // sits on the central/obstructive split, not some other view text.
    const panel = page
      .locator('[role="figure"], section, article, div')
      .filter({ hasText: 'Event Breakdown' })
      .filter({ has: page.getByTestId('central-clinician-prompt') })
      .first();

    // 1) The low-reliability caveat is present (lowers the *precision* claim).
    await expect(panel.getByText(/modeled inferences/i)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(/directional, not exact/i)).toBeVisible();

    // 2) The safety prompt is STILL visible at the same time — the caveat must
    //    never silence, hide, or dim it.
    await expect(panel.getByTestId('central-clinician-prompt')).toBeVisible();
  });

  test('prompt is non-diagnostic and not therapy-specific', async ({ page }) => {
    await seedAndOpenTrends(page);

    const text = (await page.getByTestId('central-clinician-prompt').textContent()) ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\bASV\b/i);
    expect(text).not.toMatch(/you (have|need)\b/i);
    expect(text).not.toMatch(/diagnos/i);
  });
});
