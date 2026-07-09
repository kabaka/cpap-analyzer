import { test, expect, type Page } from '@playwright/test';

/**
 * ⌘K command palette (command-surface refresh).
 *
 * A focus-trapped modal dialog (role="dialog" "Command palette") over a combobox
 * filter, surfacing SECTIONS (nav), SESSIONS (date-jump) and ACTIONS. Locks:
 *
 *  - opens via BOTH the global ⌘K/Ctrl+K shortcut and the header
 *    "Open command palette" button; Esc closes and restores focus to the invoker,
 *  - typing filters the option list; activating a section option navigates,
 *  - a date query resolves the night via the date-indexed session lookup and
 *    jumps to that session's detail.
 *
 * Behavioural (roles/URL/focus), so it tolerates visual tweaks.
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
    machineId: 'PALETTE-MACHINE',
    machineModel: 'AirCurve 10 VAuto',
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
    machineId: 'PALETTE-MACHINE',
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

async function injectData(page: Page, sessions: unknown[], aggregates: unknown[]): Promise<void> {
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
}

const paletteTrigger = (page: Page) => page.getByRole('button', { name: 'Open command palette' });
const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });

test.describe('Command palette (⌘K)', () => {
  test('opens via the ⌘K shortcut and the header button; Esc closes and restores focus', async ({
    page,
  }) => {
    await page.goto('/');

    // Not mounted until opened.
    await expect(palette(page)).toBeHidden();

    // ── Open via the header trigger button ──────────────────────────────────
    // Focus the invoker first so focus-restoration is deterministic across
    // browsers (WebKit does not focus a <button> on click).
    const trigger = paletteTrigger(page);
    await trigger.focus();
    await trigger.click();

    const dialog = palette(page);
    await expect(dialog).toBeVisible();
    // The combobox filter takes focus on open.
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();

    // Esc closes and returns focus to the invoking button.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // ── Open via the global ⌘K / Ctrl+K shortcut ────────────────────────────
    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('typing filters the options and a section name navigates', async ({ page }) => {
    await page.goto('/');
    await paletteTrigger(page).click();
    const dialog = palette(page);
    await expect(dialog).toBeVisible();

    const options = dialog.getByRole('option');
    // The empty query lists every section + action as options.
    const unfiltered = await options.count();
    expect(unfiltered).toBeGreaterThan(5);

    // Filtering narrows the list; "trends" surfaces the Trends section option.
    await dialog.getByRole('combobox').fill('trends');
    await expect(dialog.getByRole('option', { name: /Trends/ })).toBeVisible();
    await expect.poll(() => options.count()).toBeLessThan(unfiltered);

    // Activating the Trends option navigates and closes the palette.
    await dialog
      .getByRole('option', { name: /Trends/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/trends(\?|$)/);
    await expect(dialog).toBeHidden();
  });

  test('a date query jumps to the session recorded on that night', async ({ page }) => {
    const date = daysAgoStr(4);
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await injectData(
      page,
      [makeSession('palette-night', date)],
      [makeAggregate('palette-agg', 'palette-night', date)],
    );
    // Reload so the session store is populated for the date-indexed lookup.
    await page.goto('/');

    await paletteTrigger(page).click();
    const dialog = palette(page);
    await expect(dialog).toBeVisible();

    // Type the ISO date — the palette resolves the night via getSessionsByDateRange.
    await dialog.getByRole('combobox').fill(date);

    // The matching night appears as an option (its machine model is the sub-label).
    const sessionOption = dialog.getByRole('option', { name: /AirCurve 10 VAuto/ });
    await expect(sessionOption).toBeVisible({ timeout: 10_000 });

    // Activating it jumps to that session's detail view.
    await sessionOption.click();
    await expect(page).toHaveURL(/\/sessions\/palette-night(\?|$)/);
    await expect(dialog).toBeHidden();
  });
});
