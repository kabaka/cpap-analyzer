/**
 * Time-Series Analysis Module
 *
 * Provides rolling statistics, trend analysis, LOESS smoothing,
 * change-point detection (PELT), simplified STL decomposition,
 * and autocorrelation functions for CPAP therapy data.
 *
 * Key implementation notes:
 * - Rolling stats use pairwise deletion for missing-date gaps
 * - Linear trend uses Pearson r with t-distribution p-value
 * - LOESS uses tricube kernel with weighted least-squares
 * - PELT uses L2 cost with pruning (Killick et al. 2012)
 * - STL is simplified: moving-average trend + day-of-week seasonal
 * - ACF/PACF use standard estimators with Durbin-Levinson recursion
 */

import { filterFinite } from '../descriptive';
import { at, inverseNormalCDF, studentTCDF, binomCoeff } from '../math';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RollingResult {
  readonly dates: readonly string[];
  readonly values: readonly number[];
  readonly ciLower: readonly number[];
  readonly ciUpper: readonly number[];
  readonly sampleSizes: readonly number[];
}

export interface LinearTrend {
  readonly slope: number;
  readonly intercept: number;
  readonly r: number;
  readonly rSquared: number;
  readonly pValue: number;
  readonly trendDirection: 'increasing' | 'decreasing' | 'flat';
  readonly trendStrength: 'negligible' | 'weak' | 'moderate' | 'strong';
}

export interface LoessResult {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly residuals: readonly number[];
}

export interface ChangePoint {
  readonly index: number;
  readonly date: string;
  readonly significance: number;
}

export interface Segment {
  readonly start: number;
  readonly end: number;
  readonly mean: number;
  readonly variance: number;
  readonly n: number;
}

export interface ChangePointResult {
  readonly changePoints: readonly ChangePoint[];
  readonly segments: readonly Segment[];
}

export interface STLResult {
  readonly trend: readonly number[];
  readonly seasonal: readonly number[];
  readonly remainder: readonly number[];
  readonly dates: readonly string[];
}

export interface ACFResult {
  readonly lags: readonly number[];
  readonly acf: readonly number[];
  readonly significanceBound: number;
}

export interface PACFResult {
  readonly lags: readonly number[];
  readonly pacf: readonly number[];
  readonly significanceBound: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a date string to epoch millis. */
function parseDate(d: string): number {
  return new Date(d).getTime();
}

/** Days between two epoch-millis timestamps. */
function daysBetween(a: number, b: number): number {
  return Math.round((b - a) / 86_400_000);
}

/** Sort a numeric array in place (ascending). Returns same reference. */
function sortAsc(arr: number[]): number[] {
  return arr.sort((a, b) => a - b);
}

/** Compute median of a *sorted* finite array. Returns NaN for empty. */
function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return at(sorted, mid);
  }
  return (at(sorted, mid - 1) + at(sorted, mid)) / 2;
}

/** Compute mean of finite values. Returns NaN for empty. */
function mean(data: number[]): number {
  if (data.length === 0) return NaN;
  let sum = 0;
  for (const v of data) sum += v;
  return sum / data.length;
}

/** Compute sample variance (Bessel-corrected). Returns NaN for n < 2. */
function sampleVariance(data: number[]): number {
  const n = data.length;
  if (n < 2) return NaN;
  const m = mean(data);
  let ss = 0;
  for (const v of data) {
    const d = v - m;
    ss += d * d;
  }
  return ss / (n - 1);
}

/** Compute sample standard deviation. */
function sampleStdDev(data: number[]): number {
  return Math.sqrt(sampleVariance(data));
}

/**
 * z critical value for two-tailed confidence level.
 */
function zCritical(confidence: number): number {
  const alpha = 1 - confidence;
  const p = 1 - alpha / 2;
  return inverseNormalCDF(p);
}

