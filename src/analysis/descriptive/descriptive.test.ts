import { describe, it, expect } from 'vitest';
import {
  filterFinite,
  computeDescriptiveStats,
  percentile,
  computePercentiles,
  detectOutliers,
  computeHistogram,
} from './index';

// ---------------------------------------------------------------------------
// filterFinite
// ---------------------------------------------------------------------------

describe('filterFinite', () => {
  it('should remove NaN values', () => {
    expect(filterFinite([1, NaN, 3])).toEqual([1, 3]);
  });

  it('should remove Infinity and -Infinity', () => {
    expect(filterFinite([1, Infinity, 3, -Infinity, 5])).toEqual([1, 3, 5]);
  });

  it('should pass through an array of all finite numbers unchanged', () => {
    expect(filterFinite([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
  });

  it('should return an empty array for empty input', () => {
    expect(filterFinite([])).toEqual([]);
  });

  it('should return an empty array when all values are non-finite', () => {
    expect(filterFinite([NaN, Infinity, -Infinity, NaN])).toEqual([]);
  });

  it('should handle negative and zero values correctly', () => {
    expect(filterFinite([-3, 0, 5])).toEqual([-3, 0, 5]);
  });
});

// ---------------------------------------------------------------------------
// computeDescriptiveStats
// ---------------------------------------------------------------------------

describe('computeDescriptiveStats', () => {
  it('should compute correct stats for textbook dataset [2,4,4,4,5,5,7,9]', () => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9];
    const stats = computeDescriptiveStats(data);

    expect(stats.count).toBe(8);
    expect(stats.mean).toBeCloseTo(5, 10);
    expect(stats.median).toBeCloseTo(4.5, 10);
    // m2 = 32, sample variance = 32/7
    expect(stats.variance).toBeCloseTo(32 / 7, 10);
    expect(stats.stdDev).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(stats.min).toBe(2);
    expect(stats.max).toBe(9);
    expect(stats.range).toBe(7);
  });

  it('should produce numerically stable results with Welford algorithm (large offset)', () => {
    const data = [1e8 + 1, 1e8 + 2, 1e8 + 3];
    const stats = computeDescriptiveStats(data);

    expect(stats.mean).toBeCloseTo(1e8 + 2, 5);
    // deviations: -1, 0, 1 → sum of sq = 2, sample variance = 2/2 = 1
    expect(stats.variance).toBeCloseTo(1, 10);
    expect(stats.stdDev).toBeCloseTo(1, 10);
  });

  it('should handle a single element', () => {
    const stats = computeDescriptiveStats([42]);

    expect(stats.count).toBe(1);
    expect(stats.mean).toBe(42);
    expect(stats.median).toBe(42);
    expect(stats.variance).toBe(0);
    expect(stats.stdDev).toBe(0);
    expect(stats.min).toBe(42);
    expect(stats.max).toBe(42);
    expect(stats.range).toBe(0);
  });

  it('should return all NaN for empty array', () => {
    const stats = computeDescriptiveStats([]);

    expect(stats.count).toBe(0);
    expect(stats.mean).toBeNaN();
    expect(stats.median).toBeNaN();
    expect(stats.variance).toBeNaN();
    expect(stats.stdDev).toBeNaN();
    expect(stats.min).toBeNaN();
    expect(stats.max).toBeNaN();
    expect(stats.range).toBeNaN();
    expect(stats.skewness).toBeNaN();
    expect(stats.kurtosis).toBeNaN();
  });

  it('should handle all identical values: variance=0, skewness=0, kurtosis=NaN', () => {
    const stats = computeDescriptiveStats([5, 5, 5, 5]);

    expect(stats.count).toBe(4);
    expect(stats.mean).toBe(5);
    expect(stats.variance).toBe(0);
    expect(stats.stdDev).toBe(0);
    expect(stats.skewness).toBe(0);
    expect(stats.kurtosis).toBeNaN();
  });

  it('should filter NaN and Infinity before computing stats', () => {
    // [1, NaN, 3, Infinity, 5] → filters to [1, 3, 5]
    const stats = computeDescriptiveStats([1, NaN, 3, Infinity, 5]);

    expect(stats.count).toBe(3);
    expect(stats.mean).toBeCloseTo(3, 10);
    expect(stats.median).toBe(3);
    // deviations: -2, 0, 2 → sum of sq = 8, sample var = 8/2 = 4
    expect(stats.variance).toBeCloseTo(4, 10);
    expect(stats.stdDev).toBeCloseTo(2, 10);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
  });

  it('should produce positive skewness for right-skewed data', () => {
    const data = [1, 2, 2, 3, 3, 3, 4, 4, 5, 10];
    const stats = computeDescriptiveStats(data);

    expect(stats.skewness).toBeGreaterThan(0);
  });

  it('should produce approximately zero skewness for symmetric data', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const stats = computeDescriptiveStats(data);

    expect(stats.skewness).toBeCloseTo(0, 5);
  });

  it('should compute correct IQR using Type 7 percentiles', () => {
    // [1, 2, 3, 4, 5, 6, 7] sorted, n=7
    // Q1 (p=25): h = 6*0.25 = 1.5 → 2 + 0.5*(3-2) = 2.5
    // Q3 (p=75): h = 6*0.75 = 4.5 → 5 + 0.5*(6-5) = 5.5
    // IQR = 3.0
    const stats = computeDescriptiveStats([1, 2, 3, 4, 5, 6, 7]);

    expect(stats.iqr).toBeCloseTo(3.0, 10);
  });

  it('should compute coefficient of variation (CV) correctly', () => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9];
    const stats = computeDescriptiveStats(data);

    // CV = stdDev / |mean| = sqrt(32/7) / 5
    const expectedCV = Math.sqrt(32 / 7) / 5;
    expect(stats.cv).toBeCloseTo(expectedCV, 10);
  });

  it('should return NaN for CV when mean is zero', () => {
    // [-1, 1] → mean = 0
    const stats = computeDescriptiveStats([-1, 1]);

    expect(stats.cv).toBeNaN();
  });

  it('should compute standard error correctly', () => {
    const data = [2, 4, 4, 4, 5, 5, 7, 9];
    const stats = computeDescriptiveStats(data);

    // stdErr = stdDev / sqrt(n) = sqrt(32/7) / sqrt(8)
    const expectedStdErr = Math.sqrt(32 / 7) / Math.sqrt(8);
    expect(stats.stdErr).toBeCloseTo(expectedStdErr, 10);
  });

  it('should handle all NaN input same as empty array', () => {
    const stats = computeDescriptiveStats([NaN, NaN, NaN]);

    expect(stats.count).toBe(0);
    expect(stats.mean).toBeNaN();
    expect(stats.median).toBeNaN();
  });

  it('should handle two elements correctly', () => {
    const stats = computeDescriptiveStats([10, 20]);

    expect(stats.count).toBe(2);
    expect(stats.mean).toBeCloseTo(15, 10);
    expect(stats.median).toBeCloseTo(15, 10);
    // sample variance: ((10-15)² + (20-15)²) / 1 = 50
    expect(stats.variance).toBeCloseTo(50, 10);
  });

  it('should produce negative skewness for left-skewed data', () => {
    // Mirror of right-skewed: heavy tail on left
    const data = [1, 6, 7, 7, 8, 8, 8, 9, 9, 10];
    const stats = computeDescriptiveStats(data);

    expect(stats.skewness).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// percentile
// ---------------------------------------------------------------------------

describe('percentile', () => {
  it('should compute p=50 (median) with Type 7 interpolation for odd-length array', () => {
    // [1,2,3,4,5]: h = 4*0.5 = 2.0, sorted[2] = 3
    expect(percentile([1, 2, 3, 4, 5], 50)).toBeCloseTo(3, 10);
  });

  it('should compute p=25 and p=75 for [1,2,3,4,5]', () => {
    // p=25: h = 4*0.25 = 1.0, sorted[1] = 2
    expect(percentile([1, 2, 3, 4, 5], 25)).toBeCloseTo(2, 10);
    // p=75: h = 4*0.75 = 3.0, sorted[3] = 4
    expect(percentile([1, 2, 3, 4, 5], 75)).toBeCloseTo(4, 10);
  });

  it('should return min for p=0', () => {
    expect(percentile([3, 1, 4, 1, 5], 0)).toBe(1);
  });

  it('should return max for p=100', () => {
    expect(percentile([3, 1, 4, 1, 5], 100)).toBe(5);
  });

  it('should return the element itself for single-element array', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it('should return NaN for empty array', () => {
    expect(percentile([], 50)).toBeNaN();
  });

  it('should return NaN for out-of-range percentile values', () => {
    expect(percentile([1, 2, 3], -1)).toBeNaN();
    expect(percentile([1, 2, 3], 101)).toBeNaN();
  });

  it('should interpolate for two-element array at p=50', () => {
    // [10, 20]: h = 1*0.5 = 0.5, lo=0, hi=1, frac=0.5 → 10 + 0.5*10 = 15
    expect(percentile([10, 20], 50)).toBeCloseTo(15, 10);
  });

  it('should interpolate for even-length array at p=50', () => {
    // [1,2,3,4]: h = 3*0.5 = 1.5, lo=1, hi=2, frac=0.5 → 2 + 0.5*1 = 2.5
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 10);
  });

  it('should handle unsorted input correctly', () => {
    // percentile sorts internally
    expect(percentile([5, 3, 1, 4, 2], 50)).toBeCloseTo(3, 10);
  });

  it('should filter non-finite values before computing', () => {
    expect(percentile([1, NaN, 3, Infinity, 5], 50)).toBeCloseTo(3, 10);
  });

  it('should handle duplicate values correctly', () => {
    // [3,3,3,3,3]: all same → any percentile = 3
    expect(percentile([3, 3, 3, 3, 3], 25)).toBe(3);
    expect(percentile([3, 3, 3, 3, 3], 75)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computePercentiles
// ---------------------------------------------------------------------------

describe('computePercentiles', () => {
  it('should compute correct percentile set for [1..10]', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p = computePercentiles(data);

    // n=10, h = 9 * pct/100
    // p5:  h=0.45 → 1 + 0.45*(2-1) = 1.45
    // p10: h=0.9  → 1 + 0.9*(2-1) = 1.9
    // p25: h=2.25 → 3 + 0.25*(4-3) = 3.25
    // p50: h=4.5  → 5 + 0.5*(6-5) = 5.5
    // p75: h=6.75 → 7 + 0.75*(8-7) = 7.75
    // p90: h=8.1  → 9 + 0.1*(10-9) = 9.1
    // p95: h=8.55 → 9 + 0.55*(10-9) = 9.55
    expect(p.p5).toBeCloseTo(1.45, 10);
    expect(p.p10).toBeCloseTo(1.9, 10);
    expect(p.p25).toBeCloseTo(3.25, 10);
    expect(p.p50).toBeCloseTo(5.5, 10);
    expect(p.p75).toBeCloseTo(7.75, 10);
    expect(p.p90).toBeCloseTo(9.1, 10);
    expect(p.p95).toBeCloseTo(9.55, 10);
  });

  it('should return the element for all percentiles given single-element array', () => {
    const p = computePercentiles([42]);

    expect(p.p5).toBe(42);
    expect(p.p10).toBe(42);
    expect(p.p25).toBe(42);
    expect(p.p50).toBe(42);
    expect(p.p75).toBe(42);
    expect(p.p90).toBe(42);
    expect(p.p95).toBe(42);
  });

  it('should return all NaN for empty array', () => {
    const p = computePercentiles([]);

    expect(p.p5).toBeNaN();
    expect(p.p10).toBeNaN();
    expect(p.p25).toBeNaN();
    expect(p.p50).toBeNaN();
    expect(p.p75).toBeNaN();
    expect(p.p90).toBeNaN();
    expect(p.p95).toBeNaN();
  });

  it('should filter non-finite values before computing', () => {
    const p = computePercentiles([NaN, 1, Infinity, 2, -Infinity, 3]);

    // effective data [1, 2, 3], n=3
    // h = 2 * pct/100
    // p50: h=1.0, sorted[1]=2
    expect(p.p50).toBeCloseTo(2, 10);
  });

  it('should satisfy ordering: p5 ≤ p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 ≤ p95', () => {
    const data = [7, 3, 9, 1, 5, 2, 8, 6, 4, 10];
    const p = computePercentiles(data);

    expect(p.p5).toBeLessThanOrEqual(p.p10);
    expect(p.p10).toBeLessThanOrEqual(p.p25);
    expect(p.p25).toBeLessThanOrEqual(p.p50);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.p75).toBeLessThanOrEqual(p.p90);
    expect(p.p90).toBeLessThanOrEqual(p.p95);
  });
});

// ---------------------------------------------------------------------------
// detectOutliers
// ---------------------------------------------------------------------------

describe('detectOutliers', () => {
  it('should detect 100 as an outlier in [1,2,3,4,5,100]', () => {
    const result = detectOutliers([1, 2, 3, 4, 5, 100]);

    expect(result.outlierCount).toBe(1);
    expect(result.outliers).toEqual([100]);
    expect(result.outlierIndices).toEqual([5]);
  });

  it('should detect no outliers in [1,2,3,4,5]', () => {
    const result = detectOutliers([1, 2, 3, 4, 5]);

    expect(result.outlierCount).toBe(0);
    expect(result.outliers).toEqual([]);
    expect(result.outlierIndices).toEqual([]);
  });

  it('should compute correct Tukey fences for [1,2,3,4,5,100]', () => {
    // sorted [1,2,3,4,5,100], n=6
    // Q1: h=5*0.25=1.25 → 2+0.25*(3-2)=2.25
    // Q3: h=5*0.75=3.75 → 4+0.75*(5-4)=4.75
    // IQR=2.5
    // lower = 2.25 - 3.75 = -1.5
    // upper = 4.75 + 3.75 = 8.5
    const result = detectOutliers([1, 2, 3, 4, 5, 100]);

    expect(result.lowerFence).toBeCloseTo(-1.5, 10);
    expect(result.upperFence).toBeCloseTo(8.5, 10);
  });

  it('should report outlier indices matching original array positions', () => {
    // Place outlier at index 2 in original array
    const data = [3, 4, 200, 5, 6];
    const result = detectOutliers(data);

    expect(result.outlierIndices).toContain(2);
    expect(result.outliers).toContain(200);
  });

  it('should detect negative outlier', () => {
    // [-100, 1, 2, 3, 4, 5]
    // sorted [-100,1,2,3,4,5], n=6
    // Q1: h=5*0.25=1.25 → 1+0.25*(2-1)=1.25
    // Q3: h=5*0.75=3.75 → 3+0.75*(4-3)=3.75
    // IQR=2.5, lower=1.25-3.75=-2.5, upper=3.75+3.75=7.5
    // -100 < -2.5 → outlier
    const result = detectOutliers([-100, 1, 2, 3, 4, 5]);

    expect(result.outlierCount).toBe(1);
    expect(result.outliers).toEqual([-100]);
    expect(result.outlierIndices).toEqual([0]);
    expect(result.lowerFence).toBeCloseTo(-2.5, 10);
    expect(result.upperFence).toBeCloseTo(7.5, 10);
  });

  it('should return no outliers and NaN fences for empty array', () => {
    const result = detectOutliers([]);

    expect(result.outlierCount).toBe(0);
    expect(result.outliers).toEqual([]);
    expect(result.outlierIndices).toEqual([]);
    expect(result.lowerFence).toBeNaN();
    expect(result.upperFence).toBeNaN();
  });

  it('should skip non-finite values and detect outliers in remaining data', () => {
    const result = detectOutliers([NaN, 1, 2, 3, 4, 5, Infinity, 100]);
    // Finite values: [1,2,3,4,5,100] at original indices [1,2,3,4,5,7]
    expect(result.outlierCount).toBe(1);
    expect(result.outliers).toEqual([100]);
    expect(result.outlierIndices).toEqual([7]); // original index of 100
  });

  it('should handle single element with no outliers', () => {
    const result = detectOutliers([42]);

    expect(result.outlierCount).toBe(0);
    expect(result.outliers).toEqual([]);
  });

  it('should handle all identical values with no outliers', () => {
    const result = detectOutliers([5, 5, 5, 5, 5]);

    expect(result.outlierCount).toBe(0);
    expect(result.outliers).toEqual([]);
  });

  it('should detect both upper and lower outliers simultaneously', () => {
    const data = [-100, 2, 3, 4, 5, 6, 200];
    const result = detectOutliers(data);

    expect(result.outlierCount).toBe(2);
    expect(result.outliers).toContain(-100);
    expect(result.outliers).toContain(200);
    expect(result.outlierIndices).toContain(0);
    expect(result.outlierIndices).toContain(6);
  });
});

// ---------------------------------------------------------------------------
// computeHistogram
// ---------------------------------------------------------------------------

describe('computeHistogram', () => {
  it('should produce bins that cover the full data range for uniform data', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hist = computeHistogram(data);

    expect(hist.bins.length).toBeGreaterThan(0);
    expect(hist.bins[0]!.binStart).toBeLessThanOrEqual(1);
    expect(hist.bins[hist.bins.length - 1]!.binEnd).toBeGreaterThanOrEqual(10);
  });

  it('should have bin counts that sum to total count', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hist = computeHistogram(data);

    const totalBinCount = hist.bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalBinCount).toBe(hist.totalCount);
    expect(hist.totalCount).toBe(10);
  });

  it('should have frequencies that sum to approximately 1.0', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hist = computeHistogram(data);

    const totalFrequency = hist.bins.reduce((sum, b) => sum + b.frequency, 0);
    expect(totalFrequency).toBeCloseTo(1.0, 10);
  });

  it('should respect custom bin count (clamped to [5, 50])', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const hist10 = computeHistogram(data, 10);
    expect(hist10.bins.length).toBe(10);

    // Below minimum: should be clamped to 5
    const histLow = computeHistogram(data, 2);
    expect(histLow.bins.length).toBe(5);

    // Above maximum: should be clamped to 50
    const histHigh = computeHistogram(data, 100);
    expect(histHigh.bins.length).toBe(50);
  });

  it('should handle all identical values with single meaningful bin', () => {
    const data = [5, 5, 5, 5, 5];
    const hist = computeHistogram(data);

    // range=0 → single bin
    expect(hist.bins.length).toBe(1);
    expect(hist.bins[0]!.count).toBe(5);
    expect(hist.totalCount).toBe(5);
    expect(hist.binWidth).toBe(1); // fallback width for zero range
  });

  it('should return empty bins for empty array', () => {
    const hist = computeHistogram([]);

    expect(hist.bins).toEqual([]);
    expect(hist.totalCount).toBe(0);
    expect(hist.binWidth).toBe(0);
  });

  it('should ensure no value falls outside bin boundaries', () => {
    const data = [1, 1.5, 2, 3.7, 5, 8, 9.9, 10];
    const hist = computeHistogram(data);

    const globalMin = hist.bins[0]!.binStart;
    const globalMax = hist.bins[hist.bins.length - 1]!.binEnd;

    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(globalMin);
      expect(v).toBeLessThanOrEqual(globalMax);
    }
  });

  it('should have contiguous non-overlapping bins', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hist = computeHistogram(data, 5);

    for (let i = 1; i < hist.bins.length; i++) {
      expect(hist.bins[i]!.binStart).toBeCloseTo(hist.bins[i - 1]!.binEnd, 10);
    }
  });

  it('should filter non-finite values before binning', () => {
    const data = [1, NaN, 3, Infinity, 5];
    const hist = computeHistogram(data);

    expect(hist.totalCount).toBe(3);
    const totalBinCount = hist.bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalBinCount).toBe(3);
  });

  it('should handle two-element array', () => {
    const hist = computeHistogram([10, 20], 5);

    expect(hist.totalCount).toBe(2);
    expect(hist.bins.length).toBe(5);
    const totalBinCount = hist.bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalBinCount).toBe(2);
  });

  it('should set correct binWidth for known range and bin count', () => {
    // range = 10 - 1 = 9, 10 bins → binWidth = 0.9
    const hist = computeHistogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);

    expect(hist.binWidth).toBeCloseTo(9 / 10, 10);
  });

  it('should produce correct frequency for each bin', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hist = computeHistogram(data);

    for (const bin of hist.bins) {
      expect(bin.frequency).toBeCloseTo(bin.count / hist.totalCount, 10);
    }
  });
});
