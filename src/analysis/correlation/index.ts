/**
 * Correlation Analysis Module
 *
 * Provides Pearson and Spearman correlation, correlation matrices,
 * partial correlation (controlling for confounders), and cross-correlation
 * with lag analysis for CPAP therapy time-series data.
 *
 * Key implementation notes:
 * - Pairwise deletion: paired observations where either value is
 *   NaN/Infinity are dropped before computation
 * - P-values via Student's t with n-2 degrees of freedom
 * - Confidence intervals via Fisher's z-transformation
 * - Spearman uses average-rank for ties, then Pearson on ranks
 * - Cross-correlation normalises by lag-specific overlap length
 * - Partial correlation uses recursive first-order formula
 */

export * from './granger';

import { twoTailedPValue } from '../math';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrelationResult {
  readonly r: number;
  readonly rSquared: number;
  readonly n: number;
  readonly tStatistic: number;
  readonly pValue: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
  readonly strength: 'negligible' | 'weak' | 'moderate' | 'strong' | 'very strong';
  readonly direction: 'positive' | 'negative' | 'none';
}

export interface CorrelationMatrix {
  readonly labels: readonly string[];
  readonly matrix: readonly (readonly number[])[]; // r values
  readonly pValues: readonly (readonly number[])[]; // p-values
  readonly n: number; // sample size
}

export interface PartialCorrelationResult {
  readonly r: number;
  readonly n: number;
  readonly pValue: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
}

export interface CrossCorrelationResult {
  readonly lags: readonly number[];
  readonly ccf: readonly number[];
  readonly significanceBound: number;
  readonly bestLag: number;
  readonly bestCCF: number;
}

// ---------------------------------------------------------------------------
// Internal statistical helpers
// ---------------------------------------------------------------------------

/**
 * Pairwise-filter two arrays: keep only indices where both values are finite.
 * Returns the two cleaned arrays of equal length.
 */
function pairwiseFilter(x: readonly number[], y: readonly number[]): [number[], number[]] {
  const n = Math.min(x.length, y.length);
  const xClean: number[] = [];
  const yClean: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (xi !== undefined && yi !== undefined && Number.isFinite(xi) && Number.isFinite(yi)) {
      xClean.push(xi);
      yClean.push(yi);
    }
  }
  return [xClean, yClean];
}

/** Arithmetic mean. Returns NaN for empty arrays. */
function mean(data: readonly number[]): number {
  if (data.length === 0) return NaN;
  let sum = 0;
  for (const v of data) sum += v;
  return sum / data.length;
}

/**
 * Classify the magnitude (absolute value) of a correlation coefficient.
 *
 * Thresholds follow standard conventions:
 *   |r| < 0.1  → negligible
 *   0.1–0.3    → weak
 *   0.3–0.5    → moderate
 *   0.5–0.7    → strong
 *   ≥ 0.7      → very strong
 */
function classifyStrength(
  r: number,
): 'negligible' | 'weak' | 'moderate' | 'strong' | 'very strong' {
  const ar = Math.abs(r);
  if (ar < 0.1) return 'negligible';
  if (ar < 0.3) return 'weak';
  if (ar < 0.5) return 'moderate';
  if (ar < 0.7) return 'strong';
  return 'very strong';
}

/** Classify direction from a correlation coefficient. */
function classifyDirection(r: number): 'positive' | 'negative' | 'none' {
  if (Math.abs(r) < 0.001) return 'none';
  return r > 0 ? 'positive' : 'negative';
}

/**
 * Compute Fisher z-transformation 95 % confidence interval for r.
 * Returns [lower, upper] on the r scale, or [NaN, NaN] if n < 4.
 */
function fisherCI95(r: number, n: number): [number, number] {
  if (n < 4 || !Number.isFinite(r)) return [NaN, NaN];
  const z = 0.5 * Math.log((1 + r) / (1 - r)); // atanh(r)
  const se = 1 / Math.sqrt(n - 3);
  const zCrit = 1.959964; // z for 95 % two-tailed
  const lo = z - zCrit * se;
  const hi = z + zCrit * se;
  // back-transform to r scale: tanh
  return [Math.tanh(lo), Math.tanh(hi)];
}

