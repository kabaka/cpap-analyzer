import { describe, it, expect } from 'vitest';
import type { Event, EventType } from '@/types/events';
import {
  deriveSleepCycles,
  assignEventsToCycles,
  eventLoadByCycle,
  cyclePositionTrend,
  type StageSegment,
  type Cycle,
} from './index';

const MIN = 60_000;

function seg(stage: StageSegment['stage'], startMin: number, endMin: number): StageSegment {
  return { stage, startMs: startMin * MIN, endMs: endMin * MIN };
}

function makeEvent(timestampMin: number, type: EventType = 'ObstructiveApnea'): Event {
  return {
    id: `e-${timestampMin}`,
    sessionId: 's',
    type,
    timestamp: timestampMin * MIN,
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

describe('deriveSleepCycles', () => {
  // Hypnogram (minutes):
  //  light [0,80), rem [80,100)            -> ep1 = [80,100)
  //  light [100,180), rem [180,190),
  //  light [190,200) (10-min gap <=15),
  //  rem [200,210)                         -> ep2 merged = [180,210)
  //  light [210,260) trailing NREM tail    -> incomplete cycle
  const segments = [
    seg('light', 0, 80),
    seg('rem', 80, 100),
    seg('light', 100, 180),
    seg('rem', 180, 190),
    seg('light', 190, 200),
    seg('rem', 200, 210),
    seg('light', 210, 260),
  ];

  it('derives the expected cycles, boundaries, and REM merge', () => {
    const cycles = deriveSleepCycles(segments);
    expect(cycles).toHaveLength(3);

    const [c1, c2, c3] = cycles as [Cycle, Cycle, Cycle];

    // Cycle 1: onset (0) to end of ep1 (100min).
    expect(c1.index).toBe(1);
    expect(c1.startMs).toBe(0);
    expect(c1.endMs).toBe(100 * MIN);
    expect(c1.hasRem).toBe(true);
    expect(c1.remMin).toBe(20); // [80,100)
    expect(c1.nremMin).toBe(80); // [0,80)

    // Cycle 2: 100min to end of merged ep2 (210min).
    expect(c2.index).toBe(2);
    expect(c2.startMs).toBe(100 * MIN);
    expect(c2.endMs).toBe(210 * MIN);
    expect(c2.hasRem).toBe(true);
    // REM within [100,210): [180,190) + [200,210) = 20 min.
    expect(c2.remMin).toBe(20);
    // NREM within [100,210): [100,180) + [190,200) = 80 + 10 = 90 min.
    expect(c2.nremMin).toBe(90);

    // Cycle 3: trailing NREM tail [210,260), incomplete (no REM).
    expect(c3.index).toBe(3);
    expect(c3.startMs).toBe(210 * MIN);
    expect(c3.endMs).toBe(260 * MIN);
    expect(c3.hasRem).toBe(false);
    expect(c3.remMin).toBe(0);
    expect(c3.nremMin).toBe(50);
    expect(c3.durationMin).toBe(50);
  });

  it('splits REM runs separated by a gap > 15 min into two episodes', () => {
    // light[0,60) rem[60,70) light[70,100) rem[100,110) light[110,130)
    // gap between REM runs = 30 min > 15 -> two episodes, two complete cycles + tail.
    const segs = [
      seg('light', 0, 60),
      seg('rem', 60, 70),
      seg('light', 70, 100),
      seg('rem', 100, 110),
      seg('light', 110, 130),
    ];
    const cycles = deriveSleepCycles(segs);
    expect(cycles).toHaveLength(3);
    expect(cycles[0]!.endMs).toBe(70 * MIN);
    expect(cycles[1]!.endMs).toBe(110 * MIN);
    expect(cycles[1]!.hasRem).toBe(true);
    expect(cycles[2]!.hasRem).toBe(false); // tail [110,130)
  });

  it('restricts to the sleep period (leading/trailing wake excluded)', () => {
    const segs = [
      seg('wake', 0, 30),
      seg('light', 30, 90),
      seg('rem', 90, 110),
      seg('wake', 110, 140),
    ];
    const cycles = deriveSleepCycles(segs);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.startMs).toBe(30 * MIN); // sleep onset, not 0
    expect(cycles[0]!.endMs).toBe(110 * MIN); // final non-wake end
  });

  it('treats interior wake as part of the current cycle (no new cycle on wake)', () => {
    const segs = [
      seg('light', 0, 50),
      seg('wake', 50, 60), // arousal inside cycle
      seg('light', 60, 90),
      seg('rem', 90, 110),
    ];
    const cycles = deriveSleepCycles(segs);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.startMs).toBe(0);
    expect(cycles[0]!.endMs).toBe(110 * MIN);
  });

  it('returns an empty array when there is no sleep', () => {
    expect(deriveSleepCycles([seg('wake', 0, 60)])).toEqual([]);
    expect(deriveSleepCycles([])).toEqual([]);
  });

  it('emits a single incomplete cycle when there is no REM at all', () => {
    const cycles = deriveSleepCycles([seg('light', 0, 60), seg('deep', 60, 120)]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.hasRem).toBe(false);
    expect(cycles[0]!.startMs).toBe(0);
    expect(cycles[0]!.endMs).toBe(120 * MIN);
  });
});

