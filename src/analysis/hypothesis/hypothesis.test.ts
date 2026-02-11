/**
 * Unit tests for the hypothesis testing module.
 *
 * Reference values computed via scipy.stats and manual calculation where noted.
 *
 * @module analysis/hypothesis/hypothesis.test
 */

import { describe, it, expect } from 'vitest';
import { mannWhitneyU, wilcoxonSignedRank, cohensD, pairedComparison } from './index';

// ---------------------------------------------------------------------------
// mannWhitneyU
// ---------------------------------------------------------------------------

describe('mannWhitneyU', () => {
  describe('known reference values', () => {
    // scipy.stats.mannwhitneyu([3,4,2,6,2,5], [9,7,5,10,6,8], alternative='two-sided')
    // Expected: group1 has lower values → small U, significant p-value
    it('should compute correct U, p-value, and effect size for clearly separated groups', () => {
      const result = mannWhitneyU([3, 4, 2, 6, 2, 5], [9, 7, 5, 10, 6, 8]);

      expect(result.n1).toBe(6);
      expect(result.n2).toBe(6);
      // U = min(U1, U2); U1 = R1 - n1(n1+1)/2 = 23 - 21 = 2
      expect(result.u).toBe(2);
      // Two-tailed exact p-value: 2 * P(U ≤ 2) = 2 * 4/924 ≈ 0.00866
      expect(result.pValue).toBeCloseTo(8 / 924, 4);
      expect(result.pValue).toBeLessThan(0.05);
      // Rank-biserial: 1 - 2*2/(6*6) = 1 - 4/36 ≈ 0.8889
      expect(result.effectSize).toBeCloseTo(0.8889, 3);
      expect(result.effectSizeInterpretation).toBe('large');
      // Hodges-Lehmann: median of pairwise diffs (g1 - g2) = -4
      expect(result.medianDifference).toBe(-4);
    });
  });

  describe('tied values', () => {
    it('should handle ties correctly for [1,1,1] vs [2,2,2]', () => {
      const result = mannWhitneyU([1, 1, 1], [2, 2, 2]);

      expect(result.n1).toBe(3);
      expect(result.n2).toBe(3);
      // All g1 < g2 → U = 0
      expect(result.u).toBe(0);
      // Effect size = 1 - 0/(3*3) = 1
      expect(result.effectSize).toBeCloseTo(1, 5);
      expect(result.effectSizeInterpretation).toBe('large');
      // All pairwise diffs = -1
      expect(result.medianDifference).toBe(-1);
      // Exact two-tailed: 2 * (1/C(6,3)) = 2/20 = 0.1
      expect(result.pValue).toBeCloseTo(0.1, 4);
    });
  });

  describe('identical groups', () => {
    it('should return p ≈ 1 and effect size ≈ 0 for identical groups', () => {
      const result = mannWhitneyU([5, 5, 5], [5, 5, 5]);

      expect(result.n1).toBe(3);
      expect(result.n2).toBe(3);
      expect(result.pValue).toBeCloseTo(1, 4);
      expect(result.effectSize).toBeCloseTo(0, 5);
      expect(result.effectSizeInterpretation).toBe('negligible');
      expect(result.medianDifference).toBe(0);
    });
  });

  describe('empty group', () => {
    it('should return NaN values when first group is empty', () => {
      const result = mannWhitneyU([], [1, 2, 3]);

      expect(result.n1).toBe(0);
      expect(result.n2).toBe(3);
      expect(result.u).toBeNaN();
      expect(result.pValue).toBeNaN();
      expect(result.effectSize).toBeNaN();
      expect(result.medianDifference).toBeNaN();
    });

    it('should return NaN values when second group is empty', () => {
      const result = mannWhitneyU([1, 2, 3], []);

      expect(result.n1).toBe(3);
      expect(result.n2).toBe(0);
      expect(result.u).toBeNaN();
      expect(result.pValue).toBeNaN();
      expect(result.effectSize).toBeNaN();
      expect(result.medianDifference).toBeNaN();
    });

    it('should return NaN values when both groups are empty', () => {
      const result = mannWhitneyU([], []);

      expect(result.u).toBeNaN();
      expect(result.pValue).toBeNaN();
    });
  });

  describe('single elements', () => {
    it('should work with single-element groups using exact test', () => {
      const result = mannWhitneyU([3], [7]);

      expect(result.n1).toBe(1);
      expect(result.n2).toBe(1);
      expect(result.u).toBe(0);
      // Rank-biserial: 1 - 0/(1*1) = 1
      expect(result.effectSize).toBeCloseTo(1, 5);
      // Hodges-Lehmann: 3-7 = -4
      expect(result.medianDifference).toBe(-4);
      // With n=1 per group, exact two-tailed p = 1.0
      expect(result.pValue).toBeCloseTo(1, 4);
    });
  });

  describe('large groups — normal approximation path', () => {
    it('should use normal approximation for groups larger than 28', () => {
      // Completely non-overlapping groups to guarantee a clear result
      const group1 = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
      const group2 = Array.from({ length: 30 }, (_, i) => i + 31); // 31..60

      const result = mannWhitneyU(group1, group2);

      expect(result.n1).toBe(30);
      expect(result.n2).toBe(30);
      // All of group1 < group2 → U = 0
      expect(result.u).toBe(0);
      expect(result.pValue).toBeLessThan(0.001);
      expect(result.effectSize).toBeCloseTo(1, 5);
      expect(result.effectSizeInterpretation).toBe('large');
    });

    it('should handle overlapping large groups', () => {
      // Groups drawn from similar ranges — expect non-significant result
      const group1 = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
      const group2 = Array.from({ length: 30 }, (_, i) => i + 2); // 2..31

      const result = mannWhitneyU(group1, group2);

      expect(result.n1).toBe(30);
      expect(result.n2).toBe(30);
      // Nearly identical distributions → p should be large
      expect(result.pValue).toBeGreaterThan(0.05);
      // Small effect size for nearly identical distributions
      expect(Math.abs(result.effectSize)).toBeLessThan(0.3);
    });
  });

  describe('effect size interpretation thresholds', () => {
    it('should return "negligible" when effect size < 0.1', () => {
      // Nearly identical groups produce negligible effect
      const result = mannWhitneyU([5, 5, 5], [5, 5, 5]);
      expect(result.effectSizeInterpretation).toBe('negligible');
    });

    it('should return "large" for completely separated groups', () => {
      const result = mannWhitneyU([1, 2, 3], [10, 11, 12]);
      expect(result.effectSizeInterpretation).toBe('large');
    });
  });

  describe('Hodges-Lehmann estimator', () => {
    it('should return median of all pairwise differences', () => {
      // [1,2] vs [4,6]: diffs = [1-4, 1-6, 2-4, 2-6] = [-3, -5, -2, -4]
      // Sorted: [-5, -4, -3, -2], median = (-4 + -3)/2 = -3.5
      const result = mannWhitneyU([1, 2], [4, 6]);
      expect(result.medianDifference).toBeCloseTo(-3.5, 5);
    });

    it('should return 0 for identical groups', () => {
      const result = mannWhitneyU([5, 5, 5], [5, 5, 5]);
      expect(result.medianDifference).toBe(0);
    });
  });

  describe('NaN and Infinity filtering', () => {
    it('should filter NaN values from input', () => {
      const result = mannWhitneyU([1, NaN, 3], [7, NaN, 9]);
      expect(result.n1).toBe(2);
      expect(result.n2).toBe(2);
      expect(result.pValue).not.toBeNaN();
    });

    it('should filter Infinity values from input', () => {
      const result = mannWhitneyU([1, Infinity, 3], [7, -Infinity, 9]);
      expect(result.n1).toBe(2);
      expect(result.n2).toBe(2);
      expect(result.pValue).not.toBeNaN();
    });

    it('should return NaN when all values are non-finite', () => {
      const result = mannWhitneyU([NaN, Infinity], [NaN, -Infinity]);
      expect(result.n1).toBe(0);
      expect(result.n2).toBe(0);
      expect(result.u).toBeNaN();
    });
  });
});

