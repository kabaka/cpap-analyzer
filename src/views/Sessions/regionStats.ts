/**
 * Region Statistics — pure, correctness-critical computation layer for the
 * Signal Viewer's "measure a region" feature.
 *
 * The Signal Viewer (see {@link module:views/Sessions/SignalViewer}) keeps the
 * full session in memory per channel as `{ descriptor, data: Float32Array }`.
 * Samples are uniformly spaced, so the mapping between a sample index `i` and a
 * session-relative time is exactly linear:
 *
 * ```text
 *   timeMs(i) = (i / sampleRate) * 1000
 *   index(timeMs) = (timeMs / 1000) * sampleRate
 * ```
 *
 * Given a time region (the visible viewport, or an explicitly drawn band) this
 * module reduces each lane to a small summary the UI can render: numeric
 * avg/median/min/max for continuous channels, per-stage occupancy for the
 * hypnogram, and event counts for marker lanes.
 *
 * ## Boundary convention (IMPORTANT — read before changing anything)
 *
 * All region ranges in this module are **half-open** on the sample-index axis:
 * `[startIndex, endIndex)` — `startIndex` is included, `endIndex` is excluded.
 * This is the standard convention for array slices and makes adjacent regions
 * tile without double-counting a shared boundary sample.
 *
 * For **event/marker lanes** the same half-open rule is applied to each event's
 * *start time*: an event is "in the region" iff
 * `regionStartMs <= event.startTimeMs < regionEndMs`. Using the event start (not
 * overlap) keeps each event counted in exactly one region when the user sweeps
 * across the night, and matches how the user reads "events that begin in this
 * window". Overlap-based counting is intentionally NOT used (it would
 * double-count a long event that straddles a boundary).
 *
 * Time→index conversion rounds the **start up** and the **end up** (both via
 * `Math.ceil`/`Math.floor` as documented on {@link timeRangeToIndexRange}) and
 * clamps to `[0, data.length]`, so a region that extends past the loaded data is
 * silently clipped rather than reading out of bounds.
 *
 * ## Missing-data strategy
 *
 * Sentinel / no-reading samples are excluded via the project-wide
 * {@link isMeaningfulSample} predicate (the single source of truth shared with
 * the importer and the empty-channel detector). `NaN`, the `0` sentinel, `-1`
 * probe-off, and byte sentinels (`127`/`128`/`255`) are all rejected. Excluded
 * samples are dropped pairwise from every statistic — they never contribute to
 * `count`, `mean`, `median`, `min`, or `max`. A region in which *every* sample is
 * excluded is reported as empty (`count: 0`, null stats), exactly like a region
 * with no samples at all. This distinguishes "no data" from "the value is 0".
 *
 * @module views/Sessions/regionStats
 */

import { isMeaningfulSample } from '@/parsers/validation/physiologicalRanges';
// Note: stage codes (`SLEEP_STAGE_CODES` in `@/hooks/useWearableLanes`) are the
// ordinal encoding referenced by `CategoricalSample.value`, but this module does
// not import them — it treats stage codes as opaque ordinals so non-Fitbit
// encodings work unchanged.

// ---------------------------------------------------------------------------
// Input types (mirrors the data already held by SignalViewer)
// ---------------------------------------------------------------------------

/**
 * Minimal descriptor a numeric stats call needs. Structurally a subset of
 * `ChannelDescriptor` (from `OPFSService`), so the caller can pass the real
 * descriptor directly. Only these fields are read.
 */
export interface NumericChannelInput {
  /** Standard channel name (e.g. `flow`, `spo2`) — drives sentinel filtering. */
  readonly name: string;
  /** Physical unit, passed through untouched for the UI to format. */
  readonly unit: string;
  /** Sample rate in Hz (> 0). Used for time→index conversion. */
  readonly sampleRate: number;
  /** The full-session sample buffer in physical units. */
  readonly data: Float32Array;
}

