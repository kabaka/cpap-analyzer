/**
 * Pure query/filter engine for the Event Explorer.
 *
 * This module is intentionally free of React, the DOM, and storage concerns so
 * that it can be unit-tested exhaustively and reused (e.g. by export tooling).
 * The engine takes a set of {@link Event}s and an {@link EventQuery}, evaluates
 * AND-combined predicates, and returns the matched subset plus a description of
 * which filters are "active" (so the UI can render a trustworthy matched-count
 * strip and disable filters that have no data behind them).
 *
 * Conventions:
 * - Durations and ranges are inclusive on both bounds.
 * - `pressure` / `leak` / `spo2` are frequently `null`. A numeric-range filter
 *   on a nullable field EXCLUDES events whose value is `null` (you cannot match
 *   "pressure 8–12" against an event with unknown pressure). The UI is expected
 *   to disable such a filter when the field is absent across the whole set.
 * - Time-of-night is evaluated against the event timestamp's LOCAL clock time
 *   and supports windows that wrap past midnight (e.g. 22:00–06:00).
 *
 * @module views/Explore/EventExplorer/queryEngine
 */

import type { Event, EventType } from '@/types/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Inclusive numeric range. `min`/`max` of `null` means "unbounded on that side". */
export interface NumericRange {
  readonly min: number | null;
  readonly max: number | null;
}

/** Nullable numeric fields a range filter can target. */
export type NullableNumericField = 'pressure' | 'leak' | 'spo2';

/**
 * Time-of-night window expressed as minutes from local midnight (0–1439).
 * When `start <= end` the window is contiguous; when `start > end` it wraps
 * past midnight (e.g. 22:00 → 06:00 is `{ start: 1320, end: 360 }`).
 */
export interface TimeOfNightWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * A complete, declarative query. Every field is optional/empty by default,
 * and all populated fields are combined with logical AND.
 */
export interface EventQuery {
  /** Match only these event types. Empty set ⇒ all types pass. */
  readonly types: ReadonlySet<EventType>;
  /** Duration window in seconds. */
  readonly duration: NumericRange;
  /** Pressure window in cmH₂O (excludes null-pressure events when bounded). */
  readonly pressure: NumericRange;
  /** Leak window in L/min (excludes null-leak events when bounded). */
  readonly leak: NumericRange;
  /** SpO₂ window in % (excludes null-spo2 events when bounded). */
  readonly spo2: NumericRange;
  /** Local clock-time window, or `null` for no time-of-night constraint. */
  readonly timeOfNight: TimeOfNightWindow | null;
  /** Inclusive epoch-ms timestamp window, or `null` for no date constraint. */
  readonly dateRange: { readonly start: number; readonly end: number } | null;
  /**
   * Restrict matches to events belonging to these session ids, or `null` for
   * no session constraint. Used to pre-scope the Explorer to a single session
   * (e.g. linked from the Session Detail page). An empty set is treated like
   * `null` by the serializer, but the canonical "no constraint" value is `null`.
   */
  readonly sessionIds: ReadonlySet<string> | null;
}

/** Per-field availability across an event set (drives disabled-filter UI). */
export interface FieldAvailability {
  readonly pressure: boolean;
  readonly leak: boolean;
  readonly spo2: boolean;
}

/** Result of running a query against an event set. */
export interface QueryResult {
  /** Events matching every active predicate, in input order. */
  readonly matched: readonly Event[];
  /** Total candidate events the query was run against. */
  readonly total: number;
  /** Number of predicates that are actually constraining the result. */
  readonly activeFilterCount: number;
}

// ---------------------------------------------------------------------------
// Defaults & construction
// ---------------------------------------------------------------------------

/** An empty range (matches everything). */
export const UNBOUNDED_RANGE: NumericRange = { min: null, max: null };

/** A query that matches every event (the neutral element). */
export function emptyQuery(): EventQuery {
  return {
    types: new Set<EventType>(),
    duration: UNBOUNDED_RANGE,
    pressure: UNBOUNDED_RANGE,
    leak: UNBOUNDED_RANGE,
    spo2: UNBOUNDED_RANGE,
    timeOfNight: null,
    dateRange: null,
    sessionIds: null,
  };
}

// ---------------------------------------------------------------------------
// Predicate helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** True when `range` imposes no constraint. */
export function isRangeUnbounded(range: NumericRange): boolean {
  return range.min === null && range.max === null;
}

