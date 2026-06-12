import { test, expect, type Page } from '@playwright/test';

/**
 * Analysis Engine E2E Tests — Phase 7
 *
 * Verifies that the analysis algorithms execute correctly in a real browser
 * environment with real JS engines (V8, SpiderMonkey, WebKit). Tests cover:
 *
 * 1. Analysis route navigation — all sub-routes render without errors
 * 2. In-browser algorithm verification — dynamic import of analysis modules
 *    via the Vite dev server, executed in real browser context
 * 3. Edge cases — empty data, NaN/Infinity, no console errors
 * 4. Data-injected analysis — IndexedDB seeding + navigation
 *
 * The analysis views are placeholder pages ("Coming soon"), so the in-browser
 * tests verify algorithm correctness by dynamically importing the source
 * modules in page.evaluate(). Vite's dev server serves TS→JS on the fly.
 */

// ── Constants ──

const DB_NAME = 'cpap-analyzer';
// Note: no DB_VERSION constant. The seed helper opens the app DB with a
// version-less indexedDB.open(name) so it attaches to whatever schema version
// the app has already created. Pinning a version here breaks whenever the app
// bumps its schema (a version-less open never throws VersionError on migration).

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

function makeAggregate(id: string, sessionId: string, date: string, ahi = 3.2) {
  return {
    id,
    sessionId,
    machineId: 'TEST-MACHINE',
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

// ── IndexedDB Helper ──

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

// ═══════════════════════════════════════════════════════════════════════════
// 1. Analysis Route Navigation
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Explore Routes — Navigation', () => {
  test('explore hub route renders', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.getByRole('heading', { name: /^explore$/i })).toBeVisible();
  });

  test('correlations route renders statistical tab by default', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();
  });

  test('correlations route deep-links to cross-source tab', async ({ page }) => {
    await page.goto('/explore/correlations?tab=cross-source');
    await expect(page.getByRole('heading', { name: /cross-source analysis/i })).toBeVisible();
  });

  // Event Explorer (`/explore/events`) smoke coverage now lives in
  // `tests/e2e/explore-views.spec.ts`, which asserts against the post-IA
  // EventExplorer heading (`Event Explorer`). The previous test here targeted
  // the deleted EventAnalysis view's `Event Analysis` heading and is dropped
  // rather than rewritten — see `src/views/Explore/EventExplorer/__tests__/`
  // for the rich coverage that replaces it.

  test('pressure optimization route renders', async ({ page }) => {
    await page.goto('/explore/pressure');
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();
  });

  test('sidebar navigation to explore hub', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    const nav = page.getByRole('navigation');
    await nav.getByRole('link', { name: /explore/i }).click();

    await expect(page.getByRole('heading', { name: /^explore$/i })).toBeVisible();
  });

  // ── Legacy redirects ──────────────────────────────────────────────────────

  test('legacy /analysis redirects to /explore', async ({ page }) => {
    await page.goto('/analysis');
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.getByRole('heading', { name: /^explore$/i })).toBeVisible();
  });

  test('legacy /analysis/statistical redirects to /explore/correlations', async ({ page }) => {
    await page.goto('/analysis/statistical');
    await expect(page).toHaveURL(/\/explore\/correlations/);
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();
  });

  test('legacy /analysis/integrations redirects to correlations cross-source tab', async ({
    page,
  }) => {
    await page.goto('/analysis/integrations');
    await expect(page).toHaveURL(/\/explore\/correlations\?tab=cross-source/);
    await expect(page.getByRole('heading', { name: /cross-source analysis/i })).toBeVisible();
  });

  // Legacy `/analysis/events → /explore/events` redirect coverage now lives in
  // `tests/e2e/explore-views.spec.ts` alongside the EventExplorer smoke tests
  // (the post-IA destination heading is `Event Explorer`, not the deleted
  // `Event Analysis`).

  test('legacy /analysis/pressure redirects to /explore/pressure', async ({ page }) => {
    await page.goto('/analysis/pressure');
    await expect(page).toHaveURL(/\/explore\/pressure$/);
    await expect(page.getByRole('heading', { name: /pressure optimization/i })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. In-Browser Algorithm Verification — Descriptive Statistics
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Descriptive Statistics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('computeDescriptiveStats produces correct values', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeDescriptiveStats } = await import('/src/analysis/descriptive/index.ts');
      return computeDescriptiveStats([2, 4, 4, 4, 5, 5, 7, 9]);
    });

    expect(result.count).toBe(8);
    expect(result.mean).toBeCloseTo(5, 5);
    expect(result.median).toBeCloseTo(4.5, 5);
    expect(result.min).toBe(2);
    expect(result.max).toBe(9);
    expect(result.range).toBe(7);
    expect(result.stdDev).toBeCloseTo(2.138, 2);
    expect(result.variance).toBeCloseTo(4.571, 2);
    expect(result.iqr).toBeGreaterThan(0);
  });

  test('percentile uses Type 7 interpolation', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computePercentiles, percentile } = await import('/src/analysis/descriptive/index.ts');
      const data = [15, 20, 35, 40, 50];
      return {
        percs: computePercentiles(data),
        p50: percentile(data, 50),
        p25: percentile(data, 25),
        p75: percentile(data, 75),
      };
    });

    // Type 7 on [15,20,35,40,50]: p50 = 35 (median of 5 elements)
    expect(result.p50).toBeCloseTo(35, 5);
    // p25 => h = (5-1)*0.25 = 1.0 => index 1 => 20
    expect(result.p25).toBeCloseTo(20, 5);
    // p75 => h = (5-1)*0.75 = 3.0 => index 3 => 40
    expect(result.p75).toBeCloseTo(40, 5);
    // Percentiles object should have standard fields
    expect(result.percs).toHaveProperty('p5');
    expect(result.percs).toHaveProperty('p50');
    expect(result.percs).toHaveProperty('p95');
  });

  test('detectOutliers identifies outliers via Tukey fences', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { detectOutliers } = await import('/src/analysis/descriptive/index.ts');
      // 100 is a clear outlier in this dataset
      return detectOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    });

    expect(result.outlierCount).toBeGreaterThanOrEqual(1);
    expect(result.outliers).toContain(100);
    expect(result.lowerFence).toBeLessThan(result.upperFence);
  });

  test('computeHistogram bins data correctly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeHistogram } = await import('/src/analysis/descriptive/index.ts');
      const data = Array.from({ length: 100 }, (_, i) => i);
      return computeHistogram(data);
    });

    expect(result.totalCount).toBe(100);
    expect(result.bins.length).toBeGreaterThanOrEqual(5);
    expect(result.binWidth).toBeGreaterThan(0);
    // Sum of bin counts should equal total
    const sumCounts = result.bins.reduce((acc: number, b: { count: number }) => acc + b.count, 0);
    expect(sumCounts).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. In-Browser Algorithm Verification — Time-Series Analysis
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Time-Series', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('linearTrend detects increasing trend', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { linearTrend } = await import('/src/analysis/timeseries/index.ts');
      // Monotonically increasing values
      const dates = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(2024, 0, i + 1);
        return d.toISOString().slice(0, 10);
      });
      const values = dates.map((_, i) => 5 + i * 0.5);
      return linearTrend(dates, values);
    });

    expect(result.slope).toBeGreaterThan(0);
    expect(result.r).toBeGreaterThan(0.9);
    expect(result.rSquared).toBeGreaterThan(0.9);
    expect(result.trendDirection).toBe('increasing');
  });

  test('rollingMean computes windowed averages', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { rollingMean } = await import('/src/analysis/timeseries/index.ts');
      const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
      const values = [10, 20, 30, 40, 50];
      return rollingMean(dates, values, 3);
    });

    expect(result.values).toHaveLength(5);
    // Window of 3: first value is just [10], second is avg(10,20)=15, third is avg(10,20,30)=20
    expect(result.values[0]).toBeCloseTo(10, 5);
    expect(result.values[2]).toBeCloseTo(20, 5);
    // Last value: avg(30,40,50) = 40
    expect(result.values[4]).toBeCloseTo(40, 5);
  });

  test('detectChangePoints finds step-function transitions', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { detectChangePoints } = await import('/src/analysis/timeseries/index.ts');
      // Step function: 50 values at 5, then 50 values at 15
      const values = [...Array(50).fill(5), ...Array(50).fill(15)] as number[];
      const dates = values.map((_, i) => {
        const d = new Date(2024, 0, i + 1);
        return d.toISOString().slice(0, 10);
      });
      return detectChangePoints(values, dates);
    });

    // Should detect at least one change point near index 50
    expect(result.changePoints.length).toBeGreaterThanOrEqual(1);
    expect(result.segments.length).toBeGreaterThanOrEqual(2);

    // At least one change point should be near the transition
    const cpIndices = result.changePoints.map((cp: { index: number }) => cp.index);
    const nearTransition = cpIndices.some((idx: number) => idx >= 45 && idx <= 55);
    expect(nearTransition).toBe(true);
  });

  test('acf lag-0 equals 1', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { acf } = await import('/src/analysis/timeseries/index.ts');
      // White noise-like data
      const data = [1, 3, 2, 5, 4, 6, 3, 7, 2, 8, 1, 5, 3, 6, 4, 7, 2, 9, 3, 5];
      return acf(data, 10);
    });

    expect(result.lags[0]).toBe(0);
    expect(result.acf[0]).toBeCloseTo(1, 5);
    expect(result.significanceBound).toBeGreaterThan(0);
    // Subsequent lags should be < 1
    expect(Math.abs(result.acf[1])).toBeLessThan(1);
  });

  test('pacf produces valid partial autocorrelations', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { pacf } = await import('/src/analysis/timeseries/index.ts');
      const data = [1, 3, 2, 5, 4, 6, 3, 7, 2, 8, 1, 5, 3, 6, 4, 7, 2, 9, 3, 5];
      return pacf(data, 5);
    });

    expect(result.lags).toHaveLength(5);
    expect(result.pacf).toHaveLength(5);
    // PACF values should be in [-1, 1]
    for (const val of result.pacf) {
      expect(val).toBeGreaterThanOrEqual(-1);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. In-Browser Algorithm Verification — Correlation Analysis
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Correlation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('pearsonCorrelation detects strong positive relationship', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { pearsonCorrelation } = await import('/src/analysis/correlation/index.ts');
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const y = [2, 4, 5, 4, 5, 7, 8, 9, 10, 12];
      return pearsonCorrelation(x, y);
    });

    expect(result.r).toBeGreaterThan(0.9);
    expect(result.rSquared).toBeGreaterThan(0.8);
    expect(result.direction).toBe('positive');
    expect(result.strength).toBe('very strong');
    expect(result.n).toBe(10);
    expect(result.pValue).toBeLessThan(0.01);
  });

  test('spearmanCorrelation detects monotonic relationship', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { spearmanCorrelation } = await import('/src/analysis/correlation/index.ts');
      // Monotonic but non-linear
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const y = [1, 4, 9, 16, 25, 36, 49, 64, 81, 100];
      return spearmanCorrelation(x, y);
    });

    // Perfect monotonic → Spearman r = 1
    expect(result.r).toBeCloseTo(1, 5);
    expect(result.direction).toBe('positive');
  });

  test('crossCorrelation finds best lag', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { crossCorrelation } = await import('/src/analysis/correlation/index.ts');
      // y is x shifted by 2 positions
      const x = [0, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const y = [0, 0, 0, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0];
      return crossCorrelation(x, y, 5);
    });

    expect(result.lags.length).toBeGreaterThan(0);
    expect(result.significanceBound).toBeGreaterThan(0);
    // Best lag should be ±2 (y is x shifted by 2 positions)
    expect(Math.abs(result.bestLag)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Edge Cases — Robustness
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('empty data returns NaN without crashing', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeDescriptiveStats } = await import('/src/analysis/descriptive/index.ts');
      const stats = computeDescriptiveStats([]);
      return {
        count: stats.count,
        mean: stats.mean,
        median: stats.median,
        stdDev: stats.stdDev,
      };
    });

    expect(result.count).toBe(0);
    expect(result.mean).toBeNaN();
    expect(result.median).toBeNaN();
    expect(result.stdDev).toBeNaN();
  });

  test('NaN and Infinity values are filtered gracefully', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeDescriptiveStats } = await import('/src/analysis/descriptive/index.ts');
      const stats = computeDescriptiveStats([1, NaN, 3, Infinity, 5, -Infinity, 7]);
      return { count: stats.count, mean: stats.mean, min: stats.min, max: stats.max };
    });

    // Only finite values: [1, 3, 5, 7]
    expect(result.count).toBe(4);
    expect(result.mean).toBeCloseTo(4, 5);
    expect(result.min).toBe(1);
    expect(result.max).toBe(7);
  });

  test('single-element data does not crash', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeDescriptiveStats, detectOutliers, computePercentiles } =
        await import('/src/analysis/descriptive/index.ts');
      const stats = computeDescriptiveStats([42]);
      const outliers = detectOutliers([42]);
      const percs = computePercentiles([42]);
      return { stats, outliers, percs };
    });

    expect(result.stats.count).toBe(1);
    expect(result.stats.mean).toBe(42);
    expect(result.stats.median).toBe(42);
    expect(result.outliers.outlierCount).toBe(0);
    expect(result.percs.p50).toBeCloseTo(42, 5);
  });

  test('correlation with insufficient data returns NaN', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { pearsonCorrelation } = await import('/src/analysis/correlation/index.ts');
      // n < 3 → NaN result
      return pearsonCorrelation([1, 2], [3, 4]);
    });

    expect(result.n).toBe(2);
    expect(result.r).toBeNaN();
    expect(result.pValue).toBeNaN();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Console Error Monitoring & Data-Injected Navigation
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Integration', () => {
  test('no console errors during analysis module execution', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    // Execute a batch of analysis functions in the browser
    await page.evaluate(async () => {
      const desc = await import('/src/analysis/descriptive/index.ts');
      const ts = await import('/src/analysis/timeseries/index.ts');
      const corr = await import('/src/analysis/correlation/index.ts');

      const data = [3, 5, 7, 8, 2, 4, 6, 9, 1, 10];
      const dates = data.map((_, i) => {
        const d = new Date(2024, 0, i + 1);
        return d.toISOString().slice(0, 10);
      });

      desc.computeDescriptiveStats(data);
      desc.computePercentiles(data);
      desc.detectOutliers(data);
      desc.computeHistogram(data);
      ts.linearTrend(dates, data);
      ts.rollingMean(dates, data, 3);
      ts.acf(data, 5);
      corr.pearsonCorrelation(
        data,
        data.map((v) => v * 2 + 1),
      );
      corr.spearmanCorrelation(
        data,
        data.map((v) => v * 2 + 1),
      );
    });

    expect(consoleErrors).toHaveLength(0);
  });

  test('analysis routes render without errors after data injection', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // First load to create DB schema
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    // Inject test sessions
    const sessions = Array.from({ length: 7 }, (_, i) => makeSession(`sess-${i}`, daysAgoStr(i)));
    const aggregates = sessions.map((s, i) => makeAggregate(`agg-${i}`, s.id, s.date, 2 + i * 0.5));
    await injectTestData(page, sessions, aggregates);

    // Navigate to each analysis route and verify no errors.
    // `/explore/events` (Event Explorer, post-IA) is exercised by the
    // explore-views smoke spec — leaving it out here keeps this suite focused
    // on the Statistical Analysis + Pressure Optimization views that still
    // ship from this file's analysis-engine surface.
    const routes = [
      { path: '/explore', heading: /^explore$/i },
      { path: '/explore/correlations', heading: /statistical analysis/i },
      { path: '/explore/pressure', heading: /pressure optimization/i },
      { path: '/explore/correlations?tab=cross-source', heading: /cross-source analysis/i },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    }

    // Filter out React Router / dev-mode noise — only real app errors matter
    const realErrors = consoleErrors.filter(
      (msg) => !msg.includes('React Router') && !msg.includes('DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });
});
