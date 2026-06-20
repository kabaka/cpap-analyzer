/**
 * Sleep Stages & Cycles Analysis Module
 *
 * Pure (no IO/React/DB) analyses for the "Sleep stages & cycles" lens of the
 * Event Explorer. Given a device event stream, a wearable hypnogram
 * ({@link StageSegment}[]) and optional intraday heart rate ({@link HrSample}[]),
 * it computes:
 *
 *   • stage tagging of events and time-in-stage          ({@link staging})
 *   • per-stage event rates                              ({@link staging})
 *   • a chi-square stage-concentration test              ({@link concentration})
 *   • REM-predominant/REM-related OSA classification     ({@link remOsa})
 *   • an across-nights paired REM-vs-NREM test           ({@link remOsa})
 *   • NREM–REM cycle derivation and per-cycle load       ({@link cycles})
 *   • event-triggered HR (CVHR) surge analysis           ({@link autonomic})
 *
 * Clinical/statistical sources are cited in each sub-module's doc comment.
 * This tool is descriptive and does NOT diagnose.
 *
 * @module analysis/sleepStages
 */

// Types
export type {
  SleepStage,
  StageSegment,
  HrSample,
  TaggedEvent,
  StageDurations,
  StageEventRate,
} from './types';

// Constants & predicates
export { AHI_EVENT_TYPES, isAhiEvent, SLEEP_STAGES, MS_PER_HOUR, MS_PER_MINUTE } from './constants';

// 1–3: tagging, durations, rates
export {
  tagEventsByStage,
  stageDurations,
  eventRatesByStage,
  sanitizeSegments,
  type EventRatesOptions,
} from './staging';

// 4: concentration test
export {
  eventStageConcentrationTest,
  MIN_EVENTS_FOR_TEST,
  MIN_EXPECTED_PER_CELL,
  type ConcentrationStage,
  type ConcentrationTestResult,
} from './concentration';

// 5–6: REM-OSA pattern and across-nights paired test
export {
  remOsaPattern,
  remVsNremAcrossNights,
  REM_RATIO_THRESHOLD,
  REM_PREDOMINANT_NREM_AHI_MAX,
  MIN_REM_MINUTES,
  MIN_NREM_MINUTES,
  MIN_PAIRED_NIGHTS,
  type RemOsaClassification,
  type RemOsaResult,
  type NightInput,
  type RemVsNremAcrossNightsResult,
} from './remOsa';

// 7: cycle derivation and per-cycle load
export {
  deriveSleepCycles,
  assignEventsToCycles,
  eventLoadByCycle,
  cyclePositionTrend,
  REM_MERGE_GAP_MIN,
  type Cycle,
  type CycleTaggedEvent,
  type CycleLoadOptions,
  type CycleEventLoad,
  type CyclePositionTrend,
} from './cycles';

// 8: autonomic HR response
export {
  eventTriggeredHr,
  type EventTriggeredHrOptions,
  type AverageProfilePoint,
  type EventTriggeredHrResult,
} from './autonomic';
