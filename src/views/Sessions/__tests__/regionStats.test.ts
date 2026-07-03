/**
 * Unit tests for the region-statistics computation layer (`regionStats.ts`).
 *
 * This module feeds the Signal Viewer's "measure a region" readout and therefore
 * feeds clinical statistics, so these tests are a correctness gate. The two most
 * load-bearing groups are the **known-value numeric** assertions (every expected
 * number is hand-computable and cited) and the **sentinel-filtering** assertions
 * (sentinels must never contribute to a clinical statistic — and an all-sentinel
 * region must read as "no data", i.e. `null`, never `0`).
 *
 * Boundary convention under test (from the module docs): all sample-index ranges
 * are half-open `[startIndex, endIndex)`; time→index uses `Math.ceil` on both
 * ends and clamps to `[0, length]`; events are counted by start time with
 * `startMs <= startTimeMs < endMs`.
 *
 * Fixtures use REAL channel names and in-range values verified against
 * `MEANINGFUL_SAMPLE_RANGES`/`isMeaningfulSample` in
 * `@/parsers/validation/physiologicalRanges`:
 *   flow  [-300, 300],  spo2 (meaningful) [30, 100],  pulse [30, 250],
 *   leak  [0, 200],     pressure [0, 40].
 */

import { describe, it, expect } from 'vitest';

import {
  computeNumericStats,
  computeCategoricalStats,
  computeEventStats,
  computeRegionStats,
  timeRangeToIndexRange,
  decimalPlacesFor,
  statsKindForGroup,
  APPROX_MEDIAN_THRESHOLD,
  DEFAULT_DECIMALS,
  type NumericChannelInput,
  type CategoricalSample,
  type EventInput,
  type NumericRegionStats,
} from '../regionStats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NumericChannelInput from a plain number array. Defaults to the `flow`
 * channel (range `[-300, 300]`, non-zero), which accepts every small integer
 * fixture below except `0` (the sentinel). `sampleRate` defaults to 1 Hz so the
 * index axis maps 1:1 to whole-second time when a test exercises time→index.
 */
function channel(
  values: readonly number[],
  over: Partial<Omit<NumericChannelInput, 'data'>> = {},
): NumericChannelInput {
  return {
    name: over.name ?? 'flow',
    unit: over.unit ?? 'L/min',
    sampleRate: over.sampleRate ?? 1,
    data: Float32Array.from(values),
  };
}

/** Full-buffer half-open index range `[0, length)`. */
function whole(ch: NumericChannelInput): { startIndex: number; endIndex: number } {
  return { startIndex: 0, endIndex: ch.data.length };
}

// ===========================================================================
// 1. Known-value numeric statistics
// ===========================================================================

describe('computeNumericStats — known values', () => {
  it('computes count/mean/median/min/max for [1,2,3,4,5] (odd count)', () => {
    const ch = channel([1, 2, 3, 4, 5]);
    const r = computeNumericStats(ch, whole(ch));
    expect(r.kind).toBe('numeric');
    expect(r.count).toBe(5);
    expect(r.mean).toBe(3); // (1+2+3+4+5)/5 = 15/5
    expect(r.median).toBe(3); // sorted middle element
    expect(r.min).toBe(1);
    expect(r.max).toBe(5);
    expect(r.medianIsApproximate).toBe(false);
  });

  it('computes the even-count median as the mean of the two central order statistics', () => {
    // [4,1,3,2] sorted -> [1,2,3,4]; n=4 -> (sorted[1]+sorted[2])/2 = (2+3)/2.
    const ch = channel([4, 1, 3, 2]);
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(4);
    expect(r.median).toBe(2.5);
    expect(r.mean).toBe(2.5); // (4+1+3+2)/4 = 10/4
    expect(r.min).toBe(1);
    expect(r.max).toBe(4);
  });

  it('handles negative meaningful values (flow accepts the [-300, 300] range)', () => {
    // flow allows negatives; -1 is meaningful for flow (non-zero, in range).
    const ch = channel([-2, -1, 1, 2]);
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(4); // none are sentinels for flow
    expect(r.min).toBe(-2);
    expect(r.max).toBe(2);
    expect(r.mean).toBe(0); // (-2-1+1+2)/4
    expect(r.median).toBe(0); // ([-2,-1,1,2]): (-1+1)/2
  });

  it('respects a sub-range (half-open [startIndex, endIndex))', () => {
    const ch = channel([10, 20, 30, 40, 50]);
    // indices [1,4) -> values 20,30,40
    const r = computeNumericStats(ch, { startIndex: 1, endIndex: 4 });
    expect(r.count).toBe(3);
    expect(r.mean).toBe(30);
    expect(r.median).toBe(30);
    expect(r.min).toBe(20);
    expect(r.max).toBe(40);
  });

  it('carries the unit through and reports decimals for the channel', () => {
    const ch = channel([1, 2, 3], { name: 'flow', unit: 'L/min' });
    const r = computeNumericStats(ch, whole(ch));
    expect(r.unit).toBe('L/min');
    expect(r.decimals).toBe(1); // flow -> 1dp
  });
});