/**
 * Tricube kernel weight: W(u) = (1 - |u|³)³  for |u| < 1, else 0.
 */
function tricube(u: number): number {
  const au = Math.abs(u);
  if (au >= 1) return 0;
  const v = 1 - au * au * au;
  return v * v * v;
}

/**
 * Bisquare weight for robust STL: w(u) = (1 - u²)² for |u| < 1, else 0.
 */
function bisquare(u: number): number {
  const au = Math.abs(u);
  if (au >= 1) return 0;
  const v = 1 - au * au;
  return v * v;
}

/** Safe string array access — returns fallback for out-of-bounds. */
function strAt(arr: string[], i: number, fallback = ''): string {
  const v = arr[i];
  return v !== undefined ? v : fallback;
}

// ---------------------------------------------------------------------------
// 1. Rolling Mean
// ---------------------------------------------------------------------------

/**
 * Rolling mean with confidence intervals.
 *
 * For each date index i, computes statistics over the window
 * [i - window + 1, i] using pairwise deletion (only finite values).
 *
 * $$\bar{x}_t = \frac{1}{k}\sum_{i=0}^{k-1} x_{t-i}$$
 *
 * CI via normal approximation: $\bar{x} \pm z_{\alpha/2} \cdot \frac{s}{\sqrt{n}}$.
 *
 * @param dates - ISO date strings (must be aligned with values)
 * @param values - Numeric observations
 * @param window - Window size in number of observations
 * @param confidence - Confidence level (default 0.95)
 */
export function rollingMean(
  dates: string[],
  values: number[],
  window: number,
  confidence: number = 0.95,
): RollingResult {
  const n = dates.length;
  const resultDates: string[] = [];
  const resultValues: number[] = [];
  const ciLower: number[] = [];
  const ciUpper: number[] = [];
  const sampleSizes: number[] = [];

  if (n === 0 || window < 1) {
    return { dates: resultDates, values: resultValues, ciLower, ciUpper, sampleSizes };
  }

  const z = zCritical(confidence);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    const windowData = filterFinite(values.slice(start, i + 1));
    const k = windowData.length;

    const m = mean(windowData);
    resultDates.push(strAt(dates, i));
    resultValues.push(k > 0 ? m : NaN);
    sampleSizes.push(k);

    if (k >= 2) {
      const s = sampleStdDev(windowData);
      const margin = z * (s / Math.sqrt(k));
      ciLower.push(m - margin);
      ciUpper.push(m + margin);
    } else {
      ciLower.push(NaN);
      ciUpper.push(NaN);
    }
  }

  return { dates: resultDates, values: resultValues, ciLower, ciUpper, sampleSizes };
}

// ---------------------------------------------------------------------------
// 2. Rolling Median
// ---------------------------------------------------------------------------

/**
 * Rolling median with confidence intervals.
 *
 * CI via binomial order-statistic method: the 100(1-α)% CI for the median
 * is given by the (j)th and (k)th order statistics where j and k are
 * determined by the binomial distribution.
 *
 * @param dates - ISO date strings
 * @param values - Numeric observations
 * @param window - Window size in number of observations
 * @param confidence - Confidence level (default 0.95)
 */
export function rollingMedian(
  dates: string[],
  values: number[],
  window: number,
  confidence: number = 0.95,
): RollingResult {
  const n = dates.length;
  const resultDates: string[] = [];
  const resultValues: number[] = [];
  const ciLower: number[] = [];
  const ciUpper: number[] = [];
  const sampleSizes: number[] = [];

  if (n === 0 || window < 1) {
    return { dates: resultDates, values: resultValues, ciLower, ciUpper, sampleSizes };
  }

  const alpha = 1 - confidence;

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - window + 1);
    const windowData = sortAsc(filterFinite(values.slice(start, i + 1)));
    const k = windowData.length;

    resultDates.push(strAt(dates, i));
    resultValues.push(medianSorted(windowData));
    sampleSizes.push(k);

    if (k >= 2) {
      const bounds = medianCIBounds(k, alpha);
      if (bounds) {
        ciLower.push(at(windowData, bounds.lower));
        ciUpper.push(at(windowData, bounds.upper));
      } else {
        ciLower.push(NaN);
        ciUpper.push(NaN);
      }
    } else {
      ciLower.push(NaN);
      ciUpper.push(NaN);
    }
  }

  return { dates: resultDates, values: resultValues, ciLower, ciUpper, sampleSizes };
}