/**
 * A half-open sample-index range `[startIndex, endIndex)`. Both ends are
 * clamped to the valid `[0, data.length]` span by the helpers that build one
 * from a time range; callers passing a raw range should pre-clamp.
 */
export interface IndexRange {
  /** First included sample index (inclusive). */
  readonly startIndex: number;
  /** First excluded sample index (exclusive). */
  readonly endIndex: number;
}

/** A session-relative time region in milliseconds, half-open `[startMs, endMs)`. */
export interface TimeRange {
  /** Region start, ms from session signal start (inclusive). */
  readonly startMs: number;
  /** Region end, ms from session signal start (exclusive). */
  readonly endMs: number;
}

/**
 * One categorical sample for a hypnogram-style lane: a session-relative
 * timestamp and an ordinal stage code. The hypnogram is a sparse step series
 * (stage transitions), NOT a uniformly-sampled buffer, so it is summarised by
 * the *time each stage is held* rather than by counting samples.
 */
export interface CategoricalSample {
  /** Session-relative time of this transition, in ms. */
  readonly timeMs: number;
  /** Ordinal stage code (see {@link SLEEP_STAGE_CODES}). */
  readonly value: number;
}

/**
 * One event/marker for a count summary. `startTimeMs` is session-relative.
 * `type` is the event-type label (e.g. `ObstructiveApnea`). This is a structural
 * subset of the renderer's `EventMarker`, so the caller can pass markers
 * directly; `durationMs` is accepted but not used by the count (kept so callers
 * need not strip it).
 */
export interface EventInput {
  /** Session-relative start time in ms. */
  readonly startTimeMs: number;
  /** Event-type label. */
  readonly type: string;
  /** Event duration in ms (currently unused by the count; see boundary docs). */
  readonly durationMs?: number;
}

// ---------------------------------------------------------------------------
// Result types (discriminated union the UI switches on)
// ---------------------------------------------------------------------------

/**
 * Numeric summary for a continuous channel over a region.
 *
 * `mean`/`median`/`min`/`max` are `null` when `count === 0` (no meaningful
 * samples in the region) so the UI can render an explicit "no data" state and
 * never confuse it with a genuine value of `0`.
 */
export interface NumericRegionStats {
  readonly kind: 'numeric';
  /** Number of meaningful (non-sentinel) samples that fed the statistics. */
  readonly count: number;
  /** Arithmetic mean of meaningful samples; `null` when `count === 0`. Always exact. */
  readonly mean: number | null;
  /**
   * Median of meaningful samples; `null` when `count === 0`.
   *
   * Exact (sort of a typed copy) unless the meaningful-sample count exceeds
   * {@link APPROX_MEDIAN_THRESHOLD}, in which case a streaming P²-quantile
   * estimate is used and {@link medianIsApproximate} is `true`. See
   * {@link computeNumericStats} for the error bound.
   */
  readonly median: number | null;
  /** Minimum meaningful sample; `null` when `count === 0`. Always exact. */
  readonly min: number | null;
  /** Maximum meaningful sample; `null` when `count === 0`. Always exact. */
  readonly max: number | null;
  /** True when {@link median} is a streaming approximation rather than exact. */
  readonly medianIsApproximate: boolean;
  /** Channel unit, passed through for the UI to format. */
  readonly unit: string;
  /** Recommended decimal places for display (see {@link decimalPlacesFor}). */
  readonly decimals: number;
}

/** Per-stage occupancy for one hypnogram-style categorical lane. */
export interface CategoricalStageStat {
  /** Ordinal stage code (see {@link SLEEP_STAGE_CODES}). */
  readonly value: number;
  /** Total time this stage is held within the region, in ms. */
  readonly durationMs: number;
  /** Fraction of the covered region this stage occupies, in `[0, 1]`. */
  readonly fraction: number;
}