// ===========================================================================
// 2. Sentinel filtering — the no-data-vs-real-0 distinction
// ===========================================================================

describe('computeNumericStats — sentinel filtering', () => {
  it('excludes 0 sentinels interleaved with real flow samples', () => {
    // 0 is the classic "no reading" sentinel; excluded for every channel.
    const ch = channel([2, 0, 4, 0, 6]);
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(3); // only 2,4,6
    expect(r.mean).toBe(4); // (2+4+6)/3
    expect(r.median).toBe(4);
    expect(r.min).toBe(2);
    expect(r.max).toBe(6);
  });

  it('reports an all -1 spo2 region as empty (probe-off below the [30,100] floor)', () => {
    const ch = channel([-1, -1, -1], { name: 'spo2', unit: '%' });
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(0);
    expect(r.mean).toBeNull();
    expect(r.median).toBeNull();
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
    expect(r.medianIsApproximate).toBe(false);
  });

  it('excludes spo2 byte sentinels 127 and 255 (above the 100 ceiling)', () => {
    const ch = channel([95, 127, 96, 255, 97], { name: 'spo2', unit: '%' });
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(3); // 95,96,97
    expect(r.mean).toBe(96); // (95+96+97)/3
    expect(r.median).toBe(96);
    expect(r.min).toBe(95);
    expect(r.max).toBe(97);
  });

  it('excludes an out-of-range flow spike (flow range is [-300, 300], so 400 is rejected)', () => {
    const ch = channel([100, 400, 200], { name: 'flow', unit: 'L/min' });
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(2); // 400 excluded
    expect(r.min).toBe(100);
    expect(r.max).toBe(200);
    expect(r.mean).toBe(150);
  });

  it('excludes NaN samples', () => {
    const ch = channel([5, NaN, 7], { name: 'flow' });
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(2);
    expect(r.mean).toBe(6);
    expect(r.min).toBe(5);
    expect(r.max).toBe(7);
  });

  it('keeps a real flow value of -1, which is meaningful (non-zero, in range)', () => {
    // Guards against over-eager sentinel filtering: -1 is a sentinel only for
    // channels whose meaningful floor excludes it (e.g. spo2), not for flow.
    const ch = channel([-1, -1, -1], { name: 'flow', unit: 'L/min' });
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(3);
    expect(r.mean).toBe(-1);
    expect(r.median).toBe(-1);
    expect(r.min).toBe(-1);
    expect(r.max).toBe(-1);
  });
});

// ===========================================================================
// 3. Empty vs single sample
// ===========================================================================