/** Inclusive range test. A `null` bound is treated as ±∞. */
export function inRange(value: number, range: NumericRange): boolean {
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

/**
 * Local minutes-from-midnight (0–1439) for an epoch-ms timestamp.
 * Uses the host's local timezone, matching how the rest of the app renders
 * session clock times.
 */
export function localMinutesOfDay(timestampMs: number): number {
  const d = new Date(timestampMs);
  return d.getHours() * 60 + d.getMinutes();
}

/** True when a local minute-of-day falls inside a (possibly wrapping) window. */
export function inTimeWindow(minuteOfDay: number, window: TimeOfNightWindow): boolean {
  const { startMinute, endMinute } = window;
  if (startMinute === endMinute) return true; // full-day window
  if (startMinute < endMinute) {
    return minuteOfDay >= startMinute && minuteOfDay <= endMinute;
  }
  // Wrapping window (e.g. 22:00 → 06:00)
  return minuteOfDay >= startMinute || minuteOfDay <= endMinute;
}

/**
 * Range test for a nullable field. Returns `false` for `null` values whenever
 * the range is bounded — you cannot match a numeric window against an unknown
 * value. When the range is unbounded the predicate is inert and `null` passes.
 */
function nullableInRange(value: number | null, range: NumericRange): boolean {
  if (isRangeUnbounded(range)) return true;
  if (value === null) return false;
  return inRange(value, range);
}

// ---------------------------------------------------------------------------
// Field availability
// ---------------------------------------------------------------------------

/**
 * Determine which nullable fields have at least one non-null value across the
 * given events. A `false` result means the corresponding filter should be
 * disabled (there is nothing to filter on).
 */
export function computeFieldAvailability(events: readonly Event[]): FieldAvailability {
  let pressure = false;
  let leak = false;
  let spo2 = false;
  for (const e of events) {
    if (!pressure && e.pressure !== null) pressure = true;
    if (!leak && e.leak !== null) leak = true;
    if (!spo2 && e.spo2 !== null) spo2 = true;
    if (pressure && leak && spo2) break;
  }
  return { pressure, leak, spo2 };
}

/**
 * Compute the [min, max] extent of a field across events, ignoring nulls.
 * Returns `null` when no event has a value for the field.
 */
export function fieldExtent(
  events: readonly Event[],
  field: 'duration' | NullableNumericField,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const e of events) {
    const v = field === 'duration' ? e.duration : e[field];
    if (v === null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return null;
  return { min, max };
}

// ---------------------------------------------------------------------------
// Active-filter accounting
// ---------------------------------------------------------------------------

/**
 * Count how many predicates in a query are actually constraining. Used for the
 * "matches N filters" copy in the matched-count strip.
 */
export function countActiveFilters(query: EventQuery): number {
  let count = 0;
  if (query.types.size > 0) count++;
  if (!isRangeUnbounded(query.duration)) count++;
  if (!isRangeUnbounded(query.pressure)) count++;
  if (!isRangeUnbounded(query.leak)) count++;
  if (!isRangeUnbounded(query.spo2)) count++;
  if (query.timeOfNight !== null) count++;
  if (query.dateRange !== null) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Core matcher
// ---------------------------------------------------------------------------

/** Evaluate a single event against a query. */
export function matchesQuery(event: Event, query: EventQuery): boolean {
  if (query.sessionIds !== null && !query.sessionIds.has(event.sessionId)) return false;

  if (query.types.size > 0 && !query.types.has(event.type)) return false;

  if (!inRange(event.duration, query.duration)) return false;

  if (!nullableInRange(event.pressure, query.pressure)) return false;
  if (!nullableInRange(event.leak, query.leak)) return false;
  if (!nullableInRange(event.spo2, query.spo2)) return false;

  if (query.dateRange !== null) {
    if (event.timestamp < query.dateRange.start || event.timestamp > query.dateRange.end) {
      return false;
    }
  }

  if (query.timeOfNight !== null) {
    if (!inTimeWindow(localMinutesOfDay(event.timestamp), query.timeOfNight)) return false;
  }

  return true;
}

/**
 * Run a query against a set of events.
 *
 * Pure and allocation-light: a single pass over `events` collecting matches.
 * Input order is preserved so callers can rely on it for stable rendering.
 */
export function runQuery(events: readonly Event[], query: EventQuery): QueryResult {
  const matched: Event[] = [];
  for (const event of events) {
    if (matchesQuery(event, query)) matched.push(event);
  }
  return {
    matched,
    total: events.length,
    activeFilterCount: countActiveFilters(query),
  };
}
