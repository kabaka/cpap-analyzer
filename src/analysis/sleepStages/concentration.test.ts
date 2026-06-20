import { describe, it, expect } from 'vitest';
import type { Event, EventType } from '@/types/events';
import {
  eventStageConcentrationTest,
  tagEventsByStage,
  stageDurations,
  type StageSegment,
  type StageDurations,
  type TaggedEvent,
} from './index';

const MIN = 60_000;

function makeEvent(timestamp: number, type: EventType = 'ObstructiveApnea'): Event {
  return {
    id: `e-${timestamp}-${type}`,
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

/** Build tagged events directly with explicit stages (n copies per stage). */
function taggedCounts(counts: {
  deep?: number;
  light?: number;
  rem?: number;
  wake?: number;
  unknown?: number;
}): TaggedEvent[] {
  const out: TaggedEvent[] = [];
  let t = 0;
  const push = (stage: TaggedEvent['stage'], n: number) => {
    for (let i = 0; i < n; i++) out.push({ event: makeEvent(t++), stage });
  };
  push('deep', counts.deep ?? 0);
  push('light', counts.light ?? 0);
  push('rem', counts.rem ?? 0);
  push('wake', counts.wake ?? 0);
  push(null, counts.unknown ?? 0);
  return out;
}

/** Durations with equal time per stage (in hours), for clean expected counts. */
function equalDurations(hoursEach: number): StageDurations {
  const ms = hoursEach * 3_600_000;
  return {
    deep: ms,
    light: ms,
    rem: ms,
    wake: ms,
    nremMs: 2 * ms,
    remMs: ms,
    asleepMs: 3 * ms,
  };
}

describe('eventStageConcentrationTest', () => {
  it('matches a hand-computed chi-square for equal-time stages', () => {
    // Equal time per stage -> expected = N/3 each. Observed 10/10/40, N=60.
    // Expected = 20 each. X^2 = (10-20)^2/20 *2 + (40-20)^2/20 = 5+5+20 = 30, df=2.
    // For df=2 the upper tail is exactly exp(-X^2/2) = exp(-15).
    const tagged = taggedCounts({ deep: 10, light: 10, rem: 40 });
    const res = eventStageConcentrationTest(tagged, equalDurations(2));

    expect(res.totalEvents).toBe(60);
    expect(res.df).toBe(2);
    expect(res.expected.deep).toBeCloseTo(20, 9);
    expect(res.expected.light).toBeCloseTo(20, 9);
    expect(res.expected.rem).toBeCloseTo(20, 9);
    expect(res.chiSquare).toBeCloseTo(30, 9);
    expect(res.pValue).toBeCloseTo(Math.exp(-15), 12); // ≈ 3.059e-7
    expect(res.sufficientData).toBe(true);
  });

  it('excludes wake and unknown events from the test', () => {
    // Wake/unknown should not affect observed sleep-stage counts.
    const tagged = taggedCounts({ deep: 10, light: 10, rem: 40, wake: 100, unknown: 100 });
    const res = eventStageConcentrationTest(tagged, equalDurations(2));
    expect(res.totalEvents).toBe(60);
    expect(res.observed).toEqual({ deep: 10, light: 10, rem: 40 });
  });

  it('gives a high p-value when events match time-in-stage', () => {
    // Observed proportional to time -> X^2 ~ 0, p ~ 1.
    const tagged = taggedCounts({ deep: 20, light: 20, rem: 20 });
    const res = eventStageConcentrationTest(tagged, equalDurations(2));
    expect(res.chiSquare).toBeCloseTo(0, 9);
    expect(res.pValue).toBeCloseTo(1, 9);
  });

  it('flags insufficient data when total events below the minimum', () => {
    const tagged = taggedCounts({ deep: 2, light: 2, rem: 5 }); // N=9 < 20
    const res = eventStageConcentrationTest(tagged, equalDurations(2));
    expect(res.sufficientData).toBe(false);
    // Descriptive counts still present.
    expect(res.observed).toEqual({ deep: 2, light: 2, rem: 5 });
  });

  it('flags insufficient data when an expected cell < 5 (Cochran)', () => {
    // 30 events but rem has tiny time -> expected_rem small.
    const durations: StageDurations = {
      deep: 10 * 3_600_000,
      light: 10 * 3_600_000,
      rem: 0.1 * 3_600_000, // tiny REM time
      wake: 0,
      nremMs: 20 * 3_600_000,
      remMs: 0.1 * 3_600_000,
      asleepMs: 20.1 * 3_600_000,
    };
    const tagged = taggedCounts({ deep: 15, light: 14, rem: 1 });
    const res = eventStageConcentrationTest(tagged, durations);
    // expected_rem = 30 * 0.1/20.1 ≈ 0.149 < 5
    expect(res.expected.rem).toBeLessThan(5);
    expect(res.sufficientData).toBe(false);
  });

  it('reduces df to 1 when only two stages have positive time', () => {
    const durations: StageDurations = {
      deep: 0,
      light: 5 * 3_600_000,
      rem: 5 * 3_600_000,
      wake: 0,
      nremMs: 5 * 3_600_000,
      remMs: 5 * 3_600_000,
      asleepMs: 10 * 3_600_000,
    };
    const tagged = taggedCounts({ light: 30, rem: 30 });
    const res = eventStageConcentrationTest(tagged, durations);
    expect(res.df).toBe(1);
    expect(res.stagesUsed).toEqual(['light', 'rem']);
  });

  it('returns NaN stats when no sleep-stage events exist', () => {
    const res = eventStageConcentrationTest(taggedCounts({ wake: 10 }), equalDurations(2));
    expect(res.totalEvents).toBe(0);
    expect(Number.isNaN(res.chiSquare)).toBe(true);
    expect(Number.isNaN(res.pValue)).toBe(true);
    expect(res.sufficientData).toBe(false);
  });

  it('works end-to-end from segments and events', () => {
    // 2h each deep/light/rem; concentrate AHI events in rem.
    const segments: StageSegment[] = [
      { stage: 'deep', startMs: 0, endMs: 120 * MIN },
      { stage: 'light', startMs: 120 * MIN, endMs: 240 * MIN },
      { stage: 'rem', startMs: 240 * MIN, endMs: 360 * MIN },
    ];
    const durations = stageDurations(segments);
    const events: Event[] = [];
    for (let i = 0; i < 10; i++) events.push(makeEvent(10 * MIN + i));
    for (let i = 0; i < 10; i++) events.push(makeEvent(130 * MIN + i));
    for (let i = 0; i < 40; i++) events.push(makeEvent(250 * MIN + i));
    const tagged = tagEventsByStage(events, segments);
    const res = eventStageConcentrationTest(tagged, durations);
    expect(res.observed).toEqual({ deep: 10, light: 10, rem: 40 });
    expect(res.chiSquare).toBeCloseTo(30, 6);
  });
});
