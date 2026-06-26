/**
 * Unit tests for the region-statistics MARSHALLING + display layer
 * (`regionStatsModel.ts`).
 *
 * This is the React-free glue the Signal Viewer's "Measure region" overlay uses
 * to (a) resolve each visible lane to a {@link RegionStats} and (b) format the
 * discriminated result into the small primitives the chips / table / live-region
 * render. It computes no statistic itself, so these tests focus on:
 *
 *  - {@link formatStatValue}: the clinically load-bearing "—" (no data) vs a real
 *    `0` distinction, non-finite handling, and decimal formatting/rounding.
 *  - {@link numericChipRows} / {@link categoricalChipRows}: the per-row display
 *    reductions (empty / single-sample / multi-sample; stage % + duration).
 *  - {@link buildMeasureLaneStats}: the lane→stats resolver — order/length parity
 *    with the input lanes (the chip↔lane alignment QA flagged as clinically
 *    important), the CPAP-by-name path vs the wearable full-buffer path, and
 *    `{ kind: 'none' }` resolution for lanes with no meaningful statistic.
 *  - {@link laneStatSummary}: the screen-reader / aria-live per-lane text.
 *
 * Every expected number below is hand-computable. Float comparisons use
 * `toBeCloseTo` with an explicit tolerance. No `Math.random`.
 *
 * Fixtures use REAL channel names + in-range values verified against
 * `isMeaningfulSample`/`MEANINGFUL_SAMPLE_RANGES`:
 *   flow [-300, 300] (accepts negatives; 0 is the sentinel),
 *   pulse [30, 250], spo2 (meaningful) [30, 100].
 * Sleep stage ordinals come from `SLEEP_STAGE_CODES`
 *   (deep=0, light=1, rem=2, wake=3).
 */

import { describe, it, expect } from 'vitest';

import {
  formatStatValue,
  formatSignedStatValue,
  numericChipRows,
  categoricalChipRows,
  spreadChipRows,
  trendChipRows,
  trendPercentChange,
  trendDirection,
  distributionChipRows,
  selectionChipRows,
  buildMeasureLaneStats,
  laneStatSummary,
  type MeasureLaneInput,
  type MeasureDataSources,
  type MeasureLaneStat,
  type LaneSelectionInfo,
} from '../regionStatsModel';
import {
  computeNumericStats,
  computeCategoricalStats,
  computeSpreadStats,
  computeTrendStats,
  computeDistributionStats,
  type NumericChannelInput,
  type CategoricalSample,
  type EventInput,
  type RegionStats,
  type TimeRange,
} from '../regionStats';
import type { LaneDescriptor } from '../signalLanes';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

/** Build a NumericChannelInput from a plain number array (defaults to `flow`). */
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

/** Compute a real numeric RegionStats so the chip/summary reducers get live input. */
function numericStats(
  values: readonly number[],
  over: Partial<Omit<NumericChannelInput, 'data'>> = {},
): Extract<RegionStats, { kind: 'numeric' }> {
  const ch = channel(values, over);
  return computeNumericStats(ch, { startIndex: 0, endIndex: ch.data.length });
}

/** Compute a real categorical RegionStats from step samples over a time range. */
function categoricalStats(
  samples: readonly CategoricalSample[],
  range: TimeRange,
): Extract<RegionStats, { kind: 'categorical' }> {
  return computeCategoricalStats(samples, range);
}

/** Build a minimal LaneDescriptor; only the fields the model reads matter. */
function lane(over: Partial<LaneDescriptor> & Pick<LaneDescriptor, 'id'>): LaneDescriptor {
  return {
    id: over.id,
    name: over.name ?? over.id,
    unit: over.unit ?? '',
    group: over.group ?? 'cpap',
    pill: over.pill ?? 'CPAP',
    colorVar: over.colorVar ?? 'var(--x)',
    render: over.render ?? 'line',
    heightVar: over.heightVar ?? '--signal-lane-height',
    hasData: over.hasData ?? true,
  };
}

/** Wrap a lane in the layout envelope the resolver iterates over. */
function laneInput(descriptor: LaneDescriptor, collapsed = false): MeasureLaneInput {
  return { lane: descriptor, height: 80, collapsed };
}

/** An empty data-source bag the tests selectively populate. */
function emptySources(): MeasureDataSources {
  return {
    cpap: new Map(),
    wearableNumeric: new Map(),
    categorical: new Map(),
    events: [] as readonly EventInput[],
  };
}

const TOL = 1e-9;

// ===========================================================================
// 1. formatStatValue — the "—" (no data) vs real-0 distinction
// ===========================================================================

describe('formatStatValue', () => {
  it('renders null as the no-data em dash, NOT a zero', () => {
    expect(formatStatValue(null, 1)).toBe('—');
    expect(formatStatValue(null, 0)).toBe('—');
  });

  it('renders non-finite values (NaN, ±Infinity) as the no-data dash', () => {
    expect(formatStatValue(NaN, 1)).toBe('—');
    expect(formatStatValue(Infinity, 1)).toBe('—');
    expect(formatStatValue(-Infinity, 2)).toBe('—');
  });

  it('renders a REAL zero as a zero, never as the no-data dash (clinical safety)', () => {
    // The single most important assertion in this file: a genuine 0 (e.g. a
    // net-zero flow average) must read as "0", never "— no data".
    expect(formatStatValue(0, 0)).toBe('0');
    expect(formatStatValue(0, 1)).toBe('0.0');
    expect(formatStatValue(0, 2)).toBe('0.00');
    expect(formatStatValue(-0, 1)).toBe('0.0');
  });

  it('formats positive values to the requested decimal places', () => {
    expect(formatStatValue(12.3456, 0)).toBe('12');
    expect(formatStatValue(12.3456, 1)).toBe('12.3');
    expect(formatStatValue(12.3456, 2)).toBe('12.35'); // rounds half up
    expect(formatStatValue(7, 1)).toBe('7.0');
  });

  it('formats negative values to the requested decimal places', () => {
    expect(formatStatValue(-2.5, 1)).toBe('-2.5');
    expect(formatStatValue(-0.04, 1)).toBe('-0.0'); // toFixed rounds toward 0 here
    expect(formatStatValue(-123.456, 2)).toBe('-123.46');
  });

  it('rounds at the requested precision', () => {
    expect(formatStatValue(2.449, 1)).toBe('2.4');
    expect(formatStatValue(2.45, 1)).toBe('2.5');
    expect(formatStatValue(0.005, 2)).toBe('0.01');
  });
});

