/**
 * Tests for the egress redaction guard (design reference §3, R1–R8).
 *
 * Asserts the guard rejects each forbidden class — raw signal arrays, sub-night
 * event timestamps, clock times, serials/firmware/UUIDs, notes/tags, location
 * coordinates, keys/tokens, and full-precision numerics — and accepts a
 * well-formed snapshot.
 *
 * @module services/llm/context/__tests__/redaction.test
 */

import { describe, it, expect } from 'vitest';
import { assertNoForbiddenFields, RedactionError } from '../redaction';
import { buildSingleNightContext } from '../buildGroundedContext';
import { COMMON, makeAggregate } from './fixtures';

function ruleFor(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof RedactionError) return e.rule;
    throw e;
  }
  throw new Error('expected a RedactionError but none was thrown');
}

describe('assertNoForbiddenFields', () => {
  it('accepts a well-formed grounded context built by the builder', () => {
    const ctx = buildSingleNightContext({ ...COMMON, aggregate: makeAggregate() });
    expect(() => assertNoForbiddenFields(ctx)).not.toThrow();
  });

  it('R1: rejects a raw numeric signal array', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ samples: [1, 2, 3, 4] }))).toBe('R1-raw-signal');
    expect(ruleFor(() => assertNoForbiddenFields({ signalChunkIds: ['c1', 'c2'] }))).toBe(
      'R1-raw-signal',
    );
  });

  it('R2: rejects within-night event timestamps', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ events: [{ type: 'apnea' }] }))).toBe(
      'R2-subnight-timestamp',
    );
    expect(ruleFor(() => assertNoForbiddenFields({ timestamp: 'x' }))).toBe(
      'R2-subnight-timestamp',
    );
  });

  it('R3: rejects clock times (datetime, bare clock, and date fields with a time)', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ startTime: '2026-06-20T23:45:00Z' }))).toBe(
      'R3-clock-time',
    );
    expect(ruleFor(() => assertNoForbiddenFields({ bedtime: '23:45' }))).toBe('R3-clock-time');
    expect(ruleFor(() => assertNoForbiddenFields({ date: '2026-06-20T23:45:00' }))).toBe(
      'R3-clock-time',
    );
  });

  it('R4: rejects device identifiers and UUID-shaped values', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ machineId: 'SERIAL123' }))).toBe('R4-device-id');
    expect(ruleFor(() => assertNoForbiddenFields({ firmwareVersion: '3.0.2' }))).toBe(
      'R4-device-id',
    );
    expect(
      ruleFor(() => assertNoForbiddenFields({ ref: '11111111-1111-4111-8111-111111111111' })),
    ).toBe('R4-device-id');
  });

  it('R5: rejects free-text notes and tags', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ notes: 'secret' }))).toBe('R5-free-text');
    expect(ruleFor(() => assertNoForbiddenFields({ tags: ['a'] }))).toBe('R5-free-text');
  });

  it('R6: rejects location coordinates', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ latitude: 40.71 }))).toBe('R6-location');
    expect(ruleFor(() => assertNoForbiddenFields({ longitude: -74.0 }))).toBe('R6-location');
  });

  it('R7: rejects integration keys and tokens', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ apiKey: 'sk-123' }))).toBe('R7-integration-id');
    expect(ruleFor(() => assertNoForbiddenFields({ accessToken: 't' }))).toBe('R7-integration-id');
  });

  it('R8: rejects a raw number where a display string is required', () => {
    expect(ruleFor(() => assertNoForbiddenFields({ metrics: [{ displayValue: 12.43 }] }))).toBe(
      'R8-full-precision-numeric',
    );
    expect(ruleFor(() => assertNoForbiddenFields({ metrics: [{ x: NaN }] }))).toBe(
      'R8-full-precision-numeric',
    );
  });

  it('allows the contract-defined numeric fields (thresholds, hour constants, counts)', () => {
    expect(() =>
      assertNoForbiddenFields({
        schemaVersion: 1,
        scope: { nightCount: 14, nightsWithDefinedRate: 12 },
        clinical: {
          ahiThresholds: { mild: 5, moderate: 15, severe: 30 },
          cmsComplianceHours: 4,
          recommendedUsageHours: 6,
        },
        trends: [{ n: 14 }],
      }),
    ).not.toThrow();
  });
});
