/**
 * Survival Analysis Module
 *
 * Implements Kaplan-Meier survival estimation for CPAP therapy data.
 * Primary use cases:
 * - **Usage compliance**: Duration until reaching 4 hours each night
 *   (censored = mask removed early).
 * - **Apnea event duration**: Time until an apnea event ends (fully observed).
 * - **Time-to-improvement**: Days until AHI drops below 5 (censored = stopped
 *   therapy before improvement).
 *
 * References:
 * - Kaplan, E. L. & Meier, P. (1958). "Nonparametric Estimation from
 *   Incomplete Observations." JASA 53(282):457–481.
 * - Greenwood, M. (1926). "The Natural Duration of Cancer." Reports on
 *   Public Health and Medical Subjects, No. 33.
 *
 * @module analysis/survival
 */

import { at } from '@/analysis/math';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Observation record used internally for sorting and walking.
 */
interface Observation {
  readonly time: number;
  readonly isEvent: boolean;
}

/**
 * Result of a Kaplan-Meier survival analysis.
 *
 * All arrays are aligned — index `i` refers to the same distinct event time
 * across every array.
 */
export interface KaplanMeierResult {
  /** Distinct event times (ascending). */
  readonly times: readonly number[];
  /** Estimated survival probability S(t) at each event time. */
  readonly survivors: readonly number[];
  /** Number of events d_i at each event time. */
  readonly events: readonly number[];
  /** Number at risk n_i just before each event time. */
  readonly atRisk: readonly number[];
  /** 95 % confidence interval lower bound (log-log transform). */
  readonly ciLower: readonly number[];
  /** 95 % confidence interval upper bound (log-log transform). */
  readonly ciUpper: readonly number[];
  /** Smallest time t where S(t) ≤ 0.5, or null if S never drops to 0.5. */
  readonly medianSurvivalTime: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** z_{0.025} for 95 % two-sided CI. */
const Z_ALPHA = 1.96;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable-sorted array of observations from parallel duration / event
 * arrays. Filters out pairs where the duration is not finite.
 *
 * Stable sort orders by time ascending; at tied times events come *after*
 * censored observations so that censored subjects are still counted at risk
 * for the event time.  (Standard convention: censored-before means they are
 * at risk at that time; events are then applied.)
 *
 * @internal
 */
function buildSortedObservations(
  durations: readonly number[],
  events: readonly boolean[],
): Observation[] {
  const obs: Observation[] = [];
  const n = Math.min(durations.length, events.length);

  for (let i = 0; i < n; i++) {
    const t = durations[i];
    if (t !== undefined && Number.isFinite(t)) {
      obs.push({ time: t, isEvent: events[i] === true });
    }
  }

  // Stable sort: ascending time, censored before events at ties.
  obs.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    // false (0) before true (1) → censored before events
    return (a.isEvent ? 1 : 0) - (b.isEvent ? 1 : 0);
  });

  return obs;
}

/**
 * Compute the log-log transformed 95 % CI for S(t).
 *
 * Transformation: W(t) = ln(-ln(S(t)))
 * SE(W) = sqrt(Var(S(t))) / (S(t) × |ln(S(t))|)
 * CI_W  = W(t) ± z × SE(W)
 * Back-transform: CI = exp(-exp(CI_W))
 *
 * Returns [lower, upper] clamped to [0, 1].
 *
 * @internal
 */
function logLogCI(survival: number, greenwoodVariance: number): [lower: number, upper: number] {
  // Degenerate cases: S = 0 or S = 1 have no meaningful CI via log-log.
  if (survival <= 0) return [0, 0];
  if (survival >= 1) return [1, 1];

  const logS = Math.log(survival);
  // logS is negative when 0 < S < 1 so |logS| = -logS
  if (logS === 0) return [survival, survival];

  const se = Math.sqrt(greenwoodVariance) / (survival * Math.abs(logS));
  const w = Math.log(-logS);

  const wLower = w - Z_ALPHA * se;
  const wUpper = w + Z_ALPHA * se;

  const ciLower = Math.exp(-Math.exp(wUpper)); // note: reversed
  const ciUpper = Math.exp(-Math.exp(wLower));

  return [Math.max(0, Math.min(1, ciLower)), Math.max(0, Math.min(1, ciUpper))];
}

// ---------------------------------------------------------------------------
// Empty result singleton
// ---------------------------------------------------------------------------

