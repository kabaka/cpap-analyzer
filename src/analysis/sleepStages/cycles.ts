/**
 * Ultradian NREM–REM sleep-cycle derivation and per-cycle event load.
 *
 * Human sleep is organised into recurring NREM–REM cycles (~90–110 min in
 * adults), first systematically characterised by Feinberg & Floyd (1979).
 * A cycle is conventionally bounded by the END of successive REM episodes,
 * running from the start of an NREM period through the end of the following
 * REM episode.
 *
 * Citation (verified June 2026):
 *   - Feinberg I, Floyd TC. Systematic trends across the night in human sleep
 *     cycles. Psychophysiology. 1979 May;16(3):283-291. — defines NREM–REM
 *     cycles by NREM/REM onsets; modern cycle detectors adapt these criteria.
 *
 * Heuristic (these thresholds are fixed, not user-configurable, for
 * deterministic, reproducible results; changing them requires code review):
 *   1. SLEEP PERIOD — restrict to the span from the first non-wake segment
 *      (sleep onset) to the end of the last non-wake segment (final awakening).
 *      Interior `wake` and uncovered gaps are treated as interruptions that
 *      belong to whichever cycle they fall within; a wake bout does NOT start a
 *      new cycle.
 *   2. REM EPISODES — maximal runs of REM. Two REM runs separated only by a gap
 *      (non-REM or uncovered) of ≤ {@link REM_MERGE_GAP_MIN} minutes are MERGED
 *      into one episode, so a REM period briefly broken by an arousal is not
 *      split.
 *   3. CYCLES — a NREM–REM cycle runs from the start of an NREM period to the
 *      END of the following REM episode; boundaries sit at successive REM-episode
 *      ends. The first cycle starts at sleep onset. A trailing NREM tail after
 *      the last REM episode (no following REM) is emitted as a final INCOMPLETE
 *      cycle with `hasRem: false`.
 *
 * Caveat: consumer-wearable staging is approximate vs PSG; derived cycle counts
 * and boundaries are best-effort and should be read as descriptive structure,
 * not clinically scored sleep architecture.
 *
 * @module analysis/sleepStages/cycles
 */

import { isAhiEvent, MS_PER_HOUR, MS_PER_MINUTE } from './constants';
import { sanitizeSegments } from './staging';
import type { Event, SleepStage, StageSegment } from './types';

/** Max gap (minutes) between two REM runs that are merged into one episode. */
export const REM_MERGE_GAP_MIN = 15;

/** A derived NREM–REM sleep cycle. */
export interface Cycle {
  /** 1-based cycle index in chronological order. */
  readonly index: number;
  /** Epoch ms — cycle start (inclusive). */
  readonly startMs: number;
  /** Epoch ms — cycle end (exclusive). */
  readonly endMs: number;
  /** Cycle duration in minutes. */
  readonly durationMin: number;
  /** REM minutes within the cycle (from covered REM segments). */
  readonly remMin: number;
  /** NREM (deep+light) minutes within the cycle (from covered segments). */
  readonly nremMin: number;
  /** `false` for a trailing incomplete cycle with no terminating REM episode. */
  readonly hasRem: boolean;
}

/** A REM episode after run-merging: half-open `[startMs, endMs)`. */
interface RemEpisode {
  readonly startMs: number;
  readonly endMs: number;
}

