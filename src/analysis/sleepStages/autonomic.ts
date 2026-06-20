/**
 * Autonomic heart-rate response to respiratory events
 * (event-triggered HR / cyclic variation of heart rate, CVHR).
 *
 * Obstructive and central respiratory events in patients with an intact
 * autonomic nervous system produce a stereotyped heart-rate signature: relative
 * bradycardia during the event followed by an abrupt tachycardia ("surge") at
 * its termination, driven by the arousal and sympathetic activation that restore
 * airflow. Guilleminault et al. (1984) named this the cyclic variation of heart
 * rate (CVHR) and showed it tracks the apnea–hypopnea index.
 *
 * Citation (verified June 2026):
 *   - Guilleminault C, Connolly S, Winkle R, Melvin K, Tilkian A. Cyclical
 *     variation of the heart rate in sleep apnoea syndrome. Mechanisms, and
 *     usefulness of 24 h electrocardiography as a screening technique.
 *     Lancet. 1984 Jan 21;1(8369):126-131.
 *
 * This module computes an EVENT-TRIGGERED AVERAGE HR curve (mean HR across
 * events as a function of time relative to each event marker) and a per-event
 * post-event surge magnitude, then aggregates the surges.
 *
 * Caveats: wrist optical (PPG) HR has latency and smoothing relative to ECG, a
 * coarse cadence (~5 s), and confidence-dependent dropouts. The result is a
 * population-average autonomic response across a night's events — NOT a
 * per-event physiological diagnostic, and not comparable to ECG-derived CVHR.
 *
 * @module analysis/sleepStages/autonomic
 */

import { percentileFromSorted } from '@/analysis/math';
import { isAhiEvent } from './constants';
import type { Event, HrSample } from './types';

/** Options for {@link eventTriggeredHr}. */
export interface EventTriggeredHrOptions {
  /** Seconds of window BEFORE the event marker (baseline). Default 30. */
  readonly preWindowSec?: number;
  /** Seconds of window AFTER the event marker (surge search). Default 45. */
  readonly postWindowSec?: number;
  /** Bin width in seconds for the relative-time grid. Default 5. */
  readonly binSec?: number;
  /** Drop HR samples with `confidence` below this (when confidence present). */
  readonly minConfidence?: number;
  /** Minimum fraction of bins that must be covered to include an event. Default 0.5. */
  readonly minCoveragePerEvent?: number;
  /** Surge magnitude (bpm) at/above which an event "has a surge". Default 6. */
  readonly surgeThresholdBpm?: number;
}

/** One point of the event-triggered average HR curve. */
export interface AverageProfilePoint {
  /** Bin centre time relative to the event marker, in seconds (negative = pre). */
  readonly relSec: number;
  /** Mean HR (bpm) across events that had a value in this bin. */
  readonly meanBpm: number;
  /** Number of events contributing to this bin. */
  readonly n: number;
}

/** Result of {@link eventTriggeredHr}. */
export interface EventTriggeredHrResult {
  /** Event-triggered average HR curve over the pre+post window. */
  readonly averageProfile: readonly AverageProfilePoint[];
  /** Number of events that met the coverage requirement and were analysed. */
  readonly nEventsAnalyzed: number;
  /** Mean per-event surge (peak post HR − baseline), in bpm; null if none. */
  readonly meanSurgeBpm: number | null;
  /** Median per-event surge, in bpm; null if none. */
  readonly medianSurgeBpm: number | null;
  /** Fraction of analysed events with surge ≥ `surgeThresholdBpm`; null if none. */
  readonly fractionWithSurge: number | null;
  /** Surge threshold (bpm) used for `fractionWithSurge`. */
  readonly surgeThresholdBpm: number;
  /** `true` when at least one event was analysable. */
  readonly sufficientData: boolean;
}

/** Resample HR onto a single relative-time `tSec` via nearest sample within ½ bin. */
function nearestBpm(
  samples: readonly HrSample[],
  centerMs: number,
  halfBinMs: number,
): number | null {
  // samples assumed sorted ascending by timestampMs.
  // Binary search for the closest sample to centerMs.
  let lo = 0;
  let hi = samples.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const s = samples[mid];
    if (s !== undefined && s.timestampMs < centerMs) lo = mid + 1;
    else hi = mid;
  }
  // Candidates: samples[lo] and samples[lo-1].
  let best: HrSample | undefined;
  let bestDist = Infinity;
  for (const idx of [lo - 1, lo, lo + 1]) {
    const s = samples[idx];
    if (s === undefined) continue;
    const d = Math.abs(s.timestampMs - centerMs);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (best === undefined || bestDist > halfBinMs) return null;
  return best.bpm;
}

/**
 * Build the event-triggered average HR curve and per-event surge statistics.
 *
 * For each AHI-type event, HR is resampled onto a relative-time grid spanning
 * `[-preWindowSec, +postWindowSec]` in `binSec` steps, using the nearest HR
 * sample within half a bin of each grid point (NEAREST-sample resampling; no
 * interpolation, to avoid inventing values across optical-sensor dropouts). An
 * event is included only if at least `minCoveragePerEvent` of its grid bins are
 * covered. Baseline = mean HR over the pre-window bins; surge = max HR over the
 * post-window bins − baseline.
 *
 * @param events     device events (only AHI-type are used)
 * @param hrSamples  wearable intraday HR (any order; sorted/filtered internally)
 * @param opts       windowing and threshold options
 */
