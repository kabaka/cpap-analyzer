/**
 * Pure helpers and constants for the Granger Causality section.
 *
 * Kept in a non-component module so they can be unit-tested in isolation and so
 * the section component file only exports React components (React Fast Refresh).
 *
 * @module views/Analysis/grangerHelpers
 */

import type { GrangerCausalityResult } from '@/analysis/correlation/granger';

// ---------------------------------------------------------------------------
// Metric catalogue
// ---------------------------------------------------------------------------

export interface MetricOption {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
}

/** Curated metrics offered in both the X and Y pickers. */
export const METRIC_OPTIONS: readonly MetricOption[] = [
  { id: 'ahi', label: 'AHI', unit: 'events/hr' },
  { id: 'ahiObstructive', label: 'Obstructive AHI', unit: 'events/hr' },
  { id: 'ahiCentral', label: 'Central AHI', unit: 'events/hr' },
  { id: 'rdi', label: 'RDI', unit: 'events/hr' },
  { id: 'pressureMedian', label: 'Median Pressure', unit: 'cmH₂O' },
  { id: 'pressureP95', label: '95th-pct Pressure', unit: 'cmH₂O' },
  { id: 'leakMedian', label: 'Median Leak', unit: 'L/min' },
  { id: 'leakP95', label: '95th-pct Leak', unit: 'L/min' },
  { id: 'usageHours', label: 'Usage', unit: 'hours' },
  { id: 'spo2Mean', label: 'Mean SpO₂', unit: '%' },
  { id: 'oxygenDesaturationIndex', label: 'ODI', unit: 'events/hr' },
  { id: 'eprLevel', label: 'EPR Level', unit: 'level' },
];

export const DEFAULT_X = 'leakMedian';
export const DEFAULT_Y = 'ahi';
export const MAX_LAG_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export const DEFAULT_MAX_LAG = 7;

export type InferenceMode = 'exploratory' | 'confirmatory';

export const CONFIDENCE_META: Record<
  GrangerCausalityResult['confidenceLevel'],
  { dots: string; label: string; className: 'confHigh' | 'confModerate' | 'confLow' }
> = {
  high: { dots: '●●●', label: 'High confidence', className: 'confHigh' },
  moderate: { dots: '●●○', label: 'Moderate confidence', className: 'confModerate' },
  low: { dots: '●○○', label: 'Low confidence', className: 'confLow' },
};

export const CONFIDENCE_TITLE =
  'Based on the more significant of the two directions (p < 0.01 high, < 0.05 moderate, otherwise low).';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Look up a metric option, falling back to a synthetic entry for unknowns. */
export function metricById(id: string): MetricOption {
  return METRIC_OPTIONS.find((m) => m.id === id) ?? { id, label: id, unit: '' };
}

/** Minimum paired nights required for a Granger test at a given max lag. */
export function minNightsForMaxLag(maxLag: number): number {
  return 2 * maxLag + 2;
}

/**
 * Largest max-lag value (from the offered set, min 2) whose data requirement
 * fits the available sample size, or `null` if even maxLag = 2 does not fit.
 */
export function largestFeasibleMaxLag(sampleSize: number): number | null {
  let best: number | null = null;
  for (const candidate of MAX_LAG_OPTIONS) {
    if (minNightsForMaxLag(candidate) <= sampleSize) best = candidate;
  }
  return best;
}

/** Build the verdict sentence from the directional classification + labels. */
export function verdictText(
  causality: GrangerCausalityResult['causality'],
  xLabel: string,
  yLabel: string,
): string {
  switch (causality) {
    case 'X causes Y':
      return `${xLabel} Granger-causes ${yLabel}`;
    case 'Y causes X':
      return `${yLabel} Granger-causes ${xLabel}`;
    case 'bidirectional':
      return `Bidirectional Granger causality between ${xLabel} and ${yLabel}`;
    case 'none':
    default:
      return 'No Granger causality detected';
  }
}

/** Format a p-value for display, or "—" for non-finite values. */
export function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(4);
}

/**
 * Rewrite the worker's generic "Series X / Series Y / Both series" stationarity
 * warning to use the real metric labels, then append the fixed advisory.
 */
export function rewriteStationarityWarning(
  warning: string,
  xLabel: string,
  yLabel: string,
): string {
  const rewritten = warning
    .replace('Both series', 'Both metrics')
    .replace('Series X', xLabel)
    .replace('Series Y', yLabel)
    .replace('first-differencing X', `first-differencing ${xLabel}`)
    .replace('first-differencing Y', `first-differencing ${yLabel}`);
  return `${rewritten} A shared trend in two unrelated series can manufacture spurious Granger causality. Consider first-differencing the affected metric(s) before interpreting this result.`;
}

/** A non-null `unavailableReason` from {@link GrangerCausalityResult}. */
export type UnavailableReason = Exclude<GrangerCausalityResult['unavailableReason'], null>;

/**
 * Heading + body copy for an unavailable Granger result, derived purely from the
 * result contract's `unavailableReason` discriminant — never from NaN/array-shape
 * heuristics.
 *
 * - `insufficient-data` reports the available finite-paired count (`nPaired`)
 *   against the requirement for the chosen `maxLag`, so the figure shown matches
 *   the verdict. Set `canReduceLag` to control whether the caller should offer a
 *   "Reduce max lag" affordance (the math for that lives in
 *   {@link largestFeasibleMaxLag}, fed `nPaired`).
 * - `constant-series` does NOT mention nights/sample size — the data is
 *   sufficient; a metric simply has no variation.
 * - `singular-fit` is a fit-failure message focused on the lag/period, distinct
 *   from the constant-series case.
 *
 * The heading string for `insufficient-data` is exactly
 * `"Not enough nights for this test"` — an e2e assertion matches this substring,
 * so do not alter it without updating tests.
 */
export function unavailableMessage(
  reason: UnavailableReason,
  args: { xLabel: string; yLabel: string; maxLag: number; nPaired: number },
): { heading: string; body: string } {
  const { xLabel, yLabel, maxLag, nPaired } = args;
  switch (reason) {
    case 'insufficient-data':
      return {
        heading: 'Not enough nights for this test',
        body: `Granger causality at a max lag of ${maxLag} needs at least ${minNightsForMaxLag(
          maxLag,
        )} nights of paired ${xLabel} and ${yLabel} data; ${nPaired} are available. Reduce the max lag or import more data.`,
      };
    case 'constant-series':
      return {
        heading: 'Test could not be computed',
        body: `One of the selected metrics (${xLabel} or ${yLabel}) is constant — it has no variation over this period. Granger causality requires both metrics to vary, so the test is undefined. Try a metric that changes over time or a different date range.`,
      };
    case 'singular-fit':
      return {
        heading: 'Test could not be computed',
        body: 'The model could not be fit at the tested lag over this period. Try a smaller max lag, a fixed lag, or a different date range.',
      };
  }
}

/** Dynamic interpretation clause keyed by directional classification. */
export function interpretationClause(
  causality: GrangerCausalityResult['causality'],
  xLabel: string,
  yLabel: string,
  optimalLag: number,
): string {
  switch (causality) {
    case 'X causes Y':
      return `Here, past ${xLabel} improves prediction of ${yLabel} at a ${optimalLag}-night lag, but not the reverse.`;
    case 'Y causes X':
      return `Here, past ${yLabel} improves prediction of ${xLabel}, but not the reverse.`;
    case 'bidirectional':
      return 'Here, each metric helps predict the other — consistent with feedback or a shared driver.';
    case 'none':
    default:
      return 'Here, neither metric’s history measurably improves prediction of the other at the tested lags.';
  }
}