/** Categorical summary for a hypnogram-style lane over a region. */
export interface CategoricalRegionStats {
  readonly kind: 'categorical';
  /** Per-stage occupancy, one entry per stage seen (descending by duration). */
  readonly stages: readonly CategoricalStageStat[];
  /** Stage code occupying the most time in the region; `null` if none covered. */
  readonly dominant: number | null;
  /** Total covered time used as the percentage denominator, in ms. */
  readonly coveredMs: number;
}

/** Event-count summary for a marker lane over a region. */
export interface CountRegionStats {
  readonly kind: 'count';
  /** Total events whose start falls in the region. */
  readonly count: number;
  /** Per-type counts (entries with count 0 omitted), descending by count. */
  readonly byType: readonly { readonly type: string; readonly count: number }[];
}

/** Result for a lane that has no meaningful region statistic. */
export interface NoneRegionStats {
  readonly kind: 'none';
}

/** Discriminated union the UI switches on. */
export type RegionStats =
  | NumericRegionStats
  | CategoricalRegionStats
  | CountRegionStats
  | NoneRegionStats;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Above this many *meaningful* samples the median switches from exact
 * (typed-array sort) to a streaming P² approximation.
 *
 * Chosen from a measured cost of an exact median (copy + `Float32Array.sort()`,
 * which sorts numerically by default for typed arrays):
 *
 * | meaningful samples | exact median cost |
 * | ------------------ | ----------------- |
 * | 250k               | ~26 ms            |
 * | 500k               | ~52 ms            |
 * | 720k (8h @ 25 Hz)  | ~74 ms            |
 * | 1.4M (8h @ 50 Hz)  | ~150 ms           |
 *
 * A *whole-night* region is the worst realistic case, and a measured sub-window
 * is far smaller. Even the whole night stays exact and well within an
 * interaction-latency budget, so the threshold is set high (2,000,000) — exact
 * is used for every realistic region. The approximation exists only to bound
 * cost/memory on pathological inputs (e.g. concatenated multi-night buffers).
 */
export const APPROX_MEDIAN_THRESHOLD = 2_000_000;

// ---------------------------------------------------------------------------
// Index ↔ time conversion
// ---------------------------------------------------------------------------

/**
 * Convert a half-open session-relative {@link TimeRange} to a half-open
 * {@link IndexRange}, clamped to `[0, length]`.
 *
 * The start index is `ceil(startMs/1000 * sampleRate)` — the first sample at or
 * after `startMs` — and the end index is `ceil(endMs/1000 * sampleRate)` — the
 * first sample at or after `endMs`, which is excluded. Using `ceil` on both ends
 * keeps the slice half-open and makes abutting time regions tile exactly: the
 * end index of `[a, b)` equals the start index of `[b, c)`.
 *
 * A non-finite or non-positive `sampleRate`, or an inverted/empty time range,
 * yields an empty index range (`start === end`).
 *
 * @param range - Session-relative time region, half-open `[startMs, endMs)`.
 * @param sampleRate - Channel sample rate in Hz.
 * @param length - Sample buffer length (the clamp ceiling).
 */
export function timeRangeToIndexRange(
  range: TimeRange,
  sampleRate: number,
  length: number,
): IndexRange {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || length <= 0) {
    return { startIndex: 0, endIndex: 0 };
  }
  const rawStart = Math.ceil((range.startMs / 1000) * sampleRate);
  const rawEnd = Math.ceil((range.endMs / 1000) * sampleRate);
  const startIndex = clampIndex(rawStart, length);
  const endIndex = clampIndex(rawEnd, length);
  // Guard against an inverted time range producing end < start.
  return { startIndex, endIndex: Math.max(startIndex, endIndex) };
}

/** Clamp an index to the inclusive `[0, length]` bound (length is a valid end). */
function clampIndex(i: number, length: number): number {
  if (!Number.isFinite(i)) return 0;
  if (i < 0) return 0;
  if (i > length) return length;
  return Math.trunc(i);
}