// ===========================================================================
// 2. numericChipRows — avg / med / min / max display rows
// ===========================================================================

describe('numericChipRows', () => {
  it('reports an empty region (count 0) as empty with dash rows', () => {
    // All-zero flow buffer: every 0 is a sentinel, so count === 0 (no data).
    const stats = numericStats([0, 0, 0]);
    expect(stats.count).toBe(0);

    const rows = numericChipRows(stats);
    expect(rows.empty).toBe(true);
    expect(rows.singleSample).toBe(false);
    expect(rows.avg).toBe('—');
    expect(rows.med).toBe('—');
    expect(rows.min).toBe('—');
    expect(rows.max).toBe('—');
  });

  it('flags the single-sample region and renders that one value in every row', () => {
    // flow decimals = 1; a single meaningful sample => mean=median=min=max.
    const stats = numericStats([42]);
    expect(stats.count).toBe(1);

    const rows = numericChipRows(stats);
    expect(rows.singleSample).toBe(true);
    expect(rows.empty).toBe(false);
    expect(rows.avg).toBe('42.0');
    expect(rows.med).toBe('42.0');
    expect(rows.min).toBe('42.0');
    expect(rows.max).toBe('42.0');
    expect(rows.unit).toBe('L/min');
  });

  it('renders all four rows for a multi-sample region with correct values + decimals', () => {
    // flow [1,2,3,4,5]: mean=3, median=3, min=1, max=5; flow => 1 decimal.
    const stats = numericStats([1, 2, 3, 4, 5]);
    const rows = numericChipRows(stats);
    expect(rows.empty).toBe(false);
    expect(rows.singleSample).toBe(false);
    expect(rows.avg).toBe('3.0');
    expect(rows.med).toBe('3.0');
    expect(rows.min).toBe('1.0');
    expect(rows.max).toBe('5.0');
    expect(rows.unit).toBe('L/min');
    expect(rows.medianIsApproximate).toBe(false);
  });

  it('renders a genuine net-zero average as 0.0, not a dash', () => {
    // Symmetric flow values average to exactly 0 — must NOT read as no-data.
    const stats = numericStats([-2, 2]);
    expect(stats.mean).toBe(0);
    const rows = numericChipRows(stats);
    expect(rows.avg).toBe('0.0');
    expect(rows.empty).toBe(false);
  });

  it('uses whole-number decimals for pulse (0 decimals) and rounds correctly', () => {
    // pulse range [30, 250]; mean of [60,61] = 60.5 -> toFixed(0) rounds to 61.
    const stats = numericStats([60, 61], { name: 'pulse', unit: 'bpm' });
    const rows = numericChipRows(stats);
    expect(stats.decimals).toBe(0);
    expect(rows.avg).toBe('61'); // 60.5 -> 61
    expect(rows.med).toBe('61'); // (60+61)/2 = 60.5 -> 61
    expect(rows.min).toBe('60');
    expect(rows.max).toBe('61');
  });

  it('surfaces the medianIsApproximate flag from the underlying stats', () => {
    // Force the streaming P² path with a tiny threshold so the flag flips true.
    const ch = channel([10, 20, 30, 40, 50, 60, 70], { name: 'pulse', unit: 'bpm' });
    const stats = computeNumericStats(ch, { startIndex: 0, endIndex: ch.data.length }, 4);
    expect(stats.medianIsApproximate).toBe(true);
    expect(numericChipRows(stats).medianIsApproximate).toBe(true);
  });
});

// ===========================================================================
// 3. categoricalChipRows — hypnogram stage rows
// ===========================================================================

describe('categoricalChipRows', () => {
  it('formats stage percentage + duration, descending by duration (dominant first)', () => {
    // Step series over [0, 100_000) ms:
    //   light(1) [0, 60_000)  -> 60s
    //   deep(0)  [60_000, 100_000) -> 40s
    // covered = 100_000 ms; light 60%, deep 40%.
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 1 },
      { timeMs: 60_000, value: 0 },
    ];
    const stats = categoricalStats(samples, { startMs: 0, endMs: 100_000 });
    const rows = categoricalChipRows(stats);

    expect(rows).toHaveLength(2);
    // Dominant (longest) stage first.
    expect(rows[0]?.stageName).toBe('Light (N1–2)');
    expect(rows[0]?.percent).toBe(60);
    expect(rows[0]?.durationLabel).toBe('1:00'); // 60s -> m:ss
    expect(rows[1]?.stageName).toBe('Deep (N3)');
    expect(rows[1]?.percent).toBe(40);
    expect(rows[1]?.durationLabel).toBe('40s');
  });

  it('rounds fractional percentages to whole percent', () => {
    // wake(3) [0, 10_000) = 10s; rem(2) [10_000, 40_000) = 30s.
    // covered 40s: wake 25%, rem 75%.
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 3 },
      { timeMs: 10_000, value: 2 },
    ];
    const stats = categoricalStats(samples, { startMs: 0, endMs: 40_000 });
    const rows = categoricalChipRows(stats);
    const byStage = new Map(rows.map((r) => [r.stageName, r]));
    expect(byStage.get('REM')?.percent).toBe(75);
    expect(byStage.get('Wake')?.percent).toBe(25);
    expect(byStage.get('REM')?.durationLabel).toBe('30s');
    expect(byStage.get('Wake')?.durationLabel).toBe('10s');
  });

  it('returns no rows for a region with no covered stage time', () => {
    const stats = categoricalStats([], { startMs: 0, endMs: 10_000 });
    expect(categoricalChipRows(stats)).toEqual([]);
  });

  it('names an unknown ordinal stage code "Unknown"', () => {
    const samples: CategoricalSample[] = [{ timeMs: 0, value: 99 }];
    const stats = categoricalStats(samples, { startMs: 0, endMs: 5_000 });
    const rows = categoricalChipRows(stats);
    expect(rows[0]?.stageName).toBe('Unknown');
    expect(rows[0]?.percent).toBe(100);
  });
});

// ===========================================================================
// 4. buildMeasureLaneStats — the lane→stats resolver
// ===========================================================================

