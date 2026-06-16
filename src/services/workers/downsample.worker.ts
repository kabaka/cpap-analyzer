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
 * Out-parameter variant of {@link lttbImpl} that writes into a caller-provided
 * buffer instead of allocating a fresh `Float32Array` per call.
 *
 * MOTIVATION
 * ----------
 * The render hot path (drag-pan / wheel-zoom) calls LTTB once per lane per
 * frame. {@link lttbImpl} allocates a new `Float32Array` every call, churning
 * ~38 KB/frame across four lanes (~2.3 MB/s during a sustained drag) and
 * provoking GC pauses that show up as frame-rate jank. Callers that can supply
 * a reusable scratch buffer use this variant to drive steady-state allocations
 * to ~zero.
 *
 * CONTRACT
 * --------
 * The result is written into `out` and the function returns a `subarray` VIEW
 * over exactly the written length — never a copy and never `out` itself padded
 * with stale tail values. The number of written points matches {@link lttbImpl}
 * exactly for the same `(data, targetPoints)`, so the returned view is
 * element-for-element identical to `lttbImpl(data, targetPoints)`.
 *
 * The caller MUST pass an `out` of length `>= min(data.length, max(2,
 * targetPoints))`. Use {@link lttbOutLength} to size it. If `out` is too small
 * the function falls back to {@link lttbImpl} (a fresh allocation) so output is
 * still correct — it just forfeits the allocation saving for that call.
 *
 * ALIASING WARNING
 * ----------------
 * The returned view shares `out`'s backing buffer. If the caller hands the view
 * to a consumer that retains it across frames (e.g. a renderer that later
 * re-samples it for a crosshair overlay), the caller MUST NOT overwrite `out`
 * until that consumer is done. Double-buffer (alternate two `out` buffers per
 * series) when a previous frame's view may still be read.
 *
 * @param data         - Input signal values (evenly spaced y-values).
 * @param targetPoints - Desired number of output points.
 * @param out          - Caller-owned destination buffer (reused across calls).
 * @returns A `subarray` view of `out` holding exactly the written points.
 */
export function lttbInto(
  data: Float32Array,
  targetPoints: number,
  out: Float32Array,
): Float32Array {
  const len = data.length;

  if (len === 0) return out.subarray(0, 0);

  // Clamp target to at least 2 (mirrors lttbImpl).
  const target = Math.max(2, targetPoints);

  if (len <= target) {
    // Already small enough: copy through verbatim (mirrors lttbImpl's copy).
    if (out.length < len) return lttbImpl(data, targetPoints);
    out.set(data.subarray(0, len));
    return out.subarray(0, len);
  }

  if (out.length < target) {
    // Buffer too small to hold the result — fall back to a fresh allocation so
    // correctness is preserved (caller forfeits the allocation saving here).
    return lttbImpl(data, targetPoints);
  }

  // Always keep first and last points.
  out[0] = data[0] ?? 0;
  out[target - 1] = data[len - 1] ?? 0;

  // Bucket size (excluding the first and last single-point buckets).
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
      const area = Math.abs(
        (prevX - avgX) * ((data[i] ?? 0) - prevY) - (prevX - i) * (avgY - prevY),
      );

      if (area > maxArea) {
        maxArea = area;
        bestIndex = i;
      }
    }

    out[bucket] = data[bestIndex] ?? 0;
    prevSelectedIndex = bestIndex;
  }

  return out.subarray(0, target);
}

/**
 * The exact number of points {@link lttbInto} / {@link lttbImpl} will write for
 * a given input length and target — i.e. the minimum `out` buffer length needed
 * to avoid the fallback allocation. Mirrors the clamping in {@link lttbImpl}.
 */
export function lttbOutLength(dataLength: number, targetPoints: number): number {
  if (dataLength === 0) return 0;
  const target = Math.max(2, targetPoints);
  return Math.min(dataLength, target);
}

/**
 * A per-x-pixel-column MIN/MAX envelope of a dense signal slice.
 *
 * `min[c]` / `max[c]` are the minimum / maximum sample value mapping to output
 * column `c` (0 ≤ c < `columns`). A column whose source samples are ALL NaN — a
 * gap — is marked by `min[c] = max[c] = NaN`, so the renderer can BREAK the
 * envelope there exactly as the polyline path breaks on NaN. A column with some
 * NaN uses only its non-NaN extrema. Columns with NO source samples (can happen
 * when the source is sparser than the plot is wide, near the zoomed-in boundary)
 * are also marked NaN; in that regime the caller should fall back to the polyline.
 */
