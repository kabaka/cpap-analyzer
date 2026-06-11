/**
 * Distribution Analysis Module
 *
 * Provides normality assessment tools for CPAP therapy data:
 * - QQ-Normal plots with correlation coefficient
 * - Shapiro-Wilk test (Royston's 1995 approximation)
 * - Kolmogorov-Smirnov test with Lilliefors correction
 * - Kernel Density Estimation (Gaussian kernel, Silverman bandwidth)
 *
 * All methods handle edge cases gracefully, returning NaN for insufficient data.
 *
 * @module analysis/distribution
 */

import { at, inverseNormalCDF, normalCDF } from '@/analysis/math';
import { filterFinite } from '@/analysis/descriptive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QQPlotData {
  readonly theoreticalQuantiles: readonly number[];
  readonly sampleQuantiles: readonly number[];
  readonly n: number;
  readonly correlation: number;
}

export interface NormalityTestResult {
  readonly statistic: number;
  readonly pValue: number;
  readonly isNormal: boolean;
  readonly testName: string;
}

export interface KDEResult {
  readonly x: readonly number[];
  readonly density: readonly number[];
  readonly bandwidth: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pearson correlation between two equal-length arrays.
 * Returns NaN if arrays have fewer than 2 elements or zero variance.
 */
function pearsonR(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 2) return NaN;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += at(a, i);
    sumB += at(b, i);
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let covAB = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = at(a, i) - meanA;
    const dB = at(b, i) - meanB;
    covAB += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  if (varA === 0 || varB === 0) return NaN;
  return covAB / Math.sqrt(varA * varB);
}

/**
 * Compute sample mean.
 */
function mean(arr: readonly number[]): number {
  if (arr.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += at(arr, i);
  }
  return s / arr.length;
}

/**
 * Compute sample standard deviation (Bessel-corrected, ddof=1).
 */
function stdDev(arr: readonly number[], mu: number): number {
  const n = arr.length;
  if (n < 2) return 0;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = at(arr, i) - mu;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}

// ---------------------------------------------------------------------------
// QQ-Normal Plot
// ---------------------------------------------------------------------------

/**
 * Generate QQ-Normal plot data for assessing normality.
 *
 * Computes theoretical quantiles using the Hazen plotting position formula
 * `p_i = (i - 0.5) / n` and converts to standard-normal quantiles via the
 * inverse normal CDF. The returned correlation coefficient measures how
 * closely the sample distribution follows normality (1 = perfect).
 *
 * @param values - Numeric array (non-finite values are filtered)
 * @returns QQ plot data with theoretical/sample quantiles and correlation
 *
 * @example
 * ```ts
 * const qq = qqNormal(myData);
 * // Plot qq.theoreticalQuantiles (x) vs qq.sampleQuantiles (y)
 * ```
 */
export function qqNormal(values: number[]): QQPlotData {
  const clean = filterFinite(values)
    .slice()
    .sort((a, b) => a - b);
  const n = clean.length;

  if (n === 0) {
    return { theoreticalQuantiles: [], sampleQuantiles: [], n: 0, correlation: NaN };
  }

  const theoretical: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i + 0.5) / n; // Hazen formula: (i - 0.5)/n with 1-based → (i + 0.5)/n with 0-based
    theoretical[i] = inverseNormalCDF(p);
  }

  const correlation = n >= 2 ? pearsonR(theoretical, clean) : NaN;

  return {
    theoreticalQuantiles: theoretical,
    sampleQuantiles: clean,
    n,
    correlation,
  };
}

// ---------------------------------------------------------------------------
// Shapiro-Francia Test
// ---------------------------------------------------------------------------

const SHAPIRO_FRANCIA_TEST_NAME = 'Shapiro-Francia';

