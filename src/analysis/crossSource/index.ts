/**
 * Cross-Source Statistical Analysis Module
 *
 * Correlates CPAP therapy data with wearable (Fitbit/Google Health) data.
 * All functions are pure, deterministic, and handle NaN/Infinity inputs
 * via pairwise deletion. This module is a higher-level wrapper around the
 * core correlation primitives in `@/analysis/correlation`.
 *
 * Methods:
 * - `computeCorrelation` — Pearson or Spearman with full inferential stats
 * - `computeBlandAltman` — Bland-Altman agreement analysis (bias, LoA, proportional bias)
 * - `computePartialCorrelationCrossSrc` — Partial correlation with named confounders
 * - `computeLaggedCrossCorrelation` — Cross-correlation with daily lags and interpretation
 * - `correlateDataSources` — High-level join + correlation matrix over CPAP x wearable metrics
 * - `extractWearableMetricSeries` — Helper to extract a single numeric metric from daily summaries
 *
 * @module analysis/crossSource
 */

import {
  pearsonCorrelation,
  spearmanCorrelation,
  partialCorrelation,
  crossCorrelation,
} from '@/analysis/correlation';
import type { CorrelationResult } from '@/analysis/correlation';
import { twoTailedPValue } from '@/analysis/math';
import type { IntegrationDailySummary } from '@/types/storage';
import type { FitbitDailyType } from '@/types/fitbit';
import { FITBIT_DATA_TYPE_LABEL } from '@/types/fitbit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossSourceCorrelationInput {
  /** CPAP metric values, one per date. */
  readonly x: number[];
  /** Wearable metric values, one per date, aligned with x. */
  readonly y: number[];
  /** ISO date labels (YYYY-MM-DD), aligned with x and y. */
  readonly dates: string[];
  /** Correlation method. */
  readonly method: 'pearson' | 'spearman';
}

export interface CrossSourceCorrelationResult {
  readonly r: number;
  readonly rSquared: number;
  readonly pValue: number;
  readonly n: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
  readonly strength: 'negligible' | 'weak' | 'moderate' | 'strong' | 'very strong';
  readonly direction: 'positive' | 'negative' | 'none';
  readonly method: 'pearson' | 'spearman';
}

export interface BlandAltmanInput {
  /** Measurement values from method 1. */
  readonly method1: number[];
  /** Measurement values from method 2. */
  readonly method2: number[];
  /** ISO date labels aligned with the measurements. */
  readonly dates: string[];
  /** Label for method 1 (e.g., "CPAP SpO2"). */
  readonly method1Label: string;
  /** Label for method 2 (e.g., "Fitbit SpO2"). */
  readonly method2Label: string;
}

export interface BlandAltmanResult {
  /** Mean of differences (bias). method1 - method2. */
  readonly meanDifference: number;
  /** Standard deviation of differences. */
  readonly sdDifference: number;
  /** Upper limit of agreement: meanDifference + 1.96 * SD. */
  readonly upperLimit: number;
  /** Lower limit of agreement: meanDifference - 1.96 * SD. */
  readonly lowerLimit: number;
  /** Number of valid paired observations. */
  readonly n: number;
  /** Regression of differences on means to detect proportional bias. */
  readonly proportionalBias: {
    readonly slope: number;
    readonly intercept: number;
    readonly pValue: number;
    /** True when p < 0.05 — indicates the magnitude of disagreement depends on the measured value. */
    readonly isSignificant: boolean;
  };
  /** Individual data points for plotting. */
  readonly points: ReadonlyArray<{
    readonly mean: number;
    readonly difference: number;
    readonly date: string;
  }>;
}

export interface PartialCorrelationInput {
  readonly x: number[];
  readonly y: number[];
  /** Named confounding variables to control for. */
  readonly controls: Record<string, number[]>;
  readonly dates: string[];
}

