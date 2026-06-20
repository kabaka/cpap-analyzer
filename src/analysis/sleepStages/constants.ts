/**
 * Sleep-stage analysis — shared constants and the AHI event-type predicate.
 *
 * @module analysis/sleepStages/constants
 */

import type { EventType } from '@/types/events';

/** Milliseconds per hour. */
export const MS_PER_HOUR = 3_600_000;

/** Milliseconds per minute. */
export const MS_PER_MINUTE = 60_000;

/**
 * Event types that count toward the Apnea–Hypopnea Index (AHI).
 *
 * Per AASM scoring (Berry et al., 2012/2017) the AHI is the count of apneas +
 * hypopneas per hour of sleep. RERAs are NOT part of the AHI (they belong to
 * the RDI). `ClearAirway` is ResMed's label for a detected central/clear-airway
 * apnea and counts as an apnea; `UnclassifiedApnea` is a device-detected apnea
 * not resolved into a subtype and still counts.
 */
export const AHI_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'ObstructiveApnea',
  'CentralApnea',
  'MixedApnea',
  'UnclassifiedApnea',
  'ClearAirway',
  'Hypopnea',
]);

/** True iff the event type contributes to the AHI. */
export function isAhiEvent(type: EventType): boolean {
  return AHI_EVENT_TYPES.has(type);
}

/** The three scored SLEEP stages used in concentration analyses (wake excluded). */
export const SLEEP_STAGES = ['deep', 'light', 'rem'] as const;