/**
 * Build an "invalid" CorrelationResult for degenerate inputs.
 */
function nanCorrelationResult(n: number): CorrelationResult {
  return {
    r: NaN,
    rSquared: NaN,
    n,
    tStatistic: NaN,
    pValue: NaN,
    ci95Lower: NaN,
    ci95Upper: NaN,
    strength: 'negligible',
    direction: 'none',
  };
}

/**
 * Assign ranks to values, averaging ties.
 *
 * Algorithm: argsort indices by value, walk through the sorted order,
 * detect runs of identical values, and assign each the average rank
 * within that run.
 */
function rankData(data: readonly number[]): number[] {
  const n = data.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  // Sort indices by the value they point to
  indices.sort((a, b) => {
    const va = data[a] as number;
    const vb = data[b] as number;
    return va - vb;
  });

  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    // Find extent of tie group
    let j = i + 1;
    while (
      j < n &&
      (data[indices[j] as number] as number) === (data[indices[i] as number] as number)
    ) {
      j++;
    }
    // Average rank for the tie group (1-based ranks)
    const avgRank = (i + 1 + j) / 2; // average of (i+1)..(j)
    for (let k = i; k < j; k++) {
      ranks[indices[k] as number] = avgRank;
    }
    i = j;
  }
  return ranks;
}

// ---------------------------------------------------------------------------
// 1. Pearson Correlation
// ---------------------------------------------------------------------------

/**
 * Compute Pearson product-moment correlation coefficient between two
 * numeric arrays, with full inferential statistics.
 *
 * Pairs where either value is NaN or ±Infinity are removed (pairwise
 * deletion). The function is numerically stable: it uses the
 * two-pass formula to avoid catastrophic cancellation.
 *
 * Edge cases:
 * - n < 3 → returns NaN for all statistics
 * - Zero variance in x or y → r = NaN (undefined correlation)
 * - |r| = 1.0 exactly → t = ±Infinity, pValue = 0
 *
 * @param x - First variable
 * @param y - Second variable
 * @returns Full correlation result including CI and effect-size labels
 */
export function pearsonCorrelation(x: number[], y: number[]): CorrelationResult {
  const [xc, yc] = pairwiseFilter(x, y);
  const n = xc.length;

  if (n < 3) return nanCorrelationResult(n);

  const mx = mean(xc);
  const my = mean(yc);

  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (let i = 0; i < n; i++) {
    const dx = (xc[i] as number) - mx;
    const dy = (yc[i] as number) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Zero variance → correlation undefined
  if (sxx === 0 || syy === 0) return nanCorrelationResult(n);

  const r = sxy / Math.sqrt(sxx * syy);
  // Clamp to [-1, 1] to guard against floating-point overshoot
  const rClamped = Math.max(-1, Math.min(1, r));

  const rSquared = rClamped * rClamped;
  const df = n - 2;

  // t-statistic: t = r * sqrt((n-2) / (1 - r²))
  let tStatistic: number;
  let pValue: number;

  if (Math.abs(rClamped) >= 1) {
    // Perfect correlation: t is infinite, p is 0
    tStatistic = rClamped > 0 ? Infinity : -Infinity;
    pValue = 0;
  } else {
    tStatistic = rClamped * Math.sqrt(df / (1 - rClamped * rClamped));
    pValue = twoTailedPValue(tStatistic, df);
  }

  const [ci95Lower, ci95Upper] = fisherCI95(rClamped, n);

  return {
    r: rClamped,
    rSquared,
    n,
    tStatistic,
    pValue,
    ci95Lower,
    ci95Upper,
    strength: classifyStrength(rClamped),
    direction: classifyDirection(rClamped),
  };
}

// ---------------------------------------------------------------------------
// 2. Spearman Rank Correlation
// ---------------------------------------------------------------------------

/**
 * Compute Spearman rank-order correlation.
 *
 * Rank-transforms both arrays (average rank for ties) and then
 * applies Pearson correlation on the ranks. Returns the same
 * output structure as {@link pearsonCorrelation}.
 *
 * @param x - First variable
 * @param y - Second variable
 */
export function spearmanCorrelation(x: number[], y: number[]): CorrelationResult {
  const [xc, yc] = pairwiseFilter(x, y);
  const n = xc.length;

  if (n < 3) return nanCorrelationResult(n);

  const xRanks = rankData(xc);
  const yRanks = rankData(yc);

  return { ...pearsonCorrelation(xRanks, yRanks), n };
}

// ---------------------------------------------------------------------------
// 3. Correlation Matrix
// ---------------------------------------------------------------------------

/**
 * Compute a pairwise correlation matrix for a set of named metrics.
 *
 * @param data    - Record mapping metric names to numeric arrays.
 *                  All arrays should be the same length (aligned observations).
 * @param method  - 'pearson' (default) or 'spearman'
 * @returns Labels, matrix of r values, matrix of p-values, and effective n
 */
export function correlationMatrix(
  data: Record<string, number[]>,
  method: 'pearson' | 'spearman' = 'pearson',
): CorrelationMatrix {
  const labels = Object.keys(data);
  const k = labels.length;
  const corrFn = method === 'spearman' ? spearmanCorrelation : pearsonCorrelation;

  const matrix: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const pValues: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));

  // Track effective sample size as the minimum pairwise n
  let minN = Infinity;

  for (let i = 0; i < k; i++) {
    // diagonal: r = 1, p = 0
    (matrix[i] as number[])[i] = 1;
    (pValues[i] as number[])[i] = 0;

    for (let j = i + 1; j < k; j++) {
      const result = corrFn(
        data[labels[i] as string] as number[],
        data[labels[j] as string] as number[],
      );
      (matrix[i] as number[])[j] = result.r;
      (matrix[j] as number[])[i] = result.r;
      (pValues[i] as number[])[j] = result.pValue;
      (pValues[j] as number[])[i] = result.pValue;
      if (Number.isFinite(result.n) && result.n < minN) {
        minN = result.n;
      }
    }
  }

  return {
    labels,
    matrix,
    pValues,
    n: Number.isFinite(minN) ? minN : 0,
  };
}