/**
 * Shapiro-Francia normality test (Shapiro & Francia, 1972) with Royston's
 * (1993) normalizing transform for the p-value.
 *
 * The test statistic is
 *   W' = r²(x_{(i)}, m_i)
 * the squared Pearson correlation between the sorted sample and the expected
 * standard-normal order statistics approximated by Blom's (1958) scores
 *   m_i = Φ⁻¹((i − 3/8) / (n + 1/4)).
 *
 * **This is the Shapiro-Francia statistic, not Shapiro-Wilk.** True
 * Shapiro-Wilk uses the BLUE weights a = m'V⁻¹ / ‖V⁻¹m‖ (incorporating the
 * covariance V of the order statistics); Shapiro-Francia replaces V⁻¹ with the
 * identity, i.e. W' = corr(x_{(i)}, m_i)². The two coincide asymptotically and
 * Shapiro-Francia has excellent power against heavy-tailed and skewed
 * alternatives, but they are distinct tests with distinct null distributions —
 * hence the previous "Shapiro-Wilk" name and Royston-SW p-value transform were
 * a mislabelling. This implementation now uses the matching Shapiro-Francia
 * transform.
 *
 * **P-value (Royston 1993, "A Toolkit for Testing for Non-Normality in
 * Complete and Censored Samples", Applied Statistics 42(1), eq. for SF):**
 * for 5 ≤ n ≤ 5000, with w = ln(1 − W'), u = ln(n), v = ln(u),
 *   μ = −1.2725 + 1.0521·(v − u),
 *   σ =  1.0308 − 0.26758·(v + 2/u),
 *   z = (w − μ) / σ,  p = 1 − Φ(z).
 * For n = 3, 4 (below Royston's validated range) a conservative
 * range-statistic fallback is used and the result should be treated as
 * indicative only.
 *
 * For n ≥ 5000 the routine delegates to the Lilliefors-corrected
 * Kolmogorov-Smirnov test. For n < 3 it returns NaN.
 *
 * **Assumptions**: data are i.i.d. continuous observations.
 *
 * @param values - Numeric array (non-finite values are filtered).
 * @returns Test result with W' statistic, p-value, and normality decision at
 *          α = 0.05.
 *
 * @example
 * ```ts
 * const result = shapiroFrancia(myData);
 * if (result.isNormal) {
 *   // Cannot reject normality at α = 0.05
 * }
 * ```
 */
export function shapiroFrancia(values: number[]): NormalityTestResult {
  const clean = filterFinite(values);
  const n = clean.length;

  if (n < 3) {
    return { statistic: NaN, pValue: NaN, isNormal: false, testName: SHAPIRO_FRANCIA_TEST_NAME };
  }

  // For n >= 5000, fall back to Kolmogorov-Smirnov
  if (n >= 5000) {
    return kolmogorovSmirnov(values);
  }

  const sorted = clean.slice().sort((a, b) => a - b);

  // Check for zero variance (all identical values)
  const mu = mean(sorted);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = at(sorted, i) - mu;
    ss += d * d;
  }
  if (ss === 0) {
    // All values identical — undefined test, but vacuously "normal"
    return { statistic: 1, pValue: 1, isNormal: true, testName: SHAPIRO_FRANCIA_TEST_NAME };
  }

  // Expected normal order statistics via Blom's formula
  // m_i = Φ⁻¹((i - 3/8) / (n + 1/4))
  const m: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i + 1 - 0.375) / (n + 0.25);
    m[i] = inverseNormalCDF(p);
  }

  // W' = correlation² between sorted values and expected normal scores
  const r = pearsonR(m, sorted);
  const W = r * r;

  const pValue = shapiroFranciaPValue(W, n);

  return {
    statistic: W,
    pValue,
    isNormal: pValue >= 0.05,
    testName: SHAPIRO_FRANCIA_TEST_NAME,
  };
}

/**
 * @deprecated Misnamed — this computes the **Shapiro-Francia** statistic
 * (correlation-based W'), not true Shapiro-Wilk. Retained as a thin alias for
 * backward compatibility. Prefer {@link shapiroFrancia}. NOTE: the returned
 * `testName` is now `'Shapiro-Francia'`, not `'Shapiro-Wilk'`.
 */
export function shapiroWilk(values: number[]): NormalityTestResult {
  return shapiroFrancia(values);
}

/**
 * Royston's (1993) normalizing transform giving the Shapiro-Francia p-value.
 *
 * Valid for 5 ≤ n ≤ 5000. For n = 3, 4 a conservative range-based fallback is
 * used (below Royston's validated range); such results are indicative only.
 *
 * @see Royston, P. (1993). A Toolkit for Testing for Non-Normality in Complete
 *      and Censored Samples. *Applied Statistics* 42(1), 37–43.
 */