describe('computeNumericStats — empty and single-sample regions', () => {
  it('returns count 0 with null stats for an empty (zero-width) index range', () => {
    const ch = channel([1, 2, 3]);
    const r = computeNumericStats(ch, { startIndex: 1, endIndex: 1 });
    expect(r.count).toBe(0);
    expect(r.mean).toBeNull();
    expect(r.median).toBeNull();
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
  });

  it('returns count 0 with null stats for an all-sentinel region (not 0)', () => {
    const ch = channel([0, 0, 0]);
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(0);
    expect(r.mean).toBeNull();
    expect(r.median).toBeNull();
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
  });

  it('returns mean=median=min=max=value for a single meaningful sample', () => {
    const ch = channel([42]);
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(1);
    expect(r.mean).toBe(42);
    expect(r.median).toBe(42);
    expect(r.min).toBe(42);
    expect(r.max).toBe(42);
    expect(r.medianIsApproximate).toBe(false);
  });

  it('still reports the channel decimals/unit even when count is 0', () => {
    const ch = channel([0, 0], { name: 'spo2', unit: '%' });
    const r = computeNumericStats(ch, whole(ch));
    expect(r.count).toBe(0);
    expect(r.unit).toBe('%');
    expect(r.decimals).toBe(0); // spo2 -> 0dp
  });

  it('clamps an out-of-bounds index range defensively rather than reading past the buffer', () => {
    const ch = channel([3, 6, 9]);
    const r = computeNumericStats(ch, { startIndex: 0, endIndex: 999 });
    expect(r.count).toBe(3); // clamped to length 3
    expect(r.min).toBe(3);
    expect(r.max).toBe(9);
  });

  it('treats an inverted index range (end < start) as empty', () => {
    const ch = channel([3, 6, 9]);
    const r = computeNumericStats(ch, { startIndex: 3, endIndex: 1 });
    expect(r.count).toBe(0);
    expect(r.mean).toBeNull();
  });
});

// ===========================================================================
// 4. Median: exact vs P² approximation (threshold override)
// ===========================================================================

/**
 * Deterministic in-range flow ramp generator (no Math.random). Produces a
 * shuffled-but-deterministic permutation so the P² estimator sees an unsorted
 * stream (its worst realistic case) while the exact median stays computable in
 * closed form. Values stay within flow's `[-300, 300]` meaningful range.
 */
function deterministicRamp(n: number): Float32Array {
  const out = new Float32Array(n);
  // Linear congruential index permutation step (coprime stride) keeps it
  // unsorted yet fully deterministic and reproducible run-to-run.
  const stride = 9973; // prime, coprime to typical n here
  for (let i = 0; i < n; i++) {
    const idx = (i * stride) % n;
    // Map idx in [0, n) to a flow value in roughly [-100, 100].
    out[i] = (idx / (n - 1)) * 200 - 100;
  }
  return out;
}

