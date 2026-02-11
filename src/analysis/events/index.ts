/**
 * Event Analysis Module
 *
 * Provides clustering algorithms (FLG-bridged, K-Means++, agglomerative),
 * duration distribution analysis, and inter-event interval analysis for
 * CPAP therapy events.
 *
 * @module analysis/events
 */

export * from './false-negatives';

import type { Event } from '@/types/events';
import { filterFinite } from '@/analysis/descriptive';
import { percentileFromSorted } from '@/analysis/math';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A cluster of temporally grouped therapy events. */
export interface Cluster {
  /** Unique identifier (e.g. `cluster-0`). */
  readonly id: string;
  /** Events belonging to this cluster. */
  readonly events: readonly Event[];
  /** Epoch ms of the earliest event in the cluster. */
  readonly startTime: number;
  /** Epoch ms of the latest event end (timestamp + duration * 1000). */
  readonly endTime: number;
  /** Cluster span in seconds. */
  readonly duration: number;
  /** Events per minute within the cluster span. */
  readonly density: number;
  /** Seconds of event duration per minute within the cluster span. */
  readonly weightedDensity: number;
  /** Heuristic severity: duration × density. */
  readonly severityScore: number;
}

/** Result of any clustering algorithm. */
export interface ClusterResult {
  /** Identified clusters, sorted by start time. */
  readonly clusters: readonly Cluster[];
  /** Events that did not meet the minimum cluster size requirement. */
  readonly unclustered: readonly Event[];
}

/** Preset sensitivity levels for FLG-bridged clustering. */
export type FLGPreset = 'strict' | 'balanced' | 'lenient';

/** Options for K-Means++ clustering. */
export interface KMeansOptions {
  /** Number of clusters (k). */
  readonly k: number;
  /** Feature dimensions to use. Defaults to `['timestamp', 'duration']`. */
  readonly features?: readonly ('timestamp' | 'duration')[];
  /** Maximum Lloyd iterations. Defaults to 100. */
  readonly maxIterations?: number;
  /** Seed for deterministic PRNG. When omitted, uses `Math.random`. */
  readonly seed?: number;
}

/** Descriptive statistics for event durations by type. */
export interface EventDurationStats {
  /** Event type label. */
  readonly type: string;
  /** Number of events. */
  readonly count: number;
  /** Arithmetic mean of durations (seconds). */
  readonly mean: number;
  /** Median duration (seconds). */
  readonly median: number;
  /** Minimum duration (seconds). */
  readonly min: number;
  /** Maximum duration (seconds). */
  readonly max: number;
  /** Sample standard deviation of durations (seconds). */
  readonly stdDev: number;
  /** 25th percentile duration (seconds). */
  readonly p25: number;
  /** 75th percentile duration (seconds). */
  readonly p75: number;
}

