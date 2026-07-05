/**
 * Pure selector / metric functions for the "Signal Deck" home dashboard.
 *
 * Every function here is **pure and deterministic**: given the same
 * {@link NightlyAggregate} inputs it returns the same output, performs no I/O,
 * and mutates nothing. The dashboard UI consumes these directly so that no
 * clinical threshold or statistic is ever re-implemented (or, worse, subtly
 * re-derived) in a React component.
 *
 * ## Design rules honoured here
 * - **No re-hardcoded thresholds.** AHI bands, compliance hours, the leak
 *   notice level, and the rate-validity floor all come from their canonical
 *   modules ({@link classifyAhiSeverity}, {@link CMS_COMPLIANCE_HOURS},
 *   {@link LEAK_NOTICE_LPM}, {@link MIN_INDEX_USAGE_HOURS}).
 * - **No re-implemented statistics.** Pooled per-hour rates go through
 *   {@link pooledRate}; percentiles go through {@link percentile} (Type-7).
 * - **`null` is a gap, never a zero.** Per-hour indices on a
 *   {@link NightlyAggregate} are `number | null`, where `null` means the
 *   recording was below the rate-validity floor so the rate is *undefined*.
 *   These are skipped in every mean / median / pooling operation and are
 *   never coerced to `0`.
 *
 * ## Non-diagnostic
 * Nothing in this module diagnoses. The {@link goodNightRate} metric counts the
 * fraction of nights that clear two established clinical gates (residual AHI and
 * CMS usage); its qualitative label/colour bands are an explicitly heuristic
 * presentation layer (see its JSDoc). The UI must present the label as a rough
 * summary, not a medical assessment.
 *
 * @module views/Dashboard/signalDeck/metrics
 */

import type { AhiSeverity } from '@/analysis/clinical';
import { classifyAhiSeverity } from '@/analysis/clinical';
import { AHI_SEVERITY_THRESHOLDS, CMS_COMPLIANCE_HOURS } from '@/analysis/clinical';
import { pooledRate } from '@/analysis/uncertainty/rateIndex';
import { percentile } from '@/analysis/descriptive';
import type { NightlyAggregate } from '@/types';

// ---------------------------------------------------------------------------
// Small internal numeric helpers
// ---------------------------------------------------------------------------

/** Round to the nearest integer (half-up), matching the dashboard's display. */
function roundScore(x: number): number {
  return Math.round(x);
}

// ---------------------------------------------------------------------------
// 5. seriesMean — canonical null-skipping mean
// ---------------------------------------------------------------------------

/**
 * Arithmetic mean of a series, **skipping `null` gaps**.
 *
 * The dashboard's wearable / physiological lanes store their nightly series as
 * `(number | null)[]`, where `null` is a missing sample (no data that night),
 * NOT a zero. This is the single helper the UI uses to average such a series so
 * it never re-implements "sum over the non-null values / count of them".
 *
 * @param values - Series that may contain `null` gaps.
 * @returns The mean of the finite, non-null entries, or `null` when there are
 *   none (every entry is `null` or the array is empty). Never returns `0` for an
 *   all-gap series.
 */
