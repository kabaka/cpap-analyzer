/**
 * ONE shared read-time nightly weather aggregation.
 *
 * This module is the single source of truth for "last night's" weather and
 * air-quality numbers. Both the dashboard {@link WeatherOverview} panel and the
 * upcoming cross-source correlation surface consume {@link computeWeatherNightly}
 * so that a given night's humidity / pressure / dewpoint / AQI is IDENTICAL
 * everywhere — never two (panel vs. correlation) or three different values.
 *
 * It does NOT fork the canonical overnight window or the per-metric statistics.
 * It REUSES the canonical primitives from `@/analysis/weather/aggregation`:
 * {@link aggregateWeatherNight}, {@link aggregateAirQualityNight},
 * {@link mergeHourlySamples}, {@link selectOvernightSamples}, and
 * {@link parseWallClockMs}. The only thing added here is:
 *
 * 1. the **window resolution policy** (session-derived when a session exists for
 *    the date, otherwise a single documented default civil-night window — see
 *    {@link DEFAULT_CIVIL_NIGHT_WINDOW_HOURS} and {@link resolveNightlyWindow}),
 * 2. a derived **overnight pressure change (delta)** that the panel and
 *    correlation both want, and
 * 3. an **hourly-derived vs. stored-daily precedence** for the two metrics whose
 *    native provider resolution is the civil day (temperature extremes and
 *    precipitation sum).
 *
 * ## Window resolution policy (DEFINITION)
 *
 * The night that ENDS on calendar date `D` uses, in order:
 *
 * - **Session-derived (PREFERRED):** when `sessionStart` / `sessionEnd` are
 *   provided, the canonical half-open `[sessionStart, sessionEnd)` local
 *   wall-clock window from `aggregation.ts` — exactly the recording period.
 *   This is the SAME window the correlation join uses, so the numbers coincide.
 *   Bounds are stripped to local wall-clock (any trailing `Z`/offset removed)
 *   via {@link toWallClock}, matching the project's wall-clock-as-UTC frame.
 *
 * - **Default civil night (FALLBACK):** when no session exists for `D` (a
 *   weather-only date), a single, clearly-documented civil-night window
 *   `[D-1 20:00, D 08:00)` — defined ONCE here from
 *   {@link DEFAULT_CIVIL_NIGHT_WINDOW_HOURS} and exported so it is never
 *   re-guessed by any surface. 20:00→08:00 brackets a typical sleep period
 *   symmetrically around solar midnight without assuming a fixed bedtime.
 *
 * Both branches feed the IDENTICAL canonical aggregation, so when a session's
 * recording happens to coincide with the default civil night the two windows
 * produce identical statistics.
 *
 * ## Per-metric precedence (hourly-derived vs. stored-daily)
 *
 * | Metric                              | Source of record                         |
 * | ----------------------------------- | ---------------------------------------- |
 * | Humidity / dewpoint / pressure(MSL+surface) / wind / cloud | **Hourly only** — overnight window aggregate (these have no native daily field) |
 * | AQI (us/eu) / PM2.5 / PM10 / O₃ / NO₂ | **Hourly only** — overnight window aggregate (provider has no AQ daily endpoint) |
 * | Pressure change (delta)             | **Hourly only** — last in-window MSL minus first in-window MSL |
 * | Temperature overnight-low / mean    | **Hourly-derived PREFERRED**; stored `weather_daily` min/mean used ONLY as a fallback when no in-window hourly temperature exists |
 * | Precipitation sum                   | **Hourly-derived PREFERRED**; stored `weather_daily` precipitationSum used ONLY as a fallback when no in-window hourly precipitation exists |
 *
 * Rationale: the canonical overnight number is window-based, so hourly always
 * wins. Temperature extremes and precipitation are the only two metrics the
 * provider also reports as its own civil-day daily aggregate; those daily values
 * are a coarser (civil-day, not overnight) fallback used solely to avoid an
 * all-`null` tile when the hourly series is missing for that night. The fallback
 * is civil-day, NOT overnight — callers that need strict overnight semantics can
 * inspect {@link WeatherNightly.temperatureSource} /
 * {@link WeatherNightly.precipitationSource}.
 *
 * ## Missing data
 *
 * Every metric is `number | null`. `null` means "no valid data" and is NEVER a
 * fabricated `0`. In particular a dry night has `precipitationSum === 0` (it was
 * dry) which is DISTINCT from `precipitationSum === null` (no precipitation data
 * at all). All reductions inherit this from `aggregation.ts`.
 *
 * @module analysis/weather/nightly
 */