// ---------------------------------------------------------------------------
// 4. Partial Correlation
// ---------------------------------------------------------------------------

/**
 * Compute partial correlation between x and y, controlling for one or
 * more confounding variables.
 *
 * Uses the recursive first-order formula:
 *   r_{xy·z} = (r_xy - r_xz · r_yz) / sqrt((1 - r_xz²)(1 - r_yz²))
 *
 * For multiple controls, the formula is applied recursively: the last
 * control is partialled out first, then the residual correlations are
 * passed to the next level.
 *
 * @param x        - First variable
 * @param y        - Second variable
 * @param controls - Array of confounding variable arrays
 */
export function partialCorrelation(
  x: number[],
  y: number[],
  controls: number[][],
): PartialCorrelationResult {
  const k = controls.length;

  // Determine effective n from pairwise-complete observations across
  // x, y, and all controls simultaneously
  const len = Math.min(x.length, y.length, ...controls.map((c) => c.length));
  let n = 0;
  for (let i = 0; i < len; i++) {
    const xi = x[i];
    const yi = y[i];
    if (
      xi !== undefined &&
      yi !== undefined &&
      Number.isFinite(xi) &&
      Number.isFinite(yi) &&
      controls.every((c) => {
        const v = c[i];
        return v !== undefined && Number.isFinite(v);
      })
    ) {
      n++;
    }
  }

  if (k === 0) {
    // No controls — just return Pearson
    const res = pearsonCorrelation(x, y);
    return {
      r: res.r,
      n: res.n,
      pValue: res.pValue,
      ci95Lower: res.ci95Lower,
      ci95Upper: res.ci95Upper,
    };
  }

  // Recursive: partial out the last control
  const lastControl = controls[k - 1] as number[];
  const remainingControls = controls.slice(0, k - 1);

  // Compute the three first-order partial correlations
  const rxyPartial = partialCorrelation(x, y, remainingControls);
  const rxzPartial = partialCorrelation(x, lastControl, remainingControls);
  const ryzPartial = partialCorrelation(y, lastControl, remainingControls);

  const rxy = rxyPartial.r;
  const rxz = rxzPartial.r;
  const ryz = ryzPartial.r;

  // Guard: if any sub-correlation is NaN, propagate
  if (!Number.isFinite(rxy) || !Number.isFinite(rxz) || !Number.isFinite(ryz)) {
    return { r: NaN, n, pValue: NaN, ci95Lower: NaN, ci95Upper: NaN };
  }

  const denom = Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
  if (denom === 0) {
    return { r: NaN, n, pValue: NaN, ci95Lower: NaN, ci95Upper: NaN };
  }

  const rPartial = (rxy - rxz * ryz) / denom;
  // Clamp
  const rClamped = Math.max(-1, Math.min(1, rPartial));

  // df = n - k - 2
  const df = n - k - 2;
  let pValue: number;
  if (df < 1) {
    pValue = NaN;
  } else if (Math.abs(rClamped) >= 1) {
    pValue = 0;
  } else {
    const tStat = rClamped * Math.sqrt(df / (1 - rClamped * rClamped));
    pValue = twoTailedPValue(tStat, df);
  }

  // CI via Fisher z with adjusted effective sample size (n - k)
  const effectiveN = n - k;
  const [ci95Lower, ci95Upper] = fisherCI95(rClamped, effectiveN);

  return {
    r: rClamped,
    n,
    pValue,
    ci95Lower,
    ci95Upper,
  };
}

