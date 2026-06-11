/**
 * Granger Causality Analysis
 *
 * Tests whether one time series "Granger-causes" another by checking
 * if lagged values of X improve the prediction of Y beyond what
 * lagged values of Y alone can achieve (and vice-versa).
 *
 * **Algorithm** (Vector Autoregression F-test):
 * 1. For each candidate lag p (1 … maxLag), fit:
 *    - **Restricted** AR model: y_t = Σ α_i y_{t-i} + ε
 *    - **Unrestricted** VAR model: y_t = Σ α_i y_{t-i} + Σ β_i x_{t-i} + ε
 * 2. Choose the lag at which to report the F-test: either a caller-supplied
 *    fixed `lag` (clean inference) or the AIC-minimising lag.
 * 3. Compute the F-statistic comparing restricted vs. unrestricted RSS.
 * 4. Derive a p-value from the F-distribution using the regularized
 *    incomplete beta function.
 * 5. Test both X→Y and Y→X directions; classify result.
 *
 * **Post-selection inference caveat.** When the lag is selected by minimising
 * AIC and the F-test is then reported at that *same* lag, the p-value is
 * selection-affected (anti-conservative): the same data both chose and tested
 * the model, so the nominal F p-value understates the true type-I error and
 * causality is declared too readily (Leeb & Pötscher 2005). This module no
 * longer presents such p-values as clean inferential quantities — when the
 * reported lag was AIC-selected, `selectionAffected` is set to `true` and the
 * p-value must be read as exploratory. To obtain a clean p-value, pass a fixed
 * `lag` (e.g. chosen on a separate training portion).
 *
 * **Stationarity.** The VAR F-test assumes (trend-)stationary inputs. CPAP
 * nightly series frequently trend (e.g. acclimatisation, seasonal leak), and a
 * deterministic trend shared by two independent series produces spurious
 * Granger causality (Granger & Newbold 1974). A lightweight trend test is run
 * on each input; if a significant linear trend is detected, the result carries
 * a `stationarityWarning` and the caller should consider first-differencing.
 *
 * @see Granger, C. W. J. (1969). Investigating causal relations by
 *      econometric models and cross-spectral methods. *Econometrica*.
 * @see Granger, C. W. J. & Newbold, P. (1974). Spurious regressions in
 *      econometrics. *Journal of Econometrics*.
 * @see Leeb, H. & Pötscher, B. M. (2005). Model selection and inference:
 *      facts and fiction. *Econometric Theory*.
 *
 * @module analysis/correlation/granger
 */

import { Matrix, solve } from 'ml-matrix';
import { regularizedIncompleteBeta, twoTailedPValue } from '@/analysis/math';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a bi-directional Granger causality test. */
export interface GrangerCausalityResult {
  /** F-statistic for the X→Y direction at the reported lag. */
  readonly fStatistic: number;
  /** p-value for the X→Y direction at the reported lag. */
  readonly pValue: number;
  /**
   * Lag at which the test is reported. Equals the caller-supplied fixed lag
   * when one was given, otherwise the AIC-minimising lag.
   */
  readonly optimalLag: number;
  /** Directional causality classification. */
  readonly causality: 'X causes Y' | 'Y causes X' | 'bidirectional' | 'none';
  /** Confidence based on the more-significant direction's p-value. */
  readonly confidenceLevel: 'high' | 'moderate' | 'low';
  /** AIC values for the unrestricted X→Y model at each candidate lag. */
  readonly aicValues: readonly number[];
  /**
   * `true` when the reported lag was chosen by minimising AIC on the same data
   * used for the F-test. In that case the p-value is selection-affected
   * (anti-conservative) and should be treated as **exploratory**, not as a
   * clean inferential p-value. `false` when a fixed `lag` was supplied.
   */
  readonly selectionAffected: boolean;
  /**
   * Non-null when at least one input series shows a statistically significant
   * linear trend (non-stationarity). The VAR F-test assumes stationarity;
   * trending inputs can yield spurious Granger causality. The message names the
   * affected series; callers should consider first-differencing.
   */
  readonly stationarityWarning: string | null;
}