describe('assignEventsToCycles', () => {
  const cycles: Cycle[] = [
    {
      index: 1,
      startMs: 0,
      endMs: 100 * MIN,
      durationMin: 100,
      remMin: 20,
      nremMin: 80,
      hasRem: true,
    },
    {
      index: 2,
      startMs: 100 * MIN,
      endMs: 210 * MIN,
      durationMin: 110,
      remMin: 20,
      nremMin: 90,
      hasRem: true,
    },
  ];

  it('assigns events to the containing cycle (half-open)', () => {
    const events = [makeEvent(50), makeEvent(150), makeEvent(100)];
    const tagged = assignEventsToCycles(events, cycles);
    expect(tagged.map((t) => t.cycleIndex)).toEqual([1, 2, 2]); // 100min boundary -> cycle 2
  });

  it('returns null for events outside all cycles', () => {
    const tagged = assignEventsToCycles([makeEvent(300), makeEvent(-5)], cycles);
    expect(tagged.map((t) => t.cycleIndex)).toEqual([null, null]);
  });
});

describe('eventLoadByCycle', () => {
  const cycles: Cycle[] = [
    {
      index: 1,
      startMs: 0,
      endMs: 60 * MIN,
      durationMin: 60,
      remMin: 10,
      nremMin: 50,
      hasRem: true,
    },
    {
      index: 2,
      startMs: 60 * MIN,
      endMs: 120 * MIN,
      durationMin: 60,
      remMin: 20,
      nremMin: 40,
      hasRem: true,
    },
  ];

  it('counts events and computes rate per hour per cycle', () => {
    const events = [makeEvent(10), makeEvent(20), makeEvent(30), makeEvent(70)];
    const load = eventLoadByCycle(events, cycles);
    expect(load[0]!.count).toBe(3);
    expect(load[0]!.durationHours).toBeCloseTo(1, 9);
    expect(load[0]!.ratePerHour).toBeCloseTo(3, 9);
    expect(load[1]!.count).toBe(1);
    expect(load[1]!.ratePerHour).toBeCloseTo(1, 9);
  });

  it('respects ahiOnly', () => {
    const events = [makeEvent(10, 'RERA'), makeEvent(20, 'ObstructiveApnea')];
    const load = eventLoadByCycle(events, cycles, { ahiOnly: true });
    expect(load[0]!.count).toBe(1);
  });
});

describe('cyclePositionTrend', () => {
  it('compares pooled first-half vs second-half rates', () => {
    const perCycle = [
      { index: 1, count: 2, durationHours: 1, ratePerHour: 2, hasRem: true },
      { index: 2, count: 2, durationHours: 1, ratePerHour: 2, hasRem: true },
      { index: 3, count: 10, durationHours: 1, ratePerHour: 10, hasRem: true },
      { index: 4, count: 10, durationHours: 1, ratePerHour: 10, hasRem: false },
    ];
    const trend = cyclePositionTrend(perCycle);
    // first half = cycles 1,2 -> (2+2)/(1+1)=2; second half = 3,4 -> 20/2=10.
    expect(trend.firstHalfRate).toBeCloseTo(2, 9);
    expect(trend.secondHalfRate).toBeCloseTo(10, 9);
    expect(trend.slope).toBeCloseTo(8, 9);
    expect(trend.note).toMatch(/later cycles/);
  });

  it('returns nulls for zero or single cycle', () => {
    expect(cyclePositionTrend([]).slope).toBeNull();
    expect(
      cyclePositionTrend([{ index: 1, count: 5, durationHours: 1, ratePerHour: 5, hasRem: true }])
        .slope,
    ).toBeNull();
  });
});
