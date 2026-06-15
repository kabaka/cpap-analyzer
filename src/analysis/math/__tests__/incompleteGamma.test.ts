import { describe, it, expect } from 'vitest';
import { lowerGammaRegularized, inverseChiSquare } from '../index';

describe('lowerGammaRegularized', () => {
  it('returns 0 at x = 0', () => {
    expect(lowerGammaRegularized(1, 0)).toBe(0);
    expect(lowerGammaRegularized(5, 0)).toBe(0);
  });

  it('matches the exponential CDF for s = 1 (P(1, x) = 1 - e^-x)', () => {
    for (const x of [0.5, 1, 2, 5]) {
      expect(lowerGammaRegularized(1, x)).toBeCloseTo(1 - Math.exp(-x), 10);
    }
  });

  it('is monotonically increasing in x and bounded by [0, 1]', () => {
    let prev = -1;
    for (let x = 0; x <= 30; x += 0.5) {
      const v = lowerGammaRegularized(4, x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('uses the continued-fraction branch for large x (x >= s + 1)', () => {
    // chi-square(df=2) CDF at x=10 is P(1, 5) = 1 - e^-5
    expect(lowerGammaRegularized(1, 5)).toBeCloseTo(1 - Math.exp(-5), 10);
  });

  it('rejects invalid input with NaN', () => {
    expect(lowerGammaRegularized(0, 1)).toBeNaN();
    expect(lowerGammaRegularized(-1, 1)).toBeNaN();
    expect(lowerGammaRegularized(1, -1)).toBeNaN();
    expect(lowerGammaRegularized(NaN, 1)).toBeNaN();
    expect(lowerGammaRegularized(1, NaN)).toBeNaN();
  });
});

describe('inverseChiSquare', () => {
  // Wolfram-verified chi-square quantiles.
  it('matches known chi-square quantiles', () => {
    // ½·χ²(0.025; 10) = 1.62349 ; ½·χ²(0.975; 12) = 11.66833 (N=5 Poisson)
    expect(0.5 * inverseChiSquare(0.025, 10)).toBeCloseTo(1.62349, 4);
    expect(0.5 * inverseChiSquare(0.975, 12)).toBeCloseTo(11.66833, 4);
    // N=30 counts
    expect(0.5 * inverseChiSquare(0.025, 60)).toBeCloseTo(20.24087, 4);
    expect(0.5 * inverseChiSquare(0.975, 62)).toBeCloseTo(42.82687, 4);
    // N=40 counts
    expect(0.5 * inverseChiSquare(0.025, 80)).toBeCloseTo(28.57659, 4);
    expect(0.5 * inverseChiSquare(0.975, 82)).toBeCloseTo(54.46865, 4);
    // N=0 two-sided upper = ½·χ²(0.975; 2) = 3.68888
    expect(0.5 * inverseChiSquare(0.975, 2)).toBeCloseTo(3.68888, 4);
    // One-sided rule-of-three: ½·χ²(0.95; 2) = 2.99573 ≈ 3.0
    expect(0.5 * inverseChiSquare(0.95, 2)).toBeCloseTo(2.99573, 4);
  });

  it('round-trips with the chi-square CDF', () => {
    for (const df of [1, 2, 5, 10, 60]) {
      for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
        const x = inverseChiSquare(p, df);
        expect(lowerGammaRegularized(df / 2, x / 2)).toBeCloseTo(p, 6);
      }
    }
  });

  it('handles boundary probabilities', () => {
    expect(inverseChiSquare(0, 5)).toBe(0);
    expect(inverseChiSquare(1, 5)).toBe(Infinity);
  });

  it('rejects invalid input with NaN', () => {
    expect(inverseChiSquare(0.5, 0)).toBeNaN();
    expect(inverseChiSquare(0.5, 0.5)).toBeNaN();
    expect(inverseChiSquare(NaN, 5)).toBeNaN();
    expect(inverseChiSquare(0.5, NaN)).toBeNaN();
  });
});
