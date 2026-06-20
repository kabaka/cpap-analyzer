import { describe, it, expect } from 'vitest';
import type { Event, EventType } from '@/types/events';
import { eventTriggeredHr, type HrSample } from './index';

const SEC = 1000;

function makeEvent(timestampMs: number, type: EventType = 'ObstructiveApnea'): Event {
  return {
    id: `e-${timestampMs}`,
    sessionId: 's',
    type,
    timestamp: timestampMs,
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

/**
 * Build a 5-s-cadence HR series across [-60s, +60s] around `t0`:
 * 60 bpm before the event marker, 80 bpm at/after it.
 */
function hrAround(t0: number, pre = 60, post = 80): HrSample[] {
  const out: HrSample[] = [];
  for (let s = -60; s <= 60; s += 5) {
    out.push({ timestampMs: t0 + s * SEC, bpm: s < 0 ? pre : post });
  }
  return out;
}

describe('eventTriggeredHr', () => {
  it('computes the surge as peak-post minus baseline-pre', () => {
    const t0 = 1_000_000;
    const event = makeEvent(t0);
    const hr = hrAround(t0, 60, 80);
    const res = eventTriggeredHr([event], hr, {
      preWindowSec: 30,
      postWindowSec: 45,
      binSec: 5,
    });

    expect(res.sufficientData).toBe(true);
    expect(res.nEventsAnalyzed).toBe(1);
    // Baseline = 60 (all pre bins), peak post = 80. Surge = 20.
    expect(res.meanSurgeBpm).toBeCloseTo(20, 9);
    expect(res.medianSurgeBpm).toBeCloseTo(20, 9);
    expect(res.fractionWithSurge).toBeCloseTo(1, 9); // 20 >= 6
  });

  it('builds an average profile across multiple events', () => {
    const events = [makeEvent(1_000_000), makeEvent(2_000_000)];
    const hr = [...hrAround(1_000_000, 60, 80), ...hrAround(2_000_000, 70, 90)];
    const res = eventTriggeredHr(events, hr, {
      preWindowSec: 30,
      postWindowSec: 45,
      binSec: 5,
    });
    expect(res.nEventsAnalyzed).toBe(2);
    // Bin at relSec=-30: event1=60, event2=70 -> mean 65, n=2.
    const preBin = res.averageProfile.find((p) => p.relSec === -30)!;
    expect(preBin.n).toBe(2);
    expect(preBin.meanBpm).toBeCloseTo(65, 9);
    // Bin at relSec=+30: event1=80, event2=90 -> mean 85.
    const postBin = res.averageProfile.find((p) => p.relSec === 30)!;
    expect(postBin.meanBpm).toBeCloseTo(85, 9);
    // Surges: 20 and 20 -> mean 20.
    expect(res.meanSurgeBpm).toBeCloseTo(20, 9);
  });

  it('excludes events with insufficient bin coverage', () => {
    // Provide HR only for one of two events.
    const events = [makeEvent(1_000_000), makeEvent(9_000_000)];
    const hr = hrAround(1_000_000, 60, 80); // covers only event 1
    const res = eventTriggeredHr(events, hr, { minCoveragePerEvent: 0.5 });
    expect(res.nEventsAnalyzed).toBe(1);
  });

  it('reports a small fractionWithSurge when surge is below threshold', () => {
    const t0 = 1_000_000;
    const hr = hrAround(t0, 60, 63); // surge = 3 < 6
    const res = eventTriggeredHr([makeEvent(t0)], hr, { surgeThresholdBpm: 6 });
    expect(res.meanSurgeBpm).toBeCloseTo(3, 9);
    expect(res.fractionWithSurge).toBeCloseTo(0, 9);
  });

  it('only analyses AHI-type events', () => {
    const t0 = 1_000_000;
    const hr = hrAround(t0, 60, 80);
    const res = eventTriggeredHr([makeEvent(t0, 'RERA')], hr);
    expect(res.nEventsAnalyzed).toBe(0);
    expect(res.sufficientData).toBe(false);
  });

  it('filters HR by minConfidence when provided', () => {
    const t0 = 1_000_000;
    // All samples low confidence -> dropped -> no coverage.
    const hr = hrAround(t0, 60, 80).map((s) => ({ ...s, confidence: 0 }));
    const res = eventTriggeredHr([makeEvent(t0)], hr, { minConfidence: 2 });
    expect(res.nEventsAnalyzed).toBe(0);
    expect(res.sufficientData).toBe(false);
  });

  it('returns a graceful empty result with no HR data', () => {
    const res = eventTriggeredHr([makeEvent(1_000_000)], []);
    expect(res.sufficientData).toBe(false);
    expect(res.nEventsAnalyzed).toBe(0);
    expect(res.meanSurgeBpm).toBeNull();
    expect(res.fractionWithSurge).toBeNull();
    // Profile grid still present.
    expect(res.averageProfile.length).toBeGreaterThan(0);
  });

  it('does not interpolate across gaps wider than half a bin', () => {
    const t0 = 1_000_000;
    // Sparse samples every 30s: many bins (5s) will be uncovered.
    const hr: HrSample[] = [];
    for (let s = -60; s <= 60; s += 30) {
      hr.push({ timestampMs: t0 + s * SEC, bpm: s < 0 ? 60 : 80 });
    }
    const res = eventTriggeredHr([makeEvent(t0)], hr, {
      preWindowSec: 30,
      postWindowSec: 45,
      binSec: 5,
      minCoveragePerEvent: 0.9, // require dense coverage -> excluded
    });
    expect(res.nEventsAnalyzed).toBe(0);
  });
});
