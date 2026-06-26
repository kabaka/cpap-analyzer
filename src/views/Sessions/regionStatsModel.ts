/**
 * Region-statistics MARSHALLING + display formatting for the Signal Viewer's
 * "Measure region" overlay.
 *
 * This is the thin, React-free glue between the viewer's in-memory lane data and
 * the pure {@link module:views/Sessions/regionStats} computation module. It does
 * NOT compute any statistic itself — it only resolves, per visible lane, which
 * inputs the stats kind needs (a CPAP buffer, a hypnogram step series, or the
 * event list), calls {@link computeRegionStats}, and formats the discriminated
 * result into the small primitives the chips / table / live-region render.
 *
 * Keeping this here (rather than inline in the 3k-line component) makes the
 * lane→input resolution and the number formatting unit-testable without mounting
 * the canvas-heavy view, and keeps the hot-path component lean.
 *
 * @module views/Sessions/regionStatsModel
 */

import {
  computeRegionStats,
  statsKindForGroup,
  type CategoricalSample,
  type EventInput,
  type NumericChannelInput,
  type RegionStats,
  type TimeRange,
} from './regionStats';
import { sleepStageName, type LaneDescriptor } from './signalLanes';
import { formatDuration } from './hoverReadout';

/** A visible lane plus the layout info the overlay needs to place its chip. */
export interface MeasureLaneInput {
  readonly lane: LaneDescriptor;
  /** Resolved pixel height of the lane row (collapsed lanes are short). */
  readonly height: number;
  /** Whether the lane is collapsed to a stub (drives the compact chip variant). */
  readonly collapsed: boolean;
}

/** The data sources the model reads from, supplied by the host component. */
export interface MeasureDataSources {
  /** CPAP full-session buffers keyed by channel name (lane name === channel name). */
  readonly cpap: ReadonlyMap<
    string,
    { readonly descriptor: NumericChannelInput; readonly data: Float32Array }
  >;
  /**
   * Wearable continuous channels keyed by lane id (`wear:<type>`).
   *
   * Wearable series are IRREGULARLY sampled (each value carries its own
   * session-relative time), so — unlike CPAP — we cannot map a time region to an
   * index range with a single uniform sample rate. The host therefore pre-filters
   * each series to the in-region values and hands us a COMPACT `NumericChannelInput`
   * whose `data` is exactly those values; the model reduces it over its full
   * `[0, length)` index range. This keeps the pure stats module's uniform-spacing
   * contract intact while respecting the wearable cadence.
   */
  readonly wearableNumeric: ReadonlyMap<string, NumericChannelInput>;
  /**
   * Hypnogram step series keyed by lane id (`wear:sleep_stages`), already
   * projected to session-relative ms and ascending — the categorical input.
   */
  readonly categorical: ReadonlyMap<string, readonly CategoricalSample[]>;
  /** All device/marker events, session-relative, for count lanes. */
  readonly events: readonly EventInput[];
}

/** A single lane's resolved, formatted region statistic, ready to render. */
export interface MeasureLaneStat {
  readonly laneId: string;
  readonly laneName: string;
  readonly unit: string;
  readonly colorVar: string;
  readonly collapsed: boolean;
  readonly stats: RegionStats;
}

/**
 * Resolve every visible lane to its {@link RegionStats} for `region`.
 *
 * Event lanes are not a separate lane group in this viewer (events are markers
 * across the stack), so the count statistic is intentionally NOT attached to a
 * lane here — it is surfaced once in the footer / table by the host, computed
 * directly. This function therefore handles the per-lane numeric/categorical
 * cases and returns `{ kind: 'none' }` for lanes with no meaningful statistic
 * (weather lanes, empty lanes), which the host renders as "— no data".
 */
export function buildMeasureLaneStats(
  lanes: readonly MeasureLaneInput[],
  region: TimeRange,
  sources: MeasureDataSources,
): MeasureLaneStat[] {
  const out: MeasureLaneStat[] = [];
  for (const { lane, collapsed } of lanes) {
    const stats = resolveLaneStats(lane, region, sources);
    out.push({
      laneId: lane.id,
      laneName: lane.name,
      unit: lane.unit,
      colorVar: lane.colorVar,
      collapsed,
      stats,
    });
  }
  return out;
}