// ---------------------------------------------------------------------------
// Numeric statistics
// ---------------------------------------------------------------------------

/**
 * Compute avg/median/min/max for one continuous channel over a half-open
 * sample-index range, excluding sentinel/non-meaningful samples.
 *
 * ## Method
 *
 * - **count / mean / min / max** are computed in a single streaming pass over
 *   `[startIndex, endIndex)` (O(n), one allocation-free scan). These are ALWAYS
 *   exact. The mean is the arithmetic mean accumulated in a `number` (f64); for
 *   the value ranges seen here (≤ a few thousand, ≤ ~1.4M samples) the f64
 *   accumulator has ample precision, so a compensated (Kahan) sum is not needed.
 * - **median** is exact for up to {@link APPROX_MEDIAN_THRESHOLD} meaningful
 *   samples: the meaningful values are copied into a compact `Float32Array` and
 *   sorted (numeric sort, the typed-array default), then the middle element (odd
 *   count) or the mean of the two middle elements (even count) is taken. Above
 *   the threshold a streaming **P² quantile estimator** (Jain & Chlamtac, 1985)
 *   tracks the 0.5 quantile in O(1) memory and a single pass, and the result is
 *   flagged `medianIsApproximate: true`.
 *
 *   P² error bound: the P² estimator is accurate to within a small fraction of
 *   one inter-marker bin for smooth, unimodal distributions and converges as the
 *   sample count grows. In practice its 0.5-quantile error is well under 1 % of
 *   the data's interquartile range for the physiological signals here. Because
 *   the threshold is set so high that no realistic region triggers it, the
 *   approximate path is a safety valve, not the common case.
 *
 * Edge cases:
 * - empty range or all-sentinel range → `count: 0` and `null` mean/median/min/max.
 * - single meaningful sample → `mean = median = min = max = that value`.
 * - range is pre-clamped by the caller (use {@link timeRangeToIndexRange}); this
 *   function additionally clamps defensively so it can never read out of bounds.
 *
 * @param channel - Channel name/unit/sampleRate/data.
 * @param range - Half-open sample-index range `[startIndex, endIndex)`.
 * @param threshold - Exact-median cutoff; defaults to {@link APPROX_MEDIAN_THRESHOLD}.
 */
export function computeNumericStats(
  channel: NumericChannelInput,
  range: IndexRange,
  threshold: number = APPROX_MEDIAN_THRESHOLD,
): NumericRegionStats {
  const { name, unit, data } = channel;
  const len = data.length;
  const start = clampIndex(range.startIndex, len);
  const end = Math.max(start, clampIndex(range.endIndex, len));

  const decimals = decimalPlacesFor(channel);
  const span = end - start;

  // Worst-case meaningful count is the raw span; collect meaningful values into a
  // compact typed array sized to that (exact median needs them sorted anyway).
  // For the approximate path we abandon the buffer and feed P² instead.
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  // Decide up front whether we *might* exceed the threshold; if the raw span is
  // already within it, exact is guaranteed feasible (meaningful ≤ span) and we
  // can safely allocate the collection buffer.
  const canExact = span <= threshold;

  const collected = canExact ? new Float32Array(span) : null;
  const estimator = canExact ? null : new P2MedianEstimator();

  for (let i = start; i < end; i++) {
    const v = data[i];
    if (v === undefined || !isMeaningfulSample(name, v)) continue;
    // Streaming exact aggregates (always exact).
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (collected) {
      collected[count] = v;
    } else if (estimator) {
      estimator.push(v);
    }
    count++;
  }

  if (count === 0) {
    return {
      kind: 'numeric',
      count: 0,
      mean: null,
      median: null,
      min: null,
      max: null,
      medianIsApproximate: false,
      unit,
      decimals,
    };
  }

  const mean = sum / count;

  let median: number;
  let medianIsApproximate: boolean;
  if (collected) {
    // Exact: sort only the populated prefix [0, count).
    const view = collected.subarray(0, count);
    view.sort(); // Float32Array.sort defaults to ascending NUMERIC order.
    median = medianOfSorted(view);
    medianIsApproximate = false;
  } else if (estimator) {
    median = estimator.value();
    medianIsApproximate = true;
  } else {
    // Unreachable (one of the two is always set); keep the type-checker happy.
    median = mean;
    medianIsApproximate = false;
  }

  return {
    kind: 'numeric',
    count,
    mean,
    median,
    min,
    max,
    medianIsApproximate,
    unit,
    decimals,
  };
}

