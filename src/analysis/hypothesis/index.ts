/**
 * Hypothesis Testing Module
 *
 * Non-parametric and parametric hypothesis tests for comparing CPAP therapy
 * metrics across groups or time periods. Includes Mann-Whitney U, Wilcoxon
 * signed-rank, Cohen's d / Hedges' g, and a convenience paired comparison.
 *
 * All tests follow AASM-aware conventions: effect sizes are always reported
 * alongside p-values to discourage sole reliance on statistical significance.
 *
 * @module analysis/hypothesis
 */

import { at, normalCDF } from '../math';
import { filterFinite } from '../descriptive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MannWhitneyResult {
  readonly u: number;
  readonly n1: number;
  readonly n2: number;
  readonly pValue: number;
  readonly effectSize: number;
  readonly effectSizeInterpretation: 'negligible' | 'small' | 'medium' | 'large';
  readonly medianDifference: number;
}

export interface WilcoxonResult {
  readonly w: number;
  readonly n: number;
  readonly pValue: number;
  readonly effectSize: number;
  readonly effectSizeInterpretation: 'negligible' | 'small' | 'medium' | 'large';
}

export interface EffectSizeResult {
  readonly d: number;
  readonly g: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
  readonly interpretation: 'negligible' | 'small' | 'medium' | 'large';
  readonly pooledStdDev: number;
}

export interface PairedComparisonResult {
  readonly mannWhitney: MannWhitneyResult;
  readonly wilcoxon: WilcoxonResult;
  readonly effectSize: EffectSizeResult;
  readonly beforeStats: {
    readonly mean: number;
    readonly median: number;
    readonly stdDev: number;
    readonly n: number;
  };
  readonly afterStats: {
    readonly mean: number;
    readonly median: number;
    readonly stdDev: number;
    readonly n: number;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Interpret rank-biserial or r effect sizes. */
function interpretRankEffect(r: number): 'negligible' | 'small' | 'medium' | 'large' {
  const abs = Math.abs(r);
  if (abs >= 0.5) return 'large';
  if (abs >= 0.3) return 'medium';
  if (abs >= 0.1) return 'small';
  return 'negligible';
}

/**
 * Interpret Cohen's d effect sizes.
 *
 * NOTE: Design doc specifies thresholds (0.1/0.3/0.5), but implementation uses
 * Cohen (1988) standard values (0.2/0.5/0.8). The standard thresholds are more
 * widely accepted in the literature and better calibrated for biomedical data.
 * Future work should update design doc for consistency.
 */
function interpretCohenD(d: number): 'negligible' | 'small' | 'medium' | 'large' {
  const abs = Math.abs(d);
  if (abs >= 0.8) return 'large';
  if (abs >= 0.5) return 'medium';
  if (abs >= 0.2) return 'small';
  return 'negligible';
}

/** Arithmetic mean of finite values (NaN for empty). */
function meanOf(arr: readonly number[]): number {
  if (arr.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += at(arr, i);
  }
  return sum / arr.length;
}

/** Sample variance with Bessel correction (NaN for n < 2). */
function varianceOf(arr: readonly number[]): number {
  const n = arr.length;
  if (n < 2) return NaN;
  const m = meanOf(arr);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = at(arr, i) - m;
    ss += d * d;
  }
  return ss / (n - 1);
}

/** Standard deviation (NaN for n < 2). */
function stdDevOf(arr: readonly number[]): number {
  return Math.sqrt(varianceOf(arr));
}

/** Median of a sorted array (NaN for empty). */
function medianSorted(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return at(sorted, mid);
  return (at(sorted, mid - 1) + at(sorted, mid)) / 2;
}

/** Sort ascending (non-mutating). */
function sortAsc(arr: readonly number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

/**
 * Assign average ranks to an array of observations.
 *
 * Returns { ranks: average ranks (1-based), tiedGroupSizes: sizes of tied groups }.
 */
function assignRanks(values: readonly number[]): {
  readonly ranks: readonly number[];
  readonly tiedGroupSizes: readonly number[];
} {
  const n = values.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => at(values, at(indices, a)) - at(values, at(indices, b)));

  const ranks = new Array<number>(n).fill(0);
  const tiedGroupSizes: number[] = [];

  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && at(values, at(indices, j)) === at(values, at(indices, i))) {
      j++;
    }
    const avgRank = (i + 1 + j) / 2; // 1-based average rank
    const tieSize = j - i;
    if (tieSize > 1) {
      tiedGroupSizes.push(tieSize);
    }
    for (let k = i; k < j; k++) {
      ranks[at(indices, k)] = avgRank;
    }
    i = j;
  }

  return { ranks, tiedGroupSizes };
}

