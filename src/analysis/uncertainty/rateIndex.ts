/**
 * Centralised per-hour RATE-INDEX computation and aggregation.
 *
 * Every events-per-hour index in the app (AHI, RDI, the AHI sub-indices, ODI)
 * is `eventCount / recordingHours`. That quotient is only meaningful when the
 * recording is long enough: as the denominator approaches zero a single event
 * produces an arbitrarily large, physiologically meaningless rate (`1 event /
 * (1/3600) h = 3600`/h). This module is the ONE place that enforces the
 * {@link MIN_INDEX_USAGE_HOURS} rate-validity floor, so no caller can
 * reintroduce an unguarded `count / hours`.
 *
 * Two operations live here:
 *
 * 1. {@link rateIndex} — per-session: a count over recording hours, or `null`
 *    when the recording is below the floor (the rate is *undefined*, not zero).
 * 2. {@link pooledRate} — cross-session: the duration-weighted pooled rate
 *    `Σ(rate_i · hours_i) / Σ(hours_i)`, which is algebraically the correct
 *    pooled `Σevents / Σhours`. Sessions with a `null` rate (below the floor)
 *    are excluded — they contribute neither events nor hours.
 *
 * All functions are pure and deterministic.
 *
 * @module analysis/uncertainty/rateIndex
 */

import { MIN_INDEX_USAGE_HOURS } from './constants';

/**
 * Compute a per-hour rate index, enforcing the rate-validity floor.
 *
 * @param count - Non-negative event count over the recording.
 * @param recordingHours - Recording time the count is spread over (usage hours
 *   for AHI/RDI; valid-oximetry hours for ODI).
 * @param minHours - Floor below which the rate is undefined. Defaults to
 *   {@link MIN_INDEX_USAGE_HOURS}; ODI passes its own oximetry-coverage floor.
 * @returns The rate in events/hour, or `null` when `recordingHours` is below
 *   the floor (or non-finite/≤ 0). `null` means "no defined rate" and must be
 *   propagated as a gap — never coerced to 0.
 */
export function rateIndex(
  count: number,
  recordingHours: number,
  minHours: number = MIN_INDEX_USAGE_HOURS,
): number | null {
  if (!Number.isFinite(recordingHours) || recordingHours < minHours) return null;
  return count / recordingHours;
}

/** A single session's contribution to a pooled rate. */
export interface RateContribution {
  /** This session's per-hour rate, or `null` if its recording was below floor. */
  readonly rate: number | null;
  /** This session's recording (usage) hours — the pooling weight. */
  readonly hours: number;
}

/**
 * Duration-weighted pooled rate across sessions, excluding undefined rates.
 *
 * Computes `Σ(rate_i · hours_i) / Σ(hours_i)` over sessions whose `rate` is
 * non-null and whose `hours` are positive. Because `rate_i · hours_i`
 * reconstructs that session's event count, this equals the pooled
 * `Σevents / Σhours` — the statistically correct way to combine per-hour rates
 * of unequal duration. A plain unweighted mean over-weights short nights and is
 * the second half of the inflated-AHI bug.
 *
 * @param contributions - Per-session rate + hours pairs.
 * @returns The pooled rate, or `null` when no session qualifies (every rate is
 *   null, or total weight is non-positive).
 */
export function pooledRate(contributions: readonly RateContribution[]): number | null {
  let weighted = 0;
  let totalHours = 0;
  for (const c of contributions) {
    if (c.rate === null) continue;
    if (!Number.isFinite(c.hours) || c.hours <= 0) continue;
    weighted += c.rate * c.hours;
    totalHours += c.hours;
  }
  return totalHours > 0 ? weighted / totalHours : null;
}
