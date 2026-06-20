/**
 * Cross-source metric definitions and extraction/join helpers for the
 * {@link IntegrationAnalysis} view.
 *
 * Pure, framework-free, and unit-testable in isolation: CPAP, wearable, and
 * weather metric catalogues, the unified "comparison metric" abstraction
 * (wearable ∪ weather), availability filters, and the date-aligned series
 * extraction the three correlation tabs share. The numeric correlation /
 * Bland-Altman / lagged-CCF math is consumed unchanged from
 * `@/analysis/crossSource`.
 *
 * Kept in a separate module (not the view) so the view file only exports its
 * React component (Fast-Refresh friendly) and so these helpers can be tested
 * without rendering.
 *
 * @module views/Explore/integrationMetrics
 */

import type { JoinedDayRecord, JoinedWeatherRecord } from '@/hooks/useCorrelationData';
import type { WearableSummary } from '@/hooks/useWearableSummary';
import type { WeatherNightly } from '@/analysis/weather';
import type { FitbitDailyType } from '@/types/fitbit';
import type { NightlyAggregate } from '@/types/session';

// ---------------------------------------------------------------------------
// CPAP metric definitions
// ---------------------------------------------------------------------------

export interface CpapMetricDef {
  readonly key: string;
  readonly label: string;
  /**
   * Per-night metric accessor. Per-hour rate indices (AHI and its sub-indices)
   * are `number | null`: `null` is an UNDEFINED rate (recording below
   * MIN_INDEX_USAGE_HOURS), never zero. `extractCpapFromJoined` drops null
   * (and non-finite) values pairwise so correlations only see defined nights.
   */
  readonly extract: (agg: NightlyAggregate) => number | null;
}

export const CPAP_METRICS: readonly CpapMetricDef[] = [
  { key: 'ahi', label: 'AHI', extract: (a) => a.ahi },
  { key: 'ahiObstructive', label: 'Obstructive AI', extract: (a) => a.ahiObstructive },
  { key: 'ahiCentral', label: 'Central AI', extract: (a) => a.ahiCentral },
  { key: 'ahiHypopnea', label: 'Hypopnea Index', extract: (a) => a.ahiHypopnea },
  { key: 'pressureMean', label: 'Pressure Mean', extract: (a) => a.pressureMean },
  { key: 'pressureP95', label: 'Pressure 95th', extract: (a) => a.pressureP95 },
  { key: 'leakMedian', label: 'Leak Median', extract: (a) => a.leakMedian },
  { key: 'leakP95', label: 'Leak 95th', extract: (a) => a.leakP95 },
  { key: 'usageHours', label: 'Usage Hours', extract: (a) => a.usageHours },
];

// ---------------------------------------------------------------------------
// Wearable metric definitions
// ---------------------------------------------------------------------------

export interface WearableMetricDef {
  readonly dataType: FitbitDailyType;
  readonly path: string;
  readonly label: string;
}

export const WEARABLE_METRICS: readonly WearableMetricDef[] = [
  { dataType: 'sleep_score', path: 'overallScore', label: 'Sleep Score' },
  { dataType: 'sleep_score', path: 'compositionScore', label: 'Sleep Composition' },
  { dataType: 'sleep_score', path: 'durationScore', label: 'Sleep Duration Score' },
  { dataType: 'sleep_score', path: 'deepSleepMinutes', label: 'Deep Sleep (min)' },
  { dataType: 'hrv_daily', path: 'dailyRmssd', label: 'HRV (RMSSD)' },
  { dataType: 'hrv_daily', path: 'deepRmssd', label: 'HRV Deep Sleep' },
  { dataType: 'spo2_daily', path: 'avg', label: 'SpO₂ Average' },
  { dataType: 'spo2_daily', path: 'min', label: 'SpO₂ Minimum' },
  { dataType: 'respiratory_rate', path: 'fullSleepRate', label: 'Respiratory Rate' },
  { dataType: 'heart_rate_resting', path: 'restingHeartRate', label: 'Resting Heart Rate' },
  { dataType: 'readiness', path: 'score', label: 'Readiness Score' },
  { dataType: 'stress', path: 'score', label: 'Stress Score' },
  { dataType: 'temperature', path: 'nightlyDeviation', label: 'Skin Temp Deviation' },
  { dataType: 'activity_daily', path: 'steps', label: 'Steps' },
  { dataType: 'activity_daily', path: 'activeZoneMinutes', label: 'Active Zone Minutes' },
  { dataType: 'snoring_daily', path: 'totalDurationMinutes', label: 'Snoring Duration' },
] as const;