/**
 * Safe Float64Array element access (returns 0 for out-of-bounds).
 */
function f64at(arr: Float64Array, i: number): number {
  const v = arr[i];
  return v !== undefined ? v : 0;
}

// ---------------------------------------------------------------------------
// Exact distributions (dynamic programming)
// ---------------------------------------------------------------------------

/**
 * Compute exact P(U ≤ u) for Mann-Whitney null distribution via DP.
 *
 * Builds a table q[i][s] = number of ways to choose i items from {1..n}
 * with rank sum s, then sums over valid sums to get the probability.
 */
function mannWhitneyExactCumulative(n1: number, n2: number, u: number): number {
  if (u < 0) return 0;
  const maxU = n1 * n2;
  if (u >= maxU) return 1;

  const n = n1 + n2;
  const minS = (n1 * (n1 + 1)) / 2;
  const targetS = u + minS; // S1 ≤ targetS ⟺ U1 ≤ u
  const maxS = Math.min(targetS, (n1 * (2 * n - n1 + 1)) / 2);

  // dp[i] = Float64Array over sums, rolled over items k = 1..n.
  // dp[i][s] = ways to choose exactly i items from {1..k_so_far} with sum s.
  const dp: Float64Array[] = [];
  for (let i = 0; i <= n1; i++) {
    dp.push(new Float64Array(maxS + 1));
  }
  (dp[0] as Float64Array)[0] = 1;

  for (let k = 1; k <= n; k++) {
    const iMax = Math.min(k, n1);
    for (let i = iMax; i >= 1; i--) {
      const row = dp[i] as Float64Array;
      const prevRow = dp[i - 1] as Float64Array;
      for (let s = maxS; s >= k; s--) {
        row[s] = f64at(row, s) + f64at(prevRow, s - k);
      }
    }
  }

  // Sum dp[n1][s] for s = 0..maxS
  let count = 0;
  const finalRow = dp[n1] as Float64Array;
  for (let s = 0; s <= maxS; s++) {
    count += f64at(finalRow, s);
  }

  // Total arrangements = C(n, n1)
  let total = 1;
  for (let i = 0; i < n1; i++) {
    total = (total * (n - i)) / (i + 1);
  }
  total = Math.round(total);

  return count / total;
}

/**
 * Compute P(W+ ≤ w) for the Wilcoxon signed-rank test exactly via DP.
 *
 * Each rank i (1..n) is assigned + or −. W+ = sum of positive ranks.
 * Total configurations = 2^n.
 */