export interface PartialCorrelationCrossSrcResult {
  readonly r: number;
  readonly pValue: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
  readonly n: number;
  /** Names of the controlled-for variables. */
  readonly controlledFor: string[];
}

export interface LaggedCrossSourceCorrelationInput {
  /** Leading series (e.g., exercise metric). */
  readonly x: number[];
  /** Lagging series (e.g., AHI). */
  readonly y: number[];
  /** Maximum lag in days (default 7). */
  readonly maxLag?: number;
  readonly dates: string[];
}

export interface LaggedCrossSourceCorrelationResult {
  /** Lag values from -maxLag to +maxLag. */
  readonly lags: readonly number[];
  /** Cross-correlation function value at each lag. */
  readonly ccf: readonly number[];
  /** Significance bound: +/- 1.96 / sqrt(n). */
  readonly significanceBound: number;
  /** Lag with the largest |CCF| (restricted to lags with adequate overlap). */
  readonly bestLag: number;
  /** CCF value at the best lag. */
  readonly bestCCF: number;
  /** Human-readable interpretation of the result. */
  readonly interpretation: string;
}

/** A single day's CPAP therapy summary for cross-source analysis. */
export interface CpapDailyRecord {
  readonly date: string;
  readonly ahi: number;
  readonly pressureMean: number;
  readonly pressure95th: number;
  readonly leakMedian: number;
  readonly leak95th: number;
  readonly usageHours: number;
  readonly ahiObstructive: number;
  readonly ahiCentral: number;
  readonly respiratoryRateMedian?: number;
  readonly tidalVolumeMedian?: number;
  readonly minuteVentilationMedian?: number;
}

export interface CorrelateDataSourcesInput {
  readonly cpapData: readonly CpapDailyRecord[];
  readonly wearableData: Record<
    string,
    ReadonlyArray<{ readonly date: string; readonly value: number }>
  >;
  readonly method: 'pearson' | 'spearman';
}

export interface CrossSourceCorrelationMatrix {
  readonly cpapMetrics: string[];
  readonly wearableMetrics: string[];
  /** r values, indexed as matrix[cpapIdx][wearableIdx]. */
  readonly matrix: number[][];
  /** p-values, same indexing as matrix. */
  readonly pValues: number[][];
  /** Number of overlapping dates used for computation. */
  readonly n: number;
  /** Pairs that reached p < 0.05, sorted by |r| descending. */
  readonly significantPairs: ReadonlyArray<{
    readonly cpapMetric: string;
    readonly wearableMetric: string;
    readonly r: number;
    readonly pValue: number;
    readonly strength: string;
    readonly direction: string;
  }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pairwise-filter two arrays: keep only indices where both values are finite.
 * Also collects the corresponding date strings for the kept indices.
 */
function pairwiseFilterWithDates(
  a: readonly number[],
  b: readonly number[],
  dates: readonly string[],
): { aClean: number[]; bClean: number[]; datesClean: string[] } {
  const n = Math.min(a.length, b.length, dates.length);
  const aClean: number[] = [];
  const bClean: number[] = [];
  const datesClean: string[] = [];
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai !== undefined && bi !== undefined && Number.isFinite(ai) && Number.isFinite(bi)) {
      aClean.push(ai);
      bClean.push(bi);
      const d = dates[i];
      datesClean.push(d !== undefined ? d : '');
    }
  }
  return { aClean, bClean, datesClean };
}

/**
 * Simple linear regression y = intercept + slope * x via ordinary least squares.
 * Returns slope, intercept, and t-statistic for slope significance.
 * Assumes inputs are already pairwise-filtered (no NaN/Infinity).
 */
