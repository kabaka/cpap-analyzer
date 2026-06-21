/**
 * Unit tests for the insight-input builders (compute-then-narrate wiring).
 *
 * Assert that the UI shapes already-computed data into the correct
 * {@link InsightInput} variants and computes date-range trends via the existing
 * `linearTrend` estimator — including the null-rate exclusion that keeps the
 * narrated trend identical to the one the pipeline produced (Correctness).
 *
 * @module components/insights/__tests__/buildInsightInput.test
 */

import { describe, expect, it } from 'vitest';

import type { NightlyAggregate } from '@/types/session';

import {
  buildGroundingCommon,
  buildDateRangeInput,
  buildSingleNightInput,
  computeDateRangeTrends,
  machineClassOf,
  type InsightSettingsSnapshot,
} from '../buildInsightInput';

const SETTINGS: InsightSettingsSnapshot = {
  ahi: { mildThreshold: 5, moderateThreshold: 15, severeThreshold: 30 },
  display: { dateFormat: 'YYYY-MM-DD', timeFormat: '24h' },
};

/** Build a minimal aggregate with the trended fields set. */
function agg(date: string, ahi: number | null, usage: number, leak: number): NightlyAggregate {
  return {
    date,
    ahi,
    usageHours: usage,
    leakMedian: leak,
  } as unknown as NightlyAggregate;
}

describe('buildGroundingCommon', () => {
  it('resolves the active thresholds and flags the default source', () => {
    const common = buildGroundingCommon(SETTINGS, 'APAP', new Date('2026-06-20T08:00:00'));
    expect(common.ahiThresholds).toEqual({ mild: 5, moderate: 15, severe: 30 });
    expect(common.ahiThresholdsSource).toBe('aasm-icsd3-default');
    expect(common.machineClass).toBe('APAP');
    expect(common.generatedOnDate).toBe('2026-06-20');
    // The display snapshot carries the fixed SI physiological units.
    expect(common.display.pressureUnit).toBe('cmH2O');
  });

  it('marks overridden thresholds as user-configured', () => {
    const common = buildGroundingCommon(
      { ...SETTINGS, ahi: { mildThreshold: 4, moderateThreshold: 15, severeThreshold: 30 } },
      'CPAP',
    );
    expect(common.ahiThresholdsSource).toBe('user-configured');
  });
});

describe('machineClassOf', () => {
  it('maps a therapy mode and falls back to unknown', () => {
    expect(machineClassOf('apap')).toBe('APAP');
    expect(machineClassOf(null)).toBe('unknown');
    expect(machineClassOf(undefined)).toBe('unknown');
  });
});

describe('computeDateRangeTrends', () => {
  it('computes a trend per metric over the defined nights', () => {
    const aggregates = [
      agg('2026-06-01', 6, 7, 10),
      agg('2026-06-02', 5, 7.2, 11),
      agg('2026-06-03', 4, 7.4, 12),
    ];
    const trends = computeDateRangeTrends(aggregates);
    const ahiTrend = trends.find((t) => t.metricId === 'ahi');
    expect(ahiTrend).toBeDefined();
    expect(ahiTrend?.n).toBe(3);
    // AHI is falling across the three nights → decreasing direction.
    expect(ahiTrend?.trend.trendDirection).toBe('decreasing');
  });

  it('excludes null-rate nights from the AHI series (never coerces to 0)', () => {
    const aggregates = [
      agg('2026-06-01', null, 7, 10),
      agg('2026-06-02', 5, 7, 11),
      agg('2026-06-03', 4, 7, 12),
    ];
    const trends = computeDateRangeTrends(aggregates);
    const ahiTrend = trends.find((t) => t.metricId === 'ahi');
    // Only the two defined nights contribute to the AHI trend.
    expect(ahiTrend?.n).toBe(2);
  });

  it('omits a metric with fewer than two defined nights', () => {
    const aggregates = [agg('2026-06-01', null, 7, 10), agg('2026-06-02', 5, 7, 11)];
    const trends = computeDateRangeTrends(aggregates);
    // AHI has only one defined night → no AHI trend; usage/leak have two.
    expect(trends.find((t) => t.metricId === 'ahi')).toBeUndefined();
    expect(trends.find((t) => t.metricId === 'usage')).toBeDefined();
  });
});

describe('builders produce the right discriminated variant', () => {
  it('single-night and date-range', () => {
    const common = buildGroundingCommon(SETTINGS, 'APAP');
    const night = buildSingleNightInput(agg('2026-06-20', 4.2, 7, 12), common);
    expect(night.kind).toBe('single-night');

    const range = buildDateRangeInput(
      [agg('2026-06-01', 6, 7, 10), agg('2026-06-02', 5, 7, 11)],
      common,
    );
    expect(range.kind).toBe('date-range');
    if (range.kind === 'date-range') {
      expect(range.aggregates).toHaveLength(2);
      expect(range.trends.length).toBeGreaterThan(0);
    }
  });
});