import type {
  AirQualityDaily,
  AirQualityHourlySample,
  WeatherDaily,
  WeatherHourlySample,
} from '@/types/weather';

import {
  aggregateAirQualityNight,
  aggregateWeatherNight,
  mergeHourlySamples,
  parseWallClockMs,
  selectOvernightSamples,
  type OvernightWindow,
} from './aggregation';
import { subtractDaysIso } from './coordinates';

// ---------------------------------------------------------------------------
// Default civil-night window (defined ONCE; never re-guessed)
// ---------------------------------------------------------------------------

/**
 * The local wall-clock hours of the default civil-night window, used ONLY when
 * a date has no CPAP session to derive a recording window from.
 *
 * The window for the night ENDING on date `D` is the half-open interval
 * `[D-1 {startHour}:00, D {endHour}:00)`. 20:00 → 08:00 (a 12-hour night)
 * symmetrically brackets a typical sleep period around solar midnight without
 * assuming a fixed bedtime, and matches the half-open, start-of-hour membership
 * rule of the canonical aggregation.
 *
 * This is the ONE place the default night is specified. Every surface that needs
 * a session-less night MUST derive it from here (via
 * {@link defaultCivilNightWindow} / {@link resolveNightlyWindow}) so the default
 * is identical everywhere.
 */
export const DEFAULT_CIVIL_NIGHT_WINDOW_HOURS = {
  /** Local hour the civil night starts on the PREVIOUS calendar day (inclusive). */
  startHour: 20,
  /** Local hour the civil night ends on the night's calendar date (exclusive). */
  endHour: 8,
} as const;

/**
 * Build the default civil-night {@link OvernightWindow} for the night that ENDS
 * on local calendar date `date` (`YYYY-MM-DD`).
 *
 * Returns `[D-1 20:00, D 08:00)` in the local wall-clock frame (ISO without
 * offset), derived solely from {@link DEFAULT_CIVIL_NIGHT_WINDOW_HOURS}.
 */
export function defaultCivilNightWindow(date: string): OvernightWindow {
  const prev = subtractDaysIso(date, 1);
  const sh = String(DEFAULT_CIVIL_NIGHT_WINDOW_HOURS.startHour).padStart(2, '0');
  const eh = String(DEFAULT_CIVIL_NIGHT_WINDOW_HOURS.endHour).padStart(2, '0');
  return { start: `${prev}T${sh}:00`, end: `${date}T${eh}:00` };
}

/**
 * Strip any trailing `Z` / `±HH:MM` offset from an ISO timestamp, keeping the
 * local wall-clock part (`YYYY-MM-DDTHH:MM[:SS]`).
 *
 * Session `startTime` / `endTime` are stored as `Date.toISOString()` (UTC, with
 * a `Z`). The canonical aggregation compares timestamps in the local wall-clock
 * frame (wall-clock-as-UTC). Stripping the offset here puts the session bounds
 * in the same frame as the hourly `time` strings, matching how
 * `views/Settings/weather/syncNights.ts` derived the sync window. If the string
 * is unparseable it is returned unchanged (the downstream parser will reject it).
 */
export function toWallClock(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)/.exec(iso.trim());
  return m ? (m[1] as string).replace(' ', 'T') : iso;
}

/**
 * Resolve the overnight window for the night ending on `date`:
 * session-derived `[start, end)` when both bounds are provided, otherwise the
 * documented {@link defaultCivilNightWindow}.
 *
 * @returns The window and which policy produced it.
 */