/**
 * Find the order-statistic indices for the binomial CI of the median.
 *
 * For sample size n, find j (lower) and k (upper) such that:
 *   P(B ≤ j) ≤ α/2  and  P(B ≤ k-1) ≥ 1 - α/2
 * where B ~ Binomial(n, 0.5).
 *
 * Returns 0-based indices into the sorted array, or null if CI is not possible.
 */
function medianCIBounds(n: number, alpha: number): { lower: number; upper: number } | null {
  const halfN = Math.pow(0.5, n);
  let cumProb = 0;
  let lower = -1;
  let upper = -1;

  for (let j = 0; j <= n; j++) {
    cumProb += binomCoeff(n, j) * halfN;
    if (lower === -1 && cumProb > alpha / 2) {
      lower = j;
    }
    if (upper === -1 && cumProb >= 1 - alpha / 2) {
      upper = j - 1;
      break;
    }
  }

  if (lower < 0) lower = 0;
  if (upper < 0 || upper >= n) upper = n - 1;
  if (lower > upper) return null;

  return { lower, upper };
}

// ---------------------------------------------------------------------------
// 3. Linear Trend
// ---------------------------------------------------------------------------

/**
 * Compute linear trend via ordinary least squares on day-indexed dates.
 *
 * Fits the model $y = \beta_0 + \beta_1 x + \varepsilon$ where $x$ is the day offset.
 *
 * Slope estimator:
 * $$\hat{\beta}_1 = \frac{\sum(x_i - \bar{x})(y_i - \bar{y})}{\sum(x_i - \bar{x})^2}$$
 *
 * Significance via $t = r \sqrt{\frac{n-2}{1-r^2}}$ with $n-2$ d.f.
 *
 * @param dates - ISO date strings
 * @param values - Numeric observations (parallel to dates)
 */
export function linearTrend(dates: string[], values: number[]): LinearTrend {
  const nanResult: LinearTrend = {
    slope: NaN,
    intercept: NaN,
    r: NaN,
    rSquared: NaN,
    pValue: NaN,
    trendDirection: 'flat',
    trendStrength: 'negligible',
  };

  if (dates.length !== values.length || dates.length === 0) return nanResult;

  const xs: number[] = [];
  const ys: number[] = [];
  const firstDate = dates[0];
  if (firstDate === undefined) return nanResult;
  const epoch0 = parseDate(firstDate);

  for (let i = 0; i < dates.length; i++) {
    const v = values[i];
    const d = dates[i];
    if (v === undefined || d === undefined || !Number.isFinite(v)) continue;
    xs.push(daysBetween(epoch0, parseDate(d)));
    ys.push(v);
  }

  const n = xs.length;
  if (n < 2) return nanResult;

  const mx = mean(xs);
  const my = mean(ys);

  let ssXX = 0;
  let ssYY = 0;
  let ssXY = 0;

  for (let i = 0; i < n; i++) {
    const dx = at(xs, i) - mx;
    const dy = at(ys, i) - my;
    ssXX += dx * dx;
    ssYY += dy * dy;
    ssXY += dx * dy;
  }

  if (ssXX === 0 || ssYY === 0) {
    return {
      slope: ssXX === 0 ? NaN : 0,
      intercept: ssXX === 0 ? NaN : my,
      r: 0,
      rSquared: 0,
      pValue: 1,
      trendDirection: 'flat',
      trendStrength: 'negligible',
    };
  }

  const slope = ssXY / ssXX;
  const intercept = my - slope * mx;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  const rSquared = r * r;

  const absR = Math.abs(r);
  let pValue: number;
  if (absR >= 1) {
    pValue = 0;
  } else {
    const tStat = r * Math.sqrt((n - 2) / (1 - rSquared));
    pValue = 2 * (1 - studentTCDF(Math.abs(tStat), n - 2));
  }

  const trendDirection: LinearTrend['trendDirection'] =
    absR < 0.1 ? 'flat' : slope > 0 ? 'increasing' : 'decreasing';

  let trendStrength: LinearTrend['trendStrength'];
  if (absR < 0.1) trendStrength = 'negligible';
  else if (absR < 0.3) trendStrength = 'weak';
  else if (absR < 0.5) trendStrength = 'moderate';
  else trendStrength = 'strong';

  return { slope, intercept, r, rSquared, pValue, trendDirection, trendStrength };
}

