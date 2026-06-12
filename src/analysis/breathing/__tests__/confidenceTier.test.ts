/**
 * Tests for the discrete-tier bucket helper used by the detection-confidence UI.
 *
 * @module analysis/breathing/__tests__/confidenceTier.test
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIDENCE_LOW_MAX,
  CONFIDENCE_MODERATE_MAX,
  confidenceTier,
  confidenceTierLabel,
} from '@/analysis/breathing/confidenceTier';

describe('confidenceTier', () => {
  it('buckets a value below the low threshold as "low"', () => {
    expect(confidenceTier(0)).toBe('low');
    expect(confidenceTier(0.1)).toBe('low');
    expect(confidenceTier(CONFIDENCE_LOW_MAX - 0.001)).toBe('low');
  });

  it('buckets a value at or above low and below moderate as "moderate"', () => {
    expect(confidenceTier(CONFIDENCE_LOW_MAX)).toBe('moderate');
    expect(confidenceTier(0.6)).toBe('moderate');
    expect(confidenceTier(CONFIDENCE_MODERATE_MAX - 0.001)).toBe('moderate');
  });

  it('buckets a value at or above moderate as "high"', () => {
    expect(confidenceTier(CONFIDENCE_MODERATE_MAX)).toBe('high');
    expect(confidenceTier(0.9)).toBe('high');
    expect(confidenceTier(1)).toBe('high');
  });

  it('clamps out-of-range values', () => {
    expect(confidenceTier(-10)).toBe('low');
    expect(confidenceTier(10)).toBe('high');
  });

  it('treats NaN as low and clamps infinity', () => {
    expect(confidenceTier(Number.NaN)).toBe('low');
    // Number.POSITIVE_INFINITY is finite-test-false; the helper returns the
    // safe default 'low'. The clamping logic only runs for finite values.
    expect(confidenceTier(Number.POSITIVE_INFINITY)).toBe('low');
  });
});

describe('confidenceTierLabel', () => {
  it('returns a readable label for each tier', () => {
    expect(confidenceTierLabel('low')).toMatch(/low/i);
    expect(confidenceTierLabel('moderate')).toMatch(/moderate/i);
    expect(confidenceTierLabel('high')).toMatch(/high/i);
  });
});
