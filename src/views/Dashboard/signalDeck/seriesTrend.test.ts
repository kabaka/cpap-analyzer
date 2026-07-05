import { describe, it, expect } from 'vitest';

import { seriesTrendPercent } from './seriesTrend';

describe('seriesTrendPercent', () => {
  it('returns 0 for fewer than four defined points', () => {
    expect(seriesTrendPercent([])).toBe(0);
    expect(seriesTrendPercent([1, 2, 3])).toBe(0);
    // nulls do not count toward the four-point minimum.
    expect(seriesTrendPercent([1, 2, 3, null, null])).toBe(0);
  });

  it('computes the first- vs last-window percent change (window = min(7, floor(n/2)))', () => {
    // 8 defined points → window = 4. first mean = 10, last mean = 20 → +100%.
    expect(seriesTrendPercent([10, 10, 10, 10, 20, 20, 20, 20])).toBeCloseTo(100, 10);
    // Decreasing: first mean = 20, last mean = 10 → -50%.
    expect(seriesTrendPercent([20, 20, 20, 20, 10, 10, 10, 10])).toBeCloseTo(-50, 10);
  });

  it('skips null gaps rather than treating them as zero', () => {
    // Defined values are [10,10,10,10,20,20,20,20]; the nulls are ignored, so the
    // result matches the gap-free series (+100%), not a null-as-0 deflation.
    expect(seriesTrendPercent([10, null, 10, 10, null, 10, 20, 20, null, 20, 20])).toBeCloseTo(
      100,
      10,
    );
  });

  it('caps the comparison window at 7 points per side', () => {
    // 16 defined points → window = min(7, 8) = 7. The 8th value (index 7) is
    // excluded from the first window and the 9th (index 8) from the last window.
    const rising = [1, 1, 1, 1, 1, 1, 1, 999, 999, 3, 3, 3, 3, 3, 3, 3];
    // first window mean = 1, last window mean = 3 → +200%.
    expect(seriesTrendPercent(rising)).toBeCloseTo(200, 10);
  });

  it('returns 0 when the baseline (first-window) mean is 0', () => {
    // first window mean = 0 → guard against divide-by-zero, returns 0.
    expect(seriesTrendPercent([0, 0, 0, 0, 5, 5, 5, 5])).toBe(0);
  });

  it('is unaffected by non-finite entries, which are filtered out', () => {
    expect(seriesTrendPercent([10, 10, 10, 10, 20, 20, 20, 20, Number.NaN])).toBeCloseTo(100, 10);
  });
});