function simpleLinearRegression(
  x: readonly number[],
  y: readonly number[],
): { slope: number; intercept: number; tStatistic: number; df: number } {
  const n = x.length;
  if (n < 3) {
    return { slope: NaN, intercept: NaN, tStatistic: NaN, df: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i] as number;
    sumY += y[i] as number;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - meanX;
    sxx += dx * dx;
    sxy += dx * ((y[i] as number) - meanY);
  }

  if (sxx === 0) {
    return { slope: NaN, intercept: NaN, tStatistic: NaN, df: 0 };
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  // Residual sum of squares
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * (x[i] as number);
    const residual = (y[i] as number) - predicted;
    rss += residual * residual;
  }

  const df = n - 2;
  const mse = rss / df;
  const seSlope = Math.sqrt(mse / sxx);

  const tStatistic = seSlope > 0 ? slope / seSlope : slope === 0 ? 0 : Infinity;

  return { slope, intercept, tStatistic, df };
}

/** Arithmetic mean. Returns NaN for empty arrays. */
function mean(data: readonly number[]): number {
  if (data.length === 0) return NaN;
  let sum = 0;
  for (const v of data) sum += v;
  return sum / data.length;
}

/** Population standard deviation. Returns NaN for empty arrays. */
function sd(data: readonly number[]): number {
  const n = data.length;
  if (n < 2) return NaN;
  const m = mean(data);
  let sumSq = 0;
  for (const v of data) {
    const d = v - m;
    sumSq += d * d;
  }
  // Sample standard deviation (Bessel's correction)
  return Math.sqrt(sumSq / (n - 1));
}

// ---------------------------------------------------------------------------
// 1. computeCorrelation
// ---------------------------------------------------------------------------

/**
 * Compute Pearson or Spearman correlation between two aligned metric series
 * from different data sources (CPAP vs wearable).
 *
 * This is a thin wrapper around the core correlation functions that accepts
 * the cross-source input format and enriches the result with the method label.
 *
 * Assumptions:
 * - x and y are aligned by date (same index = same day)
 * - Pairwise deletion is applied for NaN/Infinity values
 * - Minimum 3 valid pairs required for a meaningful result
 *
 * @param input Cross-source correlation input
 * @returns Full correlation result including CI, strength, and method
 */
export function computeCorrelation(
  input: CrossSourceCorrelationInput,
): CrossSourceCorrelationResult {
  const { x, y, method } = input;

  const corrFn = method === 'spearman' ? spearmanCorrelation : pearsonCorrelation;
  const result: CorrelationResult = corrFn([...x], [...y]);

  return {
    r: result.r,
    rSquared: result.rSquared,
    pValue: result.pValue,
    n: result.n,
    ci95Lower: result.ci95Lower,
    ci95Upper: result.ci95Upper,
    strength: result.strength,
    direction: result.direction,
    method,
  };
}

// ---------------------------------------------------------------------------
// 2. computeBlandAltman
// ---------------------------------------------------------------------------

/**
 * Bland-Altman agreement analysis for comparing two measurement methods.
 *
 * Use this when two sources measure the same physiological quantity
 * (e.g., CPAP-reported respiratory rate vs Fitbit respiratory rate) and
 * you want to assess agreement rather than mere correlation. Two methods
 * can be highly correlated yet systematically biased; Bland-Altman detects
 * that.
 *
 * Computation:
 * 1. For each valid pair i: difference_i = method1_i - method2_i,
 *    mean_i = (method1_i + method2_i) / 2
 * 2. Bias = mean(differences)
 * 3. Limits of agreement = bias +/- 1.96 * SD(differences)
 * 4. Proportional bias test: regress differences on means. If the slope
 *    is significantly non-zero (p < 0.05), the disagreement between methods
 *    depends on the magnitude of the measurement.
 *
 * Missing data: pairs where either value is NaN or Infinity are excluded.
 * Minimum 3 valid pairs required.
 *
 * @param input Two aligned measurement series with labels
 * @returns Bias, limits of agreement, proportional bias test, and plot points
 */
