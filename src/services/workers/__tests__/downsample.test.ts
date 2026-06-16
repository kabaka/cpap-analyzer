/**
 * Unit tests for LTTB and min-max downsampling algorithms.
 *
 * @module services/workers/__tests__/downsample.test
 */

import { describe, it, expect } from 'vitest';
import {
  lttbImpl,
  lttbInto,
  lttbOutLength,
  minMaxImpl,
  columnEnvelopeInto,
} from '../downsample.worker';

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

// ── LTTB out-parameter variant (allocation-free hot path) ────────
//
// `lttbInto` is the render-hot-path twin of `lttbImpl`: it writes into a
// caller-owned scratch buffer instead of allocating a fresh Float32Array per
// call. Two invariants must hold for the SignalViewer optimisation to be both
// correct and worthwhile:
//   1. CORRECTNESS — its output is element-for-element identical to
//      `lttbImpl(data, target)` for the same inputs (byte-identical bits, since
//      both write Float32 values produced by identical arithmetic).
//   2. ALLOCATION — in steady state (buffer already sized) it allocates ~zero:
//      it returns a `subarray` VIEW over the SAME backing buffer it was handed,
//      so no new ArrayBuffer is created per frame.
//
// `lttbOutLength` reports the exact write length so callers can size the buffer
// once and never hit the correctness-preserving fallback allocation.

