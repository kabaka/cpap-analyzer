/**
 * Unit tests for LTTB and min-max downsampling algorithms.
 *
 * @module services/workers/__tests__/downsample.test
 */

import { describe, it, expect } from 'vitest';
import { lttbImpl, minMaxImpl } from '../downsample.worker';

// ── Helpers ──────────────────────────────────────────────────────

/** Build a Float32Array from a plain number array. */
function f32(values: number[]): Float32Array {
  return new Float32Array(values);
}

/** Generate a sine wave of `n` samples with given amplitude. */
function sineWave(n: number, amplitude = 1, periods = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * periods * i) / n);
  }
  return out;
}

// ── LTTB ─────────────────────────────────────────────────────────

describe('lttbImpl', () => {
  it('should return empty array for empty input', () => {
    const result = lttbImpl(f32([]), 10);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(0);
  });

  it('should return a copy when input is shorter than target', () => {
    const input = f32([1, 2, 3]);
    const result = lttbImpl(input, 10);
    expect(result.length).toBe(3);
    expect(Array.from(result)).toEqual([1, 2, 3]);
    // Must be a copy, not the same buffer
    expect(result.buffer).not.toBe(input.buffer);
  });

  it('should return a copy when input length equals target', () => {
    const input = f32([5, 10, 15, 20, 25]);
    const result = lttbImpl(input, 5);
    expect(result.length).toBe(5);
    expect(Array.from(result)).toEqual([5, 10, 15, 20, 25]);
  });

  it('should preserve first and last points', () => {
    const input = f32([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const result = lttbImpl(input, 4);
    expect(result[0]).toBe(10);
    expect(result[result.length - 1]).toBe(100);
  });

  it('should produce output of exactly target length', () => {
    const input = sineWave(1000);
    const target = 50;
    const result = lttbImpl(input, target);
    expect(result.length).toBe(target);
  });

  it('should preserve peak in a sine wave signal', () => {
    // Generate a single-period sine wave with clear peak at ~250
    const n = 1000;
    const input = sineWave(n, 10, 1);
    const result = lttbImpl(input, 20);

    // The peak value (~10) should be closely preserved in the output
    const maxOutput = Math.max(...Array.from(result));
    const maxInput = Math.max(...Array.from(input));
    expect(maxOutput).toBeCloseTo(maxInput, 0);
  });

  it('should preserve valley in a sine wave signal', () => {
    const n = 1000;
    const input = sineWave(n, 10, 1);
    const result = lttbImpl(input, 20);

    const minOutput = Math.min(...Array.from(result));
    const minInput = Math.min(...Array.from(input));
    expect(minOutput).toBeCloseTo(minInput, 0);
  });

  it('should handle single-element input', () => {
    const result = lttbImpl(f32([42]), 10);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(42);
  });

  it('should handle two-element input', () => {
    const result = lttbImpl(f32([1, 99]), 10);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(99);
  });

  it('should handle constant-value signal', () => {
    const input = f32(new Array(100).fill(5));
    const result = lttbImpl(input, 10);
    expect(result.length).toBe(10);
    // All values should be 5 since the input is constant
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(5);
    }
  });

  it('should clamp targetPoints to at least 2', () => {
    const input = f32([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = lttbImpl(input, 1);
    // Target is clamped to 2, but 10 <= 2 is false, so we get 2 points
    expect(result.length).toBe(2);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(10);
  });
});

// ── Min-max ──────────────────────────────────────────────────────

describe('minMaxImpl', () => {
  it('should return empty array for empty input', () => {
    const result = minMaxImpl(f32([]), 10);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(0);
  });

  it('should duplicate values when input is shorter than target', () => {
    const input = f32([3, 7, 5]);
    const result = minMaxImpl(input, 10);
    // len (3) <= target (10), so output = len * 2 = 6
    expect(result.length).toBe(6);
    // Each value appears as both min and max
    expect(result[0]).toBe(3); // min of first
    expect(result[1]).toBe(3); // max of first
    expect(result[2]).toBe(7);
    expect(result[3]).toBe(7);
    expect(result[4]).toBe(5);
    expect(result[5]).toBe(5);
  });

  it('should produce output length of targetPoints * 2', () => {
    const input = f32(new Array(1000).fill(0).map((_, i) => i));
    const target = 50;
    const result = minMaxImpl(input, target);
    expect(result.length).toBe(target * 2);
  });

  it('should preserve absolute minimum of signal', () => {
    const values = [10, 5, 20, 1, 15, 30, 8, 25, 3, 18, 12, 7, 22, 2, 28, 6, 19, 11, 24, 14];
    const input = f32(values);
    const result = minMaxImpl(input, 4);
    const allMins: number[] = [];
    for (let i = 0; i < result.length; i += 2) {
      allMins.push(result[i]!);
    }
    const globalMin = Math.min(...values);
    expect(Math.min(...allMins)).toBe(globalMin);
  });

  it('should preserve absolute maximum of signal', () => {
    const values = [10, 5, 20, 1, 15, 30, 8, 25, 3, 18, 12, 7, 22, 2, 28, 6, 19, 11, 24, 14];
    const input = f32(values);
    const result = minMaxImpl(input, 4);
    const allMaxes: number[] = [];
    for (let i = 1; i < result.length; i += 2) {
      allMaxes.push(result[i]!);
    }
    const globalMax = Math.max(...values);
    expect(Math.max(...allMaxes)).toBe(globalMax);
  });

  it('should have min <= max for each bucket', () => {
    const input = sineWave(500, 10, 5);
    const result = minMaxImpl(input, 25);
    for (let i = 0; i < result.length; i += 2) {
      expect(result[i]).toBeLessThanOrEqual(result[i + 1]!);
    }
  });

  it('should handle single-element input', () => {
    const result = minMaxImpl(f32([42]), 10);
    expect(result.length).toBe(2); // 1 * 2
    expect(result[0]).toBe(42);
    expect(result[1]).toBe(42);
  });

  it('should handle constant-value signal', () => {
    const input = f32(new Array(100).fill(7));
    const result = minMaxImpl(input, 10);
    expect(result.length).toBe(20);
    for (let i = 0; i < result.length; i += 2) {
      expect(result[i]).toBe(7); // min
      expect(result[i + 1]).toBe(7); // max
    }
  });

  it('should clamp targetPoints to at least 2', () => {
    const input = f32([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const result = minMaxImpl(input, 1);
    // Target clamped to 2, output = 2 * 2 = 4
    expect(result.length).toBe(4);
  });
});
