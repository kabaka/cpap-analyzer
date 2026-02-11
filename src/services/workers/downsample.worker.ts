/**
 * Comlink-wrapped Web Worker for signal downsampling algorithms.
 *
 * Provides LTTB (Largest Triangle Three Buckets) and min-max
 * downsampling for rendering high-frequency time-series data at
 * screen resolution without losing visual fidelity.
 *
 * @module services/workers/downsample.worker
 */

import * as Comlink from 'comlink';

// ── Public API type ──────────────────────────────────────────────

/** Methods exposed by the downsample worker via Comlink. */
export interface DownsampleWorkerAPI {
  /**
   * LTTB (Largest Triangle Three Buckets) downsampling.
   *
   * Reduces an evenly-spaced signal to `targetPoints` representative
   * samples while preserving visual shape. Index mapping is implicit:
   * output index maps proportionally to the input range.
   *
   * @param data         - Input signal values (evenly spaced y-values).
   * @param targetPoints - Desired number of output points.
   * @returns Downsampled y-values as a transferable Float32Array.
   */
  lttb(data: Float32Array, targetPoints: number): Float32Array;

  /**
   * Min-max downsampling that preserves peaks and valleys.
   *
   * Divides the input into `targetPoints` buckets and outputs the min
   * and max of each bucket interleaved: [min₀, max₀, min₁, max₁, …].
   * Returned array length is `targetPoints * 2`.
   *
   * @param data         - Input signal values (evenly spaced y-values).
   * @param targetPoints - Number of buckets (output length = targetPoints × 2).
   * @returns Interleaved min/max values as a transferable Float32Array.
   */
  minMax(data: Float32Array, targetPoints: number): Float32Array;
}

// ── Algorithm implementations ────────────────────────────────────

/**
 * LTTB downsampling (Largest Triangle Three Buckets).
 *
 * For each bucket (except first and last), selects the point that
 * forms the largest triangle area with the previously selected point
 * and the average point of the next bucket.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation" (2013).
 */
export function lttbImpl(data: Float32Array, targetPoints: number): Float32Array {
  const len = data.length;

  if (len === 0) return new Float32Array(0);

  // Clamp target to at least 2
  const target = Math.max(2, targetPoints);

  if (len <= target) {
    // Return a copy so the caller can transfer without aliasing issues
    const copy = new Float32Array(len);
    copy.set(data);
    return copy;
  }

  const result = new Float32Array(target);

  // Always keep first and last points
  result[0] = data[0] ?? 0;
  result[target - 1] = data[len - 1] ?? 0;

  // Bucket size (excluding the first and last single-point buckets)
  const bucketSize = (len - 2) / (target - 2);

  let prevSelectedIndex = 0;

  for (let bucket = 1; bucket < target - 1; bucket++) {
    // Current bucket boundaries
    const bucketStart = Math.floor((bucket - 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor(bucket * bucketSize) + 1, len);

    // Next bucket boundaries (for computing average point)
    const nextBucketStart = Math.floor(bucket * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, len);

    // Average of next bucket (x = average index, y = average value)
    let avgX = 0;
    let avgY = 0;
    const nextBucketLen = nextBucketEnd - nextBucketStart;

    for (let i = nextBucketStart; i < nextBucketEnd; i++) {
      avgX += i;
      avgY += data[i] ?? 0;
    }

    if (nextBucketLen > 0) {
      avgX /= nextBucketLen;
      avgY /= nextBucketLen;
    }

    // Find the point in the current bucket that maximises the triangle area
    const prevX = prevSelectedIndex;
    const prevY = data[prevSelectedIndex] ?? 0;
    let maxArea = -1;
    let bestIndex = bucketStart;

    for (let i = bucketStart; i < bucketEnd; i++) {
      // Triangle area = 0.5 * |x_a(y_b - y_c) + x_b(y_c - y_a) + x_c(y_a - y_b)|
      // Simplified (factor of 0.5 doesn't affect comparison):
      const area = Math.abs(
        (prevX - avgX) * ((data[i] ?? 0) - prevY) - (prevX - i) * (avgY - prevY),
      );

      if (area > maxArea) {
        maxArea = area;
        bestIndex = i;
      }
    }

    result[bucket] = data[bestIndex] ?? 0;
    prevSelectedIndex = bestIndex;
  }

  return result;
}

/**
 * Min-max downsampling preserving peaks and valleys.
 *
 * Divides the input into `targetPoints` equal-sized buckets
 * and outputs the minimum and maximum of each, interleaved.
 */
export function minMaxImpl(data: Float32Array, targetPoints: number): Float32Array {
  const len = data.length;

  if (len === 0) return new Float32Array(0);

  // Clamp target to at least 2
  const target = Math.max(2, targetPoints);

  if (len <= target) {
    // When data is already small enough, duplicate each value as both min and max
    const result = new Float32Array(len * 2);
    for (let i = 0; i < len; i++) {
      result[i * 2] = data[i] ?? 0;
      result[i * 2 + 1] = data[i] ?? 0;
    }
    return result;
  }

  const result = new Float32Array(target * 2);
  const bucketSize = len / target;

  for (let bucket = 0; bucket < target; bucket++) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(Math.floor((bucket + 1) * bucketSize), len);

    let min = Infinity;
    let max = -Infinity;

    for (let i = start; i < end; i++) {
      const v = data[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    result[bucket * 2] = min;
    result[bucket * 2 + 1] = max;
  }

  return result;
}

// ── Worker API object ────────────────────────────────────────────

const workerAPI: DownsampleWorkerAPI = {
  lttb(data: Float32Array, targetPoints: number): Float32Array {
    const result = lttbImpl(data, targetPoints);
    return Comlink.transfer(result, [result.buffer]);
  },

  minMax(data: Float32Array, targetPoints: number): Float32Array {
    const result = minMaxImpl(data, targetPoints);
    return Comlink.transfer(result, [result.buffer]);
  },
};

Comlink.expose(workerAPI);
