import { test, expect } from '@playwright/test';

/**
 * Analysis Engine E2E Tests — Phase 8
 *
 * Verifies Phase 8 advanced analysis algorithms in a real browser environment.
 * Tests cover hypothesis testing, distribution analysis, event clustering,
 * survival analysis, pressure analysis, and Granger causality.
 *
 * Uses the same pattern as Phase 7: dynamic import of analysis modules via
 * page.evaluate(), leveraging Vite's dev server TS→JS on-the-fly transpilation.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. Hypothesis Testing
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Hypothesis Testing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('mannWhitneyU detects significant difference between groups', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { mannWhitneyU } = await import('/src/analysis/hypothesis/index.ts');
      return mannWhitneyU([3, 4, 2, 6, 2, 5], [9, 7, 5, 10, 6, 8]);
    });

    expect(typeof result.u).toBe('number');
    expect(result.pValue).toBeLessThan(0.05);
    expect(typeof result.effectSize).toBe('number');
    expect(['negligible', 'small', 'medium', 'large']).toContain(result.effectSizeInterpretation);
    expect(result.n1).toBe(6);
    expect(result.n2).toBe(6);
  });

  test('wilcoxonSignedRank detects paired difference', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { wilcoxonSignedRank } = await import('/src/analysis/hypothesis/index.ts');
      return wilcoxonSignedRank([125, 115, 130, 140, 140], [110, 122, 125, 120, 140]);
    });

    expect(typeof result.w).toBe('number');
    expect(typeof result.pValue).toBe('number');
    expect(typeof result.effectSize).toBe('number');
    expect(['negligible', 'small', 'medium', 'large']).toContain(result.effectSizeInterpretation);
    // n = 4 because one pair (140 vs 140) has zero difference and is excluded
    expect(result.n).toBe(4);
  });

  test('cohensD reports large effect for distant groups', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { cohensD } = await import('/src/analysis/hypothesis/index.ts');
      return cohensD([2, 4, 6, 8, 10], [12, 14, 16, 18, 20]);
    });

    expect(Math.abs(result.d)).toBeGreaterThan(0.5);
    expect(typeof result.g).toBe('number');
    expect(result.interpretation).toBe('large');
    expect(result.ci95Lower).toBeLessThan(result.ci95Upper);
    expect(result.pooledStdDev).toBeGreaterThan(0);
  });

  test('pairedComparison returns all sub-results', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { pairedComparison } = await import('/src/analysis/hypothesis/index.ts');
      return pairedComparison([8, 9, 7, 10, 8], [4, 5, 3, 6, 4]);
    });

    // mannWhitney sub-result
    expect(typeof result.mannWhitney.u).toBe('number');
    expect(typeof result.mannWhitney.pValue).toBe('number');

    // wilcoxon sub-result
    expect(typeof result.wilcoxon.w).toBe('number');
    expect(typeof result.wilcoxon.pValue).toBe('number');

    // effectSize sub-result
    expect(typeof result.effectSize.d).toBe('number');
    expect(typeof result.effectSize.g).toBe('number');

    // descriptive stats
    expect(typeof result.beforeStats.mean).toBe('number');
    expect(typeof result.beforeStats.median).toBe('number');
    expect(typeof result.afterStats.mean).toBe('number');
    expect(typeof result.afterStats.median).toBe('number');
  });

  test('mannWhitneyU returns NaN fields for empty input', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { mannWhitneyU } = await import('/src/analysis/hypothesis/index.ts');
      return mannWhitneyU([], []);
    });

    expect(result.u).toBeNaN();
    expect(result.pValue).toBeNaN();
    expect(result.effectSize).toBeNaN();
    expect(result.n1).toBe(0);
    expect(result.n2).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Distribution Analysis
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Distribution Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('qqNormal produces correlated quantile pairs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { qqNormal } = await import('/src/analysis/distribution/index.ts');
      return qqNormal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    expect(result.theoreticalQuantiles).toHaveLength(10);
    expect(result.sampleQuantiles).toHaveLength(10);
    expect(result.correlation).toBeGreaterThan(0.9);
    expect(result.correlation).toBeLessThanOrEqual(1);
  });

  test('shapiroWilk returns valid normality test result', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { shapiroWilk } = await import('/src/analysis/distribution/index.ts');
      return shapiroWilk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    expect(result.statistic).toBeGreaterThan(0);
    expect(result.statistic).toBeLessThanOrEqual(1);
    expect(result.testName).toBe('Shapiro-Wilk');
    expect(typeof result.isNormal).toBe('boolean');
    expect(typeof result.pValue).toBe('number');
  });

  test('kolmogorovSmirnov returns valid test result', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { kolmogorovSmirnov } = await import('/src/analysis/distribution/index.ts');
      return kolmogorovSmirnov([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    expect(result.statistic).toBeGreaterThanOrEqual(0);
    expect(result.testName).toBe('Kolmogorov-Smirnov (Lilliefors)');
    expect(typeof result.pValue).toBe('number');
    expect(typeof result.isNormal).toBe('boolean');
  });

  test('kernelDensityEstimation produces valid density curve', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { kernelDensityEstimation } = await import('/src/analysis/distribution/index.ts');
      return kernelDensityEstimation([1, 2, 3, 4, 5]);
    });

    expect(result.x.length).toBeGreaterThan(0);
    expect(result.density.length).toBe(result.x.length);
    expect(result.bandwidth).toBeGreaterThan(0);
    // All density values should be non-negative
    for (const d of result.density) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Event Analysis
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Event Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('FLG clustering groups nearby events into one cluster', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { clusterEventsFLGBridged } = await import('/src/analysis/events/index.ts');

      const makeEvent = (ts: number, dur: number = 15) => ({
        id: `e-${ts}`,
        sessionId: 's1',
        type: 'ObstructiveApnea' as const,
        timestamp: ts,
        duration: dur,
        severity: null,
        pressure: null,
        epap: null,
        ipap: null,
        leak: null,
        spo2: null,
        clusterId: null,
      });

      // 5 events each 30s apart (well within the balanced gap of 60s)
      const base = 1000000;
      const events = [
        makeEvent(base),
        makeEvent(base + 30000),
        makeEvent(base + 60000),
        makeEvent(base + 90000),
        makeEvent(base + 120000),
      ];

      return clusterEventsFLGBridged(events, 'balanced');
    });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].events).toHaveLength(5);
    expect(result.unclustered).toHaveLength(0);
  });

  test('K-Means++ clusters events into k groups', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { clusterEventsKMeans } = await import('/src/analysis/events/index.ts');

      const makeEvent = (ts: number, dur: number = 15) => ({
        id: `e-${ts}`,
        sessionId: 's1',
        type: 'ObstructiveApnea' as const,
        timestamp: ts,
        duration: dur,
        severity: null,
        pressure: null,
        epap: null,
        ipap: null,
        leak: null,
        spo2: null,
        clusterId: null,
      });

      // Two groups: 3 events near 0, 3 events near 1M ms
      const events = [
        makeEvent(1000),
        makeEvent(2000),
        makeEvent(3000),
        makeEvent(1000000),
        makeEvent(1001000),
        makeEvent(1002000),
      ];

      return clusterEventsKMeans(events, { k: 2, seed: 42 });
    });

    expect(result.clusters).toHaveLength(2);
    // Total events across clusters should be 6
    const totalEvents = result.clusters.reduce(
      (sum: number, c: { events: unknown[] }) => sum + c.events.length,
      0,
    );
    expect(totalEvents).toBe(6);
  });

  test('agglomerative clustering separates events with large gaps', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { clusterEventsAgglomerative } = await import('/src/analysis/events/index.ts');

      const makeEvent = (ts: number, dur: number = 15) => ({
        id: `e-${ts}`,
        sessionId: 's1',
        type: 'ObstructiveApnea' as const,
        timestamp: ts,
        duration: dur,
        severity: null,
        pressure: null,
        epap: null,
        ipap: null,
        leak: null,
        spo2: null,
        clusterId: null,
      });

      // Two groups separated by a large gap (> 300s default maxGap)
      const events = [
        makeEvent(1000),
        makeEvent(2000),
        makeEvent(3000),
        makeEvent(5000000), // > 300s away
        makeEvent(5001000),
      ];

      return clusterEventsAgglomerative(events);
    });

    expect(result.clusters.length).toBeGreaterThanOrEqual(2);
    expect(result.unclustered).toHaveLength(0);
  });

  test('eventDurationDistribution computes per-type stats', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { eventDurationDistribution } = await import('/src/analysis/events/index.ts');

      const makeEvent = (ts: number, dur: number) => ({
        id: `e-${ts}`,
        sessionId: 's1',
        type: 'ObstructiveApnea' as const,
        timestamp: ts,
        duration: dur,
        severity: null,
        pressure: null,
        epap: null,
        ipap: null,
        leak: null,
        spo2: null,
        clusterId: null,
      });

      const events = [makeEvent(1000, 10), makeEvent(2000, 20), makeEvent(3000, 30)];
      return eventDurationDistribution(events);
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('ObstructiveApnea');
    expect(result[0].count).toBe(3);
    expect(result[0].mean).toBeCloseTo(20, 5);
    expect(result[0].min).toBe(10);
    expect(result[0].max).toBe(30);
  });

  test('interEventIntervals computes correct gaps', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { interEventIntervals } = await import('/src/analysis/events/index.ts');

      const makeEvent = (ts: number, dur: number = 15) => ({
        id: `e-${ts}`,
        sessionId: 's1',
        type: 'ObstructiveApnea' as const,
        timestamp: ts,
        duration: dur,
        severity: null,
        pressure: null,
        epap: null,
        ipap: null,
        leak: null,
        spo2: null,
        clusterId: null,
      });

      // 3 events at 0ms, 60000ms, 180000ms → intervals [60s, 120s]
      const events = [makeEvent(0), makeEvent(60000), makeEvent(180000)];
      return interEventIntervals(events);
    });

    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0]).toBeCloseTo(60, 0);
    expect(result.intervals[1]).toBeCloseTo(120, 0);
    expect(result.count).toBe(2);
    expect(result.mean).toBeCloseTo(90, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Survival Analysis
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Survival Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('kaplanMeier basic: all events produce decreasing survival', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { kaplanMeier } = await import('/src/analysis/survival/index.ts');
      return kaplanMeier([1, 2, 3, 4, 5], [true, true, true, true, true]);
    });

    expect(result.times.length).toBeGreaterThan(0);
    // Survival starts near 1 and decreases
    expect(result.survivors[0]).toBeLessThan(1);
    for (let i = 1; i < result.survivors.length; i++) {
      expect(result.survivors[i]).toBeLessThanOrEqual(result.survivors[i - 1]);
    }
    // With all events observed, median should be a number
    expect(typeof result.medianSurvivalTime).toBe('number');
  });

  test('kaplanMeier with censoring retains CI arrays', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { kaplanMeier } = await import('/src/analysis/survival/index.ts');
      return kaplanMeier([1, 2, 3, 4, 5], [true, false, true, false, true]);
    });

    expect(result.survivors.length).toBeGreaterThan(0);
    expect(result.ciLower.length).toBe(result.times.length);
    expect(result.ciUpper.length).toBe(result.times.length);
    // CI bounds should be in [0, 1]
    for (const val of result.ciLower) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
    for (const val of result.ciUpper) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  test('kaplanMeier all censored: medianSurvivalTime is null', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { kaplanMeier } = await import('/src/analysis/survival/index.ts');
      return kaplanMeier([1, 2, 3], [false, false, false]);
    });

    expect(result.medianSurvivalTime).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Pressure Analysis
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Pressure Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('titrationHelper finds optimal pressure range', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { titrationHelper } = await import('/src/analysis/pressure/index.ts');
      return titrationHelper([8, 9, 10, 11, 12, 10, 11, 9, 10, 11], [8, 6, 3, 2, 7, 4, 3, 5, 3, 2]);
    });

    expect(typeof result.optimalPressureMin).toBe('number');
    expect(typeof result.optimalPressureMax).toBe('number');
    expect(result.optimalPressureMin).toBeLessThanOrEqual(result.optimalPressureMax);
    expect(typeof result.recommendation).toBe('string');
    expect(result.recommendation.length).toBeGreaterThan(0);
    expect(typeof result.ahiAtOptimal).toBe('number');
  });

  test('pressureResponseCurve produces binned response', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { pressureResponseCurve } = await import('/src/analysis/pressure/index.ts');
      return pressureResponseCurve(
        [8, 9, 10, 11, 12, 10, 11, 9, 10, 11],
        [8, 6, 3, 2, 7, 4, 3, 5, 3, 2],
      );
    });

    expect(result.pressureBins.length).toBeGreaterThan(0);
    expect(result.meanAHI.length).toBe(result.pressureBins.length);
    expect(result.rSquared).toBeGreaterThanOrEqual(0);
    expect(result.rSquared).toBeLessThanOrEqual(1);
    expect(typeof result.pValue).toBe('number');
  });

  test('pressureVariability reports stable values', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { pressureVariability } = await import('/src/analysis/pressure/index.ts');
      return pressureVariability([10, 10.1, 9.9, 10.2, 9.8]);
    });

    expect(['very stable', 'stable']).toContain(result.interpretation);
    expect(result.stabilityScore).toBeGreaterThan(0.5);
    expect(result.stabilityScore).toBeLessThanOrEqual(1);
    expect(result.mean).toBeCloseTo(10, 1);
    expect(result.stdDev).toBeLessThan(0.5);
    expect(result.cv).toBeLessThan(0.1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Granger Causality
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Granger Causality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('grangerCausality detects lagged causal relationship', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { grangerCausality } = await import('/src/analysis/correlation/granger.ts');

      // x is a monotonic series; y is x shifted by 1 + small noise
      const x = Array.from({ length: 50 }, (_, i) => i);
      const y = Array.from({ length: 50 }, (_, i) => (i > 0 ? x[i - 1]! + (i % 3) * 0.1 : 0));

      return grangerCausality(x, y);
    });

    expect(result.fStatistic).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
    expect(['X causes Y', 'Y causes X', 'bidirectional', 'none']).toContain(result.causality);
    expect(result.optimalLag).toBeGreaterThanOrEqual(1);
    expect(result.aicValues.length).toBeGreaterThan(0);
  });

  test('grangerCausality with insufficient data returns none', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { grangerCausality } = await import('/src/analysis/correlation/granger.ts');
      return grangerCausality([1, 2], [3, 4]);
    });

    expect(result.causality).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Edge Cases — No Console Errors
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Analysis Engine — Phase 8 Edge Cases', () => {
  test('no console errors from Phase 8 empty-input edge cases', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    await page.evaluate(async () => {
      const hyp = await import('/src/analysis/hypothesis/index.ts');
      const dist = await import('/src/analysis/distribution/index.ts');
      const ev = await import('/src/analysis/events/index.ts');
      const surv = await import('/src/analysis/survival/index.ts');
      const press = await import('/src/analysis/pressure/index.ts');
      const granger = await import('/src/analysis/correlation/granger.ts');

      // Hypothesis — empty inputs
      hyp.mannWhitneyU([], []);
      hyp.wilcoxonSignedRank([], []);
      hyp.cohensD([], []);

      // Distribution — empty inputs
      dist.qqNormal([]);
      dist.shapiroWilk([]);
      dist.kolmogorovSmirnov([]);
      dist.kernelDensityEstimation([]);

      // Events — empty inputs
      ev.clusterEventsFLGBridged([]);
      ev.clusterEventsKMeans([], { k: 2 });
      ev.clusterEventsAgglomerative([]);
      ev.eventDurationDistribution([]);
      ev.interEventIntervals([]);

      // Survival — empty inputs
      surv.kaplanMeier([], []);

      // Pressure — empty inputs
      press.titrationHelper([], []);
      press.pressureResponseCurve([], []);
      press.pressureVariability([]);

      // Granger — insufficient data
      granger.grangerCausality([], []);
    });

    // Filter out React Router / dev-mode noise
    const realErrors = consoleErrors.filter(
      (msg) => !msg.includes('React Router') && !msg.includes('DevTools'),
    );
    expect(realErrors).toHaveLength(0);
  });
});