/** Result of inter-event interval analysis. */
export interface InterEventIntervalResult {
  /** Time gaps (seconds) between consecutive events. */
  readonly intervals: readonly number[];
  /** Arithmetic mean of intervals. */
  readonly mean: number;
  /** Median interval. */
  readonly median: number;
  /** Minimum interval. */
  readonly min: number;
  /** Maximum interval. */
  readonly max: number;
  /** Sample standard deviation of intervals. */
  readonly stdDev: number;
  /** Number of intervals (events.length - 1). */
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** FLG preset parameter table. */
interface PresetParams {
  readonly maxGapMs: number;
  readonly minClusterSize: number;
}

const PRESET_TABLE: Readonly<Record<FLGPreset, PresetParams>> = {
  strict: { maxGapMs: 60 * 1000, minClusterSize: 3 },
  balanced: { maxGapMs: 120 * 1000, minClusterSize: 2 },
  lenient: { maxGapMs: 300 * 1000, minClusterSize: 2 },
};

/** Sort events ascending by timestamp (returns a new, sorted copy). */
function sortByTimestamp(events: readonly Event[]): Event[] {
  return events.slice().sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Build a Cluster object from a group of events.
 * Assumes `events` is non-empty and already sorted by timestamp.
 */
function buildCluster(events: readonly Event[], id: string): Cluster {
  const first = events[0] as Event;
  const last = events[events.length - 1] as Event;

  const startTime = first.timestamp;
  const endTime = last.timestamp + last.duration * 1000;
  const durationMs = endTime - startTime;
  // Guard against zero-duration clusters (all events at same instant)
  const durationSec = Math.max(durationMs / 1000, 0);
  const durationMin = durationSec / 60;

  const totalEventDuration = events.reduce((sum, e) => sum + e.duration, 0);

  const density = durationMin > 0 ? events.length / durationMin : events.length;
  const weightedDensity = durationMin > 0 ? totalEventDuration / durationMin : totalEventDuration;
  const severityScore = durationSec * density;

  return {
    id,
    events,
    startTime,
    endTime,
    duration: durationSec,
    density,
    weightedDensity,
    severityScore,
  };
}

/**
 * Mulberry32 — a simple 32-bit seeded PRNG.
 * Returns a function that yields numbers in [0, 1).
 *
 * @see https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 1. FLG-Bridged Clustering (Schmitt Trigger Hysteresis)
// ---------------------------------------------------------------------------

/**
 * Cluster events using temporal-gap bridging with preset sensitivity levels.
 *
 * Events within `maxGap` seconds of each other are merged into the same
 * cluster. Clusters with fewer events than `minClusterSize` are dissolved
 * and their events returned as unclustered.
 *
 * @param events - Therapy events to cluster.
 * @param preset - Sensitivity preset (default `'balanced'`).
 * @returns Clusters and unclustered events.
 */
export function clusterEventsFLGBridged(
  events: Event[],
  preset: FLGPreset = 'balanced',
): ClusterResult {
  if (events.length === 0) {
    return { clusters: [], unclustered: [] };
  }

  const { maxGapMs, minClusterSize } = PRESET_TABLE[preset];
  const sorted = sortByTimestamp(events);

  // --- Build raw groups ---------------------------------------------------
  const groups: Event[][] = [];
  let currentGroup: Event[] = [sorted[0] as Event];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as Event;
    const curr = sorted[i] as Event;
    const gap = curr.timestamp - (prev.timestamp + prev.duration * 1000);

    if (gap <= maxGapMs) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  // --- Partition into clusters / unclustered ------------------------------
  const clusters: Cluster[] = [];
  const unclustered: Event[] = [];
  let clusterIndex = 0;

  for (const group of groups) {
    if (group.length >= minClusterSize) {
      clusters.push(buildCluster(group, `cluster-${clusterIndex}`));
      clusterIndex++;
    } else {
      unclustered.push(...group);
    }
  }

  return { clusters, unclustered };
}

// ---------------------------------------------------------------------------
// 2. K-Means++ Clustering
// ---------------------------------------------------------------------------

/**
 * Cluster events using the K-Means++ algorithm (Arthur & Vassilvitskii 2007).
 *
 * Features are normalised to [0, 1] before distance computation.
 * When `seed` is provided, a deterministic PRNG (mulberry32) is used.
 *
 * @param events - Therapy events to cluster.
 * @param options - K, feature selection, iteration limit, and optional seed.
 * @returns Clusters and unclustered events (empty when k ≥ 1).
 */
export function clusterEventsKMeans(events: Event[], options: KMeansOptions): ClusterResult {
  const { k, features = ['timestamp', 'duration'], maxIterations = 100, seed } = options;

  if (events.length === 0 || k <= 0) {
    return { clusters: [], unclustered: [] };
  }

  const sorted = sortByTimestamp(events);
  const n = sorted.length;
  const effectiveK = Math.min(k, n);

  const rand = seed !== undefined ? mulberry32(seed) : Math.random;

  // --- Extract & normalise features ---------------------------------------
  const dims = features.length;
  const raw: number[][] = sorted.map((e) =>
    features.map((f) => (f === 'timestamp' ? e.timestamp : e.duration)),
  );

  // Compute min/max per dimension
  const mins: number[] = new Array(dims).fill(Infinity) as number[];
  const maxs: number[] = new Array(dims).fill(-Infinity) as number[];
  for (const point of raw) {
    for (let d = 0; d < dims; d++) {
      const v = point[d] as number;
      if (v < (mins[d] as number)) mins[d] = v;
      if (v > (maxs[d] as number)) maxs[d] = v;
    }
  }

  const ranges: number[] = mins.map((mn, d) => {
    const r = (maxs[d] as number) - mn;
    return r > 0 ? r : 1; // avoid division by zero
  });

  const normalised: number[][] = raw.map((pt) =>
    pt.map((v, d) => ((v as number) - (mins[d] as number)) / (ranges[d] as number)),
  );

  // --- Squared Euclidean distance -----------------------------------------
  const sqDist = (a: number[], b: number[]): number => {
    let sum = 0;
    for (let d = 0; d < dims; d++) {
      const diff = (a[d] as number) - (b[d] as number);
      sum += diff * diff;
    }
    return sum;
  };

  // --- K-Means++ initialisation -------------------------------------------
  const centroids: number[][] = [];

  // First centroid: random
  const firstIdx = Math.floor(rand() * n);
  centroids.push(normalised[firstIdx] as number[]);

  for (let c = 1; c < effectiveK; c++) {
    // Compute D²(x) = distance to nearest existing centroid
    const dSq: number[] = new Array(n) as number[];
    let totalDSq = 0;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (const centroid of centroids) {
        const d = sqDist(normalised[i] as number[], centroid);
        if (d < minD) minD = d;
      }
      dSq[i] = minD;
      totalDSq += minD;
    }

    // Weighted random selection
    if (totalDSq === 0) {
      // All remaining points coincide with existing centroids
      centroids.push(normalised[Math.floor(rand() * n)] as number[]);
      continue;
    }

    let r = rand() * totalDSq;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      r -= dSq[i] as number;
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(normalised[chosen] as number[]);
  }

  // --- Lloyd iterations ---------------------------------------------------
  const assignments: number[] = new Array(n).fill(0) as number[];

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < effectiveK; c++) {
        const d = sqDist(normalised[i] as number[], centroids[c] as number[]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }

    if (!changed) break;

    // Update centroids
    const sums: number[][] = Array.from(
      { length: effectiveK },
      () => new Array(dims).fill(0) as number[],
    );
    const counts: number[] = new Array(effectiveK).fill(0) as number[];

    for (let i = 0; i < n; i++) {
      const c = assignments[i] as number;
      counts[c] = (counts[c] as number) + 1;
      const s = sums[c] as number[];
      const pt = normalised[i] as number[];
      for (let d = 0; d < dims; d++) {
        s[d] = (s[d] as number) + (pt[d] as number);
      }
    }

    for (let c = 0; c < effectiveK; c++) {
      const cnt = counts[c] as number;
      if (cnt === 0) continue;
      const s = sums[c] as number[];
      centroids[c] = s.map((v) => v / cnt);
    }
  }