export function seriesMean(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    sum += v;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

// ---------------------------------------------------------------------------
// 1. Good-night rate — grounded two-gate therapy summary
// ---------------------------------------------------------------------------

/**
 * Residual-AHI ceiling (events/hour, **exclusive**) for the "effective" gate of
 * a good night.
 *
 * Sourced from the canonical AHI bands — `AHI_SEVERITY_THRESHOLDS.mild` (= 5) is
 * the AASM boundary between the *normal* and *mild* residual-AHI bands. A night
 * is "effective" only when its AHI is **strictly below** this value, i.e. it
 * sits in the normal band. Not hardcoded; re-derived from the clinical module so
 * the definition tracks the canonical thresholds.
 */
export const GOOD_NIGHT_AHI_MAX: number = AHI_SEVERITY_THRESHOLDS.mild;

/**
 * Minimum on-therapy hours (**inclusive**) for the "adherent" gate of a good
 * night.
 *
 * Sourced from {@link CMS_COMPLIANCE_HOURS} (= 4 h) — the U.S. CMS per-night
 * usage floor for adherence. A night is "adherent" when `usageHours` is at or
 * above this value. Not hardcoded.
 */
export const GOOD_NIGHT_MIN_HOURS: number = CMS_COMPLIANCE_HOURS;

/**
 * Qualitative presentation band for a {@link goodNightRate} percentage.
 *
 * These labels (and their colour severities) are a **heuristic presentation
 * layer**, not a clinical instrument — see {@link classifyGoodNightRate}.
 */
export type GoodNightRateLabel = 'Excellent' | 'Good' | 'Fair' | 'Low';

/** Result of {@link goodNightRate}. */
export interface GoodNightRateResult {
  /**
   * Percentage of recorded nights that pass **both** gates (effective AND
   * adherent), rounded to an integer for display, or `null` when
   * `assessedNights === 0`. This is the grounded metric.
   */
  readonly rate: number | null;
  /** Count of nights passing both gates. */
  readonly goodNights: number;
  /**
   * Denominator: every recorded night in the window (`nights.length`). A short
   * or aborted night is a legitimately not-good therapy night and counts as a
   * failure, so it stays in the denominator rather than being dropped.
   */
  readonly assessedNights: number;
  /**
   * Percentage of recorded nights passing **gate 1 alone**
   * (`ahi != null && ahi < GOOD_NIGHT_AHI_MAX`), rounded for display, or `null`
   * when `assessedNights === 0`.
   */
  readonly effectiveRate: number | null;
  /**
   * Percentage of recorded nights passing **gate 2 alone**
   * (`usageHours >= GOOD_NIGHT_MIN_HOURS`), rounded for display, or `null` when
   * `assessedNights === 0`.
   */
  readonly adherentRate: number | null;
  /** Qualitative band for {@link rate}, or `null` when there is no data. */
  readonly label: GoodNightRateLabel | null;
  /**
   * Severity token the UI maps to the band colour, or `null` when there is no
   * data. This is the band's colour mapping only — it is **not** a clinical AHI
   * severity for the window.
   */
  readonly severityForLabel: AhiSeverity | null;
}

/**
 * Map a good-night-rate percentage to its qualitative presentation band.
 *
 * ## Heuristic presentation bands only
 * The cut points here drive **only** the qualitative label and its colour; the
 * good-night rate itself (a fraction of nights clearing two established clinical
 * gates) is the grounded metric. The `70` cut loosely mirrors the CMS
 * "≥ 70 % of nights" adherence convention, but the labels are a UX affordance,
 * not a clinical classification.
 *
 * Bands: `≥ 85` → `'Excellent'`, `≥ 70` → `'Good'`, `≥ 50` → `'Fair'`,
 * otherwise `'Low'`. Pure and deterministic.
 *
 * @param rate - Good-night-rate percentage (any real number; typically 0–100).
 * @returns The band label.
 */
export function classifyGoodNightRate(rate: number): GoodNightRateLabel {
  if (rate >= 85) return 'Excellent';
  if (rate >= 70) return 'Good';
  if (rate >= 50) return 'Fair';
  return 'Low';
}

/** Band → colour-severity mapping for {@link GoodNightRateResult.severityForLabel}. */
function severityForGoodNightLabel(label: GoodNightRateLabel): AhiSeverity {
  switch (label) {
    case 'Excellent':
      return 'normal';
    case 'Good':
      return 'mild';
    case 'Fair':
      return 'moderate';
    case 'Low':
      return 'severe';
  }
}

/** No-data sentinel returned by {@link goodNightRate} for zero recorded nights. */
const GOOD_NIGHT_RATE_EMPTY: GoodNightRateResult = {
  rate: null,
  goodNights: 0,
  assessedNights: 0,
  effectiveRate: null,
  adherentRate: null,
  label: null,
  severityForLabel: null,
};

/**
 * Compute the **good-night rate** — the fraction of recorded nights that were
 * both clinically effective and adherent, over a window of nights.
 *
 * ## Definition of a "good night" (two gates, both required)
 * - **Effective** — `ahi != null && ahi < GOOD_NIGHT_AHI_MAX` (AHI in the normal
 *   band, `< 5`). A `null` AHI means the recording fell below the rate-validity
 *   floor, so residual control *cannot be confirmed*; such a night is treated as
 *   **not** effective, never as a pass.
 * - **Adherent** — `usageHours >= GOOD_NIGHT_MIN_HOURS` (`≥ 4 h`, the CMS floor).
 *
 * A night is "good" only when it clears **both** gates.
 *
 * ## Denominator — all recorded nights
 * The denominator is every recorded night in the window (`nights.length`), not
 * just the effective or the adherent ones. A short or aborted night (including a
 * null-AHI night) is a legitimately not-good therapy night and counts as a
 * failure. This keeps the metric honest: skipping weak nights would inflate it.
 *
 * ## Grounded metric vs. heuristic label
 * {@link GoodNightRateResult.rate} is the grounded, non-diagnostic count. The
 * accompanying {@link GoodNightRateResult.label} / `severityForLabel` are a
 * heuristic presentation layer (see {@link classifyGoodNightRate}); the UI must
 * present the label as a rough summary, not a medical assessment.
 *
 * ## Component rates
 * {@link GoodNightRateResult.effectiveRate} and `adherentRate` report each gate
 * in isolation (over the same all-nights denominator), so the UI can show *why*
 * the combined rate is what it is. They can each exceed `rate`, since a night
 * may pass one gate but not the other.
 *
 * ## No-data result
 * With zero recorded nights the function returns a well-defined sentinel:
 * `rate null`, `goodNights 0`, `assessedNights 0`, `effectiveRate null`,
 * `adherentRate null`, `label null`, `severityForLabel null`.
 *
 * @param nights - The window of nightly aggregates to summarise (not mutated).
 * @returns The good-night rate, its component rates, the counts, and the
 *   heuristic label/colour. Deterministic.
 */
export function goodNightRate(nights: readonly NightlyAggregate[]): GoodNightRateResult {
  const assessedNights = nights.length;
  if (assessedNights === 0) return GOOD_NIGHT_RATE_EMPTY;

  let goodNights = 0;
  let effectiveNights = 0;
  let adherentNights = 0;

  for (const n of nights) {
    const effective = n.ahi !== null && n.ahi < GOOD_NIGHT_AHI_MAX;
    const adherent = n.usageHours >= GOOD_NIGHT_MIN_HOURS;
    if (effective) effectiveNights += 1;
    if (adherent) adherentNights += 1;
    if (effective && adherent) goodNights += 1;
  }

  const rate = roundScore((goodNights / assessedNights) * 100);
  const effectiveRate = roundScore((effectiveNights / assessedNights) * 100);
  const adherentRate = roundScore((adherentNights / assessedNights) * 100);
  const label = classifyGoodNightRate(rate);

  return {
    rate,
    goodNights,
    assessedNights,
    effectiveRate,
    adherentRate,
    label,
    severityForLabel: severityForGoodNightLabel(label),
  };
}

// ---------------------------------------------------------------------------
// 2. Monthly mean AHI (pooled per calendar month)
// ---------------------------------------------------------------------------

/** Deterministic, locale-independent short month names, indexed 0 = January. */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** One month's pooled AHI point for the dashboard trend. */
export interface MonthlyAhiPoint {
  /** Calendar month key, `YYYY-MM`. */
  readonly month: string;
  /** Short, locale-independent label, e.g. `Jan`. */
  readonly label: string;
  /**
   * Duration-weighted pooled AHI for the month, or `null` when the month has no
   * usable (non-null-AHI) night. Never `0` for a data-less month.
   */
  readonly meanAhi: number | null;
  /** Number of nights that contributed to the pooled AHI (non-null-AHI nights). */
  readonly nights: number;
  /** Clinical severity of {@link meanAhi}, or `null` when `meanAhi` is `null`. */
  readonly severity: AhiSeverity | null;
}

/**
 * Pooled mean AHI per calendar month over a trailing window.
 *
 * Nights are grouped by their calendar month (`date.slice(0, 7)` → `YYYY-MM`).
 * Within each month the AHI is combined with {@link pooledRate}
 * (duration-weighted `Σevents / Σhours`), which excludes nights whose `ahi` is
 * `null` (recording below the rate-validity floor). The trailing `monthsBack`
 * months **that contain at least one night** are returned oldest → newest.
 *
 * A month can appear with `meanAhi === null` (and `severity === null`,
 * `nights === 0`) when it has nights but none reached the rate-validity floor —
 * this is a genuine "recorded, but no defined AHI" gap, not a zero.
 *
 * @param aggregates - All nightly aggregates (any order; not mutated).
 * @param monthsBack - How many trailing data-bearing months to return
 *   (default 12). Values `≤ 0` yield an empty array.
 * @returns Monthly points oldest → newest.
 */
export function monthlyMeanAhi(
  aggregates: readonly NightlyAggregate[],
  monthsBack = 12,
): MonthlyAhiPoint[] {
  if (monthsBack <= 0) return [];

  // Group nights by YYYY-MM in a Map (insertion order is irrelevant; we sort).
  const byMonth = new Map<string, NightlyAggregate[]>();
  for (const night of aggregates) {
    const key = night.date.slice(0, 7);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(night);
    else byMonth.set(key, [night]);
  }

  const sortedMonths = Array.from(byMonth.keys()).sort();
  const trailing = sortedMonths.slice(-monthsBack);

  return trailing.map((month): MonthlyAhiPoint => {
    const nightsInMonth = byMonth.get(month) ?? [];
    const meanAhi = pooledRate(nightsInMonth.map((n) => ({ rate: n.ahi, hours: n.usageHours })));
    const contributingNights = nightsInMonth.reduce(
      (count, n) => (n.ahi !== null ? count + 1 : count),
      0,
    );
    const monthIndex = Number(month.slice(5, 7)) - 1;
    const label = SHORT_MONTHS[monthIndex] ?? month;
    return {
      month,
      label,
      meanAhi,
      nights: contributingNights,
      severity: meanAhi === null ? null : classifyAhiSeverity(meanAhi),
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Leak distribution (box-plot summary of nightly median leak)
// ---------------------------------------------------------------------------

/**
 * Box-plot summary of the distribution of **nightly median leak** values.
 *
 * Summarises one number per night (`leakMedian`, always a defined number) — so
 * this is the spread of typical nightly leak, not of instantaneous leak within
 * a night. Whiskers use the 2nd / 98th percentiles (a robust near-extreme range
 * that trims lone outlier nights) rather than the raw min/max, which are
 * reported separately. All quantiles use the Type-7 {@link percentile}.
 */
export interface LeakDistribution {
  /** 25th percentile (lower quartile), or `null` when `n === 0`. */
  readonly p25: number | null;
  /** 50th percentile (median), or `null` when `n === 0`. */
  readonly p50: number | null;
  /** 75th percentile (upper quartile), or `null` when `n === 0`. */
  readonly p75: number | null;
  /** Minimum nightly median leak, or `null` when `n === 0`. */
  readonly min: number | null;
  /** Maximum nightly median leak, or `null` when `n === 0`. */
  readonly max: number | null;
  /** Lower whisker (2nd percentile), or `null` when `n === 0`. */
  readonly whiskerLow: number | null;
  /** Upper whisker (98th percentile), or `null` when `n === 0`. */
  readonly whiskerHigh: number | null;
  /** Number of nights summarised. */
  readonly n: number;
}

/** Empty {@link LeakDistribution} for a night-less window. */
const EMPTY_LEAK_DISTRIBUTION: LeakDistribution = {
  p25: null,
  p50: null,
  p75: null,
  min: null,
  max: null,
  whiskerLow: null,
  whiskerHigh: null,
  n: 0,
};

/**
 * Box-plot summary over per-night `leakMedian` values.
 *
 * @param aggregates - Nightly aggregates (not mutated). Non-finite leak values,
 *   if any, are ignored by {@link percentile}.
 * @returns Quartiles, min/max, 2nd/98th-percentile whiskers, and `n`. All
 *   quantile fields are `null` when there are no nights.
 */
export function leakDistribution(aggregates: readonly NightlyAggregate[]): LeakDistribution {
  const values = aggregates.map((a) => a.leakMedian).filter((v) => Number.isFinite(v));
  const n = values.length;
  if (n === 0) return EMPTY_LEAK_DISTRIBUTION;

  return {
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    min: Math.min(...values),
    max: Math.max(...values),
    whiskerLow: percentile(values, 2),
    whiskerHigh: percentile(values, 98),
    n,
  };
}

// ---------------------------------------------------------------------------
// 4. AHI histogram (binned nightly AHI)
// ---------------------------------------------------------------------------

/**
 * Default AHI histogram bin edges (events/hour), left-inclusive.
 *
 * `[0, 2, 4, 6, 8, 10, 12, 15, 20, ∞]` gives fine resolution across the
 * clinically interesting low range (normal / mild) where most controlled nights
 * sit, coarsening above 12 and using an open final bin `[20, ∞)` for severe
 * nights. `15` is an edge so the mild/moderate boundary is a bin edge.
 */
export const DEFAULT_AHI_HISTOGRAM_EDGES: readonly number[] = [
  0,
  2,
  4,
  6,
  8,
  10,
  12,
  15,
  20,
  Infinity,
];

/** One AHI histogram bin. */
export interface AhiHistogramBin {
  /** Inclusive lower edge (events/hour). */
  readonly lo: number;
  /** Exclusive upper edge (events/hour); `Infinity` for the open final bin. */
  readonly hi: number;
  /** Count of nights whose AHI falls in `[lo, hi)`. */
  readonly count: number;
  /**
   * Clinical severity of the bin, from its representative point via
   * {@link classifyAhiSeverity}: the midpoint for finite bins, or the lower edge
   * for the open final bin (whose midpoint would be `Infinity`).
   */
  readonly severity: AhiSeverity;
}

/** Result of {@link ahiHistogram}. */
export interface AhiHistogram {
  /** The bins, in ascending edge order. */
  readonly bins: AhiHistogramBin[];
  /** Median of the binned (non-null) AHI values, or `null` when none. */
  readonly median: number | null;
  /** Number of non-null AHI nights binned. */
  readonly n: number;
}

/**
 * Bin nightly AHI values into a histogram.
 *
 * Only nights with a **non-null** `ahi` are binned — nulls (recordings below the
 * rate-validity floor) are skipped, never counted as `0`. Each value `v` lands
 * in the bin `[edges[i], edges[i+1])` (left-inclusive); values at or above the
 * last finite edge fall into the open final bin.
 *
 * @param aggregates - Nightly aggregates (not mutated).
 * @param edges - Ascending bin edges; the last is typically `Infinity`. Defaults
 *   to {@link DEFAULT_AHI_HISTOGRAM_EDGES}. Must contain at least two edges.
 * @returns The bins, the median of the binned values, and the binned count `n`.
 */
export function ahiHistogram(
  aggregates: readonly NightlyAggregate[],
  edges: readonly number[] = DEFAULT_AHI_HISTOGRAM_EDGES,
): AhiHistogram {
  const values: number[] = [];
  for (const a of aggregates) {
    if (a.ahi !== null && Number.isFinite(a.ahi)) values.push(a.ahi);
  }
  const n = values.length;

  const bins: AhiHistogramBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i] as number;
    const hi = edges[i + 1] as number;
    // Representative point: midpoint for finite bins, lower edge for the open bin.
    const representative = Number.isFinite(hi) ? (lo + hi) / 2 : lo;
    bins.push({ lo, hi, count: 0, severity: classifyAhiSeverity(representative) });
  }

  // Assign each value to its bin. Mutating count in place on the local bins.
  const counts = new Array<number>(bins.length).fill(0);
  for (const v of values) {
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i] as AhiHistogramBin;
      if (v >= bin.lo && v < bin.hi) {
        counts[i] = (counts[i] as number) + 1;
        break;
      }
    }
  }
  const binsWithCounts = bins.map((b, i) => ({ ...b, count: counts[i] as number }));

  return {
    bins: binsWithCounts,
    median: n > 0 ? percentile(values, 50) : null,
    n,
  };
}
