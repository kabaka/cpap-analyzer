/**
 * Machine-configuration period detection and per-period outcome aggregation.
 *
 * Given a series of nightly aggregates ordered by date, this module groups
 * consecutive nights that share the same RELEVANT machine settings into
 * "config periods" — runs of nights where the device was configured the same
 * way. Each period gets summary statistics (AHI, central index, leak, usage)
 * that the Machine Configurations comparison view uses for side-by-side
 * comparisons.
 *
 * ## Relevant settings
 *
 * Periods are segmented by the same fields used by
 * {@link import('@/views/Trends/utils/detectSettingsChanges').settingsDiffer}:
 * configured min pressure, configured max pressure, and EPR level. These three
 * are persisted to {@link NightlyAggregate} directly (no fallback to
 * `session.machineSettings` required) and are the levers an APAP user is most
 * likely to compare across — they answer Val's "which max pressure gave the
 * lowest AHI?" question. Mode, ramp, and mask are intentionally left out of
 * the segmentation key — they vary far less often, the change is rarely the
 * one being studied, and keeping them as part of the comparison key would
 * fragment periods unnecessarily for users who change masks mid-treatment.
 * They can be added later behind a user toggle if needed.
 *
 * ## Sentinel / missing-data guards
 *
 * Two failure modes are explicitly partitioned off so they never silently
 * merge with a real configuration:
 *
 * 1. **Missing settings**: nights with `configuredMinPressure === null &&
 *    configuredMaxPressure === null && eprLevel === null` are placed in their
 *    own `kind: 'unknown'` period rather than merged with whatever real
 *    settings happened to be adjacent. Re-importing populates them.
 *
 * 2. **Sentinel rows**: nights whose max pressure is implausibly low (≤ 1
 *    cmH₂O) — the historical "#4 pseudo-config" no-data sentinel reported by
 *    the resmed-specialist — are also bucketed as `kind: 'sentinel'`. They
 *    are never aggregated into a real period's outcomes.
 *
 * @module views/Explore/Configurations/configPeriods
 */

import type { NightlyAggregate } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The settings tuple a period is grouped by. Mirrors
 * `SettingsChangeDetail` from `detectSettingsChanges` for consistency.
 */
export interface ConfigKey {
  readonly minPressure: number | null;
  readonly maxPressure: number | null;
  readonly eprLevel: number | null;
}

/** Univariate outcome summary statistics for a config period. */
export interface OutcomeSummary {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly iqr: number;
  readonly stdDev: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Per-period rollup of the outcomes the comparison view exposes. Each metric
 * is `null` when the period has zero nights with that metric.
 */
export interface ConfigPeriodOutcomes {
  readonly ahi: OutcomeSummary | null;
  readonly centralIndex: OutcomeSummary | null;
  readonly obstructiveIndex: OutcomeSummary | null;
  readonly leakMedian: OutcomeSummary | null;
  readonly leakP95: OutcomeSummary | null;
  readonly usageHours: OutcomeSummary | null;
}

/**
 * Kind of a {@link ConfigPeriod}.
 *
 * - `config`: A real run of nights with consistent recorded settings.
 * - `unknown`: A run of nights with no recorded settings (re-import needed).
 * - `sentinel`: A run of nights whose recorded settings look like a no-data
 *   sentinel (e.g. max pressure ≤ 1 cmH₂O). Never aggregated as a real
 *   configuration.
 */
export type ConfigPeriodKind = 'config' | 'unknown' | 'sentinel';

export interface ConfigPeriod {
  /**
   * Stable identifier of the form `cfg-<startDate>-<minP>-<maxP>-<epr>` for
   * `config` periods, or `unknown-<startDate>` / `sentinel-<startDate>` for
   * the two failure-mode kinds. Use this as a React key.
   */
  readonly id: string;
  readonly kind: ConfigPeriodKind;
  /** Settings tuple this period is grouped by. */
  readonly settings: ConfigKey;
  /** First night (YYYY-MM-DD) in this period. */
  readonly startDate: string;
  /** Last night (YYYY-MM-DD) in this period (inclusive). */
  readonly endDate: string;
  /** Number of nights in the period (= `aggregates.length`). */
  readonly nights: number;
  /**
   * The nightly aggregates that belong to this period, in date order. Kept
   * so the comparison view can plot per-night strips without re-segmenting.
   */
  readonly aggregates: readonly NightlyAggregate[];
  /** Outcome roll-up. `null` everywhere for `unknown` / `sentinel` periods. */
  readonly outcomes: ConfigPeriodOutcomes;
}

// ---------------------------------------------------------------------------
// Sentinel guards
// ---------------------------------------------------------------------------

/**
 * Threshold below which a recorded max pressure is treated as a no-data
 * sentinel. Real APAP/CPAP devices clamp max pressure to ≥ 4 cmH₂O; anything
 * at or below 1 is the well-known garbage row.
 */
const SENTINEL_MAX_PRESSURE_CEILING = 1;

function isMissingSettings(a: NightlyAggregate): boolean {
  return (
    a.configuredMinPressure === null && a.configuredMaxPressure === null && a.eprLevel === null
  );
}

function isSentinelSettings(a: NightlyAggregate): boolean {
  return (
    a.configuredMaxPressure !== null && a.configuredMaxPressure <= SENTINEL_MAX_PRESSURE_CEILING
  );
}

function classify(a: NightlyAggregate): ConfigPeriodKind {
  if (isMissingSettings(a)) return 'unknown';
  if (isSentinelSettings(a)) return 'sentinel';
  return 'config';
}

function keyOf(a: NightlyAggregate): ConfigKey {
  return {
    minPressure: a.configuredMinPressure,
    maxPressure: a.configuredMaxPressure,
    eprLevel: a.eprLevel,
  };
}

function sameKey(a: ConfigKey, b: ConfigKey): boolean {
  return (
    a.minPressure === b.minPressure && a.maxPressure === b.maxPressure && a.eprLevel === b.eprLevel
  );
}

// ---------------------------------------------------------------------------
// Outcome summary
// ---------------------------------------------------------------------------

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0] ?? Number.NaN;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loV = sorted[lo] ?? Number.NaN;
  const hiV = sorted[hi] ?? Number.NaN;
  if (lo === hi) return loV;
  return loV + (hiV - loV) * (idx - lo);
}

