/**
 * Sleep-stage analysis — shared input/output types.
 *
 * This module powers the "Sleep stages & cycles" lens of the Event Explorer.
 * It is intentionally PURE: no IO, no React, no DB access. The IO/hook layer
 * builds the {@link StageSegment} and {@link HrSample} arrays from wearable
 * data and passes them in alongside the device {@link Event} stream.
 *
 * Time convention: every timestamp is epoch milliseconds on the SAME base as
 * {@link Event.timestamp} (wall-clock-as-UTC). Direct numeric comparison
 * between event timestamps and segment boundaries is therefore valid.
 *
 * @module analysis/sleepStages/types
 */

import type { Event, EventType } from '@/types/events';

/**
 * A coarse sleep stage as reported by consumer wearables.
 *
 * Consumer devices typically collapse the AASM stages into four classes:
 * `deep` (≈ N3 / slow-wave sleep), `light` (≈ N1 + N2), `rem` (rapid-eye-movement
 * sleep) and `wake`. We use these string labels throughout rather than the
 * ordinal `SLEEP_STAGE_CODES` used by the chart lanes, because the analyses
 * here are stage-identity based, not ordinal.
 *
 * Caveat: consumer-wearable staging is approximate and is NOT polysomnography
 * (PSG). Stage boundaries, especially deep/light splits, carry meaningful
 * misclassification error. All downstream metrics inherit that uncertainty.
 */
export type SleepStage = 'deep' | 'light' | 'rem' | 'wake';

/**
 * A contiguous interval of a single sleep stage. Half-open `[startMs, endMs)`:
 * `startMs` is included, `endMs` is excluded. `endMs` must be strictly greater
 * than `startMs`; zero/negative-length or non-finite segments are rejected by
 * the consuming functions.
 */
export interface StageSegment {
  /** Sleep stage covering this interval. */
  readonly stage: SleepStage;
  /** Epoch ms — interval start (inclusive). */
  readonly startMs: number;
  /** Epoch ms — interval end (exclusive); must satisfy `endMs > startMs`. */
  readonly endMs: number;
}

/**
 * A single heart-rate sample from a wearable's intraday optical sensor.
 *
 * Cadence is device dependent (Fitbit ≈ 5 s when "real-time" enabled, otherwise
 * coarser). `confidence` is Fitbit's optical-quality flag (0–3) when present;
 * `undefined` means the source did not report a confidence.
 */
export interface HrSample {
  /** Epoch ms of the sample. */
  readonly timestampMs: number;
  /** Heart rate in beats per minute. */
  readonly bpm: number;
  /** Optional optical confidence flag (Fitbit 0–3); higher is better. */
  readonly confidence?: number;
}

/** An {@link Event} annotated with the sleep stage active at its marker time. */
export interface TaggedEvent {
  /** The original device event (unmodified). */
  readonly event: Event;
  /** Stage covering `event.timestamp`, or `null` if no wearable coverage. */
  readonly stage: SleepStage | null;
}

/**
 * Total time spent in each stage plus convenience roll-ups, all in milliseconds.
 * Overlapping input segments are merged per stage so no wall-clock time is
 * double-counted (see {@link stageDurations}).
 */
export interface StageDurations {
  /** Milliseconds of deep (slow-wave) sleep. */
  readonly deep: number;
  /** Milliseconds of light (N1+N2) sleep. */
  readonly light: number;
  /** Milliseconds of REM sleep. */
  readonly rem: number;
  /** Milliseconds scored as wake (within the recorded window). */
  readonly wake: number;
  /** NREM total = deep + light. */
  readonly nremMs: number;
  /** REM total = rem (named for symmetry with `nremMs`). */
  readonly remMs: number;
  /** Asleep total = deep + light + rem (excludes wake). */
  readonly asleepMs: number;
}

/** Per-stage event-rate summary. */
export interface StageEventRate {
  /** Stage bucket; `'unknown'` collects events with `stage === null`. */
  readonly stage: SleepStage | 'unknown';
  /** Number of events assigned to this bucket. */
  readonly count: number;
  /** Hours of recorded time in this stage (NaN-free; 0 when none). */
  readonly hours: number;
  /**
   * Events per hour = `count / hours`. `null` when `hours === 0` (no denominator),
   * which is always the case for the `'unknown'` bucket.
   */
  readonly ratePerHour: number | null;
  /** Per-event-type counts within this bucket. */
  readonly byType: Readonly<Partial<Record<EventType, number>>>;
}

export type { Event, EventType };
