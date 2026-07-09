import { test, expect, type Page } from '@playwright/test';

/**
 * Trends Canvas2D theme-repaint guard (command-surface refresh, Phase 3).
 *
 * The six Trends charts are Canvas2D; their base layer is repainted with the
 * resolved theme's surface colour (`renderer.beginBase(colors.surfacePrimary)`).
 * A prior bug left the canvases painted in the STALE theme after a light→dark
 * change (fixed in commit 94ccbc5 "fix canvas theme repaint"). These guards read
 * the actual canvas pixels and assert the base is genuinely DARK:
 *
 *   (1) after a runtime light→dark theme toggle, and
 *   (2) on a cold boot with a persisted dark theme (reload).
 *
 * We average PERCEPTUAL luminance over OPAQUE pixels only — the opaque base fill,
 * independent of the transparent crosshair-overlay canvas or DOM order — so a
 * stale light canvas (~white surface) fails and a correct dark canvas (~#0a0a0a)
 * passes. This is the pixel-downsample pattern from the design-refresh probes.
 */

const DB_NAME = 'cpap-analyzer';
// Dark surface (--color-surface-primary ≈ #0a0a0a) → luminance ≈ 0.04; sparse
// chart ink lifts the average only slightly. Light surface (~#fff) → ≈ 0.9+.
// 0.4 sits well clear of both, so it cleanly separates dark from a stale-light
// repaint without being brittle to the exact ink coverage.
const DARK_MAX_LUMINANCE = 0.4;

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeSession(id: string, date: string) {
  return {
    id,
    machineId: 'TREND-THEME',
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

function makeAggregate(id: string, sessionId: string, date: string, i: number) {
  return {
    id,
    sessionId,
    machineId: 'TREND-THEME',
    date,
    ahi: 3.0 + Math.sin(i / 2) + 1,
    ahiObstructive: 1.0,
    ahiCentral: 0.5,
    ahiMixed: 0.1,
    ahiHypopnea: 1.5,
    ahiRera: 0.2,
    eventCount: 12,
    eventsByType: {
      obstructive: 4,
      central: 2,
      mixed: 1,
      hypopnea: 5,
      rera: 1,
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
    leakMedian: 4.5 + (i % 3),
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
    usageHours: 6.5 + (i % 4) * 0.4,
    maskOnTimeMinutes: 420,
    complianceStatus: 'compliant' as const,
    configuredMinPressure: 6,
    configuredMaxPressure: 14,
    eprLevel: 2,
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

function seedData() {
  const sessions = Array.from({ length: 14 }, (_, i) => makeSession(`tt-${i}`, daysAgoStr(i)));
  const aggregates = sessions.map((s, i) => makeAggregate(`tt-agg-${i}`, s.id, s.date, i));
  return { sessions, aggregates };
}

/**
 * Average perceptual luminance (0..1) over the OPAQUE pixels of the first Trends
 * figure's canvases — i.e. the opaque base fill, ignoring the transparent
 * overlay. Strided sampling keeps it fast. Returns -1 if no canvas/opaque pixel.
 */
async function figureBaseLuminance(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const fig = document.querySelector('section[role="figure"]');
    if (!fig) return -1;
    const canvases = Array.from(fig.querySelectorAll('canvas')) as HTMLCanvasElement[];
    let sum = 0;
    let count = 0;
    for (const c of canvases) {
      const ctx = c.getContext('2d');
      if (!ctx || c.width === 0 || c.height === 0) continue;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      // Stride over ~4000 samples max; only count opaque pixels (the base fill).
      const stride = 4 * Math.max(1, Math.floor(data.length / 4 / 4000));
      for (let i = 0; i < data.length; i += stride) {
        if (data[i + 3] < 200) continue; // skip transparent overlay pixels
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        count++;
      }
    }
    return count > 0 ? sum / count / 255 : -1;
  });
}

const themeTrigger = (page: Page) => page.getByRole('button', { name: /^Theme:/ });

async function seedAndOpenTrends(page: Page): Promise<void> {
  const { sessions, aggregates } = seedData();
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await injectData(page, sessions, aggregates);
  await page.goto('/trends');
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('section[role="figure"] canvas').first()).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Trends canvas theme repaint', () => {
  test('canvases repaint dark after a light→dark theme toggle', async ({ page }) => {
    await seedAndOpenTrends(page);

    // Default (System→light in Playwright): the base is LIGHT.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const lightLum = await figureBaseLuminance(page);
    expect(lightLum, 'light-theme canvas should be light').toBeGreaterThan(0.6);

    // Toggle to Dark via the theme menu.
    await themeTrigger(page).click();
    await page.getByRole('menuitemradio', { name: /^Dark/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // The base canvas must repaint DARK (guards the stale-repaint bug). Poll to
    // ride out the redraw without an arbitrary sleep.
    await expect
      .poll(() => figureBaseLuminance(page), { timeout: 10_000 })
      .toBeLessThan(DARK_MAX_LUMINANCE);
  });

  test('canvases render dark on a cold boot with a persisted dark theme', async ({ page }) => {
    await seedAndOpenTrends(page);

    // Persist a dark theme through the app's own control, then reload so the
    // charts cold-boot from the rehydrated store.
    await themeTrigger(page).click();
    await page.getByRole('menuitemradio', { name: /^Dark/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('section[role="figure"] canvas').first()).toBeVisible({
      timeout: 15_000,
    });

    // The very first cold-boot paint must already be dark (no resize needed).
    await expect
      .poll(() => figureBaseLuminance(page), { timeout: 10_000 })
      .toBeLessThan(DARK_MAX_LUMINANCE);
  });
});
