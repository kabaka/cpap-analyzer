/**
 * Tests for the deterministic template fallback (design reference §5).
 *
 * The fallback must read well AND contain only allow-listed numbers — verified
 * here by feeding its own output back through the validator, which must pass.
 *
 * @module services/llm/grounding/__tests__/templateFallback.test
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { renderTemplateFallback } from '../templateFallback';
import { validateNarrative, extractNumerals } from '../validateNarrative';
import {
  buildSingleNightContext,
  buildClinicalContext,
  buildDateRangeContext,
} from '../../context/buildGroundedContext';
import { linearTrend } from '@/analysis/timeseries';
import { COMMON, makeAggregate } from '../../context/__tests__/fixtures';
import type { GroundedContext } from '../../context/types';

/** Mirror the validator's allowed set: allow-list + safe literals + scope counts + label numerals. */
function allowSetFor(ctx: GroundedContext): Set<string> {
  const labelNums = ctx.metrics.flatMap((m) => extractNumerals(m.label));
  return new Set([
    ...ctx.numericAllowList,
    ...Array.from({ length: 11 }, (_, i) => String(i)),
    String(ctx.scope.nightCount),
    String(ctx.scope.nightsWithDefinedRate),
    ...labelNums,
  ]);
}

describe('renderTemplateFallback', () => {
  it('TEMPLATE-FALLBACK-SAFE: every number in the single-night fallback is allow-listed', () => {
    const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });
    const text = renderTemplateFallback(ctx);
    const allow = allowSetFor(ctx);
    for (const token of extractNumerals(text)) {
      expect(allow.has(token)).toBe(true);
    }
  });

  it('its own output passes the validator (no fabricated numerals, no missing hedge)', () => {
    const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });
    const text = renderTemplateFallback(ctx);
    const res = validateNarrative(text, ctx);
    expect(res.ok).toBe(true);
  });

  it('describes a null-rate metric as undefined, never as zero', () => {
    const ctx = buildSingleNightContext({
      ...COMMON,
      aggregate: makeAggregate({ ahi: null, ahiObstructive: null, rdi: null }),
    });
    const text = renderTemplateFallback(ctx);
    expect(text).toContain('too short to compute a reliable per-hour rate');
    // The AHI line must not assert a 0 value.
    expect(text).not.toMatch(/AHI: 0(\.0)? events\/h/);
  });

  it('clinical-context fallback states the band using the active thresholds and passes validation', () => {
    const ctx = buildClinicalContext({
      ...COMMON,
      ahiThresholds: { mild: 3, moderate: 10, severe: 20 },
      ahiThresholdsSource: 'user-configured',
      aggregate: makeAggregate(), // AHI 4.2 → 'mild' under these thresholds
    });
    const text = renderTemplateFallback(ctx);
    expect(text).toContain('mild');
    expect(validateNarrative(text, ctx).ok).toBe(true);
  });

  it('date-range fallback renders trends with their qualifiers and passes validation', () => {
    const dates = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];
    const values = [12, 10, 9, 7, 5];
    const trend = linearTrend(dates, values);
    const aggregates = dates.map((d, i) => makeAggregate({ date: d, ahi: values[i] ?? null }));
    const ctx = buildDateRangeContext({
      ...COMMON,
      aggregates,
      trends: [{ metricId: 'ahi', label: 'AHI', slopeUnit: 'events/h per day', trend, n: 5 }],
    });
    const text = renderTemplateFallback(ctx);
    expect(text).toMatch(/AHI/);
    expect(validateNarrative(text, ctx).ok).toBe(true);
  });

  it('property: the single-night fallback never emits an un-allow-listed number', () => {
    fc.assert(
      fc.property(
        fc.record({
          ahi: fc.option(fc.double({ min: 0, max: 90, noNaN: true }), { nil: null }),
          leakMedian: fc.double({ min: 0, max: 50, noNaN: true }),
          pressureMedian: fc.double({ min: 4, max: 20, noNaN: true }),
          usageHours: fc.double({ min: 0.1, max: 12, noNaN: true }),
        }),
        (fields) => {
          const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate(fields) });
          const text = renderTemplateFallback(ctx);
          const allow = allowSetFor(ctx);
          for (const token of extractNumerals(text)) {
            expect(allow.has(token)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
