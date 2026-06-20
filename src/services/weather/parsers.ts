/**
 * Open-Meteo JSON → typed weather/air-quality record parsers.
 *
 * Pure functions (no network, no storage) that take a raw Open-Meteo response
 * (see {@link OpenMeteoWeatherResponse} / {@link OpenMeteoAirQualityResponse})
 * and produce the per-local-date typed payloads defined in `@/types/weather`.
 *
 * ## Unit convention
 *
 * Values are stored exactly AS RETURNED by Open-Meteo (SI/metric: °C, hPa,
 * km/h, mm, µg/m³). No pre-conversion happens here — display conversion is the
 * edge's job (`@/analysis/weather/units`).
 *
 * ## Missing data — two DISTINCT outcomes (Correctness > Features)
 *
 * A weather value can be absent for two different reasons, which MUST NOT be
 * conflated (a fabricated `0` would silently corrupt correlations):
 *
 * 1. **Not fetched** — we never asked the provider for this date. Represented by
 *    the ABSENCE of any stored record (the caller stores nothing).
 * 2. **Queried but empty** — we asked, and the provider returned no value for an
 *    hour/day (a `null` in the array, or the date simply had no hours). The
 *    `null` is preserved end-to-end in the sample/summary fields, and the
 *    enclosing payload is still produced and stored. The `queriedEmpty` flag on
 *    {@link ParsedWeatherResult} marks a date that was queried but produced no
 *    usable hours, so a surface can show "—" with confidence it is real
 *    "no provider data", not "not yet fetched".
 *
 * @module services/weather/parsers
 */

import type {
  AirQualityHourly,
  AirQualityHourlySample,
  WeatherDaily,
  WeatherHourly,
  WeatherHourlySample,
  WeatherLocation,
} from '@/types/weather';
import type { OpenMeteoAirQualityResponse, OpenMeteoWeatherResponse } from './OpenMeteoClient';

// ---------------------------------------------------------------------------
// Parsed-record shapes (mirror the GoogleHealth ParsedRecord convention)
// ---------------------------------------------------------------------------

/** A typed payload tagged with the local calendar date it belongs to. */
export interface ParsedDateRecord<T> {
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** The typed payload for this date. */
  readonly data: T;
  /**
   * `true` when this date was queried but the provider returned NO usable hours
   * (or all-null hours). Distinct from "not fetched" (no record at all). Lets a
   * surface render "—" instead of fabricating a zero.
   */
  readonly queriedEmpty: boolean;
}

/** Parsed core-weather results, split by record kind. */
export interface ParsedWeatherResult {
  /** Open-Meteo's own daily aggregates, one per civil date. */
  readonly daily: ReadonlyArray<ParsedDateRecord<WeatherDaily>>;
  /** Hourly series, one record per civil date. */
  readonly hourly: ReadonlyArray<ParsedDateRecord<WeatherHourly>>;
}

/** Parsed air-quality results (hourly only; daily aggregates are derived later). */
export interface ParsedAirQualityResult {
  /** Hourly series, one record per civil date. */
  readonly hourly: ReadonlyArray<ParsedDateRecord<AirQualityHourly>>;
}

// ---------------------------------------------------------------------------
// Low-level coercion helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a raw Open-Meteo array cell to `number | null`.
 *
 * Open-Meteo uses JSON `null` for "no value". Anything that is not a finite
 * number (null, undefined, NaN, a string) becomes `null` — NEVER `0`.
 */
function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Read a hourly/daily array out of a response field map, or an empty array. */
function readArray(
  block: Record<string, ReadonlyArray<number | null> | readonly string[]> | undefined,
  key: string,
): ReadonlyArray<unknown> {
  if (!block) return [];
  const arr = block[key];
  return Array.isArray(arr) ? arr : [];
}

/** Extract the local calendar date (`YYYY-MM-DD`) from a wall-clock time string. */
function dateOf(time: string): string {
  // Open-Meteo hourly time strings are `YYYY-MM-DDTHH:MM` (local, no offset);
  // daily time strings are `YYYY-MM-DD`. Slice the date portion either way.
  const t = time.length >= 10 ? time.slice(0, 10) : time;
  return t;
}

/** Group an index range by the local date of each hourly timestamp. */
function groupHourIndicesByDate(times: ReadonlyArray<unknown>): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (typeof t !== 'string' || t.length < 10) continue;
    const date = dateOf(t);
    const bucket = byDate.get(date);
    if (bucket) bucket.push(i);
    else byDate.set(date, [i]);
  }
  return byDate;
}

