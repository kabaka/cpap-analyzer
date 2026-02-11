/**
 * Descriptive Statistics Module
 *
 * Provides numerically stable descriptive statistics, percentile computation,
 * outlier detection, and histogram binning for CPAP therapy data analysis.
 *
 * Key implementation notes:
 * - Welford's online algorithm for single-pass mean/variance (numerically stable)
 * - Type 7 percentile interpolation (R default, Excel PERCENTILE.INC)
 * - Tukey's fences for outlier detection
 * - Freedman-Diaconis / Sturges' rule for automatic histogram binning
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  variance: number;
  stdDev: number;
  stdErr: number;
  min: number;
  max: number;
  range: number;
  iqr: number;
  cv: number; // coefficient of variation (stdDev / mean)
  skewness: number; // Fisher-Pearson
  kurtosis: number; // excess kurtosis (subtract 3)
}

export interface Percentiles {
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface OutlierDetection {
  lowerFence: number;
  upperFence: number;
  outliers: number[];
  outlierIndices: number[];
  outlierCount: number;
}

export interface HistogramBin {
  binStart: number;
  binEnd: number;
  count: number;
  frequency: number; // count / total
}

export interface HistogramResult {
  bins: HistogramBin[];
  binWidth: number;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Remove NaN and ±Infinity values from an array.
 * Returns a new array containing only finite numbers.
 */
export function filterFinite(data: number[]): number[] {
  return data.filter((v) => Number.isFinite(v));
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Compute comprehensive descriptive statistics for a numeric array.
 *
 * Uses Welford's online algorithm for numerically stable single-pass
 * computation of mean and variance. Skewness and kurtosis are computed
 * using the Fisher-Pearson and excess-kurtosis formulas respectively.
 *
 * @param data - Array of numeric values (NaN/Infinity are filtered)
 * @returns DescriptiveStats object; fields are NaN/0 when data is insufficient
 */
export function computeDescriptiveStats(data: number[]): DescriptiveStats {
  const clean = filterFinite(data);
  const n = clean.length;

  if (n === 0) {
    return {
      count: 0,
      mean: NaN,
      median: NaN,
      variance: NaN,
      stdDev: NaN,
      stdErr: NaN,
      min: NaN,
      max: NaN,
      range: NaN,
      iqr: NaN,
      cv: NaN,
      skewness: NaN,
      kurtosis: NaN,
    };
  }

  // --- Welford's single-pass algorithm for mean & variance ----------------
  let welfordMean = 0;
  let m2 = 0; // sum of squares of differences from the current mean
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (let i = 0; i < n; i++) {
    const x = clean[i] as number;
    const delta = x - welfordMean;
    welfordMean += delta / (i + 1);
    const delta2 = x - welfordMean;
    m2 += delta * delta2;

    if (x < minVal) minVal = x;
    if (x > maxVal) maxVal = x;
  }

  // Population variance (biased) for skewness/kurtosis denominators,
  // sample variance (unbiased, Bessel's correction) for reporting.
  const populationVariance = m2 / n;
  const sampleVariance = n > 1 ? m2 / (n - 1) : 0;
  const stdDev = Math.sqrt(sampleVariance);
  const stdErr = n > 0 ? stdDev / Math.sqrt(n) : NaN;

  // --- Median (via sort) --------------------------------------------------
  const sorted = clean.slice().sort((a, b) => a - b);
  const median = computeMedian(sorted);

  // --- Percentiles for IQR ------------------------------------------------
  const q1 = percentileFromSorted(sorted, 25);
  const q3 = percentileFromSorted(sorted, 75);
  const iqr = q3 - q1;

  // --- Skewness (Fisher-Pearson g1) & Excess Kurtosis ---------------------
  // g1 = (1/n * Σ(xi - x̄)³) / s³   where s = population std dev
  // excess kurtosis = (1/n * Σ(xi - x̄)⁴) / s⁴ - 3
  let sumCubed = 0;
  let sumFourth = 0;
  const popStdDev = Math.sqrt(populationVariance);

  for (let i = 0; i < n; i++) {
    const diff = (clean[i] as number) - welfordMean;
    const diff2 = diff * diff;
    sumCubed += diff2 * diff;
    sumFourth += diff2 * diff2;
  }

  let skewness: number;
  let kurtosis: number;

  if (popStdDev === 0 || n < 3) {
    // All values identical or insufficient data for meaningful higher moments
    skewness = n < 3 ? NaN : 0;
    kurtosis = n < 3 ? NaN : NaN;
    // With zero variance, kurtosis is undefined
    if (popStdDev === 0 && n >= 3) {
      kurtosis = NaN;
    }
  } else {
    const s3 = popStdDev * popStdDev * popStdDev;
    const s4 = s3 * popStdDev;
    skewness = sumCubed / n / s3;
    kurtosis = sumFourth / n / s4 - 3;
  }

  // --- Coefficient of variation -------------------------------------------
  const cv = welfordMean !== 0 ? stdDev / Math.abs(welfordMean) : NaN;

  return {
    count: n,
    mean: welfordMean,
    median,
    variance: sampleVariance,
    stdDev,
    stdErr,
    min: minVal,
    max: maxVal,
    range: maxVal - minVal,
    iqr,
    cv,
    skewness,
    kurtosis,
  };
}

/**
 * Compute the median of a pre-sorted array.
 */
function computeMedian(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n % 2 === 1) {
    return sorted[Math.floor(n / 2)] as number;
  }
  return ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
}

