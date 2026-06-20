/**
 * Overnight weather/air-quality aggregation.
 *
 * This module defines the ONE canonical "overnight window" for the weather
 * integration and reduces hourly weather / air-quality series to a single
 * nightly statistic per metric. The same window definition and the same
 * per-metric statistics MUST be used by every surface (dashboard panel, Signal
 * Viewer ribbon, and cross-source correlation), so that "last night's humidity"
 * is one number everywhere — never three.
 *
 * ## The canonical overnight window (DEFINITION)
 *
 * The overnight window is the **half-open wall-clock interval
 * `[sessionStart, sessionEnd)`** — i.e. exactly the recording period of the
 * CPAP session, from its start instant up to (but not including) its end
 * instant, expressed in the LOCATION's local wall clock.
 *
 * Rationale and rules:
 * - **Anchored to the actual recording**, not a fixed civil clock (e.g. not
 *   "18:00–09:00"). Correlating weather with therapy means correlating the
 *   conditions *while the machine was running*. A fixed clock window would
 *   include hours the user was awake/away and mis-weight short or shifted
 *   nights.
 * - **Hour membership rule (half-open, start-of-hour):** an hourly sample is
 *   in-window iff its hour-start timestamp `t` satisfies
 *   `sessionStart ≤ t < sessionEnd`. Open-Meteo hourly values are labelled by
 *   the hour they begin and represent that clock hour, so testing the hour
 *   start against the half-open recording interval assigns each clock hour to
 *   at most one night and never double-counts the boundary hour.
 * - **Two-civil-date nights:** a recording that crosses local midnight (e.g.
 *   23:00 → 06:00) naturally spans two civil dates. Callers merge BOTH dates'
 *   hourly records (`mergeHourlySamples`) into one ascending series before
 *   aggregating; the window filter then selects exactly the recorded hours
 *   regardless of the midnight crossing.
 * - **Time base:** all timestamps are compared as *local wall clock*. Hourly
 *   sample `time` strings are ISO-8601 WITHOUT an offset (Open-Meteo returns
 *   local time when queried with the location timezone); session bounds are
 *   passed in the same local wall-clock frame. We parse both with
 *   {@link parseWallClockMs} (wall-clock-as-UTC epoch ms, the same convention
 *   the Signal Viewer uses to align lanes), so no timezone arithmetic is
 *   needed and the result is deterministic.
 *
 * ## Per-metric statistic (CANONICAL TABLE)
 *
 * | Metric                         | Overnight statistic |
 * | ------------------------------ | ------------------- |
 * | Temperature (°C)               | **LOW** (minimum)   |
 * | Relative humidity (%)          | **MEAN**            |
 * | Dewpoint (°C)                  | **MEAN**            |
 * | Barometric pressure MSL (hPa)  | **MEAN**            |
 * | Surface pressure (hPa)         | **MEAN**            |
 * | Precipitation (mm)             | **SUM**             |
 * | Wind speed (km/h)              | **MEAN** and **MAX**|
 * | Cloud cover (%)                | **MEAN**            |
 * | PM2.5 / PM10 (µg/m³)           | **MEAN** and **MAX**|
 * | Ozone, NO₂ (µg/m³)             | **MEAN**            |
 * | US AQI / European AQI          | **MEAN** and **MAX**|
 *
 * Temperature uses the overnight LOW because the coldest part of the night is
 * the clinically interesting one (cold-air/congestion effects) and mirrors how
 * "overnight low" is reported meteorologically. Humidity, dewpoint, and
 * pressure use the MEAN (a representative central level over the night).
 * Precipitation is a SUM (an accumulation). Wind and the AQI/PM pollutants
 * carry BOTH a mean (typical exposure) and a max (peak exposure), because peaks
 * matter for both. AQI/PM include MAX so the worst air the user breathed that
 * night is preserved for the favourable/unfavourable trend polarity.
 *
 * ## Missing data (NEVER fabricate)
 *
 * Each statistic is computed over only the in-window samples whose value is a
 * finite number; `null`/non-finite samples are skipped. If a metric has ZERO
 * valid in-window samples, its statistic is `null` — NEVER `0`. In particular
 * precipitation SUM over zero valid hours is `null` ("we have no data"), which
 * is distinct from `0` ("it was dry"). A night with no in-window hours at all
 * yields all-`null` statistics.
 *
 * @module analysis/weather/aggregation
 */

