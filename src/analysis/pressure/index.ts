/**
 * Pressure Analysis Module
 *
 * Statistical analysis of CPAP/BiPAP pressure data including titration
 * optimisation, pressure–AHI response curves, BiPAP effectiveness
 * assessment, and pressure variability metrics.
 *
 * All algorithms handle edge cases (empty data, insufficient pairs,
 * zero variance) and use only finite numeric values for computation.
 *
 * @module analysis/pressure
 */

import { twoTailedPValue, percentileFromSorted } from '@/analysis/math';
import { filterFinite } from '@/analysis/descriptive';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AASM normal AHI threshold (events/hour). */
const AHI_NORMAL_THRESHOLD = 5;

/** Default pressure bin width in cmH₂O. */
const DEFAULT_BIN_WIDTH = 0.5;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TitrationResult {
  readonly optimalPressureMin: number;
  readonly optimalPressureMax: number;
  readonly ahiAtOptimal: number;
  readonly pressureAHIPairs: readonly {
    readonly pressure: number;
    readonly ahi: number;
  }[];
  readonly regressionSlope: number;
  readonly regressionIntercept: number;
  readonly regressionR: number;
  readonly recommendation: string;
}

export interface PressureResponseResult {
  readonly pressureBins: readonly number[];
  readonly meanAHI: readonly number[];
  readonly medianAHI: readonly number[];
  readonly countPerBin: readonly number[];
  readonly regressionSlope: number;
  readonly regressionIntercept: number;
  readonly rSquared: number;
  readonly pValue: number;
}

export interface BiPAPEffectivenessResult {
  readonly pressureSupport: readonly number[];
  readonly ahiValues: readonly number[];
  readonly meanPressureSupport: number;
  readonly regressionSlope: number;
  readonly regressionR: number;
  readonly pValue: number;
  readonly recommendation: string;
}

export interface PressureVariabilityResult {
  readonly mean: number;
  readonly median: number;
  readonly stdDev: number;
  readonly cv: number;
  readonly iqr: number;
  readonly p5: number;
  readonly p95: number;
  readonly rangeWidth: number;
  readonly stabilityScore: number;
  readonly interpretation: 'very stable' | 'stable' | 'moderate' | 'variable' | 'highly variable';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pairwise filter: keep only indices where both x[i] and y[i] are finite.
 * Returns two arrays of equal length.
 */
function pairwiseFinite(
  x: number[],
  y: number[],
): { readonly xs: number[]; readonly ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const len = Math.min(x.length, y.length);

  for (let i = 0; i < len; i++) {
    const xi = x[i];
    const yi = y[i];
    if (xi !== undefined && yi !== undefined && Number.isFinite(xi) && Number.isFinite(yi)) {
      xs.push(xi);
      ys.push(yi);
    }
  }

  return { xs, ys };
}

/**
 * Triple-wise filter: keep only indices where x[i], y[i], and z[i] are all finite.
 */
function tripleFinite(
  x: number[],
  y: number[],
  z: number[],
): { readonly xs: number[]; readonly ys: number[]; readonly zs: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const len = Math.min(x.length, y.length, z.length);

  for (let i = 0; i < len; i++) {
    const xi = x[i];
    const yi = y[i];
    const zi = z[i];
    if (
      xi !== undefined &&
      yi !== undefined &&
      zi !== undefined &&
      Number.isFinite(xi) &&
      Number.isFinite(yi) &&
      Number.isFinite(zi)
    ) {
      xs.push(xi);
      ys.push(yi);
      zs.push(zi);
    }
  }

  return { xs, ys, zs };
}

/** Simple linear regression on paired arrays of equal length (assumed pre-filtered). */
interface RegressionResult {
  readonly slope: number;
  readonly intercept: number;
  readonly r: number;
  readonly rSquared: number;
  readonly pValue: number;
}

function linearRegression(xs: number[], ys: number[]): RegressionResult {
  const n = xs.length;

  if (n < 2) {
    return { slope: NaN, intercept: NaN, r: NaN, rSquared: NaN, pValue: NaN };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i] as number;
    sumY += ys[i] as number;
  }
  const mx = sumX / n;
  const my = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Zero variance in x → regression undefined
  if (sxx === 0) {
    return { slope: NaN, intercept: my, r: NaN, rSquared: NaN, pValue: NaN };
  }

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  // Pearson r
  if (syy === 0) {
    // All y values identical → perfect prediction at intercept, r undefined
    return { slope: 0, intercept: my, r: NaN, rSquared: NaN, pValue: NaN };
  }

  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const rSquared = r * r;