// ---------------------------------------------------------------------------
// 4. LOESS (Local Weighted Polynomial Regression)
// ---------------------------------------------------------------------------

/**
 * LOESS smoother with tricube kernel.
 *
 * For each evaluation point, fits a local weighted least-squares polynomial
 * (degree 0 or 1) using the nearest `span` fraction of data points, with
 * tricube distance weighting.
 *
 * @param x - Predictor values
 * @param y - Response values (parallel to x)
 * @param span - Fraction of data to use in each local fit (default 0.5)
 * @param degree - Polynomial degree: 0 (constant) or 1 (linear). Default 1.
 * @param evaluationPoints - x values at which to evaluate. Default: 60 evenly spaced.
 */
export function loess(
  x: number[],
  y: number[],
  span: number = 0.5,
  degree: number = 1,
  evaluationPoints?: number[],
): LoessResult {
  const pairsX: number[] = [];
  const pairsY: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const xi = x[i];
    const yi = y[i];
    if (xi !== undefined && yi !== undefined && Number.isFinite(xi) && Number.isFinite(yi)) {
      pairsX.push(xi);
      pairsY.push(yi);
    }
  }

  const n = pairsX.length;
  if (n === 0) {
    return { x: [], y: [], residuals: [] };
  }

  if (n === 1) {
    const singleX = at(pairsX, 0);
    const singleY = at(pairsY, 0);
    const evalPts = evaluationPoints ?? [singleX];
    return {
      x: evalPts,
      y: evalPts.map(() => singleY),
      residuals: [0],
    };
  }

  const k = Math.max(2, Math.ceil(span * n));

  const xMin = Math.min(...pairsX);
  const xMax = Math.max(...pairsX);

  let evalPts: number[];
  if (evaluationPoints) {
    evalPts = evaluationPoints;
  } else {
    const numEval = Math.min(60, n);
    evalPts = [];
    if (numEval === 1) {
      evalPts.push(xMin);
    } else {
      for (let i = 0; i < numEval; i++) {
        evalPts.push(xMin + (i / (numEval - 1)) * (xMax - xMin));
      }
    }
  }

  const yHat: number[] = [];

  for (const xEval of evalPts) {
    const dists: Array<{ idx: number; dist: number }> = [];
    for (let i = 0; i < n; i++) {
      dists.push({ idx: i, dist: Math.abs(at(pairsX, i) - xEval) });
    }
    dists.sort((a, b) => a.dist - b.dist);
    const neighbors = dists.slice(0, k);
    const lastNeighbor = neighbors[neighbors.length - 1];
    const maxDist = lastNeighbor !== undefined ? lastNeighbor.dist : 0;

    const weights: number[] = [];
    const neighborX: number[] = [];
    const neighborY: number[] = [];

    for (const nb of neighbors) {
      const u = maxDist === 0 ? 0 : nb.dist / maxDist;
      weights.push(tricube(u));
      neighborX.push(at(pairsX, nb.idx));
      neighborY.push(at(pairsY, nb.idx));
    }

    if (degree === 0 || k < 2) {
      let sumW = 0;
      let sumWY = 0;
      for (let i = 0; i < weights.length; i++) {
        const w = at(weights, i);
        sumW += w;
        sumWY += w * at(neighborY, i);
      }
      yHat.push(sumW > 0 ? sumWY / sumW : NaN);
    } else {
      let sw = 0;
      let swx = 0;
      let swy = 0;
      let swxx = 0;
      let swxy = 0;

      for (let i = 0; i < weights.length; i++) {
        const w = at(weights, i);
        const dx = at(neighborX, i) - xEval;
        const yi = at(neighborY, i);
        sw += w;
        swx += w * dx;
        swy += w * yi;
        swxx += w * dx * dx;
        swxy += w * dx * yi;
      }

      const det = sw * swxx - swx * swx;
      if (Math.abs(det) < 1e-15) {
        yHat.push(sw > 0 ? swy / sw : NaN);
      } else {
        const a = (swxx * swy - swx * swxy) / det;
        yHat.push(a);
      }
    }
  }

  const residuals = computeLoessResiduals(pairsX, pairsY, evalPts, yHat);

  return { x: evalPts, y: yHat, residuals };
}