describe('lttbInto', () => {
  /** Largest-triangle sized buffer for `(dataLen, target)`. */
  function scratchFor(dataLength: number, target: number): Float32Array {
    return new Float32Array(lttbOutLength(dataLength, target));
  }

  it('lttbOutLength matches the actual lttbImpl output length across regimes', () => {
    // Denser-than-target: writes exactly `target`.
    expect(lttbOutLength(1000, 50)).toBe(50);
    expect(lttbImpl(sineWave(1000), 50).length).toBe(50);
    // Already-small (len <= target): writes `len`.
    expect(lttbOutLength(3, 10)).toBe(3);
    expect(lttbImpl(f32([1, 2, 3]), 10).length).toBe(3);
    // Empty.
    expect(lttbOutLength(0, 10)).toBe(0);
    // Target clamped to >= 2.
    expect(lttbOutLength(1000, 1)).toBe(2);
  });

  it('produces output element-for-element identical to lttbImpl (downsampling regime)', () => {
    // Multiple shapes/sizes so the byte-identity claim is not a single-case fluke.
    const cases: { data: Float32Array; target: number }[] = [
      { data: sineWave(1000, 10, 1), target: 50 },
      { data: sineWave(1000, 10, 5), target: 20 },
      { data: sineWave(720_000, 30, 240), target: 2400 }, // full-night × prod budget
      { data: f32(Array.from({ length: 333 }, (_, i) => Math.sin(i) * 7 + (i % 11))), target: 64 },
      { data: f32(new Array(100).fill(5)), target: 10 }, // constant signal
    ];
    for (const { data, target } of cases) {
      const expected = lttbImpl(data, target);
      const out = scratchFor(data.length, target);
      const got = lttbInto(data, target, out);
      expect(got.length).toBe(expected.length);
      // Element-for-element equality (raw float bits): no tolerance — the two
      // code paths run identical arithmetic in identical order.
      expect(Array.from(got)).toEqual(Array.from(expected));
      // The returned view aliases the caller's buffer (no fresh allocation).
      expect(got.buffer).toBe(out.buffer);
    }
  });

  it('matches lttbImpl in the already-small (len <= target) copy-through regime', () => {
    const data = f32([5, 10, 15, 20, 25]);
    const out = scratchFor(data.length, 10);
    const got = lttbInto(data, 10, out);
    expect(Array.from(got)).toEqual(Array.from(lttbImpl(data, 10)));
    expect(got.length).toBe(5);
    expect(got.buffer).toBe(out.buffer); // view over caller buffer
  });

  it('returns a zero-length view (no allocation) for empty input', () => {
    const out = new Float32Array(8);
    const got = lttbInto(f32([]), 10, out);
    expect(got.length).toBe(0);
    expect(got.buffer).toBe(out.buffer);
  });

  it('allocates ~ZERO in steady state: repeated frames reuse one backing buffer', () => {
    // Simulate a sustained drag: same viewport-sized slice re-downsampled every
    // frame into a pre-sized, REUSED scratch buffer (the double-buffer pattern in
    // SignalViewer alternates two of these; here we prove a single reused buffer
    // never allocates a new ArrayBuffer).
    const data = sineWave(120_000, 25, 60);
    const target = 2400;
    const scratch = scratchFor(data.length, target);
    const baselineBuffer = scratch.buffer;

    const FRAMES = 300; // a few seconds of dragging at 60 fps
    const seenBuffers = new Set<ArrayBufferLike>();
    for (let frame = 0; frame < FRAMES; frame++) {
      const view = lttbInto(data, target, scratch);
      seenBuffers.add(view.buffer);
      expect(view.length).toBe(target);
    }
    // Across 300 frames, exactly ONE backing buffer was ever used — the one the
    // caller supplied. The previous (allocating) path created 300 fresh
    // Float32Arrays (~2400 × 4 B = 9.6 KB each ⇒ ~2.8 MB of garbage here).
    expect(seenBuffers.size).toBe(1);
    expect([...seenBuffers][0]).toBe(baselineBuffer);
  });

  it('falls back to a fresh allocation (still correct) when out is too small', () => {
    const data = sineWave(1000, 10, 1);
    const target = 50;
    const tooSmall = new Float32Array(10); // < target
    const got = lttbInto(data, target, tooSmall);
    // Correctness preserved via lttbImpl fallback...
    expect(Array.from(got)).toEqual(Array.from(lttbImpl(data, target)));
    // ...at the cost of a fresh buffer (not the caller's) — the documented escape
    // hatch. SignalViewer sizes via lttbOutLength so it never hits this path.
    expect(got.buffer).not.toBe(tooSmall.buffer);
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

// ── columnEnvelopeInto (per-x-pixel MIN/MAX envelope) ─────────────
//
// This is the pure core of the zoomed-out fidelity envelope: for each output
// column it must report the TRUE min/max of the source samples mapping there, so
// a 1-sample spike or notch can never be hidden. NaN columns must break (gap).

describe('columnEnvelopeInto', () => {
  /** Fresh column buffers of a given size. */
  function buffers(cols: number): { min: Float32Array; max: Float32Array } {
    return { min: new Float32Array(cols), max: new Float32Array(cols) };
  }

  it('returns one column with the slice min/max when columns === 1', () => {
    const data = f32([3, 1, 9, 4, 2]);
    const { min, max } = buffers(1);
    const env = columnEnvelopeInto(data, 1, min, max);
    expect(env.columns).toBe(1);
    expect(min[0]).toBe(1);
    expect(max[0]).toBe(9);
  });

  it('partitions samples into the correct columns and reports per-column extrema', () => {
    // 8 samples, 4 columns → 2 samples per column.
    const data = f32([0, 5, 10, 2, -3, 7, 4, 4]);
    const { min, max } = buffers(4);
    const env = columnEnvelopeInto(data, 4, min, max);
    expect(env.columns).toBe(4);
    // col0: [0,5] col1: [10,2] col2: [-3,7] col3: [4,4]
    expect([min[0], max[0]]).toEqual([0, 5]);
    expect([min[1], max[1]]).toEqual([2, 10]);
    expect([min[2], max[2]]).toEqual([-3, 7]);
    expect([min[3], max[3]]).toEqual([4, 4]);
  });

  it('NEVER hides a 1-sample spike: the spike reaches its column max', () => {
    // 100 samples of a calm baseline with a single extreme spike at index 37.
    const n = 100;
    const data = new Float32Array(n).fill(1);
    data[37] = 999; // spike
    data[60] = -999; // notch
    const cols = 10; // 10 samples/column
    const { min, max } = buffers(cols);
    columnEnvelopeInto(data, cols, min, max);
    // index 37 → column floor(37/100*10)=3; index 60 → column 6.
    expect(max[3]).toBe(999);
    expect(min[6]).toBe(-999);
    // Other columns keep the baseline (no fabricated extremes).
    expect(max[0]).toBe(1);
    expect(min[0]).toBe(1);
  });

  it('marks a wholly-NaN column as a gap (min===max===NaN) and breaks there', () => {
    // 6 samples, 3 columns (2/col). Middle column is all NaN.
    const data = f32([1, 2, NaN, NaN, 3, 4]);
    const { min, max } = buffers(3);
    const env = columnEnvelopeInto(data, 3, min, max);
    expect(env.columns).toBe(3);
    expect([min[0], max[0]]).toEqual([1, 2]);
    expect(Number.isNaN(min[1] as number)).toBe(true);
    expect(Number.isNaN(max[1] as number)).toBe(true);
    expect([min[2], max[2]]).toEqual([3, 4]);
  });

  it('uses only the non-NaN extrema for a partially-NaN column', () => {
    const data = f32([NaN, 5, NaN, -2]); // 4 samples, 2 cols
    const { min, max } = buffers(2);
    columnEnvelopeInto(data, 2, min, max);
    // col0: [NaN,5] → [5,5]; col1: [NaN,-2] → [-2,-2]
    expect([min[0], max[0]]).toEqual([5, 5]);
    expect([min[1], max[1]]).toEqual([-2, -2]);
  });

  it('marks empty columns as NaN when the source is sparser than the column count', () => {
    // 2 samples, 5 columns → samples land in cols 0 and 2 (floor(1/2*5)=2);
    // columns 1, 3, 4 are empty → NaN breaks.
    const data = f32([10, 20]);
    const { min, max } = buffers(5);
    const env = columnEnvelopeInto(data, 5, min, max);
    expect(env.columns).toBe(5);
    expect([min[0], max[0]]).toEqual([10, 10]);
    expect(Number.isNaN(min[1] as number)).toBe(true);
    expect([min[2], max[2]]).toEqual([20, 20]);
    expect(Number.isNaN(min[3] as number)).toBe(true);
    expect(Number.isNaN(min[4] as number)).toBe(true);
  });

  it('fills all columns with NaN for an empty source', () => {
    const { min, max } = buffers(3);
    const env = columnEnvelopeInto(f32([]), 3, min, max);
    expect(env.columns).toBe(3);
    for (let c = 0; c < 3; c++) {
      expect(Number.isNaN(min[c] as number)).toBe(true);
      expect(Number.isNaN(max[c] as number)).toBe(true);
    }
  });

  it('clamps the requested columns to the smaller buffer length', () => {
    const data = f32([1, 2, 3, 4]);
    const min = new Float32Array(2);
    const max = new Float32Array(2);
    const env = columnEnvelopeInto(data, 4, min, max);
    expect(env.columns).toBe(2);
  });
});
