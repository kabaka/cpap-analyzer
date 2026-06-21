/**
 * Insight-input builders — translate the app's already-computed data into the
 * {@link InsightInput} discriminated union the `useAiInsight` hook expects.
 *
 * This is the single place the frontend assembles a grounded-context request
 * from real app data (UX §4.1/§4.2). It does NOT compute any clinical or
 * statistical value itself beyond calling the existing analysis helpers
 * (`linearTrend`) — the compute-then-narrate contract forbids the UI deriving
 * numbers the engine will then narrate (UX §0; design §1). It only:
 *
 *  - resolves the shared {@link GroundingCommonInput} (active AHI thresholds,
 *    display preferences, coarse machine class, generation date) from the
 *    settings store, once, via {@link buildGroundingCommon}; and
 *  - shapes a {@link NightlyAggregate} / a range of aggregates + their already
 *    computed trends into the per-insight `*Input` payloads.
 *
 * Pure given its inputs (the settings snapshot is passed in, never read from a
 * store here) so it is unit-testable and keeps store access at the call site.
 *
 * @module components/insights/buildInsightInput
 */

import {
  AHI_SEVERITY_THRESHOLDS,
  type AhiSeverityThresholds,
} from '@/analysis/clinical/ahiSeverity';
import { linearTrend } from '@/analysis/timeseries';
import { machineClassFromType } from '@/services/llm/context';
import type { DisplayUnitPreferences, MachineClass } from '@/services/llm/context/types';
import type {
  DateRangeTrendInput,
  GroundingCommonInput,
} from '@/services/llm/context/buildGroundedContext';
import type { InsightInput } from '@/services/llm/runInsight';
import { formatDate } from '@/utils/formatDate';
import type { MachineType, NightlyAggregate } from '@/types/session';

// ─── Settings projection the builders consume ────────────────────────────────

/**
 * The minimal projection of the settings store the builders need. The caller
 * (a view / hook) reads the store and passes this snapshot in, keeping these
 * functions store-free and testable.
 */
export interface InsightSettingsSnapshot {
  /** The user's configured AHI severity cutoffs (analysisParams.ahi). */
  readonly ahi: {
    readonly mildThreshold: number;
    readonly moderateThreshold: number;
    readonly severeThreshold: number;
  };
  /** The user's display preferences (settings.display). */
  readonly display: {
    readonly dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
    readonly timeFormat: '12h' | '24h';
  };
}

/**
 * Whether the active AHI thresholds differ from the AASM / ICSD-3 defaults.
 * Drives `ahiThresholdsSource` so the snapshot tells the narrator whether the
 * bands are the user's overrides or the standard (design §1).
 */
function thresholdsSource(
  thresholds: AhiSeverityThresholds,
): GroundingCommonInput['ahiThresholdsSource'] {
  const isDefault =
    thresholds.mild === AHI_SEVERITY_THRESHOLDS.mild &&
    thresholds.moderate === AHI_SEVERITY_THRESHOLDS.moderate &&
    thresholds.severe === AHI_SEVERITY_THRESHOLDS.severe;
  return isDefault ? 'aasm-icsd3-default' : 'user-configured';
}

/**
 * Resolve the shared {@link GroundingCommonInput} from a settings snapshot and
 * the coarse machine class. Call this once per request and spread it into the
 * per-insight builders below.
 *
 * @param settings the projected settings snapshot (active thresholds + display).
 * @param machineClass the coarse, egress-safe device class (never serial/model).
 * @param now the generation instant; defaults to `new Date()`. Only the calendar
 *   date is used (no clock time leaves the device — design §3 R3).
 */
export function buildGroundingCommon(
  settings: InsightSettingsSnapshot,
  machineClass: MachineClass,
  now: Date = new Date(),
): GroundingCommonInput {
  const ahiThresholds: AhiSeverityThresholds = {
    mild: settings.ahi.mildThreshold,
    moderate: settings.ahi.moderateThreshold,
    severe: settings.ahi.severeThreshold,
  };
  const display: DisplayUnitPreferences = {
    dateFormat: settings.display.dateFormat,
    timeFormat: settings.display.timeFormat,
    pressureUnit: 'cmH2O',
    leakUnit: 'L/min',
    tidalVolumeUnit: 'mL',
  };
  return {
    ahiThresholds,
    ahiThresholdsSource: thresholdsSource(ahiThresholds),
    machineClass,
    display,
    generatedOnDate: formatDate(now),
  };
}

