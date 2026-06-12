/**
 * Pure histogram-binning helpers for the Event Explorer views.
 *
 * @module views/Explore/EventExplorer/histogram
 */

import type { Event, EventType } from '@/types/events';

/** A single histogram bin. */
export interface HistogramBin {
  /** Inclusive lower edge of the bin. */
  readonly start: number;
  /** Exclusive upper edge of the bin. */
  readonly end: number;
  /** Human-readable bin label, e.g. `"30–40s"`. */
  readonly label: string;
  /** Total count in this bin. */
  readonly count: number;
  /** Per-event-type counts (for stacked split-by-type rendering). */
  readonly byType: Readonly<Partial<Record<EventType, number>>>;
  /**
   * `true` when this bin aggregates everything at-or-above its lower edge —
   * the "≥ N" overflow bin emitted when the natural bin count would exceed
   * `maxBins`. Lets the UI render the bin distinctively and caption the
   * truncation honestly.
   */
  readonly overflow?: boolean;
}

/** Result of binning, including overflow accounting. */
export interface BinnedSeries<B extends { count: number }> {
  readonly bins: readonly B[];
  /**
   * Number of *values* aggregated into the final overflow bin (i.e. the
   * count that would otherwise have been silently truncated). `0` when there
   * is no overflow bin.
   */
  readonly overflowCount: number;
  /**
   * Inclusive lower edge of the overflow bin (the threshold above which
   * values were aggregated), or `null` when there is no overflow bin.
   */
  readonly overflowThreshold: number | null;
}

/** Default cap on how many bins a histogram emits before collapsing into an overflow bin. */
export const DEFAULT_MAX_BINS = 60;

/**
 * Bin a numeric value selector over events into fixed-width bins.
 *
 * Bins are aligned to multiples of `binWidth` starting at 0. Empty interior
 * bins are retained so the x-axis is continuous. Values that are `null` or
 * non-finite are skipped.
 *
 * Outliers no longer explode the chart: when more than `maxBins` bins would
 * otherwise be needed, the bins beyond `maxBins - 1` are aggregated into a
 * single overflow bin labeled `"≥ N <unit> (X omitted)"`, flagged via
 * {@link HistogramBin.overflow}, and reported in {@link BinnedSeries.overflowCount}.
 *
 * @param events - Events to bin.
 * @param binWidth - Bin width in the value's units (must be > 0).
 * @param select - Extracts the numeric value (e.g. `e => e.duration`).
 * @param unitSuffix - Suffix appended to bin labels (e.g. `'s'`).
 * @param maxBins - Maximum bins to emit (including the overflow bin). Defaults to {@link DEFAULT_MAX_BINS}.
 */