// ---------------------------------------------------------------------------
// Percentile
// ---------------------------------------------------------------------------

/**
 * Compute the p-th percentile of data using Type 7 (R default) interpolation.
 *
 * Type 7 formula: h = (n - 1) * p/100 + 1, then linear interpolation
 * between floor(h) and ceil(h) positions (1-indexed).
 *
 * @param data - Array of numeric values (will be sorted internally if needed)
 * @param p - Percentile in range [0, 100]
 * @returns The interpolated percentile value, or NaN for empty/invalid input
 */
export function percentile(data: number[], p: number): number {
  const clean = filterFinite(data);
  if (clean.length === 0 || p < 0 || p > 100) return NaN;

  const sorted = clean.slice().sort((a, b) => a - b);
  return percentileFromSorted(sorted, p);
}

/**
 * Internal percentile computation on a pre-sorted, pre-cleaned array.
 * Uses Type 7 interpolation (R default, Excel PERCENTILE.INC).
 */
function percentileFromSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0] as number;

  // Type 7: h = (n - 1) * p/100, then interpolate
  // Using 0-indexed positions directly:
  const h = (n - 1) * (p / 100);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const frac = h - lo;

  if (lo === hi) return sorted[lo] as number;
  return (sorted[lo] as number) + frac * ((sorted[hi] as number) - (sorted[lo] as number));
}

// ---------------------------------------------------------------------------
// Percentile Set
// ---------------------------------------------------------------------------

/**
 * Compute a standard set of percentiles (p5 through p95).
 *
 * @param data - Array of numeric values (NaN/Infinity are filtered)
 * @returns Percentiles object with p5, p10, p25, p50, p75, p90, p95
 */
export function computePercentiles(data: number[]): Percentiles {
  const clean = filterFinite(data);
  const sorted = clean.slice().sort((a, b) => a - b);

  return {
    p5: percentileFromSorted(sorted, 5),
    p10: percentileFromSorted(sorted, 10),
    p25: percentileFromSorted(sorted, 25),
    p50: percentileFromSorted(sorted, 50),
    p75: percentileFromSorted(sorted, 75),
    p90: percentileFromSorted(sorted, 90),
    p95: percentileFromSorted(sorted, 95),
  };
}

// ---------------------------------------------------------------------------
// Outlier Detection
// ---------------------------------------------------------------------------

/**
 * Detect outliers using Tukey's fences (1.5 × IQR rule).
 *
 * Lower fence = Q1 - 1.5 * IQR
 * Upper fence = Q3 + 1.5 * IQR
 *
 * Outlier indices refer to positions in the **original** (unfiltered) array,
 * but only finite values are considered.
 *
 * @param data - Array of numeric values (NaN/Infinity are filtered)
 * @returns OutlierDetection with fences, outlier values, and original indices
 */