function shapiroFranciaPValue(W: number, n: number): number {
  if (n < 5) {
    // Below Royston's validated SF range. Use a deliberately conservative
    // monotone fallback on -ln(1 - W) so the verdict degrades gracefully and
    // does not over-claim significance for tiny samples.
    const z = -Math.log(1 - W);
    return clamp01(1 - normalCDF(z));
  }

  // Royston (1993) Shapiro-Francia normalizing transform.
  const w = Math.log(1 - W);
  const u = Math.log(n);
  const v = Math.log(u);
  const mu = -1.2725 + 1.0521 * (v - u);
  const sigma = 1.0308 - 0.26758 * (v + 2 / u);

  if (!(sigma > 0)) {
    return W >= 0.95 ? 0.5 : 0.01;
  }

  const z = (w - mu) / sigma;
  const p = 1 - normalCDF(z);
  return clamp01(p);
}

/**
 * Clamp a value to [0, 1].
 */
function clamp01(p: number): number {
  if (!Number.isFinite(p)) return NaN;
  return Math.max(0, Math.min(1, p));
}

// ---------------------------------------------------------------------------
// Kolmogorov-Smirnov Test (Lilliefors correction)
// ---------------------------------------------------------------------------

/**
 * Kolmogorov-Smirnov normality test with Lilliefors correction.
 *
 * Tests whether data come from a normal distribution when the mean and
 * standard deviation are estimated from the sample (composite hypothesis).
 *
 * Test statistic:
 * $$D = \max_i \left| F_n(z_i) - \Phi(z_i) \right|$$
 * where $F_n$ is the empirical CDF and $\Phi$ is the standard normal CDF.
 *
 * Uses the Dallal-Wilkinson (1986) formula for $p$-value approximation
 * with Lilliefors critical value thresholds as fallback.
 *
 * **Assumptions**: Data are i.i.d. continuous observations, $n \geq 4$.
 *
 * @param values - Numeric array (non-finite values are filtered)
 * @returns Test result with D statistic, p-value, and normality decision at $\alpha = 0.05$
 *
 * @example
 * ```ts
 * const result = kolmogorovSmirnov(myData);
 * console.log(`D = ${result.statistic}, p = ${result.pValue}`);
 * ```
 */
export function kolmogorovSmirnov(values: number[]): NormalityTestResult {
  const clean = filterFinite(values);
  const n = clean.length;

  if (n < 4) {
    return {
      statistic: NaN,
      pValue: NaN,
      isNormal: false,
      testName: 'Kolmogorov-Smirnov (Lilliefors)',
    };
  }

  // Check for zero variance
  const mu = mean(clean);
  const sd = stdDev(clean, mu);

  if (sd === 0) {
    // All identical values — trivially "normal" (degenerate)
    return { statistic: 0, pValue: 1, isNormal: true, testName: 'Kolmogorov-Smirnov (Lilliefors)' };
  }

  // Standardize and sort
  const z: number[] = clean.map((x) => (x - mu) / sd);
  z.sort((a, b) => a - b);

  // Compute D statistic: max |F_n(z) - Φ(z)|
  let dPlus = -Infinity;
  let dMinus = -Infinity;
  for (let i = 0; i < n; i++) {
    const phi = normalCDF(at(z, i));
    const fnHigh = (i + 1) / n; // F_n evaluated just after z_(i)
    const fnLow = i / n; // F_n evaluated just before z_(i)
    const dp = fnHigh - phi;
    const dm = phi - fnLow;
    if (dp > dPlus) dPlus = dp;
    if (dm > dMinus) dMinus = dm;
  }
  const D = Math.max(dPlus, dMinus);

  // P-value with Lilliefors correction
  const pValue = lillieforsP(D, n);

  return {
    statistic: D,
    pValue,
    isNormal: pValue >= 0.05,
    testName: 'Kolmogorov-Smirnov (Lilliefors)',
  };
}

/**
 * Lilliefors-corrected p-value for the KS statistic.
 *
 * Uses the Dallal-Wilkinson (1986) approximation for 4 ≤ n ≤ 100,
 * and Lilliefors critical value thresholds as fallback for n > 100.
 */
