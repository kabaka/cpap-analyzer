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
 * 2. Select optimal lag via AIC on the unrestricted model.
 * 3. Compute the F-statistic comparing restricted vs. unrestricted RSS.
 * 4. Derive a p-value from the F-distribution using the regularized
 *    incomplete beta function.
 * 5. Test both X→Y and Y→X directions; classify result.
 *
 * @see Granger, C. W. J. (1969). Investigating causal relations by
 *      econometric models and cross-spectral methods. *Econometrica*.
 *
 * @module analysis/correlation/granger
 */

import { Matrix, solve } from 'ml-matrix';
import { regularizedIncompleteBeta } from '@/analysis/math';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a bi-directional Granger causality test. */
export interface GrangerCausalityResult {
  /** F-statistic for the X→Y direction at optimal lag. */
  readonly fStatistic: number;
  /** p-value for the X→Y direction at optimal lag. */
  readonly pValue: number;
  /** Lag selected by minimum AIC (unrestricted model). */
  readonly optimalLag: number;
  /** Directional causality classification. */
  readonly causality: 'X causes Y' | 'Y causes X' | 'bidirectional' | 'none';
  /** Confidence based on the more-significant direction's p-value. */
  readonly confidenceLevel: 'high' | 'moderate' | 'low';
  /** AIC values for the unrestricted X→Y model at each candidate lag. */
  readonly aicValues: readonly number[];
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
 * Returns the F-statistic, p-value, optimal lag, and per-lag AIC values.
 */
function grangerOneDirection(
  x: number[],
  y: number[],
  maxLag: number,
): { fStatistic: number; pValue: number; optimalLag: number; aicValues: number[] } {
  const n = y.length;
  const aicValues: number[] = [];
  let bestLag = 1;
  let bestAic = Infinity;

  // Evaluate each candidate lag
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

  // Compute F-test at optimal lag
  const nEff = n - bestLag;
  const { designMatrix: Xr, response: Yr } = buildRestricted(y, bestLag);
  const { designMatrix: Xu, response: Yu } = buildUnrestricted(y, x, bestLag);

  const rssR = fitOLS(Xr, Yr);
  const rssU = fitOLS(Xu, Yu);

  const df1 = bestLag;
  const df2 = nEff - 2 * bestLag - 1;

  if (df2 <= 0 || !Number.isFinite(rssR) || !Number.isFinite(rssU) || rssU <= 0) {
    return { fStatistic: NaN, pValue: NaN, optimalLag: bestLag, aicValues };
  }

  const fStat = (rssR - rssU) / df1 / (rssU / df2);
  const pValue = fDistPValue(fStat, df1, df2);

  return { fStatistic: fStat, pValue, optimalLag: bestLag, aicValues };
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
 * @returns       Test statistics, optimal lag, directional classification,
 *                and confidence level.
 *
 * @remarks
 * **Assumptions**:
 * - Both series are stationary or trend-stationary.
 * - Observations are equally spaced in time.
 * - The relationship, if any, is linear.
 *
 * **Edge cases**:
 * - Fewer than `2 × maxLag + 2` observations → returns NaN values
 *   with `causality = 'none'`.
 * - Constant series → returns NaN values with `causality = 'none'`.
 *
 * @example
 * ```ts
 * const result = grangerCausality(leakRates, ahiDaily, 5);
 * if (result.causality === 'X causes Y') {
 *   console.log(`Leak → AHI (F=${result.fStatistic.toFixed(2)}, p=${result.pValue.toFixed(4)})`);
 * }
 * ```
 */
export function grangerCausality(
  x: number[],
  y: number[],
  maxLag: number = DEFAULT_MAX_LAG,
): GrangerCausalityResult {
  // Pairwise finite filter
  const { fx, fy } = filterFinitePairs(x, y);
  const n = fx.length;

  const nanResult: GrangerCausalityResult = {
    fStatistic: NaN,
    pValue: NaN,
    optimalLag: maxLag,
    causality: 'none',
    confidenceLevel: 'low',
    aicValues: [],
  };

  // Guard: insufficient data
  if (n < 2 * maxLag + 2) {
    return nanResult;
  }

  // Guard: constant series
  if (isConstant(fx) || isConstant(fy)) {
    return nanResult;
  }

  // Test both directions
  const xy = grangerOneDirection(fx, fy, maxLag);
  const yx = grangerOneDirection(fy, fx, maxLag);

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
  };
}
