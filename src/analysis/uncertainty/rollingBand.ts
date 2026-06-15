/**
 * Rolling robust band for nightly index trends (e.g. nightly AHI).
 *
 * Per consensus D3, the AHI trend headline uses a rolling **median** center
 * with an empirical **inter-quartile band (P25–P75)** of the trailing window —
 * the "typical nightly range". This deliberately replaces the incoherent
 * "median center + mean±SEM band" combination: the IQR band is robust to
 * outlier nights, makes no iid/normality assumption, and sidesteps the
 * autocorrelation / non-stationarity problems that invalidate `x̄ ± z·s/√n`
 * (stats-review §2).
 *
 * @module analysis/uncertainty/rollingBand
 */

import { percentileFromSorted } from '../math';

/** One point of the rolling robust band. */
export interface RollingBandPoint {
  /** Index into the original `values` array this point corresponds to. */
  readonly index: number;
  /** Rolling median (P50) over the trailing window. */
  readonly median: number;
  /** Lower edge of the typical range (P25) over the trailing window. */
  readonly p25: number;
  /** Upper edge of the typical range (P75) over the trailing window. */
  readonly p75: number;
}

/**
 * Compute a per-point rolling median + inter-quartile band over a trailing
 * window.
 *
 * For each index `i`, the window is the values at indices
 * `[max(0, i − window + 1) … i]` (inclusive), i.e. *trailing* and right-
 * aligned. Edge behaviour: for the first `window − 1` points the window is
 * shorter than `window` (it grows from length 1 up to `window`); quantiles are
 * still well-defined on the available points, so no points are dropped and the
 * output length equals the input length.
 *
 * Non-finite values (NaN, ±Infinity) are excluded from each window's quantile
 * computation. If a window contains no finite values, that point's `median`,
 * `p25`, and `p75` are all NaN (the `index` is still emitted).
 *
 * @param values the nightly series (e.g. nightly AHI), in chronological order.
 * @param window the trailing window length (must be ≥ 1; non-finite or < 1
 *   yields an empty result).
 * @returns one {@link RollingBandPoint} per input index.
 */
export function rollingMedianBand(values: number[], window: number): RollingBandPoint[] {
  if (!Number.isFinite(window) || window < 1) return [];
  const w = Math.floor(window);
  const result: RollingBandPoint[] = [];

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - w + 1);
    // Collect finite values in the trailing window and sort them.
    const win: number[] = [];
    for (let j = start; j <= i; j++) {
      const v = values[j];
      if (v !== undefined && Number.isFinite(v)) win.push(v);
    }

    if (win.length === 0) {
      result.push({ index: i, median: NaN, p25: NaN, p75: NaN });
      continue;
    }

    win.sort((a, b) => a - b);
    result.push({
      index: i,
      median: percentileFromSorted(win, 50),
      p25: percentileFromSorted(win, 25),
      p75: percentileFromSorted(win, 75),
    });
  }

  return result;
}