/** Resolve the coarse machine class from a therapy mode (or `unknown`). */
export function machineClassOf(type: MachineType | null | undefined): MachineClass {
  return type == null ? 'unknown' : machineClassFromType(type);
}

// ─── Per-insight builders ────────────────────────────────────────────────────

/**
 * Build a "summarize this night" ({@link InsightInput} kind `single-night`)
 * request from one night's aggregate.
 */
export function buildSingleNightInput(
  aggregate: NightlyAggregate,
  common: GroundingCommonInput,
): InsightInput {
  return { kind: 'single-night', aggregate, ...common };
}

/**
 * Build a "clinical context" ({@link InsightInput} kind `clinical-context`)
 * request — situates this night's AHI/usage against the active severity bands
 * and the CMS adherence floor (the band is computed app-side from the active
 * thresholds; the model never re-bands — design §1d).
 */
export function buildClinicalContextInput(
  aggregate: NightlyAggregate,
  common: GroundingCommonInput,
): InsightInput {
  return { kind: 'clinical-context', aggregate, ...common };
}

/**
 * The metrics over which a date-range summary computes and narrates trends.
 * Each maps a {@link NightlyAggregate} field to a label + slope unit. Per-hour
 * rates whose value is `null` for a night (recording too short) are EXCLUDED
 * from that metric's series — never coerced to `0` — so the trend the model
 * narrates is exactly the one the pipeline computed (Correctness, Principle 2).
 */
const TREND_METRICS: ReadonlyArray<{
  readonly metricId: string;
  readonly label: string;
  readonly slopeUnit: string;
  readonly select: (a: NightlyAggregate) => number | null;
}> = [
  { metricId: 'ahi', label: 'AHI', slopeUnit: 'events/h per day', select: (a) => a.ahi },
  { metricId: 'usage', label: 'Usage', slopeUnit: 'h per day', select: (a) => a.usageHours },
  {
    metricId: 'leakMedian',
    label: 'Median leak',
    slopeUnit: 'L/min per day',
    select: (a) => a.leakMedian,
  },
];

/**
 * Compute the already-computed {@link DateRangeTrendInput trends} for a set of
 * aggregates using the existing {@link linearTrend} estimator. A metric is
 * trended only over nights where its value is defined (non-null); a metric with
 * fewer than two defined nights yields no trend (nothing meaningful to narrate).
 *
 * This is the ONE place the UI invokes an analysis helper to produce a value
 * the model will narrate — it delegates entirely to `linearTrend` and never
 * re-implements any statistic.
 */
export function computeDateRangeTrends(
  aggregates: readonly NightlyAggregate[],
): DateRangeTrendInput[] {
  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
  const trends: DateRangeTrendInput[] = [];
  for (const metric of TREND_METRICS) {
    const dates: string[] = [];
    const values: number[] = [];
    for (const agg of sorted) {
      const value = metric.select(agg);
      if (value !== null && Number.isFinite(value)) {
        dates.push(agg.date);
        values.push(value);
      }
    }
    // A trend needs at least two defined points to estimate a slope.
    if (values.length < 2) continue;
    trends.push({
      metricId: metric.metricId,
      label: metric.label,
      slopeUnit: metric.slopeUnit,
      trend: linearTrend(dates, values),
      n: values.length,
    });
  }
  return trends;
}

/**
 * Build a "summarize range" ({@link InsightInput} kind `date-range`) request
 * from a set of aggregates. Trends are computed here via {@link linearTrend}
 * and passed through already finished — the builder never receives raw arrays
 * to trend itself (design §1b). The orchestrator's empty short-circuit handles
 * the too-few-nights case, so this always passes whatever it was given.
 */
export function buildDateRangeInput(
  aggregates: readonly NightlyAggregate[],
  common: GroundingCommonInput,
): InsightInput {
  return {
    kind: 'date-range',
    aggregates,
    trends: computeDateRangeTrends(aggregates),
    ...common,
  };
}
