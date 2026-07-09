import { test, expect, type Page } from '@playwright/test';

/**
 * Global time-window control (WindowToggle) — command-surface refresh.
 *
 * The per-view date controls were removed; the shell's "Time window" radiogroup
 * (7D/30D/90D/6M/12M presets + a Custom-range popover) is now the single global
 * range control, written to the shared store and mirrored to ?start/&end. Locks:
 *
 *  - the default window is "Last 30 days",
 *  - selecting a preset radio changes which nights a view shows AND syncs the URL,
 *  - the Custom-range popover applies an explicit Start/End that no preset covers.
 *
 * We assert against the Sessions list (a view that reacts to the global range),
 * so the coverage is end-to-end through the store + IndexedDB hook.
 */

const DB_NAME = 'cpap-analyzer';

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeSession(id: string, date: string) {
  return {
    id,
    machineId: 'WT-MACHINE',
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

function makeAggregate(id: string, sessionId: string, date: string) {
  return {
    id,
    sessionId,
    machineId: 'WT-MACHINE',
    date,
    ahi: 3.2,
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

async function setupSessions(page: Page, days: number[]): Promise<void> {
  const sessions = days.map((d) => makeSession(`wt-${d}`, daysAgoStr(d)));
  const aggregates = days.map((d) => makeAggregate(`wt-agg-${d}`, `wt-${d}`, daysAgoStr(d)));
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(
    ({ dbName, sessions, aggregates }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['sessions', 'nightly_aggregates'], 'readwrite');
          for (const s of sessions as Record<string, unknown>[]) tx.objectStore('sessions').put(s);
          for (const a of aggregates as Record<string, unknown>[])
            tx.objectStore('nightly_aggregates').put(a);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Transaction failed'));
          };
        };
        req.onerror = () => reject(new Error('Failed to open database'));
      }),
    { dbName: DB_NAME, sessions, aggregates },
  );
  await page.goto('/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
}

const windowToggle = (page: Page) => page.getByRole('radiogroup', { name: 'Time window' });

test.describe('Global time window (WindowToggle)', () => {
  test('defaults to Last 30 days and selecting a preset re-scopes the session list + URL', async ({
    page,
  }) => {
    // One night inside 30 days (5d ago), one only inside 90 days (45d ago).
    await setupSessions(page, [5, 45]);

    // Default preset is 30 days.
    await expect(windowToggle(page).getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const rows = page.locator('tbody tr');
    // Default 30-day window shows only the 5-day-ago night.
    await expect(rows).toHaveCount(1);

    // Switch to the 90-day preset — the 45-day-ago night joins.
    await windowToggle(page).getByRole('radio', { name: 'Last 90 days' }).click();
    await expect(windowToggle(page).getByRole('radio', { name: 'Last 90 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(rows).toHaveCount(2);

    // The global range is mirrored to the URL (rolling 90-day start).
    await expect(page).toHaveURL(new RegExp(`[?&]start=${daysAgoStr(90)}(&|$)`), {
      timeout: 10_000,
    });
  });

  test('the Custom date range popover applies an explicit Start/End', async ({ page }) => {
    // A single night 120 days ago — outside every preset window.
    await setupSessions(page, [120]);

    const rows = page.locator('tbody tr');
    // Default 30-day window excludes it.
    await expect(rows).toHaveCount(0);

    // Open the Custom-range popover and apply a range that includes the night.
    await page.getByRole('button', { name: 'Custom date range' }).click();
    await expect(page.getByText('Custom range')).toBeVisible();
    await page.getByLabel('Start', { exact: true }).fill(daysAgoStr(150));
    await page.getByLabel('End', { exact: true }).fill(daysAgoStr(0));
    await page.getByRole('button', { name: 'Apply' }).click();

    // The popover closes, the night is now in range, and the URL reflects the
    // custom start. With a non-preset span, no "Time window" radio is checked.
    await expect(page.getByText('Custom range')).toBeHidden();
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`[?&]start=${daysAgoStr(150)}(&|$)`), {
      timeout: 10_000,
    });
    await expect(windowToggle(page).getByRole('radio', { checked: true })).toHaveCount(0);
  });
});
