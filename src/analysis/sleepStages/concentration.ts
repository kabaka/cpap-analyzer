/**
 * Event–stage concentration test.
 *
 * Answers the core inferential question of the sleep-stage lens: *do
 * apnea/hypopnea events concentrate in particular sleep stages, beyond what
 * time-in-stage alone would predict?*
 *
 * Statistical framing — Poisson/multinomial goodness-of-fit. Under the null
 * hypothesis H0 "events occur at a stage-independent constant rate λ (events per
 * hour)", the number of AHI-type events scored in a stage is, conditional on the
 * total event count N, multinomially distributed with cell probabilities equal
 * to the fraction of sleep time spent in that stage. (Equivalently, per-stage
 * counts are independent Poisson with mean λ·tᵢ; conditioning on N gives the
 * multinomial.) Pearson's chi-square statistic
 *
 *   X² = Σᵢ (Oᵢ − Eᵢ)² / Eᵢ ,   Eᵢ = N · (tᵢ / Σ t) ,
 *
 * is asymptotically χ² with df = (#cells with positive time) − 1 (one df is
 * lost because the expected counts are scaled to the observed total N).
 *
 * Scope: only the three SLEEP stages {deep, light, rem} are tested. Events
 * scored during `wake` or during uncovered time are excluded — they are not the
 * question, and including them would conflate "events while awake" with the
 * stage-dependence of sleep-disordered breathing.
 *
 * Validity guards (Cochran's rule): the χ² approximation is unreliable when
 * expected counts are small. We require total events ≥ {@link MIN_EVENTS_FOR_TEST}
 * and every used cell to have expected ≥ 5. When unmet, `sufficientData` is
 * `false`, the descriptive observed/expected counts are still returned, and the
 * reported p-value MUST be treated as not reliable.
 *
 * @module analysis/sleepStages/concentration
 */

import { lowerGammaRegularized } from '@/analysis/math';
import { isAhiEvent, MS_PER_HOUR } from './constants';
import type { StageDurations, TaggedEvent } from './types';

/** Minimum total AHI-type events required for a reliable χ² test. */
export const MIN_EVENTS_FOR_TEST = 20;

/** Minimum expected count per used cell (Cochran's rule of thumb). */
export const MIN_EXPECTED_PER_CELL = 5;

/** The sleep stages considered by the concentration test. */
export type ConcentrationStage = 'deep' | 'light' | 'rem';

/** Result of {@link eventStageConcentrationTest}. */
export interface ConcentrationTestResult {
  /** Pearson χ² statistic (NaN when it cannot be computed). */
  readonly chiSquare: number;
  /** Degrees of freedom = (#stages with positive time) − 1 (NaN if undefined). */
  readonly df: number;
  /** Upper-tail p-value P(χ²_df ≥ chiSquare); NaN when undefined. */
  readonly pValue: number;
  /** Observed AHI-type event counts per sleep stage. */
  readonly observed: Readonly<Record<ConcentrationStage, number>>;
  /** Expected counts per sleep stage under H0 (proportional to time-in-stage). */
  readonly expected: Readonly<Record<ConcentrationStage, number>>;
  /** Total AHI-type events across the three sleep stages. */
  readonly totalEvents: number;
  /** Total sleep time across the three stages, in hours. */
  readonly totalSleepHours: number;
  /** Which stages had positive time and so contributed a cell. */
  readonly stagesUsed: readonly ConcentrationStage[];
  /**
   * `true` only when all validity guards are met (enough events and every used
   * cell's expected ≥ 5). When `false`, treat `pValue` as not reliable.
   */
  readonly sufficientData: boolean;
}

/**
 * Chi-square goodness-of-fit test for whether AHI-type events concentrate in
 * particular sleep stages relative to time spent in each stage.
 *
 * @param taggedEvents output of `tagEventsByStage` (only AHI-type, non-wake,
 *                     covered events are used)
 * @param durations    output of `stageDurations`
 */
export function eventStageConcentrationTest(
  taggedEvents: readonly TaggedEvent[],
  durations: StageDurations,
): ConcentrationTestResult {
  const observed: Record<ConcentrationStage, number> = { deep: 0, light: 0, rem: 0 };
  for (const { event, stage } of taggedEvents) {
    if (stage === 'deep' || stage === 'light' || stage === 'rem') {
      if (isAhiEvent(event.type)) observed[stage] += 1;
    }
  }

  const timeMs: Record<ConcentrationStage, number> = {
    deep: durations.deep,
    light: durations.light,
    rem: durations.rem,
  };
  const totalTimeMs = timeMs.deep + timeMs.light + timeMs.rem;
  const totalSleepHours = totalTimeMs / MS_PER_HOUR;
  const totalEvents = observed.deep + observed.light + observed.rem;

  const stagesUsed = (['deep', 'light', 'rem'] as const).filter((s) => timeMs[s] > 0);

  // Expected counts proportional to time-in-stage, scaled to the observed total.
  const expected: Record<ConcentrationStage, number> = { deep: 0, light: 0, rem: 0 };
  if (totalTimeMs > 0 && totalEvents > 0) {
    for (const s of stagesUsed) {
      expected[s] = totalEvents * (timeMs[s] / totalTimeMs);
    }
  }

  // df undefined when fewer than 2 stages have positive time.
  const df = stagesUsed.length >= 2 ? stagesUsed.length - 1 : NaN;

  let chiSquare = NaN;
  let pValue = NaN;
  if (Number.isFinite(df) && totalEvents > 0) {
    let x2 = 0;
    for (const s of stagesUsed) {
      const e = expected[s];
      if (e > 0) {
        const diff = observed[s] - e;
        x2 += (diff * diff) / e;
      }
    }
    chiSquare = x2;
    // Upper-tail p-value: 1 − F_{χ²,df}(X²) = 1 − P(df/2, X²/2).
    pValue = 1 - lowerGammaRegularized(df / 2, x2 / 2);
  }

  const everyCellExpectedOk = stagesUsed.every((s) => expected[s] >= MIN_EXPECTED_PER_CELL);
  const sufficientData =
    Number.isFinite(df) && totalEvents >= MIN_EVENTS_FOR_TEST && everyCellExpectedOk;

  return {
    chiSquare,
    df,
    pValue,
    observed,
    expected,
    totalEvents,
    totalSleepHours,
    stagesUsed,
    sufficientData,
  };
}