  // --- Build clusters from assignments ------------------------------------
  const groups: Map<number, Event[]> = new Map();
  for (let i = 0; i < n; i++) {
    const c = assignments[i] as number;
    let group = groups.get(c);
    if (!group) {
      group = [];
      groups.set(c, group);
    }
    group.push(sorted[i] as Event);
  }

  const clusters: Cluster[] = [];
  let clusterIndex = 0;
  // Sort groups by earliest event timestamp for deterministic ordering
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const aFirst = a[1][0] as Event;
    const bFirst = b[1][0] as Event;
    return aFirst.timestamp - bFirst.timestamp;
  });

  for (const [, group] of sortedGroups) {
    clusters.push(buildCluster(group, `cluster-${clusterIndex}`));
    clusterIndex++;
  }

  return { clusters, unclustered: [] };
}

// ---------------------------------------------------------------------------
// 3. Single-Link Agglomerative Clustering
// ---------------------------------------------------------------------------

/**
 * Cluster events using single-linkage agglomerative clustering.
 *
 * Merges consecutive events (by timestamp) whose gap is less than `maxGap`.
 * All resulting groups are returned as clusters (no minimum size filter).
 *
 * @param events - Therapy events to cluster.
 * @param maxGap - Maximum gap in seconds between events to merge (default 300).
 * @returns Clusters and unclustered events (singletons remain as 1-event clusters).
 */
export function clusterEventsAgglomerative(events: Event[], maxGap: number = 300): ClusterResult {
  if (events.length === 0) {
    return { clusters: [], unclustered: [] };
  }

  const sorted = sortByTimestamp(events);
  const maxGapMs = maxGap * 1000;

  const groups: Event[][] = [];
  let currentGroup: Event[] = [sorted[0] as Event];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as Event;
    const curr = sorted[i] as Event;
    const gap = curr.timestamp - (prev.timestamp + prev.duration * 1000);

    if (gap < maxGapMs) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  const clusters: Cluster[] = groups.map((group, idx) => buildCluster(group, `cluster-${idx}`));

  return { clusters, unclustered: [] };
}