/** Options for {@link grangerCausality}. */
export interface GrangerCausalityOptions {
  /**
   * Fixed lag at which to report the F-test, separating lag SELECTION from
   * TESTING. When provided (1 ≤ lag ≤ maxLag), the reported p-value is a clean
   * inferential quantity and `selectionAffected` is `false`. When omitted, the
   * lag is AIC-selected and `selectionAffected` is `true`.
   */
  readonly lag?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_LAG = 7;
const SIGNIFICANCE = 0.05;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Remove indices where either series contains a non-finite value,
 * preserving temporal alignment.
 */
function filterFinitePairs(x: number[], y: number[]): { fx: number[]; fy: number[] } {
  const fx: number[] = [];
  const fy: number[] = [];
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const xi = x[i] ?? NaN;
    const yi = y[i] ?? NaN;
    if (Number.isFinite(xi) && Number.isFinite(yi)) {
      fx.push(xi);
      fy.push(yi);
    }
  }
  return { fx, fy };
}

/**
 * Check if all values in an array are identical (zero variance).
 */
function isConstant(arr: number[]): boolean {
  if (arr.length === 0) return true;
  const first = arr[0];
  return arr.every((v) => v === first);
}

/**
 * Build the design matrix (X) and response vector (Y) for fitting the
 * restricted AR model: y_t = Σ α_i y_{t-i}.
 */
function buildRestricted(y: number[], lag: number): { designMatrix: Matrix; response: Matrix } {
  const rows: number[][] = [];
  const resp: number[] = [];

  for (let t = lag; t < y.length; t++) {
    const row: number[] = [];
    for (let j = 1; j <= lag; j++) {
      row.push(y[t - j] ?? 0);
    }
    rows.push(row);
    resp.push(y[t] ?? 0);
  }

  return {
    designMatrix: new Matrix(rows),
    response: Matrix.columnVector(resp),
  };
}

/**
 * Build the design matrix for the unrestricted VAR model:
 * y_t = Σ α_i y_{t-i} + Σ β_i x_{t-i}.
 */
function buildUnrestricted(
  y: number[],
  x: number[],
  lag: number,
): { designMatrix: Matrix; response: Matrix } {
  const rows: number[][] = [];
  const resp: number[] = [];

  for (let t = lag; t < y.length; t++) {
    const row: number[] = [];
    for (let j = 1; j <= lag; j++) {
      row.push(y[t - j] ?? 0);
    }
    for (let j = 1; j <= lag; j++) {
      row.push(x[t - j] ?? 0);
    }
    rows.push(row);
    resp.push(y[t] ?? 0);
  }

  return {
    designMatrix: new Matrix(rows),
    response: Matrix.columnVector(resp),
  };
}

/**
 * Fit OLS via the normal equations: β = (X'X)^{-1} X'Y.
 * Returns the residual sum of squares (RSS).
 */
function fitOLS(X: Matrix, Y: Matrix): number {
  // X'X
  const XtX = X.transpose().mmul(X);
  // X'Y
  const XtY = X.transpose().mmul(Y);

  // Solve for β via QR decomposition for numerical stability
  let beta: Matrix;
  try {
    beta = solve(XtX, XtY);
  } catch {
    // Singular system — return Infinity to signal failure
    return Infinity;
  }

  // Residuals: e = Y - Xβ
  const predicted = X.mmul(beta);
  const residuals = Y.sub(predicted);

  // RSS = Σ e_i²
  let rss = 0;
  for (let i = 0; i < residuals.rows; i++) {
    const r = residuals.get(i, 0);
    rss += r * r;
  }

  return rss;
}

/**
 * Compute p-value from the F distribution with df1 and df2 degrees of
 * freedom using the regularised incomplete beta function.
 *
 *   p = 1 − I_{df2 / (df2 + df1·F)}(df2/2, df1/2)
 */
function fDistPValue(fStat: number, df1: number, df2: number): number {
  if (!Number.isFinite(fStat) || fStat < 0 || df1 < 1 || df2 < 1) return NaN;
  if (fStat === 0) return 1;

  const x = df2 / (df2 + df1 * fStat);
  return regularizedIncompleteBeta(x, df2 / 2, df1 / 2);
}

/**
 * Run a one-directional Granger test: does `x` Granger-cause `y`?
 *
 * Always computes the per-lag AIC values for diagnostics. The lag at which the
 * F-test is reported is `fixedLag` when provided (clean inference), otherwise
 * the AIC-minimising lag (selection-affected inference).
 *
 * Returns the F-statistic, p-value, reported lag, per-lag AIC values, and a
 * `selectionAffected` flag.
 */
