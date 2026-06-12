import { test, expect, type Page } from '@playwright/test';

/**
 * Granger Causality — Statistical Analysis tab smoke test.
 *
 * Covers the "Granger Causality" tab added to the Statistical Analysis view
 * (tab id `causality`, panel `#panel-causality`) and its section component
 * `src/views/Analysis/GrangerCausalitySection.tsx`.
 *
 * Scope (focused smoke, resilient, deterministic):
 *   1. Activate the tab by role/name, assert panel + controls toolbar render.
 *   2. With sufficient seeded data: select X = Median Leak / Y = AHI, wait for a
 *      real result, assert the verdict region appears, and assert the X≠Y
 *      enforcement (the value chosen in X is disabled as an option in Y).
 *   3. Inference-mode lever: in default Exploratory mode assert the
 *      "Exploratory p-value" badge; switch to Confirmatory and assert the
 *      fixed-lag select (`#granger-fixed-lag`) becomes visible.
 *   4. Accessibility smoke: toolbar aria-label, inference-mode fieldset+legend,
 *      honesty callouts expose role="note".
 *
 * --- Data path decision (read before changing the seed) ---
 * The Granger test needs >= 2 * maxLag + 2 paired nights (see
 * `minNightsForMaxLag` in grangerHelpers.ts). The default maxLag is 7, so the
 * default requires >= 16 nights. The shared `analysis-views` factory seeds only
 * 14 nights, which would deterministically land on the "Not enough nights"
 * branch at the default lag. To exercise the *real-result* path (verdict +
 * exploratory badge) we seed our own SUFFICIENT_NIGHTS (24) of aggregates with
 * a non-collinear, deterministic leak/AHI relationship, so:
 *   - the F-statistic is finite (metrics vary and are not perfectly collinear),
 *   - exploratory mode auto-selects the lag, so `selectionAffected` is true and
 *     the "Exploratory p-value — lag auto-selected" badge renders.
 * A dedicated test also asserts the insufficient-data branch deterministically
 * by raising max lag to 14 (needs 30 nights > 24 available).
 *
 * Seeding mirrors the IndexedDB-injection convention used by
 * `analysis-views.spec.ts` (version-less `indexedDB.open(name)` so it attaches
 * to whatever schema version the app has already created).
 */

// ── Constants ──

const DB_NAME = 'cpap-analyzer';

/**
 * 24 nights: comfortably clears the default-lag requirement (16) and the
 * confidence-margin needed for a finite fit, while staying short of the
 * maxLag = 14 requirement (30) used to force the insufficient-data branch.
 */