export function detectOutliers(data: number[]): OutlierDetection {
  // Build a map of (original index → finite value)
  const indexed: Array<{ originalIndex: number; value: number }> = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v !== undefined && Number.isFinite(v)) {
      indexed.push({ originalIndex: i, value: v });
    }
  }

  if (indexed.length === 0) {
    return {
      lowerFence: NaN,
      upperFence: NaN,
      outliers: [],
      outlierIndices: [],
      outlierCount: 0,
    };
  }

  const sorted = indexed.map((item) => item.value).sort((a, b) => a - b);
  const q1 = percentileFromSorted(sorted, 25);
  const q3 = percentileFromSorted(sorted, 75);
  const iqr = q3 - q1;

  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const outliers: number[] = [];
  const outlierIndices: number[] = [];

  for (const item of indexed) {
    if (item.value < lowerFence || item.value > upperFence) {
      outliers.push(item.value);
      outlierIndices.push(item.originalIndex);
    }
  }

  return {
    lowerFence,
    upperFence,
    outliers,
    outlierIndices,
    outlierCount: outliers.length,
  };
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

/**
 * Compute a histogram with automatic or manual bin count selection.
 *
 * Automatic binning:
 * - Primary: Freedman-Diaconis rule — h = 2 × IQR × n^(-1/3)
 * - Fallback (IQR = 0): Sturges' rule — ceil(log2(n) + 1)
 * - Bin count clamped to [5, 50]
 *
 * @param data - Array of numeric values (NaN/Infinity are filtered)
 * @param binCount - Optional explicit number of bins (clamped to [5, 50])
 * @returns HistogramResult with bins, binWidth, and totalCount
 */
export function computeHistogram(data: number[], binCount?: number): HistogramResult {
  const clean = filterFinite(data);
  const n = clean.length;

  if (n === 0) {
    return { bins: [], binWidth: 0, totalCount: 0 };
  }

  const sorted = clean.slice().sort((a, b) => a - b);
  const minVal = sorted[0] as number;
  const maxVal = sorted[n - 1] as number;
  const dataRange = maxVal - minVal;

  // --- Determine bin count ------------------------------------------------
  let numBins: number;

  if (binCount !== undefined) {
    numBins = Math.round(binCount);
  } else {
    const q1 = percentileFromSorted(sorted, 25);
    const q3 = percentileFromSorted(sorted, 75);
    const iqr = q3 - q1;

    if (iqr > 0 && dataRange > 0) {
      // Freedman-Diaconis rule
      const h = 2 * iqr * Math.pow(n, -1 / 3);
      numBins = Math.ceil(dataRange / h);
    } else {
      // Sturges' rule fallback
      numBins = Math.ceil(Math.log2(n) + 1);
    }
  }

  // Clamp bin count
  numBins = Math.max(5, Math.min(50, numBins));

  // --- Handle all-identical values ----------------------------------------
  // If range is 0, create a single meaningful bin centred on the value
  const binWidth = dataRange > 0 ? dataRange / numBins : 1;
  const effectiveMin = dataRange > 0 ? minVal : minVal - 0.5;

  // --- Build bins ---------------------------------------------------------
  const bins: HistogramBin[] = [];
  const effectiveNumBins = dataRange > 0 ? numBins : 1;

  for (let i = 0; i < effectiveNumBins; i++) {
    bins.push({
      binStart: effectiveMin + i * binWidth,
      binEnd: effectiveMin + (i + 1) * binWidth,
      count: 0,
      frequency: 0,
    });
  }

  // --- Assign values to bins ----------------------------------------------
  for (let i = 0; i < n; i++) {
    const value = sorted[i] as number;
    // Bin index: floor-based assignment; last bin is inclusive of max
    let binIdx = Math.floor((value - effectiveMin) / binWidth);
    if (binIdx >= effectiveNumBins) binIdx = effectiveNumBins - 1;
    if (binIdx < 0) binIdx = 0;
    (bins[binIdx] as HistogramBin).count++;
  }

  // --- Compute frequencies ------------------------------------------------
  for (const bin of bins) {
    bin.frequency = n > 0 ? bin.count / n : 0;
  }

  return {
    bins,
    binWidth,
    totalCount: n,
  };
}