/**
 * Compute residuals for LOESS: original y minus interpolated ŷ.
 * Uses linear interpolation between evaluation points.
 */
function computeLoessResiduals(
  origX: number[],
  origY: number[],
  evalX: number[],
  evalY: number[],
): number[] {
  const residuals: number[] = [];

  for (let i = 0; i < origX.length; i++) {
    const xi = at(origX, i);
    const yi = at(origY, i);

    let yInterp: number;
    if (evalX.length === 1) {
      yInterp = at(evalY, 0);
    } else {
      let lo = 0;
      let hi = evalX.length - 1;
      if (xi <= at(evalX, lo)) {
        yInterp = at(evalY, lo);
      } else if (xi >= at(evalX, hi)) {
        yInterp = at(evalY, hi);
      } else {
        while (hi - lo > 1) {
          const mid = (lo + hi) >>> 1;
          if (at(evalX, mid) <= xi) lo = mid;
          else hi = mid;
        }
        const exLo = at(evalX, lo);
        const exHi = at(evalX, hi);
        const eyLo = at(evalY, lo);
        const eyHi = at(evalY, hi);
        const t = exHi !== exLo ? (xi - exLo) / (exHi - exLo) : 0;
        yInterp = eyLo + t * (eyHi - eyLo);
      }
    }
    residuals.push(yi - yInterp);
  }

  return residuals;
}

// ---------------------------------------------------------------------------
// 5. Change-Point Detection (PELT)
// ---------------------------------------------------------------------------

/**
 * Detect change points using the PELT algorithm with L2 cost.
 *
 * The Pruned Exact Linear Time (PELT) algorithm finds the optimal
 * segmentation by minimising Σ C(segment) + β · (number of change points),
 * where C is the sum-of-squared-errors cost and β is the penalty.
 *
 * Reference: Killick, Fearnhead & Eckley (2012).
 *
 * @param values - Numeric time series
 * @param dates - ISO date strings (parallel to values)
 * @param penalty - Penalty per change point (default 10)
 */
