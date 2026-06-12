import { describe, it, expect } from 'vitest';
import { emptyQuery, type EventQuery } from '../queryEngine';
import { queriesEqual, queryToSearchParams, searchParamsToQuery } from '../querySerialization';

function roundTrip(query: EventQuery): EventQuery {
  const params = new URLSearchParams(queryToSearchParams(query));
  return searchParamsToQuery(params);
}

describe('querySerialization', () => {
  it('serializes an empty query to no params', () => {
    expect(queryToSearchParams(emptyQuery())).toEqual({});
  });

  it('round-trips a fully populated query', () => {
    const query: EventQuery = {
      types: new Set(['ObstructiveApnea', 'Hypopnea']),
      duration: { min: 30, max: 90 },
      pressure: { min: 8, max: null },
      leak: { min: null, max: 24 },
      spo2: { min: null, max: 88 },
      timeOfNight: { startMinute: 22 * 60, endMinute: 6 * 60 },
      dateRange: { start: 1_700_000_000_000, end: 1_700_100_000_000 },
    };
    const result = roundTrip(query);
    expect([...result.types].sort()).toEqual(['Hypopnea', 'ObstructiveApnea']);
    expect(result.duration).toEqual({ min: 30, max: 90 });
    expect(result.pressure).toEqual({ min: 8, max: null });
    expect(result.leak).toEqual({ min: null, max: 24 });
    expect(result.spo2).toEqual({ min: null, max: 88 });
    expect(result.timeOfNight).toEqual({ startMinute: 22 * 60, endMinute: 6 * 60 });
    expect(result.dateRange).toEqual({ start: 1_700_000_000_000, end: 1_700_100_000_000 });
  });

  it('produces compact, human-inspectable param strings', () => {
    const query: EventQuery = {
      ...emptyQuery(),
      types: new Set(['ObstructiveApnea']),
      duration: { min: 30, max: null },
      timeOfNight: { startMinute: 22 * 60, endMinute: 6 * 60 },
    };
    const params = queryToSearchParams(query);
    expect(params.types).toBe('ObstructiveApnea');
    expect(params.dur).toBe('30-');
    expect(params.ton).toBe('2200-0600');
  });

  it('ignores unknown/invalid event types and bad ranges', () => {
    const params = new URLSearchParams({
      types: 'ObstructiveApnea,NotAType',
      dur: 'garbage',
      ton: '9999-0000',
    });
    const q = searchParamsToQuery(params);
    expect([...q.types]).toEqual(['ObstructiveApnea']);
    expect(q.duration).toEqual({ min: null, max: null });
    expect(q.timeOfNight).toBeNull();
  });

  it('requires both from and to for a date range', () => {
    const partial = searchParamsToQuery(new URLSearchParams({ from: '1000' }));
    expect(partial.dateRange).toBeNull();
  });
});

describe('queriesEqual', () => {
  it('returns true for two empty queries', () => {
    expect(queriesEqual(emptyQuery(), emptyQuery())).toBe(true);
  });

  it('detects types-only differences (regression for JSON.stringify(Set) returning "{}")', () => {
    // This is the bug B1 fixed: JSON.stringify(new Set([...])) yields "{}",
    // so two type-only-different queries serialized via JSON.stringify(query)
    // looked identical and back/forward URL changes silently no-op'd.
    const hypopnea: EventQuery = { ...emptyQuery(), types: new Set(['Hypopnea']) };
    const central: EventQuery = { ...emptyQuery(), types: new Set(['CentralApnea']) };
    expect(queriesEqual(hypopnea, central)).toBe(false);
  });

  it('treats type-set insertion order as semantically equivalent', () => {
    const a: EventQuery = {
      ...emptyQuery(),
      types: new Set(['ObstructiveApnea', 'Hypopnea']),
    };
    const b: EventQuery = {
      ...emptyQuery(),
      types: new Set(['Hypopnea', 'ObstructiveApnea']),
    };
    expect(queriesEqual(a, b)).toBe(true);
  });

  it('detects range-only differences', () => {
    const a: EventQuery = { ...emptyQuery(), duration: { min: 30, max: null } };
    const b: EventQuery = { ...emptyQuery(), duration: { min: 60, max: null } };
    expect(queriesEqual(a, b)).toBe(false);
  });

  it('detects dateRange-only differences', () => {
    const a: EventQuery = { ...emptyQuery(), dateRange: { start: 1000, end: 2000 } };
    const b: EventQuery = { ...emptyQuery(), dateRange: { start: 1000, end: 3000 } };
    expect(queriesEqual(a, b)).toBe(false);
  });
});