/** Median of an already-ascending typed array of length ≥ 1. */
function medianOfSorted(sorted: Float32Array): number {
  const n = sorted.length;
  const mid = n >>> 1;
  if (n % 2 === 1) {
    return sorted[mid] as number;
  }
  // Average the two central order statistics in f64.
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Bounds-checked typed-array read that narrows the result to `number` under
 * `noUncheckedIndexedAccess` without a non-null assertion. The throw is provably
 * unreachable in this module (every index used is statically within `[0, 4]` for
 * the five-marker arrays, or within a freshly-sized buffer), so it costs nothing
 * at runtime but lets the algorithm read markers as plain numbers.
 */
function at(arr: Float64Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`P2 marker index out of range: ${i}`);
  return v;
}

/**
 * Streaming P² estimator for the 0.5 quantile (median), per Jain & Chlamtac
 * (1985), "The P² Algorithm for Dynamic Calculation of Quantiles and Histograms
 * Without Storing Observations". Tracks five markers and updates them in O(1)
 * per sample with O(1) memory. Used only above {@link APPROX_MEDIAN_THRESHOLD}.
 *
 * Determinism: the update rule is purely arithmetic on the input stream, so the
 * estimate is fully deterministic for a given input sequence.
 */
class P2MedianEstimator {
  private readonly p = 0.5;
  private n = 0;
  // Five-marker state, fixed length 5. Typed arrays are used deliberately:
  // numeric index access on a Float64Array is typed `number` (never
  // `number | undefined`), so the algorithm stays free of non-null assertions
  // while remaining O(1) memory.
  private readonly q = new Float64Array(5); // marker heights
  private readonly nPos = new Float64Array(5); // marker positions (1-based)
  private readonly nDesired = new Float64Array(5); // desired positions
  private readonly dn = new Float64Array(5); // desired-position increments
  /** First ≤5 observations, buffered until P² can be seeded. */
  private readonly init = new Float64Array(5);
  private initCount = 0;

  push(x: number): void {
    if (this.n < 5) {
      this.init[this.initCount] = x;
      this.initCount++;
      this.n++;
      if (this.n === 5) this.seed();
      return;
    }
    this.n++;

    const q = this.q;
    const nPos = this.nPos;

    // 1. Find cell k such that q[k] <= x < q[k+1]; adjust extremes.
    let k: number;
    if (x < at(q, 0)) {
      q[0] = x;
      k = 0;
    } else if (x >= at(q, 4)) {
      q[4] = x;
      k = 3;
    } else {
      k = 0;
      for (let i = 1; i < 5; i++) {
        if (x < at(q, i)) {
          k = i - 1;
          break;
        }
      }
    }

    // 2. Increment positions of markers above the cell.
    for (let i = k + 1; i < 5; i++) nPos[i] = at(nPos, i) + 1;
    for (let i = 0; i < 5; i++) this.nDesired[i] = at(this.nDesired, i) + at(this.dn, i);

    // 3. Adjust interior markers (1..3) if needed.
    for (let i = 1; i <= 3; i++) {
      const d = at(this.nDesired, i) - at(nPos, i);
      const gapUp = at(nPos, i + 1) - at(nPos, i);
      const gapDown = at(nPos, i - 1) - at(nPos, i);
      if ((d >= 1 && gapUp > 1) || (d <= -1 && gapDown < -1)) {
        const dir = d >= 0 ? 1 : -1;
        const parabolic = this.parabolic(i, dir);
        if (at(q, i - 1) < parabolic && parabolic < at(q, i + 1)) {
          q[i] = parabolic;
        } else {
          q[i] = this.linear(i, dir);
        }
        nPos[i] = at(nPos, i) + dir;
      }
    }
  }