export function detectChangePoints(
  values: number[],
  dates: string[],
  penalty: number = 10,
): ChangePointResult {
  const emptyResult: ChangePointResult = { changePoints: [], segments: [] };
  if (values.length === 0) return emptyResult;

  const n = values.length;
  const data: number[] = values.map((v) => (Number.isFinite(v) ? v : 0));

  // Prefix sums for O(1) cost computation
  const cumSum: number[] = [0];
  const cumSumSq: number[] = [0];
  for (let i = 0; i < n; i++) {
    const di = at(data, i);
    cumSum.push(at(cumSum, i) + di);
    cumSumSq.push(at(cumSumSq, i) + di * di);
  }

  /**
   * L2 cost for segment [s, e): sum of squared deviations from mean.
   */
  function cost(s: number, e: number): number {
    const len = e - s;
    if (len <= 0) return 0;
    const sumX = at(cumSum, e) - at(cumSum, s);
    const sumX2 = at(cumSumSq, e) - at(cumSumSq, s);
    return sumX2 - (sumX * sumX) / len;
  }

  // PELT dynamic programming
  const F: number[] = [-penalty];
  const lastChange: number[] = [0];

  let candidates = [0];

  for (let tStar = 1; tStar <= n; tStar++) {
    let bestCost = Infinity;
    let bestTau = 0;

    const nextCandidates: number[] = [];

    for (const tau of candidates) {
      const candidateCost = at(F, tau) + cost(tau, tStar) + penalty;
      if (candidateCost < bestCost) {
        bestCost = candidateCost;
        bestTau = tau;
      }
      if (at(F, tau) + cost(tau, tStar) <= bestCost) {
        nextCandidates.push(tau);
      }
    }

    F.push(bestCost);
    lastChange.push(bestTau);
    nextCandidates.push(tStar);
    candidates = nextCandidates;
  }

  // Backtrack to find change points
  const cps: number[] = [];
  let idx = n;
  while (idx > 0) {
    const cp = at(lastChange, idx);
    if (cp > 0) {
      cps.push(cp);
    }
    idx = cp;
  }
  cps.reverse();

  // Build segments and change points
  const changePoints: ChangePoint[] = [];
  const segments: Segment[] = [];

  const boundaries = [0, ...cps, n];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const s = at(boundaries, i);
    const e = at(boundaries, i + 1);
    const segData = filterFinite(data.slice(s, e));
    const segN = segData.length;
    const segMean = segN > 0 ? mean(segData) : NaN;
    const segVar = segN >= 2 ? sampleVariance(segData) : 0;

    segments.push({
      start: s,
      end: e - 1,
      mean: segMean,
      variance: segVar,
      n: segN,
    });
  }

  for (const cp of cps) {
    const leftSeg = filterFinite(data.slice(Math.max(0, cp - 10), cp));
    const rightSeg = filterFinite(data.slice(cp, Math.min(n, cp + 10)));
    const leftMean = mean(leftSeg);
    const rightMean = mean(rightSeg);
    const significance = Math.abs(rightMean - leftMean);

    changePoints.push({
      index: cp,
      date: strAt(dates, cp),
      significance,
    });
  }

  return { changePoints, segments };
}

// ---------------------------------------------------------------------------
// 6. STL Decomposition (Simplified)
// ---------------------------------------------------------------------------

/**
 * Simplified STL (Seasonal and Trend decomposition using Loess).
 *
 * Approach:
 * 1. Extract trend via centered moving average of `period` width.
 * 2. Detrend: compute seasonal as day-of-period averages.
 * 3. Remainder = original - trend - seasonal.
 * 4. If robust, iteratively re-weight using bisquare weights on remainder.
 *
 * @param dates - ISO date strings
 * @param values - Numeric observations
 * @param period - Seasonal period in observations (default 7 for weekly)
 * @param robust - Use iterative re-weighting for outlier resistance (default true)
 */