describe('computeNumericStats — exact vs approximate median', () => {
  it('uses the exact path (medianIsApproximate=false) below the threshold', () => {
    const ch = channel(Array.from(deterministicRamp(101)), { name: 'flow' });
    const r = computeNumericStats(ch, whole(ch)); // default high threshold
    expect(r.medianIsApproximate).toBe(false);
  });

  it('switches to the P² approximation when the span exceeds the (overridden) threshold', () => {
    const n = 5000;
    const data = deterministicRamp(n);
    const ch = channel(Array.from(data), { name: 'flow' });
    // Force the approximate path with a tiny threshold so we never allocate 2M.
    const approx = computeNumericStats(ch, whole(ch), 10);
    const exact = computeNumericStats(ch, whole(ch), APPROX_MEDIAN_THRESHOLD);

    expect(approx.medianIsApproximate).toBe(true);
    expect(exact.medianIsApproximate).toBe(false);

    // count/mean/min/max are ALWAYS exact regardless of the median path.
    expect(approx.count).toBe(exact.count);
    expect(approx.mean).toBeCloseTo(exact.mean as number, 5);
    expect(approx.min).toBe(exact.min);
    expect(approx.max).toBe(exact.max);

    // P² median should land near the exact median. The ramp spans [-100, 100]
    // (width 200) with a true median of ~0; the P² estimate is accurate to a
    // small fraction of the data range, so assert an absolute bound of a few
    // percent of the 200-wide range rather than a fixed decimal place.
    expect(Math.abs((approx.median as number) - (exact.median as number))).toBeLessThan(5);
  });

  it('the approximate (P²) path is deterministic across repeated runs', () => {
    const ch = channel(Array.from(deterministicRamp(5000)), { name: 'flow' });
    const a = computeNumericStats(ch, whole(ch), 10);
    const b = computeNumericStats(ch, whole(ch), 10);
    expect(a.median).toBe(b.median);
    expect(a.medianIsApproximate).toBe(true);
    expect(b.medianIsApproximate).toBe(true);
  });

  it('with fewer than 5 meaningful samples the forced-approx path still gives the exact median', () => {
    // P2MedianEstimator buffers <5 observations and computes them exactly.
    const ch = channel([4, 1, 3, 2], { name: 'flow' });
    const r = computeNumericStats(ch, whole(ch), 1); // threshold below span -> approx path
    expect(r.medianIsApproximate).toBe(true);
    expect(r.median).toBe(2.5); // exact even-count median of the buffered values
  });
});

// ===========================================================================
// 5. Time → index conversion: half-open tiling and clamping
// ===========================================================================

describe('timeRangeToIndexRange — half-open tiling and clamps', () => {
  it('maps [0,1000ms) to indices [0,2) at 2 Hz (samples 0 and 1)', () => {
    // start = ceil(0/1000*2) = 0; end = ceil(1000/1000*2) = 2 (exclusive).
    const r = timeRangeToIndexRange({ startMs: 0, endMs: 1000 }, 2, 100);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(2);
  });

  it('tiles the adjacent block [1000,2000ms) with no overlap at 2 Hz', () => {
    const a = timeRangeToIndexRange({ startMs: 0, endMs: 1000 }, 2, 100);
    const b = timeRangeToIndexRange({ startMs: 1000, endMs: 2000 }, 2, 100);
    // The end of the first block equals the start of the next: perfect tiling.
    expect(a.endIndex).toBe(b.startIndex);
    expect(b.startIndex).toBe(2);
    expect(b.endIndex).toBe(4);
  });

  it('clamps an over-range end index down to the buffer length', () => {
    // end = ceil(10000/1000*2) = 20, clamped to length 5.
    const r = timeRangeToIndexRange({ startMs: 0, endMs: 10000 }, 2, 5);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(5);
  });

  it('clamps a negative start up to 0', () => {
    const r = timeRangeToIndexRange({ startMs: -5000, endMs: 1000 }, 2, 100);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(2);
  });

  it('returns an empty range for an inverted time range', () => {
    const r = timeRangeToIndexRange({ startMs: 2000, endMs: 1000 }, 2, 100);
    expect(r.startIndex).toBe(r.endIndex); // empty (start >= end)
  });

  it('returns an empty range for a zero-width time range', () => {
    const r = timeRangeToIndexRange({ startMs: 1000, endMs: 1000 }, 2, 100);
    expect(r.startIndex).toBe(r.endIndex);
  });

  it('returns an empty range for sampleRate <= 0', () => {
    const r = timeRangeToIndexRange({ startMs: 0, endMs: 1000 }, 0, 100);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(0);
  });

  it('returns an empty range for a non-finite sampleRate', () => {
    const r = timeRangeToIndexRange({ startMs: 0, endMs: 1000 }, Number.POSITIVE_INFINITY, 100);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(0);
  });

  it('returns an empty range for a zero-length buffer', () => {
    const r = timeRangeToIndexRange({ startMs: 0, endMs: 1000 }, 2, 0);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(0);
  });
});

// ===========================================================================
// 6. Categorical (hypnogram) statistics
// ===========================================================================