export function eventTriggeredHr(
  events: readonly Event[],
  hrSamples: readonly HrSample[],
  opts: EventTriggeredHrOptions = {},
): EventTriggeredHrResult {
  const preWindowSec = opts.preWindowSec ?? 30;
  const postWindowSec = opts.postWindowSec ?? 45;
  const binSec = opts.binSec ?? 5;
  const minCoveragePerEvent = opts.minCoveragePerEvent ?? 0.5;
  const surgeThresholdBpm = opts.surgeThresholdBpm ?? 6;

  // Build the relative-time grid (bin centres), in seconds.
  const grid: number[] = [];
  if (binSec > 0 && (preWindowSec > 0 || postWindowSec > 0)) {
    // Bins centred at multiples of binSec from -preWindowSec to +postWindowSec.
    const firstBin = -Math.floor(preWindowSec / binSec);
    const lastBin = Math.floor(postWindowSec / binSec);
    for (let b = firstBin; b <= lastBin; b++) grid.push(b * binSec);
  }

  const emptyResult: EventTriggeredHrResult = {
    averageProfile: grid.map((relSec) => ({ relSec, meanBpm: NaN, n: 0 })),
    nEventsAnalyzed: 0,
    meanSurgeBpm: null,
    medianSurgeBpm: null,
    fractionWithSurge: null,
    surgeThresholdBpm,
    sufficientData: false,
  };

  if (grid.length === 0) return emptyResult;

  // Sanitise HR samples: finite, optional confidence filter, sorted by time.
  const samples = hrSamples
    .filter(
      (s) =>
        Number.isFinite(s.timestampMs) &&
        Number.isFinite(s.bpm) &&
        (opts.minConfidence === undefined ||
          s.confidence === undefined ||
          s.confidence >= opts.minConfidence),
    )
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (samples.length === 0) return emptyResult;

  const halfBinMs = (binSec / 2) * 1000;
  const binSum = new Array<number>(grid.length).fill(0);
  const binCount = new Array<number>(grid.length).fill(0);
  const surges: number[] = [];
  let nEventsAnalyzed = 0;

  for (const event of events) {
    if (!isAhiEvent(event.type)) continue;

    // Resample this event's HR onto the grid.
    const profile = new Array<number | null>(grid.length).fill(null);
    let covered = 0;
    for (let i = 0; i < grid.length; i++) {
      const relSec = grid[i];
      if (relSec === undefined) continue;
      const centerMs = event.timestamp + relSec * 1000;
      const bpm = nearestBpm(samples, centerMs, halfBinMs);
      if (bpm !== null) {
        profile[i] = bpm;
        covered += 1;
      }
    }

    if (covered / grid.length < minCoveragePerEvent) continue;
    nEventsAnalyzed += 1;

    // Baseline = mean of covered pre-window bins (relSec < 0).
    let preSum = 0;
    let preN = 0;
    let postPeak = -Infinity;
    let postCovered = false;
    for (let i = 0; i < grid.length; i++) {
      const relSec = grid[i];
      const v = profile[i];
      if (relSec === undefined || v === null || v === undefined) continue;
      if (relSec < 0) {
        preSum += v;
        preN += 1;
      } else {
        if (v > postPeak) postPeak = v;
        postCovered = true;
      }
    }

    // Only compute a surge when both baseline and post-window have coverage.
    if (preN > 0 && postCovered) {
      const baseline = preSum / preN;
      surges.push(postPeak - baseline);
    }

    // Accumulate into the average profile (count this event as analysed).
    for (let i = 0; i < grid.length; i++) {
      const v = profile[i];
      if (v === null || v === undefined) continue;
      binSum[i] = (binSum[i] ?? 0) + v;
      binCount[i] = (binCount[i] ?? 0) + 1;
    }
  }

  const averageProfile: AverageProfilePoint[] = grid.map((relSec, i) => {
    const c = binCount[i] ?? 0;
    return { relSec, meanBpm: c > 0 ? (binSum[i] ?? 0) / c : NaN, n: c };
  });

  if (nEventsAnalyzed === 0) {
    return { ...emptyResult, averageProfile };
  }

  // Surge statistics are computed over the events that had both a usable
  // baseline (≥1 pre bin) and ≥1 post bin; `nEventsAnalyzed` counts all events
  // meeting the coverage requirement (those contributing to the average curve).
  const nSurges = surges.length;
  const sortedSurges = [...surges].sort((a, b) => a - b);
  const meanSurgeBpm = nSurges > 0 ? surges.reduce((acc, v) => acc + v, 0) / nSurges : null;
  const medianSurgeBpm = nSurges > 0 ? percentileFromSorted(sortedSurges, 50) : null;
  const fractionWithSurge =
    nSurges > 0 ? surges.filter((s) => s >= surgeThresholdBpm).length / nSurges : null;

  return {
    averageProfile,
    nEventsAnalyzed,
    meanSurgeBpm,
    medianSurgeBpm,
    fractionWithSurge,
    surgeThresholdBpm,
    sufficientData: true,
  };
}