export function stlDecomposition(
  dates: string[],
  values: number[],
  period: number = 7,
  robust: boolean = true,
): STLResult {
  const n = values.length;
  const emptyResult: STLResult = { trend: [], seasonal: [], remainder: [], dates: [] };
  if (n === 0) return emptyResult;

  const data = values.map((v) => (Number.isFinite(v) ? v : NaN));

  let weights: number[] = new Array<number>(n).fill(1);

  const iterations = robust ? 3 : 1;
  let trend: number[] = new Array<number>(n).fill(0);
  let seasonal: number[] = new Array<number>(n).fill(0);
  let remainder: number[] = new Array<number>(n).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    // Step 1: Weighted centered moving average for trend
    trend = centeredMovingAverage(data, period, weights);

    // Step 2: Detrend
    const detrended = data.map((v, i) => {
      const t = trend[i];
      if (t === undefined || !Number.isFinite(v) || !Number.isFinite(t)) return NaN;
      return v - t;
    });

    // Step 3: Seasonal component — average detrended values by position in period
    const seasonalPattern: number[] = new Array<number>(period).fill(0);
    const seasonalCounts: number[] = new Array<number>(period).fill(0);

    for (let i = 0; i < n; i++) {
      const d = detrended[i];
      const w = weights[i];
      if (d !== undefined && w !== undefined && Number.isFinite(d)) {
        const pos = i % period;
        seasonalPattern[pos] = at(seasonalPattern, pos) + d * w;
        seasonalCounts[pos] = at(seasonalCounts, pos) + w;
      }
    }

    // Normalise seasonal pattern
    for (let p = 0; p < period; p++) {
      const cnt = at(seasonalCounts, p);
      if (cnt > 0) {
        seasonalPattern[p] = at(seasonalPattern, p) / cnt;
      } else {
        seasonalPattern[p] = 0;
      }
    }

    // Center the seasonal pattern (subtract its mean so it sums to ~0)
    let patternSum = 0;
    for (let p = 0; p < period; p++) patternSum += at(seasonalPattern, p);
    const patternMean = patternSum / period;
    for (let p = 0; p < period; p++) seasonalPattern[p] = at(seasonalPattern, p) - patternMean;

    // Assign seasonal values
    seasonal = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      seasonal[i] = at(seasonalPattern, i % period);
    }

    // Step 4: Remainder
    remainder = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const v = data[i];
      const t = trend[i];
      const s = seasonal[i];
      if (
        v !== undefined &&
        t !== undefined &&
        s !== undefined &&
        Number.isFinite(v) &&
        Number.isFinite(t) &&
        Number.isFinite(s)
      ) {
        remainder[i] = v - t - s;
      } else {
        remainder[i] = NaN;
      }
    }

    // Step 5: Update robustness weights (bisquare on |remainder| / 6·MAD)
    if (robust && iter < iterations - 1) {
      const finiteResiduals = filterFinite(remainder);
      if (finiteResiduals.length > 0) {
        const absResiduals = finiteResiduals.map(Math.abs);
        sortAsc(absResiduals);
        const mad = medianSorted(absResiduals);
        const h = 6 * mad;

        weights = new Array<number>(n).fill(0);
        for (let i = 0; i < n; i++) {
          const r = remainder[i];
          if (r !== undefined && Number.isFinite(r) && h > 0) {
            weights[i] = bisquare(r / h);
          } else {
            weights[i] = 1;
          }
        }
      }
    }
  }

  return {
    trend: trend.slice(),
    seasonal: seasonal.slice(),
    remainder: remainder.slice(),
    dates: dates.slice(),
  };
}

/**
 * Weighted centered moving average.
 * For each position i, averages values in [i - half, i + half] using weights.
 */
function centeredMovingAverage(
  data: (number | undefined)[],
  period: number,
  weights: number[],
): number[] {
  const n = data.length;
  const result: number[] = new Array<number>(n).fill(0);
  const half = Math.floor(period / 2);

  for (let i = 0; i < n; i++) {
    let sumW = 0;
    let sumWX = 0;

    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= n) continue;
      const v = data[j];
      const w = weights[j];
      if (v !== undefined && w !== undefined && Number.isFinite(v)) {
        sumW += w;
        sumWX += w * v;
      }
    }

    result[i] = sumW > 0 ? sumWX / sumW : NaN;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 7. Autocorrelation Function (ACF)