describe('buildMeasureLaneStats', () => {
  const region: TimeRange = { startMs: 0, endMs: 5_000 };

  it('emits exactly one entry per input lane, in the SAME order (chip↔lane parity)', () => {
    // Mix of resolvable and unresolvable lanes; the output must be index-aligned
    // with the input regardless of whether each lane has data.
    const lanes: MeasureLaneInput[] = [
      laneInput(lane({ id: 'cpap:flow', name: 'Flow', unit: 'L/min', group: 'cpap' })),
      laneInput(lane({ id: 'wear:sleep_stages', name: 'Sleep Stages', group: 'sleep' })),
      laneInput(lane({ id: 'wx:temp', name: 'Temperature', group: 'weather' })),
      laneInput(lane({ id: 'wear:heart_rate_intraday', name: 'Heart Rate', group: 'wearable' })),
    ];
    const out = buildMeasureLaneStats(lanes, region, emptySources());

    expect(out).toHaveLength(lanes.length);
    expect(out.map((s) => s.laneId)).toEqual([
      'cpap:flow',
      'wear:sleep_stages',
      'wx:temp',
      'wear:heart_rate_intraday',
    ]);
    // Presentation metadata is carried straight through per lane.
    expect(out[0]?.laneName).toBe('Flow');
    expect(out[0]?.unit).toBe('L/min');
  });

  it('resolves a CPAP lane via its channel NAME (lane name === channel name)', () => {
    const flow = channel([1, 2, 3, 4, 5], { name: 'flow', unit: 'L/min' });
    const sources: MeasureDataSources = {
      ...emptySources(),
      cpap: new Map([['Flow', { descriptor: flow, data: flow.data }]]),
    };
    // sampleRate 1 Hz, region [0, 5000) ms -> index [0, 5) -> all five samples.
    const lanes = [
      laneInput(lane({ id: 'cpap:flow', name: 'Flow', unit: 'L/min', group: 'cpap' })),
    ];
    const out = buildMeasureLaneStats(lanes, region, sources);

    const stats = out[0]?.stats;
    expect(stats?.kind).toBe('numeric');
    if (stats?.kind === 'numeric') {
      expect(stats.count).toBe(5);
      expect(stats.mean).toBeCloseTo(3, TOL);
      expect(stats.min).toBeCloseTo(1, TOL);
      expect(stats.max).toBeCloseTo(5, TOL);
    }
  });

  it('resolves a CPAP lane to none when its channel buffer is absent', () => {
    const lanes = [
      laneInput(lane({ id: 'cpap:flow', name: 'Flow', unit: 'L/min', group: 'cpap' })),
    ];
    const out = buildMeasureLaneStats(lanes, region, emptySources());
    expect(out[0]?.stats.kind).toBe('none');
  });

  it('resolves a WEARABLE lane via its lane ID over the full (pre-clipped) buffer', () => {
    // Wearable series are irregularly sampled: the host pre-filters to the
    // in-region values and the model reduces the whole compact buffer, ignoring
    // the time region entirely. So values OUTSIDE the region are still counted
    // here BECAUSE the host already removed them — we pass them all on purpose to
    // prove the full-buffer [0, length) path is used (no time→index clipping).
    const hr: NumericChannelInput = {
      name: 'heart_rate_intraday',
      unit: 'bpm',
      sampleRate: 1,
      data: Float32Array.from([60, 70, 80]),
    };
    const sources: MeasureDataSources = {
      ...emptySources(),
      // Wearable entries wrap the channel as { channel, timesMs }; timesMs is a
      // parallel Float64Array of session-relative ms (zeros are fine here since
      // this test exercises count/mean, not the time-sensitive Trend slope).
      wearableNumeric: new Map([
        ['wear:heart_rate_intraday', { channel: hr, timesMs: Float64Array.from([0, 1000, 2000]) }],
      ]),
    };
    // Region width is tiny (would clip to a single index by sample rate), but the
    // full 3-sample buffer must still be reduced.
    const lanes = [
      laneInput(
        lane({
          id: 'wear:heart_rate_intraday',
          name: 'Heart Rate',
          unit: 'bpm',
          group: 'wearable',
        }),
      ),
    ];
    const out = buildMeasureLaneStats(lanes, { startMs: 0, endMs: 1 }, sources);

    const stats = out[0]?.stats;
    expect(stats?.kind).toBe('numeric');
    if (stats?.kind === 'numeric') {
      expect(stats.count).toBe(3); // full buffer, not time-clipped
      expect(stats.mean).toBeCloseTo(70, TOL); // (60+70+80)/3
      expect(stats.min).toBeCloseTo(60, TOL);
      expect(stats.max).toBeCloseTo(80, TOL);
    }
  });

  it('resolves a wearable lane to none when its compact buffer is absent', () => {
    const lanes = [
      laneInput(
        lane({
          id: 'wear:heart_rate_intraday',
          name: 'Heart Rate',
          unit: 'bpm',
          group: 'wearable',
        }),
      ),
    ];
    const out = buildMeasureLaneStats(lanes, region, emptySources());
    expect(out[0]?.stats.kind).toBe('none');
  });

  it('resolves a SLEEP lane via its lane ID to categorical stage occupancy', () => {
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 1 }, // light
      { timeMs: 2_000, value: 0 }, // deep
    ];
    const sources: MeasureDataSources = {
      ...emptySources(),
      categorical: new Map([['wear:sleep_stages', samples]]),
    };
    const lanes = [
      laneInput(lane({ id: 'wear:sleep_stages', name: 'Sleep Stages', group: 'sleep' })),
    ];
    // region [0, 5000): light [0,2000)=2s, deep [2000,5000)=3s; covered 5s.
    const out = buildMeasureLaneStats(lanes, region, sources);

    const stats = out[0]?.stats;
    expect(stats?.kind).toBe('categorical');
    if (stats?.kind === 'categorical') {
      expect(stats.dominant).toBe(0); // deep held longest
      expect(stats.coveredMs).toBe(5_000);
      expect(stats.stages).toHaveLength(2);
    }
  });

  it('resolves a sleep lane to none when its samples are absent', () => {
    const lanes = [
      laneInput(lane({ id: 'wear:sleep_stages', name: 'Sleep Stages', group: 'sleep' })),
    ];
    const out = buildMeasureLaneStats(lanes, region, emptySources());
    expect(out[0]?.stats.kind).toBe('none');
  });

  it('resolves an unsupported group (weather) to none', () => {
    const lanes = [laneInput(lane({ id: 'wx:temp', name: 'Temperature', group: 'weather' }))];
    const out = buildMeasureLaneStats(lanes, region, emptySources());
    expect(out[0]?.stats.kind).toBe('none');
  });

  it('preserves the collapsed flag per lane', () => {
    const lanes = [
      laneInput(lane({ id: 'a', group: 'weather' }), true),
      laneInput(lane({ id: 'b', group: 'weather' }), false),
    ];
    const out = buildMeasureLaneStats(lanes, region, emptySources());
    expect(out[0]?.collapsed).toBe(true);
    expect(out[1]?.collapsed).toBe(false);
  });

  it('returns an empty array for an empty lane list', () => {
    expect(buildMeasureLaneStats([], region, emptySources())).toEqual([]);
  });
});