describe('computeCategoricalStats — hypnogram occupancy', () => {
  it('accumulates per-stage durations whose fractions sum to 1', () => {
    // Stage 1 held [0,2000), stage 2 held [2000,5000), stage 1 again [5000,8000).
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 1 },
      { timeMs: 2000, value: 2 },
      { timeMs: 5000, value: 1 },
    ];
    // Final segment holds until endMs (8000). Stage1 = 2000+3000 = 5000; stage2 = 3000.
    const r = computeCategoricalStats(samples, { startMs: 0, endMs: 8000 });
    expect(r.kind).toBe('categorical');
    expect(r.coveredMs).toBe(8000);

    const total = r.stages.reduce((acc, s) => acc + s.fraction, 0);
    expect(total).toBeCloseTo(1, 10);

    const stage1 = r.stages.find((s) => s.value === 1);
    const stage2 = r.stages.find((s) => s.value === 2);
    expect(stage1?.durationMs).toBe(5000);
    expect(stage2?.durationMs).toBe(3000);
    expect(stage1?.fraction).toBeCloseTo(5000 / 8000, 10);
    expect(stage2?.fraction).toBeCloseTo(3000 / 8000, 10);
  });

  it('reports the longest-held stage as dominant', () => {
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 3 },
      { timeMs: 1000, value: 7 },
    ];
    // stage3 = [0,1000) = 1000ms; stage7 = [1000,10000) = 9000ms (dominant).
    const r = computeCategoricalStats(samples, { startMs: 0, endMs: 10000 });
    expect(r.dominant).toBe(7);
    // stages sorted descending by duration -> dominant first.
    expect(r.stages[0]?.value).toBe(7);
  });

  it('clips a region that starts mid-segment to the overlap duration', () => {
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 1 },
      { timeMs: 4000, value: 2 },
    ];
    // Region [2000,6000): stage1 overlap [2000,4000)=2000; stage2 overlap [4000,6000)=2000.
    const r = computeCategoricalStats(samples, { startMs: 2000, endMs: 6000 });
    expect(r.coveredMs).toBe(4000);
    const stage1 = r.stages.find((s) => s.value === 1);
    const stage2 = r.stages.find((s) => s.value === 2);
    expect(stage1?.durationMs).toBe(2000);
    expect(stage2?.durationMs).toBe(2000);
  });

  it('does not count time before the first transition (gap excluded from coverage)', () => {
    const samples: CategoricalSample[] = [{ timeMs: 3000, value: 5 }];
    // Region [0,5000): stage5 only covers [3000,5000)=2000; the [0,3000) gap is uncovered.
    const r = computeCategoricalStats(samples, { startMs: 0, endMs: 5000 });
    expect(r.coveredMs).toBe(2000);
    expect(r.stages).toHaveLength(1);
    expect(r.stages[0]?.fraction).toBeCloseTo(1, 10); // fraction is over covered, not region width
  });

  it('returns no coverage for an empty sample list', () => {
    const r = computeCategoricalStats([], { startMs: 0, endMs: 5000 });
    expect(r.coveredMs).toBe(0);
    expect(r.stages).toHaveLength(0);
    expect(r.dominant).toBeNull();
  });

  it('returns no coverage for a zero-width / inverted region', () => {
    const samples: CategoricalSample[] = [{ timeMs: 0, value: 1 }];
    expect(computeCategoricalStats(samples, { startMs: 5000, endMs: 5000 }).coveredMs).toBe(0);
    expect(computeCategoricalStats(samples, { startMs: 6000, endMs: 5000 }).coveredMs).toBe(0);
  });

  it('orders stages by descending duration, then ascending value, deterministically', () => {
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 9 }, // 1000ms
      { timeMs: 1000, value: 2 }, // 1000ms  (tie with stage9; lower value first)
      { timeMs: 2000, value: 5 }, // 3000ms  (longest -> first)
    ];
    const r = computeCategoricalStats(samples, { startMs: 0, endMs: 5000 });
    expect(r.stages.map((s) => s.value)).toEqual([5, 2, 9]);
  });
});