// ---------------------------------------------------------------------------

/**
 * Compute the autocorrelation function.
 *
 * Uses the standard estimator:
 *   r_k = Σ_{t=1}^{n-k} (x_t - x̄)(x_{t+k} - x̄) / Σ_{t=1}^{n} (x_t - x̄)²
 *
 * The denominator uses the full-series variance (no Bessel correction)
 * to ensure r_0 = 1.
 *
 * @param values - Numeric time series
 * @param maxLag - Maximum lag to compute (default min(30, n/2))
 */
export function acf(values: number[], maxLag?: number): ACFResult {
  const clean = filterFinite(values);
  const n = clean.length;

  if (n < 2) {
    return { lags: [], acf: [], significanceBound: NaN };
  }

  const effectiveMaxLag = maxLag ?? Math.min(30, Math.floor(n / 2));
  const m = mean(clean);

  let denom = 0;
  for (const v of clean) {
    const d = v - m;
    denom += d * d;
  }

  if (denom === 0) {
    const lags: number[] = [];
    const acfVals: number[] = [];
    for (let k = 0; k <= effectiveMaxLag; k++) {
      lags.push(k);
      acfVals.push(k === 0 ? 1 : 0);
    }
    return { lags, acf: acfVals, significanceBound: 1.96 / Math.sqrt(n) };
  }

  const lags: number[] = [];
  const acfVals: number[] = [];

  for (let k = 0; k <= effectiveMaxLag; k++) {
    let num = 0;
    for (let t = 0; t < n - k; t++) {
      num += (at(clean, t) - m) * (at(clean, t + k) - m);
    }
    lags.push(k);
    acfVals.push(num / denom);
  }

  return {
    lags,
    acf: acfVals,
    significanceBound: 1.96 / Math.sqrt(n),
  };
}

// ---------------------------------------------------------------------------
// 8. Partial Autocorrelation Function (PACF)
// ---------------------------------------------------------------------------

/**
 * Compute the partial autocorrelation function via Durbin-Levinson recursion.
 *
 * The Durbin-Levinson algorithm iteratively solves the Yule-Walker
 * equations, extracting PACF coefficients at each order.
 *
 * @param values - Numeric time series
 * @param maxLag - Maximum lag to compute (default min(30, n/2))
 */
export function pacf(values: number[], maxLag?: number): PACFResult {
  const acfResult = acf(values, maxLag);
  const n = filterFinite(values).length;

  if (n < 2 || acfResult.acf.length < 2) {
    return { lags: [], pacf: [], significanceBound: NaN };
  }

  const maxK = acfResult.acf.length - 1;
  const lags: number[] = [];
  const pacfVals: number[] = [];
  const r = acfResult.acf;

  let prevPhi: number[] = [];

  for (let k = 1; k <= maxK; k++) {
    lags.push(k);

    if (k === 1) {
      const phi11 = at(r, 1);
      pacfVals.push(phi11);
      prevPhi = [phi11];
      continue;
    }

    // Compute φ_{k,k}
    let num = at(r, k);
    for (let j = 0; j < prevPhi.length; j++) {
      num -= at(prevPhi, j) * at(r, k - 1 - j);
    }

    let den = 1;
    for (let j = 0; j < prevPhi.length; j++) {
      den -= at(prevPhi, j) * at(r, j + 1);
    }

    const phiKK = Math.abs(den) < 1e-15 ? 0 : num / den;
    pacfVals.push(phiKK);

    // Update φ coefficients
    const newPhi: number[] = [];
    for (let j = 0; j < prevPhi.length; j++) {
      newPhi.push(at(prevPhi, j) - phiKK * at(prevPhi, prevPhi.length - 1 - j));
    }
    newPhi.push(phiKK);
    prevPhi = newPhi;
  }

  return {
    lags,
    pacf: pacfVals,
    significanceBound: 1.96 / Math.sqrt(n),
  };
}