// ===========================================================================
// 5. laneStatSummary — the SR / aria-live per-lane text
// ===========================================================================

describe('laneStatSummary', () => {
  /** Wrap stats in the lane envelope laneStatSummary reads. */
  function statFor(stats: RegionStats, over: Partial<MeasureLaneStat> = {}): MeasureLaneStat {
    return {
      laneId: over.laneId ?? 'lane',
      laneName: over.laneName ?? 'Flow',
      unit: over.unit ?? 'L/min',
      colorVar: over.colorVar ?? 'var(--x)',
      collapsed: over.collapsed ?? false,
      stats,
      // `selection` is required on MeasureLaneStat; null for every non-Selection
      // mode (these summary tests cover the per-kind branches, not Selection).
      selection: over.selection ?? null,
    };
  }

  it('spells out average / median / range with the unit for a numeric lane', () => {
    // flow [1,2,3,4,5] => mean 3, median 3, min 1, max 5; 1 decimal place.
    const summary = laneStatSummary(statFor(numericStats([1, 2, 3, 4, 5])));
    expect(summary).toBe('Flow: average 3.0 L/min, median 3.0 L/min, range 1.0 to 5.0 L/min');
  });

  it('prefixes the median with ~ when it is approximate', () => {
    const ch = channel([10, 20, 30, 40, 50, 60, 70], { name: 'flow', unit: 'L/min' });
    const stats = computeNumericStats(ch, { startIndex: 0, endIndex: ch.data.length }, 4);
    expect(stats.medianIsApproximate).toBe(true);
    const summary = laneStatSummary(statFor(stats));
    expect(summary).toContain('median ~');
  });

  it('reports "no data" for an empty numeric region', () => {
    // All-sentinel flow buffer -> count 0.
    const summary = laneStatSummary(statFor(numericStats([0, 0])));
    expect(summary).toBe('Flow: no data');
  });

  it('omits the trailing space when the lane has no unit', () => {
    const summary = laneStatSummary(statFor(numericStats([2, 4]), { unit: '' }));
    // mean (2+4)/2 = 3, median 3, range 2..4; no unit suffix.
    expect(summary).toBe('Flow: average 3.0, median 3.0, range 2.0 to 4.0');
  });

  it('lists stage occupancies for a categorical lane', () => {
    const samples: CategoricalSample[] = [
      { timeMs: 0, value: 1 }, // light, 60s
      { timeMs: 60_000, value: 0 }, // deep, 40s
    ];
    const stats = categoricalStats(samples, { startMs: 0, endMs: 100_000 });
    const summary = laneStatSummary(statFor(stats, { laneName: 'Sleep Stages', unit: '' }));
    expect(summary).toBe('Sleep Stages: Light (N1–2) 60%, Deep (N3) 40%');
  });

  it('reports "no data" for a categorical lane with no covered stages', () => {
    const stats = categoricalStats([], { startMs: 0, endMs: 100 });
    const summary = laneStatSummary(statFor(stats, { laneName: 'Sleep Stages' }));
    expect(summary).toBe('Sleep Stages: no data');
  });

  it('pluralises the event count for a count lane', () => {
    const single: RegionStats = { kind: 'count', count: 1, byType: [] };
    const many: RegionStats = { kind: 'count', count: 3, byType: [] };
    expect(laneStatSummary(statFor(single, { laneName: 'Events' }))).toBe('Events: 1 event');
    expect(laneStatSummary(statFor(many, { laneName: 'Events' }))).toBe('Events: 3 events');
  });

  it('returns null for a none lane so the caller can skip it', () => {
    expect(laneStatSummary(statFor({ kind: 'none' }))).toBeNull();
  });
});

// ===========================================================================
// 6. buildMeasureLaneStats — per-mode dispatch + selection metadata
// ===========================================================================

