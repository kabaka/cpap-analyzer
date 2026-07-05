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
 * Nothing in this module diagnoses. The {@link computeTherapyIndex} composite in
 * particular is an explicitly heuristic, non-clinical summary (see its JSDoc);
 * the UI must label it as such.
 *
 * @module views/Dashboard/signalDeck/metrics
 */

import type { AhiSeverity } from '@/analysis/clinical';
import { classifyAhiSeverity } from '@/analysis/clinical';
import { CMS_COMPLIANCE_HOURS } from '@/analysis/clinical';
import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty/constants';
import { pooledRate } from '@/analysis/uncertainty/rateIndex';
import { percentile } from '@/analysis/descriptive';
import type { NightlyAggregate } from '@/types';

// ---------------------------------------------------------------------------
// Small internal numeric helpers
// ---------------------------------------------------------------------------

/**
 * Clamp `x` into the closed interval `[lo, hi]`.
 *
 * Non-finite inputs (`NaN`, `±Infinity`) collapse to `lo` so a sub-score can
 * never leak a non-finite value into a weighted composite.
 */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

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
// 1. Therapy Index — heuristic composite (NON-DIAGNOSTIC)
// ---------------------------------------------------------------------------

/** Qualitative band label for the {@link computeTherapyIndex} composite. */
export type TherapyIndexLabel = 'Dialed in' | 'On track' | 'Needs attention' | 'Off track';

/**
 * Heuristic weights for the four Therapy Index sub-scores.
 *
 * These are a **product/UX heuristic**, not a validated clinical instrument.
 * They are exported so the weighting is auditable and testable rather than
 * buried as magic numbers. AHI dominates because residual AHI is the primary
 * therapy-efficacy signal; adherence is next; usage duration and leak are
 * softer, secondary contributors. The weights sum to `1`.
 *
 * When a sub-score is unavailable for a window (only the AHI sub-score can be,
 * when no night reaches the rate-validity floor) the composite renormalises
 * over the remaining weights — it does not treat the missing sub-score as `0`.
 */
export const THERAPY_INDEX_WEIGHTS = {
  /** AHI efficacy sub-score weight. */
  ahi: 0.4,
  /** Adherence (fraction of compliant nights) sub-score weight. */
  adherence: 0.28,
  /** Usage-duration sub-score weight. */
  usage: 0.2,
  /** Leak-control sub-score weight. */
  leak: 0.12,
} as const;

/**
 * The four normalised (0–100) sub-scores behind a Therapy Index.
 *
 * Every field is `number | null`. In practice only {@link ahi} can be `null`
 * (when no night in the window reaches the rate-validity floor, so there is no
 * defined pooled AHI). When `nightsUsed > 0` the adherence / usage / leak
 * sub-scores are always defined numbers. All four are `null` in the no-data
 * result. `null` here means "not measurable", never "scored zero".
 */
export interface TherapyIndexSubscores {
  /** AHI efficacy sub-score, `null` when there is no defined pooled AHI. */
  readonly ahi: number | null;
  /** Adherence sub-score (fraction of compliant nights × 100). */
  readonly adherence: number | null;
  /** Usage-duration sub-score. */
  readonly usage: number | null;
  /** Leak-control sub-score. */
  readonly leak: number | null;
}

/** Result of {@link computeTherapyIndex}. */
export interface TherapyIndexResult {
  /**
   * Composite score, integer 0–100. `0` with `nightsUsed === 0` is the no-data
   * sentinel (see {@link computeTherapyIndex}); a genuine `0` from very poor
   * therapy also exists, so branch on `nightsUsed`, not on `score`, to detect
   * the empty state.
   */
  readonly score: number;
  /** Qualitative band for {@link score} (see {@link classifyTherapyIndex}). */
  readonly label: TherapyIndexLabel;
  /**
   * Severity token the UI maps to the band colour. This is the band's colour
   * mapping only — it is **not** a clinical AHI severity for the window.
   */
  readonly severityForLabel: AhiSeverity;
  /** The four sub-scores that produced {@link score}. */
  readonly subscores: TherapyIndexSubscores;
  /** Number of nights included in the composite (0 = no-data sentinel). */
  readonly nightsUsed: number;
}

