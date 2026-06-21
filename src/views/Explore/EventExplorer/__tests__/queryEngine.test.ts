import { describe, it, expect } from 'vitest';
import type { Event, EventType } from '@/types/events';
import {
  computeFieldAvailability,
  countActiveFilters,
  emptyQuery,
  fieldExtent,
  inRange,
  inTimeWindow,
  isRangeUnbounded,
  localMinutesOfDay,
  matchesQuery,
  runQuery,
  type EventQuery,
} from '../queryEngine';

// ── Test fixtures ────────────────────────────────────────────────

let idCounter = 0;
function makeEvent(overrides: Partial<Event> = {}): Event {
  idCounter += 1;
  return {
    id: `evt-${idCounter}`,
    sessionId: 'sess-1',
    type: 'ObstructiveApnea',
    timestamp: Date.UTC(2025, 0, 1, 2, 0, 0), // arbitrary
    duration: 20,
    severity: null,
    pressure: 10,
    epap: null,
    ipap: null,
    leak: 5,
    spo2: 95,
    clusterId: null,
    ...overrides,
  };
}

/** Build a timestamp at a specific LOCAL hour/minute (engine uses local time). */
function localTimestamp(hour: number, minute = 0): number {
  return new Date(2025, 0, 1, hour, minute, 0, 0).getTime();
}

function withTypes(types: EventType[]): EventQuery {
  return { ...emptyQuery(), types: new Set(types) };
}

// ── Range helpers ────────────────────────────────────────────────

describe('inRange', () => {
  it('treats null bounds as unbounded', () => {
    expect(inRange(5, { min: null, max: null })).toBe(true);
    expect(inRange(5, { min: 5, max: null })).toBe(true);
    expect(inRange(4.99, { min: 5, max: null })).toBe(false);
    expect(inRange(5, { min: null, max: 5 })).toBe(true);
    expect(inRange(5.01, { min: null, max: 5 })).toBe(false);
  });

  it('is inclusive on both bounds', () => {
    expect(inRange(5, { min: 5, max: 5 })).toBe(true);
  });
});

describe('isRangeUnbounded', () => {
  it('detects the empty range', () => {
    expect(isRangeUnbounded({ min: null, max: null })).toBe(true);
    expect(isRangeUnbounded({ min: 0, max: null })).toBe(false);
    expect(isRangeUnbounded({ min: null, max: 100 })).toBe(false);
  });
});

// ── Time-of-night ────────────────────────────────────────────────

describe('localMinutesOfDay', () => {
  it('returns local minutes from midnight', () => {
    expect(localMinutesOfDay(localTimestamp(22, 30))).toBe(22 * 60 + 30);
    expect(localMinutesOfDay(localTimestamp(0, 0))).toBe(0);
  });
});

describe('inTimeWindow', () => {
  it('handles a contiguous window', () => {
    const w = { startMinute: 60, endMinute: 120 }; // 01:00–02:00
    expect(inTimeWindow(90, w)).toBe(true);
    expect(inTimeWindow(60, w)).toBe(true);
    expect(inTimeWindow(120, w)).toBe(true);
    expect(inTimeWindow(59, w)).toBe(false);
    expect(inTimeWindow(121, w)).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    const w = { startMinute: 22 * 60, endMinute: 6 * 60 }; // 22:00–06:00
    expect(inTimeWindow(23 * 60, w)).toBe(true);
    expect(inTimeWindow(2 * 60, w)).toBe(true);
    expect(inTimeWindow(6 * 60, w)).toBe(true);
    expect(inTimeWindow(12 * 60, w)).toBe(false);
    expect(inTimeWindow(21 * 60, w)).toBe(false);
  });

  it('treats a zero-width window as full-day', () => {
    expect(inTimeWindow(0, { startMinute: 300, endMinute: 300 })).toBe(true);
    expect(inTimeWindow(1000, { startMinute: 300, endMinute: 300 })).toBe(true);
  });
});

// ── Field availability & extent ──────────────────────────────────

describe('computeFieldAvailability', () => {
  it('reports a field available when any event has a non-null value', () => {
    const events = [
      makeEvent({ pressure: null, leak: null, spo2: null }),
      makeEvent({ pressure: 12, leak: null, spo2: null }),
    ];
    expect(computeFieldAvailability(events)).toEqual({ pressure: true, leak: false, spo2: false });
  });

  it('reports all false for an empty set', () => {
    expect(computeFieldAvailability([])).toEqual({ pressure: false, leak: false, spo2: false });
  });
});

describe('fieldExtent', () => {
  it('computes min/max ignoring nulls', () => {
    const events = [
      makeEvent({ duration: 10 }),
      makeEvent({ duration: 40 }),
      makeEvent({ duration: 25 }),
    ];
    expect(fieldExtent(events, 'duration')).toEqual({ min: 10, max: 40 });
  });

  it('returns null when no event has a value', () => {
    expect(fieldExtent([makeEvent({ spo2: null })], 'spo2')).toBeNull();
  });
});

// ── Active filter counting ───────────────────────────────────────

describe('countActiveFilters', () => {
  it('counts every constraining predicate', () => {
    expect(countActiveFilters(emptyQuery())).toBe(0);
    const q: EventQuery = {
      ...emptyQuery(),
      types: new Set(['Hypopnea']),
      duration: { min: 10, max: null },
      timeOfNight: { startMinute: 0, endMinute: 360 },
    };
    expect(countActiveFilters(q)).toBe(3);
  });
});

// ── matchesQuery & runQuery ──────────────────────────────────────