export function binEvents(
  events: readonly Event[],
  binWidth: number,
  select: (e: Event) => number | null,
  unitSuffix = 's',
  maxBins: number = DEFAULT_MAX_BINS,
): BinnedSeries<HistogramBin> {
  if (binWidth <= 0 || events.length === 0 || maxBins <= 0) {
    return { bins: [], overflowCount: 0, overflowThreshold: null };
  }

  // First pass: find max bin index and accumulate counts.
  const totals = new Map<number, number>();
  const typed = new Map<number, Map<EventType, number>>();
  let maxIndex = 0;

  for (const e of events) {
    const v = select(e);
    if (v === null || !Number.isFinite(v) || v < 0) continue;
    const idx = Math.floor(v / binWidth);
    if (idx > maxIndex) maxIndex = idx;
    totals.set(idx, (totals.get(idx) ?? 0) + 1);
    let typeMap = typed.get(idx);
    if (!typeMap) {
      typeMap = new Map();
      typed.set(idx, typeMap);
    }
    typeMap.set(e.type, (typeMap.get(e.type) ?? 0) + 1);
  }

  if (totals.size === 0) return { bins: [], overflowCount: 0, overflowThreshold: null };

  // Number of natural bins (0..maxIndex inclusive).
  const naturalBinCount = maxIndex + 1;
  const needsOverflow = naturalBinCount > maxBins;
  // When we overflow, reserve the LAST emitted bin for the aggregated overflow.
  const lastNormalIndex = needsOverflow ? maxBins - 2 : maxIndex;
  const overflowThreshold = needsOverflow ? (lastNormalIndex + 1) * binWidth : null;

  const bins: HistogramBin[] = [];
  for (let idx = 0; idx <= lastNormalIndex; idx++) {
    const start = idx * binWidth;
    const end = start + binWidth;
    const typeMap = typed.get(idx);
    const byType: Partial<Record<EventType, number>> = {};
    if (typeMap) {
      for (const [type, count] of typeMap) byType[type] = count;
    }
    bins.push({
      start,
      end,
      label: `${formatEdge(start)}–${formatEdge(end)}${unitSuffix}`,
      count: totals.get(idx) ?? 0,
      byType,
    });
  }

  let overflowCount = 0;
  if (needsOverflow && overflowThreshold !== null) {
    const aggByType = new Map<EventType, number>();
    for (let idx = lastNormalIndex + 1; idx <= maxIndex; idx++) {
      overflowCount += totals.get(idx) ?? 0;
      const typeMap = typed.get(idx);
      if (typeMap) {
        for (const [type, count] of typeMap) {
          aggByType.set(type, (aggByType.get(type) ?? 0) + count);
        }
      }
    }
    const byType: Partial<Record<EventType, number>> = {};
    for (const [type, count] of aggByType) byType[type] = count;
    bins.push({
      start: overflowThreshold,
      end: (maxIndex + 1) * binWidth,
      label: `≥${formatEdge(overflowThreshold)}${unitSuffix} (${overflowCount.toLocaleString()} omitted)`,
      count: overflowCount,
      byType,
      overflow: true,
    });
  }

  return { bins, overflowCount, overflowThreshold };
}

/** A single value-histogram bin (no per-type breakdown). */
export interface ValueBin {
  readonly start: number;
  readonly label: string;
  readonly count: number;
  readonly overflow?: boolean;
}

/**
 * Bin a raw numeric array (e.g. inter-event intervals) into fixed-width bins.
 *
 * When the natural bin count would exceed `maxBins`, values beyond
 * `(maxBins - 1) * binWidth` are aggregated into a single overflow bin
 * labeled `"≥ N <unit> (X omitted)"` and reported via
 * {@link BinnedSeries.overflowCount}. This prevents silent truncation of
 * long-tailed distributions.
 */
export function binValues(
  values: readonly number[],
  binWidth: number,
  maxBins = 40,
  unitSuffix = 's',
): BinnedSeries<ValueBin> {
  if (binWidth <= 0 || values.length === 0 || maxBins <= 0) {
    return { bins: [], overflowCount: 0, overflowThreshold: null };
  }
  const buckets = new Map<number, number>();
  for (const v of values) {
    if (!Number.isFinite(v) || v < 0) continue;
    const idx = Math.floor(v / binWidth);
    buckets.set(idx, (buckets.get(idx) ?? 0) + 1);
  }
  if (buckets.size === 0) {
    return { bins: [], overflowCount: 0, overflowThreshold: null };
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const needsOverflow = sorted.length > maxBins;
  // Reserve the LAST emitted bin for the aggregated overflow when overflowing.
  const keepCount = needsOverflow ? maxBins - 1 : sorted.length;
  const kept = sorted.slice(0, keepCount);
  const overflowEntries = sorted.slice(keepCount);
  let overflowCount = 0;
  let overflowThreshold: number | null = null;
  if (overflowEntries.length > 0) {
    overflowThreshold = (overflowEntries[0]?.[0] ?? 0) * binWidth;
    for (const [, c] of overflowEntries) overflowCount += c;
  }

  const bins: ValueBin[] = kept.map(([idx, count]) => {
    const start = idx * binWidth;
    return {
      label: `${formatEdge(start)}–${formatEdge(start + binWidth)}${unitSuffix}`,
      count,
      start,
    };
  });
  if (overflowThreshold !== null) {
    bins.push({
      start: overflowThreshold,
      label: `≥${formatEdge(overflowThreshold)}${unitSuffix} (${overflowCount.toLocaleString()} omitted)`,
      count: overflowCount,
      overflow: true,
    });
  }
  return { bins, overflowCount, overflowThreshold };
}

function formatEdge(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