// ===========================================================================
// 7. Event/marker counts at boundaries (half-open by start time)
// ===========================================================================

describe('computeEventStats — half-open boundary counting', () => {
  const events: EventInput[] = [
    { startTimeMs: 1000, type: 'ObstructiveApnea' },
    { startTimeMs: 1000, type: 'Hypopnea' },
    { startTimeMs: 2000, type: 'ObstructiveApnea' },
    { startTimeMs: 3000, type: 'CentralApnea' },
  ];

  it('includes an event exactly at startMs and excludes one exactly at endMs', () => {
    // Region [1000,3000): includes the two at 1000 and the one at 2000; excludes 3000.
    const r = computeEventStats(events, { startMs: 1000, endMs: 3000 });
    expect(r.kind).toBe('count');
    expect(r.count).toBe(3);
  });

  it('breaks down counts per type and the breakdown sums to the total', () => {
    const r = computeEventStats(events, { startMs: 1000, endMs: 3000 });
    const sum = r.byType.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(r.count);
    const oa = r.byType.find((b) => b.type === 'ObstructiveApnea');
    const hy = r.byType.find((b) => b.type === 'Hypopnea');
    expect(oa?.count).toBe(2);
    expect(hy?.count).toBe(1);
    // CentralApnea (at 3000) is excluded by the half-open end.
    expect(r.byType.find((b) => b.type === 'CentralApnea')).toBeUndefined();
  });

  it('orders the per-type breakdown by descending count, then type name', () => {
    const r = computeEventStats(events, { startMs: 1000, endMs: 3000 });
    expect(r.byType[0]?.type).toBe('ObstructiveApnea'); // count 2, highest
  });

  it('returns 0 for a zero-width region', () => {
    const r = computeEventStats(events, { startMs: 1000, endMs: 1000 });
    expect(r.count).toBe(0);
    expect(r.byType).toHaveLength(0);
  });

  it('returns 0 for an inverted region', () => {
    const r = computeEventStats(events, { startMs: 3000, endMs: 1000 });
    expect(r.count).toBe(0);
    expect(r.byType).toHaveLength(0);
  });

  it('returns 0 for an empty event list', () => {
    const r = computeEventStats([], { startMs: 0, endMs: 10000 });
    expect(r.count).toBe(0);
    expect(r.byType).toHaveLength(0);
  });
});

// ===========================================================================
// 8. Display precision (decimalPlacesFor): name beats unit
// ===========================================================================

