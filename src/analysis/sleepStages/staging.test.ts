import { describe, it, expect } from 'vitest';
import type { Event, EventType } from '@/types/events';
import { tagEventsByStage, stageDurations, eventRatesByStage, type StageSegment } from './index';

const MIN = 60_000;

function makeEvent(timestamp: number, type: EventType = 'ObstructiveApnea'): Event {
  return {
    id: `evt-${timestamp}-${type}`,
    sessionId: 's',
    type,
    timestamp,
    duration: 15,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
  };
}

function seg(stage: StageSegment['stage'], startMs: number, endMs: number): StageSegment {
  return { stage, startMs, endMs };
}

describe('tagEventsByStage', () => {
  // Hypnogram: [0,10min) light, [10,20) deep, [20,30) rem, [40,50) wake
  // Note the gap [30min,40min) has no coverage.
  const segments = [
    seg('light', 0, 10 * MIN),
    seg('deep', 10 * MIN, 20 * MIN),
    seg('rem', 20 * MIN, 30 * MIN),
    seg('wake', 40 * MIN, 50 * MIN),
  ];

  it('tags events to the containing segment', () => {
    const events = [makeEvent(5 * MIN), makeEvent(15 * MIN), makeEvent(25 * MIN)];
    const tagged = tagEventsByStage(events, segments);
    expect(tagged.map((t) => t.stage)).toEqual(['light', 'deep', 'rem']);
  });

  it('honours half-open [start, end): start inclusive, end exclusive', () => {
    // t = 10min is the boundary: belongs to deep (start), not light (end).
    expect(tagEventsByStage([makeEvent(10 * MIN)], segments)[0]!.stage).toBe('deep');
    // t = 20min boundary -> rem.
    expect(tagEventsByStage([makeEvent(20 * MIN)], segments)[0]!.stage).toBe('rem');
    // t = 0 -> light (start inclusive).
    expect(tagEventsByStage([makeEvent(0)], segments)[0]!.stage).toBe('light');
  });

  it('returns null when the timestamp falls in no segment (no coverage)', () => {
    // Gap [30,40)min, and end of last segment (50min exclusive) and before 0.
    expect(tagEventsByStage([makeEvent(35 * MIN)], segments)[0]!.stage).toBeNull();
    expect(tagEventsByStage([makeEvent(50 * MIN)], segments)[0]!.stage).toBeNull();
    expect(tagEventsByStage([makeEvent(-1)], segments)[0]!.stage).toBeNull();
  });

  it('is robust to unsorted segment input', () => {
    const shuffled = [segments[2]!, segments[0]!, segments[3]!, segments[1]!];
    const tagged = tagEventsByStage([makeEvent(15 * MIN)], shuffled);
    expect(tagged[0]!.stage).toBe('deep');
  });

  it('preserves event order', () => {
    const events = [makeEvent(25 * MIN), makeEvent(5 * MIN)];
    const tagged = tagEventsByStage(events, segments);
    expect(tagged[0]!.event.timestamp).toBe(25 * MIN);
    expect(tagged[1]!.event.timestamp).toBe(5 * MIN);
  });

  it('returns null stage for all events when there is no coverage', () => {
    const tagged = tagEventsByStage([makeEvent(5 * MIN)], []);
    expect(tagged[0]!.stage).toBeNull();
  });
});

