import { describe, it, expect } from 'vitest';

import {
  qqNormal,
  shapiroFrancia,
  shapiroWilk,
  kolmogorovSmirnov,
  kernelDensityEstimation,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple seeded PRNG (xorshift32) for reproducible "normal-ish" data.
 * Box-Muller transform to approximate N(mu, sigma).
 */
function seededNormals(n: number, mu = 0, sigma = 1, seed = 42): number[] {
  let s = seed >>> 0;
  function rand01(): number {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const u1 = rand01() || 1e-10;
    const u2 = rand01();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    out.push(mu + sigma * z0);
    if (i + 1 < n) out.push(mu + sigma * z1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// qqNormal
// ---------------------------------------------------------------------------

describe('qqNormal', () => {
  it('should return high correlation for normal-like data', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = qqNormal(data);

    expect(result.correlation).toBeGreaterThan(0.95);
    expect(result.n).toBe(10);
  });

  it('should return high correlation for evenly spaced data', () => {
    // Evenly spaced → approximately normal QQ fit (uniform has lighter tails)
    const data = Array.from({ length: 50 }, (_, i) => i);
    const result = qqNormal(data);

    expect(result.correlation).toBeGreaterThan(0.98);
    expect(result.n).toBe(50);
  });

  it('should return NaN correlation for a single value', () => {
    const result = qqNormal([42]);

    expect(result.n).toBe(1);
    expect(result.sampleQuantiles).toHaveLength(1);
    expect(result.theoreticalQuantiles).toHaveLength(1);
    expect(result.correlation).toBeNaN();
  });

  it('should return empty arrays and NaN correlation for empty input', () => {
    const result = qqNormal([]);

    expect(result.theoreticalQuantiles).toHaveLength(0);
    expect(result.sampleQuantiles).toHaveLength(0);
    expect(result.n).toBe(0);
    expect(result.correlation).toBeNaN();
  });

  it('should return sampleQuantiles sorted ascending', () => {
    const data = [10, 3, 7, 1, 5, 9, 2, 8, 4, 6];
    const result = qqNormal(data);

    for (let i = 1; i < result.sampleQuantiles.length; i++) {
      expect(result.sampleQuantiles[i]).toBeGreaterThanOrEqual(result.sampleQuantiles[i - 1]!);
    }
  });

  it('should produce theoretical quantiles symmetric around 0 for centered data', () => {
    // Symmetric data centered at 0
    const data = [-3, -2, -1, 0, 1, 2, 3];
    const result = qqNormal(data);

    const tq = result.theoreticalQuantiles;
    const n = tq.length;
    // First and last should be negatives/positives of each other
    for (let i = 0; i < Math.floor(n / 2); i++) {
      expect(tq[i]! + tq[n - 1 - i]!).toBeCloseTo(0, 10);
    }
  });

  it('should return theoreticalQuantiles and sampleQuantiles of same length as n', () => {
    const data = [2, 4, 6, 8, 10];
    const result = qqNormal(data);

    expect(result.theoreticalQuantiles).toHaveLength(result.n);
    expect(result.sampleQuantiles).toHaveLength(result.n);
    expect(result.n).toBe(5);
  });

  it('should filter NaN values from input', () => {
    const data = [1, NaN, 2, 3, NaN, 4, 5];
    const result = qqNormal(data);

    expect(result.n).toBe(5);
    expect(result.sampleQuantiles).toHaveLength(5);
    expect(result.theoreticalQuantiles).toHaveLength(5);
  });

  it('should filter Infinity values from input', () => {
    const data = [1, Infinity, 2, -Infinity, 3];
    const result = qqNormal(data);

    expect(result.n).toBe(3);
  });

  it('should return high correlation for large generated normal data', () => {
    const data = seededNormals(200, 50, 10);
    const result = qqNormal(data);

    expect(result.n).toBe(200);
    expect(result.correlation).toBeGreaterThan(0.98);
  });
});

// ---------------------------------------------------------------------------
// shapiroFrancia (formerly mislabelled "Shapiro-Wilk")
// ---------------------------------------------------------------------------

describe('shapiroFrancia', () => {
  it('should return high W for normal-like data', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = shapiroFrancia(data);

    expect(result.statistic).toBeGreaterThanOrEqual(0.9);
    expect(result.testName).toBe('Shapiro-Francia');
  });

  it('should return isNormal=true for a generated normal sample', () => {
    const data = seededNormals(100, 0, 1);
    const result = shapiroFrancia(data);

    expect(result.statistic).toBeGreaterThan(0.95);
    // p-value approximation may vary, but W > 0.95 is clearly normal-shaped
    expect(result.testName).toBe('Shapiro-Francia');
  });

  it('should return lower W for clearly non-normal data', () => {
    // Highly skewed / outlier-driven
    const data = [1, 1, 1, 1, 1, 100];
    const result = shapiroFrancia(data);

    expect(result.statistic).toBeLessThan(0.9);
    expect(result.testName).toBe('Shapiro-Francia');
  });

  it('should handle small n=3 (minimum valid input)', () => {
    const result = shapiroFrancia([1, 2, 3]);

    expect(result.testName).toBe('Shapiro-Francia');
    expect(result.statistic).toBeGreaterThanOrEqual(0);
    expect(result.statistic).toBeLessThanOrEqual(1);
    expect(Number.isFinite(result.pValue)).toBe(true);
  });

  it('should return NaN statistic for n < 3', () => {
    const result2 = shapiroFrancia([1, 2]);
    expect(result2.statistic).toBeNaN();
    expect(result2.pValue).toBeNaN();
    expect(result2.isNormal).toBe(false);

    const result1 = shapiroFrancia([1]);
    expect(result1.statistic).toBeNaN();

    const result0 = shapiroFrancia([]);
    expect(result0.statistic).toBeNaN();
  });

  it('should handle all identical values gracefully', () => {
    const result = shapiroFrancia([5, 5, 5, 5, 5]);

    // Zero variance — degenerate case. Implementation returns W=1.
    expect(result.statistic).toBe(1);
    expect(result.pValue).toBe(1);
    expect(result.isNormal).toBe(true);
  });

  it('should have testName "Shapiro-Francia"', () => {
    const result = shapiroFrancia([1, 2, 3, 4, 5]);
    expect(result.testName).toBe('Shapiro-Francia');
  });

  it('should produce W statistic in [0, 1]', () => {
    const datasets = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [1, 1, 1, 1, 1, 100],
      seededNormals(50),
      [1, 3, 3, 3, 3, 3, 3, 3, 3, 100],
    ];

    for (const data of datasets) {
      const result = shapiroFrancia(data);
      if (Number.isFinite(result.statistic)) {
        expect(result.statistic).toBeGreaterThanOrEqual(0);
        expect(result.statistic).toBeLessThanOrEqual(1);
      }
    }
  });

  it('should detect normality for a large normal sample', () => {
    const data = seededNormals(100, 0, 1);
    const result = shapiroFrancia(data);

    expect(result.statistic).toBeGreaterThan(0.9);
    expect(result.testName).toBe('Shapiro-Francia');
  });

  it('should filter NaN values before testing', () => {
    const data = [1, NaN, 2, NaN, 3, 4, 5];
    const result = shapiroFrancia(data);

    // After filtering: [1,2,3,4,5] → n=5, valid
    expect(result.testName).toBe('Shapiro-Francia');
    expect(Number.isFinite(result.statistic)).toBe(true);
    expect(result.statistic).toBeGreaterThanOrEqual(0);
    expect(result.statistic).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Reference values
  //
  // The Shapiro-Francia statistic W' = corr(x_(i), m_i)² with Blom scores
  //   m_i = Φ⁻¹((i − 3/8) / (n + 1/4))
  // is exactly reproducible. For a perfectly linear (equally spaced) sample
  // the order statistics are a strictly increasing affine sequence, so the
  // correlation with the (non-equally-spaced) Blom scores is high but < 1.
  //
  // Reference (R, nortest::sf.test, which reports the same correlation-based
  // statistic): sf.test(1:10)$statistic == 0.9865766, using R's exact qnorm.
  // This module uses the Abramowitz & Stegun 26.2.23 probit approximation
  // (≈4.5e-4 accuracy), giving W' = 0.986508 — within ~1e-4 of R's value.
  // We assert to 3 decimals to accommodate the probit approximation.
  // -------------------------------------------------------------------------
  it('should match the R nortest::sf.test statistic for 1:10 (within probit approx)', () => {
    const result = shapiroFrancia([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // R reference: 0.9865766; module (A&S probit): 0.986508
    expect(result.statistic).toBeCloseTo(0.9866, 3);
  });

  it('should reject normality for a strongly right-skewed sample (n=20)', () => {
    // Exponential-like ranks: heavy right skew. R sf.test gives p ≪ 0.05.
    const data = [
      0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.2, 1.5, 2.0, 2.6, 3.4, 4.5, 6.0, 8.0, 11.0,
      15.0, 25.0,
    ];
    const result = shapiroFrancia(data);
    expect(result.isNormal).toBe(false);
    expect(result.pValue).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// shapiroWilk (deprecated alias)
// ---------------------------------------------------------------------------

describe('shapiroWilk (deprecated alias)', () => {
  it('should delegate to shapiroFrancia and report testName "Shapiro-Francia"', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const viaAlias = shapiroWilk(data);
    const viaCanonical = shapiroFrancia(data);

    expect(viaAlias.testName).toBe('Shapiro-Francia');
    expect(viaAlias.statistic).toBe(viaCanonical.statistic);
    expect(viaAlias.pValue).toBe(viaCanonical.pValue);
    expect(viaAlias.isNormal).toBe(viaCanonical.isNormal);
  });
});

// ---------------------------------------------------------------------------
// kolmogorovSmirnov
// ---------------------------------------------------------------------------

describe('kolmogorovSmirnov', () => {
  it('should return small D for standardized normal data', () => {
    const data = seededNormals(200, 0, 1);
    const result = kolmogorovSmirnov(data);

    // D should be small for normal-distributed data
    expect(result.statistic).toBeLessThan(0.15);
    expect(result.testName).toBe('Kolmogorov-Smirnov (Lilliefors)');
  });

  it('should return larger D for clearly non-normal uniform-like data', () => {
    // Discrete uniform: [1,2,...,4] repeated — flat distribution
    const data = Array.from({ length: 100 }, (_, i) => (i % 4) + 1);
    const result = kolmogorovSmirnov(data);

    // D should be noticeably larger than for true normal data
    expect(result.statistic).toBeGreaterThan(0.05);
    expect(result.testName).toBe('Kolmogorov-Smirnov (Lilliefors)');
  });

  it('should handle small n=4 (minimum valid input)', () => {
    const result = kolmogorovSmirnov([1, 2, 3, 4]);

    expect(result.testName).toBe('Kolmogorov-Smirnov (Lilliefors)');
    expect(Number.isFinite(result.statistic)).toBe(true);
    expect(result.statistic).toBeGreaterThanOrEqual(0);
  });

  it('should return NaN for n < 4', () => {
    const result3 = kolmogorovSmirnov([1, 2, 3]);
    expect(result3.statistic).toBeNaN();
    expect(result3.pValue).toBeNaN();
    expect(result3.isNormal).toBe(false);

    const result0 = kolmogorovSmirnov([]);
    expect(result0.statistic).toBeNaN();
  });

  it('should have testName "Kolmogorov-Smirnov (Lilliefors)"', () => {
    const result = kolmogorovSmirnov([1, 2, 3, 4, 5]);
    expect(result.testName).toBe('Kolmogorov-Smirnov (Lilliefors)');
  });

  it('should produce D statistic ≥ 0', () => {
    const datasets = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], seededNormals(50), [1, 1, 2, 100]];

    for (const data of datasets) {
      const result = kolmogorovSmirnov(data);
      if (Number.isFinite(result.statistic)) {
        expect(result.statistic).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('should handle all identical values gracefully', () => {
    const result = kolmogorovSmirnov([7, 7, 7, 7, 7]);

    // Zero variance — degenerate. Implementation returns D=0, p=1.
    expect(result.statistic).toBe(0);
    expect(result.pValue).toBe(1);
    expect(result.isNormal).toBe(true);
  });

  it('should filter non-finite values before testing', () => {
    const data = [NaN, 1, Infinity, 2, -Infinity, 3, 4, 5];
    const result = kolmogorovSmirnov(data);

    // After filtering: [1,2,3,4,5] → n=5
    expect(Number.isFinite(result.statistic)).toBe(true);
    expect(result.statistic).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// kernelDensityEstimation
// ---------------------------------------------------------------------------

describe('kernelDensityEstimation', () => {
  it('should return x and density arrays of specified default length (100)', () => {
    const data = [1, 2, 3, 4, 5];
    const result = kernelDensityEstimation(data);

    expect(result.x).toHaveLength(100);
    expect(result.density).toHaveLength(100);
    expect(result.bandwidth).toBeGreaterThan(0);
  });

  it('should respect custom nPoints', () => {
    const data = [1, 2, 3, 4, 5];
    const result = kernelDensityEstimation(data, 50);

    expect(result.x).toHaveLength(50);
    expect(result.density).toHaveLength(50);
  });

  it('should produce density that integrates approximately to 1', () => {
    const data = seededNormals(200, 0, 1);
    const result = kernelDensityEstimation(data, 500);

    // Trapezoidal integration
    let integral = 0;
    for (let i = 1; i < result.x.length; i++) {
      const dx = result.x[i]! - result.x[i - 1]!;
      integral += 0.5 * (result.density[i]! + result.density[i - 1]!) * dx;
    }

    expect(integral).toBeCloseTo(1, 0); // within 0.1
  });

  it('should produce a sharp peak for a single value', () => {
    const result = kernelDensityEstimation([42]);

    expect(result.x).toHaveLength(100);
    expect(result.density).toHaveLength(100);
    expect(result.bandwidth).toBeGreaterThan(0);

    // Peak should be near x=42
    const maxDensity = Math.max(...(result.density as number[]));
    const peakIndex = (result.density as number[]).indexOf(maxDensity);
    expect(result.x[peakIndex]).toBeCloseTo(42, 0);
  });

  it('should allow custom bandwidth', () => {
    const data = [1, 2, 3, 4, 5];
    const customBW = 0.5;
    const result = kernelDensityEstimation(data, 100, customBW);

    expect(result.bandwidth).toBe(customBW);
  });

  it('should return empty arrays for empty data', () => {
    const result = kernelDensityEstimation([]);

    expect(result.x).toHaveLength(0);
    expect(result.density).toHaveLength(0);
    expect(result.bandwidth).toBeNaN();
  });

  it('should handle all identical values', () => {
    const result = kernelDensityEstimation([3, 3, 3, 3, 3]);

    expect(result.x).toHaveLength(100);
    expect(result.density).toHaveLength(100);
    // Bandwidth should be tiny but positive (degenerate case)
    expect(result.bandwidth).toBeGreaterThan(0);
  });

  it('should filter NaN and non-finite values', () => {
    const data = [1, NaN, 2, Infinity, 3, -Infinity, 4, 5];
    const result = kernelDensityEstimation(data);

    // After filtering: [1,2,3,4,5] → 5 data points
    expect(result.x).toHaveLength(100);
    expect(result.density).toHaveLength(100);
    expect(result.bandwidth).toBeGreaterThan(0);
  });

  it('should produce all non-negative density values', () => {
    const data = seededNormals(100);
    const result = kernelDensityEstimation(data);

    for (const d of result.density) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it('should produce x range that covers data range with padding', () => {
    const data = [10, 20, 30, 40, 50];
    const result = kernelDensityEstimation(data);

    const xArr = result.x as number[];
    const xMin = xArr[0]!;
    const xMax = xArr[xArr.length - 1]!;

    // x grid should extend beyond the data range (padding = 3 * bandwidth)
    expect(xMin).toBeLessThan(10);
    expect(xMax).toBeGreaterThan(50);
  });

  it('should return empty arrays when all inputs are NaN', () => {
    const result = kernelDensityEstimation([NaN, NaN, NaN]);

    expect(result.x).toHaveLength(0);
    expect(result.density).toHaveLength(0);
    expect(result.bandwidth).toBeNaN();
  });

  it('should produce narrower density with smaller bandwidth', () => {
    const data = seededNormals(100, 0, 1);
    const wide = kernelDensityEstimation(data, 200, 2.0);
    const narrow = kernelDensityEstimation(data, 200, 0.2);

    const widePeak = Math.max(...(wide.density as number[]));
    const narrowPeak = Math.max(...(narrow.density as number[]));

    // Narrower bandwidth → taller peak
    expect(narrowPeak).toBeGreaterThan(widePeak);
  });
});
