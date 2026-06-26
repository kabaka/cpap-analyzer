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
  numericChipRows,
  categoricalChipRows,
  buildMeasureLaneStats,
  laneStatSummary,
  type MeasureLaneInput,
  type MeasureDataSources,
  type MeasureLaneStat,
} from '../regionStatsModel';
import {
  computeNumericStats,
  computeCategoricalStats,
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
      wearableNumeric: new Map([['wear:heart_rate_intraday', hr]]),
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
