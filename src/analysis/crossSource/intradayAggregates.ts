/**
 * Intraday aggregate helpers for cross-source analysis.
 *
 * Given a wearable intraday series (e.g. heart rate at ≈5-second cadence) and a
 * time window — typically a single CPAP session — these functions reduce the
 * window's samples to summary statistics: mean / min / max / standard deviation
 * plus a coverage measure describing how much of the window the samples
 * actually span.
 *
 * These are deliberately pure, deterministic, and free of any storage or React
 * dependency so they can be unit-tested with known-value assertions and later
 * wired into intraday correlation work (e.g. correlating a session's mean HR
 * against its AHI). They are NOT yet consumed by any view.
 *
 * All inputs use the absolute, LOCAL-frame epoch convention produced by the
 * wearable retrieval layer (see `useWearableLanes`), so a "window" is a
 * `[startMs, endMs]` pair in the same time base as the samples. For the two
 * UTC-sourced lanes (heart rate, SpO₂), callers must feed samples that have
 * ALREADY been converted to local time via `applyOffset`/`useWearableOffsets`
 * (exactly as `useWearableLanes` does). This module is pure and
 * time-base-agnostic — it never applies the offset itself — so any future feed
 * must do the conversion upstream to keep windows and samples in one frame.
 *
 * @module analysis/crossSource/intradayAggregates
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal sample shape consumed by the aggregators. Structurally compatible
 * with `WearableSample` from the retrieval hook, but defined here so this
 * module stays decoupled from the hook layer.
 */
export interface IntradaySample {
  /** Absolute timestamp in epoch milliseconds. */
  readonly timestampMs: number;
  /** Numeric lane value. */
  readonly value: number;
}

/** A closed time window in epoch milliseconds (inclusive of both bounds). */
export interface TimeWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** Summary statistics for an intraday series within a window. */
export interface IntradayAggregate {
  /** Number of in-window samples with a finite value. */
  readonly count: number;
  /** Arithmetic mean of in-window values, or `null` when `count === 0`. */
  readonly mean: number | null;
  /** Minimum in-window value, or `null` when `count === 0`. */
  readonly min: number | null;
  /** Maximum in-window value, or `null` when `count === 0`. */
  readonly max: number | null;
  /**
   * Sample standard deviation (Bessel-corrected, n − 1) of in-window values.
   * `null` when fewer than 2 samples are present (undefined dispersion).
   */
  readonly std: number | null;
  /**
   * Temporal span of the in-window samples (last minus first timestamp), in
   * milliseconds. `0` when 0 or 1 samples.
   */
  readonly spanMs: number;
  /**
   * Fraction of the window covered by samples, in `[0, 1]`: `spanMs` divided by
   * the window duration. A low value flags sparse coverage (e.g. the wearable
   * was only worn for part of the session). `0` for a zero-length window.
   */
  readonly coverage: number;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Select the samples whose timestamps fall within `[window.startMs,
 * window.endMs]` (inclusive) and carry a finite value.
 *
 * Samples need not be pre-sorted. Non-finite values (NaN/Infinity) and
 * out-of-window samples are excluded.
 */
export function selectWindowSamples(
  samples: readonly IntradaySample[],
  window: TimeWindow,
): IntradaySample[] {
  const { startMs, endMs } = window;
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const out: IntradaySample[] = [];
  for (const s of samples) {
    if (s.timestampMs < lo || s.timestampMs > hi) continue;
    if (!Number.isFinite(s.value)) continue;
    out.push(s);
  }
  return out;
}

/**
 * Compute summary statistics for an intraday series within a time window.
 *
 * Coverage is computed against the window duration; if the window is
 * zero-length (or inverted to zero length) coverage is `0`. With a single
 * in-window sample, `std` is `null` and `coverage` is `0` (no temporal span).
 *
 * @param samples - Intraday samples (any order; filtered to the window).
 * @param window  - Inclusive epoch-ms window to aggregate over.
 * @returns Aggregate statistics; all stats are `null` when no samples qualify.
 */
export function aggregateIntraday(
  samples: readonly IntradaySample[],
  window: TimeWindow,
): IntradayAggregate {
  const inWindow = selectWindowSamples(samples, window);
  const count = inWindow.length;

  const windowDurationMs = Math.abs(window.endMs - window.startMs);

  if (count === 0) {
    return {
      count: 0,
      mean: null,
      min: null,
      max: null,
      std: null,
      spanMs: 0,
      coverage: 0,
    };
  }

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const s of inWindow) {
    sum += s.value;
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
    if (s.timestampMs < minTs) minTs = s.timestampMs;
    if (s.timestampMs > maxTs) maxTs = s.timestampMs;
  }

  const mean = sum / count;

  let std: number | null = null;
  if (count >= 2) {
    let sumSq = 0;
    for (const s of inWindow) {
      const d = s.value - mean;
      sumSq += d * d;
    }
    std = Math.sqrt(sumSq / (count - 1));
  }

  const spanMs = count >= 2 ? maxTs - minTs : 0;
  const coverage = windowDurationMs > 0 ? Math.min(1, spanMs / windowDurationMs) : 0;

  return { count, mean, min, max, std, spanMs, coverage };
}