function lillieforsP(D: number, n: number): number {
  if (!Number.isFinite(D) || D <= 0) return 1;

  // Dallal-Wilkinson (1986) approximation — valid for 4 ≤ n ≤ 100
  // and for D within a reasonable range
  if (n <= 100) {
    const sqrtN = Math.sqrt(n);
    const nAdj = n + 2.78019;
    const sqrtNAdj = Math.sqrt(nAdj);
    const p = Math.exp(
      -7.01256 * D * D * nAdj + 2.99587 * D * sqrtNAdj - 0.122119 + 0.974598 / sqrtN + 1.67997 / n,
    );

    // Dallal-Wilkinson is only valid when 0.01 < p < 0.85 approximately
    if (p >= 0 && p <= 1) {
      return clamp01(p);
    }
  }

  // Fallback: Lilliefors critical value thresholds (asymptotic approximation)
  const sqrtN = Math.sqrt(n);
  if (D > 0.886 / sqrtN) return 0.005; // p < 0.01, use midpoint
  if (D > 0.805 / sqrtN) return 0.025; // p < 0.05
  if (D > 0.768 / sqrtN) return 0.075; // p < 0.10
  return 0.15; // p > 0.10
}

// ---------------------------------------------------------------------------
// Kernel Density Estimation
// ---------------------------------------------------------------------------

/**
 * Kernel Density Estimation using a Gaussian kernel.
 *
 * Estimates the probability density function from sample data using kernel
 * smoothing. Each data point contributes a Gaussian bump:
 *
 * $$\hat{f}(x) = \frac{1}{nh}\sum_{i=1}^{n} K\!\left(\frac{x - x_i}{h}\right), \quad K(u) = \frac{1}{\sqrt{2\pi}}e^{-u^2/2}$$
 *
 * The default bandwidth follows Silverman's rule of thumb:
 * $h = 0.9 \cdot \min(\sigma, \text{IQR}/1.34) \cdot n^{-1/5}$.
 *
 * @param values - Numeric array (non-finite values are filtered)
 * @param nPoints - Number of evaluation grid points (default 100)
 * @param bandwidth - Override bandwidth; if omitted uses Silverman's rule
 * @returns KDE result with evaluation grid (x), density values, and bandwidth
 *
 * @example
 * ```ts
 * const kde = kernelDensityEstimation(myData, 200);
 * // Plot kde.x vs kde.density
 * ```
 */
export function kernelDensityEstimation(
  values: number[],
  nPoints: number = 100,
  bandwidth?: number,
): KDEResult {
  const clean = filterFinite(values);
  const n = clean.length;

  if (n === 0) {
    return { x: [], density: [], bandwidth: NaN };
  }

  const sorted = clean.slice().sort((a, b) => a - b);
  const mu = mean(sorted);
  const sd = stdDev(sorted, mu);

  // Compute IQR for Silverman bandwidth
  const q25 = quantile(sorted, 0.25);
  const q75 = quantile(sorted, 0.75);
  const iqr = q75 - q25;

  // Silverman's rule of thumb
  let h: number;
  if (bandwidth !== undefined && bandwidth > 0) {
    h = bandwidth;
  } else if (n === 1 || sd === 0) {
    // Degenerate case: tiny bandwidth to produce a spike
    h = 1e-6;
  } else {
    const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
    h = 0.9 * spread * Math.pow(n, -0.2);
    if (h <= 0) h = 1e-6;
  }

  // Evaluation grid: min - 3h to max + 3h
  const xMin = at(sorted, 0) - 3 * h;
  const xMax = at(sorted, n - 1) + 3 * h;
  const step = nPoints > 1 ? (xMax - xMin) / (nPoints - 1) : 0;

  const xGrid: number[] = new Array(nPoints);
  const density: number[] = new Array(nPoints);

  const invH = 1 / h;
  const normConst = 1 / (n * h * Math.sqrt(2 * Math.PI));

  for (let j = 0; j < nPoints; j++) {
    const xj = xMin + j * step;
    xGrid[j] = xj;

    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = (xj - at(sorted, i)) * invH;
      sum += Math.exp(-0.5 * u * u);
    }
    density[j] = normConst * sum;
  }

  return { x: xGrid, density, bandwidth: h };
}

/**
 * Type 7 quantile of a pre-sorted array (R default, Excel PERCENTILE.INC).
 * Assumes `sorted` is already sorted ascending and contains only finite values.
 */
function quantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return at(sorted, 0);

  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const frac = h - lo;

  return at(sorted, lo) * (1 - frac) + at(sorted, Math.min(hi, n - 1)) * frac;
}