export interface ColumnEnvelope {
  /** Per-column minima (length = `columns`). NaN marks a gap/empty column. */
  readonly min: Float32Array;
  /** Per-column maxima (length = `columns`). NaN marks a gap/empty column. */
  readonly max: Float32Array;
  /** Number of populated output columns (≤ the buffers' capacity). */
  readonly columns: number;
}

/**
 * Compute a per-column MIN/MAX envelope of a DENSE signal slice for the
 * zoomed-out Signal Viewer path, writing into caller-owned scratch buffers.
 *
 * WHY AN ENVELOPE (correctness / fidelity)
 * ----------------------------------------
 * When more than ~1 source sample maps to each output pixel column, an LTTB
 * polyline picks ONE representative vertex per bucket and can skip a 1-sample
 * spike or notch entirely (its vertex-selection is area-based, not extremum
 * based). A true per-column min/max envelope CANNOT hide an extreme: the most
 * extreme sample in a column is, by definition, its min or its max, so it always
 * reaches a pixel. This is the clinically-faithful choice for high-frequency
 * flow/pressure waveforms — health data must never visually drop a transient.
 *
 * COLUMN MAPPING
 * --------------
 * Source index `i` (0 ≤ i < `len`) maps to column `floor(i / len * columns)`
 * (clamped to `columns - 1`). This matches the renderer's x mapping for a slice
 * spanning the full plot width: x is uniform in the sample index. Columns are
 * scanned by walking the source once (O(len)), advancing the column boundary as
 * the index crosses it — strictly cheaper than the per-frame LTTB it replaces.
 *
 * NaN / GAP HANDLING
 * ------------------
 * A wholly-NaN column → `min = max = NaN` (a break). A column with both NaN and
 * real samples keeps the real extrema (the gap inside one pixel is not visible
 * anyway; the break lands on the wholly-missing columns, exactly as the polyline
 * breaks only where it has no real point to draw). An EMPTY column (no source
 * samples — possible only when `len < columns`) → `min = max = NaN`.
 *
 * @param data    - Dense source slice (a pyramid level's in-viewport samples).
 * @param columns - Desired output column count (≈ plot width in CSS px).
 * @param outMin  - Caller-owned destination for minima (length ≥ `columns`).
 * @param outMax  - Caller-owned destination for maxima (length ≥ `columns`).
 * @returns A {@link ColumnEnvelope} whose `min`/`max` are `outMin`/`outMax`.
 */
export function columnEnvelopeInto(
  data: Float32Array,
  columns: number,
  outMin: Float32Array,
  outMax: Float32Array,
): ColumnEnvelope {
  const cols = Math.max(1, Math.min(columns, outMin.length, outMax.length));
  const len = data.length;

  if (len === 0) {
    for (let c = 0; c < cols; c++) {
      outMin[c] = NaN;
      outMax[c] = NaN;
    }
    return { min: outMin, max: outMax, columns: cols };
  }

  // Single forward pass: for each source sample, find its column and fold it into
  // that column's running min/max. We track per-column state inline so we only
  // touch each output slot once it is finalised.
  let col = 0;
  let curMin = Infinity;
  let curMax = -Infinity;
  let sawReal = false;

  const flush = (c: number): void => {
    if (sawReal) {
      outMin[c] = curMin;
      outMax[c] = curMax;
    } else {
      // No real sample in this column: either purely NaN (a gap) or empty → break.
      outMin[c] = NaN;
      outMax[c] = NaN;
    }
  };

  const scale = cols / len;
  for (let i = 0; i < len; i++) {
    // Column for this sample. Multiply (not divide) per sample; clamp the tail.
    let c = (i * scale) | 0;
    if (c >= cols) c = cols - 1;

    if (c !== col) {
      // Finalise every column from `col` up to (but not including) `c`. Columns
      // strictly between the previous and current sample's columns are EMPTY
      // (possible only when len < cols) and flush as NaN breaks.
      flush(col);
      for (let g = col + 1; g < c; g++) {
        outMin[g] = NaN;
        outMax[g] = NaN;
      }
      col = c;
      curMin = Infinity;
      curMax = -Infinity;
      sawReal = false;
    }

    const v = data[i] as number;
    if (Number.isNaN(v)) {
      continue;
    }
    sawReal = true;
    if (v < curMin) curMin = v;
    if (v > curMax) curMax = v;
  }
  // Finalise the last touched column and any trailing empty columns.
  flush(col);
  for (let g = col + 1; g < cols; g++) {
    outMin[g] = NaN;
    outMax[g] = NaN;
  }

  return { min: outMin, max: outMax, columns: cols };
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
