/**
 * Sleep-stage tagging, time-in-stage, and per-stage event rates.
 *
 * These are the descriptive primitives of the sleep-stage lens. They convert a
 * device event stream plus a wearable hypnogram (an array of {@link StageSegment})
 * into stage-tagged events, total time-in-stage, and event rates per stage.
 *
 * @module analysis/sleepStages/staging
 */

import type { Event, EventType } from '@/types/events';
import { isAhiEvent, MS_PER_HOUR } from './constants';
import type {
  SleepStage,
  StageDurations,
  StageEventRate,
  StageSegment,
  TaggedEvent,
} from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A finite, positive-length segment. Non-finite/zero-length inputs are dropped. */
function isValidSegment(s: StageSegment): boolean {
  return (
    Number.isFinite(s.startMs) &&
    Number.isFinite(s.endMs) &&
    s.endMs > s.startMs &&
    (s.stage === 'deep' || s.stage === 'light' || s.stage === 'rem' || s.stage === 'wake')
  );
}

/**
 * Validate and sort segments ascending by `startMs` (then `endMs`).
 * Defensive: callers may pass unsorted or partially-malformed input.
 */
export function sanitizeSegments(segments: readonly StageSegment[]): StageSegment[] {
  return segments
    .filter(isValidSegment)
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

// ---------------------------------------------------------------------------
// 1) Stage tagging
// ---------------------------------------------------------------------------

/**
 * Find the stage of the segment containing `t` under the half-open `[start, end)`
 * convention, using binary search over segments sorted by `startMs`.
 *
 * When segments overlap (which they should not after a well-formed import, but
 * we do not assume it), the EARLIEST-starting segment whose interval contains
 * `t` wins. Returns `null` when `t` falls in no segment (no wearable coverage).
 *
 * Complexity: O(log n) per query for non-overlapping input. With overlaps a
 * short backward scan is performed, which is bounded by the overlap depth.
 */
function stageAt(sortedSegments: readonly StageSegment[], t: number): SleepStage | null {
  const n = sortedSegments.length;
  if (n === 0 || !Number.isFinite(t)) return null;

  // Binary search for the last segment with startMs <= t.
  let lo = 0;
  let hi = n - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = sortedSegments[mid];
    if (seg !== undefined && seg.startMs <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return null;

  // `idx` is the last segment with startMs <= t. Walk backward to honour
  // overlaps: an earlier-starting segment may also contain t and, by the
  // earliest-start rule, take precedence. We stop the backward scan as soon as
  // we pass a segment that ends at or before t (it cannot contain t, and for
  // typical non-overlapping/tiled hypnograms this terminates after the first
  // iteration). To remain correct under arbitrary overlaps we keep the earliest
  // containing match seen during the contiguous run of candidates.
  let best: StageSegment | null = null;
  for (let i = idx; i >= 0; i--) {
    const seg = sortedSegments[i];
    if (seg === undefined) continue;
    if (seg.startMs <= t && seg.endMs > t) {
      best = seg; // earliest such segment wins; loop continues toward smaller i
    } else if (best !== null) {
      // Once we have a match and hit a non-containing earlier segment, no
      // strictly-earlier segment can contain t without also overlapping `best`'s
      // start; for tiled inputs that does not occur, so stop scanning.
      break;
    }
  }
  return best ? best.stage : null;
}

/**
 * Tag each event with the sleep stage active at its marker time
 * (`event.timestamp`), or `null` if the timestamp falls outside all segments.
 *
 * @param events   device events (any order)
 * @param segments wearable hypnogram (any order; validated/sorted internally)
 * @returns one {@link TaggedEvent} per input event, preserving input order
 */
export function tagEventsByStage(
  events: readonly Event[],
  segments: readonly StageSegment[],
): TaggedEvent[] {
  const sorted = sanitizeSegments(segments);
  return events.map((event) => ({ event, stage: stageAt(sorted, event.timestamp) }));
}

// ---------------------------------------------------------------------------
// 2) Time-in-stage
// ---------------------------------------------------------------------------

/** Merge overlapping/adjacent intervals (sorted by start) and return total length. */
function mergedLength(intervals: readonly { startMs: number; endMs: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = intervals.slice().sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const first = sorted[0];
  if (first === undefined) return 0;
  let total = 0;
  let curStart = first.startMs;
  let curEnd = first.endMs;
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s === undefined) continue;
    if (s.startMs > curEnd) {
      total += curEnd - curStart;
      curStart = s.startMs;
      curEnd = s.endMs;
    } else if (s.endMs > curEnd) {
      curEnd = s.endMs;
    }
  }
  total += curEnd - curStart;
  return total;
}

/**
 * Total wall-clock time per stage, merging overlaps WITHIN each stage so no
 * time is double-counted.
 *
 * Overlap handling: segments are grouped by stage, and overlapping/adjacent
 * intervals of the SAME stage are unioned before summing. Overlaps BETWEEN
 * different stages are left as-is (each stage's union is independent), so the
 * sum of all four stages may exceed the recorded wall-clock span if the source
 * contains cross-stage overlaps. Well-formed wearable hypnograms tile time
 * without cross-stage overlap, in which case the totals partition the window.
 *
 * @param segments wearable hypnogram (any order; validated internally)
 */
export function stageDurations(segments: readonly StageSegment[]): StageDurations {
  const buckets: Record<SleepStage, { startMs: number; endMs: number }[]> = {
    deep: [],
    light: [],
    rem: [],
    wake: [],
  };
  for (const s of segments) {
    if (!isValidSegment(s)) continue;
    buckets[s.stage].push({ startMs: s.startMs, endMs: s.endMs });
  }

  const deep = mergedLength(buckets.deep);
  const light = mergedLength(buckets.light);
  const rem = mergedLength(buckets.rem);
  const wake = mergedLength(buckets.wake);

  return {
    deep,
    light,
    rem,
    wake,
    nremMs: deep + light,
    remMs: rem,
    asleepMs: deep + light + rem,
  };
}

// ---------------------------------------------------------------------------
// 3) Event rates by stage
// ---------------------------------------------------------------------------

/** Options for {@link eventRatesByStage}. */
export interface EventRatesOptions {
  /** When true, only AHI-contributing event types are counted. Default false. */
  readonly ahiOnly?: boolean;
}

/**
 * Event counts and rates per stage, plus an `'unknown'` bucket for events that
 * fell outside wearable coverage.
 *
 * `ratePerHour = count / hours`, returned as `null` whenever `hours === 0`
 * (no denominator). The `'unknown'` bucket has no time denominator by
 * definition, so its `ratePerHour` is always `null`.
 *
 * @param taggedEvents output of {@link tagEventsByStage}
 * @param durations    output of {@link stageDurations}
 * @param options      `{ ahiOnly }`
 * @returns rates for deep/light/rem/wake plus `unknown`, in that fixed order
 */
export function eventRatesByStage(
  taggedEvents: readonly TaggedEvent[],
  durations: StageDurations,
  options: EventRatesOptions = {},
): StageEventRate[] {
  const ahiOnly = options.ahiOnly ?? false;

  const order: (SleepStage | 'unknown')[] = ['deep', 'light', 'rem', 'wake', 'unknown'];
  const counts: Record<SleepStage | 'unknown', number> = {
    deep: 0,
    light: 0,
    rem: 0,
    wake: 0,
    unknown: 0,
  };
  const byType: Record<SleepStage | 'unknown', Partial<Record<EventType, number>>> = {
    deep: {},
    light: {},
    rem: {},
    wake: {},
    unknown: {},
  };

  for (const { event, stage } of taggedEvents) {
    if (ahiOnly && !isAhiEvent(event.type)) continue;
    const bucket: SleepStage | 'unknown' = stage ?? 'unknown';
    counts[bucket] += 1;
    byType[bucket][event.type] = (byType[bucket][event.type] ?? 0) + 1;
  }

  const hoursOf = (stage: SleepStage | 'unknown'): number => {
    if (stage === 'unknown') return 0;
    return durations[stage] / MS_PER_HOUR;
  };

  return order.map((stage) => {
    const hours = hoursOf(stage);
    const count = counts[stage];
    const ratePerHour = hours > 0 ? count / hours : null;
    return { stage, count, hours, ratePerHour, byType: byType[stage] };
  });
}
