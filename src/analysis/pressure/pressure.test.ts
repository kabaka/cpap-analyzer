import { describe, it, expect } from 'vitest';
import {
  titrationHelper,
  pressureResponseCurve,
  bipapEffectiveness,
  pressureVariability,
} from './index';

// ---------------------------------------------------------------------------
// titrationHelper
// ---------------------------------------------------------------------------

describe('titrationHelper', () => {
  it('should identify the optimal pressure range around 10–11 cmH2O', () => {
    const pressures = [8, 8, 9, 9, 10, 10, 11, 11, 12, 12];
    const ahiValues = [8, 9, 6, 7, 3, 4, 2, 3, 7, 8];

    const result = titrationHelper(pressures, ahiValues);

    // Bins: 8→mean8.5, 9→mean6.5, 10→mean3.5, 11→mean2.5, 12→mean7.5
    // AHI<5: bins 10 and 11 → optimalMin = 10 - 0.25 = 9.75, optimalMax = 11 + 0.25 = 11.25
    expect(result.optimalPressureMin).toBeCloseTo(9.75, 1);
    expect(result.optimalPressureMax).toBeCloseTo(11.25, 1);
    expect(result.ahiAtOptimal).toBeCloseTo(3.0, 1);
    expect(result.recommendation).toContain('Optimal pressure range');
  });

  it('should report lowest AHI when no pressure achieves AHI < 5', () => {
    const pressures = [8, 9, 10];
    const ahiValues = [10, 8, 6];

    const result = titrationHelper(pressures, ahiValues);

    // All bins have mean AHI ≥ 5 → lowest is 6 at pressure 10
    expect(result.recommendation).toContain('No pressure achieves AHI < 5');
    expect(result.recommendation).toContain('further titration');
    expect(result.ahiAtOptimal).toBeCloseTo(6, 1);
  });

  it('should handle insufficient data gracefully (< 2 pairs)', () => {
    const single = titrationHelper([10], [3]);

    expect(single.regressionSlope).toBeNaN();
    expect(single.recommendation).toContain('Insufficient data');

    const empty = titrationHelper([], []);

    expect(empty.optimalPressureMin).toBeNaN();
    expect(empty.recommendation).toContain('Insufficient data');
  });

  it('should filter out non-finite values', () => {
    const pressures = [8, NaN, 10, Infinity, 12];
    const ahiValues = [6, 4, 3, 2, 7];

    const result = titrationHelper(pressures, ahiValues);

    // Only finite pairs: (8,6), (10,3), (12,7) → 3 pairs
    expect(result.pressureAHIPairs).toHaveLength(3);
    expect(Number.isFinite(result.regressionSlope)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pressureResponseCurve
// ---------------------------------------------------------------------------

describe('pressureResponseCurve', () => {
  it('should produce binned data with correct structure', () => {
    const pressures = [8, 9, 10, 11, 12, 8, 9, 10, 11, 12];
    const ahiValues = [6, 5, 3, 2, 7, 7, 4, 4, 3, 8];

    const result = pressureResponseCurve(pressures, ahiValues);

    expect(result.pressureBins.length).toBeGreaterThan(0);
    expect(result.meanAHI.length).toBe(result.pressureBins.length);
    expect(result.medianAHI.length).toBe(result.pressureBins.length);
    expect(result.countPerBin.length).toBe(result.pressureBins.length);

    // Each bin should have positive count
    for (const count of result.countPerBin) {
      expect(count).toBeGreaterThan(0);
    }

    // Total count across bins should equal input length
    const totalCount = result.countPerBin.reduce((a, b) => a + b, 0);
    expect(totalCount).toBe(10);
  });

  it('should produce valid regression statistics', () => {
    const pressures = [8, 9, 10, 11, 12];
    const ahiValues = [10, 8, 5, 3, 1];

    const result = pressureResponseCurve(pressures, ahiValues);

    expect(Number.isFinite(result.regressionSlope)).toBe(true);
    expect(Number.isFinite(result.regressionIntercept)).toBe(true);
    expect(Number.isFinite(result.rSquared)).toBe(true);
    expect(result.rSquared).toBeGreaterThanOrEqual(0);
    expect(result.rSquared).toBeLessThanOrEqual(1);
    expect(Number.isFinite(result.pValue)).toBe(true);
  });

  it('should produce fewer bins with a wider bin width', () => {
    const pressures = [8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12];
    const ahiValues = [6, 5, 5, 4, 3, 3, 2, 4, 7];

    const narrow = pressureResponseCurve(pressures, ahiValues, 0.5);
    const wide = pressureResponseCurve(pressures, ahiValues, 2);

    expect(narrow.pressureBins.length).toBeGreaterThan(wide.pressureBins.length);
  });

  it('should handle empty data gracefully', () => {
    const result = pressureResponseCurve([], []);

    expect(result.pressureBins).toHaveLength(0);
    expect(result.meanAHI).toHaveLength(0);
    expect(result.regressionSlope).toBeNaN();
    expect(result.rSquared).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// bipapEffectiveness
// ---------------------------------------------------------------------------

describe('bipapEffectiveness', () => {
  it('should compute pressure support and detect negative AHI correlation', () => {
    const epap = [6, 7, 8];
    const ipap = [10, 12, 14];
    const ahi = [5, 4, 3];

    const result = bipapEffectiveness(epap, ipap, ahi);

    // pressureSupport = [4, 5, 6]
    expect(result.pressureSupport).toEqual([4, 5, 6]);
    expect(result.meanPressureSupport).toBeCloseTo(5, 5);

    // Perfect negative correlation: slope=-1, r=-1
    expect(result.regressionSlope).toBeCloseTo(-1, 5);
    expect(result.regressionR).toBeCloseTo(-1, 5);

    // |r| = 1 → pValue = 0
    expect(result.pValue).toBe(0);
    expect(result.recommendation).toContain('lower AHI');
  });

  it('should handle empty data gracefully', () => {
    const result = bipapEffectiveness([], [], []);

    expect(result.pressureSupport).toHaveLength(0);
    expect(result.regressionSlope).toBeNaN();
    expect(result.regressionR).toBeNaN();
    expect(result.recommendation).toContain('Insufficient data');
  });
});

// ---------------------------------------------------------------------------
// pressureVariability
// ---------------------------------------------------------------------------

describe('pressureVariability', () => {
  it('should classify stable pressures as very stable or stable', () => {
    const pressures = [10, 10, 10, 10.1, 9.9];

    const result = pressureVariability(pressures);

    expect(result.mean).toBeCloseTo(10, 1);
    expect(result.cv).toBeLessThan(0.05);
    expect(result.interpretation).toBe('very stable');
    expect(result.stabilityScore).toBeGreaterThan(0.95);
  });

  it('should classify widely spread pressures as highly variable', () => {
    const pressures = [5, 10, 15, 20, 25];

    const result = pressureVariability(pressures);

    expect(result.mean).toBeCloseTo(15, 5);
    expect(result.cv).toBeGreaterThan(0.3);
    expect(result.interpretation).toBe('highly variable');
  });

  it('should handle a single value as very stable', () => {
    const result = pressureVariability([10]);

    expect(result.mean).toBe(10);
    expect(result.stdDev).toBe(0);
    expect(result.cv).toBe(0);
    expect(result.stabilityScore).toBe(1);
    expect(result.interpretation).toBe('very stable');
  });

  it('should return NaN values for empty input', () => {
    const result = pressureVariability([]);

    expect(result.mean).toBeNaN();
    expect(result.median).toBeNaN();
    expect(result.stdDev).toBeNaN();
    expect(result.cv).toBeNaN();
    expect(result.stabilityScore).toBeNaN();
  });
});