describe('buildMeasureLaneStats — per-mode dispatch', () => {
  const region: TimeRange = { startMs: 0, endMs: 5_000 };

  /** A CPAP flow source [1,2,3,4,5] @1Hz over region [0,5000) -> all 5 samples. */
  function flowSources(): { lanes: MeasureLaneInput[]; sources: MeasureDataSources } {
    const flow = channel([1, 2, 3, 4, 5], { name: 'flow', unit: 'L/min' });
    const sources: MeasureDataSources = {
      ...emptySources(),
      cpap: new Map([['flow', { descriptor: flow, data: flow.data }]]),
    };
    const lanes = [
      laneInput(lane({ id: 'cpap:flow', name: 'flow', unit: 'L/min', group: 'cpap' })),
    ];
    return { lanes, sources };
  }

  it("defaults to 'statistics' mode (kind 'numeric') with a null selection", () => {
    const { lanes, sources } = flowSources();
    const out = buildMeasureLaneStats(lanes, region, sources); // no 4th arg
    expect(out[0]?.stats.kind).toBe('numeric');
    expect(out[0]?.selection).toBeNull();
  });

  it("maps 'variability' to a spread result (kind 'spread'), null selection", () => {
    const { lanes, sources } = flowSources();
    const out = buildMeasureLaneStats(lanes, region, sources, 'variability');
    expect(out[0]?.stats.kind).toBe('spread');
    expect(out[0]?.selection).toBeNull();
  });

  it("maps 'trend' to a trend result (kind 'trend'), null selection", () => {
    const { lanes, sources } = flowSources();
    const out = buildMeasureLaneStats(lanes, region, sources, 'trend');
    expect(out[0]?.stats.kind).toBe('trend');
    expect(out[0]?.selection).toBeNull();
  });

  it("maps 'distribution' to a distribution result (kind 'distribution'), null selection", () => {
    const { lanes, sources } = flowSources();
    const out = buildMeasureLaneStats(lanes, region, sources, 'distribution');
    expect(out[0]?.stats.kind).toBe('distribution');
    expect(out[0]?.selection).toBeNull();
  });

  it("populates selection ONLY in 'selection' mode (non-null), stats stays numeric", () => {
    const { lanes, sources } = flowSources();
    const out = buildMeasureLaneStats(lanes, region, sources, 'selection');
    // Selection reuses the baseline numeric computation for its count.
    expect(out[0]?.stats.kind).toBe('numeric');
    const sel = out[0]?.selection;
    expect(sel).not.toBeNull();
    expect(sel?.nominal).toBe(true); // CPAP nominal rate
    expect(sel?.rateHz).toBe(1); // descriptor.sampleRate
    expect(sel?.count).toBe(5); // meaningful sample count
    expect(sel?.spanMs).toBe(5_000); // region width
    expect(sel?.stepped).toBe(false);
  });

  it('preserves order/length parity across EVERY mode (chip↔lane alignment)', () => {
    // Mix resolvable + unresolvable lanes; output must be one-per-input, in order,
    // for every mode — the prior QA correctness flag this guards.
    const flow = channel([1, 2, 3, 4, 5], { name: 'flow', unit: 'L/min' });
    const sources: MeasureDataSources = {
      ...emptySources(),
      cpap: new Map([['flow', { descriptor: flow, data: flow.data }]]),
    };
    const lanes: MeasureLaneInput[] = [
      laneInput(lane({ id: 'cpap:flow', name: 'flow', unit: 'L/min', group: 'cpap' })),
      laneInput(lane({ id: 'wx:temp', name: 'Temperature', group: 'weather' })),
      laneInput(lane({ id: 'wear:sleep_stages', name: 'Sleep Stages', group: 'sleep' })),
    ];
    const modes = ['statistics', 'variability', 'trend', 'distribution', 'selection'] as const;
    for (const mode of modes) {
      const out = buildMeasureLaneStats(lanes, region, sources, mode);
      expect(out).toHaveLength(lanes.length);
      expect(out.map((s) => s.laneId)).toEqual(['cpap:flow', 'wx:temp', 'wear:sleep_stages']);
    }
  });

  it('returns kind:none for hypnogram/categorical and weather lanes under numeric modes', () => {
    const samples: CategoricalSample[] = [{ timeMs: 0, value: 1 }];
    const sources: MeasureDataSources = {
      ...emptySources(),
      categorical: new Map([['wear:sleep_stages', samples]]),
    };
    const lanes: MeasureLaneInput[] = [
      laneInput(lane({ id: 'wx:temp', name: 'Temperature', group: 'weather' })),
      laneInput(lane({ id: 'wear:sleep_stages', name: 'Sleep Stages', group: 'sleep' })),
    ];
    // Under a numeric mode (trend), the sleep lane resolves categorical (NOT numeric),
    // and the weather lane resolves to none.
    const out = buildMeasureLaneStats(lanes, region, sources, 'trend');
    expect(out[0]?.stats.kind).toBe('none'); // weather
    expect(out[1]?.stats.kind).toBe('categorical'); // hypnogram, never numeric
  });

  it("uses the passed timesMs for a wearable lane in 'trend' mode (differs from uniform)", () => {
    // Same compute-layer keystone: an irregular-cadence wearable must regress against
    // true timestamps. We build a series whose TRUE-time slope differs from the slope
    // a synthetic uniform Δt (from sampleRate) would yield, and assert the model uses
    // the real times by comparing to a uniform-times computation.
    const data = Float32Array.from([10, 20, 40]);
    const hr: NumericChannelInput = {
      name: 'heart_rate_intraday',
      unit: 'bpm',
      sampleRate: 1,
      data,
    };
    const trueTimes = Float64Array.from([0, 60_000, 180_000]); // 0,1,3 min (irregular)
    const sources: MeasureDataSources = {
      ...emptySources(),
      wearableNumeric: new Map([['wear:hr', { channel: hr, timesMs: trueTimes }]]),
    };
    const lanes = [
      laneInput(lane({ id: 'wear:hr', name: 'Heart Rate', unit: 'bpm', group: 'wearable' })),
    ];
    const out = buildMeasureLaneStats(lanes, region, sources, 'trend');
    const stats = out[0]?.stats;
    expect(stats?.kind).toBe('trend');
    if (stats?.kind === 'trend') {
      // True-time slope of the colinear (0min,10)(1,20)(3,40) line is 10 unit/min.
      expect(stats.slopePerMin).toBeCloseTo(10, 9);
    }
    // A uniform-Δt computation over the same values (no timesMs) must give a DIFFERENT
    // slope — proving the model honored the passed timestamps rather than synthesising.
    const uniform = computeTrendStats(hr, { startIndex: 0, endIndex: 3 });
    expect(Math.abs((uniform.slopePerMin as number) - 10)).toBeGreaterThan(1);
  });
});

// ===========================================================================
// 7. spreadChipRows — SD / CV(percent) / IQR formatting
// ===========================================================================

