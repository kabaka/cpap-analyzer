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
  effectiveCadenceHz,
  statsKindForGroup,
  TREND_BASE_EPSILON,
  type CategoricalSample,
  type EventInput,
  type NumericChannelInput,
  type NumericMode,
  type RegionStats,
  type TimeRange,
} from './regionStats';
import { sleepStageName, type LaneDescriptor } from './signalLanes';
import { formatDuration } from './hoverReadout';

/**
 * Which statistic the Measure overlay renders. The string union mirrors
 * {@link module:views/Sessions/laneState.MeasureStatMode}; it is duplicated here so
 * this pure layer stays free of the React/localStorage module. UI order is also the
 * `.`/`,` cycle order.
 */
export type MeasureMode = 'statistics' | 'variability' | 'trend' | 'distribution' | 'selection';

/**
 * Map an overlay {@link MeasureMode} to the compute layer's {@link NumericMode}.
 *
 * `'selection'` is NOT a compute mode — it surfaces sample-rate / count / span,
 * which are layout/metadata facts the model derives directly (no per-sample
 * reduction beyond the count). For the lane-stat resolution we still need a
 * meaningful-sample count, so Selection reuses the baseline `'stats'` computation
 * (its `count` is exactly the meaningful-sample count) and the Selection formatter
 * reads `count` off it.
 */
function numericModeFor(mode: MeasureMode): NumericMode {
  switch (mode) {
    case 'variability':
      return 'spread';
    case 'trend':
      return 'trend';
    case 'distribution':
      return 'distribution';
    case 'statistics':
    case 'selection':
    default:
      return 'stats';
  }
}

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
   *
   * `timesMs` carries the PARALLEL session-relative timestamp of each clipped value
   * (same length / ordering as `channel.data`). It is REQUIRED for a correct Trend
   * slope on wearables: the OLS regression must run against true timestamps, not a
   * synthetic uniform Δt. The host already computes these per-sample times when it
   * clips the series, so carrying them here is free. CPAP lanes are uniform and omit
   * it (the regression synthesises `i / sampleRate`).
   */
  readonly wearableNumeric: ReadonlyMap<
    string,
    { readonly channel: NumericChannelInput; readonly timesMs: Float64Array }
  >;
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
  /**
   * Selection-mode metadata (sample rate / count / span), present only when the
   * active mode is `'selection'`. `null` for every other mode (the per-mode chip
   * reads `stats` instead). Carried alongside `stats` so the Selection chip /
   * table can render rate + span without a second pass; `stats` for Selection is
   * the baseline numeric result, used only for its `count`.
   */
  readonly selection: LaneSelectionInfo | null;
}

/**
 * Per-lane Selection-mode facts: the effective sample rate, the meaningful sample
 * count, and the region span. `rateHz` is `null` when undefined (e.g. an empty
 * wearable lane); `stepped` marks a hypnogram lane (no single rate). For CPAP the
 * rate is the nominal `descriptor.sampleRate`; for wearables it is the mean cadence
 * {@link effectiveCadenceHz} (irregular sampling, shown as `~Hz`).
 */
export interface LaneSelectionInfo {
  /** Effective sample rate in Hz, or `null` when not applicable / no data. */
  readonly rateHz: number | null;
  /** True for the nominal CPAP rate; false for a wearable mean cadence. */
  readonly nominal: boolean;
  /** True for a stepped/categorical lane (hypnogram) — render "— stepped". */
  readonly stepped: boolean;
  /** Meaningful sample count in the region. */
  readonly count: number;
  /** Region span in ms (`endMs − startMs`). */
  readonly spanMs: number;
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
  mode: MeasureMode = 'statistics',
): MeasureLaneStat[] {
  const out: MeasureLaneStat[] = [];
  const spanMs = Math.max(0, region.endMs - region.startMs);
  for (const { lane, collapsed } of lanes) {
    const stats = resolveLaneStats(lane, region, sources, mode);
    // Selection metadata is derived only when the Selection mode is active; it
    // reuses the (baseline) `stats.count` for the meaningful-sample figure.
    const selection =
      mode === 'selection' ? resolveSelectionInfo(lane, stats, sources, spanMs) : null;
    out.push({
      laneId: lane.id,
      laneName: lane.name,
      unit: lane.unit,
      colorVar: lane.colorVar,
      collapsed,
      stats,
      selection,
    });
  }
  return out;
}