describe('stageDurations', () => {
  it('sums non-overlapping durations per stage with derived roll-ups', () => {
    const segments = [
      seg('deep', 0, 10 * MIN),
      seg('light', 10 * MIN, 30 * MIN),
      seg('rem', 30 * MIN, 40 * MIN),
      seg('wake', 40 * MIN, 45 * MIN),
    ];
    const d = stageDurations(segments);
    expect(d.deep).toBe(10 * MIN);
    expect(d.light).toBe(20 * MIN);
    expect(d.rem).toBe(10 * MIN);
    expect(d.wake).toBe(5 * MIN);
    expect(d.nremMs).toBe(30 * MIN); // deep + light
    expect(d.remMs).toBe(10 * MIN);
    expect(d.asleepMs).toBe(40 * MIN); // deep + light + rem
  });

  it('merges overlapping segments of the SAME stage (no double count)', () => {
    // Two overlapping light segments [0,20) and [10,30) -> union [0,30) = 30min.
    const segments = [seg('light', 0, 20 * MIN), seg('light', 10 * MIN, 30 * MIN)];
    const d = stageDurations(segments);
    expect(d.light).toBe(30 * MIN);
  });

  it('merges adjacent same-stage segments', () => {
    const segments = [seg('deep', 0, 10 * MIN), seg('deep', 10 * MIN, 25 * MIN)];
    expect(stageDurations(segments).deep).toBe(25 * MIN);
  });

  it('drops invalid (zero/negative length, non-finite) segments', () => {
    const segments = [
      seg('rem', 0, 10 * MIN),
      seg('rem', 5 * MIN, 5 * MIN), // zero length
      seg('rem', 20 * MIN, 15 * MIN), // negative length
    ];
    expect(stageDurations(segments).rem).toBe(10 * MIN);
  });

  it('returns all zeros for empty input', () => {
    const d = stageDurations([]);
    expect(d).toEqual({
      deep: 0,
      light: 0,
      rem: 0,
      wake: 0,
      nremMs: 0,
      remMs: 0,
      asleepMs: 0,
    });
  });
});

describe('eventRatesByStage', () => {
  it('computes count, hours and rate per hour per bucket', () => {
    // 60 min light = 1h, 30 min rem = 0.5h.
    const segments = [seg('light', 0, 60 * MIN), seg('rem', 60 * MIN, 90 * MIN)];
    const durations = stageDurations(segments);
    const events = [
      makeEvent(10 * MIN), // light
      makeEvent(20 * MIN), // light
      makeEvent(70 * MIN), // rem
      makeEvent(200 * MIN), // uncovered -> unknown
    ];
    const tagged = tagEventsByStage(events, segments);
    const rates = eventRatesByStage(tagged, durations);

    const byStage = Object.fromEntries(rates.map((r) => [r.stage, r]));
    expect(byStage.light!.count).toBe(2);
    expect(byStage.light!.hours).toBeCloseTo(1, 10);
    expect(byStage.light!.ratePerHour).toBeCloseTo(2, 10);
    expect(byStage.rem!.count).toBe(1);
    expect(byStage.rem!.ratePerHour).toBeCloseTo(2, 10); // 1 / 0.5h
    expect(byStage.deep!.ratePerHour).toBeNull(); // no deep time
    expect(byStage.unknown!.count).toBe(1);
    expect(byStage.unknown!.ratePerHour).toBeNull(); // no denominator
  });

  it('filters to AHI types when ahiOnly is set', () => {
    const segments = [seg('light', 0, 60 * MIN)];
    const durations = stageDurations(segments);
    const events = [
      makeEvent(10 * MIN, 'ObstructiveApnea'),
      makeEvent(20 * MIN, 'RERA'), // not AHI
      makeEvent(30 * MIN, 'Hypopnea'),
    ];
    const tagged = tagEventsByStage(events, segments);
    const all = eventRatesByStage(tagged, durations);
    const ahi = eventRatesByStage(tagged, durations, { ahiOnly: true });
    expect(all.find((r) => r.stage === 'light')!.count).toBe(3);
    expect(ahi.find((r) => r.stage === 'light')!.count).toBe(2);
  });

  it('returns per-type counts', () => {
    const segments = [seg('rem', 0, 60 * MIN)];
    const durations = stageDurations(segments);
    const events = [
      makeEvent(1 * MIN, 'ObstructiveApnea'),
      makeEvent(2 * MIN, 'ObstructiveApnea'),
      makeEvent(3 * MIN, 'Hypopnea'),
    ];
    const tagged = tagEventsByStage(events, segments);
    const rem = eventRatesByStage(tagged, durations).find((r) => r.stage === 'rem')!;
    expect(rem.byType.ObstructiveApnea).toBe(2);
    expect(rem.byType.Hypopnea).toBe(1);
  });

  it('always returns the five buckets in fixed order', () => {
    const rates = eventRatesByStage([], stageDurations([]));
    expect(rates.map((r) => r.stage)).toEqual(['deep', 'light', 'rem', 'wake', 'unknown']);
  });
});