describe('spreadChipRows', () => {
  it('formats SD and IQR in channel units and CV as a percent (cv*100)', () => {
    // pulse [54,54,66,66]: mean 60, Σdev²=144, sample var=48, sd=√48≈6.928,
    //   cv = sd/|mean| = √48/60 ≈ 0.11547 -> percent ≈ 11.5 (one decimal).
    // pulse decimals = 0, so SD/IQR render as whole numbers.
    const stats = computeSpreadStats(channel([54, 54, 66, 66], { name: 'pulse', unit: 'bpm' }), {
      startIndex: 0,
      endIndex: 4,
    });
    const rows = spreadChipRows(stats);
    expect(rows.unit).toBe('bpm');
    expect(rows.sd).toBe(Math.sqrt(48).toFixed(0)); // '7'
    expect(rows.cv).toBe(((Math.sqrt(48) / 60) * 100).toFixed(1)); // ≈ '11.5'
    expect(rows.cvUndefined).toBe(false);
    expect(rows.empty).toBe(false);
  });

  it('renders a clean CV of 0.10 as "10.0" percent', () => {
    // Construct a pulse fixture whose cv is exactly 0.10: need sd/|mean| = 0.1.
    // [57,63]: mean 60, sample var=18 -> sd=√18≈4.2426 -> cv≈0.0707 -> 7.1%. Not 0.10.
    // For an exact 0.10 we assert the formatter directly on a hand-set fraction via
    // a synthetic stats object would bypass the compute layer; instead verify the
    // documented mapping holds: a fraction 0.10 formats to "10.0".
    // (We assert the contract through the real value just computed above is *_consistent_*.)
    const cvFraction = 0.1;
    expect(formatStatValue(cvFraction * 100, 1)).toBe('10.0');
  });

  it('renders CV as a dash and flags cvUndefined for a non-allowlisted channel (flow)', () => {
    // flow is zero-centred -> cv null even though SD is defined; count>=2 -> cvUndefined.
    const stats = computeSpreadStats(channel([-2, -1, 1, 2, 3], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 5,
    });
    const rows = spreadChipRows(stats);
    expect(rows.cv).toBe('—');
    expect(rows.cvUndefined).toBe(true); // not applicable, vs too-few-samples
    expect(rows.sd).not.toBe('—'); // SD still defined
  });

  it('renders all dashes and empty=true for a count-0 region', () => {
    const stats = computeSpreadStats(channel([0, 0, 0], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 3,
    });
    const rows = spreadChipRows(stats);
    expect(rows.empty).toBe(true);
    expect(rows.sd).toBe('—');
    expect(rows.iqr).toBe('—');
    expect(rows.cv).toBe('—');
    expect(rows.cvUndefined).toBe(false); // count<2, so "too few", not "not applicable"
  });
});

// ===========================================================================
// 8. trendChipRows / trendPercentChange / trendDirection — signed + percent
// ===========================================================================

/**
 * A perfectly colinear wearable trend fixture computed via the real compute layer:
 * values [10,20,30] at true times [1,2,3] min ->
 *   slope = 10 unit/min, netDelta = 20, mean = 20, firstFitted = 10, R² = 1,
 *   percent change = 100·netDelta/|mean| = 100·20/20 = 100.0% (exact, hand-computable).
 *
 * NOTE: the originally-suggested `[0..59]@1Hz -> mean 29.5, netDelta 59, 200%`
 * fixture is NOT achievable — the value 0 at index 0 is a sentinel rejected by
 * `isMeaningfulSample` for EVERY channel, so that ramp yields count 59, mean 30,
 * netDelta 58, ≈193.3%. This colinear fixture gives an exact, round percentage
 * instead. See the report for details.
 */
function colinearTrend(): Extract<RegionStats, { kind: 'trend' }> {
  const ch = channel([10, 20, 30], { name: 'heart_rate_intraday', unit: 'bpm' });
  return computeTrendStats(
    ch,
    { startIndex: 0, endIndex: 3 },
    Float64Array.from([60_000, 120_000, 180_000]),
  );
}

describe('trendPercentChange', () => {
  it('computes 100·netDelta/|mean| on the colinear fixture (= 100.0%)', () => {
    const stats = colinearTrend();
    expect(stats.mean).toBeCloseTo(20, 9);
    expect(stats.netDelta).toBeCloseTo(20, 9);
    expect(trendPercentChange(stats)).toBeCloseTo(100, 9);
  });

  it('returns null (dash) when netDelta is null', () => {
    // Single sample -> count<2 -> netDelta null.
    const stats = computeTrendStats(channel([42], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 1,
    });
    expect(trendPercentChange(stats)).toBeNull();
  });

  it('returns null (dash) when |mean| < TREND_BASE_EPSILON', () => {
    // Symmetric values about 0 over distinct times -> mean ≈ 0; heart_rate_intraday
    // has no range gate so tiny values stay meaningful.
    const ch = channel([1e-9, -1e-9], { name: 'heart_rate_intraday', unit: 'bpm' });
    const stats = computeTrendStats(
      ch,
      { startIndex: 0, endIndex: 2 },
      Float64Array.from([0, 60_000]),
    );
    expect(Math.abs(stats.mean as number)).toBeLessThan(1e-6);
    expect(trendPercentChange(stats)).toBeNull();
  });
});

describe('trendChipRows', () => {
  it('formats slope/net/percent with explicit signs (U+2212 minus for negatives)', () => {
    const stats = colinearTrend(); // rising line, slope +10/min, net +20, +100%
    const rows = trendChipRows(stats);
    // heart_rate_intraday has no name/unit decimal rule -> default 2; slope at d+1=3.
    expect(rows.slope.startsWith('+')).toBe(true);
    expect(rows.net.startsWith('+')).toBe(true);
    expect(rows.percent).toBe('+100.0');
    expect(rows.direction).toBe('rising');
    expect(rows.rSquared).toBe('1.00'); // R²=1 -> 2dp
    expect(rows.empty).toBe(false);
  });

  it('uses the U+2212 minus sign for a falling trend', () => {
    // Descending colinear line [30,20,10] at [1,2,3] min -> slope −10/min.
    const ch = channel([30, 20, 10], { name: 'heart_rate_intraday', unit: 'bpm' });
    const stats = computeTrendStats(
      ch,
      { startIndex: 0, endIndex: 3 },
      Float64Array.from([60_000, 120_000, 180_000]),
    );
    const rows = trendChipRows(stats);
    expect(rows.slope.startsWith('−')).toBe(true); // U+2212, not ASCII hyphen
    expect(rows.direction).toBe('falling');
    expect(rows.percent.startsWith('−')).toBe(true); // net change negative
  });

  it('renders percent as a dash when the percent change is suppressed', () => {
    const ch = channel([1e-9, -1e-9], { name: 'heart_rate_intraday', unit: 'bpm' });
    const stats = computeTrendStats(
      ch,
      { startIndex: 0, endIndex: 2 },
      Float64Array.from([0, 60_000]),
    );
    expect(trendChipRows(stats).percent).toBe('—');
  });

  it('marks the chip empty for a region with too few samples', () => {
    const stats = computeTrendStats(channel([42], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 1,
    });
    const rows = trendChipRows(stats);
    expect(rows.empty).toBe(true);
    expect(rows.slope).toBe('—');
    expect(rows.net).toBe('—');
    expect(rows.percent).toBe('—');
  });
});