function resolveLaneStats(
  lane: LaneDescriptor,
  region: TimeRange,
  sources: MeasureDataSources,
  mode: MeasureMode,
): RegionStats {
  const kind = statsKindForGroup(lane.group);
  const numericMode = numericModeFor(mode);
  switch (kind) {
    case 'numeric': {
      // CPAP lanes key their buffer by channel name; wearable numeric lanes by id.
      if (lane.group === 'cpap') {
        const fcd = sources.cpap.get(lane.name);
        if (!fcd) return { kind: 'none' };
        // CPAP is uniformly sampled — omit `timesMs` (the regression synthesises it).
        return computeRegionStats('numeric', {
          channel: fcd.descriptor,
          timeRange: region,
          mode: numericMode,
        });
      }
      // Wearable: the host already clipped `data` to the in-region values, so we
      // reduce over the whole compact buffer (full-buffer index range), NOT via a
      // uniform time→index conversion (the cadence is irregular). For Trend we MUST
      // pass the parallel `timesMs` so the slope is fit against true timestamps.
      const entry = sources.wearableNumeric.get(lane.id);
      if (!entry) return { kind: 'none' };
      return computeRegionStats('numeric', {
        channel: entry.channel,
        indexRange: { startIndex: 0, endIndex: entry.channel.data.length },
        mode: numericMode,
        timesMs: entry.timesMs,
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

/**
 * Derive a lane's Selection-mode facts (sample rate / count / span). CPAP uses the
 * nominal descriptor sample rate; wearables use the mean cadence (irregular); the
 * hypnogram is `stepped` (no single rate). Counts come from the already-computed
 * baseline `stats` so we never re-scan the buffer.
 */
function resolveSelectionInfo(
  lane: LaneDescriptor,
  stats: RegionStats,
  sources: MeasureDataSources,
  spanMs: number,
): LaneSelectionInfo {
  if (lane.group === 'sleep') {
    return { rateHz: null, nominal: false, stepped: true, count: 0, spanMs };
  }
  const count = stats.kind === 'numeric' ? stats.count : 0;
  if (lane.group === 'cpap') {
    const fcd = sources.cpap.get(lane.name);
    const rateHz = fcd ? fcd.descriptor.sampleRate : null;
    return { rateHz, nominal: true, stepped: false, count, spanMs };
  }
  // Wearable numeric: mean cadence over the region's true duration.
  return {
    rateHz: effectiveCadenceHz(count, spanMs),
    nominal: false,
    stepped: false,
    count,
    spanMs,
  };
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

/**
 * Format a number with an explicit leading sign for trend metrics. Uses U+2212
 * (MINUS SIGN) for negatives so the figure aligns under tabular figures, and a
 * `+` for positive / `±0`. `null`/non-finite → the no-data dash (no sign). A value
 * that rounds to zero at `decimals` is shown as `+0.0…` (signed zero is fine; the
 * sign char is authoritative and color is never used to convey it).
 */
export function formatSignedStatValue(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const fixed = Math.abs(value).toFixed(decimals);
  // Treat a value that rounds to 0 as non-negative ("+0.0") to avoid "−0.0".
  const negative = value < 0 && Number(fixed) !== 0;
  return `${negative ? '−' : '+'}${fixed}`;
}

/**
 * Per-stat row primitives for the Variability (spread) chip. Each is a formatted
 * value or the no-data dash; the host pairs each with its glyph + accessible word.
 * `cvUndefined` distinguishes "CV not applicable for this lane" (zero-mean /
 * non-allowlisted) from "too few samples" so the host can title the dash.
 */
export interface SpreadChipRows {
  readonly sd: string;
  readonly cv: string;
  readonly iqr: string;
  /** True when CV is not a meaningful statistic for this lane (dash + title). */
  readonly cvUndefined: boolean;
  readonly unit: string;
  /** True when no meaningful sample fell in the region (render "— no data"). */
  readonly empty: boolean;
}

/** Reduce a spread RegionStats to formatted chip rows. CV is a percentage. */
export function spreadChipRows(stats: Extract<RegionStats, { kind: 'spread' }>): SpreadChipRows {
  const d = stats.decimals;
  return {
    sd: formatStatValue(stats.sd, d),
    // CV is dimensionless → percent; one decimal reads well for the 0–100 range.
    cv: stats.cv === null ? '—' : formatStatValue(stats.cv * 100, 1),
    iqr: formatStatValue(stats.iqr, d),
    cvUndefined: stats.cv === null && stats.count >= 2,
    unit: stats.unit,
    empty: stats.count === 0,
  };
}

/** Trend direction derived from the (display-rounded) slope. */
export type TrendDirection = 'rising' | 'falling' | 'flat';

/**
 * Per-stat row primitives for the Trend chip. Slope/net/percent carry explicit
 * signs; `direction` is the rising/falling/flat arrow word. `rSquared` is a muted
 * trailing note. Percent change uses the region MEAN as its base (the compute
 * layer's recommended, noise-stable denominator), `null`/dash when the mean is ≈0.
 */
export interface TrendChipRows {
  readonly slope: string;
  readonly net: string;
  readonly percent: string;
  readonly direction: TrendDirection;
  readonly rSquared: string | null;
  readonly unit: string;
  /** True when the region has too few samples / no slope (render "— no data"). */
  readonly empty: boolean;
}

/**
 * Reduce a trend RegionStats to formatted chip rows.
 *
 * - **Slope** is displayed at `decimals + 1` (slopes are small per-minute rates).
 * - **Net** uses the channel's `decimals`.
 * - **% change** = `100 · netDelta / |mean|`, using the region MEAN (`stats.mean`)
 *   echoed by the compute layer as the noise-stable base (the recommended denominator;
 *   see {@link TrendRegionStats.mean}). Suppressed (dash) when the mean is `null` or
 *   `|mean| < TREND_BASE_EPSILON`. See {@link trendPercentChange}.
 * - **Direction** is "flat" when the slope rounds to zero at the slope display
 *   precision (`decimals + 1`), else rising/falling by sign.
 *
 * @param stats - The trend result for the lane.
 */
export function trendChipRows(stats: Extract<RegionStats, { kind: 'trend' }>): TrendChipRows {
  const d = stats.decimals;
  const slopeDecimals = d + 1;
  const percent = trendPercentChange(stats);
  return {
    slope: formatSignedStatValue(stats.slopePerMin, slopeDecimals),
    net: formatSignedStatValue(stats.netDelta, d),
    percent: percent === null ? '—' : formatSignedStatValue(percent, 1),
    direction: trendDirection(stats),
    rSquared: stats.rSquared === null ? null : stats.rSquared.toFixed(2),
    unit: stats.unit,
    empty: stats.count < 2 || stats.slopePerMin === null,
  };
}

/**
 * Percent change over the region as a percentage of the region MEAN:
 * `100 · netDelta / |mean|`. The mean (`stats.mean`) is the compute layer's
 * recommended percent-change base — it uses all n samples and is insensitive to
 * where the noisy endpoints land (see {@link TrendRegionStats.mean}). Returns `null`
 * (→ dash) when `netDelta` or `mean` is `null`/non-finite, or when `|mean|` is below
 * {@link TREND_BASE_EPSILON} (divide-by-near-zero guard).
 *
 * @param stats - The trend result for the lane.
 */
export function trendPercentChange(stats: Extract<RegionStats, { kind: 'trend' }>): number | null {
  const { netDelta, mean } = stats;
  if (netDelta === null || !Number.isFinite(netDelta)) return null;
  if (mean === null || !Number.isFinite(mean) || Math.abs(mean) < TREND_BASE_EPSILON) return null;
  return (100 * netDelta) / Math.abs(mean);
}

/** Rising / falling / flat from the slope, "flat" when it rounds to 0 at display precision. */
export function trendDirection(stats: Extract<RegionStats, { kind: 'trend' }>): TrendDirection {
  const slope = stats.slopePerMin;
  if (slope === null || !Number.isFinite(slope)) return 'flat';
  // "Flat" when the slope rounds to zero at the slope display precision (decimals+1).
  const slopeDecimals = stats.decimals + 1;
  const rounded = Number(slope.toFixed(slopeDecimals));
  if (rounded === 0) return 'flat';
  return slope > 0 ? 'rising' : 'falling';
}

/**
 * Per-percentile row primitives for the Distribution chip (p5/p25/p50/p75/p95).
 * Each is a formatted value or the no-data dash; the unit is rendered once.
 */
export interface DistributionChipRows {
  readonly p5: string;
  readonly p25: string;
  readonly p50: string;
  readonly p75: string;
  readonly p95: string;
  readonly approximate: boolean;
  readonly unit: string;
  /** True when too few samples for percentiles (render "— no data"). */
  readonly empty: boolean;
}

/** Reduce a distribution RegionStats to formatted chip rows. */
export function distributionChipRows(
  stats: Extract<RegionStats, { kind: 'distribution' }>,
): DistributionChipRows {
  const d = stats.decimals;
  return {
    p5: formatStatValue(stats.p5, d),
    p25: formatStatValue(stats.p25, d),
    p50: formatStatValue(stats.p50, d),
    p75: formatStatValue(stats.p75, d),
    p95: formatStatValue(stats.p95, d),
    approximate: stats.approximate,
    unit: stats.unit,
    empty: stats.count < 2,
  };
}

/**
 * Per-row primitives for the Selection chip (sample rate / count / span). `rate` is
 * the formatted Hz string (already prefixed with `~` for an estimated wearable
 * cadence, or the literal "— stepped" / "—" dash); `count` and `span` are
 * pre-formatted. The host pairs each with its glyph + word.
 */
export interface SelectionChipRows {
  readonly rate: string;
  /** True when `rate` is a wearable mean cadence (host adds the cadence title). */
  readonly rateEstimated: boolean;
  readonly count: string;
  readonly span: string;
  /** True when no meaningful sample fell in the region (render "— no data"). */
  readonly empty: boolean;
}

/** Reduce a lane's Selection info to formatted chip rows. */
export function selectionChipRows(info: LaneSelectionInfo): SelectionChipRows {
  let rate: string;
  let rateEstimated = false;
  if (info.stepped) {
    rate = '— stepped';
  } else if (info.rateHz === null) {
    rate = '—';
  } else if (info.nominal) {
    // Nominal CPAP rate: integers read cleanly, fractional rates keep one decimal.
    rate = Number.isInteger(info.rateHz) ? `${info.rateHz}` : info.rateHz.toFixed(2);
  } else {
    rate = `~${info.rateHz.toFixed(2)}`;
    rateEstimated = true;
  }
  return {
    rate,
    rateEstimated,
    count: info.count.toLocaleString(),
    span: formatDuration(Math.round(info.spanMs / 1000)),
    empty: !info.stepped && info.count === 0,
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
  const { stats, laneName, unit, selection } = stat;
  const u = unit ? ` ${unit}` : '';
  // Selection mode is metadata-driven; surface it before the kind switch.
  if (selection) {
    if (selection.stepped) {
      return `${laneName}: stepped lane, span ${formatDuration(Math.round(selection.spanMs / 1000))}`;
    }
    const rows = selectionChipRows(selection);
    if (rows.empty) return `${laneName}: no data`;
    const rateWord =
      selection.rateHz === null
        ? 'sample rate not available'
        : selection.nominal
          ? `sample rate ${rows.rate} Hz`
          : `mean cadence ${rows.rate} Hz`;
    return `${laneName}: ${rateWord}, ${rows.count} samples, span ${rows.span}`;
  }
  switch (stats.kind) {
    case 'numeric': {
      if (stats.count === 0) return `${laneName}: no data`;
      const d = stats.decimals;
      const med = stats.medianIsApproximate ? '~' : '';
      return (
        `${laneName}: average ${formatStatValue(stats.mean, d)}${u}, ` +
        `median ${med}${formatStatValue(stats.median, d)}${u}, ` +
        `range ${formatStatValue(stats.min, d)} to ${formatStatValue(stats.max, d)}${u}`
      );
    }
    case 'spread': {
      if (stats.count === 0) return `${laneName}: no data`;
      const rows = spreadChipRows(stats);
      const cv = rows.cv === '—' ? 'undefined' : `${rows.cv}%`;
      return (
        `${laneName}: standard deviation ${rows.sd}${u}, ` +
        `coefficient of variation ${cv}, interquartile range ${rows.iqr}${u}`
      );
    }
    case 'trend': {
      if (stats.count < 2 || stats.slopePerMin === null) return `${laneName}: no data`;
      const rows = trendChipRows(stats);
      const r2 = rows.rSquared === null ? '' : `, R squared ${rows.rSquared}`;
      const pct = rows.percent === '—' ? '' : `, ${rows.percent}% change`;
      return (
        `${laneName}: slope ${rows.slope}${u} per minute, ` +
        `net change ${rows.net}${u}${pct}, ${rows.direction}${r2}`
      );
    }
    case 'distribution': {
      if (stats.count < 2) return `${laneName}: no data`;
      const rows = distributionChipRows(stats);
      return (
        `${laneName}: 5th percentile ${rows.p5}${u}, 25th ${rows.p25}${u}, ` +
        `median ${rows.p50}${u}, 75th ${rows.p75}${u}, 95th ${rows.p95}${u}`
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