// ---------------------------------------------------------------------------
// Weather & environment metric definitions
// ---------------------------------------------------------------------------

export interface WeatherMetricDef {
  readonly key: string;
  readonly label: string;
  /**
   * Per-night metric accessor over the canonical {@link WeatherNightly} record.
   * Returns `number | null`; `null` is a missing reading (never a fabricated 0)
   * and is dropped pairwise so correlations only see defined nights.
   */
  readonly extract: (n: WeatherNightly) => number | null;
}

/**
 * Weather/air-quality metrics available for correlation. Barometric pressure is
 * the headline clinical variable (pressure swings vs. apnea/central events) and
 * is listed first. Each metric is filtered to what was actually synced (see
 * {@link filterAvailableWeatherMetrics}).
 */
export const WEATHER_METRICS: readonly WeatherMetricDef[] = [
  { key: 'pressureMslMean', label: 'Barometric Pressure', extract: (n) => n.pressureMslMean },
  { key: 'pressureChange', label: 'Pressure Change (overnight)', extract: (n) => n.pressureChange },
  { key: 'humidityMean', label: 'Humidity', extract: (n) => n.humidityMean },
  { key: 'dewpointMean', label: 'Dew Point', extract: (n) => n.dewpointMean },
  { key: 'temperatureLow', label: 'Temperature (overnight low)', extract: (n) => n.temperatureLow },
  { key: 'precipitationSum', label: 'Precipitation', extract: (n) => n.precipitationSum },
  { key: 'windMean', label: 'Wind', extract: (n) => n.windMean },
  { key: 'usAqiMean', label: 'US AQI', extract: (n) => n.usAqiMean },
  { key: 'europeanAqiMean', label: 'European AQI', extract: (n) => n.europeanAqiMean },
  { key: 'pm25Mean', label: 'PM2.5', extract: (n) => n.pm25Mean },
  { key: 'pm10Mean', label: 'PM10', extract: (n) => n.pm10Mean },
  { key: 'ozoneMean', label: 'Ozone', extract: (n) => n.ozoneMean },
  { key: 'nitrogenDioxideMean', label: 'NO₂', extract: (n) => n.nitrogenDioxideMean },
] as const;

// ---------------------------------------------------------------------------
// Unified "comparison metric" abstraction (wearable ∪ weather)
// ---------------------------------------------------------------------------

/**
 * A right-hand "Compare against" metric. Both wearable and weather metrics are
 * normalised to this shape so the Correlation Explorer, Matrix, and Metric
 * Comparison tabs share one selector and one extraction path. The numeric
 * correlation / Bland-Altman / lagged-CCF math is reused unchanged.
 */
export interface ComparisonMetricDef {
  /** Stable identifier, namespaced by group (e.g. `wearable:0`, `weather:usAqiMean`). */
  readonly id: string;
  readonly label: string;
  readonly group: 'wearable' | 'weather';
  /** Extract the metric's per-date numeric series from the joined datasets. */
  readonly extract: (
    wearable: readonly JoinedDayRecord[],
    weather: readonly JoinedWeatherRecord[],
  ) => Array<{ date: string; value: number }>;
}

// ---------------------------------------------------------------------------
// Data extraction helpers
// ---------------------------------------------------------------------------

/** Navigate into an object by a dot-separated path. */
function getNestedValue(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Extract a numeric wearable metric from joined records. */
export function extractWearableFromJoined(
  data: readonly JoinedDayRecord[],
  metric: WearableMetricDef,
): Array<{ date: string; value: number }> {
  const result: Array<{ date: string; value: number }> = [];
  for (const record of data) {
    const summary = record.wearable[metric.dataType];
    if (!summary) continue;
    const raw = getNestedValue(summary.data, metric.path);
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      result.push({ date: record.date, value: raw });
    }
  }
  return result;
}

/** Extract a numeric weather metric from CPAP × weather joined records. */
export function extractWeatherFromJoined(
  data: readonly JoinedWeatherRecord[],
  metric: WeatherMetricDef,
): Array<{ date: string; value: number }> {
  const result: Array<{ date: string; value: number }> = [];
  for (const record of data) {
    const raw = metric.extract(record.weather);
    if (raw !== null && Number.isFinite(raw)) {
      result.push({ date: record.date, value: raw });
    }
  }
  return result;
}

