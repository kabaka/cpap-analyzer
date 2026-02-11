import { describe, it, expect } from 'vitest';
import type { Event } from '@/types/events';
import type { EventType } from '@/types/events';
import {
  clusterEventsFLGBridged,
  clusterEventsKMeans,
  clusterEventsAgglomerative,
  eventDurationDistribution,
  interEventIntervals,
  detectFalseNegatives,
} from './index';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<Event> & { timestamp: number }): Event {
  return {
    id: `evt-${overrides.timestamp}`,
    sessionId: 'test-session',
    type: 'ObstructiveApnea',
    duration: 15,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// clusterEventsFLGBridged
// ---------------------------------------------------------------------------

describe('clusterEventsFLGBridged', () => {
  it('should cluster 5 nearby events into 1 cluster with strict preset', () => {
    // Events 60 s apart, duration 15 s → gap = 60000 - 15000 = 45000 ms ≤ 60000 ms
    const events = [0, 60_000, 120_000, 180_000, 240_000].map((t) => makeEvent({ timestamp: t }));

    const result = clusterEventsFLGBridged(events, 'strict');

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.events).toHaveLength(5);
    expect(result.unclustered).toHaveLength(0);
  });

  it('should split events into 2 clusters when gap exceeds balanced threshold', () => {
    // Group 1: 0, 60k, 120k. Group 2: 320k, 380k, 440k
    // Gap between groups: 320000 - (120000 + 15000) = 185000 ms > 120000 ms
    const events = [0, 60_000, 120_000, 320_000, 380_000, 440_000].map((t) =>
      makeEvent({ timestamp: t }),
    );

    const result = clusterEventsFLGBridged(events, 'balanced');

    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]!.events).toHaveLength(3);
    expect(result.clusters[1]!.events).toHaveLength(3);
    expect(result.unclustered).toHaveLength(0);
  });

  it('should merge in lenient mode what balanced mode splits', () => {
    // Same data as two-cluster balanced test. 185000 ms gap ≤ 300000 ms lenient threshold
    const events = [0, 60_000, 120_000, 320_000, 380_000, 440_000].map((t) =>
      makeEvent({ timestamp: t }),
    );

    const result = clusterEventsFLGBridged(events, 'lenient');

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.events).toHaveLength(6);
    expect(result.unclustered).toHaveLength(0);
  });

  it('should move events to unclustered when below min cluster size (strict=3)', () => {
    // 2 nearby events, strict requires min 3
    const events = [0, 30_000].map((t) => makeEvent({ timestamp: t }));

    const result = clusterEventsFLGBridged(events, 'strict');

    expect(result.clusters).toHaveLength(0);
    expect(result.unclustered).toHaveLength(2);
  });

  it('should return empty clusters and unclustered for empty input', () => {
    const result = clusterEventsFLGBridged([], 'balanced');

    expect(result.clusters).toHaveLength(0);
    expect(result.unclustered).toHaveLength(0);
  });

  it('should place a single event in unclustered (below min size for all presets)', () => {
    const events = [makeEvent({ timestamp: 0 })];

    // balanced requires min 2
    const result = clusterEventsFLGBridged(events, 'balanced');

    expect(result.clusters).toHaveLength(0);
    expect(result.unclustered).toHaveLength(1);
  });

  it('should compute density and weightedDensity correctly', () => {
    // 3 events, each 15 s, timestamps 0, 60000, 120000
    // Cluster span: startTime=0, endTime=120000+15000=135000, duration=135s=2.25min
    // density = 3 / 2.25 = 1.333...
    // totalEventDuration = 3 × 15 = 45 s, weightedDensity = 45 / 2.25 = 20
    const events = [0, 60_000, 120_000].map((t) => makeEvent({ timestamp: t }));

    const result = clusterEventsFLGBridged(events, 'balanced');

    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0]!;
    expect(cluster.density).toBeCloseTo(3 / 2.25, 5);
    expect(cluster.weightedDensity).toBeCloseTo(45 / 2.25, 5);
    expect(cluster.duration).toBeCloseTo(135, 5);
  });

  it('should default to balanced preset when not specified', () => {
    // 2 events within balanced maxGap (120 s). balanced minCluster=2 → cluster
    // strict would reject (minCluster=3)
    const events = [0, 60_000].map((t) => makeEvent({ timestamp: t }));

    const result = clusterEventsFLGBridged(events);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// clusterEventsKMeans
// ---------------------------------------------------------------------------

describe('clusterEventsKMeans', () => {
  it('should find 2 well-separated clusters', () => {
    // 3 events near t=0, 3 events near t=1000000 ms
    const events = [
      makeEvent({ timestamp: 0, duration: 10 }),
      makeEvent({ timestamp: 5_000, duration: 10 }),
      makeEvent({ timestamp: 10_000, duration: 10 }),
      makeEvent({ timestamp: 1_000_000, duration: 10 }),
      makeEvent({ timestamp: 1_005_000, duration: 10 }),
      makeEvent({ timestamp: 1_010_000, duration: 10 }),
    ];

    const result = clusterEventsKMeans(events, { k: 2, seed: 42 });

    expect(result.clusters).toHaveLength(2);
    // Each cluster should have 3 events
    const sizes = result.clusters.map((c) => c.events.length).sort();
    expect(sizes).toEqual([3, 3]);
  });

  it('should put all events in one cluster when k=1', () => {
    const events = [0, 60_000, 120_000, 500_000].map((t) => makeEvent({ timestamp: t }));

    const result = clusterEventsKMeans(events, { k: 1, seed: 1 });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.events).toHaveLength(4);
    expect(result.unclustered).toHaveLength(0);
  });

  it('should return empty result for empty events', () => {
    const result = clusterEventsKMeans([], { k: 2 });

    expect(result.clusters).toHaveLength(0);
    expect(result.unclustered).toHaveLength(0);
  });

  it('should converge to correct clusters for known data', () => {
    // Two tight groups, well separated
    const events = [
      makeEvent({ timestamp: 100, duration: 5 }),
      makeEvent({ timestamp: 200, duration: 5 }),
      makeEvent({ timestamp: 300, duration: 5 }),
      makeEvent({ timestamp: 100_000, duration: 5 }),
      makeEvent({ timestamp: 100_100, duration: 5 }),
      makeEvent({ timestamp: 100_200, duration: 5 }),
    ];

    const result = clusterEventsKMeans(events, { k: 2, seed: 123 });

    expect(result.clusters).toHaveLength(2);

    // First cluster should contain the low-timestamp events
    const firstCluster = result.clusters[0]!;
    const secondCluster = result.clusters[1]!;

    expect(firstCluster.startTime).toBeLessThan(1_000);
    expect(secondCluster.startTime).toBeGreaterThan(99_000);
  });
});

// ---------------------------------------------------------------------------
// clusterEventsAgglomerative
// ---------------------------------------------------------------------------

describe('clusterEventsAgglomerative', () => {
  it('should merge consecutive events within default maxGap (300 s)', () => {
    // Events 60 s apart, gap = 60000 - 15000 = 45000 ms < 300000 ms → merge
    const events = [0, 60_000, 120_000, 180_000].map((t) => makeEvent({ timestamp: t }));

    const result = clusterEventsAgglomerative(events);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.events).toHaveLength(4);
  });

  it('should create separate clusters when gap exceeds maxGap', () => {
    // Gap between groups: 500000 - (120000 + 15000) = 365000 ms ≥ 300000 ms → split
    const events = [0, 60_000, 120_000, 500_000, 560_000].map((t) => makeEvent({ timestamp: t }));

    const result = clusterEventsAgglomerative(events, 300);

    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]!.events).toHaveLength(3);
    expect(result.clusters[1]!.events).toHaveLength(2);
  });

  it('should produce different cluster counts with different maxGap values', () => {
    // Events: 0, 60k, 200k, 260k
    // Gap between event 1 and 2: 200000 - (60000 + 15000) = 125000 ms = 125 s
    const events = [0, 60_000, 200_000, 260_000].map((t) => makeEvent({ timestamp: t }));

    const small = clusterEventsAgglomerative(events, 100);
    const large = clusterEventsAgglomerative(events, 200);

    // Gap 125s > 100s → split into 2 clusters; 125s < 200s → merge into fewer
    expect(small.clusters.length).toBeGreaterThan(large.clusters.length);
  });

  it('should return empty result for empty events', () => {
    const result = clusterEventsAgglomerative([]);

    expect(result.clusters).toHaveLength(0);
    expect(result.unclustered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// eventDurationDistribution
// ---------------------------------------------------------------------------

describe('eventDurationDistribution', () => {
  it('should compute correct stats for a single event type', () => {
    const durations = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
    const events = durations.map((d, i) => makeEvent({ timestamp: i * 60_000, duration: d }));

    const result = eventDurationDistribution(events);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('ObstructiveApnea');
    expect(result[0]!.count).toBe(10);
    expect(result[0]!.mean).toBeCloseTo(19, 5);
    expect(result[0]!.median).toBeCloseTo(19, 5);
    expect(result[0]!.min).toBe(10);
    expect(result[0]!.max).toBe(28);
  });

  it('should group stats by event type for mixed types', () => {
    const events = [
      makeEvent({ timestamp: 0, duration: 10, type: 'ObstructiveApnea' as EventType }),
      makeEvent({ timestamp: 60_000, duration: 20, type: 'ObstructiveApnea' as EventType }),
      makeEvent({ timestamp: 120_000, duration: 5, type: 'Hypopnea' as EventType }),
      makeEvent({ timestamp: 180_000, duration: 8, type: 'Hypopnea' as EventType }),
    ];

    const result = eventDurationDistribution(events);

    expect(result).toHaveLength(2);
    // Sorted by type name: Hypopnea before ObstructiveApnea
    expect(result[0]!.type).toBe('Hypopnea');
    expect(result[0]!.count).toBe(2);
    expect(result[0]!.mean).toBeCloseTo(6.5, 5);

    expect(result[1]!.type).toBe('ObstructiveApnea');
    expect(result[1]!.count).toBe(2);
    expect(result[1]!.mean).toBeCloseTo(15, 5);
  });

  it('should return empty array for empty events', () => {
    const result = eventDurationDistribution([]);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// interEventIntervals
// ---------------------------------------------------------------------------

describe('interEventIntervals', () => {
  it('should compute known intervals between 3 events', () => {
    // Intervals = (t2 - t1) / 1000 and (t3 - t2) / 1000
    const events = [
      makeEvent({ timestamp: 0 }),
      makeEvent({ timestamp: 60_000 }),
      makeEvent({ timestamp: 180_000 }),
    ];

    const result = interEventIntervals(events);

    expect(result.count).toBe(2);
    expect(result.intervals).toEqual([60, 120]);
    expect(result.mean).toBeCloseTo(90, 5);
    expect(result.median).toBeCloseTo(90, 5);
    expect(result.min).toBeCloseTo(60, 5);
    expect(result.max).toBeCloseTo(120, 5);
  });

  it('should return count=0 and NaN stats for single event', () => {
    const events = [makeEvent({ timestamp: 0 })];

    const result = interEventIntervals(events);

    expect(result.count).toBe(0);
    expect(result.intervals).toHaveLength(0);
    expect(result.mean).toBeNaN();
    expect(result.median).toBeNaN();
  });

  it('should return count=0 and NaN stats for empty events', () => {
    const result = interEventIntervals([]);

    expect(result.count).toBe(0);
    expect(result.mean).toBeNaN();
    expect(result.median).toBeNaN();
    expect(result.min).toBeNaN();
    expect(result.max).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// detectFalseNegatives
// ---------------------------------------------------------------------------

describe('detectFalseNegatives', () => {
  it('should detect a sustained above-threshold FLG region', () => {
    // 100 samples, 1 per second. First 50 at FLG=0.5, rest at 0.
    // Region duration = 49 s > 10 s (balanced min). No events → no overlap.
    const n = 100;
    const flg = new Float32Array(n);
    const ts = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ts[i] = i * 1_000;
      flg[i] = i < 50 ? 0.5 : 0;
    }

    const result = detectFalseNegatives(flg, ts, [], 'balanced');

    expect(result.detections.length).toBeGreaterThanOrEqual(1);
    expect(result.detections[0]!.peakFLG).toBeCloseTo(0.5, 5);
    expect(result.detections[0]!.duration).toBeGreaterThanOrEqual(10);
    expect(result.preset).toBe('balanced');
  });

  it('should exclude regions that overlap with scored events', () => {
    const n = 100;
    const flg = new Float32Array(n);
    const ts = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ts[i] = i * 1_000;
      flg[i] = i < 50 ? 0.5 : 0;
    }

    // Add an event covering the middle of the high-FLG region
    const events = [makeEvent({ timestamp: 25_000, duration: 10 })];

    const result = detectFalseNegatives(flg, ts, events, 'balanced');

    // The region overlaps with the event ± 5 s buffer → excluded
    expect(result.detections).toHaveLength(0);
  });

  it('should detect fewer regions with strict than with lenient', () => {
    // Signal with all values at 0.25:
    //   strict threshold=0.3  → 0.25 < 0.3 → no detections
    //   lenient threshold=0.15 → 0.25 > 0.15 → detections
    const n = 100;
    const flg = new Float32Array(n).fill(0.25);
    const ts = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ts[i] = i * 1_000;
    }

    const strict = detectFalseNegatives(flg, ts, [], 'strict');
    const lenient = detectFalseNegatives(flg, ts, [], 'lenient');

    expect(strict.detections.length).toBeLessThan(lenient.detections.length);
  });

  it('should return empty detections for empty signal', () => {
    const result = detectFalseNegatives(new Float32Array(0), new Float32Array(0), []);

    expect(result.detections).toHaveLength(0);
    expect(result.totalDuration).toBe(0);
  });

  it('should return empty detections for all-zero signal', () => {
    const n = 50;
    const flg = new Float32Array(n).fill(0);
    const ts = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ts[i] = i * 1_000;
    }

    const result = detectFalseNegatives(flg, ts, [], 'balanced');

    expect(result.detections).toHaveLength(0);
    expect(result.totalDuration).toBe(0);
  });
});