function grangerOneDirection(
  x: number[],
  y: number[],
  maxLag: number,
  fixedLag?: number,
): {
  fStatistic: number;
  pValue: number;
  optimalLag: number;
  aicValues: number[];
  selectionAffected: boolean;
} {
  const n = y.length;
  const aicValues: number[] = [];
  let bestLag = 1;
  let bestAic = Infinity;

  // Evaluate each candidate lag (always, for AIC diagnostics)
  for (let p = 1; p <= maxLag; p++) {
    const nEff = n - p; // effective sample size
    if (nEff <= 2 * p + 1) {
      aicValues.push(NaN);
      continue;
    }

    const { designMatrix: Xu, response: Yu } = buildUnrestricted(y, x, p);
    const rssU = fitOLS(Xu, Yu);

    // AIC = n_eff × ln(RSS / n_eff) + 2 × (2p + 1)
    const aic =
      Number.isFinite(rssU) && rssU > 0 ? nEff * Math.log(rssU / nEff) + 2 * (2 * p + 1) : Infinity;

    aicValues.push(aic);

    if (aic < bestAic) {
      bestAic = aic;
      bestLag = p;
    }
  }

  // Separate SELECTION from TESTING: use the caller's fixed lag when valid,
  // otherwise the AIC-selected lag (and flag the resulting p-value).
  const useFixed =
    typeof fixedLag === 'number' &&
    Number.isInteger(fixedLag) &&
    fixedLag >= 1 &&
    fixedLag <= maxLag;
  const testLag = useFixed ? (fixedLag as number) : bestLag;
  const selectionAffected = !useFixed;

  const nEff = n - testLag;
  const { designMatrix: Xr, response: Yr } = buildRestricted(y, testLag);
  const { designMatrix: Xu, response: Yu } = buildUnrestricted(y, x, testLag);

  const rssR = fitOLS(Xr, Yr);
  const rssU = fitOLS(Xu, Yu);

  const df1 = testLag;
  const df2 = nEff - 2 * testLag - 1;

  if (df2 <= 0 || !Number.isFinite(rssR) || !Number.isFinite(rssU) || rssU <= 0) {
    return { fStatistic: NaN, pValue: NaN, optimalLag: testLag, aicValues, selectionAffected };
  }

  const fStat = (rssR - rssU) / df1 / (rssU / df2);
  const pValue = fDistPValue(fStat, df1, df2);

  return { fStatistic: fStat, pValue, optimalLag: testLag, aicValues, selectionAffected };
}

/**
 * Lightweight stationarity guard: test for a significant deterministic linear
 * trend via OLS regression of the series on time (t = 0…n−1), using a
 * two-tailed t-test on the slope at α = 0.05.
 *
 * This is a deliberately simple, fast check — not a full unit-root/ADF test —
 * intended to flag the most common CPAP non-stationarity (a drifting mean). A
 * significant slope ⇒ trend-non-stationary ⇒ warn.
 *
 * @returns `true` when a significant linear trend is detected.
 */
function hasSignificantTrend(series: number[]): boolean {
  const n = series.length;
  if (n < 4) return false;

  let sumT = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumT += i;
    sumY += series[i] ?? 0;
  }
  const meanT = sumT / n;
  const meanY = sumY / n;

  let sTT = 0;
  let sTY = 0;
  for (let i = 0; i < n; i++) {
    const dt = i - meanT;
    sTT += dt * dt;
    sTY += dt * ((series[i] ?? 0) - meanY);
  }
  if (sTT === 0) return false;

  const slope = sTY / sTT;
  const intercept = meanY - slope * meanT;

  // Residual sum of squares and slope standard error.
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const resid = (series[i] ?? 0) - (intercept + slope * i);
    rss += resid * resid;
  }
  const df = n - 2;
  if (df <= 0) return false;
  const sigma2 = rss / df;
  if (sigma2 <= 0) {
    // Perfect linear fit ⇒ a (deterministic) trend, unless the slope is ~0.
    return Math.abs(slope) > 0;
  }
  const seSlope = Math.sqrt(sigma2 / sTT);
  if (seSlope === 0) return Math.abs(slope) > 0;

  const tStat = slope / seSlope;
  const p = twoTailedPValue(tStat, df);
  return Number.isFinite(p) && p < SIGNIFICANCE;
}

/**
 * Determine confidence level from a p-value.
 */