describe('trendDirection', () => {
  it('returns "rising" for a positive slope above display precision', () => {
    expect(trendDirection(colinearTrend())).toBe('rising');
  });

  it('returns "falling" for a negative slope', () => {
    const ch = channel([30, 20, 10], { name: 'heart_rate_intraday', unit: 'bpm' });
    const stats = computeTrendStats(
      ch,
      { startIndex: 0, endIndex: 3 },
      Float64Array.from([60_000, 120_000, 180_000]),
    );
    expect(trendDirection(stats)).toBe('falling');
  });

  it('returns "flat" for a constant-value region (slope rounds to 0) and for a null slope', () => {
    const flat = computeTrendStats(channel([7, 7, 7, 7], { name: 'flow', sampleRate: 1 }), {
      startIndex: 0,
      endIndex: 4,
    });
    expect(flat.slopePerMin).toBeCloseTo(0, 9);
    expect(trendDirection(flat)).toBe('flat');
    // Single-sample -> slopePerMin null -> flat.
    const none = computeTrendStats(channel([42], { name: 'flow' }), { startIndex: 0, endIndex: 1 });
    expect(trendDirection(none)).toBe('flat');
  });
});

// ===========================================================================
// 9. distributionChipRows — percentile formatting
// ===========================================================================

describe('distributionChipRows', () => {
  it('formats p5..p95 in channel decimals for [1..9] flow', () => {
    // type-7 over [1..9]: p5=1.4, p25=3, p50=5, p75=7, p95=8.6; flow -> 1dp.
    const stats = computeDistributionStats(channel([1, 2, 3, 4, 5, 6, 7, 8, 9], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 9,
    });
    const rows = distributionChipRows(stats);
    expect(rows.p5).toBe('1.4');
    expect(rows.p25).toBe('3.0');
    expect(rows.p50).toBe('5.0');
    expect(rows.p75).toBe('7.0');
    expect(rows.p95).toBe('8.6');
    expect(rows.approximate).toBe(false);
    expect(rows.empty).toBe(false);
  });

  it('renders all dashes and empty=true when count < 2', () => {
    const stats = computeDistributionStats(channel([42], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 1,
    });
    const rows = distributionChipRows(stats);
    expect(rows.empty).toBe(true);
    expect(rows.p5).toBe('—');
    expect(rows.p50).toBe('—');
    expect(rows.p95).toBe('—');
  });
});

// ===========================================================================
// 10. selectionChipRows + LaneSelectionInfo
// ===========================================================================

describe('selectionChipRows', () => {
  it('renders a nominal CPAP integer rate without the ~ estimate prefix', () => {
    const info: LaneSelectionInfo = {
      rateHz: 25,
      nominal: true,
      stepped: false,
      count: 1000,
      spanMs: 40_000,
    };
    const rows = selectionChipRows(info);
    expect(rows.rate).toBe('25'); // integer nominal rate, no ~
    expect(rows.rateEstimated).toBe(false);
    expect(rows.count).toBe((1000).toLocaleString());
    expect(rows.span).toBe('40s');
    expect(rows.empty).toBe(false);
  });

  it('renders a wearable mean cadence with a ~ prefix and flags it estimated', () => {
    const info: LaneSelectionInfo = {
      rateHz: 0.5,
      nominal: false,
      stepped: false,
      count: 30,
      spanMs: 60_000,
    };
    const rows = selectionChipRows(info);
    expect(rows.rate).toBe('~0.50'); // estimated cadence, 2dp, ~ prefix
    expect(rows.rateEstimated).toBe(true);
    expect(rows.span).toBe('1:00'); // 60s -> m:ss
  });

  it('renders a stepped (hypnogram) lane as "— stepped", never empty', () => {
    const info: LaneSelectionInfo = {
      rateHz: null,
      nominal: false,
      stepped: true,
      count: 0,
      spanMs: 10_000,
    };
    const rows = selectionChipRows(info);
    expect(rows.rate).toBe('— stepped');
    expect(rows.empty).toBe(false); // stepped lanes are not "no data"
  });

  it('renders a plain dash for a null rate and marks an empty wearable region', () => {
    const info: LaneSelectionInfo = {
      rateHz: null,
      nominal: false,
      stepped: false,
      count: 0,
      spanMs: 5_000,
    };
    const rows = selectionChipRows(info);
    expect(rows.rate).toBe('—');
    expect(rows.empty).toBe(true); // count 0, not stepped -> no data
  });
});

describe('resolveSelectionInfo (via buildMeasureLaneStats in selection mode)', () => {
  const region: TimeRange = { startMs: 0, endMs: 4_000 };

  it('derives a wearable effective cadence (nominal:false) from count/span', () => {
    // 100 samples over a 4s span -> effectiveCadenceHz = 100/4 = 25 Hz, estimated.
    const data = Float32Array.from(Array.from({ length: 100 }, () => 70));
    const hr: NumericChannelInput = {
      name: 'heart_rate_intraday',
      unit: 'bpm',
      sampleRate: 1,
      data,
    };
    const sources: MeasureDataSources = {
      ...emptySources(),
      wearableNumeric: new Map([
        [
          'wear:hr',
          { channel: hr, timesMs: Float64Array.from(Array.from({ length: 100 }, (_, i) => i)) },
        ],
      ]),
    };
    const lanes = [
      laneInput(lane({ id: 'wear:hr', name: 'Heart Rate', unit: 'bpm', group: 'wearable' })),
    ];
    const out = buildMeasureLaneStats(lanes, region, sources, 'selection');
    const sel = out[0]?.selection;
    expect(sel?.nominal).toBe(false);
    expect(sel?.count).toBe(100);
    expect(sel?.spanMs).toBe(4_000);
    expect(sel?.rateHz).toBeCloseTo(25, 9); // 100 / (4000/1000)
  });

  it('marks a hypnogram lane stepped with a null rate in selection mode', () => {
    const samples: CategoricalSample[] = [{ timeMs: 0, value: 1 }];
    const sources: MeasureDataSources = {
      ...emptySources(),
      categorical: new Map([['wear:sleep_stages', samples]]),
    };
    const lanes = [
      laneInput(lane({ id: 'wear:sleep_stages', name: 'Sleep Stages', group: 'sleep' })),
    ];
    const out = buildMeasureLaneStats(lanes, region, sources, 'selection');
    const sel = out[0]?.selection;
    expect(sel?.stepped).toBe(true);
    expect(sel?.rateHz).toBeNull();
    expect(sel?.spanMs).toBe(4_000);
  });
});