  value(): number {
    if (this.n === 0) return NaN;
    if (this.n < 5) {
      // Too few to seed P²; exact median of the buffered values.
      const s = this.init.subarray(0, this.initCount).slice();
      s.sort();
      const mid = s.length >>> 1;
      return s.length % 2 === 1 ? at(s, mid) : (at(s, mid - 1) + at(s, mid)) / 2;
    }
    return at(this.q, 2);
  }

  private seed(): void {
    const s = this.init.slice();
    s.sort();
    for (let i = 0; i < 5; i++) {
      this.q[i] = at(s, i);
      this.nPos[i] = i + 1;
    }
    this.nDesired[0] = 1;
    this.nDesired[1] = 1 + 2 * this.p;
    this.nDesired[2] = 1 + 4 * this.p;
    this.nDesired[3] = 3 + 2 * this.p;
    this.nDesired[4] = 5;
    this.dn[0] = 0;
    this.dn[1] = this.p / 2;
    this.dn[2] = this.p;
    this.dn[3] = (1 + this.p) / 2;
    this.dn[4] = 1;
  }

  private parabolic(i: number, d: number): number {
    const q = this.q;
    const nPos = this.nPos;
    const qi = at(q, i);
    const qip = at(q, i + 1);
    const qim = at(q, i - 1);
    const ni = at(nPos, i);
    const nip = at(nPos, i + 1);
    const nim = at(nPos, i - 1);
    return (
      qi +
      (d / (nip - nim)) *
        ((ni - nim + d) * ((qip - qi) / (nip - ni)) + (nip - ni - d) * ((qi - qim) / (ni - nim)))
    );
  }

  private linear(i: number, d: number): number {
    const qi = at(this.q, i);
    const target = at(this.q, i + d);
    const ni = at(this.nPos, i);
    const nTarget = at(this.nPos, i + d);
    return qi + d * ((target - qi) / (nTarget - ni));
  }
}

// ---------------------------------------------------------------------------
// Categorical statistics (hypnogram)
// ---------------------------------------------------------------------------

/**
 * Summarise a hypnogram-style categorical lane over a region by *time held* per
 * stage.
 *
 * The hypnogram is a sparse **step** series: each {@link CategoricalSample} marks
 * a transition where the stage `value` begins and holds until the next
 * transition. To compute occupancy we walk the transitions and accumulate, for
 * each stage, the overlap of `[thisTransition, nextTransition)` with the region
 * `[startMs, endMs)`. The final transition holds until `endMs` (we cannot see
 * past the loaded data, so the region end is the right edge).
 *
 * Percentages are computed against the **covered** time (the sum of all stage
 * durations actually observed in the region), not the raw region width, so gaps
 * before the first transition do not distort the proportions and the fractions
 * always sum to 1 (within floating-point error) whenever any stage is covered.
 *
 * Assumptions: `samples` are ascending in `timeMs`. The region is half-open
 * `[startMs, endMs)`. Stage codes are arbitrary ordinals (the function does not
 * require the {@link SLEEP_STAGE_CODES} set, so non-Fitbit encodings still work).
 *
 * @param samples - Ascending stage transitions for the lane.
 * @param range - Session-relative region, half-open `[startMs, endMs)`.
 */
