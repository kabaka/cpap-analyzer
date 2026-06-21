/**
 * Tests for the grounded-context builders (design reference §1, §2, §5 vectors).
 *
 * Covers: a known aggregate → asserted snapshot shape (strings not numbers,
 * redaction holds), the null-rate-not-zero case (`availability:'undefined-rate'`,
 * never coerced to 0), the active-threshold case (severity band uses the user's
 * configured thresholds, not defaults), and the mechanically-built
 * `numericAllowList`.
 *
 * @module services/llm/context/__tests__/buildGroundedContext.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildSingleNightContext,
  buildClinicalContext,
  buildDateRangeContext,
  machineClassFromType,
} from '../buildGroundedContext';
import { linearTrend } from '@/analysis/timeseries';
import { COMMON, makeAggregate } from './fixtures';

describe('buildSingleNightContext', () => {
  it('serializes every metric value as a string at display precision (never a number)', () => {
    const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });
    for (const m of ctx.metrics) {
      if (m.availability === 'present') {
        expect(typeof m.displayValue).toBe('string');
      } else {
        expect(m.displayValue).toBeNull();
      }
    }
    // AHI 4.2 renders at 1 dp.
    const ahi = ctx.metrics.find((m) => m.id === 'ahi');
    expect(ahi?.displayValue).toBe('4.2');
    expect(ahi?.unit).toBe('events/h');
  });

  it('carries reliability tier, flags, and an availability discriminator per metric', () => {
    const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });
    const usage = ctx.metrics.find((m) => m.id === 'usageHours');
    expect(usage?.reliabilityTier).toBe('high');
    expect(usage?.availability).toBe('present');
  });

  it('marks an absent oximetry channel as unavailable, not zero', () => {
    const ctx = buildSingleNightContext({
      ...COMMON,
      aggregate: makeAggregate({
        spo2Mean: null,
        spo2Median: null,
        spo2Min: null,
        spo2Below90Percent: null,
        spo2CoveragePercent: null,
        oxygenDesaturationIndex: null,
      }),
    });
    const spo2 = ctx.metrics.find((m) => m.id === 'spo2Mean');
    expect(spo2?.availability).toBe('unavailable');
    expect(spo2?.displayValue).toBeNull();
  });

  it('NULL-RATE-NOT-ZERO: a below-floor AHI is undefined-rate with a null value, never 0', () => {
    const ctx = buildSingleNightContext({
      ...COMMON,
      // usage below MIN_INDEX_USAGE_HOURS → aggregate carries null per-hour rates.
      aggregate: makeAggregate({ ahi: null, ahiObstructive: null, ahiHypopnea: null, rdi: null }),
    });
    const ahi = ctx.metrics.find((m) => m.id === 'ahi');
    expect(ahi?.availability).toBe('undefined-rate');
    expect(ahi?.displayValue).toBeNull();
    // The string "0" must NOT have been substituted anywhere for the null rate.
    expect(ctx.numericAllowList).not.toContain('0');
    expect(ctx.scope.nightsWithDefinedRate).toBe(0);
  });

  it('builds the numericAllowList mechanically from present display values', () => {
    const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });
    expect(ctx.numericAllowList).toContain('4.2'); // AHI
    expect(ctx.numericAllowList).toContain('9.2'); // median pressure
    expect(ctx.numericAllowList).toContain('5'); // active mild threshold
    expect(ctx.numericAllowList).toContain('4'); // CMS hours
    expect(ctx.numericAllowList).toContain('6'); // recommended hours
    // Every present metric's displayValue is in the allow-list.
    for (const m of ctx.metrics) {
      if (m.availability === 'present' && m.displayValue && /\d/.test(m.displayValue)) {
        expect(ctx.numericAllowList).toContain(m.displayValue);
      }
    }
  });

  it('redaction holds: no serial, no notes, no tags, no clock time in the serialized payload', () => {
    const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('SERIAL-DO-NOT-LEAK');
    expect(json).not.toContain('SECRET PATIENT NOTE');
    expect(json).not.toContain('private-tag');
    // No UUIDs.
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/i);
    // generatedOnDate is a calendar date, not a datetime.
    expect(ctx.generatedOnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('buildClinicalContext — active thresholds', () => {
  it('ACTIVE-THRESHOLD: severity band uses the user-configured thresholds, not the defaults', () => {
    // AHI 4.2 is "normal" under defaults (mild=5) but "mild" if the user lowered
    // the mild cutoff to 3.
    const ctxDefault = buildClinicalContext({ ...COMMON, aggregate: makeAggregate() });
    expect(bandOf(ctxDefault)).toBe('normal');

    const ctxCustom = buildClinicalContext({
      ...COMMON,
      ahiThresholds: { mild: 3, moderate: 10, severe: 20 },
      ahiThresholdsSource: 'user-configured',
      aggregate: makeAggregate(),
    });
    expect(bandOf(ctxCustom)).toBe('mild');
    expect(ctxCustom.clinical.ahiThresholds.mild).toBe(3);
    expect(ctxCustom.clinical.ahiThresholdsSource).toBe('user-configured');
    // The custom thresholds are the quotable numerals, not the AASM 5/15/30.
    expect(ctxCustom.numericAllowList).toContain('3');
    expect(ctxCustom.numericAllowList).toContain('10');
    expect(ctxCustom.numericAllowList).toContain('20');
  });

  it('carries the compliance verdict as a categorical displayValue', () => {
    const ctx = buildClinicalContext({
      ...COMMON,
      aggregate: makeAggregate({ complianceStatus: 'non-compliant' }),
    });
    const compliance = ctx.metrics.find((m) => m.id === 'complianceStatus');
    expect(compliance?.displayValue).toBe('non-compliant');
  });
});

describe('buildDateRangeContext', () => {
  it('phrases a computed trend with its inseparable statistical qualifier', () => {
    const dates = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];
    const values = [12, 10, 9, 7, 5];
    const trend = linearTrend(dates, values);
    const aggregates = dates.map((d, i) => makeAggregate({ date: d, ahi: values[i] ?? null }));
    const ctx = buildDateRangeContext({
      ...COMMON,
      aggregates,
      trends: [{ metricId: 'ahi', label: 'AHI', slopeUnit: 'events/h per day', trend, n: 5 }],
    });
    expect(ctx.trends).toHaveLength(1);
    const t = ctx.trends[0];
    expect(t?.qualifier).toMatch(/trend/i);
    expect(t?.n).toBe(5);
    expect(ctx.scope.nightCount).toBe(5);
    expect(ctx.scope.nightsWithDefinedRate).toBe(5);
  });

  it('excludes null-rate nights from nightsWithDefinedRate but keeps the night count', () => {
    const aggregates = [
      makeAggregate({ date: '2026-06-01', ahi: 5.0 }),
      makeAggregate({ date: '2026-06-02', ahi: null }),
      makeAggregate({ date: '2026-06-03', ahi: 6.0 }),
    ];
    const ctx = buildDateRangeContext({ ...COMMON, aggregates, trends: [] });
    expect(ctx.scope.nightCount).toBe(3);
    expect(ctx.scope.nightsWithDefinedRate).toBe(2);
  });
});

describe('machineClassFromType', () => {
  it('maps internal therapy modes to the coarse egress-safe class', () => {
    expect(machineClassFromType('cpap')).toBe('CPAP');
    expect(machineClassFromType('apap')).toBe('APAP');
    expect(machineClassFromType('bipap')).toBe('BiPAP');
    expect(machineClassFromType('vpap')).toBe('VPAP');
    expect(machineClassFromType('asv')).toBe('ASV');
  });
});

describe('property: every present numeric metric value is in the numericAllowList', () => {
  it('holds across random plausible aggregates', () => {
    fc.assert(
      fc.property(
        fc.record({
          ahi: fc.double({ min: 0, max: 80, noNaN: true }),
          leakMedian: fc.double({ min: 0, max: 50, noNaN: true }),
          pressureMedian: fc.double({ min: 4, max: 20, noNaN: true }),
          usageHours: fc.double({ min: 1, max: 12, noNaN: true }),
        }),
        (fields) => {
          const ctx = buildSingleNightContext({
            ...COMMON,
            aggregate: makeAggregate(fields),
          });
          const allow = new Set(ctx.numericAllowList);
          for (const m of ctx.metrics) {
            if (m.availability === 'present' && m.displayValue && /\d/.test(m.displayValue)) {
              expect(allow.has(m.displayValue)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

function bandOf(ctx: ReturnType<typeof buildClinicalContext>): string | null {
  return ctx.metrics.find((m) => m.id === 'severityBand')?.displayValue ?? null;
}