describe('decimalPlacesFor — channel-name and unit precision rules', () => {
  it('resolves by channel name first (flow/pressure/leak/minuteVent -> 1dp)', () => {
    expect(decimalPlacesFor({ name: 'flow', unit: 'L/min' })).toBe(1);
    expect(decimalPlacesFor({ name: 'pressure', unit: 'cmH2O' })).toBe(1);
    expect(decimalPlacesFor({ name: 'leak', unit: 'L/min' })).toBe(1);
    expect(decimalPlacesFor({ name: 'minuteVent', unit: 'L/min' })).toBe(1);
  });

  it('resolves whole-number channels (spo2/pulse/respRate/tidalVolume/snore -> 0dp)', () => {
    expect(decimalPlacesFor({ name: 'spo2', unit: '%' })).toBe(0);
    expect(decimalPlacesFor({ name: 'pulse', unit: 'bpm' })).toBe(0);
    expect(decimalPlacesFor({ name: 'respRate', unit: 'bpm' })).toBe(0);
    expect(decimalPlacesFor({ name: 'tidalVolume', unit: 'mL' })).toBe(0);
    expect(decimalPlacesFor({ name: 'snore', unit: 'dBA' })).toBe(0);
  });

  it('resolves flowLimitation to 2dp by name', () => {
    expect(decimalPlacesFor({ name: 'flowLimitation', unit: '' })).toBe(2);
  });

  it('lets the channel name win over a conflicting unit rule', () => {
    // name spo2 -> 0dp even though unit cmH2O (a 1dp unit) is supplied.
    expect(decimalPlacesFor({ name: 'spo2', unit: 'cmH2O' })).toBe(0);
    // name flow -> 1dp even though unit % (a 0dp unit) is supplied.
    expect(decimalPlacesFor({ name: 'flow', unit: '%' })).toBe(1);
  });

  it('falls back to the unit rule for an unknown channel name', () => {
    expect(decimalPlacesFor({ name: 'unknownChannel', unit: 'bpm' })).toBe(0);
    expect(decimalPlacesFor({ name: 'unknownChannel', unit: '%' })).toBe(0);
    expect(decimalPlacesFor({ name: 'unknownChannel', unit: 'L/min' })).toBe(1);
    expect(decimalPlacesFor({ name: 'unknownChannel', unit: 'cmH2O' })).toBe(1);
  });

  it('normalises units case-insensitively and strips the degree sign', () => {
    expect(decimalPlacesFor({ name: 'temp', unit: '°C' })).toBe(1); // -> 'c'
    expect(decimalPlacesFor({ name: 'temp', unit: 'CMH2O' })).toBe(1); // case-insensitive
    expect(decimalPlacesFor({ name: 'temp', unit: ' L/min ' })).toBe(1); // trimmed
  });

  it('defaults to DEFAULT_DECIMALS (2) for an unknown name and unknown unit', () => {
    expect(decimalPlacesFor({ name: 'mystery', unit: 'furlongs' })).toBe(DEFAULT_DECIMALS);
    expect(DEFAULT_DECIMALS).toBe(2);
  });
});

// ===========================================================================
// 9. statsKindForGroup dispatcher mapping
// ===========================================================================

describe('statsKindForGroup — group → stats kind', () => {
  it('maps cpap and wearable groups to numeric', () => {
    expect(statsKindForGroup('cpap')).toBe('numeric');
    expect(statsKindForGroup('wearable')).toBe('numeric');
  });

  it('maps the sleep group to categorical', () => {
    expect(statsKindForGroup('sleep')).toBe('categorical');
  });

  it('maps any event lane to count regardless of group', () => {
    expect(statsKindForGroup('cpap', true)).toBe('count');
    expect(statsKindForGroup('sleep', true)).toBe('count');
    expect(statsKindForGroup('weather', true)).toBe('count');
  });

  it('maps unknown / unsupported groups to none', () => {
    expect(statsKindForGroup('weather')).toBe('none');
    expect(statsKindForGroup('mystery')).toBe('none');
  });
});

// ===========================================================================
// 9b. computeRegionStats dispatcher
// ===========================================================================