// ---------------------------------------------------------------------------
// wilcoxonSignedRank
// ---------------------------------------------------------------------------

describe('wilcoxonSignedRank', () => {
  describe('known reference values', () => {
    it('should compute correct W, p-value, and effect size for textbook example', () => {
      const before = [125, 115, 130, 140, 140, 115, 140, 125, 140, 135];
      const after = [110, 122, 125, 120, 140, 124, 123, 137, 135, 145];

      const result = wilcoxonSignedRank(before, after);

      // One pair has diff=0 (140→140), removed → n = 9
      expect(result.n).toBe(9);
      // W = min(W+, W−) = min(18, 27) = 18
      expect(result.w).toBe(18);
      // Not significant at 0.05 (z ≈ −0.53)
      expect(result.pValue).toBeGreaterThan(0.05);
      // Effect size r = z/sqrt(n) ≈ −0.178
      expect(result.effectSize).toBeCloseTo(-0.1777, 2);
      expect(result.effectSizeInterpretation).toBe('small');
    });
  });

  describe('all improvements', () => {
    it('should detect significant change when all differences go the same direction', () => {
      const before = [10, 20, 30];
      const after = [5, 10, 15];

      const result = wilcoxonSignedRank(before, after);

      expect(result.n).toBe(3);
      // All negative diffs → W+ = 0, W− = 6, W = 0
      expect(result.w).toBe(0);
      // Exact: 2 * P(W+ ≤ 0) = 2 * 1/8 = 0.25
      expect(result.pValue).toBeCloseTo(0.25, 4);
      // r should have large magnitude given z = (0 - 3)/sqrt(3.5)
      expect(Math.abs(result.effectSize)).toBeGreaterThan(0.5);
      expect(result.effectSizeInterpretation).toBe('large');
    });
  });

  describe('no change', () => {
    it('should handle all-zero differences gracefully', () => {
      const result = wilcoxonSignedRank([5, 5, 5], [5, 5, 5]);

      expect(result.w).toBe(0);
      expect(result.n).toBe(0);
      expect(result.pValue).toBe(1);
      expect(result.effectSize).toBe(0);
      expect(result.effectSizeInterpretation).toBe('negligible');
    });
  });

  describe('single pair', () => {
    it('should handle a single pair after removing zeros', () => {
      const result = wilcoxonSignedRank([10], [5]);

      // diff = 5-10 = -5, n = 1
      expect(result.n).toBe(1);
      // Only one rank (1), W+ = 0, W− = 1, W = 0
      expect(result.w).toBe(0);
      // Exact: 2 * P(W+ ≤ 0) = 2 * 1/2 = 1
      expect(result.pValue).toBeCloseTo(1, 4);
    });
  });

  describe('empty arrays', () => {
    it('should return NaN values for empty before array', () => {
      const result = wilcoxonSignedRank([], [1, 2, 3]);

      expect(result.n).toBe(0);
      expect(result.w).toBeNaN();
      expect(result.pValue).toBeNaN();
      expect(result.effectSize).toBeNaN();
    });

    it('should return NaN values for empty after array', () => {
      const result = wilcoxonSignedRank([1, 2, 3], []);

      expect(result.n).toBe(0);
      expect(result.w).toBeNaN();
      expect(result.pValue).toBeNaN();
    });

    it('should return NaN values when both arrays are empty', () => {
      const result = wilcoxonSignedRank([], []);

      expect(result.w).toBeNaN();
      expect(result.pValue).toBeNaN();
    });
  });

  describe('NaN and Infinity filtering', () => {
    it('should filter NaN values from paired inputs', () => {
      // With NaN removed from before, shorter effective pair length
      const result = wilcoxonSignedRank([10, NaN, 30], [5, 15, 15]);
      // filterFinite on before → [10, 30], after → [5, 15, 15]
      // pairedN = min(2, 3) = 2
      expect(result.n).toBeLessThanOrEqual(2);
    });

    it('should filter Infinity values from paired inputs', () => {
      const result = wilcoxonSignedRank([10, Infinity, 30], [5, 15, 15]);
      expect(result.n).toBeLessThanOrEqual(2);
    });
  });

  describe('larger sample reaching exact boundary', () => {
    it('should use exact distribution for n ≤ 25', () => {
      // 20 pairs with a clear signal
      const before = Array.from({ length: 20 }, (_, i) => 10 + i);
      const after = Array.from({ length: 20 }, (_, i) => 5 + i);

      const result = wilcoxonSignedRank(before, after);

      expect(result.n).toBe(20);
      // All diffs are −5 → W+ = 0, p very small
      expect(result.w).toBe(0);
      expect(result.pValue).toBeLessThan(0.001);
    });
  });
});

