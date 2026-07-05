/**
 * Display-only trend delta for the Signal Deck sparkline cells.
 *
 * This is NOT a clinical statistic — it is the small "↑ +6%" affordance beside a
 * sparkline. It mirrors the convention used by `useSummaryStats.computeTrendPercent`
 * (first-window average vs last-window average, window = `min(7, ⌊n/2⌋)`) so the
 * deck's ad-hoc deltas agree with the app's canonical trend percents where both
 * exist. It reuses {@link seriesMean} (the canonical null-skipping mean) rather
 * than re-summing, so `null` gaps are skipped, never treated as `0`.
 *
 * Used only for signals the summary-stats hook does not already expose a trend
 * for (central index, leak P95, resting HR, HRV). For AHI / leak / usage /
 * pressure the deck uses the hook's own `trend*Percent`.
 *
 * @module views/Dashboard/signalDeck/seriesTrend
 */

import { seriesMean } from './metrics';

/**
 * Percent change between the first- and last-window means of a null-aware series.
 *
 * @param values - Series oldest → newest; `null` entries are gaps.
 * @returns Signed percent change, or `0` when there are too few defined points
 *   or the baseline mean is `0`.
 */
export function seriesTrendPercent(values: readonly (number | null)[]): number {
  const defined = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (defined.length < 4) return 0;
  const window = Math.min(7, Math.floor(defined.length / 2));
  const first = seriesMean(defined.slice(0, window));
  const last = seriesMean(defined.slice(-window));
  if (first === null || last === null || first === 0) return 0;
  return ((last - first) / first) * 100;
}
