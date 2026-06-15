import { describe, it, expect } from 'vitest';
import { poissonRateCI, poissonRateCIExact, poissonRateCINormal } from '../poissonCI';

describe('poissonRateCI — exact Garwood (count < 20)', () => {
  it('N=5, T=1 → point 5.0, [1.6235, 11.6683] (verified)', () => {
    const ci = poissonRateCI(5, 1);
    expect(ci.method).toBe('exact');
    expect(ci.point).toBeCloseTo(5.0, 6);
    expect(ci.lower).toBeCloseTo(1.6235, 4);
    expect(ci.upper).toBeCloseTo(11.6683, 4);
  });

  it('N=0, T=6 → lower 0, two-sided upper 0.6148 /h (3.689 counts)', () => {
    const ci = poissonRateCI(0, 6);
    expect(ci.method).toBe('exact');
    expect(ci.point).toBe(0);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBeCloseTo(0.6148, 4);
    // The two-sided upper count is 3.689, NOT the one-sided 3.0.
    expect(ci.upper * 6).toBeCloseTo(3.689, 3);
  });

  it('N=0, T=1 → two-sided upper = 3.689 counts', () => {
    const ci = poissonRateCI(0, 1);
    expect(ci.upper).toBeCloseTo(3.68888, 4);
  });
});

describe('poissonRateCIExact — D4 corrected reference vectors', () => {
  it('N=40, T=6 exact → [4.7628, 9.0781] /h (D4 corrected vector)', () => {
    const ci = poissonRateCIExact(40, 6);
    expect(ci.method).toBe('exact');
    expect(ci.point).toBeCloseTo(6.6667, 4);
    expect(ci.lower).toBeCloseTo(4.7628, 4);
    expect(ci.upper).toBeCloseTo(9.0781, 4);
    // Guard against the rejected wrong value 4.2932.
    expect(ci.lower).not.toBeCloseTo(4.2932, 3);
  });

  it('N=30, T=6 exact → [3.3735, 7.1378] /h', () => {
    const ci = poissonRateCIExact(30, 6);
    expect(ci.lower).toBeCloseTo(3.3735, 4);
    expect(ci.upper).toBeCloseTo(7.1378, 4);
  });

  it('exact agrees with normal at large N (within approximation tolerance)', () => {
    const exact = poissonRateCIExact(40, 6);
    const normal = poissonRateCINormal(40, 6);
    expect(normal.lower).toBeCloseTo(exact.lower, 0);
    expect(normal.upper).toBeCloseTo(exact.upper, 0);
  });
});

describe('poissonRateCI — normal approximation (count >= 20)', () => {
  it('N=40, T=6 uses normal: (40 ± z√40)/6', () => {
    const ci = poissonRateCI(40, 6);
    expect(ci.method).toBe('normal');
    expect(ci.point).toBeCloseTo(6.6667, 4);
    // (40 ± 1.95996·√40)/6 ≈ [4.600, 8.733]
    expect(ci.lower).toBeCloseTo(4.6, 2);
    expect(ci.upper).toBeCloseTo(8.733, 2);
  });

  it('N=30, T=6 → normal [3.211, 6.789] /h', () => {
    const ci = poissonRateCI(30, 6);
    expect(ci.method).toBe('normal');
    expect(ci.point).toBeCloseTo(5.0, 6);
    // A&S probit approximation → tolerance at 2 dp.
    expect(ci.lower).toBeCloseTo(3.211, 2);
    expect(ci.upper).toBeCloseTo(6.789, 2);
  });

  it('clamps the normal lower bound at 0', () => {
    // N=20 at large T: point small, half-width can exceed point.
    const ci = poissonRateCI(20, 0.1);
    expect(ci.method).toBe('normal');
    expect(ci.lower).toBeGreaterThanOrEqual(0);
  });
});

describe('poissonRateCI — exact/normal switch boundary at N=20', () => {
  it('N=19 uses exact', () => {
    expect(poissonRateCI(19, 6).method).toBe('exact');
  });
  it('N=20 uses normal', () => {
    expect(poissonRateCI(20, 6).method).toBe('normal');
  });
});

describe('poissonRateCI — confidence level', () => {
  it('a wider confidence level produces a wider interval', () => {
    const ci95 = poissonRateCI(10, 6, 0.95);
    const ci99 = poissonRateCI(10, 6, 0.99);
    expect(ci99.upper).toBeGreaterThan(ci95.upper);
    expect(ci99.lower).toBeLessThan(ci95.lower);
  });
});

describe('poissonRateCI — edge cases', () => {
  it('hours <= 0 → all NaN', () => {
    for (const h of [0, -1]) {
      const ci = poissonRateCI(5, h);
      expect(ci.point).toBeNaN();
      expect(ci.lower).toBeNaN();
      expect(ci.upper).toBeNaN();
    }
  });

  it('negative or non-integer count → all NaN', () => {
    expect(poissonRateCI(-1, 6).point).toBeNaN();
    expect(poissonRateCI(2.5, 6).point).toBeNaN();
  });

  it('non-finite inputs → all NaN', () => {
    expect(poissonRateCI(NaN, 6).point).toBeNaN();
    expect(poissonRateCI(5, NaN).point).toBeNaN();
    expect(poissonRateCI(5, Infinity).point).toBeNaN();
    expect(poissonRateCI(5, 6, NaN).point).toBeNaN();
  });

  it('out-of-range confidence → all NaN', () => {
    expect(poissonRateCI(5, 6, 0).point).toBeNaN();
    expect(poissonRateCI(5, 6, 1).point).toBeNaN();
    expect(poissonRateCI(5, 6, 1.5).point).toBeNaN();
  });

  it('bounds bracket the point estimate', () => {
    for (const n of [1, 5, 19, 20, 40, 100]) {
      const ci = poissonRateCI(n, 6);
      expect(ci.lower).toBeLessThanOrEqual(ci.point);
      expect(ci.upper).toBeGreaterThanOrEqual(ci.point);
    }
  });
});
