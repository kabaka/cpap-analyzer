import { describe, it, expect } from 'vitest';
import { buildAhiRawEnvelope, shouldEnvelopeAhiRaw } from '../envelope';

describe('shouldEnvelopeAhiRaw — gating', () => {
  it('engages only when nights strictly exceed pixel columns', () => {
    expect(shouldEnvelopeAhiRaw(500, 400)).toBe(true);
    expect(shouldEnvelopeAhiRaw(400, 400)).toBe(false); // equal → polyline
    expect(shouldEnvelopeAhiRaw(100, 400)).toBe(false);
  });

  it('is false for degenerate column counts', () => {
    expect(shouldEnvelopeAhiRaw(1000, 0)).toBe(false);
    expect(shouldEnvelopeAhiRaw(1000, Number.NaN)).toBe(false);
  });
});

describe('buildAhiRawEnvelope — min/max per column with null gaps', () => {
  it('captures the spike as a column max (a polyline could hide it)', () => {
    // 8 nights into 2 columns: col0 = nights 0-3, col1 = nights 4-7.
    const values = [1, 2, 50, 1, 1, 1, 1, 1]; // spike of 50 in col0.
    const env = buildAhiRawEnvelope(values, 2);
    expect(env.columns).toBe(2);
    expect(env.max[0]).toBe(50); // spike reaches the column max
    expect(env.min[0]).toBe(1);
    expect(env.max[1]).toBe(1);
  });

  it('keeps null nights as GAPS (never 0)', () => {
    // A column whose nights are all null becomes a NaN gap.
    const values = [null, null, 5, 6];
    const env = buildAhiRawEnvelope(values, 2);
    expect(Number.isNaN(env.min[0] as number)).toBe(true);
    expect(Number.isNaN(env.max[0] as number)).toBe(true);
    expect(env.max[1]).toBe(6);
    expect(env.min[1]).toBe(5);
  });

  it('ignores nulls within a column but keeps real extrema', () => {
    const values = [null, 3, 9, null];
    const env = buildAhiRawEnvelope(values, 1);
    expect(env.min[0]).toBe(3);
    expect(env.max[0]).toBe(9);
  });
});