/** Sum of overlap (ms) between `[a0,a1)` and each segment of the given stage(s). */
function overlapMsWithin(
  segments: readonly StageSegment[],
  a0: number,
  a1: number,
  predicate: (s: SleepStage) => boolean,
): number {
  let total = 0;
  for (const seg of segments) {
    if (!predicate(seg.stage)) continue;
    const lo = Math.max(a0, seg.startMs);
    const hi = Math.min(a1, seg.endMs);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

/**
 * Derive NREM–REM cycles from a wearable hypnogram.
 *
 * @param segments wearable hypnogram (any order; validated/sorted internally)
 * @returns chronological list of {@link Cycle}; empty when there is no sleep
 */
export function deriveSleepCycles(segments: readonly StageSegment[]): Cycle[] {
  const sorted = sanitizeSegments(segments);
  if (sorted.length === 0) return [];

  // 1) Sleep period: first non-wake start → last non-wake end.
  let onsetMs = Number.NaN;
  let finalWakeMs = Number.NaN;
  for (const seg of sorted) {
    if (seg.stage !== 'wake') {
      if (Number.isNaN(onsetMs)) onsetMs = seg.startMs;
      finalWakeMs = Math.max(Number.isNaN(finalWakeMs) ? seg.endMs : finalWakeMs, seg.endMs);
    }
  }
  if (Number.isNaN(onsetMs) || Number.isNaN(finalWakeMs) || finalWakeMs <= onsetMs) {
    return []; // no sleep at all
  }

  // 2) REM episodes within the sleep period, merging runs ≤ REM_MERGE_GAP_MIN apart.
  const remSegs = sorted.filter(
    (s) => s.stage === 'rem' && s.endMs > onsetMs && s.startMs < finalWakeMs,
  );
  const mergeGapMs = REM_MERGE_GAP_MIN * MS_PER_MINUTE;
  const episodes: RemEpisode[] = [];
  for (const seg of remSegs) {
    const start = Math.max(seg.startMs, onsetMs);
    const end = Math.min(seg.endMs, finalWakeMs);
    if (end <= start) continue;
    const last = episodes[episodes.length - 1];
    if (last !== undefined && start - last.endMs <= mergeGapMs) {
      episodes[episodes.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, end) };
    } else {
      episodes.push({ startMs: start, endMs: end });
    }
  }

  // 3) Cycle boundaries: start of NREM period → end of following REM episode.
  // First cycle starts at sleep onset; each cycle ends at a REM-episode end.
  const cycles: Cycle[] = [];
  let cursor = onsetMs;
  let index = 1;
  for (const ep of episodes) {
    if (ep.endMs <= cursor) continue; // episode already consumed (e.g. REM at onset)
    const startMs = cursor;
    const endMs = ep.endMs;
    cycles.push(buildCycle(sorted, index, startMs, endMs, true));
    cursor = endMs;
    index += 1;
  }

  // Trailing NREM tail (no following REM) → final incomplete cycle.
  if (finalWakeMs > cursor) {
    cycles.push(buildCycle(sorted, index, cursor, finalWakeMs, false));
  }

  return cycles;
}

/** Construct a {@link Cycle} with its REM/NREM minute breakdown. */
function buildCycle(
  segments: readonly StageSegment[],
  index: number,
  startMs: number,
  endMs: number,
  hasRem: boolean,
): Cycle {
  const remMs = overlapMsWithin(segments, startMs, endMs, (s) => s === 'rem');
  const nremMs = overlapMsWithin(segments, startMs, endMs, (s) => s === 'deep' || s === 'light');
  return {
    index,
    startMs,
    endMs,
    durationMin: (endMs - startMs) / MS_PER_MINUTE,
    remMin: remMs / MS_PER_MINUTE,
    nremMin: nremMs / MS_PER_MINUTE,
    hasRem,
  };
}

// ---------------------------------------------------------------------------
// Event → cycle assignment and per-cycle load
// ---------------------------------------------------------------------------

/** An event annotated with the 1-based cycle index it falls in (or `null`). */
export interface CycleTaggedEvent {
  readonly event: Event;
  /** 1-based {@link Cycle.index}, or `null` if the event is outside all cycles. */
  readonly cycleIndex: number | null;
}

/**
 * Assign each event to the cycle whose `[startMs, endMs)` contains its marker
 * time. Cycles are contiguous and non-overlapping by construction, so the first
 * containing cycle is unambiguous. Returns `null` for events before sleep onset
 * or after final awakening.
 */
export function assignEventsToCycles(
  events: readonly Event[],
  cycles: readonly Cycle[],
): CycleTaggedEvent[] {
  return events.map((event) => {
    let cycleIndex: number | null = null;
    for (const c of cycles) {
      if (event.timestamp >= c.startMs && event.timestamp < c.endMs) {
        cycleIndex = c.index;
        break;
      }
    }
    return { event, cycleIndex };
  });
}

/** Options controlling which events contribute to per-cycle load. */
export interface CycleLoadOptions {
  /** When true, count only AHI-contributing event types. Default false. */
  readonly ahiOnly?: boolean;
}

/** Per-cycle event-load summary. */
export interface CycleEventLoad {
  /** 1-based cycle index. */
  readonly index: number;
  /** Number of events assigned to this cycle (after `ahiOnly` filtering). */
  readonly count: number;
  /** Cycle duration in hours. */
  readonly durationHours: number;
  /** Events per hour = count / durationHours; null when duration is 0. */
  readonly ratePerHour: number | null;
  /** Whether this cycle is terminated by a REM episode. */
  readonly hasRem: boolean;
}

/**
 * Compute per-cycle event load (count and rate per hour).
 *
 * @param events the device events to attribute
 * @param cycles output of {@link deriveSleepCycles}
 * @param options `{ ahiOnly }`
 */
export function eventLoadByCycle(
  events: readonly Event[],
  cycles: readonly Cycle[],
  options: CycleLoadOptions = {},
): CycleEventLoad[] {
  const ahiOnly = options.ahiOnly ?? false;
  const counts = new Map<number, number>();
  const tagged = assignEventsToCycles(events, cycles);
  for (const { event, cycleIndex } of tagged) {
    if (cycleIndex === null) continue;
    if (ahiOnly && !isAhiEvent(event.type)) continue;
    counts.set(cycleIndex, (counts.get(cycleIndex) ?? 0) + 1);
  }

  return cycles.map((c) => {
    const durationHours = (c.endMs - c.startMs) / MS_PER_HOUR;
    const count = counts.get(c.index) ?? 0;
    return {
      index: c.index,
      count,
      durationHours,
      ratePerHour: durationHours > 0 ? count / durationHours : null,
      hasRem: c.hasRem,
    };
  });
}

// ---------------------------------------------------------------------------
// Early-vs-late cycle position trend (descriptive)
// ---------------------------------------------------------------------------

/** Result of {@link cyclePositionTrend}. */
export interface CyclePositionTrend {
  /** Pooled event rate (events/hour) over the first-half cycles; null if none. */
  readonly firstHalfRate: number | null;
  /** Pooled event rate (events/hour) over the second-half cycles; null if none. */
  readonly secondHalfRate: number | null;
  /** secondHalfRate − firstHalfRate (events/hour); null if either is null. */
  readonly slope: number | null;
  /** Plain-language, deliberately non-causal summary of the comparison. */
  readonly note: string;
}

/**
 * Descriptive early-vs-late summary: compares the pooled event rate of the
 * first half of the night's cycles with the second half.
 *
 * Rates are POOLED (Σcount / Σhours) within each half rather than averaged, so
 * longer cycles are weighted by their duration — avoiding distortion from short
 * trailing cycles. With an odd number of cycles, the middle cycle is assigned to
 * the second half. This is intentionally descriptive; it makes no claim about
 * mechanism or trend significance.
 *
 * @param perCycle output of {@link eventLoadByCycle}
 */
export function cyclePositionTrend(perCycle: readonly CycleEventLoad[]): CyclePositionTrend {
  const n = perCycle.length;
  if (n === 0) {
    return { firstHalfRate: null, secondHalfRate: null, slope: null, note: 'No cycles derived.' };
  }
  if (n === 1) {
    return {
      firstHalfRate: null,
      secondHalfRate: null,
      slope: null,
      note: 'Only one cycle derived; an early-vs-late comparison is not meaningful.',
    };
  }

  const mid = Math.floor(n / 2); // first half = [0, mid), second half = [mid, n)
  const pooledRate = (slice: readonly CycleEventLoad[]): number | null => {
    let count = 0;
    let hours = 0;
    for (const c of slice) {
      count += c.count;
      hours += c.durationHours;
    }
    return hours > 0 ? count / hours : null;
  };

  const firstHalfRate = pooledRate(perCycle.slice(0, mid));
  const secondHalfRate = pooledRate(perCycle.slice(mid));
  const slope =
    firstHalfRate !== null && secondHalfRate !== null ? secondHalfRate - firstHalfRate : null;

  let note: string;
  if (slope === null) {
    note = 'Insufficient covered time in one half to compare rates.';
  } else if (slope > 0) {
    note = 'Event rate is higher in the later cycles of the night (descriptive only).';
  } else if (slope < 0) {
    note = 'Event rate is higher in the earlier cycles of the night (descriptive only).';
  } else {
    note = 'Event rate is comparable between early and late cycles (descriptive only).';
  }

  return { firstHalfRate, secondHalfRate, slope, note };
}
