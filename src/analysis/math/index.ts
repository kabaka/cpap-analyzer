/**
 * Shared Mathematical Utilities
 *
 * Common mathematical helper functions used across analysis modules
 * (time-series, correlation, etc.). Centralises implementations of
 * special functions and statistical distributions to avoid duplication.
 *
 * @module analysis/math
 */

// ---------------------------------------------------------------------------
// Array helpers
// ---------------------------------------------------------------------------

/**
 * Safe numeric array access — returns fallback (default 0) for out-of-bounds
 * or undefined entries. Used throughout to satisfy noUncheckedIndexedAccess
 * without non-null assertions.
 */
export function at(arr: ArrayLike<number | undefined>, i: number, fallback = 0): number {
  const v = arr[i];
  return v !== undefined ? v : fallback;
}

// ---------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------

/**
 * Log-gamma function via Lanczos approximation (g = 7, n = 9).
 */
export function lnGamma(z: number): number {
  if (z <= 0) return Infinity;

  const g = 7;
  const coefs: readonly number[] = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }

  const x = z - 1;
  let a = at(coefs, 0);
  const t = x + g + 0.5;

  for (let i = 1; i < coefs.length; i++) {
    a += at(coefs, i) / (x + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Regularized incomplete beta function I_x(a, b) via continued-fraction
 * expansion (Lentz's method). Used for small-df t-distribution CDF.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  const maxIter = 200;
  const eps = 1e-14;
  let f = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < eps) d = eps;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= maxIter; m++) {
    let numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < eps) d = eps;
    c = 1 + numerator / c;
    if (Math.abs(c) < eps) c = eps;
    d = 1 / d;
    f *= c * d;

    numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < eps) d = eps;
    c = 1 + numerator / c;
    if (Math.abs(c) < eps) c = eps;
    d = 1 / d;
    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return front * f;
}

/**
 * Error function approximation (Horner form).
 * Abramowitz & Stegun 7.1.26 — max error ~1.5 × 10⁻⁷.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const t = 1 / (1 + p * ax);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;

  const poly = a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/**
 * Binomial coefficient C(n, k) using log-gamma for large values.
 */
export function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  return Math.round(Math.exp(lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)));
}

// ---------------------------------------------------------------------------
// Distribution functions
// ---------------------------------------------------------------------------

/** Standard normal CDF via error-function approximation. */
export function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Student's t CDF via the exact incomplete-beta relation.
 *
 * Uses the identity (Abramowitz & Stegun 26.7.1; DLMF 8.17):
 *   F(t; ν) = 1 − ½·I_x(ν/2, ½)   for t ≥ 0,  x = ν / (ν + t²)
 *   F(t; ν) =     ½·I_x(ν/2, ½)   for t < 0
 *
 * This is accurate across the full range of df, including the small-p tails
 * where correlation and trend p-values matter most. The previous
 * Cornish-Fisher normal approximation for df > 30 degraded noticeably in
 * those tails (it can be off by a relative factor of ~1.5–2× at p ≈ 1e-3
 * for df near 40), so we now use the incomplete-beta path for ALL df. The
 * continued-fraction beta evaluation is O(1) per call and numerically
 * stable via Lentz's method.
 *
 * @param t  t-statistic.
 * @param df degrees of freedom (ν ≥ 1).
 * @returns  P(T ≤ t).
 */
export function studentTCDF(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df < 1) return NaN;

  const x = df / (df + t * t);
  const ibeta = regularizedIncompleteBeta(x, df / 2, 0.5);

  if (t >= 0) {
    return 1 - 0.5 * ibeta;
  }
  return 0.5 * ibeta;
}

/**
 * Rational approximation of the inverse standard-normal CDF (probit).
 * Abramowitz & Stegun 26.2.23 — accurate to ~4.5 × 10⁻⁴.
 */
export function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const sign = p < 0.5 ? -1 : 1;
  const pp = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(pp));

  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  const numerator = c0 + c1 * t + c2 * t * t;
  const denominator = 1 + d1 * t + d2 * t * t + d3 * t * t * t;

  return sign * (t - numerator / denominator);
}

/**
 * Type 7 percentile (R default) from a pre-sorted numeric array.
 * `p` is in [0, 100]. Uses linear interpolation between order statistics.
 */
export function percentileFromSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return at(sorted, 0);

  const h = ((n - 1) * p) / 100;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const frac = h - lo;

  if (lo === hi) return at(sorted, lo);
  return at(sorted, lo) * (1 - frac) + at(sorted, hi) * frac;
}

/**
 * Two-tailed p-value from Student's t distribution.
 */
export function twoTailedPValue(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df < 1) return NaN;
  return 2 * (1 - studentTCDF(Math.abs(t), df));
}