export function resolveNightlyWindow(
  date: string,
  sessionStart?: string | null,
  sessionEnd?: string | null,
): { readonly window: OvernightWindow; readonly source: 'session' | 'default-civil-night' } {
  if (sessionStart != null && sessionEnd != null) {
    const start = toWallClock(sessionStart);
    const end = toWallClock(sessionEnd);
    if (Number.isFinite(parseWallClockMs(start)) && Number.isFinite(parseWallClockMs(end))) {
      return { window: { start, end }, source: 'session' };
    }
  }
  return { window: defaultCivilNightWindow(date), source: 'default-civil-night' };
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

/** Which input produced a given metric (for provenance / strict-overnight callers). */
export type NightlyMetricSource = 'hourly' | 'daily' | 'none';

/** How the overnight window for this night was resolved. */
export type NightlyWindowSource = 'session' | 'default-civil-night';

/**
 * The ONE canonical nightly weather + air-quality record consumed by both the
 * dashboard panel and the correlation surface. All values are SI/metric (see
 * `@/types/weather`); `null` means no valid data (never a fabricated `0`).
 */
export interface WeatherNightly {
  /** Local calendar date the night ENDS on (`YYYY-MM-DD`). */
  readonly date: string;
  /** The resolved overnight window actually used. */
  readonly window: OvernightWindow;
  /** Whether the window came from a session or the default civil night. */
  readonly windowSource: NightlyWindowSource;

  // ── Core weather (hourly-derived; temp/precip may fall back to daily) ──
  /** Overnight LOW temperature, °C. */
  readonly temperatureLow: number | null;
  /** Overnight MEAN temperature, °C. */
  readonly temperatureMean: number | null;
  /** Provenance of {@link temperatureLow}/{@link temperatureMean}. */
  readonly temperatureSource: NightlyMetricSource;
  /** Overnight MEAN relative humidity, % (hourly-only). */
  readonly humidityMean: number | null;
  /** Overnight MEAN dewpoint, °C (hourly-only). */
  readonly dewpointMean: number | null;
  /** Overnight MEAN mean-sea-level pressure, hPa (hourly-only; headline). */
  readonly pressureMslMean: number | null;
  /** Overnight MEAN surface pressure, hPa (hourly-only). */
  readonly surfacePressureMean: number | null;
  /**
   * Overnight pressure CHANGE (delta), hPa: last in-window MSL pressure minus
   * first in-window MSL pressure (chronological). Positive = pressure rose
   * across the night, negative = fell. `null` when fewer than two in-window
   * MSL-pressure samples exist. Hourly-only.
   */
  readonly pressureChange: number | null;
  /** Overnight precipitation SUM, mm (0 = dry, null = no data). */
  readonly precipitationSum: number | null;
  /** Provenance of {@link precipitationSum}. */
  readonly precipitationSource: NightlyMetricSource;
  /** Overnight MEAN wind speed, km/h (hourly-only). */
  readonly windMean: number | null;
  /** Overnight MAX wind speed, km/h (hourly-only). */
  readonly windMax: number | null;
  /** Overnight MEAN cloud cover, % (hourly-only). */
  readonly cloudcoverMean: number | null;

  // ── Air quality (hourly-derived) ──
  /** Overnight MEAN PM2.5, µg/m³. */
  readonly pm25Mean: number | null;
  /** Overnight MAX PM2.5, µg/m³. */
  readonly pm25Max: number | null;
  /** Overnight MEAN PM10, µg/m³. */
  readonly pm10Mean: number | null;
  /** Overnight MAX PM10, µg/m³. */
  readonly pm10Max: number | null;
  /** Overnight MEAN ozone, µg/m³. */
  readonly ozoneMean: number | null;
  /** Overnight MEAN nitrogen dioxide, µg/m³. */
  readonly nitrogenDioxideMean: number | null;
  /** Overnight MEAN US AQI, unitless. */
  readonly usAqiMean: number | null;
  /** Overnight MAX US AQI, unitless. */
  readonly usAqiMax: number | null;
  /** Overnight MEAN European AQI, unitless. */
  readonly europeanAqiMean: number | null;
  /** Overnight MAX European AQI, unitless. */
  readonly europeanAqiMax: number | null;

  /** Count of in-window hourly WEATHER samples used. */
  readonly weatherHourCount: number;
  /** Count of in-window hourly AIR-QUALITY samples used. */
  readonly airHourCount: number;
}

// ---------------------------------------------------------------------------
// Pressure-change (delta)
// ---------------------------------------------------------------------------

/**
 * Overnight MSL-pressure change: last finite in-window MSL pressure minus the
 * first finite in-window MSL pressure, ordered chronologically by wall-clock
 * `time`. `null` when fewer than two finite in-window MSL samples exist.
 *
 * @param inWindow - The already-window-filtered hourly weather samples.
 */
function pressureChangeOf(inWindow: readonly WeatherHourlySample[]): number | null {
  const points: Array<{ ms: number; v: number }> = [];
  for (const s of inWindow) {
    const v = s.pressureMsl;
    if (v === null || !Number.isFinite(v)) continue;
    const ms = parseWallClockMs(s.time);
    if (!Number.isFinite(ms)) continue;
    points.push({ ms, v });
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.ms - b.ms);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  return last.v - first.v;
}

// ---------------------------------------------------------------------------
// computeWeatherNightly
// ---------------------------------------------------------------------------

/** Inputs to {@link computeWeatherNightly}. Provide whatever is available. */
export interface ComputeWeatherNightlyInput {
  /** Local calendar date the night ENDS on (`YYYY-MM-DD`). */
  readonly date: string;
  /** Session start (any ISO; offset stripped). Pair with `sessionEnd`. */
  readonly sessionStart?: string | null;
  /** Session end (any ISO; offset stripped). Pair with `sessionStart`. */
  readonly sessionEnd?: string | null;
  /**
   * Hourly weather samples for the night. Pass BOTH civil dates' samples when a
   * night may cross midnight; they are merged + de-duplicated internally.
   */
  readonly hourlyWeather?: ReadonlyArray<readonly WeatherHourlySample[] | undefined | null>;
  /** Hourly air-quality samples for the night (merged like `hourlyWeather`). */
  readonly hourlyAir?: ReadonlyArray<readonly AirQualityHourlySample[] | undefined | null>;
  /** Stored civil-day weather daily summary (fallback for temp/precip only). */
  readonly dailyWeather?: WeatherDaily | null;
  /**
   * Stored air-quality daily summary. Present for API symmetry; AQ is fully
   * hourly-derived here so this is currently unused for computation.
   */
  readonly dailyAir?: AirQualityDaily | null;
}

/**
 * Compute the ONE canonical {@link WeatherNightly} for a single night.
 *
 * Pure and deterministic: same inputs → same output. No storage, network, or
 * React dependency. See the module doc for the window-resolution policy and the
 * per-metric hourly-vs-daily precedence.
 */
export function computeWeatherNightly(input: ComputeWeatherNightlyInput): WeatherNightly {
  const { date, sessionStart, sessionEnd, hourlyWeather, hourlyAir, dailyWeather } = input;

  const { window, source: windowSource } = resolveNightlyWindow(date, sessionStart, sessionEnd);

  // --- Weather (hourly canonical, with civil-day fallback for temp/precip) ---
  const weatherSamples = mergeHourlySamples<WeatherHourlySample>(...(hourlyWeather ?? []));
  const weatherInWindow = selectOvernightSamples(weatherSamples, window);
  const wx = aggregateWeatherNight(weatherInWindow, window);

  // Temperature: prefer hourly; fall back to stored civil-day daily.
  let temperatureLow = wx.temperatureLow;
  let temperatureMean = wx.temperatureMean;
  let temperatureSource: NightlyMetricSource = wx.temperatureLow !== null ? 'hourly' : 'none';
  if (temperatureLow === null && dailyWeather != null && dailyWeather.temperature2mMin !== null) {
    temperatureLow = dailyWeather.temperature2mMin;
    temperatureMean = dailyWeather.temperature2mMean;
    temperatureSource = 'daily';
  }

  // Precipitation: prefer hourly SUM; fall back to stored civil-day sum.
  let precipitationSum = wx.precipitationSum;
  let precipitationSource: NightlyMetricSource = wx.precipitationSum !== null ? 'hourly' : 'none';
  if (precipitationSum === null && dailyWeather != null && dailyWeather.precipitationSum !== null) {
    precipitationSum = dailyWeather.precipitationSum;
    precipitationSource = 'daily';
  }

  // --- Air quality (fully hourly-derived) ---
  const airSamples = mergeHourlySamples<AirQualityHourlySample>(...(hourlyAir ?? []));
  const airInWindow = selectOvernightSamples(airSamples, window);
  const air = aggregateAirQualityNight(airInWindow, window);

  return {
    date,
    window,
    windowSource,

    temperatureLow,
    temperatureMean,
    temperatureSource,
    humidityMean: wx.humidityMean,
    dewpointMean: wx.dewpointMean,
    pressureMslMean: wx.pressureMslMean,
    surfacePressureMean: wx.surfacePressureMean,
    pressureChange: pressureChangeOf(weatherInWindow),
    precipitationSum,
    precipitationSource,
    windMean: wx.windMean,
    windMax: wx.windMax,
    cloudcoverMean: wx.cloudcoverMean,

    pm25Mean: air.pm25Mean,
    pm25Max: air.pm25Max,
    pm10Mean: air.pm10Mean,
    pm10Max: air.pm10Max,
    ozoneMean: air.ozoneMean,
    nitrogenDioxideMean: air.nitrogenDioxideMean,
    usAqiMean: air.usAqiMean,
    usAqiMax: air.usAqiMax,
    europeanAqiMean: air.europeanAqiMean,
    europeanAqiMax: air.europeanAqiMax,

    weatherHourCount: wx.hourCount,
    airHourCount: air.hourCount,
  };
}
