import { describe, it, expect } from 'vitest';
import { rollingMedianBand } from '../rollingBand';

describe('rollingMedianBand', () => {
  it('emits one point per input index', () => {
    const out = rollingMedianBand([1, 2, 3, 4, 5], 3);
    expect(out).toHaveLength(5);
    expect(out.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('grows the window from length 1 up to `window` at the leading edge', () => {
    const out = rollingMedianBand([10, 20, 30, 40], 3);
    // i=0: window [10] → median 10
    expect(out[0]?.median).toBe(10);
    expect(out[0]?.p25).toBe(10);
    expect(out[0]?.p75).toBe(10);
    // i=1: window [10,20] → median 15
    expect(out[1]?.median).toBe(15);
    // i=2: window [10,20,30] → median 20, p25 15, p75 25 (Type 7)
    expect(out[2]?.median).toBe(20);
    expect(out[2]?.p25).toBe(15);
    expect(out[2]?.p75).toBe(25);
    // i=3: trailing window [20,30,40] → median 30, p25 25, p75 35
    expect(out[3]?.median).toBe(30);
    expect(out[3]?.p25).toBe(25);
    expect(out[3]?.p75).toBe(35);
  });

  it('computes the IQR band over a known series (full window)', () => {
    // window of [1..5]: median 3, p25 2, p75 4 (Type 7).
    const out = rollingMedianBand([1, 2, 3, 4, 5], 5);
    const last = out[4];
    expect(last?.median).toBe(3);
    expect(last?.p25).toBe(2);
    expect(last?.p75).toBe(4);
  });

  it('is robust to a single outlier night (median band, not mean)', () => {
    // [5,5,5,5,100]: trailing window of 5 → median 5, p75 5 (outlier excluded
    // from the central tendency, unlike a mean).
    const out = rollingMedianBand([5, 5, 5, 5, 100], 5);
    const last = out[4];
    expect(last?.median).toBe(5);
    expect(last?.p25).toBe(5);
    expect(last?.p75).toBe(5);
  });

  it('excludes non-finite values from each window', () => {
    const out = rollingMedianBand([10, NaN, 20, Infinity, 30], 5);
    // Finite values in window at i=4: [10,20,30] → median 20.
    expect(out[4]?.median).toBe(20);
  });

  it('returns NaN band when a window has no finite values', () => {
    const out = rollingMedianBand([NaN, NaN], 2);
    expect(out[0]?.median).toBeNaN();
    expect(out[1]?.median).toBeNaN();
    expect(out[0]?.index).toBe(0);
  });

  it('returns empty for invalid window or empty input', () => {
    expect(rollingMedianBand([1, 2, 3], 0)).toEqual([]);
    expect(rollingMedianBand([1, 2, 3], -1)).toEqual([]);
    expect(rollingMedianBand([1, 2, 3], NaN)).toEqual([]);
    expect(rollingMedianBand([], 3)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    rollingMedianBand(input, 3);
    expect(input).toEqual([3, 1, 2]);
  });
});