describe('computeRegionStats — dispatcher', () => {
  it('converts a timeRange to an index range via the channel sample rate', () => {
    const ch = channel([10, 20, 30, 40], { name: 'flow', sampleRate: 1 });
    // [1000,3000ms) at 1 Hz -> indices [1,3) -> values 20,30.
    const r = computeRegionStats('numeric', {
      channel: ch,
      timeRange: { startMs: 1000, endMs: 3000 },
    }) as NumericRegionStats;
    expect(r.kind).toBe('numeric');
    expect(r.count).toBe(2);
    expect(r.mean).toBe(25);
    expect(r.min).toBe(20);
    expect(r.max).toBe(30);
  });

  it('lets an explicit indexRange win over a timeRange when both are given', () => {
    const ch = channel([10, 20, 30, 40], { name: 'flow', sampleRate: 1 });
    const r = computeRegionStats('numeric', {
      channel: ch,
      indexRange: { startIndex: 0, endIndex: 2 }, // 10,20
      timeRange: { startMs: 2000, endMs: 4000 }, // would be 30,40 -> must be ignored
    }) as NumericRegionStats;
    expect(r.count).toBe(2);
    expect(r.min).toBe(10);
    expect(r.max).toBe(20);
    expect(r.mean).toBe(15);
  });

  it('honours the medianThreshold override through the dispatcher', () => {
    const ch = channel(Array.from(deterministicRamp(200)), { name: 'flow' });
    const r = computeRegionStats('numeric', {
      channel: ch,
      indexRange: { startIndex: 0, endIndex: 200 },
      medianThreshold: 10,
    }) as NumericRegionStats;
    expect(r.medianIsApproximate).toBe(true);
  });

  it('returns {kind:none} for numeric when the channel is missing', () => {
    const r = computeRegionStats('numeric', { timeRange: { startMs: 0, endMs: 1000 } });
    expect(r.kind).toBe('none');
  });

  it('returns {kind:none} for numeric when neither indexRange nor timeRange is given', () => {
    const ch = channel([1, 2, 3]);
    const r = computeRegionStats('numeric', { channel: ch });
    expect(r.kind).toBe('none');
  });

  it('dispatches categorical and returns occupancy', () => {
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 1 },
      { timeMs: 2000, value: 2 },
    ];
    const r = computeRegionStats('categorical', {
      categoricalSamples: samples,
      timeRange: { startMs: 0, endMs: 4000 },
    });
    expect(r.kind).toBe('categorical');
  });

  it('returns {kind:none} for categorical when required inputs are missing', () => {
    expect(computeRegionStats('categorical', { timeRange: { startMs: 0, endMs: 1 } }).kind).toBe(
      'none',
    );
    expect(computeRegionStats('categorical', { categoricalSamples: [] }).kind).toBe('none');
  });

  it('dispatches count and returns the event total', () => {
    const r = computeRegionStats('count', {
      events: [{ startTimeMs: 500, type: 'Hypopnea' }],
      timeRange: { startMs: 0, endMs: 1000 },
    });
    expect(r.kind).toBe('count');
    if (r.kind === 'count') expect(r.count).toBe(1);
  });

  it('returns {kind:none} for count when required inputs are missing', () => {
    expect(computeRegionStats('count', { timeRange: { startMs: 0, endMs: 1 } }).kind).toBe('none');
    expect(computeRegionStats('count', { events: [] }).kind).toBe('none');
  });

  it('returns {kind:none} for the none kind', () => {
    expect(computeRegionStats('none', {}).kind).toBe('none');
  });
});

// ===========================================================================
// 10. Determinism
// ===========================================================================

describe('region statistics determinism', () => {
  it('produces identical numeric results for the same input twice (exact path)', () => {
    const ch = channel([5, 1, 9, 3, 7, 2, 8]);
    const a = computeNumericStats(ch, whole(ch));
    const b = computeNumericStats(ch, whole(ch));
    expect(a).toEqual(b);
  });

  it('produces identical numeric results twice on the forced P² path', () => {
    const ch = channel(Array.from(deterministicRamp(3000)), { name: 'flow' });
    const a = computeNumericStats(ch, whole(ch), 10);
    const b = computeNumericStats(ch, whole(ch), 10);
    expect(a).toEqual(b);
  });

  it('produces identical categorical results for the same input twice', () => {
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 2 },
      { timeMs: 1500, value: 4 },
      { timeMs: 4000, value: 2 },
    ];
    const range = { startMs: 0, endMs: 6000 };
    expect(computeCategoricalStats(samples, range)).toEqual(
      computeCategoricalStats(samples, range),
    );
  });

  it('produces identical event-count results for the same input twice', () => {
    const events: EventInput[] = [
      { startTimeMs: 100, type: 'A' },
      { startTimeMs: 200, type: 'B' },
      { startTimeMs: 200, type: 'A' },
    ];
    const range = { startMs: 0, endMs: 1000 };
    expect(computeEventStats(events, range)).toEqual(computeEventStats(events, range));
  });
});