export function computeBlandAltman(input: BlandAltmanInput): BlandAltmanResult {
  const { method1, method2, dates } = input;
  const { aClean, bClean, datesClean } = pairwiseFilterWithDates(method1, method2, dates);
  const n = aClean.length;

  // Degenerate case: fewer than 3 valid pairs
  if (n < 3) {
    return {
      meanDifference: NaN,
      sdDifference: NaN,
      upperLimit: NaN,
      lowerLimit: NaN,
      n,
      proportionalBias: {
        slope: NaN,
        intercept: NaN,
        pValue: NaN,
        isSignificant: false,
      },
      points: [],
    };
  }

  // Compute differences and means for each pair
  const differences: number[] = new Array(n);
  const means: number[] = new Array(n);
  const points: Array<{ mean: number; difference: number; date: string }> = new Array(n);

  for (let i = 0; i < n; i++) {
    const m1 = aClean[i] as number;
    const m2 = bClean[i] as number;
    const diff = m1 - m2;
    const avg = (m1 + m2) / 2;
    differences[i] = diff;
    means[i] = avg;
    points[i] = {
      mean: avg,
      difference: diff,
      date: datesClean[i] as string,
    };
  }

  const meanDiff = mean(differences);
  const sdDiff = sd(differences);

  const upperLimit = meanDiff + 1.96 * sdDiff;
  const lowerLimit = meanDiff - 1.96 * sdDiff;

  // Proportional bias: regress differences on means
  const reg = simpleLinearRegression(means, differences);
  const regPValue =
    Number.isFinite(reg.tStatistic) && reg.df >= 1 ? twoTailedPValue(reg.tStatistic, reg.df) : NaN;

  return {
    meanDifference: meanDiff,
    sdDifference: sdDiff,
    upperLimit,
    lowerLimit,
    n,
    proportionalBias: {
      slope: reg.slope,
      intercept: reg.intercept,
      pValue: regPValue,
      isSignificant: Number.isFinite(regPValue) && regPValue < 0.05,
    },
    points,
  };
}

// ---------------------------------------------------------------------------
// 3. computePartialCorrelationCrossSrc
// ---------------------------------------------------------------------------

/**
 * Compute partial correlation between two metrics, controlling for named
 * confounders.
 *
 * Example: correlate AHI with resting heart rate while controlling for
 * usage hours and leak rate to isolate the direct relationship.
 *
 * This wraps `partialCorrelation` from the core correlation module but
 * accepts named controls (for UI labeling) and returns the control names.
 *
 * Assumptions:
 * - All arrays (x, y, each control) are aligned by index (same date).
 * - Pairwise deletion applied across ALL variables simultaneously.
 * - Minimum n > k + 2 valid observations required (k = number of controls).
 *
 * @param input Variables and named controls
 * @returns Partial correlation with the list of controlled-for variable names
 */
export function computePartialCorrelationCrossSrc(
  input: PartialCorrelationInput,
): PartialCorrelationCrossSrcResult {
  const { x, y, controls } = input;
  const controlNames = Object.keys(controls);
  const controlArrays = controlNames.map((name) => controls[name] as number[]);

  const result = partialCorrelation(
    [...x],
    [...y],
    controlArrays.map((c) => [...c]),
  );

  return {
    r: result.r,
    pValue: result.pValue,
    ci95Lower: result.ci95Lower,
    ci95Upper: result.ci95Upper,
    n: result.n,
    controlledFor: controlNames,
  };
}

// ---------------------------------------------------------------------------
// 4. computeLaggedCrossCorrelation
// ---------------------------------------------------------------------------

/**
 * Classify the magnitude of a correlation coefficient for interpretation text.
 */
function strengthWord(r: number): string {
  const ar = Math.abs(r);
  if (ar < 0.1) return 'negligible';
  if (ar < 0.3) return 'weak';
  if (ar < 0.5) return 'moderate';
  if (ar < 0.7) return 'strong';
  return 'very strong';
}

/**
 * Generate a human-readable interpretation of the cross-correlation result.
 *
 * The interpretation describes the best lag found, its direction, and
 * whether it exceeds the white-noise significance bound.
 */