// ---------------------------------------------------------------------------
// 5. Cross-Correlation
// ---------------------------------------------------------------------------

/**
 * Compute cross-correlation function (CCF) between two time-series.
 *
 * For each integer lag k in [-maxLag, maxLag]:
 *   ccf(k) = Σ (x_{t+max(0,k)} - x̄)(y_{t+max(0,-k)} - ȳ) /
 *            ((n - |k|) · sx · sy)
 *
 * where sx, sy are the (population) standard deviations of the full
 * series and the sum runs over the (n - |k|) overlapping indices.
 *
 * The significance bound at the 95 % level is ±1.96/√n.
 *
 * @param x      - First time-series (ordered, equally spaced)
 * @param y      - Second time-series (same length & spacing as x)
 * @param maxLag - Maximum lag to compute (default 14)
 */
export function crossCorrelation(
  x: number[],
  y: number[],
  maxLag: number = 14,
): CrossCorrelationResult {
  // Pairwise-filter: keep only indices where both x[i] and y[i] are finite
  const [xf, yf] = pairwiseFilter(x, y);
  const n = xf.length;

  if (n < 3 || maxLag < 0) {
    return {
      lags: [],
      ccf: [],
      significanceBound: NaN,
      bestLag: 0,
      bestCCF: 0,
    };
  }

  const xs = xf;
  const ys = yf;

  const mx = mean(xs);
  const my = mean(ys);

  // Population standard deviations of full series
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const sx = Math.sqrt(sxx / n);
  const sy = Math.sqrt(syy / n);

  if (sx === 0 || sy === 0) {
    // No variance — CCF undefined
    const totalLags = 2 * maxLag + 1;
    return {
      lags: Array.from({ length: totalLags }, (_, i) => i - maxLag),
      ccf: new Array<number>(totalLags).fill(NaN),
      significanceBound: NaN,
      bestLag: 0,
      bestCCF: NaN,
    };
  }

  const lags: number[] = [];
  const ccf: number[] = [];
  let bestLag = 0;
  let bestAbsCCF = -1;
  let bestCCFValue = 0;

  const effectiveMaxLag = Math.min(maxLag, n - 1);

  for (let k = -effectiveMaxLag; k <= effectiveMaxLag; k++) {
    lags.push(k);

    const absK = Math.abs(k);
    const overlapN = n - absK;
    let sum = 0;

    // Determine index offsets
    const xStart = Math.max(0, k);
    const yStart = Math.max(0, -k);

    for (let t = 0; t < overlapN; t++) {
      const xi = (xs[xStart + t] as number) - mx;
      const yi = (ys[yStart + t] as number) - my;
      sum += xi * yi;
    }

    const r = sum / (overlapN * sx * sy);
    ccf.push(r);

    if (Math.abs(r) > bestAbsCCF) {
      bestAbsCCF = Math.abs(r);
      bestCCFValue = r;
      bestLag = k;
    }
  }

  const significanceBound = 1.96 / Math.sqrt(n);

  return {
    lags,
    ccf,
    significanceBound,
    bestLag,
    bestCCF: bestCCFValue,
  };
}