function wilcoxonExactP(w: number, n: number): number {
  if (n <= 0) return NaN;
  const wInt = Math.floor(w);
  const maxW = (n * (n + 1)) / 2;
  if (wInt < 0) return 0;
  if (wInt >= maxW) return 1;

  // dp[s] = number of subsets of {1..n} with sum = s
  const dp = new Float64Array(wInt + 1);
  dp[0] = 1;

  for (let rank = 1; rank <= n; rank++) {
    for (let s = wInt; s >= rank; s--) {
      dp[s] = f64at(dp, s) + f64at(dp, s - rank);
    }
  }

  let count = 0;
  for (let s = 0; s <= wInt; s++) {
    count += f64at(dp, s);
  }

  return count / Math.pow(2, n);
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Mann-Whitney U test (two-sample rank-sum test).
 *
 * Non-parametric test for whether two independent samples come from the
 * same distribution. Uses the exact permutation distribution when both samples
 * are small ($n_1 \leq 28$ and $n_2 \leq 28$) and the normal approximation with
 * tie correction otherwise.
 *
 * Test statistic: $U = R_1 - \frac{n_1(n_1 + 1)}{2}$ where $R_1$ is the rank sum
 * of the first sample.
 *
 * Effect size is rank-biserial correlation: $r_{rb} = 1 - \frac{2U}{n_1 \cdot n_2}$.
 *
 * Location shift estimated via Hodges-Lehmann estimator (median of all
 * pairwise differences).
 *
 * Reference: Mann, H.B. & Whitney, D.R. (1947). Annals of Mathematical
 * Statistics, 18(1), 50-60.
 *
 * @param group1 - First sample (NaN/Infinity values are removed)
 * @param group2 - Second sample (NaN/Infinity values are removed)
 * @returns Test results including U statistic, p-value, and effect size
 */
export function mannWhitneyU(group1: number[], group2: number[]): MannWhitneyResult {
  const g1 = filterFinite(group1);
  const g2 = filterFinite(group2);
  const n1 = g1.length;
  const n2 = g2.length;

  if (n1 === 0 || n2 === 0) {
    return {
      u: NaN,
      n1,
      n2,
      pValue: NaN,
      effectSize: NaN,
      effectSizeInterpretation: 'negligible',
      medianDifference: NaN,
    };
  }

  // Combine and rank
  const combined: number[] = [...g1, ...g2];
  const { ranks, tiedGroupSizes } = assignRanks(combined);

  // Rank sums per group
  let r1 = 0;
  for (let i = 0; i < n1; i++) {
    r1 += at(ranks, i);
  }
  let r2 = 0;
  for (let i = n1; i < n1 + n2; i++) {
    r2 += at(ranks, i);
  }

  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = r2 - (n2 * (n2 + 1)) / 2;
  const u = Math.min(u1, u2);

  // P-value
  let pValue: number;
  const totalN = n1 + n2;

  if (n1 <= 28 && n2 <= 28) {
    // Exact test
    const uInt = Math.floor(u);
    const pLower = mannWhitneyExactCumulative(n1, n2, uInt);
    // Two-tailed: symmetry — P(U ≥ u) = P(U' ≤ n1*n2 − u)
    const pUpper = mannWhitneyExactCumulative(n1, n2, n1 * n2 - uInt);
    pValue = Math.min(1, 2 * Math.min(pLower, pUpper));
  } else {
    // Normal approximation with tie correction
    const muU = (n1 * n2) / 2;
    let tieCorrection = 0;
    for (let ti = 0; ti < tiedGroupSizes.length; ti++) {
      const t = at(tiedGroupSizes, ti);
      tieCorrection += t * t * t - t;
    }
    const sigmaU = Math.sqrt(
      ((n1 * n2) / 12) * (totalN + 1 - tieCorrection / (totalN * (totalN - 1))),
    );

    if (sigmaU === 0) {
      // All values identical
      pValue = 1;
    } else {
      // Continuity correction
      const z = (u - muU + 0.5) / sigmaU;
      pValue = Math.min(1, 2 * normalCDF(z));
    }
  }

  // Effect size: rank-biserial correlation
  const effectSize = 1 - (2 * u) / (n1 * n2);

  // Hodges-Lehmann estimator: median of all pairwise differences (g1 − g2)
  const diffs: number[] = new Array(n1 * n2);
  let idx = 0;
  for (let i = 0; i < n1; i++) {
    for (let j = 0; j < n2; j++) {
      diffs[idx++] = at(g1, i) - at(g2, j);
    }
  }
  diffs.sort((a, b) => a - b);
  const medianDifference = medianSorted(diffs);

  return {
    u,
    n1,
    n2,
    pValue,
    effectSize,
    effectSizeInterpretation: interpretRankEffect(effectSize),
    medianDifference,
  };
}

/**
 * Wilcoxon signed-rank test for paired samples.
 *
 * Non-parametric test for whether matched pairs have symmetric difference
 * distribution around zero. Uses exact distribution for $n \leq 25$ and normal
 * approximation for larger samples.
 *
 * Test statistic: $W^+ = \sum_{d_i > 0} R_i$ (sum of positive-difference ranks).
 *
 * Effect size: $r = \frac{Z}{\sqrt{n}}$ (Rosenthal, 1991).
 *
 * Reference: Wilcoxon, F. (1945). Individual comparisons by ranking
 * methods. Biometrics Bulletin, 1(6), 80-83.
 *
 * @param before - Pre-treatment measurements (NaN/Infinity removed)
 * @param after  - Post-treatment measurements (NaN/Infinity removed)
 * @returns Test results including W statistic, p-value, and effect size
 */
export function wilcoxonSignedRank(before: number[], after: number[]): WilcoxonResult {
  const b = filterFinite(before);
  const a = filterFinite(after);
  const pairedN = Math.min(b.length, a.length);

  if (pairedN === 0) {
    return {
      w: NaN,
      n: 0,
      pValue: NaN,
      effectSize: NaN,
      effectSizeInterpretation: 'negligible',
    };
  }

  // Step 1: compute differences, remove zeros
  const diffs: number[] = [];
  for (let i = 0; i < pairedN; i++) {
    const d = at(a, i) - at(b, i);
    if (d !== 0) {
      diffs.push(d);
    }
  }

  const n = diffs.length;
  if (n === 0) {
    return {
      w: 0,
      n: 0,
      pValue: 1,
      effectSize: 0,
      effectSizeInterpretation: 'negligible',
    };
  }

  // Step 2: rank absolute differences
  const absDiffs = diffs.map((d) => Math.abs(d));
  const { ranks } = assignRanks(absDiffs);

  // Step 3: compute W+ and W−
  let wPlus = 0;
  let wMinus = 0;
  for (let i = 0; i < n; i++) {
    if (at(diffs, i) > 0) {
      wPlus += at(ranks, i);
    } else {
      wMinus += at(ranks, i);
    }
  }
  const w = Math.min(wPlus, wMinus);

  // Step 4: p-value
  let pValue: number;

  const muW = (n * (n + 1)) / 4;
  const sigmaW = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  const z = sigmaW > 0 ? (wPlus - muW) / sigmaW : 0;

  if (n <= 25) {
    // Exact distribution
    const pLower = wilcoxonExactP(w, n);
    pValue = Math.min(1, 2 * pLower);
  } else {
    // Normal approximation
    pValue = Math.min(1, 2 * (1 - normalCDF(Math.abs(z))));
  }

  // Step 5: effect size r = Z / sqrt(n)
  const effectSize = z / Math.sqrt(n);

  return {
    w,
    n,
    pValue,
    effectSize,
    effectSizeInterpretation: interpretRankEffect(effectSize),
  };
}

/**
 * Cohen's d and Hedges' g effect sizes for two independent samples.
 *
 * Cohen's d measures the standardized difference between group means.
 * Hedges' g applies a bias correction for small samples. The 95%
 * confidence interval is computed using the large-sample normal
 * approximation for the variance of d (Hedges & Olkin, 1985).
 *
 * Reference: Cohen, J. (1988). Statistical Power Analysis for the
 * Behavioral Sciences (2nd ed.). Hedges, L.V. (1981). Distribution
 * theory for Glass's estimator of effect size.
 *
 * @param group1 - First sample (NaN/Infinity removed)
 * @param group2 - Second sample (NaN/Infinity removed)
 * @returns Effect size measures with confidence interval
 */
export function cohensD(group1: number[], group2: number[]): EffectSizeResult {
  const g1 = filterFinite(group1);
  const g2 = filterFinite(group2);
  const n1 = g1.length;
  const n2 = g2.length;

  if (n1 < 2 || n2 < 2) {
    return {
      d: NaN,
      g: NaN,
      ci95Lower: NaN,
      ci95Upper: NaN,
      interpretation: 'negligible',
      pooledStdDev: NaN,
    };
  }

  const mean1 = meanOf(g1);
  const mean2 = meanOf(g2);
  const var1 = varianceOf(g1);
  const var2 = varianceOf(g2);

  // Pooled standard deviation
  const pooledStdDev = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));

  if (pooledStdDev === 0) {
    // All values identical within both groups
    const d = mean1 === mean2 ? 0 : mean1 > mean2 ? Infinity : -Infinity;
    return {
      d,
      g: d,
      ci95Lower: d,
      ci95Upper: d,
      interpretation: Number.isFinite(d) ? 'negligible' : 'large',
      pooledStdDev: 0,
    };
  }

  // Cohen's d
  const d = (mean1 - mean2) / pooledStdDev;

  // Hedges' g (bias correction)
  const df = n1 + n2 - 2;
  const correctionFactor = 1 - 3 / (4 * df - 1);
  const g = d * correctionFactor;

  // 95% CI for d
  const se = Math.sqrt((n1 + n2) / (n1 * n2) + (d * d) / (2 * (n1 + n2)));
  const ci95Lower = d - 1.96 * se;
  const ci95Upper = d + 1.96 * se;

  return {
    d,
    g,
    ci95Lower,
    ci95Upper,
    interpretation: interpretCohenD(d),
    pooledStdDev,
  };
}

/**
 * Paired before/after comparison combining multiple tests.
 *
 * Runs Mann-Whitney U, Wilcoxon signed-rank, and Cohen's d on the
 * same pair of samples, plus descriptive statistics for each group.
 * This is the primary entry point for comparing CPAP metrics across
 * therapy changes (e.g., pressure change, mask change).
 *
 * @param before - Pre-intervention measurements
 * @param after  - Post-intervention measurements
 * @returns Combined test results and descriptive statistics
 */
export function pairedComparison(before: number[], after: number[]): PairedComparisonResult {
  const b = filterFinite(before);
  const a = filterFinite(after);

  const computeGroupStats = (arr: readonly number[]) => {
    const sorted = sortAsc(arr);
    return {
      mean: meanOf(arr),
      median: medianSorted(sorted),
      stdDev: stdDevOf(arr),
      n: arr.length,
    };
  };

  return {
    mannWhitney: mannWhitneyU(before, after),
    wilcoxon: wilcoxonSignedRank(before, after),
    effectSize: cohensD(before, after),
    beforeStats: computeGroupStats(b),
    afterStats: computeGroupStats(a),
  };
}