// ---------------------------------------------------------------------------
// cohensD
// ---------------------------------------------------------------------------

describe('cohensD', () => {
  describe('known values', () => {
    it('should compute correct d, g, CI, and interpretation for distinct groups', () => {
      const group1 = [2, 4, 6, 8, 10];
      const group2 = [8, 10, 12, 14, 16];

      const result = cohensD(group1, group2);

      // mean1 = 6, mean2 = 12, pooledSD = sqrt(10) ≈ 3.1623
      expect(result.pooledStdDev).toBeCloseTo(Math.sqrt(10), 4);
      // d = (6 - 12) / sqrt(10) = -6 / 3.1623 ≈ -1.8974
      expect(result.d).toBeCloseTo(-6 / Math.sqrt(10), 4);
      expect(result.interpretation).toBe('large');

      // Hedges' g correction: df=8, factor = 1 - 3/(4*8-1) = 28/31
      const expectedG = result.d * (28 / 31);
      expect(result.g).toBeCloseTo(expectedG, 4);

      // CI should contain d
      expect(result.ci95Lower).toBeLessThan(result.d);
      expect(result.ci95Upper).toBeGreaterThan(result.d);
    });
  });

  describe('identical groups', () => {
    it('should return d ≈ 0 and g ≈ 0 for identical groups', () => {
      const result = cohensD([5, 5, 5, 5], [5, 5, 5, 5]);

      // pooledSD = 0, means identical → d = 0, g = 0
      expect(result.d).toBe(0);
      expect(result.g).toBe(0);
      expect(result.interpretation).toBe('negligible');
    });
  });

  describe('single element groups', () => {
    it('should return NaN for groups with fewer than 2 elements', () => {
      const result = cohensD([5], [10]);

      expect(result.d).toBeNaN();
      expect(result.g).toBeNaN();
      expect(result.ci95Lower).toBeNaN();
      expect(result.ci95Upper).toBeNaN();
      expect(result.pooledStdDev).toBeNaN();
    });
  });

  describe('empty groups', () => {
    it('should return NaN when first group is empty', () => {
      const result = cohensD([], [1, 2, 3]);

      expect(result.d).toBeNaN();
      expect(result.g).toBeNaN();
      expect(result.pooledStdDev).toBeNaN();
    });

    it('should return NaN when second group is empty', () => {
      const result = cohensD([1, 2, 3], []);

      expect(result.d).toBeNaN();
      expect(result.g).toBeNaN();
    });

    it('should return NaN when both groups are empty', () => {
      const result = cohensD([], []);

      expect(result.d).toBeNaN();
    });
  });

  describe("Hedges' g correction", () => {
    it('should produce |g| < |d| for small samples', () => {
      const result = cohensD([2, 4, 6, 8, 10], [8, 10, 12, 14, 16]);

      // Hedges' correction reduces the magnitude
      expect(Math.abs(result.g)).toBeLessThan(Math.abs(result.d));
    });

    it('should converge toward d as sample size grows', () => {
      const n = 100;
      const group1 = Array.from({ length: n }, (_, i) => i);
      const group2 = Array.from({ length: n }, (_, i) => i + 50);

      const result = cohensD(group1, group2);

      // With large n, Hedges' correction is very close to 1
      const ratio = Math.abs(result.g / result.d);
      expect(ratio).toBeGreaterThan(0.99);
      expect(ratio).toBeLessThan(1);
    });
  });

  describe('effect size interpretation thresholds', () => {
    it('should classify negligible effect (|d| < 0.2)', () => {
      // Two groups with very similar means and large variance
      const result = cohensD([10, 20, 30, 40, 50], [11, 21, 31, 41, 51]);
      // d = 1/pooledSD, pooledSD ≈ 15.81 → d ≈ 0.063
      expect(result.interpretation).toBe('negligible');
    });

    it('should classify large effect (|d| ≥ 0.8)', () => {
      const result = cohensD([2, 4, 6, 8, 10], [8, 10, 12, 14, 16]);
      expect(result.interpretation).toBe('large');
    });
  });

  describe('NaN and Infinity filtering', () => {
    it('should filter NaN from inputs before computation', () => {
      // After filtering: [2,6] vs [8,12] — needs n ≥ 2 each
      const result = cohensD([2, NaN, 6], [8, NaN, 12]);

      expect(result.d).not.toBeNaN();
      expect(result.pooledStdDev).not.toBeNaN();
    });

    it('should filter Infinity from inputs before computation', () => {
      const result = cohensD([2, Infinity, 6], [8, -Infinity, 12]);

      expect(result.d).not.toBeNaN();
    });

    it('should return NaN when filtering leaves fewer than 2 elements', () => {
      const result = cohensD([5, NaN, NaN], [10, NaN, NaN]);

      expect(result.d).toBeNaN();
    });
  });

  describe('confidence interval', () => {
    it('should produce a valid 95% CI that brackets d', () => {
      const result = cohensD([1, 3, 5, 7, 9], [6, 8, 10, 12, 14]);

      expect(result.ci95Lower).toBeLessThan(result.d);
      expect(result.ci95Upper).toBeGreaterThan(result.d);
      // CI width should be positive
      expect(result.ci95Upper - result.ci95Lower).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// pairedComparison
// ---------------------------------------------------------------------------

describe('pairedComparison', () => {
  describe('structure', () => {
    it('should return all three sub-results and descriptive stats', () => {
      const result = pairedComparison([8, 9, 7, 10], [4, 5, 3, 6]);

      expect(result).toHaveProperty('mannWhitney');
      expect(result).toHaveProperty('wilcoxon');
      expect(result).toHaveProperty('effectSize');
      expect(result).toHaveProperty('beforeStats');
      expect(result).toHaveProperty('afterStats');

      // Sub-results have expected shapes
      expect(result.mannWhitney).toHaveProperty('u');
      expect(result.mannWhitney).toHaveProperty('pValue');
      expect(result.wilcoxon).toHaveProperty('w');
      expect(result.wilcoxon).toHaveProperty('pValue');
      expect(result.effectSize).toHaveProperty('d');
      expect(result.effectSize).toHaveProperty('g');
    });
  });

  describe('descriptive stats', () => {
    it('should compute correct mean, median, stdDev, and n', () => {
      const before = [8, 9, 7, 10, 8, 9];
      const after = [4, 5, 3, 6, 4, 5];

      const result = pairedComparison(before, after);

      // Before: mean = 51/6 = 8.5, median = (8+9)/2 = 8.5, n = 6
      expect(result.beforeStats.mean).toBeCloseTo(8.5, 5);
      expect(result.beforeStats.median).toBeCloseTo(8.5, 5);
      expect(result.beforeStats.n).toBe(6);
      // stdDev = sqrt(((7-8.5)² + (8-8.5)² + ... + (10-8.5)²) / 5) = sqrt(1.1) ≈ 1.0488
      expect(result.beforeStats.stdDev).toBeCloseTo(Math.sqrt(1.1), 4);

      // After: mean = 27/6 = 4.5, median = (4+5)/2 = 4.5, n = 6
      expect(result.afterStats.mean).toBeCloseTo(4.5, 5);
      expect(result.afterStats.median).toBeCloseTo(4.5, 5);
      expect(result.afterStats.n).toBe(6);
      expect(result.afterStats.stdDev).toBeCloseTo(Math.sqrt(1.1), 4);
    });
  });

  describe('CPAP scenario — AHI before vs after treatment change', () => {
    it('should show significant improvement with large effect', () => {
      const before = [8, 9, 7, 10, 8, 9];
      const after = [4, 5, 3, 6, 4, 5];

      const result = pairedComparison(before, after);

      // Mann-Whitney should detect the difference
      expect(result.mannWhitney.pValue).toBeLessThan(0.05);

      // Cohen's d should be large (|d| ≥ 0.8) — clear separation
      expect(Math.abs(result.effectSize.d)).toBeGreaterThan(0.8);
      expect(result.effectSize.interpretation).toBe('large');

      // Wilcoxon: all diffs are negative → W+ = 0
      expect(result.wilcoxon.w).toBe(0);
    });
  });

  describe('NaN filtering in pairedComparison', () => {
    it('should filter NaN values and still produce valid results', () => {
      const result = pairedComparison([8, NaN, 7, 10, 8, 9], [4, 5, NaN, 6, 4, 5]);

      // After filtering each array independently:
      // before → [8, 7, 10, 8, 9] (n=5), after → [4, 5, 6, 4, 5] (n=5)
      expect(result.beforeStats.n).toBe(5);
      expect(result.afterStats.n).toBe(5);
      expect(result.beforeStats.mean).not.toBeNaN();
      expect(result.afterStats.mean).not.toBeNaN();
    });
  });

  describe('empty arrays', () => {
    it('should handle empty inputs gracefully', () => {
      const result = pairedComparison([], []);

      expect(result.mannWhitney.u).toBeNaN();
      expect(result.wilcoxon.w).toBeNaN();
      expect(result.effectSize.d).toBeNaN();
      expect(result.beforeStats.n).toBe(0);
      expect(result.afterStats.n).toBe(0);
    });
  });
});