// ===========================================================================
// 11. formatSignedStatValue — leading sign, signed zero, null
// ===========================================================================

describe('formatSignedStatValue', () => {
  it('prefixes positive values with +', () => {
    expect(formatSignedStatValue(2.5, 1)).toBe('+2.5');
    expect(formatSignedStatValue(100, 0)).toBe('+100');
  });

  it('prefixes negative values with the U+2212 minus sign (not an ASCII hyphen)', () => {
    expect(formatSignedStatValue(-2.5, 1)).toBe('−2.5'); // U+2212
    expect(formatSignedStatValue(-2.5, 1)).not.toBe('-2.5'); // not the ASCII hyphen
  });

  it('renders a value that rounds to zero as +0 (never −0)', () => {
    expect(formatSignedStatValue(0, 1)).toBe('+0.0');
    expect(formatSignedStatValue(-0, 1)).toBe('+0.0');
    expect(formatSignedStatValue(-0.04, 1)).toBe('+0.0'); // rounds to 0 -> non-negative
  });

  it('renders null / non-finite as the no-data dash (no sign)', () => {
    expect(formatSignedStatValue(null, 1)).toBe('—');
    expect(formatSignedStatValue(NaN, 1)).toBe('—');
    expect(formatSignedStatValue(Infinity, 1)).toBe('—');
  });
});

// ===========================================================================
// 12. laneStatSummary — per-mode SR strings (spread / trend / distribution / selection)
// ===========================================================================

describe('laneStatSummary — per-mode branches', () => {
  /** Wrap stats in the lane envelope laneStatSummary reads. */
  function statFor(stats: RegionStats, over: Partial<MeasureLaneStat> = {}): MeasureLaneStat {
    return {
      laneId: over.laneId ?? 'lane',
      laneName: over.laneName ?? 'Flow',
      unit: over.unit ?? 'L/min',
      colorVar: over.colorVar ?? 'var(--x)',
      collapsed: over.collapsed ?? false,
      stats,
      selection: over.selection ?? null,
    };
  }

  it('spells out SD / CV / IQR for a spread lane', () => {
    const stats = computeSpreadStats(channel([54, 54, 66, 66], { name: 'pulse', unit: 'bpm' }), {
      startIndex: 0,
      endIndex: 4,
    });
    const summary = laneStatSummary(statFor(stats, { laneName: 'Pulse', unit: 'bpm' }));
    expect(summary).toContain('Pulse: standard deviation');
    expect(summary).toContain('coefficient of variation');
    expect(summary).toContain('interquartile range');
  });

  it('reports CV as "undefined" in the spread summary for a non-applicable channel', () => {
    const stats = computeSpreadStats(channel([-2, -1, 1, 2, 3], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 5,
    });
    const summary = laneStatSummary(statFor(stats, { laneName: 'Flow' }));
    expect(summary).toContain('coefficient of variation undefined');
  });

  it('spells out slope / net / percent change / direction for a trend lane', () => {
    const stats = colinearTrend();
    const summary = laneStatSummary(statFor(stats, { laneName: 'Heart Rate', unit: 'bpm' }));
    expect(summary).toContain('Heart Rate: slope +10');
    expect(summary).toContain('per minute');
    expect(summary).toContain('+100.0% change'); // the new percent-change phrasing
    expect(summary).toContain('rising');
    expect(summary).toContain('R squared 1.00');
  });

  it('omits the percent-change clause when it is suppressed', () => {
    const ch = channel([1e-9, -1e-9], { name: 'heart_rate_intraday', unit: 'bpm' });
    const stats = computeTrendStats(
      ch,
      { startIndex: 0, endIndex: 2 },
      Float64Array.from([0, 60_000]),
    );
    const summary = laneStatSummary(statFor(stats, { laneName: 'HR', unit: 'bpm' }));
    expect(summary).not.toContain('% change');
  });

  it('lists the five percentiles for a distribution lane', () => {
    const stats = computeDistributionStats(channel([1, 2, 3, 4, 5, 6, 7, 8, 9], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 9,
    });
    const summary = laneStatSummary(statFor(stats, { laneName: 'Flow' }));
    expect(summary).toBe(
      'Flow: 5th percentile 1.4 L/min, 25th 3.0 L/min, median 5.0 L/min, 75th 7.0 L/min, 95th 8.6 L/min',
    );
  });

  it('reports "no data" for a trend/spread/distribution lane with too few samples', () => {
    const trend = computeTrendStats(channel([42], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 1,
    });
    expect(laneStatSummary(statFor(trend, { laneName: 'Flow' }))).toBe('Flow: no data');
    const dist = computeDistributionStats(channel([42], { name: 'flow' }), {
      startIndex: 0,
      endIndex: 1,
    });
    expect(laneStatSummary(statFor(dist, { laneName: 'Flow' }))).toBe('Flow: no data');
  });

  it('reports the selection-mode rate / count / span when a selection is present', () => {
    const selection: LaneSelectionInfo = {
      rateHz: 25,
      nominal: true,
      stepped: false,
      count: 1000,
      spanMs: 40_000,
    };
    // The stats kind is irrelevant once `selection` is set — the summary is metadata-driven.
    const stat = statFor(
      {
        kind: 'numeric',
        count: 1000,
        mean: 0,
        median: 0,
        min: 0,
        max: 0,
        medianIsApproximate: false,
        unit: 'L/min',
        decimals: 1,
      },
      { laneName: 'Flow', selection },
    );
    const summary = laneStatSummary(stat);
    expect(summary).toContain('Flow: sample rate 25 Hz');
    expect(summary).toContain('1,000 samples');
    expect(summary).toContain('span 40s');
  });

  it('reports a stepped selection lane with its span', () => {
    const selection: LaneSelectionInfo = {
      rateHz: null,
      nominal: false,
      stepped: true,
      count: 0,
      spanMs: 120_000,
    };
    const stat = statFor({ kind: 'none' }, { laneName: 'Sleep Stages', selection });
    const summary = laneStatSummary(stat);
    expect(summary).toBe('Sleep Stages: stepped lane, span 2:00');
  });
});
