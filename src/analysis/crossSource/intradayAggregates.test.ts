/**
 * Known-value tests for the intraday aggregate helpers.
 *
 * @module analysis/crossSource/intradayAggregates.test
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateIntraday,
  selectWindowSamples,
  type IntradaySample,
  type TimeWindow,
} from './intradayAggregates';

/** Build samples at 1-second cadence starting at `startMs` from a value list. */
function samplesFrom(startMs: number, values: number[], stepMs = 1000): IntradaySample[] {
  return values.map((value, i) => ({ timestampMs: startMs + i * stepMs, value }));
}

describe('selectWindowSamples', () => {
  const base = 1_000_000;
  const samples = samplesFrom(base, [1, 2, 3, 4, 5]); // base .. base+4000

  it('includes samples on the inclusive window bounds', () => {
    const window: TimeWindow = { startMs: base + 1000, endMs: base + 3000 };
    expect(selectWindowSamples(samples, window).map((s) => s.value)).toEqual([2, 3, 4]);
  });

  it('excludes samples outside the window', () => {
    const window: TimeWindow = { startMs: base + 1500, endMs: base + 2500 };
    expect(selectWindowSamples(samples, window).map((s) => s.value)).toEqual([3]);
  });

  it('drops non-finite values', () => {
    const withNaN = [...samples, { timestampMs: base + 1000, value: NaN }];
    const window: TimeWindow = { startMs: base, endMs: base + 4000 };
    expect(selectWindowSamples(withNaN, window)).toHaveLength(5);
  });

  it('tolerates an inverted window by normalising the bounds', () => {
    const window: TimeWindow = { startMs: base + 3000, endMs: base + 1000 };
    expect(selectWindowSamples(samples, window).map((s) => s.value)).toEqual([2, 3, 4]);
  });
});

describe('aggregateIntraday', () => {
  it('computes mean/min/max/std for a known set', () => {
    // values 2,4,4,4,5,5,7,9 -> mean 5, population SD 2.
    // Sample (Bessel-corrected) SD = sqrt(32/7) ≈ 2.1380899.
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const base = 0;
    const samples = samplesFrom(base, values);
    const window: TimeWindow = { startMs: base, endMs: base + 7000 };

    const agg = aggregateIntraday(samples, window);
    expect(agg.count).toBe(8);
    expect(agg.mean).toBeCloseTo(5, 10);
    expect(agg.min).toBe(2);
    expect(agg.max).toBe(9);
    expect(agg.std).toBeCloseTo(Math.sqrt(32 / 7), 10); // sample SD
  });

  it('computes coverage as span / window duration', () => {
    const base = 1_000_000;
    // Samples span base..base+30000 (30s) within a 60s window -> coverage 0.5
    const samples = samplesFrom(base, [60, 61, 62, 63], 10_000); // 0,10,20,30s
    const window: TimeWindow = { startMs: base, endMs: base + 60_000 };

    const agg = aggregateIntraday(samples, window);
    expect(agg.spanMs).toBe(30_000);
    expect(agg.coverage).toBeCloseTo(0.5, 10);
  });

  it('caps coverage at 1 when the sample span equals the window', () => {
    const base = 0;
    const samples = samplesFrom(base, [70, 71, 72], 5000); // 0..10s
    const window: TimeWindow = { startMs: base, endMs: base + 10_000 };
    expect(aggregateIntraday(samples, window).coverage).toBe(1);
  });

  it('only aggregates in-window samples', () => {
    const base = 0;
    // Two samples before the window, two inside, one after.
    const samples = samplesFrom(base, [100, 100, 80, 90, 100], 1000);
    const window: TimeWindow = { startMs: base + 2000, endMs: base + 3000 };

    const agg = aggregateIntraday(samples, window);
    expect(agg.count).toBe(2);
    expect(agg.mean).toBe(85);
    expect(agg.min).toBe(80);
    expect(agg.max).toBe(90);
  });

  it('returns all-null stats for an empty window', () => {
    const agg = aggregateIntraday(samplesFrom(0, [1, 2, 3]), {
      startMs: 10_000,
      endMs: 20_000,
    });
    expect(agg).toEqual({
      count: 0,
      mean: null,
      min: null,
      max: null,
      std: null,
      spanMs: 0,
      coverage: 0,
    });
  });

  it('returns null std and zero span/coverage for a single in-window sample', () => {
    const base = 0;
    const samples = samplesFrom(base, [50, 65, 50], 1000);
    const window: TimeWindow = { startMs: base + 1000, endMs: base + 1000 };

    const agg = aggregateIntraday(samples, window);
    expect(agg.count).toBe(1);
    expect(agg.mean).toBe(65);
    expect(agg.std).toBeNull();
    expect(agg.spanMs).toBe(0);
    expect(agg.coverage).toBe(0);
  });

  it('returns zero coverage for a zero-length window even with samples', () => {
    const base = 0;
    const samples = samplesFrom(base, [60, 61], 0); // both at base
    const window: TimeWindow = { startMs: base, endMs: base };
    const agg = aggregateIntraday(samples, window);
    expect(agg.count).toBe(2);
    expect(agg.coverage).toBe(0);
  });
});
