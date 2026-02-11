/**
 * False-Negative Detection for CPAP Therapy Events
 *
 * Identifies sustained flow-limitation regions in the FLG signal that were
 * **not** labelled as events by the device firmware. These "false negatives"
 * represent potential respiratory disturbances the auto-scoring algorithm
 * missed, providing clinicians and informed patients with a more complete
 * picture of therapy effectiveness.
 *
 * **Algorithm overview**:
 * 1. Walk through the FLG signal and identify contiguous above-threshold
 *    regions, merging nearby segments separated by gaps shorter than a
 *    configurable tolerance.
 * 2. Filter regions shorter than a minimum duration.
 * 3. Exclude regions that overlap (±5 s buffer) with existing scored events.
 * 4. Compute peakFLG, meanFLG, a likelihood heuristic, and nearby-event
 *    counts for each surviving region.
 *
 * Three presets (strict / balanced / lenient) control threshold, minimum
 * duration, and gap tolerance to fit different analysis use cases.
 *
 * @module analysis/events/false-negatives
 */

import type { Event } from '@/types/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Detection sensitivity preset. */
export type FalseNegativePreset = 'strict' | 'balanced' | 'lenient';

/** A single detected false-negative region. */
export interface FalseNegativeEvent {
  /** Region start in epoch ms. */
  readonly startTime: number;
  /** Region end in epoch ms. */
  readonly endTime: number;
  /** Region duration in seconds. */
  readonly duration: number;
  /** Maximum FLG value within the region. */
  readonly peakFLG: number;
  /** Mean FLG value within the region. */
  readonly meanFLG: number;
  /** Heuristic likelihood that this is a true missed event (0–1). */
  readonly likelihood: number;
  /** Number of scored events within ±60 s of the region. */
  readonly nearbyEventCount: number;
}

/** Aggregated detection result. */
export interface FalseNegativeDetection {
  /** Detected false-negative regions. */
  readonly detections: readonly FalseNegativeEvent[];
  /** Preset that was used. */
  readonly preset: FalseNegativePreset;
  /** Sum of all detection durations in seconds. */
  readonly totalDuration: number;
}

// ---------------------------------------------------------------------------
// Preset configuration
// ---------------------------------------------------------------------------

interface PresetConfig {
  readonly flgThreshold: number;
  readonly minDuration: number; // seconds
  readonly gapTolerance: number; // seconds
}

const PRESETS: Readonly<Record<FalseNegativePreset, PresetConfig>> = {
  strict: { flgThreshold: 0.3, minDuration: 15, gapTolerance: 5 },
  balanced: { flgThreshold: 0.2, minDuration: 10, gapTolerance: 10 },
  lenient: { flgThreshold: 0.15, minDuration: 8, gapTolerance: 15 },
};

/** Buffer (ms) added around scored events when checking overlap. */
const EVENT_OVERLAP_BUFFER_MS = 5_000;

/** Window (ms) for counting nearby scored events. */
const NEARBY_WINDOW_MS = 60_000;

/** Duration threshold (s) that triggers a likelihood boost. */
const DURATION_BOOST_THRESHOLD_S = 20;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A contiguous above-threshold segment before merging. */
interface RawSegment {
  startIdx: number;
  endIdx: number; // inclusive
}

/**
 * Merge segments separated by gaps shorter than `gapToleranceMs`.
 * Segments are assumed to be sorted by startIdx.
 */
