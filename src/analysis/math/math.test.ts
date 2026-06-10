import { describe, it, expect } from 'vitest';

import {
  at,
  lnGamma,
  regularizedIncompleteBeta,
  erf,
  normalCDF,
  studentTCDF,
  inverseNormalCDF,
  twoTailedPValue,
  binomCoeff,
} from './index';

describe('math utilities', () => {
  // -----------------------------------------------------------------------
  // at()
  // -----------------------------------------------------------------------
  describe('at', () => {
    const arr = [10, 20, 30];

    it('should return value at valid index', () => {
      expect(at(arr, 0)).toBe(10);
      expect(at(arr, 1)).toBe(20);
      expect(at(arr, 2)).toBe(30);
    });

    it('should return fallback for out-of-bounds index', () => {
      expect(at(arr, 5, -1)).toBe(-1);
      expect(at(arr, -1, -1)).toBe(-1);
    });

    it('should return fallback for undefined entries', () => {
      // eslint-disable-next-line no-sparse-arrays
      const sparse = [1, , 3] as (number | undefined)[];
      expect(at(sparse, 1, 99)).toBe(99);
    });

    it('should default fallback to 0', () => {
      expect(at(arr, 100)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // lnGamma()
  // -----------------------------------------------------------------------
  describe('lnGamma', () => {
    it('should return ≈ 0 for lnGamma(1) — ln(0!) = 0', () => {
      expect(lnGamma(1)).toBeCloseTo(0, 6);
    });

    it('should return ≈ 0 for lnGamma(2) — ln(1!) = 0', () => {
      expect(lnGamma(2)).toBeCloseTo(0, 6);
    });

    it('should return ≈ ln(120) for lnGamma(6) — ln(5!)', () => {
      expect(lnGamma(6)).toBeCloseTo(Math.log(120), 6);
    });

    it('should return ≈ ln(√π) for lnGamma(0.5)', () => {
      // Γ(0.5) = √π  ⇒  lnΓ(0.5) = 0.5 * ln(π) ≈ 0.57236
      expect(lnGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 5);
    });

    it('should return Infinity for z = 0', () => {
      expect(lnGamma(0)).toBe(Infinity);
    });

    it('should return Infinity for negative z', () => {
      expect(lnGamma(-1)).toBe(Infinity);
      expect(lnGamma(-5.5)).toBe(Infinity);
    });
  });

  // -----------------------------------------------------------------------
  // regularizedIncompleteBeta()
  // -----------------------------------------------------------------------
  describe('regularizedIncompleteBeta', () => {
    it('should return 0 when x = 0', () => {
      expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
      expect(regularizedIncompleteBeta(0, 1, 1)).toBe(0);
    });

    it('should return 1 when x = 1', () => {
      expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
      expect(regularizedIncompleteBeta(1, 1, 1)).toBe(1);
    });

    it('should return 0.5 for I_0.5(1, 1)', () => {
      expect(regularizedIncompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 6);
    });

    it('should return 0.5 for I_0.5(2, 2) — symmetric case', () => {
      expect(regularizedIncompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 6);
    });

    it('should match reference: I_0.3(2, 5) ≈ 0.57983', () => {
      // Direct integration: 30 * ∫₀⁰·³ t(1-t)⁴ dt = 0.579825
      expect(regularizedIncompleteBeta(0.3, 2, 5)).toBeCloseTo(0.579825, 5);
    });
  });

  // -----------------------------------------------------------------------
  // erf()
  // -----------------------------------------------------------------------
  describe('erf', () => {
    it('should return ≈ 0 for erf(0)', () => {
      // A&S approximation has ~1e-9 residual at zero
      expect(erf(0)).toBeCloseTo(0, 6);
    });

    it('should return ≈ 0.8427 for erf(1)', () => {
      expect(erf(1)).toBeCloseTo(0.8427, 4);
    });

    it('should be an odd function: erf(-1) ≈ -0.8427', () => {
      expect(erf(-1)).toBeCloseTo(-0.8427, 4);
    });

    it('should approach 1 for large positive values', () => {
      expect(erf(5)).toBeCloseTo(1, 6);
    });

    it('should approach -1 for large negative values', () => {
      expect(erf(-5)).toBeCloseTo(-1, 6);
    });
  });

  // -----------------------------------------------------------------------
  // normalCDF()
  // -----------------------------------------------------------------------
  describe('normalCDF', () => {
    it('should return 0.5 for x = 0', () => {
      expect(normalCDF(0)).toBeCloseTo(0.5, 6);
    });

    it('should return ≈ 0.975 for x = 1.96', () => {
      expect(normalCDF(1.96)).toBeCloseTo(0.975, 3);
    });

    it('should return ≈ 0.025 for x = -1.96', () => {
      expect(normalCDF(-1.96)).toBeCloseTo(0.025, 3);
    });

    it('should return ≈ 0.99865 for x = 3', () => {
      expect(normalCDF(3)).toBeCloseTo(0.99865, 4);
    });
  });

  // -----------------------------------------------------------------------
  // studentTCDF()
  // -----------------------------------------------------------------------
  describe('studentTCDF', () => {
    it('should return 0.5 for t = 0 regardless of df', () => {
      expect(studentTCDF(0, 5)).toBeCloseTo(0.5, 6);
      expect(studentTCDF(0, 100)).toBeCloseTo(0.5, 6);
    });

    it('should approach normalCDF for large df (>30)', () => {
      const t = 1.96;
      const large = studentTCDF(t, 1000);
      const normal = normalCDF(t);
      expect(large).toBeCloseTo(normal, 2);
    });

    it('should return ≈ 0.975 for t = 2.776, df = 4 (critical value)', () => {
      expect(studentTCDF(2.776, 4)).toBeCloseTo(0.975, 2);
    });

    // -----------------------------------------------------------------------
    // Tail accuracy for df > 30.
    //
    // The previous implementation used a Cornish-Fisher normal approximation
    // for df > 30 that had 6–15% relative error in the small-p tails (e.g. at
    // df=40, t=3.5 the upper-tail probability was 6.63e-4 vs the exact
    // 5.79e-4 — a 14.6% over-estimate). The incomplete-beta path is exact, so
    // these tests pin the tail to 6-decimal reference values.
    //
    // Reference values (high-precision Lentz incomplete-beta evaluation,
    // matching R's pt(): pt(3, 40) = 0.9976849301, etc.):
    //   df=40,  t=3   → CDF = 0.9976849301
    //   df=40,  t=3.5 → CDF = 0.9994211467
    //   df=100, t=3   → CDF = 0.9982960423
    //   df=100, t=3.5 → CDF = 0.9996517861
    //   df=200, t=4   → CDF = 0.9999554345
    // -----------------------------------------------------------------------
    it('should be accurate in the upper tail for df = 40 (was Cornish-Fisher)', () => {
      expect(studentTCDF(3, 40)).toBeCloseTo(0.9976849301, 6);
      expect(studentTCDF(3.5, 40)).toBeCloseTo(0.9994211467, 6);
    });

    it('should be accurate in the upper tail for df = 100', () => {
      expect(studentTCDF(3, 100)).toBeCloseTo(0.9982960423, 6);
      expect(studentTCDF(3.5, 100)).toBeCloseTo(0.9996517861, 6);
    });

    it('should be accurate in the extreme tail for df = 200', () => {
      expect(studentTCDF(4, 200)).toBeCloseTo(0.9999554345, 7);
    });

    it('should be symmetric: F(-t; df) = 1 - F(t; df) in the tail', () => {
      const df = 50;
      const t = 4;
      expect(studentTCDF(-t, df)).toBeCloseTo(1 - studentTCDF(t, df), 12);
    });

    it('should return NaN for df < 1', () => {
      expect(studentTCDF(1, 0)).toBeNaN();
      expect(studentTCDF(1, -5)).toBeNaN();
    });

    it('should return NaN for non-finite inputs', () => {
      expect(studentTCDF(NaN, 10)).toBeNaN();
      expect(studentTCDF(1, NaN)).toBeNaN();
    });
  });

  // -----------------------------------------------------------------------
  // inverseNormalCDF()
  // -----------------------------------------------------------------------
  describe('inverseNormalCDF', () => {
    it('should return 0 for p = 0.5', () => {
      expect(inverseNormalCDF(0.5)).toBe(0);
    });

    it('should return ≈ 1.96 for p = 0.975', () => {
      expect(inverseNormalCDF(0.975)).toBeCloseTo(1.96, 2);
    });

    it('should return ≈ -1.96 for p = 0.025', () => {
      expect(inverseNormalCDF(0.025)).toBeCloseTo(-1.96, 2);
    });

    it('should return -Infinity for p = 0', () => {
      expect(inverseNormalCDF(0)).toBe(-Infinity);
    });

    it('should return Infinity for p = 1', () => {
      expect(inverseNormalCDF(1)).toBe(Infinity);
    });
  });

  // -----------------------------------------------------------------------
  // twoTailedPValue()
  // -----------------------------------------------------------------------
  describe('twoTailedPValue', () => {
    it('should return 1.0 for t = 0 (purely central)', () => {
      expect(twoTailedPValue(0, 10)).toBeCloseTo(1.0, 6);
      expect(twoTailedPValue(0, 50)).toBeCloseTo(1.0, 6);
    });

    it('should return ≈ 0.05 for df = 10, t = 2.228', () => {
      expect(twoTailedPValue(2.228, 10)).toBeCloseTo(0.05, 2);
    });

    it('should be accurate in the tail for df > 30 (incomplete-beta path)', () => {
      // Reference (R: 2*pt(3, 40, lower.tail=FALSE) = 0.004630140):
      expect(twoTailedPValue(3, 40)).toBeCloseTo(0.00463014, 6);
      // Reference (R: 2*pt(3.5, 100, lower.tail=FALSE) = 0.0006964277):
      expect(twoTailedPValue(3.5, 100)).toBeCloseTo(0.0006964277, 7);
    });

    it('should return NaN for invalid inputs', () => {
      expect(twoTailedPValue(NaN, 10)).toBeNaN();
      expect(twoTailedPValue(1, 0)).toBeNaN();
      expect(twoTailedPValue(1, -1)).toBeNaN();
    });
  });

  // -----------------------------------------------------------------------
  // binomCoeff()
  // -----------------------------------------------------------------------
  describe('binomCoeff', () => {
    it('should return 1 for C(5, 0)', () => {
      expect(binomCoeff(5, 0)).toBe(1);
    });

    it('should return 1 for C(5, 5)', () => {
      expect(binomCoeff(5, 5)).toBe(1);
    });

    it('should return 10 for C(5, 2)', () => {
      expect(binomCoeff(5, 2)).toBe(10);
    });

    it('should return 120 for C(10, 3)', () => {
      expect(binomCoeff(10, 3)).toBe(120);
    });

    it('should return 0 when k > n', () => {
      expect(binomCoeff(3, 5)).toBe(0);
    });

    it('should return 0 when k < 0', () => {
      expect(binomCoeff(5, -1)).toBe(0);
    });
  });
});
