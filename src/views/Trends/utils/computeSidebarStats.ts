/**
 * Compute descriptive statistics for the Trends sidebar.
 *
 * Lightweight wrapper around the main descriptive statistics module,
 * returning only the fields needed for sidebar summary display.
 *
 * @module views/Trends/utils/computeSidebarStats
 */

export interface MetricStats {
  label: string;
  unit: string;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  trendDirection: 'up' | 'down' | 'stable';
  trendPercent: number;
}

/**
 * Compute mean, median, std dev, min, max, and trend for a numeric array.
 * Trend compares mean of first third vs last third of values (in order).
 */
export function computeMetricStats(
  label: string,
  unit: string,
  values: number[],
): MetricStats | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;

  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);

  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;

  // Trend: compare first third mean to last third mean
  const thirdLen = Math.max(1, Math.floor(n / 3));
  const firstThird = values.slice(0, thirdLen);
  const lastThird = values.slice(n - thirdLen);
  const firstMean = firstThird.reduce((a, v) => a + v, 0) / firstThird.length;
  const lastMean = lastThird.reduce((a, v) => a + v, 0) / lastThird.length;

  let trendDirection: 'up' | 'down' | 'stable' = 'stable';
  let trendPercent = 0;

  if (firstMean !== 0) {
    trendPercent = Math.round(((lastMean - firstMean) / Math.abs(firstMean)) * 100);
    if (trendPercent > 5) trendDirection = 'up';
    else if (trendPercent < -5) trendDirection = 'down';
  }

  return { label, unit, mean, median, stdDev, min, max, trendDirection, trendPercent };
}