function resolveLaneStats(
  lane: LaneDescriptor,
  region: TimeRange,
  sources: MeasureDataSources,
): RegionStats {
  const kind = statsKindForGroup(lane.group);
  switch (kind) {
    case 'numeric': {
      // CPAP lanes key their buffer by channel name; wearable numeric lanes by id.
      if (lane.group === 'cpap') {
        const fcd = sources.cpap.get(lane.name);
        if (!fcd) return { kind: 'none' };
        return computeRegionStats('numeric', { channel: fcd.descriptor, timeRange: region });
      }
      // Wearable: the host already clipped `data` to the in-region values, so we
      // reduce over the whole compact buffer (full-buffer index range), NOT via a
      // uniform time→index conversion (the cadence is irregular).
      const channel = sources.wearableNumeric.get(lane.id);
      if (!channel) return { kind: 'none' };
      return computeRegionStats('numeric', {
        channel,
        indexRange: { startIndex: 0, endIndex: channel.data.length },
      });
    }
    case 'categorical': {
      const samples = sources.categorical.get(lane.id);
      if (!samples) return { kind: 'none' };
      return computeRegionStats('categorical', {
        categoricalSamples: samples,
        timeRange: region,
      });
    }
    default:
      return { kind: 'none' };
  }
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** A formatted numeric value (or the no-data dash). Unit is rendered separately. */
export function formatStatValue(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

/**
 * Per-stat row primitives for the numeric chip (avg/med/min/max). The host
 * pairs each with its glyph + accessible word. Median carries the approximate
 * flag so the host can append a `~` / caveat.
 */
export interface NumericChipRows {
  readonly avg: string;
  readonly med: string;
  readonly min: string;
  readonly max: string;
  readonly medianIsApproximate: boolean;
  readonly unit: string;
  /** True when exactly one meaningful sample fell in the region (special copy). */
  readonly singleSample: boolean;
  /** True when no meaningful sample fell in the region (render "— no data"). */
  readonly empty: boolean;
}

/** Reduce a numeric RegionStats to formatted chip rows. */
export function numericChipRows(stats: Extract<RegionStats, { kind: 'numeric' }>): NumericChipRows {
  const d = stats.decimals;
  return {
    avg: formatStatValue(stats.mean, d),
    med: formatStatValue(stats.median, d),
    min: formatStatValue(stats.min, d),
    max: formatStatValue(stats.max, d),
    medianIsApproximate: stats.medianIsApproximate,
    unit: stats.unit,
    singleSample: stats.count === 1,
    empty: stats.count === 0,
  };
}

/** One categorical stage row, formatted for the chip/table. */
export interface CategoricalChipRow {
  readonly stageName: string;
  /** Whole-percent occupancy within the covered region (0–100). */
  readonly percent: number;
  readonly durationLabel: string;
}

/** Reduce a categorical RegionStats to per-stage rows (already duration-sorted). */
export function categoricalChipRows(
  stats: Extract<RegionStats, { kind: 'categorical' }>,
): CategoricalChipRow[] {
  return stats.stages.map((s) => ({
    stageName: sleepStageName(s.value),
    percent: Math.round(s.fraction * 100),
    durationLabel: formatDuration(Math.round(s.durationMs / 1000)),
  }));
}

/**
 * A concise one-line spoken/aria summary for one lane's statistic. Used to build
 * the polite live-region announcement (first few lanes) and the table's caption
 * fallbacks. Returns `null` for `none` so the caller can skip empty lanes.
 */
export function laneStatSummary(stat: MeasureLaneStat): string | null {
  const { stats, laneName, unit } = stat;
  switch (stats.kind) {
    case 'numeric': {
      if (stats.count === 0) return `${laneName}: no data`;
      const d = stats.decimals;
      const u = unit ? ` ${unit}` : '';
      const med = stats.medianIsApproximate ? '~' : '';
      return (
        `${laneName}: average ${formatStatValue(stats.mean, d)}${u}, ` +
        `median ${med}${formatStatValue(stats.median, d)}${u}, ` +
        `range ${formatStatValue(stats.min, d)} to ${formatStatValue(stats.max, d)}${u}`
      );
    }
    case 'categorical': {
      if (stats.stages.length === 0) return `${laneName}: no data`;
      const parts = stats.stages
        .slice(0, 4)
        .map((s) => `${sleepStageName(s.value)} ${Math.round(s.fraction * 100)}%`);
      return `${laneName}: ${parts.join(', ')}`;
    }
    case 'count':
      return `${laneName}: ${stats.count} event${stats.count === 1 ? '' : 's'}`;
    case 'none':
    default:
      return null;
  }
}
