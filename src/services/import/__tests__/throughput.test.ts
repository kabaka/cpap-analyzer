import { describe, it, expect } from 'vitest';
import { updateThroughputEwma, computeEtaMs } from '@/services/import/ImportController';

describe('updateThroughputEwma', () => {
  it('seeds the EWMA with the first instantaneous rate', () => {
    // 10 items over 1000 ms = 10 items/sec.
    expect(updateThroughputEwma(null, { dItems: 10, dtMs: 1000 })).toBeCloseTo(10, 6);
  });

  it('blends a new sample with the previous EWMA using alpha', () => {
    // prev = 10/s; new instantaneous = 20 items / 1000 ms = 20/s; alpha = 0.5.
    // result = 0.5*20 + 0.5*10 = 15.
    expect(updateThroughputEwma(10, { dItems: 20, dtMs: 1000 }, 0.5)).toBeCloseTo(15, 6);
  });

  it('ignores samples with no forward progress', () => {
    expect(updateThroughputEwma(10, { dItems: 0, dtMs: 1000 })).toBe(10);
    expect(updateThroughputEwma(10, { dItems: -5, dtMs: 1000 })).toBe(10);
  });

  it('ignores samples over a sub-millisecond interval (avoids divide-by-noise)', () => {
    expect(updateThroughputEwma(10, { dItems: 5, dtMs: 0 })).toBe(10);
    expect(updateThroughputEwma(null, { dItems: 5, dtMs: 0 })).toBeNull();
  });
});

describe('computeEtaMs', () => {
  it('returns remaining/rate in ms', () => {
    // 100 items left at 10 items/sec → 10 s → 10000 ms.
    expect(computeEtaMs(10, 0, 100)).toBe(10000);
    expect(computeEtaMs(10, 50, 100)).toBe(5000);
  });

  it('clamps remaining at zero when already past the total', () => {
    expect(computeEtaMs(10, 120, 100)).toBe(0);
  });

  it('is null when the rate is unknown or non-positive', () => {
    expect(computeEtaMs(null, 0, 100)).toBeNull();
    expect(computeEtaMs(0, 0, 100)).toBeNull();
    expect(computeEtaMs(-1, 0, 100)).toBeNull();
  });

  it('is null when the total is unknown (indeterminate gating stage)', () => {
    expect(computeEtaMs(10, 0, null)).toBeNull();
  });
});