import type {
  AirQualityDaily,
  AirQualityHourlySample,
  WeatherHourlySample,
  WeatherLocation,
} from '@/types/weather';

// ---------------------------------------------------------------------------
// Window types
// ---------------------------------------------------------------------------

/**
 * The canonical overnight window in the local wall-clock frame.
 *
 * Both bounds are ISO-8601 local wall-clock strings WITHOUT an offset (matching
 * the hourly sample `time` convention), e.g. `"2026-01-15T23:14:00"`. The
 * window is half-open: `[start, end)`.
 */
export interface OvernightWindow {
  /** Session start, local wall-clock ISO without offset (inclusive). */
  readonly start: string;
  /** Session end, local wall-clock ISO without offset (exclusive). */
  readonly end: string;
}

// ---------------------------------------------------------------------------
// Wall-clock parsing
// ---------------------------------------------------------------------------

/**
 * Parse a local wall-clock ISO-8601 string (no timezone offset) into an epoch
 * value by interpreting the wall-clock components as if they were UTC.
 *
 * This is the project's "wall-clock-as-UTC" convention (see
 * `FitbitHeartRateIntraday.baseTimestampMs`): it yields a monotonic, ordering-
 * and difference-preserving number for same-zone timestamps WITHOUT importing
 * any timezone, so two same-zone wall-clock strings compare and subtract
 * correctly. Accepts `YYYY-MM-DDTHH:MM`, `…:SS`, optional fractional seconds.
 *
 * If the string carries a trailing `Z` or `±HH:MM` offset it is ignored (the
 * date/time fields are taken at face value) so a stray offset cannot shift the
 * value out of the shared wall-clock frame.
 *
 * @param iso - Local wall-clock timestamp, ISO-8601 without (meaningful) offset.
 * @returns Epoch milliseconds of the wall-clock interpreted as UTC, or `NaN`
 *          if the string is not a parseable date-time.
 */
export function parseWallClockMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(iso.trim());
  if (!m) return NaN;
  const year = Number.parseInt(m[1] as string, 10);
  const month = Number.parseInt(m[2] as string, 10);
  const day = Number.parseInt(m[3] as string, 10);
  const hour = Number.parseInt(m[4] as string, 10);
  const minute = Number.parseInt(m[5] as string, 10);
  const second = m[6] !== undefined ? Number.parseInt(m[6], 10) : 0;
  const millis = m[7] !== undefined ? Number.parseInt(m[7].slice(0, 3).padEnd(3, '0'), 10) : 0;
  return Date.UTC(year, month - 1, day, hour, minute, second, millis);
}

// ---------------------------------------------------------------------------
// Merge helpers (two-civil-date nights)
// ---------------------------------------------------------------------------

/**
 * Merge the hourly samples of one or more local-date records into a single
 * series sorted ascending by wall-clock time, de-duplicating by timestamp
 * (first occurrence wins).
 *
 * Use this to combine the two civil dates a night spans (e.g. the evening date
 * and the following morning date) before calling {@link aggregateWeatherNight}
 * / {@link aggregateAirQualityNight}.
 *
 * Non-parseable timestamps are dropped (they cannot be placed on the window).
 *
 * @param sampleSets - Arrays of hourly samples (e.g. `[date1.samples, date2.samples]`).
 * @returns One ascending, timestamp-deduplicated series.
 */