function generateLagInterpretation(
  bestLag: number,
  bestCCF: number,
  significanceBound: number,
): string {
  if (!Number.isFinite(bestCCF) || !Number.isFinite(significanceBound)) {
    return 'Insufficient data to compute cross-correlation.';
  }

  const isSignificant = Math.abs(bestCCF) > significanceBound;
  const strength = strengthWord(bestCCF);
  const direction = bestCCF > 0 ? 'positive' : bestCCF < 0 ? 'negative' : 'no';
  const rFormatted = Math.abs(bestCCF).toFixed(2);

  if (!isSignificant) {
    return `No statistically significant cross-correlation was found at any lag (best: lag ${bestLag}, r=${bestCCF.toFixed(2)}, within the noise band of +/-${significanceBound.toFixed(2)}).`;
  }

  if (bestLag === 0) {
    return `The strongest relationship is contemporaneous (same day) with a ${strength} ${direction} correlation (r=${bestCCF > 0 ? '' : '-'}${rFormatted}).`;
  }

  const lagDirection = bestLag > 0 ? 'leads' : 'lags';
  const absDays = Math.abs(bestLag);
  const dayWord = absDays === 1 ? 'day' : 'days';

  return `The first series ${lagDirection} the second by ${absDays} ${dayWord} with a ${strength} ${direction} correlation (r=${bestCCF > 0 ? '' : '-'}${rFormatted}).`;
}

/**
 * Compute cross-correlation function (CCF) between two daily time-series
 * with integer day lags, plus a human-readable interpretation.
 *
 * Positive lag k means x leads y by k days (today's x predicts y in k days).
 * Negative lag -k means y leads x.
 *
 * The significance bound is the Bartlett approximation under the white-noise
 * null: +/- 1.96 / sqrt(n).
 *
 * @param input Leading and lagging series with maximum lag
 * @returns CCF values, best lag, significance bound, and interpretation text
 */
export function computeLaggedCrossCorrelation(
  input: LaggedCrossSourceCorrelationInput,
): LaggedCrossSourceCorrelationResult {
  const { x, y, maxLag = 7 } = input;

  const result = crossCorrelation([...x], [...y], maxLag);

  const interpretation = generateLagInterpretation(
    result.bestLag,
    result.bestCCF,
    result.significanceBound,
  );

  return {
    lags: result.lags,
    ccf: result.ccf,
    significanceBound: result.significanceBound,
    bestLag: result.bestLag,
    bestCCF: result.bestCCF,
    interpretation,
  };
}

// ---------------------------------------------------------------------------
// 5. correlateDataSources
// ---------------------------------------------------------------------------

/**
 * Names of CPAP metrics extracted from CpapDailyRecord, in the order
 * they appear in the correlation matrix.
 */
const CPAP_METRIC_KEYS: ReadonlyArray<{
  key: keyof CpapDailyRecord;
  label: string;
  optional: boolean;
}> = [
  { key: 'ahi', label: 'AHI', optional: false },
  { key: 'pressureMean', label: 'Pressure (Mean)', optional: false },
  { key: 'pressure95th', label: 'Pressure (95th)', optional: false },
  { key: 'leakMedian', label: 'Leak (Median)', optional: false },
  { key: 'leak95th', label: 'Leak (95th)', optional: false },
  { key: 'usageHours', label: 'Usage Hours', optional: false },
  { key: 'ahiObstructive', label: 'AHI (Obstructive)', optional: false },
  { key: 'ahiCentral', label: 'AHI (Central)', optional: false },
  { key: 'respiratoryRateMedian', label: 'Respiratory Rate', optional: true },
  { key: 'tidalVolumeMedian', label: 'Tidal Volume', optional: true },
  { key: 'minuteVentilationMedian', label: 'Minute Ventilation', optional: true },
];

