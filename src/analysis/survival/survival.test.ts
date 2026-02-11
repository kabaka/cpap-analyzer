import { describe, it, expect } from 'vitest';
import { kaplanMeier } from './index';

// ---------------------------------------------------------------------------
// kaplanMeier
// ---------------------------------------------------------------------------

describe('kaplanMeier', () => {
  it('should compute textbook S(t) for alternating event/censored data', () => {
    // durations = [1..10], alternating event/censored
    // At each event time: S is product of (1 - d_i/n_i)
    //   t=1:  n=10, d=1 → S = 9/10 = 0.9
    //   t=3:  n=8,  d=1 → S = 0.9 × 7/8 = 0.7875
    //   t=5:  n=6,  d=1 → S = 0.7875 × 5/6 = 0.65625
    //   t=7:  n=4,  d=1 → S = 0.65625 × 3/4 = 0.4921875
    //   t=9:  n=2,  d=1 → S = 0.4921875 × 1/2 = 0.24609375
    const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const events = [true, false, true, false, true, false, true, false, true, false];

    const result = kaplanMeier(durations, events);

    expect(result.times).toEqual([1, 3, 5, 7, 9]);
    expect(result.atRisk).toEqual([10, 8, 6, 4, 2]);
    expect(result.events).toEqual([1, 1, 1, 1, 1]);

    expect(result.survivors[0]).toBeCloseTo(0.9, 10);
    expect(result.survivors[1]).toBeCloseTo(0.7875, 10);
    expect(result.survivors[2]).toBeCloseTo(0.65625, 10);
    expect(result.survivors[3]).toBeCloseTo(0.4921875, 10);
    expect(result.survivors[4]).toBeCloseTo(0.24609375, 10);
  });

  it('should compute correct S(t) when all events are observed (no censoring)', () => {
    const durations = [2, 5, 8];
    const events = [true, true, true];

    const result = kaplanMeier(durations, events);

    // t=2: n=3, d=1 → S = 2/3
    // t=5: n=2, d=1 → S = 2/3 × 1/2 = 1/3
    // t=8: n=1, d=1 → S = 1/3 × 0 = 0
    expect(result.times).toEqual([2, 5, 8]);
    expect(result.survivors[0]).toBeCloseTo(2 / 3, 10);
    expect(result.survivors[1]).toBeCloseTo(1 / 3, 10);
    expect(result.survivors[2]).toBeCloseTo(0, 10);
  });

  it('should return empty result with S=never-drops when all observations are censored', () => {
    const durations = [1, 2, 3, 4, 5];
    const events = [false, false, false, false, false];

    const result = kaplanMeier(durations, events);

    // No event times → empty arrays, S conceptually = 1 everywhere
    expect(result.times).toHaveLength(0);
    expect(result.survivors).toHaveLength(0);
    expect(result.medianSurvivalTime).toBeNull();
  });

  it('should return empty result for empty arrays', () => {
    const result = kaplanMeier([], []);

    expect(result.times).toHaveLength(0);
    expect(result.survivors).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    expect(result.atRisk).toHaveLength(0);
    expect(result.medianSurvivalTime).toBeNull();
  });

  it('should find the median survival time when S crosses 0.5', () => {
    // From the textbook example: S(t=7) = 0.4921875 ≤ 0.5
    const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const events = [true, false, true, false, true, false, true, false, true, false];

    const result = kaplanMeier(durations, events);

    expect(result.medianSurvivalTime).toBe(7);
  });

  it('should have ciLower ≤ survivors ≤ ciUpper for each point', () => {
    const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const events = [true, false, true, false, true, false, true, false, true, false];

    const result = kaplanMeier(durations, events);

    for (let i = 0; i < result.survivors.length; i++) {
      expect(result.ciLower[i]).toBeLessThanOrEqual(result.survivors[i]! + 1e-10);
      expect(result.ciUpper[i]).toBeGreaterThanOrEqual(result.survivors[i]! - 1e-10);
    }
  });

  it('should have non-increasing atRisk values', () => {
    const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const events = [true, false, true, false, true, false, true, false, true, false];

    const result = kaplanMeier(durations, events);

    for (let i = 1; i < result.atRisk.length; i++) {
      expect(result.atRisk[i]).toBeLessThanOrEqual(result.atRisk[i - 1]!);
    }
  });

  it('should filter out NaN durations', () => {
    const durations = [1, NaN, 3, NaN, 5];
    const events = [true, true, true, true, true];

    const result = kaplanMeier(durations, events);

    // Only finite durations are used: [1, 3, 5] → 3 event times
    expect(result.times).toEqual([1, 3, 5]);
    expect(result.times).toHaveLength(3);
    expect(result.atRisk[0]).toBe(3);
  });

  it('should handle tied event times correctly', () => {
    // Two events at t=3 and one at t=5
    const durations = [3, 3, 5];
    const events = [true, true, true];

    const result = kaplanMeier(durations, events);

    // t=3: n=3, d=2 → S = 1 - 2/3 = 1/3
    // t=5: n=1, d=1 → S = 1/3 × 0 = 0
    expect(result.times).toEqual([3, 5]);
    expect(result.events).toEqual([2, 1]);
    expect(result.atRisk).toEqual([3, 1]);
    expect(result.survivors[0]).toBeCloseTo(1 / 3, 10);
    expect(result.survivors[1]).toBeCloseTo(0, 10);
  });
});