function confidenceFromP(p: number): 'high' | 'moderate' | 'low' {
  if (!Number.isFinite(p)) return 'low';
  if (p < 0.01) return 'high';
  if (p < 0.05) return 'moderate';
  return 'low';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bi-directional Granger causality test between two time series.
 *
 * Tests whether lagged values of X improve prediction of Y (and vice-versa)
 * beyond lagged Y alone, using an F-test on restricted vs. unrestricted
 * vector autoregression models.
 *
 * @param x       First time series (aligned by index with `y`).
 * @param y       Second time series.
 * @param maxLag  Maximum number of lags to evaluate (default 7).
 * @param options Optional settings; pass `{ lag }` to report a clean,
 *                non-selection-affected F-test at a fixed lag.
 * @returns       Test statistics, reported lag, directional classification,
 *                confidence level, a `selectionAffected` flag, and a
 *                `stationarityWarning`.
 *
 * @remarks
 * **Assumptions**:
 * - Both series are stationary or trend-stationary. A significant linear trend
 *   sets `stationarityWarning` (see {@link GrangerCausalityResult}).
 * - Observations are equally spaced in time.
 * - The relationship, if any, is linear.
 *
 * **Inference honesty**: when `options.lag` is omitted the reported lag is
 * AIC-selected and `selectionAffected` is `true` — read the p-value as
 * exploratory. Supply `options.lag` (e.g. selected on a training split) for a
 * clean p-value.
 *
 * **Edge cases**:
 * - Fewer than `2 × maxLag + 2` observations → returns NaN values
 *   with `causality = 'none'`.
 * - Constant series → returns NaN values with `causality = 'none'`.
 *
 * @example
 * ```ts
 * // Exploratory (AIC-selected lag): result.selectionAffected === true
 * const explor = grangerCausality(leakRates, ahiDaily, 5);
 *
 * // Confirmatory (fixed lag): result.selectionAffected === false
 * const conf = grangerCausality(leakRates, ahiDaily, 5, { lag: 2 });
 * ```
 */
export function grangerCausality(
  x: number[],
  y: number[],
  maxLag: number = DEFAULT_MAX_LAG,
  options: GrangerCausalityOptions = {},
): GrangerCausalityResult {
  const { lag } = options;

  // Pairwise finite filter
  const { fx, fy } = filterFinitePairs(x, y);
  const n = fx.length;

  const nanResult: GrangerCausalityResult = {
    fStatistic: NaN,
    pValue: NaN,
    optimalLag: lag ?? maxLag,
    causality: 'none',
    confidenceLevel: 'low',
    aicValues: [],
    selectionAffected: lag === undefined,
    stationarityWarning: null,
  };

  // Guard: insufficient data
  if (n < 2 * maxLag + 2) {
    return nanResult;
  }

  // Guard: constant series
  if (isConstant(fx) || isConstant(fy)) {
    return nanResult;
  }

  // Stationarity guard: flag deterministic trends that can induce spurious
  // Granger causality.
  const xTrending = hasSignificantTrend(fx);
  const yTrending = hasSignificantTrend(fy);
  let stationarityWarning: string | null = null;
  if (xTrending && yTrending) {
    stationarityWarning =
      'Both series show a significant linear trend (non-stationary); Granger results may be spurious. Consider first-differencing the inputs.';
  } else if (xTrending) {
    stationarityWarning =
      'Series X shows a significant linear trend (non-stationary); Granger results may be spurious. Consider first-differencing X.';
  } else if (yTrending) {
    stationarityWarning =
      'Series Y shows a significant linear trend (non-stationary); Granger results may be spurious. Consider first-differencing Y.';
  }

  // Test both directions
  const xy = grangerOneDirection(fx, fy, maxLag, lag);
  const yx = grangerOneDirection(fy, fx, maxLag, lag);

  const xyCausal = Number.isFinite(xy.pValue) && xy.pValue < SIGNIFICANCE;
  const yxCausal = Number.isFinite(yx.pValue) && yx.pValue < SIGNIFICANCE;

  let causality: GrangerCausalityResult['causality'];
  if (xyCausal && yxCausal) {
    causality = 'bidirectional';
  } else if (xyCausal) {
    causality = 'X causes Y';
  } else if (yxCausal) {
    causality = 'Y causes X';
  } else {
    causality = 'none';
  }

  // Confidence is based on the more-significant direction's p-value
  const minP = Math.min(
    Number.isFinite(xy.pValue) ? xy.pValue : 1,
    Number.isFinite(yx.pValue) ? yx.pValue : 1,
  );

  return {
    fStatistic: xy.fStatistic,
    pValue: xy.pValue,
    optimalLag: xy.optimalLag,
    causality,
    confidenceLevel: confidenceFromP(minP),
    aicValues: xy.aicValues,
    selectionAffected: xy.selectionAffected || yx.selectionAffected,
    stationarityWarning,
  };
}