/** True when every numeric field in every sample is `null` (no usable data). */
function allSamplesEmpty(samples: ReadonlyArray<{ readonly time: string }>): boolean {
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample)) {
      if (key === 'time') continue;
      if (value !== null) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Weather parsing
// ---------------------------------------------------------------------------

/**
 * Parse a core-weather Open-Meteo response into per-date hourly and daily
 * records. `location` is the (already-rounded) stamp to attach to every record.
 *
 * @param response - Raw Open-Meteo `/v1/forecast` or `/v1/archive` JSON.
 * @param location - Location stamp written onto every produced record.
 */
export function parseWeatherResponse(
  response: OpenMeteoWeatherResponse,
  location: WeatherLocation | null,
): ParsedWeatherResult {
  const hourly = parseWeatherHourly(response, location);
  const daily = parseWeatherDaily(response, location);
  return { hourly, daily };
}

function parseWeatherHourly(
  response: OpenMeteoWeatherResponse,
  location: WeatherLocation | null,
): ReadonlyArray<ParsedDateRecord<WeatherHourly>> {
  const block = response.hourly;
  const times = readArray(block, 'time');
  if (times.length === 0) return [];

  const temperature = readArray(block, 'temperature_2m');
  const humidity = readArray(block, 'relative_humidity_2m');
  const dewpoint = readArray(block, 'dewpoint_2m');
  const surfacePressure = readArray(block, 'surface_pressure');
  const pressureMsl = readArray(block, 'pressure_msl');
  const precipitation = readArray(block, 'precipitation');
  const windspeed = readArray(block, 'windspeed_10m');
  const cloudcover = readArray(block, 'cloudcover');
  const weathercode = readArray(block, 'weathercode');

  const byDate = groupHourIndicesByDate(times);
  const out: ParsedDateRecord<WeatherHourly>[] = [];

  for (const [date, indices] of byDate) {
    const samples: WeatherHourlySample[] = indices.map((i) => ({
      time: times[i] as string,
      temperature2m: toNullableNumber(temperature[i]),
      relativeHumidity2m: toNullableNumber(humidity[i]),
      dewpoint2m: toNullableNumber(dewpoint[i]),
      surfacePressure: toNullableNumber(surfacePressure[i]),
      pressureMsl: toNullableNumber(pressureMsl[i]),
      precipitation: toNullableNumber(precipitation[i]),
      windspeed10m: toNullableNumber(windspeed[i]),
      cloudcover: toNullableNumber(cloudcover[i]),
      weathercode: toNullableNumber(weathercode[i]),
    }));

    out.push({
      date,
      data: { location, samples },
      queriedEmpty: samples.length === 0 || allSamplesEmpty(samples),
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function parseWeatherDaily(
  response: OpenMeteoWeatherResponse,
  location: WeatherLocation | null,
): ReadonlyArray<ParsedDateRecord<WeatherDaily>> {
  const block = response.daily;
  const times = readArray(block, 'time');
  if (times.length === 0) return [];

  const tMax = readArray(block, 'temperature_2m_max');
  const tMin = readArray(block, 'temperature_2m_min');
  const tMean = readArray(block, 'temperature_2m_mean');
  const precipSum = readArray(block, 'precipitation_sum');
  const windMax = readArray(block, 'windspeed_10m_max');
  const weathercode = readArray(block, 'weathercode');

  const out: ParsedDateRecord<WeatherDaily>[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (typeof t !== 'string' || t.length < 10) continue;
    const data: WeatherDaily = {
      location,
      temperature2mMax: toNullableNumber(tMax[i]),
      temperature2mMin: toNullableNumber(tMin[i]),
      temperature2mMean: toNullableNumber(tMean[i]),
      precipitationSum: toNullableNumber(precipSum[i]),
      windspeed10mMax: toNullableNumber(windMax[i]),
      weathercode: toNullableNumber(weathercode[i]),
    };
    const queriedEmpty =
      data.temperature2mMax === null &&
      data.temperature2mMin === null &&
      data.temperature2mMean === null &&
      data.precipitationSum === null &&
      data.windspeed10mMax === null &&
      data.weathercode === null;

    out.push({ date: dateOf(t), data, queriedEmpty });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ---------------------------------------------------------------------------
// Air-quality parsing
// ---------------------------------------------------------------------------

/**
 * Parse an air-quality Open-Meteo response into per-date hourly records.
 *
 * The air-quality endpoint is hourly-only; daily aggregates are derived later
 * by `@/analysis/weather/aggregation` over the canonical overnight window.
 */
export function parseAirQualityResponse(
  response: OpenMeteoAirQualityResponse,
  location: WeatherLocation | null,
): ParsedAirQualityResult {
  const block = response.hourly;
  const times = readArray(block, 'time');
  if (times.length === 0) return { hourly: [] };

  const pm25 = readArray(block, 'pm2_5');
  const pm10 = readArray(block, 'pm10');
  const ozone = readArray(block, 'ozone');
  const no2 = readArray(block, 'nitrogen_dioxide');
  const usAqi = readArray(block, 'us_aqi');
  const europeanAqi = readArray(block, 'european_aqi');

  const byDate = groupHourIndicesByDate(times);
  const out: ParsedDateRecord<AirQualityHourly>[] = [];

  for (const [date, indices] of byDate) {
    const samples: AirQualityHourlySample[] = indices.map((i) => ({
      time: times[i] as string,
      pm25: toNullableNumber(pm25[i]),
      pm10: toNullableNumber(pm10[i]),
      ozone: toNullableNumber(ozone[i]),
      nitrogenDioxide: toNullableNumber(no2[i]),
      usAqi: toNullableNumber(usAqi[i]),
      europeanAqi: toNullableNumber(europeanAqi[i]),
    }));

    out.push({
      date,
      data: { location, samples },
      queriedEmpty: samples.length === 0 || allSamplesEmpty(samples),
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return { hourly: out };
}