/**
 * Inner-join CPAP and wearable data on date, then compute pairwise
 * correlations between every CPAP metric and every wearable metric.
 *
 * The join is an exact match on the YYYY-MM-DD date string. Only dates
 * present in BOTH the CPAP data and at least one wearable metric are
 * included. Optional CPAP metrics (respiratory rate, tidal volume,
 * minute ventilation) are included only if they have at least 3 non-NaN
 * values in the overlapping date range.
 *
 * Significant pairs (p < 0.05) are extracted and sorted by |r| descending.
 *
 * @param input CPAP daily records, wearable metric series, and method
 * @returns Correlation matrix with metric labels and significant pairs
 */
export function correlateDataSources(
  input: CorrelateDataSourcesInput,
): CrossSourceCorrelationMatrix {
  const { cpapData, wearableData, method } = input;
  const corrFn = method === 'spearman' ? spearmanCorrelation : pearsonCorrelation;

  // Build a date-indexed map of CPAP data
  const cpapByDate = new Map<string, CpapDailyRecord>();
  for (const record of cpapData) {
    cpapByDate.set(record.date, record);
  }

  // Build date-indexed maps for each wearable metric
  const wearableMetricNames = Object.keys(wearableData);
  const wearableByDate = new Map<string, Map<string, number>>();
  for (const metricName of wearableMetricNames) {
    const series = wearableData[metricName];
    if (!series) continue;
    for (const point of series) {
      if (!Number.isFinite(point.value)) continue;
      let dateMap = wearableByDate.get(point.date);
      if (!dateMap) {
        dateMap = new Map<string, number>();
        wearableByDate.set(point.date, dateMap);
      }
      dateMap.set(metricName, point.value);
    }
  }

  // Find overlapping dates (present in both CPAP and wearable data)
  const overlapDates: string[] = [];
  for (const date of cpapByDate.keys()) {
    if (wearableByDate.has(date)) {
      overlapDates.push(date);
    }
  }
  overlapDates.sort();

  const n = overlapDates.length;

  if (n < 3 || wearableMetricNames.length === 0) {
    return {
      cpapMetrics: [],
      wearableMetrics: [],
      matrix: [],
      pValues: [],
      n,
      significantPairs: [],
    };
  }

  // Extract aligned CPAP metric arrays and determine which to include
  const cpapMetricArrays: Map<string, number[]> = new Map();
  const cpapMetricLabels: string[] = [];

  for (const metricDef of CPAP_METRIC_KEYS) {
    const values: number[] = new Array(n);
    let finiteCount = 0;
    for (let i = 0; i < n; i++) {
      const record = cpapByDate.get(overlapDates[i] as string) as CpapDailyRecord;
      const v = record[metricDef.key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        values[i] = v;
        finiteCount++;
      } else {
        values[i] = NaN;
      }
    }
    // Include optional metrics only if they have enough data
    if (metricDef.optional && finiteCount < 3) continue;
    // Include required metrics even if sparse (pairwise deletion will handle it)
    cpapMetricArrays.set(metricDef.label, values);
    cpapMetricLabels.push(metricDef.label);
  }

  // Extract aligned wearable metric arrays
  const wearableMetricArrays: Map<string, number[]> = new Map();
  const wearableMetricLabels: string[] = [];

  for (const metricName of wearableMetricNames) {
    const values: number[] = new Array(n);
    let finiteCount = 0;
    for (let i = 0; i < n; i++) {
      const dateMap = wearableByDate.get(overlapDates[i] as string);
      const v = dateMap?.get(metricName);
      if (v !== undefined && Number.isFinite(v)) {
        values[i] = v;
        finiteCount++;
      } else {
        values[i] = NaN;
      }
    }
    if (finiteCount < 3) continue;
    wearableMetricArrays.set(metricName, values);
    wearableMetricLabels.push(metricName);
  }

  if (cpapMetricLabels.length === 0 || wearableMetricLabels.length === 0) {
    return {
      cpapMetrics: cpapMetricLabels,
      wearableMetrics: wearableMetricLabels,
      matrix: [],
      pValues: [],
      n,
      significantPairs: [],
    };
  }

  // Compute pairwise correlations
  const cRows = cpapMetricLabels.length;
  const wCols = wearableMetricLabels.length;
  const matrix: number[][] = Array.from({ length: cRows }, () =>
    new Array<number>(wCols).fill(NaN),
  );
  const pValueMatrix: number[][] = Array.from({ length: cRows }, () =>
    new Array<number>(wCols).fill(NaN),
  );

  const significantPairs: Array<{
    cpapMetric: string;
    wearableMetric: string;
    r: number;
    pValue: number;
    strength: string;
    direction: string;
  }> = [];

  for (let ci = 0; ci < cRows; ci++) {
    const cpapLabel = cpapMetricLabels[ci] as string;
    const cpapValues = cpapMetricArrays.get(cpapLabel) as number[];

    for (let wi = 0; wi < wCols; wi++) {
      const wearableLabel = wearableMetricLabels[wi] as string;
      const wearableValues = wearableMetricArrays.get(wearableLabel) as number[];

      const result = corrFn([...cpapValues], [...wearableValues]);
      (matrix[ci] as number[])[wi] = result.r;
      (pValueMatrix[ci] as number[])[wi] = result.pValue;

      if (Number.isFinite(result.pValue) && result.pValue < 0.05) {
        significantPairs.push({
          cpapMetric: cpapLabel,
          wearableMetric: wearableLabel,
          r: result.r,
          pValue: result.pValue,
          strength: result.strength,
          direction: result.direction,
        });
      }
    }
  }

  // Sort significant pairs by |r| descending
  significantPairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  return {
    cpapMetrics: cpapMetricLabels,
    wearableMetrics: wearableMetricLabels,
    matrix,
    pValues: pValueMatrix,
    n,
    significantPairs,
  };
}