  // t-statistic for slope significance: t = r * sqrt((n-2) / (1 - r²))
  let pValue: number;
  if (n <= 2) {
    pValue = NaN;
  } else if (Math.abs(r) >= 1) {
    pValue = 0;
  } else {
    const df = n - 2;
    const t = r * Math.sqrt(df / (1 - r * r));
    pValue = twoTailedPValue(t, df);
  }

  return { slope, intercept, r, rSquared, pValue };
}

/**
 * Compute the median of a pre-sorted numeric array.
 * Returns NaN for empty arrays.
 */
function sortedMedian(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n % 2 === 1) return sorted[Math.floor(n / 2)] as number;
  return ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
}

/**
 * Group values into bins and compute per-bin statistics.
 * Returns bins sorted by centre.
 */
interface BinStats {
  readonly centre: number;
  readonly meanVal: number;
  readonly medianVal: number;
  readonly count: number;
}

function binData(keys: number[], values: number[], binWidth: number): readonly BinStats[] {
  if (keys.length === 0) return [];

  // Assign each key to a bin
  const bins = new Map<number, number[]>();

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as number;
    const binCentre = (Math.round(Math.floor(k / binWidth) * binWidth + binWidth / 2) * 10) / 10;
    // Use a canonical key to avoid floating-point map issues
    const binKey = Math.round(binCentre * 1000) / 1000;
    const existing = bins.get(binKey);
    const v = values[i] as number;
    if (existing !== undefined) {
      existing.push(v);
    } else {
      bins.set(binKey, [v]);
    }
  }

  const result: BinStats[] = [];

  for (const [centre, vals] of bins) {
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i] as number;
    }
    const meanVal = sum / vals.length;
    const sorted = vals.slice().sort((a, b) => a - b);
    const medianVal = sortedMedian(sorted);

    result.push({ centre, meanVal, medianVal, count: vals.length });
  }

  result.sort((a, b) => a.centre - b.centre);
  return result;
}

// ---------------------------------------------------------------------------
// 1. Titration Helper
// ---------------------------------------------------------------------------

/**
 * Analyse paired pressure and AHI data to identify the optimal pressure
 * range for CPAP titration.
 *
 * **Algorithm**:
 * 1. Pair-wise filter non-finite values.
 * 2. Compute simple linear regression (AHI ≈ slope × pressure + intercept).
 * 3. Bin pressures into 0.5 cmH₂O bins and compute mean AHI per bin.
 * 4. Find the longest contiguous range of bins where mean AHI < 5.
 * 5. If no bin achieves AHI < 5, report the single bin with lowest mean AHI.
 * 6. Generate a human-readable recommendation string.
 *
 * @param pressures - Nightly mean/median pressure values (cmH₂O)
 * @param ahiValues - Corresponding nightly AHI values (events/hour)
 * @returns Full titration analysis result
 */