describe('matchesQuery', () => {
  it('matches everything under the empty query', () => {
    expect(matchesQuery(makeEvent(), emptyQuery())).toBe(true);
  });

  it('filters by event type (empty type set ⇒ all pass)', () => {
    const obstructive = makeEvent({ type: 'ObstructiveApnea' });
    const hypopnea = makeEvent({ type: 'Hypopnea' });
    expect(matchesQuery(obstructive, withTypes(['Hypopnea']))).toBe(false);
    expect(matchesQuery(hypopnea, withTypes(['Hypopnea']))).toBe(true);
    expect(matchesQuery(obstructive, emptyQuery())).toBe(true);
  });

  it('filters by duration range inclusively', () => {
    const q: EventQuery = { ...emptyQuery(), duration: { min: 15, max: 30 } };
    expect(matchesQuery(makeEvent({ duration: 15 }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ duration: 30 }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ duration: 14 }), q)).toBe(false);
    expect(matchesQuery(makeEvent({ duration: 31 }), q)).toBe(false);
  });

  it('EXCLUDES null-valued events when a nullable-field range is bounded', () => {
    const q: EventQuery = { ...emptyQuery(), pressure: { min: 8, max: 12 } };
    expect(matchesQuery(makeEvent({ pressure: null }), q)).toBe(false);
    expect(matchesQuery(makeEvent({ pressure: 10 }), q)).toBe(true);
  });

  it('passes null-valued events when the nullable range is unbounded', () => {
    expect(matchesQuery(makeEvent({ spo2: null }), emptyQuery())).toBe(true);
  });

  it('filters by date range (inclusive epoch ms)', () => {
    const t = Date.UTC(2025, 5, 1, 0, 0, 0);
    const q: EventQuery = {
      ...emptyQuery(),
      dateRange: { start: t, end: t + 1000 },
    };
    expect(matchesQuery(makeEvent({ timestamp: t }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ timestamp: t + 1000 }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ timestamp: t - 1 }), q)).toBe(false);
    expect(matchesQuery(makeEvent({ timestamp: t + 1001 }), q)).toBe(false);
  });

  it('filters by time-of-night window', () => {
    const q: EventQuery = {
      ...emptyQuery(),
      timeOfNight: { startMinute: 22 * 60, endMinute: 6 * 60 },
    };
    expect(matchesQuery(makeEvent({ timestamp: localTimestamp(2, 0) }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ timestamp: localTimestamp(14, 0) }), q)).toBe(false);
  });

  it('filters by session scope: only events in the set pass', () => {
    const q: EventQuery = {
      ...emptyQuery(),
      sessionIds: new Set(['sess-A', 'sess-B']),
    };
    expect(matchesQuery(makeEvent({ sessionId: 'sess-A' }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ sessionId: 'sess-B' }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ sessionId: 'sess-C' }), q)).toBe(false);
  });

  it('treats a null session scope as a no-op (all sessions pass)', () => {
    const q: EventQuery = { ...emptyQuery(), sessionIds: null };
    expect(matchesQuery(makeEvent({ sessionId: 'sess-A' }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ sessionId: 'anything' }), q)).toBe(true);
  });

  it('rejects every event when the session scope is an empty set', () => {
    // An empty, non-null set constrains to "no sessions" at match time.
    const q: EventQuery = { ...emptyQuery(), sessionIds: new Set<string>() };
    expect(matchesQuery(makeEvent({ sessionId: 'sess-A' }), q)).toBe(false);
  });

  it('AND-combines session scope with other predicates', () => {
    const q: EventQuery = {
      ...emptyQuery(),
      sessionIds: new Set(['sess-A']),
      types: new Set(['Hypopnea']),
    };
    expect(matchesQuery(makeEvent({ sessionId: 'sess-A', type: 'Hypopnea' }), q)).toBe(true);
    // Right type, wrong session.
    expect(matchesQuery(makeEvent({ sessionId: 'sess-B', type: 'Hypopnea' }), q)).toBe(false);
    // Right session, wrong type.
    expect(matchesQuery(makeEvent({ sessionId: 'sess-A', type: 'ObstructiveApnea' }), q)).toBe(
      false,
    );
  });

  it('AND-combines multiple predicates', () => {
    const q: EventQuery = {
      ...emptyQuery(),
      types: new Set(['Hypopnea']),
      duration: { min: 20, max: null },
    };
    expect(matchesQuery(makeEvent({ type: 'Hypopnea', duration: 25 }), q)).toBe(true);
    expect(matchesQuery(makeEvent({ type: 'Hypopnea', duration: 10 }), q)).toBe(false);
    expect(matchesQuery(makeEvent({ type: 'ObstructiveApnea', duration: 25 }), q)).toBe(false);
  });
});

describe('runQuery', () => {
  it('returns matched subset, total, and active-filter count, preserving order', () => {
    const events = [
      makeEvent({ id: 'a', type: 'ObstructiveApnea', duration: 30 }),
      makeEvent({ id: 'b', type: 'Hypopnea', duration: 10 }),
      makeEvent({ id: 'c', type: 'Hypopnea', duration: 40 }),
    ];
    const q: EventQuery = {
      ...emptyQuery(),
      types: new Set(['Hypopnea']),
      duration: { min: 20, max: null },
    };
    const result = runQuery(events, q);
    expect(result.total).toBe(3);
    expect(result.activeFilterCount).toBe(2);
    expect(result.matched.map((e) => e.id)).toEqual(['c']);
  });

  it('returns all events under the empty query', () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const result = runQuery(events, emptyQuery());
    expect(result.matched).toHaveLength(3);
    expect(result.activeFilterCount).toBe(0);
  });

  it('returns an empty match set when nothing qualifies', () => {
    const events = [makeEvent({ type: 'ObstructiveApnea' })];
    const result = runQuery(events, withTypes(['CentralApnea']));
    expect(result.matched).toHaveLength(0);
  });
});