export function computeCategoricalStats(
  samples: readonly CategoricalSample[],
  range: TimeRange,
): CategoricalRegionStats {
  const startMs = range.startMs;
  const endMs = range.endMs;
  const durations = new Map<number, number>();

  if (endMs > startMs && samples.length > 0) {
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] as CategoricalSample;
      const segStart = s.timeMs;
      const next = samples[i + 1];
      const segEnd = next ? next.timeMs : endMs;
      // Overlap of [segStart, segEnd) with [startMs, endMs).
      const lo = Math.max(segStart, startMs);
      const hi = Math.min(segEnd, endMs);
      const overlap = hi - lo;
      if (overlap > 0) {
        durations.set(s.value, (durations.get(s.value) ?? 0) + overlap);
      }
    }
  }

  let coveredMs = 0;
  for (const d of durations.values()) coveredMs += d;

  const stages: CategoricalStageStat[] = [];
  let dominant: number | null = null;
  let dominantMs = -1;
  for (const [value, durationMs] of durations) {
    stages.push({
      value,
      durationMs,
      fraction: coveredMs > 0 ? durationMs / coveredMs : 0,
    });
    if (durationMs > dominantMs) {
      dominantMs = durationMs;
      dominant = value;
    }
  }
  // Stable, deterministic ordering: descending duration, then ascending value.
  stages.sort((a, b) => b.durationMs - a.durationMs || a.value - b.value);

  return { kind: 'categorical', stages, dominant, coveredMs };
}

// ---------------------------------------------------------------------------
// Event/marker statistics
// ---------------------------------------------------------------------------

/**
 * Count events whose **start time** falls in the half-open region
 * `[startMs, endMs)`, with an optional per-type breakdown.
 *
 * Boundary rule (see module docs): an event is counted iff
 * `startMs <= event.startTimeMs < endMs`. An event starting exactly at `startMs`
 * is included; one starting exactly at `endMs` is excluded — so sweeping the
 * region across the night counts each event in exactly one window. Event
 * *duration* is intentionally ignored (overlap counting would double-count
 * events straddling a boundary).
 *
 * @param events - Events with session-relative `startTimeMs` and a `type`.
 * @param range - Session-relative region, half-open `[startMs, endMs)`.
 */
export function computeEventStats(
  events: readonly EventInput[],
  range: TimeRange,
): CountRegionStats {
  const { startMs, endMs } = range;
  const byTypeMap = new Map<string, number>();
  let count = 0;

  if (endMs > startMs) {
    for (const e of events) {
      const t = e.startTimeMs;
      if (t >= startMs && t < endMs) {
        count++;
        byTypeMap.set(e.type, (byTypeMap.get(e.type) ?? 0) + 1);
      }
    }
  }

  const byType = Array.from(byTypeMap, ([type, c]) => ({ type, count: c })).sort(
    (a, b) => b.count - a.count || a.type.localeCompare(b.type),
  );

  return { kind: 'count', count, byType };
}

// ---------------------------------------------------------------------------
// Display precision
// ---------------------------------------------------------------------------

/**
 * Per-channel decimal places for display. The descriptor (`ChannelDescriptor`)
 * does not carry a precision field, so this is the single rule the UI consults.
 *
 * Mapped by standard channel name first (most specific), then by unit, then a
 * sensible default. The values follow clinical convention: pressures and flow to
 * 0.1, leak to 0.1, SpO₂ / heart rate / tidal volume to whole numbers.
 *
 * @param channel - Channel name + unit (a descriptor subset).
 * @returns Number of decimal places (≥ 0) the UI should render.
 */
export function decimalPlacesFor(channel: {
  readonly name: string;
  readonly unit: string;
}): number {
  const byName = CHANNEL_DECIMALS[channel.name];
  if (byName !== undefined) return byName;
  const byUnit = UNIT_DECIMALS[normaliseUnit(channel.unit)];
  if (byUnit !== undefined) return byUnit;
  return DEFAULT_DECIMALS;
}

/** Default decimal places when neither name nor unit has a rule. */
export const DEFAULT_DECIMALS = 2;

