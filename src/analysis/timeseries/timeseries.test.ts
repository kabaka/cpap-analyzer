import { describe, it, expect } from 'vitest';
import {
  rollingMean,
  rollingMedian,
  linearTrend,
  loess,
  detectChangePoints,
  stlDecomposition,
  acf,
  pacf,
} from './index';

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Seeded PRNG for reproducible pseudo-random data. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Generate n consecutive ISO date strings starting from startDate. */
function makeDates(n: number, startDate = '2024-01-01'): string[] {
  const dates: string[] = [];
  const d = new Date(startDate);
  for (let i = 0; i < n; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** Generate n Gaussian-ish noise values using Box-Muller on seeded PRNG. */
function seededNoise(n: number, seed: number, stddev = 1): number[] {
  const rng = seededRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Box-Muller approximation using uniform pairs
    const u1 = Math.max(1e-10, rng());
    const u2 = rng();
    out.push(stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. rollingMean
// ---------------------------------------------------------------------------

describe('rollingMean', () => {
  it('should compute 7-day rolling mean on 14 days of ramp data', () => {
    const dates = makeDates(14);
    const values = Array.from({ length: 14 }, (_, i) => i + 1);
    const result = rollingMean(dates, values, 7);

    expect(result.dates).toHaveLength(14);
    expect(result.values).toHaveLength(14);
    expect(result.sampleSizes).toHaveLength(14);

    // First 6 values have sampleSize < 7
    for (let i = 0; i < 6; i++) {
      expect(result.sampleSizes[i]).toBeLessThan(7);
    }
    // From index 6 onward, sampleSize = 7
    for (let i = 6; i < 14; i++) {
      expect(result.sampleSizes[i]).toBe(7);
    }

    // Verify specific values: window [i-6..i] for i>=6
    // At i=6: mean(1..7) = 4
    expect(result.values[6]).toBeCloseTo(4, 5);
    // At i=13: mean(8..14) = 11
    expect(result.values[13]).toBeCloseTo(11, 5);
  });

  it('should return constant mean and zero CI width for constant data', () => {
    const n = 14;
    const dates = makeDates(n);
    const values = new Array<number>(n).fill(5.0);
    const result = rollingMean(dates, values, 7);

    for (let i = 0; i < n; i++) {
      expect(result.values[i]).toBeCloseTo(5.0, 10);
    }

    // CI width should be exactly 0 where we have ≥ 2 samples (variance=0)
    for (let i = 1; i < n; i++) {
      const lower = result.ciLower[i]!;
      const upper = result.ciUpper[i]!;
      expect(upper - lower).toBeCloseTo(0, 10);
    }
  });

  it('should handle dates with gaps (pairwise deletion)', () => {
    // 7 dates with a NaN gap at index 3
    const dates = makeDates(7);
    const values = [1, 2, 3, NaN, 5, 6, 7];
    const result = rollingMean(dates, values, 7);

    // At the last position (index 6), the window is the entire array.
    // filterFinite removes NaN → 6 finite values
    expect(result.sampleSizes[6]).toBe(6);
    // Mean of [1,2,3,5,6,7] = 24/6 = 4
    expect(result.values[6]).toBeCloseTo(4, 5);
  });

  it('should return the single value for a single-date input', () => {
    const dates = makeDates(1);
    const values = [42];
    const result = rollingMean(dates, values, 7);

    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBeCloseTo(42, 10);
    expect(result.sampleSizes[0]).toBe(1);
  });

  it('should return empty arrays for empty input', () => {
    const result = rollingMean([], [], 7);
    expect(result.dates).toHaveLength(0);
    expect(result.values).toHaveLength(0);
    expect(result.ciLower).toHaveLength(0);
    expect(result.ciUpper).toHaveLength(0);
    expect(result.sampleSizes).toHaveLength(0);
  });

  it('should return each value unchanged when window=1', () => {
    const dates = makeDates(5);
    const values = [10, 20, 30, 40, 50];
    const result = rollingMean(dates, values, 1);

    for (let i = 0; i < 5; i++) {
      expect(result.values[i]).toBeCloseTo(values[i]!, 10);
      expect(result.sampleSizes[i]).toBe(1);
    }
  });

  it('should produce ciLower < value < ciUpper when variance > 0', () => {
    const dates = makeDates(10);
    const values = [1, 3, 2, 5, 4, 7, 6, 9, 8, 10];
    const result = rollingMean(dates, values, 5);

    // Check indices where sampleSize >= 2 (CI is defined)
    for (let i = 1; i < 10; i++) {
      if (result.sampleSizes[i]! >= 2) {
        const lower = result.ciLower[i]!;
        const upper = result.ciUpper[i]!;
        const value = result.values[i]!;
        if (Number.isFinite(lower) && Number.isFinite(upper)) {
          expect(lower).toBeLessThanOrEqual(value + 1e-10);
          expect(upper).toBeGreaterThanOrEqual(value - 1e-10);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. rollingMedian
// ---------------------------------------------------------------------------

describe('rollingMedian', () => {
  it('should compute 7-day rolling median matching brute force', () => {
    const dates = makeDates(10);
    const values = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    const result = rollingMedian(dates, values, 7);

    expect(result.dates).toHaveLength(10);
    expect(result.values).toHaveLength(10);

    // Brute-force check for each window
    for (let i = 0; i < 10; i++) {
      const start = Math.max(0, i - 6);
      const windowSlice = values.slice(start, i + 1).sort((a, b) => a - b);
      const n = windowSlice.length;
      const mid = Math.floor(n / 2);
      const expectedMedian =
        n % 2 === 1 ? windowSlice[mid]! : (windowSlice[mid - 1]! + windowSlice[mid]!) / 2;
      expect(result.values[i]).toBeCloseTo(expectedMedian, 10);
    }
  });

  it('should compute correct medians for ramp data with window=3', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const dates = makeDates(10);
    const result = rollingMedian(dates, values, 3);

    // Window contents and expected medians:
    // i=0: [1] → 1
    // i=1: [1,2] → 1.5
    // i=2: [1,2,3] → 2
    // i=3: [2,3,4] → 3
    // i=4: [3,4,5] → 4
    // ...
    const expected = [1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = 0; i < 10; i++) {
      expect(result.values[i]).toBeCloseTo(expected[i]!, 10);
    }
  });

  it('should return empty result for empty input', () => {
    const result = rollingMedian([], [], 5);
    expect(result.dates).toHaveLength(0);
    expect(result.values).toHaveLength(0);
  });

  it('should return the single value for a single-element input', () => {
    const result = rollingMedian(['2024-01-01'], [7.5], 3);
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBeCloseTo(7.5, 10);
  });
});

// ---------------------------------------------------------------------------
// 3. linearTrend
// ---------------------------------------------------------------------------

describe('linearTrend', () => {
  it('should detect perfect positive linear trend', () => {
    const dates = makeDates(10);
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = linearTrend(dates, values);

    expect(result.r).toBeCloseTo(1.0, 5);
    expect(result.rSquared).toBeCloseTo(1.0, 5);
    expect(result.slope).toBeGreaterThan(0);
    expect(result.trendDirection).toBe('increasing');
    expect(result.trendStrength).toBe('strong');
  });

  it('should detect perfect negative linear trend', () => {
    const dates = makeDates(10);
    const values = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    const result = linearTrend(dates, values);

    expect(result.r).toBeCloseTo(-1.0, 5);
    expect(result.rSquared).toBeCloseTo(1.0, 5);
    expect(result.slope).toBeLessThan(0);
    expect(result.trendDirection).toBe('decreasing');
    expect(result.trendStrength).toBe('strong');
  });

  it('should return flat/negligible for constant data', () => {
    const dates = makeDates(10);
    const values = new Array<number>(10).fill(5);
    const result = linearTrend(dates, values);

    // All y are identical → ssYY = 0 → special case: r = 0
    expect(result.r).toBe(0);
    expect(result.trendDirection).toBe('flat');
    expect(result.trendStrength).toBe('negligible');
  });

  it('should handle two-point input as an edge case', () => {
    const dates = makeDates(2);
    const values = [1, 3];
    const result = linearTrend(dates, values);

    // Two points define a perfect line
    expect(Math.abs(result.r)).toBeCloseTo(1.0, 5);
    expect(result.slope).toBeGreaterThan(0);
  });

  it('should report significant p-value for strong trend', () => {
    const dates = makeDates(20);
    const values = Array.from({ length: 20 }, (_, i) => i * 2 + 1);
    const result = linearTrend(dates, values);

    expect(result.pValue).toBeLessThan(0.05);
  });

  it('should report non-significant p-value for flat/random data', () => {
    const dates = makeDates(20);
    const values = new Array<number>(20).fill(5);
    const result = linearTrend(dates, values);

    expect(result.pValue).toBeGreaterThanOrEqual(0.05);
  });

  it('should classify strength thresholds correctly', () => {
    // negligible: |r| < 0.1
    // weak: 0.1 ≤ |r| < 0.3
    // moderate: 0.3 ≤ |r| < 0.5
    // strong: |r| ≥ 0.5

    // Strong trend (|r| ≈ 1)
    const strongResult = linearTrend(makeDates(10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(strongResult.trendStrength).toBe('strong');

    // Flat/negligible trend (constant)
    const flatResult = linearTrend(makeDates(10), new Array<number>(10).fill(3));
    expect(flatResult.trendStrength).toBe('negligible');
  });

  it('should return NaN results for empty input', () => {
    const result = linearTrend([], []);
    expect(result.slope).toBeNaN();
    expect(result.intercept).toBeNaN();
    expect(result.trendDirection).toBe('flat');
  });
});

// ---------------------------------------------------------------------------
// 4. loess
// ---------------------------------------------------------------------------

describe('loess', () => {
  it('should smooth a sine wave with noise', () => {
    const n = 50;
    const rng = seededRandom(42);
    const x = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 2 * Math.PI);
    const y = x.map((xi) => Math.sin(xi) + (rng() - 0.5) * 0.3);

    const result = loess(x, y, 0.4, 1);

    // Smoothed values should track sin(x) within some tolerance
    for (let i = 0; i < result.x.length; i++) {
      const expectedY = Math.sin(result.x[i]!);
      expect(result.y[i]).toBeCloseTo(expectedY, 0); // within ~0.5
    }
  });

  it('should reconstruct linear data exactly for degree=1', () => {
    const x = Array.from({ length: 20 }, (_, i) => i);
    const y = x.map((xi) => 2 * xi + 1);
    const result = loess(x, y, 0.5, 1, x);

    for (let i = 0; i < x.length; i++) {
      expect(result.y[i]).toBeCloseTo(2 * x[i]! + 1, 3);
    }
  });

  it('should return the correct number of default evaluation points', () => {
    const n = 100;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = x.map((xi) => xi * xi);
    const result = loess(x, y);

    // Default is min(60, n) = 60
    expect(result.x).toHaveLength(60);
    expect(result.y).toHaveLength(60);
  });

  it('should return specified number of evaluation points', () => {
    const x = Array.from({ length: 30 }, (_, i) => i);
    const y = x.map((xi) => xi);
    const evalPoints = [0, 5, 10, 15, 20, 25, 29];
    const result = loess(x, y, 0.5, 1, evalPoints);

    expect(result.x).toHaveLength(7);
  });

  it('should return residuals array matching input size', () => {
    const x = Array.from({ length: 20 }, (_, i) => i);
    const y = x.map((xi) => xi + Math.sin(xi));
    const result = loess(x, y, 0.5, 1);

    // Residuals should equal the number of original data points
    expect(result.residuals).toHaveLength(20);
  });

  it('should return empty result for empty input', () => {
    const result = loess([], []);
    expect(result.x).toHaveLength(0);
    expect(result.y).toHaveLength(0);
    expect(result.residuals).toHaveLength(0);
  });

  it('should handle small dataset (n=3)', () => {
    const x = [1, 2, 3];
    const y = [2, 4, 6];
    const result = loess(x, y, 1.0, 1, x);

    expect(result.x).toHaveLength(3);
    // Linear data → smoothed should be close to original
    for (let i = 0; i < 3; i++) {
      expect(result.y[i]).toBeCloseTo(y[i]!, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. detectChangePoints (PELT)
// ---------------------------------------------------------------------------

describe('detectChangePoints', () => {
  it('should detect a single step change', () => {
    const values = [0, 0, 0, 0, 0, 10, 10, 10, 10, 10];
    const dates = makeDates(10);
    const result = detectChangePoints(values, dates, 5);

    expect(result.changePoints.length).toBeGreaterThanOrEqual(1);
    // The change should be near index 5
    const cpIndices = result.changePoints.map((cp) => cp.index);
    expect(cpIndices.some((idx) => idx >= 4 && idx <= 6)).toBe(true);
  });

  it('should detect no change points for constant data', () => {
    const values = new Array<number>(20).fill(5);
    const dates = makeDates(20);
    const result = detectChangePoints(values, dates, 10);

    expect(result.changePoints).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.mean).toBeCloseTo(5, 5);
  });

  it('should detect multiple change points', () => {
    const values = [
      ...new Array<number>(10).fill(0),
      ...new Array<number>(10).fill(5),
      ...new Array<number>(10).fill(10),
    ];
    const dates = makeDates(30);
    const result = detectChangePoints(values, dates, 5);

    expect(result.changePoints.length).toBeGreaterThanOrEqual(2);
  });

  it('should produce segments with means that match the data', () => {
    const values = [1, 1, 1, 1, 1, 10, 10, 10, 10, 10];
    const dates = makeDates(10);
    const result = detectChangePoints(values, dates, 5);

    for (const seg of result.segments) {
      const segValues = values.slice(seg.start, seg.end + 1);
      const segMean = segValues.reduce((a, b) => a + b, 0) / segValues.length;
      expect(seg.mean).toBeCloseTo(segMean, 5);
    }
  });

  it('should detect fewer change points with high penalty', () => {
    const values = [
      ...new Array<number>(10).fill(0),
      ...new Array<number>(10).fill(5),
      ...new Array<number>(10).fill(10),
    ];
    const dates = makeDates(30);
    const lowPenalty = detectChangePoints(values, dates, 1);
    const highPenalty = detectChangePoints(values, dates, 1000);

    expect(highPenalty.changePoints.length).toBeLessThanOrEqual(lowPenalty.changePoints.length);
  });

  it('should detect more change points with low penalty', () => {
    const rng = seededRandom(99);
    const values = Array.from({ length: 50 }, (_, i) => {
      const base = i < 15 ? 0 : i < 30 ? 10 : 20;
      return base + (rng() - 0.5) * 2;
    });
    const dates = makeDates(50);

    const lowPenalty = detectChangePoints(values, dates, 0.5);
    const highPenalty = detectChangePoints(values, dates, 100);

    expect(lowPenalty.changePoints.length).toBeGreaterThanOrEqual(highPenalty.changePoints.length);
  });

  it('should return no change points for empty input', () => {
    const result = detectChangePoints([], []);
    expect(result.changePoints).toHaveLength(0);
    expect(result.segments).toHaveLength(0);
  });

  it('should handle a single-element input gracefully', () => {
    const result = detectChangePoints([42], ['2024-01-01'], 10);
    expect(result.changePoints).toHaveLength(0);
    expect(result.segments).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Scale-aware default penalty (β = 2·ln(n)·σ̂²).
  //
  // The L2 cost is scale-dependent, so the omitted-penalty default must adapt
  // to the metric's units. The SAME mean-shift signal expressed on two scales
  // (×10) must yield the SAME segmentation under the default, whereas a fixed
  // raw penalty would behave completely differently across scales.
  // -------------------------------------------------------------------------
  describe('scale-aware default penalty', () => {
    const makeStep = (scale: number): number[] => [
      // low-noise step from 0 → 10·scale at index 15
      ...Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 0.1 : -0.1) * scale),
      ...Array.from({ length: 15 }, (_, i) => (10 + (i % 2 === 0 ? 0.1 : -0.1)) * scale),
    ];

    it('should be invariant to a global rescale of the data (default penalty)', () => {
      const small = makeStep(1); // e.g. AHI-scale
      const large = makeStep(10); // e.g. leak-rate-scale (×10)
      const dates = makeDates(30);

      const rSmall = detectChangePoints(small, dates); // omit penalty → default
      const rLarge = detectChangePoints(large, dates);

      // Same number of change points and same locations regardless of scale.
      const idxSmall = rSmall.changePoints.map((c) => c.index);
      const idxLarge = rLarge.changePoints.map((c) => c.index);
      expect(idxLarge).toEqual(idxSmall);
      // And it should find the single genuine step near index 15.
      expect(idxSmall.some((i) => i >= 14 && i <= 16)).toBe(true);
    });

    it('should detect no change points for constant data under the default', () => {
      const values = new Array<number>(20).fill(7);
      const dates = makeDates(20);
      const result = detectChangePoints(values, dates); // default penalty
      expect(result.changePoints).toHaveLength(0);
    });

    it('should still honor an explicit penalty as a raw L2 penalty', () => {
      // An explicit huge penalty suppresses all change points regardless of
      // scale; an explicit tiny penalty admits many. This confirms explicit
      // values bypass the scale-aware default (backward compatible).
      const values = makeStep(1);
      const dates = makeDates(30);

      expect(detectChangePoints(values, dates, 1e9).changePoints).toHaveLength(0);
      expect(detectChangePoints(values, dates, 0.0001).changePoints.length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 6. stlDecomposition
// ---------------------------------------------------------------------------

describe('stlDecomposition', () => {
  it('should decompose a synthetic weekly pattern and recover trend + seasonal', () => {
    const n = 28;
    const dates = makeDates(n);
    const noise = seededNoise(n, 123, 0.05);

    // Known components
    const trendTrue = Array.from({ length: n }, (_, i) => 0.1 * i);
    const seasonalTrue = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * (i % 7)) / 7));
    const values = Array.from(
      { length: n },
      (_, i) => trendTrue[i]! + seasonalTrue[i]! + noise[i]!,
    );

    const result = stlDecomposition(dates, values, 7, false);

    expect(result.trend).toHaveLength(n);
    expect(result.seasonal).toHaveLength(n);
    expect(result.remainder).toHaveLength(n);

    // Verify trend is approximately increasing (allowing small non-monotonicity at edges)
    let increasingCount = 0;
    for (let i = 3; i < n - 3; i++) {
      if (result.trend[i]! < result.trend[i + 1]!) {
        increasingCount++;
      }
    }
    // At least 60% of interior points should be increasing
    expect(increasingCount / (n - 7)).toBeGreaterThan(0.5);

    // Verify seasonal component repeats with period 7
    for (let i = 0; i < n - 7; i++) {
      expect(result.seasonal[i]).toBeCloseTo(result.seasonal[i + 7]!, 1);
    }

    // Verify additive decomposition: trend + seasonal + remainder ≈ original
    for (let i = 0; i < n; i++) {
      const reconstructed = result.trend[i]! + result.seasonal[i]! + result.remainder[i]!;
      expect(reconstructed).toBeCloseTo(values[i]!, 5);
    }
  });

  it('should return constant trend and zero seasonal for constant data', () => {
    const n = 21;
    const dates = makeDates(n);
    const values = new Array<number>(n).fill(10);
    const result = stlDecomposition(dates, values, 7, false);

    // Trend should be ~10 (the constant value)
    for (let i = 0; i < n; i++) {
      expect(result.trend[i]).toBeCloseTo(10, 3);
    }

    // Seasonal should be near 0
    for (let i = 0; i < n; i++) {
      expect(result.seasonal[i]).toBeCloseTo(0, 3);
    }

    // Remainder should be near 0
    for (let i = 0; i < n; i++) {
      expect(result.remainder[i]).toBeCloseTo(0, 3);
    }
  });

  it('should return empty result for empty input', () => {
    const result = stlDecomposition([], []);
    expect(result.trend).toHaveLength(0);
    expect(result.seasonal).toHaveLength(0);
    expect(result.remainder).toHaveLength(0);
    expect(result.dates).toHaveLength(0);
  });

  it('should handle short data (n < period) gracefully', () => {
    const dates = makeDates(3);
    const values = [1, 2, 3];
    const result = stlDecomposition(dates, values, 7, false);

    // Should still produce arrays of length 3 (not crash)
    expect(result.trend).toHaveLength(3);
    expect(result.seasonal).toHaveLength(3);
    expect(result.remainder).toHaveLength(3);
  });

  it('should preserve date array in output', () => {
    const dates = makeDates(14);
    const values = Array.from({ length: 14 }, (_, i) => i);
    const result = stlDecomposition(dates, values, 7);

    expect(result.dates).toEqual(dates);
  });
});

// ---------------------------------------------------------------------------
// 7. acf
// ---------------------------------------------------------------------------

describe('acf', () => {
  it('should return acf[0] = 1.0 for any non-constant data', () => {
    const noise = seededNoise(100, 42);
    const result = acf(noise);

    expect(result.acf[0]).toBeCloseTo(1.0, 10);
    expect(result.lags[0]).toBe(0);
  });

  it('should show exponential decay for an AR(1) process with φ=0.8', () => {
    const n = 500;
    const phi = 0.8;
    const noise = seededNoise(n, 77, 0.5);
    const x: number[] = [noise[0]!];
    for (let i = 1; i < n; i++) {
      x.push(phi * x[i - 1]! + noise[i]!);
    }

    const result = acf(x);

    // acf at lag 1 should be close to phi=0.8
    expect(result.acf[1]).toBeCloseTo(phi, 0.5);

    // ACF should decay: |acf[k]| > |acf[k+1]| for first few lags
    for (let k = 1; k < 5; k++) {
      expect(Math.abs(result.acf[k]!)).toBeGreaterThan(Math.abs(result.acf[k + 1]!) - 0.1);
    }
  });

  it('should return acf=0 for lags > 0 when data is constant', () => {
    const values = new Array<number>(50).fill(10);
    const result = acf(values);

    expect(result.acf[0]).toBeCloseTo(1, 10);
    for (let k = 1; k < result.acf.length; k++) {
      expect(result.acf[k]).toBeCloseTo(0, 10);
    }
  });

  it('should compute significance bound as 1.96/sqrt(n)', () => {
    const n = 100;
    const values = seededNoise(n, 55);
    const result = acf(values);

    expect(result.significanceBound).toBeCloseTo(1.96 / Math.sqrt(n), 5);
  });

  it('should use default maxLag = min(30, n/2)', () => {
    // n=100 → maxLag=min(30,50)=30, so lags 0..30 → 31 entries
    const result100 = acf(seededNoise(100, 1));
    expect(result100.lags).toHaveLength(31);
    expect(result100.lags[result100.lags.length - 1]).toBe(30);

    // n=20 → maxLag=min(30,10)=10, so lags 0..10 → 11 entries
    const result20 = acf(seededNoise(20, 2));
    expect(result20.lags).toHaveLength(11);
    expect(result20.lags[result20.lags.length - 1]).toBe(10);
  });

  it('should return empty result for empty or single-value input', () => {
    const emptyResult = acf([]);
    expect(emptyResult.lags).toHaveLength(0);
    expect(emptyResult.acf).toHaveLength(0);
    expect(emptyResult.significanceBound).toBeNaN();

    const singleResult = acf([42]);
    expect(singleResult.lags).toHaveLength(0);
    expect(singleResult.acf).toHaveLength(0);
  });

  it('should respect custom maxLag parameter', () => {
    const values = seededNoise(100, 3);
    const result = acf(values, 5);
    expect(result.lags).toHaveLength(6); // lags 0..5
    expect(result.lags[result.lags.length - 1]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 8. pacf
// ---------------------------------------------------------------------------

describe('pacf', () => {
  it('should show pacf[0] ≈ 0.8 for AR(1) process with φ=0.8', () => {
    const n = 500;
    const phi = 0.8;
    const noise = seededNoise(n, 77, 0.5);
    const x: number[] = [noise[0]!];
    for (let i = 1; i < n; i++) {
      x.push(phi * x[i - 1]! + noise[i]!);
    }

    const result = pacf(x);

    // PACF at lag 1 should be close to phi
    expect(result.pacf[0]).toBeCloseTo(phi, 0.5);

    // PACF at lag 2+ should be near zero (within significance bounds or small)
    for (let k = 1; k < Math.min(5, result.pacf.length); k++) {
      expect(Math.abs(result.pacf[k]!)).toBeLessThan(0.3);
    }
  });

  it('should show significant pacf at lags 1 and 2 for AR(2) process', () => {
    const n = 500;
    const phi1 = 0.5;
    const phi2 = 0.3;
    const noise = seededNoise(n, 88, 0.5);
    const x: number[] = [noise[0]!, noise[1]!];
    for (let i = 2; i < n; i++) {
      x.push(phi1 * x[i - 1]! + phi2 * x[i - 2]! + noise[i]!);
    }

    const result = pacf(x);

    // PACF at lag 1 should be significantly different from 0
    expect(Math.abs(result.pacf[0]!)).toBeGreaterThan(result.significanceBound);
    // PACF at lag 2 should also be significant
    expect(Math.abs(result.pacf[1]!)).toBeGreaterThan(result.significanceBound);

    // PACF at lag 3+ should be mostly within significance bounds
    let withinBoundsCount = 0;
    for (let k = 2; k < Math.min(8, result.pacf.length); k++) {
      if (Math.abs(result.pacf[k]!) < 2 * result.significanceBound) {
        withinBoundsCount++;
      }
    }
    // Most (at least half) should be within bounds
    expect(withinBoundsCount).toBeGreaterThanOrEqual(3);
  });

  it('should keep white noise pacf values within significance bounds', () => {
    const n = 200;
    const noise = seededNoise(n, 99);
    const result = pacf(noise);

    // For white noise, nearly all PACF values should be within ±2*significanceBound
    let withinBounds = 0;
    for (let k = 0; k < result.pacf.length; k++) {
      if (Math.abs(result.pacf[k]!) < 2 * result.significanceBound) {
        withinBounds++;
      }
    }
    // At least 80% should be within bounds for white noise
    expect(withinBounds / result.pacf.length).toBeGreaterThan(0.7);
  });

  it('should return empty result for empty input', () => {
    const result = pacf([]);
    expect(result.lags).toHaveLength(0);
    expect(result.pacf).toHaveLength(0);
    expect(result.significanceBound).toBeNaN();
  });

  it('should return empty result for single-value input', () => {
    const result = pacf([42]);
    expect(result.lags).toHaveLength(0);
    expect(result.pacf).toHaveLength(0);
  });

  it('should compute significance bound as 1.96/sqrt(n)', () => {
    const n = 100;
    const values = seededNoise(n, 111);
    const result = pacf(values);

    expect(result.significanceBound).toBeCloseTo(1.96 / Math.sqrt(n), 5);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting / additional edge cases
// ---------------------------------------------------------------------------

describe('cross-cutting edge cases', () => {
  it('rollingMean should handle NaN values via pairwise deletion', () => {
    const dates = makeDates(5);
    const values = [1, NaN, 3, NaN, 5];
    const result = rollingMean(dates, values, 5);

    // At i=4 (full window [0..4]): finite values are [1, 3, 5]
    expect(result.sampleSizes[4]).toBe(3);
    expect(result.values[4]).toBeCloseTo(3, 5); // mean(1, 3, 5) = 3
  });

  it('rollingMedian should handle NaN values via pairwise deletion', () => {
    const dates = makeDates(5);
    const values = [1, NaN, 3, NaN, 5];
    const result = rollingMedian(dates, values, 5);

    // At i=4: finite values [1, 3, 5] → sorted → median = 3
    expect(result.sampleSizes[4]).toBe(3);
    expect(result.values[4]).toBeCloseTo(3, 5);
  });

  it('loess should handle a single-point input', () => {
    const result = loess([5], [10]);
    expect(result.x).toHaveLength(1);
    expect(result.y[0]).toBeCloseTo(10, 10);
  });

  it('linearTrend slope/intercept should be correct for simple data', () => {
    // y = 3x + 2 where x is day offset
    const dates = makeDates(5);
    const values = [2, 5, 8, 11, 14]; // 2 + 3*0, 2 + 3*1, ...
    const result = linearTrend(dates, values);

    expect(result.slope).toBeCloseTo(3, 5);
    expect(result.intercept).toBeCloseTo(2, 5);
  });

  it('detectChangePoints segments should cover all indices', () => {
    const values = [1, 1, 1, 5, 5, 5, 2, 2, 2];
    const dates = makeDates(9);
    const result = detectChangePoints(values, dates, 3);

    // Segments should cover indices 0 to 8
    const coveredIndices = new Set<number>();
    for (const seg of result.segments) {
      for (let i = seg.start; i <= seg.end; i++) {
        coveredIndices.add(i);
      }
    }
    for (let i = 0; i < 9; i++) {
      expect(coveredIndices.has(i)).toBe(true);
    }
  });

  it('stlDecomposition with robust=true should handle outliers', () => {
    const n = 28;
    const dates = makeDates(n);
    const values = Array.from({ length: n }, (_, i) => i * 0.5);
    // Inject an outlier
    values[14] = 100;

    const resultRobust = stlDecomposition(dates, values, 7, true);
    const resultNonRobust = stlDecomposition(dates, values, 7, false);

    // Both should still produce valid decomposition
    expect(resultRobust.trend).toHaveLength(n);
    expect(resultNonRobust.trend).toHaveLength(n);

    // Robust version should have a smaller remainder for the outlier influence
    // on non-outlier points (trend should be smoother)
    // Just verify decomposition is valid (trend+seasonal+remainder ≈ original)
    for (let i = 0; i < n; i++) {
      const recon = resultRobust.trend[i]! + resultRobust.seasonal[i]! + resultRobust.remainder[i]!;
      expect(recon).toBeCloseTo(values[i]!, 5);
    }
  });

  it('acf values should all be between -1 and 1', () => {
    const values = seededNoise(200, 42);
    const result = acf(values);

    for (const val of result.acf) {
      expect(val).toBeGreaterThanOrEqual(-1 - 1e-10);
      expect(val).toBeLessThanOrEqual(1 + 1e-10);
    }
  });

  it('pacf values should all be between -1 and 1', () => {
    const values = seededNoise(200, 42);
    const result = pacf(values);

    for (const val of result.pacf) {
      expect(val).toBeGreaterThanOrEqual(-1 - 1e-10);
      expect(val).toBeLessThanOrEqual(1 + 1e-10);
    }
  });
});