// ---------------------------------------------------------------------------
// 6. extractWearableMetricSeries
// ---------------------------------------------------------------------------

/**
 * Navigate into an object by a dot-separated path and return the value,
 * or undefined if any segment is missing.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Extract a single numeric metric from an array of IntegrationDailySummary
 * records, filtered by data type.
 *
 * The metricPath navigates into the data payload using dot notation. For
 * example, for sleep_score summaries: `metricPath = 'overallScore'` extracts
 * `summary.data.overallScore`. For nested payloads: `metricPath = 'stages.deep'`.
 *
 * Records where the extracted value is not a finite number are excluded.
 *
 * @param summaries Array of daily summary records from any integration source
 * @param dataType Fitbit daily data type discriminator to filter by
 * @param metricPath Dot-separated path into the data payload
 * @returns Array of {date, value} pairs sorted by date
 */
export function extractWearableMetricSeries<T extends FitbitDailyType>(
  summaries: ReadonlyArray<IntegrationDailySummary<T>>,
  dataType: T,
  metricPath: string,
): Array<{ date: string; value: number }> {
  const result: Array<{ date: string; value: number }> = [];

  for (const summary of summaries) {
    if (summary.dataType !== dataType) continue;

    const raw = getNestedValue(summary.data, metricPath);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;

    result.push({ date: summary.date, value: raw });
  }

  // Sort by date ascending
  result.sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

// ---------------------------------------------------------------------------
// Re-export FITBIT_DATA_TYPE_LABEL for convenience in cross-source views
// ---------------------------------------------------------------------------

export { FITBIT_DATA_TYPE_LABEL };

// ---------------------------------------------------------------------------
// Intraday aggregate helpers (windowed summary stats for intraday series)
// ---------------------------------------------------------------------------

export { aggregateIntraday, selectWindowSamples } from './intradayAggregates';
export type { IntradaySample, TimeWindow, IntradayAggregate } from './intradayAggregates';