/** Decimal places keyed by standard channel name (highest priority). */
const CHANNEL_DECIMALS: Readonly<Record<string, number>> = {
  flow: 1,
  maskPressure: 1,
  pressure: 1,
  eprPressure: 1,
  epap: 1,
  ipap: 1,
  leak: 1,
  minuteVent: 1,
  respRate: 0,
  tidalVolume: 0,
  spo2: 0,
  pulse: 0,
  snore: 0,
  flowLimitation: 2,
};

/** Decimal places keyed by normalised unit (fallback when name has no rule). */
const UNIT_DECIMALS: Readonly<Record<string, number>> = {
  bpm: 0, // heart rate / pulse
  '%': 0, // SpO₂, efficiency
  'l/min': 1, // leak, minute ventilation
  cmh2o: 1, // pressures
  ml: 0, // tidal volume
  ms: 0, // HRV (RMSSD)
  dba: 0, // snoring
  c: 1, // temperature °C
  f: 1, // temperature °F
};

/** Lowercase + strip the degree sign so `°C`/`cmH2O`/`L/min` map predictably. */
function normaliseUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/^°/, '');
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** What kind of statistic a lane supports — derived from its group. */
export type StatsKind = 'numeric' | 'categorical' | 'count' | 'none';

/**
 * Map a lane group to its statistics kind.
 *
 * - `cpap` and `wearable` continuous signals → `numeric`. (The `sleep` group's
 *   hypnogram is `categorical`; wearable continuous lanes like heart rate are
 *   numeric.)
 * - `sleep` → `categorical` (hypnogram stage occupancy).
 * - event/marker lanes → `count` (selected by the caller via `isEventLane`).
 * - `weather` → `numeric` for numeric series (temp/pressure/AQI) or `categorical`
 *   for the condition series; the caller knows which and passes `statsKind`
 *   directly to the relevant compute function, so the dispatcher leaves weather
 *   to the explicit overrides below.
 */
export function statsKindForGroup(group: string, isEventLane = false): StatsKind {
  if (isEventLane) return 'count';
  switch (group) {
    case 'cpap':
    case 'wearable':
      return 'numeric';
    case 'sleep':
      return 'categorical';
    default:
      return 'none';
  }
}

/**
 * Discriminated dispatcher: given a resolved {@link StatsKind} and the relevant
 * inputs, return the matching {@link RegionStats}. The UI calls this once per
 * lane and `switch`es on `result.kind`.
 *
 * Inputs are passed as a single options bag so the caller supplies only what the
 * lane's kind needs; a kind whose required input is missing returns
 * `{ kind: 'none' }` rather than throwing (defensive — the UI renders an empty
 * readout).
 *
 * For `numeric`, pass either an `indexRange` (already converted) OR a `timeRange`
 * (converted here via the channel's sample rate). `indexRange` wins if both are
 * given.
 */
export function computeRegionStats(
  kind: StatsKind,
  input: {
    readonly channel?: NumericChannelInput;
    readonly indexRange?: IndexRange;
    readonly timeRange?: TimeRange;
    readonly categoricalSamples?: readonly CategoricalSample[];
    readonly events?: readonly EventInput[];
    readonly medianThreshold?: number;
  },
): RegionStats {
  switch (kind) {
    case 'numeric': {
      const { channel, indexRange, timeRange, medianThreshold } = input;
      if (!channel) return { kind: 'none' };
      const range =
        indexRange ??
        (timeRange
          ? timeRangeToIndexRange(timeRange, channel.sampleRate, channel.data.length)
          : undefined);
      if (!range) return { kind: 'none' };
      return computeNumericStats(channel, range, medianThreshold);
    }
    case 'categorical': {
      const { categoricalSamples, timeRange } = input;
      if (!categoricalSamples || !timeRange) return { kind: 'none' };
      return computeCategoricalStats(categoricalSamples, timeRange);
    }
    case 'count': {
      const { events, timeRange } = input;
      if (!events || !timeRange) return { kind: 'none' };
      return computeEventStats(events, timeRange);
    }
    case 'none':
    default:
      return { kind: 'none' };
  }
}