const SUFFICIENT_NIGHTS = 24;

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
  overrides: { ahi: number; leakMedian: number },
) {
  return {
    id,
    sessionId,
    machineId: 'TEST-MACHINE',
    date,
    ahi: overrides.ahi,
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
    leakMedian: overrides.leakMedian,
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
    usageHours: 7.0,
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
 * Deterministic pseudo-random generator (mulberry32) so the seeded series is
 * identical on every run and across browsers — the smoke must not flake on
 * data variation.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build `count` nights where Median Leak (X) leads AHI (Y): tonight's AHI
 * depends on the previous two nights' leak plus its own noise. Both series
 * carry independent noise so they are NOT collinear with each other or with a
 * pure time trend — this keeps the regression well-conditioned (finite F-stat)
 * while giving Granger something real to detect.
 */
function createGrangerNights(count: number) {
  const rand = mulberry32(12345);
  const leak: number[] = [];
  const ahi: number[] = [];
  for (let i = 0; i < count; i++) {
    const leakVal = 12 + 6 * Math.sin(i / 2.3) + (rand() - 0.5) * 4;
    leak.push(leakVal);
    const lag1 = i >= 1 ? leak[i - 1]! : 12;
    const lag2 = i >= 2 ? leak[i - 2]! : 12;
    const ahiVal = 2 + 0.18 * lag1 + 0.07 * lag2 + (rand() - 0.5) * 1.5;
    ahi.push(Math.max(0, ahiVal));
  }

  const sessions = Array.from({ length: count }, (_, i) =>
    makeSession(`gc-sess-${i}`, daysAgoStr(count - 1 - i)),
  );
  const aggregates = sessions.map((s, i) =>
    makeAggregate(`gc-agg-${i}`, s.id, s.date, {
      leakMedian: Number(leak[i]!.toFixed(3)),
      ahi: Number(ahi[i]!.toFixed(3)),
    }),
  );
  return { sessions, aggregates };
}

// ── IndexedDB helper (version-less open: attaches to the app's current schema) ──

/**
 * Wait until the app has created its IndexedDB object stores.
 *
 * The app uses a version-less `indexedDB.open(name)` and creates its schema
 * asynchronously during boot — the bare database exists with zero stores for a
 * short window after first paint. Injecting before the stores exist throws
 * NotFoundError, so we poll until `nightly_aggregates` is present. This makes
 * seeding robust to boot timing without depending on any particular DOM signal.
 */
async function waitForSchema(page: Page): Promise<void> {
  const ready = await page.evaluate(
    (dbName) =>
      new Promise<boolean>((resolve) => {
        const deadline = Date.now() + 25_000;
        const poll = () => {
          const req = indexedDB.open(dbName);
          req.onerror = () => resolve(false);
          req.onsuccess = () => {
            const db = req.result;
            const has = db.objectStoreNames.contains('nightly_aggregates');
            db.close();
            if (has) {
              resolve(true);
            } else if (Date.now() > deadline) {
              resolve(false);
            } else {
              setTimeout(poll, 150);
            }
          };
        };
        poll();
      }),
    DB_NAME,
  );
  if (!ready)
    throw new Error('IndexedDB schema (nightly_aggregates store) was not created in time');
}

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
 * Load the app to create the schema, inject the supplied nights, then open the
 * Statistical Analysis view and activate the Granger Causality tab.
 * Returns the tab and panel locators.
 */
async function setupAndOpenGrangerTab(page: Page, nights: number) {
  await page.goto('/');
  // Let the app shell mount (the dashboard heading) so its DB layer has begun
  // initialising, then wait for the object stores to actually exist before
  // seeding. This two-step wait is robust to dev-server cold start and to
  // parallel-worker contention: injection never races the schema.
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
  await waitForSchema(page);

  const { sessions, aggregates } = createGrangerNights(nights);
  await injectTestData(page, sessions, aggregates);

  await page.goto('/explore/correlations');
  await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();

  const tab = page.getByRole('tab', { name: 'Granger Causality' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  const panel = page.locator('#panel-causality');
  await expect(panel).toBeVisible();

  return { tab, panel };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Statistical Analysis — Granger Causality tab', () => {
  test('1. activates the tab and renders the controls toolbar', async ({ page }) => {
    const { panel } = await setupAndOpenGrangerTab(page, SUFFICIENT_NIGHTS);

    // Tab-scoped controls toolbar with all four control groups.
    const toolbar = page.getByRole('toolbar', { name: 'Granger causality controls' });
    await expect(toolbar).toBeVisible();
    await expect(panel.getByLabel('Metric X (potential cause)')).toBeVisible();
    await expect(panel.getByLabel('Metric Y (potential effect)')).toBeVisible();
    await expect(panel.getByLabel('Max lag (nights)')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Inference mode' })).toBeVisible();
  });

  test('2. produces a verdict for Median Leak vs AHI and enforces X != Y', async ({ page }) => {
    const { panel } = await setupAndOpenGrangerTab(page, SUFFICIENT_NIGHTS);

    // Default pair is already Median Leak (X) / AHI (Y); set explicitly for clarity.
    const metricX = panel.getByLabel('Metric X (potential cause)');
    const metricY = panel.getByLabel('Metric Y (potential effect)');
    await metricX.selectOption({ label: 'Median Leak' });
    await metricY.selectOption({ label: 'AHI' });

    // Wait for the computation to settle (the result region is aria-busy while loading).
    await expect(page.getByText('Computing Granger causality…')).toHaveCount(0, {
      timeout: 20_000,
    });

    // (C) Result summary verdict region. The verdict is one of the four
    // verdictText() phrasings; match the stable shared substring.
    await expect(
      panel.getByText(/granger.?caus|no granger causality detected/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // X != Y enforcement: the option currently selected in X must be disabled
    // (unavailable) as an option in Y, and vice-versa. Use exact option names —
    // "AHI" is a substring of "Obstructive AHI"/"Central AHI".
    await expect(metricY.getByRole('option', { name: 'Median Leak', exact: true })).toBeDisabled();
    await expect(metricX.getByRole('option', { name: 'AHI', exact: true })).toBeDisabled();
  });

  test('3. exploratory mode shows the exploratory badge; confirmatory reveals fixed-lag', async ({
    page,
  }) => {
    const { panel } = await setupAndOpenGrangerTab(page, SUFFICIENT_NIGHTS);

    await expect(page.getByText('Computing Granger causality…')).toHaveCount(0, {
      timeout: 20_000,
    });

    // Default mode is Exploratory. With sufficient nights and varying, non-collinear
    // metrics the lag is AIC-selected, so the honesty badge is shown.
    // (Data path: real result — see the file header comment.)
    await expect(panel.getByText('Exploratory p-value — lag auto-selected')).toBeVisible({
      timeout: 20_000,
    });

    // The fixed-lag select must NOT exist while in Exploratory mode.
    await expect(page.locator('#granger-fixed-lag')).toHaveCount(0);

    // Switch to Confirmatory — the fixed-lag select appears.
    await panel.getByRole('radio', { name: /Confirmatory/ }).check();
    await expect(page.locator('#granger-fixed-lag')).toBeVisible();
    await expect(panel.getByLabel('Fixed lag (nights)')).toBeVisible();
  });

  test('4. insufficient nights for the chosen max lag shows the not-enough-nights status', async ({
    page,
  }) => {
    // Deterministic by counts: maxLag 14 needs 2*14+2 = 30 nights; we seed 24.
    const { panel } = await setupAndOpenGrangerTab(page, SUFFICIENT_NIGHTS);

    await panel.getByLabel('Max lag (nights)').selectOption('14');

    await expect(page.getByText('Computing Granger causality…')).toHaveCount(0, {
      timeout: 20_000,
    });

    const status = panel.getByText('Not enough nights for this test');
    await expect(status).toBeVisible({ timeout: 20_000 });
  });

  test('5. accessibility — toolbar label, inference fieldset+legend, honesty note role', async ({
    page,
  }) => {
    const { panel } = await setupAndOpenGrangerTab(page, SUFFICIENT_NIGHTS);

    // Toolbar exposes its accessible name.
    await expect(page.getByRole('toolbar', { name: 'Granger causality controls' })).toBeVisible();

    // Inference mode is a real <fieldset> with a <legend> → exposed as a named group.
    const modeGroup = page.getByRole('group', { name: 'Inference mode' });
    await expect(modeGroup).toBeVisible();
    await expect(modeGroup.getByRole('radio', { name: /Exploratory/ })).toBeChecked();
    await expect(modeGroup.getByRole('radio', { name: /Confirmatory/ })).toBeVisible();

    // Honesty callouts expose role="note". With the seeded data the
    // exploratory-selection note is present; assert at least one note exists.
    await expect(page.getByText('Computing Granger causality…')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(panel.getByRole('note').first()).toBeVisible({ timeout: 20_000 });
  });
});