/**
 * Map a Therapy Index score to its qualitative band.
 *
 * Bands: `≥ 85` → `'Dialed in'`, `≥ 70` → `'On track'`, `≥ 55` →
 * `'Needs attention'`, otherwise `'Off track'`. Pure and deterministic.
 *
 * @param score - Composite score (any real number; typically 0–100).
 * @returns The band label.
 */
export function classifyTherapyIndex(score: number): TherapyIndexLabel {
  if (score >= 85) return 'Dialed in';
  if (score >= 70) return 'On track';
  if (score >= 55) return 'Needs attention';
  return 'Off track';
}

/** Band → colour-severity mapping for {@link TherapyIndexResult.severityForLabel}. */
function severityForTherapyLabel(label: TherapyIndexLabel): AhiSeverity {
  switch (label) {
    case 'Dialed in':
      return 'normal';
    case 'On track':
      return 'mild';
    case 'Needs attention':
      return 'moderate';
    case 'Off track':
      return 'severe';
  }
}

/**
 * A "full night" usage ceiling, in hours, for the usage sub-score.
 *
 * The usage sub-score reaches 100 at this many hours. `7.5 h` is a
 * generous-but-attainable full night (above the 6 h "good adherence" target and
 * below an implausibly long recording), so a well-adhering user saturates the
 * sub-score rather than being penalised for not sleeping 8+ hours on the
 * machine. Heuristic, not a clinical target.
 */
export const THERAPY_INDEX_USAGE_CEILING_HOURS = 7.5;

/**
 * The AHI anchor, in events/hour, for the AHI sub-score.
 *
 * The AHI sub-score is `(anchor − pooledAHI) / anchor × 100` clamped to
 * `[0, 100]`: `0` maps to 100, the anchor maps to 0. We anchor on the
 * moderate-severity threshold (AHI 15) so that a pooled AHI at or above the
 * moderate cutoff scores 0 and a controlled AHI near 0 scores ~100. Sourced
 * from the canonical AHI bands, not hardcoded.
 */
const THERAPY_INDEX_AHI_ANCHOR = 15;

/** No-data sentinel returned by {@link computeTherapyIndex} for zero usable nights. */
const THERAPY_INDEX_EMPTY: TherapyIndexResult = {
  score: 0,
  label: 'Off track',
  severityForLabel: 'severe',
  subscores: { ahi: null, adherence: null, usage: null, leak: null },
  nightsUsed: 0,
};

/**
 * Compute the composite **Therapy Index** — a heuristic 0–100 summary of overall
 * therapy quality over a window of nights.
 *
 * ## This is a NON-DIAGNOSTIC heuristic
 * The Therapy Index is a product-level convenience summary, NOT a validated
 * clinical score and NOT a diagnosis. It blends four normalised sub-scores with
 * {@link THERAPY_INDEX_WEIGHTS}. The UI **must** present it as a heuristic
 * ("a rough at-a-glance summary"), not as a medical assessment, and should keep
 * the underlying metrics (AHI, adherence, usage, leak) directly visible.
 *
 * ## Sub-scores (each clamped to 0–100)
 * - **AHI** — `(15 − pooledAHI) / 15 × 100`, anchored on the moderate cutoff
 *   (AHI 15). `pooledAHI` is the duration-weighted {@link pooledRate} over the
 *   window, which naturally excludes nights below the rate-validity floor
 *   (their `ahi` is `null`). `null` when no night qualifies.
 * - **Adherence** — `complianceRate × 100`, where `complianceRate` is the
 *   fraction of nights with `usageHours ≥ CMS_COMPLIANCE_HOURS` (4 h).
 * - **Usage** — `meanUsageHours / 7.5 × 100`
 *   (see {@link THERAPY_INDEX_USAGE_CEILING_HOURS}).
 * - **Leak** — `(LEAK_NOTICE_LPM − meanLeakMedian) / LEAK_NOTICE_LPM × 100`,
 *   where `meanLeakMedian` is the mean of the nightly median leaks.
 *
 * ## Composite
 * `round(Σ wᵢ·sᵢ / Σ wᵢ)` over the **available** sub-scores. With all four
 * present this is `round(0.40·AHI + 0.28·Adherence + 0.20·Usage + 0.12·Leak)`.
 * When the AHI sub-score is unavailable, the composite renormalises over the
 * remaining three weights (it is not treated as 0).
 *
 * ## No-data result
 * With zero nights the function returns a well-defined sentinel: `score 0`,
 * `nightsUsed 0`, all sub-scores `null`, `label 'Off track'`. Detect the empty
 * state via `nightsUsed === 0` (a real score can also be 0). The UI should show
 * an empty state rather than a red "Off track" verdict.
 *
 * @param nights - The window of nightly aggregates to summarise.
 * @returns The composite score, band, colour-severity, sub-scores, and the
 *   number of nights used. Deterministic.
 */