const EMPTY_RESULT: KaplanMeierResult = Object.freeze({
  times: Object.freeze([]) as readonly number[],
  survivors: Object.freeze([]) as readonly number[],
  events: Object.freeze([]) as readonly number[],
  atRisk: Object.freeze([]) as readonly number[],
  ciLower: Object.freeze([]) as readonly number[],
  ciUpper: Object.freeze([]) as readonly number[],
  medianSurvivalTime: null,
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute Kaplan-Meier survival estimates from duration / event data.
 *
 * ## Algorithm
 *
 * For each distinct event time $t_i$ (times where at least one event occurred):
 *
 * $$\hat{S}(t) = \prod_{t_i \leq t} \left(1 - \frac{d_i}{n_i}\right)$$
 *
 * where $d_i$ is the number of events at $t_i$ and $n_i$ is the number of subjects
 * still at risk just before $t_i$.
 *
 * ### Variance — Greenwood's formula
 *
 * $$\text{Var}(\hat{S}(t)) = \hat{S}(t)^2 \sum_{t_i \leq t} \frac{d_i}{n_i(n_i - d_i)}$$
 *
 * ### Confidence intervals — log-log transformation
 *
 * The log-log transform guarantees CIs stay in $[0, 1]$:
 *
 * $W(t) = \ln(-\ln(\hat{S}(t)))$,
 * $\text{SE}(W) = \frac{\sqrt{\text{Var}(\hat{S}(t))}}{\hat{S}(t) \cdot |\ln(\hat{S}(t))|}$
 *
 * Back-transform: $\text{CI} = \exp(-\exp(W \pm z \cdot \text{SE}(W)))$
 *
 * ### Median survival time
 *
 * The smallest $t$ where $\hat{S}(t) \leq 0.5$, or null if $\hat{S}$ never reaches 0.5.
 *
 * @param durations - Observed time for each subject (e.g. hours, days).
 * @param events    - Whether the event of interest occurred (true) or the
 *                    observation was censored (false) for each subject.
 * @returns Kaplan-Meier survival table with CIs.
 *
 * @example
 * ```ts
 * const result = kaplanMeier(
 *   [1, 2, 3, 4, 5],
 *   [true, false, true, true, false],
 * );
 * // result.times      → [1, 3, 4]
 * // result.survivors   → stepwise decreasing
 * // result.medianSurvivalTime → time where S ≤ 0.5
 * ```
 *
 * @see {@link https://en.wikipedia.org/wiki/Kaplan%E2%80%93Meier_estimator}
 */
export function kaplanMeier(durations: number[], events: boolean[]): KaplanMeierResult {
  // ── Validation ──────────────────────────────────────────────────────
  if (durations.length !== events.length) {
    throw new RangeError(
      `durations (${durations.length}) and events (${events.length}) must have the same length`,
    );
  }

  // ── Build sorted observation table ─────────────────────────────────
  const obs = buildSortedObservations(durations, events);
  if (obs.length === 0) return EMPTY_RESULT;

  // ── Walk observations and collect event-time records ────────────────
  // We iterate in sorted order, tracking the number at risk.  At each
  // distinct event time we record counts for d_i and n_i.

  const timesOut: number[] = [];
  const eventsOut: number[] = [];
  const atRiskOut: number[] = [];

  let nAtRisk = obs.length;
  let idx = 0;

  while (idx < obs.length) {
    const currentEntry = obs[idx];
    if (!currentEntry) break;
    const currentTime = currentEntry.time;

    // Count censored observations at this time (they come first in sort).
    let censoredHere = 0;
    let cursor = obs[idx];
    while (cursor && cursor.time === currentTime && !cursor.isEvent) {
      censoredHere++;
      idx++;
      cursor = obs[idx];
    }

    // Count events at this time.
    let eventsHere = 0;
    cursor = obs[idx];
    while (cursor && cursor.time === currentTime && cursor.isEvent) {
      eventsHere++;
      idx++;
      cursor = obs[idx];
    }

    // Only record a step when there are actual events.
    if (eventsHere > 0) {
      // n_i includes censored subjects at the same time (they are still at
      // risk at the moment of the event).
      timesOut.push(currentTime);
      atRiskOut.push(nAtRisk);
      eventsOut.push(eventsHere);
    }

    // Remove censored + events from at-risk pool for subsequent times.
    nAtRisk -= censoredHere + eventsHere;
  }

  // All observations were censored → no event times recorded.
  if (timesOut.length === 0) return EMPTY_RESULT;

  // ── Compute S(t), Greenwood variance, and CIs ─────────────────────
  const survivorsOut: number[] = [];
  const ciLowerOut: number[] = [];
  const ciUpperOut: number[] = [];

  let s = 1;
  let greenwoodSum = 0;
  let medianSurvivalTime: number | null = null;

  for (let i = 0; i < timesOut.length; i++) {
    const di = at(eventsOut, i);
    const ni = at(atRiskOut, i);

    s *= 1 - di / ni;
    survivorsOut.push(s);

    // Greenwood variance accumulation.
    // Guard: if n_i === d_i the denominator n_i*(n_i - d_i) is 0.
    // Cap by treating the contribution as 1/n_i (maximum single-step info).
    if (ni > di) {
      greenwoodSum += di / (ni * (ni - di));
    } else {
      // All at risk experienced the event; cap variance contribution.
      greenwoodSum += 1 / ni;
    }

    const variance = s * s * greenwoodSum;

    const [lo, hi] = logLogCI(s, variance);
    ciLowerOut.push(lo);
    ciUpperOut.push(hi);

    if (medianSurvivalTime === null && s <= 0.5) {
      medianSurvivalTime = at(timesOut, i);
    }
  }

  return {
    times: timesOut,
    survivors: survivorsOut,
    events: eventsOut,
    atRisk: atRiskOut,
    ciLower: ciLowerOut,
    ciUpper: ciUpperOut,
    medianSurvivalTime,
  };
}