/**
 * Extract CPAP metric values aligned with dates from joined records. Accepts any
 * record carrying `{ date, cpap }` so it works over BOTH the wearable join
 * ({@link JoinedDayRecord}) and the weather join ({@link JoinedWeatherRecord}).
 */
export function extractCpapFromJoined(
  data: readonly { date: string; cpap: NightlyAggregate }[],
  metric: CpapMetricDef,
): Array<{ date: string; value: number }> {
  const result: Array<{ date: string; value: number }> = [];
  for (const record of data) {
    // Null-handling (pairwise deletion): a null index is an undefined rate
    // (sub-floor recording), not zero. Drop it (and any non-finite value) so it
    // never enters a correlation / Bland-Altman / lagged-CCF series; alignSeries
    // then drops the matching comparison point, keeping the paired series aligned.
    const v = metric.extract(record.cpap);
    if (v !== null && Number.isFinite(v)) {
      result.push({ date: record.date, value: v });
    }
  }
  return result;
}

/** Build aligned arrays from two metric series (inner join on date). */
export function alignSeries(
  seriesA: ReadonlyArray<{ date: string; value: number }>,
  seriesB: ReadonlyArray<{ date: string; value: number }>,
): { x: number[]; y: number[]; dates: string[] } {
  const mapB = new Map(seriesB.map((s) => [s.date, s.value]));
  const x: number[] = [];
  const y: number[] = [];
  const dates: string[] = [];
  for (const a of seriesA) {
    const bVal = mapB.get(a.date);
    if (bVal !== undefined) {
      x.push(a.value);
      y.push(bVal);
      dates.push(a.date);
    }
  }
  return { x, y, dates };
}

// ---------------------------------------------------------------------------
// Availability filters
// ---------------------------------------------------------------------------

export function filterAvailableWearableMetrics(
  summary: WearableSummary | null,
): readonly WearableMetricDef[] {
  if (!summary?.hasData) return [];
  const availableTypes = new Set<string>(summary.availableDataTypes);
  return WEARABLE_METRICS.filter((m) => availableTypes.has(m.dataType));
}

/**
 * Keep only weather metrics that have at least one finite value across the
 * CPAP × weather join. When weather isn't synced (empty join) this is empty, so
 * weather metrics simply don't appear — graceful, no error.
 */
export function filterAvailableWeatherMetrics(
  weatherData: readonly JoinedWeatherRecord[],
): readonly WeatherMetricDef[] {
  if (weatherData.length === 0) return [];
  return WEATHER_METRICS.filter((m) =>
    weatherData.some((rec) => {
      const v = m.extract(rec.weather);
      return v !== null && Number.isFinite(v);
    }),
  );
}

// ---------------------------------------------------------------------------
// Unified comparison-metric list (wearable ∪ weather)
// ---------------------------------------------------------------------------

/**
 * Build the flat list of comparison metrics (wearable first, then weather),
 * each normalised to {@link ComparisonMetricDef}. `id` is the stable key the
 * grouped selector reports.
 */
export function buildComparisonMetrics(
  availableWearableMetrics: readonly WearableMetricDef[],
  availableWeatherMetrics: readonly WeatherMetricDef[],
): readonly ComparisonMetricDef[] {
  const wearable: ComparisonMetricDef[] = availableWearableMetrics.map((m, i) => ({
    id: `wearable:${i}`,
    label: m.label,
    group: 'wearable',
    extract: (wd) => extractWearableFromJoined(wd, m),
  }));
  const weather: ComparisonMetricDef[] = availableWeatherMetrics.map((m) => ({
    id: `weather:${m.key}`,
    label: m.label,
    group: 'weather',
    extract: (_wd, wx) => extractWeatherFromJoined(wx, m),
  }));
  return [...wearable, ...weather];
}

/** Radix-grouped options for the "Compare against" selector. */
export function comparisonGroups(
  metrics: readonly ComparisonMetricDef[],
): Array<{ label: string; options: Array<{ value: string; label: string }> }> {
  const wearable = metrics.filter((m) => m.group === 'wearable');
  const weather = metrics.filter((m) => m.group === 'weather');
  const groups: Array<{ label: string; options: Array<{ value: string; label: string }> }> = [];
  if (wearable.length > 0) {
    groups.push({
      label: 'Wearable',
      options: wearable.map((m) => ({ value: m.id, label: m.label })),
    });
  }
  if (weather.length > 0) {
    groups.push({
      label: 'Weather & Environment',
      options: weather.map((m) => ({ value: m.id, label: m.label })),
    });
  }
  return groups;
}
