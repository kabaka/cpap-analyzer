/**
 * Central-apnea (Clear-Airway) trend detection — safety-critical (consensus D6).
 *
 * The central-vs-obstructive split is a **low-reliability** modelled inference,
 * so its *precision* must be qualified. But a low-reliability label must NEVER
 * silence or visually bury a *rising* central trend: under-reaction to
 * treatment-emergent central apnea is the dangerous failure mode (consensus D6,
 * security S-1). This helper detects a rising central trend so the UI can
 * surface a persistent, visible "discuss with your clinician" prompt that is
 * independent of (and not dimmed by) the reliability caveat.
 *
 * The framing is intentionally non-diagnostic and never therapy-specific: it
 * prompts a conversation, it does not name a condition or a treatment.
 *
 * @module views/Trends/utils/centralTrend
 */

import type { NightlyAggregate } from '@/types';

/**
 * Nights below this usage threshold carry too few breaths for a stable per-hour
 * central rate and are excluded. (Distinct from the CMS 4 h compliance floor —
 * this is about rate stability, not adherence accounting.)
 */
export const MIN_CENTRAL_USAGE_HOURS = 1;

/**
 * Minimum qualifying nights in EACH half before a trend comparison is made.
 * Below this we have too little data to claim a "trend" at all.
 */
export const MIN_NIGHTS_PER_HALF = 3;

/**
 * Relative increase (later half vs earlier half) that counts as "rising".
 * A modest 25% lift, gated by an absolute floor so noise near zero does not
 * trip it.
 */
export const RISING_RELATIVE_THRESHOLD = 0.25;

/**
 * Absolute later-half central index (events/h) below which we never raise the
 * prompt, regardless of relative change — keeps near-zero noise from tripping
 * a clinical conversation prompt.
 */
export const RISING_ABSOLUTE_FLOOR = 1.0;

export interface CentralTrendResult {
  /** Whether the central index is rising enough to prompt a conversation. */
  readonly rising: boolean;
  /** Usage-weighted central index over the earlier half (events/h). */
  readonly earlierIndex: number;
  /** Usage-weighted central index over the later half (events/h). */
  readonly laterIndex: number;
}

/** Usage-weighted central index over a slice (total central events / total h). */
function weightedCentralIndex(nights: readonly NightlyAggregate[]): number {
  let eventHours = 0;
  let usageHours = 0;
  for (const n of nights) {
    // Null-handling (skip-night): a null central index is an UNDEFINED rate
    // (recording below the rate-validity floor), not zero. Such a night
    // contributes nothing to this duration-weighted pooled rate. The ≥ 1 h
    // usage gate already excludes sub-floor nights, but the explicit null guard
    // keeps the contract intent clear and survives any gate change.
    if (n.usageHours >= MIN_CENTRAL_USAGE_HOURS && n.ahiCentral !== null) {
      eventHours += n.ahiCentral * n.usageHours;
      usageHours += n.usageHours;
    }
  }
  return usageHours > 0 ? eventHours / usageHours : 0;
}

/**
 * Detect whether the central (Clear-Airway) index is rising across the window.
 *
 * Splits the chronologically-ordered nights into an earlier and a later half
 * (each filtered to nights with ≥ {@link MIN_CENTRAL_USAGE_HOURS}), computes a
 * usage-weighted central index for each, and reports `rising` when the later
 * half is at least {@link RISING_RELATIVE_THRESHOLD} above the earlier half AND
 * the later half is at least {@link RISING_ABSOLUTE_FLOOR} events/h.
 *
 * Robust to ordering of the input (sorts by date) and to short/empty input
 * (returns `rising: false`). Usage-weighting prevents a single short night with
 * a spuriously high nightly index from tripping the prompt.
 *
 * @param aggregates nightly aggregates (any order).
 */
export function detectRisingCentralTrend(
  aggregates: readonly NightlyAggregate[],
): CentralTrendResult {
  const none: CentralTrendResult = { rising: false, earlierIndex: 0, laterIndex: 0 };

  const qualifying = aggregates.filter((a) => a.usageHours >= MIN_CENTRAL_USAGE_HOURS);
  if (qualifying.length < MIN_NIGHTS_PER_HALF * 2) return none;

  const sorted = [...qualifying].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const earlier = sorted.slice(0, mid);
  const later = sorted.slice(sorted.length - mid);

  if (earlier.length < MIN_NIGHTS_PER_HALF || later.length < MIN_NIGHTS_PER_HALF) {
    return none;
  }

  const earlierIndex = weightedCentralIndex(earlier);
  const laterIndex = weightedCentralIndex(later);

  const rising =
    laterIndex >= RISING_ABSOLUTE_FLOOR &&
    laterIndex >= earlierIndex * (1 + RISING_RELATIVE_THRESHOLD);

  return { rising, earlierIndex, laterIndex };
}