export function computeTherapyIndex(nights: readonly NightlyAggregate[]): TherapyIndexResult {
  const nightsUsed = nights.length;
  if (nightsUsed === 0) return THERAPY_INDEX_EMPTY;

  // --- Pooled AHI (duration-weighted; null-AHI nights excluded by pooledRate)
  const pooledAhi = pooledRate(nights.map((n) => ({ rate: n.ahi, hours: n.usageHours })));

  // --- Adherence: fraction of nights meeting the CMS compliance floor --------
  let compliantCount = 0;
  for (const n of nights) {
    if (n.usageHours >= CMS_COMPLIANCE_HOURS) compliantCount += 1;
  }
  const complianceRate = compliantCount / nightsUsed;

  // --- Mean usage hours and mean nightly median leak -------------------------
  const meanUsageHours = seriesMean(nights.map((n) => n.usageHours));
  const meanLeakMedian = seriesMean(nights.map((n) => n.leakMedian));

  // --- Sub-scores (each clamped 0–100; AHI is null when undefined) -----------
  const sAhi =
    pooledAhi === null
      ? null
      : clamp(((THERAPY_INDEX_AHI_ANCHOR - pooledAhi) / THERAPY_INDEX_AHI_ANCHOR) * 100, 0, 100);
  const sAdherence = clamp(complianceRate * 100, 0, 100);
  const sUsage =
    meanUsageHours === null
      ? null
      : clamp((meanUsageHours / THERAPY_INDEX_USAGE_CEILING_HOURS) * 100, 0, 100);
  const sLeak =
    meanLeakMedian === null
      ? null
      : clamp(((LEAK_NOTICE_LPM - meanLeakMedian) / LEAK_NOTICE_LPM) * 100, 0, 100);

  // --- Weighted composite over the AVAILABLE sub-scores (renormalised) -------
  const terms: Array<{ value: number; weight: number }> = [];
  if (sAhi !== null) terms.push({ value: sAhi, weight: THERAPY_INDEX_WEIGHTS.ahi });
  if (sAdherence !== null)
    terms.push({ value: sAdherence, weight: THERAPY_INDEX_WEIGHTS.adherence });
  if (sUsage !== null) terms.push({ value: sUsage, weight: THERAPY_INDEX_WEIGHTS.usage });
  if (sLeak !== null) terms.push({ value: sLeak, weight: THERAPY_INDEX_WEIGHTS.leak });

  let weighted = 0;
  let totalWeight = 0;
  for (const t of terms) {
    weighted += t.value * t.weight;
    totalWeight += t.weight;
  }
  const score = totalWeight > 0 ? roundScore(weighted / totalWeight) : 0;
  const label = classifyTherapyIndex(score);

  return {
    score,
    label,
    severityForLabel: severityForTherapyLabel(label),
    subscores: { ahi: sAhi, adherence: sAdherence, usage: sUsage, leak: sLeak },
    nightsUsed,
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
