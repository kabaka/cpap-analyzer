import { describe, it, expect } from 'vitest';
import { AHI_BAND_WINDOW_NIGHTS, buildRollingBandSeries } from '@/components/charts/uncertainty';

interface Night {
  ahi: number;
}

describe('buildRollingBandSeries', () => {
  it('emits one point per input element with a [P25, P75] band tuple', () => {
    const series: Night[] = [{ ahi: 1 }, { ahi: 2 }, { ahi: 3 }, { ahi: 4 }];
    const out = buildRollingBandSeries(series, (d) => d.ahi, 4);

    expect(out).toHaveLength(series.length);
    const last = out[out.length - 1]!;
    expect(last.median).not.toBeNull();
    expect(last.band).not.toBeNull();
    // P25 <= median <= P75
    const [lo, hi] = last.band!;
    expect(lo).toBeLessThanOrEqual(last.median!);
    expect(last.median!).toBeLessThanOrEqual(hi);
    expect(lo).toBeLessThanOrEqual(hi);
  });

  it('uses the trailing window (right-aligned) and grows on the leading edge', () => {
    const series: Night[] = [{ ahi: 10 }, { ahi: 20 }];
    const out = buildRollingBandSeries(series, (d) => d.ahi, 7);
    // First point: window of one value → median equals that value, band collapses.
    expect(out[0]!.median).toBe(10);
    expect(out[0]!.band).toEqual([10, 10]);
  });

  it('preserves the source datum on each point', () => {
    const series: Night[] = [{ ahi: 5 }];
    const out = buildRollingBandSeries(series, (d) => d.ahi);
    expect(out[0]!.source).toBe(series[0]);
  });

  it('defaults to the documented AHI window constant', () => {
    expect(AHI_BAND_WINDOW_NIGHTS).toBeGreaterThan(0);
    const series: Night[] = Array.from({ length: 10 }, (_, i) => ({ ahi: i }));
    const withDefault = buildRollingBandSeries(series, (d) => d.ahi);
    const withExplicit = buildRollingBandSeries(series, (d) => d.ahi, AHI_BAND_WINDOW_NIGHTS);
    expect(withDefault).toEqual(withExplicit);
  });

  describe('edge cases', () => {
    it('returns an empty array for empty input', () => {
      expect(buildRollingBandSeries<Night>([], (d) => d.ahi)).toEqual([]);
    });

    it('emits null median/band when a window has no finite values', () => {
      const series: Night[] = [{ ahi: NaN }, { ahi: Number.POSITIVE_INFINITY }];
      const out = buildRollingBandSeries(series, (d) => d.ahi, 7);
      expect(out[0]).toEqual({ source: series[0], median: null, band: null });
      expect(out[1]).toEqual({ source: series[1], median: null, band: null });
    });
  });
});