function mergeSegments(
  segments: readonly RawSegment[],
  timestamps: Float32Array,
  gapToleranceMs: number,
): RawSegment[] {
  if (segments.length === 0) return [];

  const first = segments[0];
  if (!first) return [];
  const merged: RawSegment[] = [{ ...first }];

  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const prev = merged[merged.length - 1];
    if (!current || !prev) continue;

    const gapMs = (timestamps[current.startIdx] ?? 0) - (timestamps[prev.endIdx] ?? 0);

    if (gapMs <= gapToleranceMs) {
      prev.endIdx = current.endIdx;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Check whether a time range overlaps with any scored event ± buffer.
 */
function overlapsEvent(
  regionStartMs: number,
  regionEndMs: number,
  events: readonly Event[],
): boolean {
  for (const evt of events) {
    const evtStart = evt.timestamp - EVENT_OVERLAP_BUFFER_MS;
    const evtEnd = evt.timestamp + evt.duration * 1_000 + EVENT_OVERLAP_BUFFER_MS;
    if (regionStartMs <= evtEnd && regionEndMs >= evtStart) {
      return true;
    }
  }
  return false;
}

/**
 * Count scored events whose midpoint falls within ±60 s of the region centre.
 */
function countNearbyEvents(
  regionStartMs: number,
  regionEndMs: number,
  events: readonly Event[],
): number {
  const regionMid = (regionStartMs + regionEndMs) / 2;
  let count = 0;
  for (const evt of events) {
    const evtMid = evt.timestamp + (evt.duration * 1_000) / 2;
    if (Math.abs(evtMid - regionMid) <= NEARBY_WINDOW_MS) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect potential false-negative respiratory events by analysing sustained
 * flow-limitation (FLG) signal regions that lack corresponding scored events.
 *
 * @param flgSignal   FLG values (0–1+) aligned 1:1 with `timestamps`.
 * @param timestamps  Epoch-millisecond timestamps for each FLG sample.
 * @param events      Scored therapy events (used for overlap / proximity checks).
 * @param preset      Detection sensitivity — defaults to `'balanced'`.
 * @returns           Detection result with candidate regions, preset, and summary.
 *
 * @remarks
 * **Assumptions**:
 * - `flgSignal.length === timestamps.length`.
 * - Timestamps are monotonically non-decreasing and in epoch ms.
 * - FLG values ≥ 0.
 *
 * **Edge cases**:
 * - Empty FLG signal → empty detections.
 * - All FLG below threshold → empty detections.
 * - No scored events → larger detection set (no overlap filtering).
 */
export function detectFalseNegatives(
  flgSignal: Float32Array,
  timestamps: Float32Array,
  events: Event[],
  preset: FalseNegativePreset = 'balanced',
): FalseNegativeDetection {
  const cfg = PRESETS[preset];
  const n = Math.min(flgSignal.length, timestamps.length);

  if (n === 0) {
    return { detections: [], preset, totalDuration: 0 };
  }

  // -----------------------------------------------------------------
  // Step 1: Identify contiguous above-threshold segments
  // -----------------------------------------------------------------
  const rawSegments: RawSegment[] = [];
  let inSegment = false;
  let segStart = 0;

  for (let i = 0; i < n; i++) {
    const val = flgSignal[i] ?? 0;
    if (val >= cfg.flgThreshold) {
      if (!inSegment) {
        segStart = i;
        inSegment = true;
      }
    } else {
      if (inSegment) {
        rawSegments.push({ startIdx: segStart, endIdx: i - 1 });
        inSegment = false;
      }
    }
  }
  // Close an in-progress segment at end of signal
  if (inSegment) {
    rawSegments.push({ startIdx: segStart, endIdx: n - 1 });
  }

  if (rawSegments.length === 0) {
    return { detections: [], preset, totalDuration: 0 };
  }

  // -----------------------------------------------------------------
  // Step 2: Merge segments separated by short gaps
  // -----------------------------------------------------------------
  const gapToleranceMs = cfg.gapTolerance * 1_000;
  const merged = mergeSegments(rawSegments, timestamps, gapToleranceMs);

  // -----------------------------------------------------------------
  // Step 3: Filter by minimum duration
  // -----------------------------------------------------------------
  const minDurationMs = cfg.minDuration * 1_000;
  const durationFiltered = merged.filter((seg) => {
    const startMs = timestamps[seg.startIdx] ?? 0;
    const endMs = timestamps[seg.endIdx] ?? 0;
    return endMs - startMs >= minDurationMs;
  });

  // -----------------------------------------------------------------
  // Step 4: Build detections, excluding those overlapping scored events
  // -----------------------------------------------------------------
  const detections: FalseNegativeEvent[] = [];

  for (const seg of durationFiltered) {
    const startMs = timestamps[seg.startIdx] ?? 0;
    const endMs = timestamps[seg.endIdx] ?? 0;

    // Overlap check
    if (overlapsEvent(startMs, endMs, events)) {
      continue;
    }

    // Compute peakFLG and meanFLG
    let peak = -Infinity;
    let sum = 0;
    let count = 0;
    for (let i = seg.startIdx; i <= seg.endIdx; i++) {
      const v = flgSignal[i] ?? 0;
      if (v > peak) peak = v;
      sum += v;
      count++;
    }
    const meanFLG = count > 0 ? sum / count : 0;

    // Duration in seconds
    const durationS = (endMs - startMs) / 1_000;

    // Nearby event count
    const nearbyEventCount = countNearbyEvents(startMs, endMs, events);

    // Likelihood heuristic
    let likelihood = Math.min(peak, 1.0);
    if (durationS > DURATION_BOOST_THRESHOLD_S) {
      likelihood += 0.1;
    }
    if (nearbyEventCount === 0) {
      likelihood += 0.1;
    }
    likelihood = Math.min(Math.max(likelihood, 0), 1);

    detections.push({
      startTime: startMs,
      endTime: endMs,
      duration: durationS,
      peakFLG: peak,
      meanFLG,
      likelihood,
      nearbyEventCount,
    });
  }

  const totalDuration = detections.reduce((acc, d) => acc + d.duration, 0);

  return { detections, preset, totalDuration };
}