export function titrationHelper(pressures: number[], ahiValues: number[]): TitrationResult {
  const { xs, ys } = pairwiseFinite(pressures, ahiValues);
  const n = xs.length;

  const pairs: { readonly pressure: number; readonly ahi: number }[] = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ pressure: xs[i] as number, ahi: ys[i] as number });
  }

  // Edge case: insufficient data
  if (n < 2) {
    return {
      optimalPressureMin: NaN,
      optimalPressureMax: NaN,
      ahiAtOptimal: NaN,
      pressureAHIPairs: pairs,
      regressionSlope: NaN,
      regressionIntercept: NaN,
      regressionR: NaN,
      recommendation:
        n === 0
          ? 'Insufficient data for titration analysis.'
          : 'Insufficient data for titration analysis (need at least 2 data points).',
    };
  }

  const reg = linearRegression(xs, ys);

  // Bin data for optimal range detection
  const bins = binData(xs, ys, DEFAULT_BIN_WIDTH);

  // Find longest contiguous range of bins where mean AHI < threshold
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i] as BinStats;
    if (bin.meanVal < AHI_NORMAL_THRESHOLD) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  let optimalMin: number;
  let optimalMax: number;
  let ahiAtOptimal: number;
  let recommendation: string;

  if (bestLen > 0) {
    // Found contiguous range where AHI < 5
    const startBin = bins[bestStart] as BinStats;
    const endBin = bins[bestStart + bestLen - 1] as BinStats;
    optimalMin = startBin.centre - DEFAULT_BIN_WIDTH / 2;
    optimalMax = endBin.centre + DEFAULT_BIN_WIDTH / 2;

    // Mean AHI across the optimal bins
    let sumAhi = 0;
    let countAhi = 0;
    for (let i = bestStart; i < bestStart + bestLen; i++) {
      const bin = bins[i] as BinStats;
      sumAhi += bin.meanVal * bin.count;
      countAhi += bin.count;
    }
    ahiAtOptimal = countAhi > 0 ? sumAhi / countAhi : NaN;
    recommendation = `Optimal pressure range: ${optimalMin.toFixed(1)}–${optimalMax.toFixed(1)} cmH₂O (mean AHI: ${ahiAtOptimal.toFixed(1)}).`;
  } else {
    // No bin achieves AHI < 5 — report lowest bin
    let lowestIdx = 0;
    let lowestAhi = Infinity;
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i] as BinStats;
      if (bin.meanVal < lowestAhi) {
        lowestAhi = bin.meanVal;
        lowestIdx = i;
      }
    }
    const lowestBin = bins[lowestIdx] as BinStats;
    optimalMin = lowestBin.centre;
    optimalMax = lowestBin.centre;
    ahiAtOptimal = lowestBin.meanVal;
    recommendation = `No pressure achieves AHI < 5; lowest AHI ${ahiAtOptimal.toFixed(1)} at ${optimalMin.toFixed(1)} cmH₂O. Consider further titration.`;
  }

  return {
    optimalPressureMin: optimalMin,
    optimalPressureMax: optimalMax,
    ahiAtOptimal,
    pressureAHIPairs: pairs,
    regressionSlope: reg.slope,
    regressionIntercept: reg.intercept,
    regressionR: reg.r,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// 2. Pressure-Response Curve
// ---------------------------------------------------------------------------

/**
 * Compute a binned pressure–AHI response curve with linear regression
 * statistics on the raw paired data.
 *
 * **Algorithm**:
 * 1. Pair-wise filter to finite values.
 * 2. Bin pressures into `binWidth`-sized bins.
 * 3. For each bin compute mean and median AHI.
 * 4. Compute linear regression on the full raw paired data.
 *
 * @param pressures - Nightly mean/median pressure values (cmH₂O)
 * @param ahiValues - Corresponding nightly AHI values (events/hour)
 * @param binWidth  - Pressure bin width in cmH₂O (default 0.5)
 * @returns Binned response data plus regression statistics
 */
export function pressureResponseCurve(
  pressures: number[],
  ahiValues: number[],
  binWidth: number = DEFAULT_BIN_WIDTH,
): PressureResponseResult {
  const { xs, ys } = pairwiseFinite(pressures, ahiValues);

  // Edge case: no valid pairs
  if (xs.length === 0) {
    return {
      pressureBins: [],
      meanAHI: [],
      medianAHI: [],
      countPerBin: [],
      regressionSlope: NaN,
      regressionIntercept: NaN,
      rSquared: NaN,
      pValue: NaN,
    };
  }

  const effectiveBinWidth = binWidth > 0 ? binWidth : DEFAULT_BIN_WIDTH;
  const bins = binData(xs, ys, effectiveBinWidth);

  const pressureBins: number[] = [];
  const meanAHI: number[] = [];
  const medianAHI: number[] = [];
  const countPerBin: number[] = [];

  for (const bin of bins) {
    pressureBins.push(bin.centre);
    meanAHI.push(bin.meanVal);
    medianAHI.push(bin.medianVal);
    countPerBin.push(bin.count);
  }

  const reg = linearRegression(xs, ys);

  return {
    pressureBins,
    meanAHI,
    medianAHI,
    countPerBin,
    regressionSlope: reg.slope,
    regressionIntercept: reg.intercept,
    rSquared: reg.rSquared,
    pValue: reg.pValue,
  };
}

// ---------------------------------------------------------------------------
// 3. BiPAP Effectiveness
// ---------------------------------------------------------------------------

/**
 * Assess BiPAP therapy effectiveness by analysing the relationship
 * between pressure support (IPAP − EPAP) and AHI.
 *
 * **Algorithm**:
 * 1. Compute pressure support = IPAP − EPAP per night.
 * 2. Triple-wise filter to finite values.
 * 3. Regress AHI on pressure support.
 * 4. Generate a recommendation based on slope direction and significance.
 *
 * @param epapValues - Nightly median EPAP values (cmH₂O)
 * @param ipapValues - Nightly median IPAP values (cmH₂O)
 * @param ahiValues  - Corresponding nightly AHI values (events/hour)
 * @returns BiPAP effectiveness analysis result
 */
export function bipapEffectiveness(
  epapValues: number[],
  ipapValues: number[],
  ahiValues: number[],
): BiPAPEffectivenessResult {
  const { xs: epaps, ys: ipaps, zs: ahis } = tripleFinite(epapValues, ipapValues, ahiValues);
  const n = epaps.length;

  // Compute pressure support
  const ps: number[] = [];
  for (let i = 0; i < n; i++) {
    ps.push((ipaps[i] as number) - (epaps[i] as number));
  }

  // Edge case: insufficient data
  if (n < 2) {
    return {
      pressureSupport: ps,
      ahiValues: ahis,
      meanPressureSupport: n === 1 ? (ps[0] as number) : NaN,
      regressionSlope: NaN,
      regressionR: NaN,
      pValue: NaN,
      recommendation:
        n === 0
          ? 'Insufficient data for BiPAP effectiveness analysis.'
          : 'Insufficient data for BiPAP effectiveness analysis (need at least 2 data points).',
    };
  }

  // Mean pressure support
  let sumPS = 0;
  for (let i = 0; i < n; i++) {
    sumPS += ps[i] as number;
  }
  const meanPS = sumPS / n;

  // Regress AHI on pressure support
  const reg = linearRegression(ps, ahis);

  // Build recommendation
  let recommendation: string;
  const significant = Number.isFinite(reg.pValue) && reg.pValue < 0.05;

  if (!Number.isFinite(reg.slope)) {
    recommendation = 'Unable to determine pressure support effectiveness (insufficient variance).';
  } else if (significant && reg.slope < 0) {
    recommendation = `Higher pressure support is associated with lower AHI (slope: ${reg.slope.toFixed(2)}, p=${reg.pValue.toFixed(3)}). Current mean pressure support: ${meanPS.toFixed(1)} cmH₂O.`;
  } else if (significant && reg.slope > 0) {
    recommendation = `Higher pressure support is associated with higher AHI (slope: ${reg.slope.toFixed(2)}, p=${reg.pValue.toFixed(3)}). Consider reviewing BiPAP settings. Mean pressure support: ${meanPS.toFixed(1)} cmH₂O.`;
  } else {
    recommendation = `No statistically significant relationship between pressure support and AHI (p=${Number.isFinite(reg.pValue) ? reg.pValue.toFixed(3) : 'N/A'}). Mean pressure support: ${meanPS.toFixed(1)} cmH₂O.`;
  }

  return {
    pressureSupport: ps,
    ahiValues: ahis,
    meanPressureSupport: meanPS,
    regressionSlope: reg.slope,
    regressionR: reg.r,
    pValue: reg.pValue,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// 4. Pressure Variability
// ---------------------------------------------------------------------------

/**
 * Compute descriptive variability metrics for a series of pressure values
 * and derive a stability score and interpretation.
 *
 * The stability score is `1 − min(CV, 1)`, where CV is the coefficient
 * of variation. The interpretation thresholds are:
 *
 * | CV range      | Interpretation    |
 * |---------------|-------------------|
 * | < 0.05        | very stable       |
 * | 0.05 – 0.10   | stable            |
 * | 0.10 – 0.20   | moderate          |
 * | 0.20 – 0.30   | variable          |
 * | ≥ 0.30        | highly variable   |
 *
 * @param pressures - Array of nightly pressure values (cmH₂O)
 * @returns Full variability analysis result
 */
export function pressureVariability(pressures: number[]): PressureVariabilityResult {
  const clean = filterFinite(pressures);
  const n = clean.length;

  // Edge case: empty / insufficient data
  if (n === 0) {
    return {
      mean: NaN,
      median: NaN,
      stdDev: NaN,
      cv: NaN,
      iqr: NaN,
      p5: NaN,
      p95: NaN,
      rangeWidth: NaN,
      stabilityScore: NaN,
      interpretation: 'highly variable',
    };
  }

  // Single value → perfectly stable
  if (n === 1) {
    const val = clean[0] as number;
    return {
      mean: val,
      median: val,
      stdDev: 0,
      cv: 0,
      iqr: 0,
      p5: val,
      p95: val,
      rangeWidth: 0,
      stabilityScore: 1,
      interpretation: 'very stable',
    };
  }

  // Mean
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += clean[i] as number;
  }
  const mean = sum / n;

  // Sort for percentile / median
  const sorted = clean.slice().sort((a, b) => a - b);
  const median = sortedMedian(sorted);

  // Sample standard deviation (Bessel-corrected)
  let sumSqDev = 0;
  for (let i = 0; i < n; i++) {
    const d = (clean[i] as number) - mean;
    sumSqDev += d * d;
  }
  const stdDev = Math.sqrt(sumSqDev / (n - 1));

  // Coefficient of variation
  const cv = mean !== 0 ? stdDev / Math.abs(mean) : NaN;

  // Percentiles
  const q1 = percentileFromSorted(sorted, 25);
  const q3 = percentileFromSorted(sorted, 75);
  const iqr = q3 - q1;
  const p5 = percentileFromSorted(sorted, 5);
  const p95 = percentileFromSorted(sorted, 95);
  const rangeWidth = p95 - p5;

  // Stability score
  const stabilityScore = Number.isFinite(cv) ? 1 - Math.min(cv, 1) : NaN;

  // Interpretation
  let interpretation: PressureVariabilityResult['interpretation'];
  if (!Number.isFinite(cv)) {
    interpretation = 'highly variable';
  } else if (cv < 0.05) {
    interpretation = 'very stable';
  } else if (cv < 0.1) {
    interpretation = 'stable';
  } else if (cv < 0.2) {
    interpretation = 'moderate';
  } else if (cv < 0.3) {
    interpretation = 'variable';
  } else {
    interpretation = 'highly variable';
  }

  return {
    mean,
    median,
    stdDev,
    cv,
    iqr,
    p5,
    p95,
    rangeWidth,
    stabilityScore,
    interpretation,
  };
}