function summarize(values: readonly number[]): OutcomeSummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((acc, v) => acc + v, 0) / n;
  const median = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const p95 = quantile(sorted, 0.95);

  // Sample standard deviation (Bessel-corrected). For n = 1 fall back to 0
  // — no spread is observable from a single point.
  let stdDev = 0;
  if (n > 1) {
    const variance = sorted.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (n - 1);
    stdDev = Math.sqrt(variance);
  }

  return {
    n,
    mean,
    median,
    p95,
    iqr: q3 - q1,
    stdDev,
    min: sorted[0] ?? Number.NaN,
    max: sorted[n - 1] ?? Number.NaN,
  };
}

function rollUp(aggregates: readonly NightlyAggregate[]): ConfigPeriodOutcomes {
  return {
    ahi: summarize(aggregates.map((a) => a.ahi)),
    centralIndex: summarize(aggregates.map((a) => a.ahiCentral)),
    obstructiveIndex: summarize(aggregates.map((a) => a.ahiObstructive)),
    leakMedian: summarize(aggregates.map((a) => a.leakMedian)),
    leakP95: summarize(aggregates.map((a) => a.leakP95)),
    usageHours: summarize(aggregates.map((a) => a.usageHours)),
  };
}

function emptyOutcomes(): ConfigPeriodOutcomes {
  return {
    ahi: null,
    centralIndex: null,
    obstructiveIndex: null,
    leakMedian: null,
    leakP95: null,
    usageHours: null,
  };
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

function periodId(kind: ConfigPeriodKind, startDate: string, settings: ConfigKey): string {
  if (kind === 'config') {
    return `cfg-${startDate}-${settings.minPressure ?? 'x'}-${settings.maxPressure ?? 'x'}-${
      settings.eprLevel ?? 'x'
    }`;
  }
  return `${kind}-${startDate}`;
}

/**
 * Segment a date-ordered nightly aggregate series into config periods.
 *
 * Runs of consecutive nights with the same {@link ConfigKey} form a single
 * period. Nights with all-null settings (`unknown`) or sentinel settings
 * (`sentinel`) are partitioned into their own periods of the matching kind
 * — never merged with a real configuration. Outcomes are aggregated only for
 * `config` periods.
 *
 * Input does not need to be sorted; this function sorts a copy by date
 * ascending. Soft-deleted nights are not filtered — caller is expected to
 * pass already-filtered data.
 */
export function buildConfigPeriods(
  aggregates: readonly NightlyAggregate[],
): readonly ConfigPeriod[] {
  if (aggregates.length === 0) return [];

  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
  const periods: ConfigPeriod[] = [];

  let bucket: NightlyAggregate[] = [];
  let bucketKind: ConfigPeriodKind | null = null;
  let bucketKey: ConfigKey | null = null;

  const flush = (): void => {
    if (bucket.length === 0 || bucketKind === null || bucketKey === null) return;
    const start = bucket[0]?.date ?? '';
    const end = bucket[bucket.length - 1]?.date ?? '';
    const outcomes = bucketKind === 'config' ? rollUp(bucket) : emptyOutcomes();
    periods.push({
      id: periodId(bucketKind, start, bucketKey),
      kind: bucketKind,
      settings: bucketKey,
      startDate: start,
      endDate: end,
      nights: bucket.length,
      aggregates: bucket,
      outcomes,
    });
    bucket = [];
    bucketKind = null;
    bucketKey = null;
  };

  for (const agg of sorted) {
    const kind = classify(agg);
    const key = keyOf(agg);

    const shouldExtend = bucketKind === kind && bucketKey !== null && sameKey(bucketKey, key);

    if (!shouldExtend) {
      flush();
      bucketKind = kind;
      bucketKey = key;
    }
    bucket.push(agg);
  }
  flush();

  return periods;
}

// ---------------------------------------------------------------------------
// Settings formatting
// ---------------------------------------------------------------------------

/** Format a settings tuple as a short human-readable string. */
export function formatConfigKey(key: ConfigKey): string {
  const parts: string[] = [];
  if (key.minPressure !== null && key.maxPressure !== null) {
    parts.push(`${key.minPressure.toFixed(1)}–${key.maxPressure.toFixed(1)} cmH₂O`);
  } else if (key.maxPressure !== null) {
    parts.push(`max ${key.maxPressure.toFixed(1)} cmH₂O`);
  } else if (key.minPressure !== null) {
    parts.push(`min ${key.minPressure.toFixed(1)} cmH₂O`);
  }
  if (key.eprLevel !== null) {
    parts.push(`EPR ${key.eprLevel}`);
  }
  if (parts.length === 0) return 'No settings recorded';
  return parts.join(' · ');
}