// ---------------------------------------------------------------------------
// 4. Event Duration Distribution by Type
// ---------------------------------------------------------------------------

/**
 * Compute descriptive statistics on event durations grouped by event type.
 *
 * @param events - Therapy events.
 * @returns One `EventDurationStats` per distinct event type, sorted by type name.
 */
export function eventDurationDistribution(events: Event[]): readonly EventDurationStats[] {
  if (events.length === 0) return [];

  // Group durations by type
  const grouped = new Map<string, number[]>();
  for (const event of events) {
    let durations = grouped.get(event.type);
    if (!durations) {
      durations = [];
      grouped.set(event.type, durations);
    }
    durations.push(event.duration);
  }

  const results: EventDurationStats[] = [];

  for (const [type, rawDurations] of grouped) {
    const durations = filterFinite(rawDurations);
    const n = durations.length;
    if (n === 0) continue;

    const sorted = durations.slice().sort((a, b) => a - b);

    // Mean (Welford-style for numerical stability)
    let mean = 0;
    for (let i = 0; i < n; i++) {
      mean += ((sorted[i] as number) - mean) / (i + 1);
    }

    // Median
    const median =
      n % 2 === 1
        ? (sorted[Math.floor(n / 2)] as number)
        : ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;

    // Min / Max
    const min = sorted[0] as number;
    const max = sorted[n - 1] as number;

    // Sample standard deviation (Bessel-corrected)
    let sumSqDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = (sorted[i] as number) - mean;
      sumSqDiff += diff * diff;
    }
    const stdDev = n > 1 ? Math.sqrt(sumSqDiff / (n - 1)) : 0;

    // Percentiles (Type 7 interpolation)
    const p25 = percentileFromSorted(sorted, 25);
    const p75 = percentileFromSorted(sorted, 75);

    results.push({ type, count: n, mean, median, min, max, stdDev, p25, p75 });
  }

  // Sort by type name for deterministic ordering
  results.sort((a, b) => a.type.localeCompare(b.type));
  return results;
}

// ---------------------------------------------------------------------------
// 5. Inter-Event Interval Analysis
// ---------------------------------------------------------------------------

/**
 * Compute time intervals between consecutive events.
 *
 * Events are sorted by timestamp; intervals are computed as the gap
 * in seconds between each event's timestamp and the preceding event's
 * timestamp.
 *
 * @param events - Therapy events.
 * @returns Inter-event interval statistics and raw interval array.
 */
export function interEventIntervals(events: Event[]): InterEventIntervalResult {
  if (events.length <= 1) {
    return {
      intervals: [],
      mean: NaN,
      median: NaN,
      min: NaN,
      max: NaN,
      stdDev: NaN,
      count: 0,
    };
  }

  const sorted = sortByTimestamp(events);
  const intervals: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as Event;
    const curr = sorted[i] as Event;
    const gapSec = (curr.timestamp - prev.timestamp) / 1000;
    intervals.push(gapSec);
  }

  const clean = filterFinite(intervals);
  const n = clean.length;

  if (n === 0) {
    return {
      intervals: [],
      mean: NaN,
      median: NaN,
      min: NaN,
      max: NaN,
      stdDev: NaN,
      count: 0,
    };
  }

  const sortedIntervals = clean.slice().sort((a, b) => a - b);

  // Mean (Welford)
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += ((sortedIntervals[i] as number) - mean) / (i + 1);
  }

  // Median
  const median =
    n % 2 === 1
      ? (sortedIntervals[Math.floor(n / 2)] as number)
      : ((sortedIntervals[n / 2 - 1] as number) + (sortedIntervals[n / 2] as number)) / 2;

  const min = sortedIntervals[0] as number;
  const max = sortedIntervals[n - 1] as number;

  // Sample standard deviation
  let sumSqDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = (sortedIntervals[i] as number) - mean;
    sumSqDiff += diff * diff;
  }
  const stdDev = n > 1 ? Math.sqrt(sumSqDiff / (n - 1)) : 0;

  return { intervals, mean, median, min, max, stdDev, count: n };
}

// ---------------------------------------------------------------------------
// Internal: Type 7 percentile from pre-sorted array
// ---------------------------------------------------------------------------