export function mergeHourlySamples<T extends { readonly time: string }>(
  ...sampleSets: ReadonlyArray<readonly T[] | undefined | null>
): T[] {
  const byTime = new Map<number, T>();
  for (const set of sampleSets) {
    if (!set) continue;
    for (const sample of set) {
      const ms = parseWallClockMs(sample.time);
      if (!Number.isFinite(ms)) continue;
      if (!byTime.has(ms)) byTime.set(ms, sample);
    }
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

// ---------------------------------------------------------------------------
// Window selection
// ---------------------------------------------------------------------------

/**
 * Select the samples whose hour-start `time` falls in the half-open overnight
 * window `[start, end)`.
 *
 * Samples need not be pre-sorted. Samples with an unparseable `time` are
 * excluded. If the window bounds are unparseable, returns an empty array.
 */
export function selectOvernightSamples<T extends { readonly time: string }>(
  samples: readonly T[],
  window: OvernightWindow,
): T[] {
  const startMs = parseWallClockMs(window.start);
  const endMs = parseWallClockMs(window.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const out: T[] = [];
  for (const s of samples) {
    const t = parseWallClockMs(s.time);
    if (!Number.isFinite(t)) continue;
    // Half-open [lo, hi): include lo, exclude hi.
    if (t >= lo && t < hi) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reductions (null-safe; null when no valid samples)
// ---------------------------------------------------------------------------

/** Extract finite numeric values for one field from a sample list. */
function finiteValues<T>(samples: readonly T[], pick: (s: T) => number | null): number[] {
  const out: number[] = [];
  for (const s of samples) {
    const v = pick(s);
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Mean of finite values, or `null` if none. */
function meanOrNull<T>(samples: readonly T[], pick: (s: T) => number | null): number | null {
  const vals = finiteValues(samples, pick);
  if (vals.length === 0) return null;
  let sum = 0;
  for (const v of vals) sum += v;
  return sum / vals.length;
}

/** Minimum of finite values, or `null` if none. */
function minOrNull<T>(samples: readonly T[], pick: (s: T) => number | null): number | null {
  const vals = finiteValues(samples, pick);
  if (vals.length === 0) return null;
  let min = Infinity;
  for (const v of vals) if (v < min) min = v;
  return min;
}

/** Maximum of finite values, or `null` if none. */
function maxOrNull<T>(samples: readonly T[], pick: (s: T) => number | null): number | null {
  const vals = finiteValues(samples, pick);
  if (vals.length === 0) return null;
  let max = -Infinity;
  for (const v of vals) if (v > max) max = v;
  return max;
}

/** Sum of finite values, or `null` if NONE are valid (never a fabricated 0). */
function sumOrNull<T>(samples: readonly T[], pick: (s: T) => number | null): number | null {
  const vals = finiteValues(samples, pick);
  if (vals.length === 0) return null;
  let sum = 0;
  for (const v of vals) sum += v;
  return sum;
}

// ---------------------------------------------------------------------------
// Weather overnight aggregate
// ---------------------------------------------------------------------------

/**
 * The nightly weather statistics derived from the overnight window. All values
 * are SI/metric (see `@/types/weather`); `null` means no valid in-window data.
 */
export interface WeatherNightAggregate {
  /** Overnight LOW temperature, °C. */
  readonly temperatureLow: number | null;
  /** Overnight MEAN temperature, °C (provided for completeness alongside low). */
  readonly temperatureMean: number | null;
  /** Overnight MEAN relative humidity, %. */
  readonly humidityMean: number | null;
  /** Overnight MEAN dewpoint, °C. */
  readonly dewpointMean: number | null;
  /** Overnight MEAN mean-sea-level pressure, hPa (headline clinical variable). */
  readonly pressureMslMean: number | null;
  /** Overnight MEAN surface pressure, hPa. */
  readonly surfacePressureMean: number | null;
  /** Overnight precipitation SUM, mm (null = no data, distinct from 0 = dry). */
  readonly precipitationSum: number | null;
  /** Overnight MEAN wind speed, km/h. */
  readonly windMean: number | null;
  /** Overnight MAX wind speed, km/h. */
  readonly windMax: number | null;
  /** Overnight MEAN cloud cover, %. */
  readonly cloudcoverMean: number | null;
  /** Number of in-window hourly samples used (any value, incl. all-null hours). */
  readonly hourCount: number;
}

/**
 * Compute the canonical overnight weather statistics for a single night from a
 * (merged, if two-civil-date) hourly weather series and the session's
 * wall-clock start/end.
 *
 * @param samples - Hourly weather samples (any order; merge two dates first).
 * @param window  - The session's `[start, end)` local wall-clock window.
 * @returns Per-metric overnight statistics per the canonical table.
 */
export function aggregateWeatherNight(
  samples: readonly WeatherHourlySample[],
  window: OvernightWindow,
): WeatherNightAggregate {
  const inWindow = selectOvernightSamples(samples, window);
  return {
    temperatureLow: minOrNull(inWindow, (s) => s.temperature2m),
    temperatureMean: meanOrNull(inWindow, (s) => s.temperature2m),
    humidityMean: meanOrNull(inWindow, (s) => s.relativeHumidity2m),
    dewpointMean: meanOrNull(inWindow, (s) => s.dewpoint2m),
    pressureMslMean: meanOrNull(inWindow, (s) => s.pressureMsl),
    surfacePressureMean: meanOrNull(inWindow, (s) => s.surfacePressure),
    precipitationSum: sumOrNull(inWindow, (s) => s.precipitation),
    windMean: meanOrNull(inWindow, (s) => s.windspeed10m),
    windMax: maxOrNull(inWindow, (s) => s.windspeed10m),
    cloudcoverMean: meanOrNull(inWindow, (s) => s.cloudcover),
    hourCount: inWindow.length,
  };
}

// ---------------------------------------------------------------------------
// Air-quality overnight aggregate
// ---------------------------------------------------------------------------

/**
 * The nightly air-quality statistics derived from the overnight window. All
 * pollutant values are µg/m³; AQI values are unitless. `null` means no valid
 * in-window data.
 */
export interface AirQualityNightAggregate {
  readonly pm25Mean: number | null;
  readonly pm25Max: number | null;
  readonly pm10Mean: number | null;
  readonly pm10Max: number | null;
  readonly ozoneMean: number | null;
  readonly nitrogenDioxideMean: number | null;
  readonly usAqiMean: number | null;
  readonly usAqiMax: number | null;
  readonly europeanAqiMean: number | null;
  readonly europeanAqiMax: number | null;
  /** Number of in-window hourly samples used. */
  readonly hourCount: number;
}

/**
 * Compute the canonical overnight air-quality statistics for a single night.
 *
 * @param samples - Hourly air-quality samples (any order; merge two dates first).
 * @param window  - The session's `[start, end)` local wall-clock window.
 */
export function aggregateAirQualityNight(
  samples: readonly AirQualityHourlySample[],
  window: OvernightWindow,
): AirQualityNightAggregate {
  const inWindow = selectOvernightSamples(samples, window);
  return {
    pm25Mean: meanOrNull(inWindow, (s) => s.pm25),
    pm25Max: maxOrNull(inWindow, (s) => s.pm25),
    pm10Mean: meanOrNull(inWindow, (s) => s.pm10),
    pm10Max: maxOrNull(inWindow, (s) => s.pm10),
    ozoneMean: meanOrNull(inWindow, (s) => s.ozone),
    nitrogenDioxideMean: meanOrNull(inWindow, (s) => s.nitrogenDioxide),
    usAqiMean: meanOrNull(inWindow, (s) => s.usAqi),
    usAqiMax: maxOrNull(inWindow, (s) => s.usAqi),
    europeanAqiMean: meanOrNull(inWindow, (s) => s.europeanAqi),
    europeanAqiMax: maxOrNull(inWindow, (s) => s.europeanAqi),
    hourCount: inWindow.length,
  };
}

/**
 * Project an {@link AirQualityNightAggregate} into the stored
 * {@link AirQualityDaily} payload shape (which the air-quality daily-summary
 * record carries, since the provider has no native AQ daily endpoint). The
 * `location` stamp is passed through unchanged.
 */
export function toAirQualityDaily(
  aggregate: AirQualityNightAggregate,
  location: WeatherLocation | null,
): AirQualityDaily {
  return {
    location,
    pm25Mean: aggregate.pm25Mean,
    pm25Max: aggregate.pm25Max,
    pm10Mean: aggregate.pm10Mean,
    pm10Max: aggregate.pm10Max,
    ozoneMean: aggregate.ozoneMean,
    nitrogenDioxideMean: aggregate.nitrogenDioxideMean,
    usAqiMean: aggregate.usAqiMean,
    usAqiMax: aggregate.usAqiMax,
    europeanAqiMean: aggregate.europeanAqiMean,
    europeanAqiMax: aggregate.europeanAqiMax,
  };
}
