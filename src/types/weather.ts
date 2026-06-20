/**
 * Weather & environmental (air-quality) data types.
 *
 * These payloads are fetched from Open-Meteo (per ADR 0022 and the weather
 * integration design reference) and stored in the existing IndexedDB
 * integration stores:
 *
 * - Daily summaries  -> `integration_data` store, as {@link IntegrationDailySummary}
 *   records with `source: 'weather'`.
 * - Hourly series    -> `integration_timeseries` store, as
 *   {@link IntegrationTimeseries} records with `source: 'weather'`.
 *
 * Every record conforms to the existing integration record envelope:
 * `{ id, source, dataType, date (YYYY-MM-DD local), data, importedAt }` — the
 * `source`/`dataType`/`date`/`importedAt`/`data` fields are supplied by the
 * wrapping {@link IntegrationDailySummary} / {@link IntegrationTimeseries}
 * record; the interfaces here describe the `data` payload plus the shared
 * {@link WeatherLocation} field.
 *
 * ## Unit convention (CANONICAL — SI / metric internally)
 *
 * All stored values are SI / metric. Display conversion happens at the edge
 * (see `@/analysis/weather/units`). Specifically:
 *
 * | Quantity            | Stored unit          | Open-Meteo variable            |
 * | ------------------- | -------------------- | ------------------------------ |
 * | Temperature         | °C (degrees Celsius) | `temperature_2m`, …_min/_max   |
 * | Dewpoint            | °C                   | `dewpoint_2m`                  |
 * | Relative humidity   | % (0–100)            | `relative_humidity_2m`         |
 * | Barometric pressure | hPa (= mbar)         | `pressure_msl`, `surface_pressure` |
 * | Precipitation       | mm                   | `precipitation`, `precipitation_sum` |
 * | Wind speed          | **km/h** (see note)  | `windspeed_10m`, `windspeed_10m_max` |
 * | Cloud cover         | % (0–100)            | `cloudcover`                   |
 * | PM2.5 / PM10        | µg/m³                | `pm2_5`, `pm10`                |
 * | Ozone (O₃)          | µg/m³                | `ozone`                        |
 * | Nitrogen dioxide    | µg/m³                | `nitrogen_dioxide`             |
 * | US / European AQI   | unitless index       | `us_aqi`, `european_aqi`       |
 *
 * ### Wind-speed unit note
 *
 * Open-Meteo's DEFAULT `windspeed_unit` is **km/h**, and the client requests
 * the default (no `windspeed_unit` override). We therefore store wind as
 * **km/h** as the canonical internal unit — NOT m/s — so that what is stored is
 * exactly what the provider returned, with no lossy pre-conversion. Display
 * conversion to m/s or mph is handled by `@/analysis/weather/units`.
 *
 * ## Missing data
 *
 * Open-Meteo returns `null` for hours/days it has no value for. That `null`
 * MUST be preserved end-to-end — never coerced to `0`. A fabricated zero would
 * silently corrupt correlations (Correctness > Features). Every numeric field
 * below is therefore `number | null`.
 *
 * @module types/weather
 */

// ---------------------------------------------------------------------------
// Data-type discriminators
// ---------------------------------------------------------------------------

/**
 * Weather/air-quality daily-summary data types (stored in `integration_data`
 * with `source: 'weather'`).
 */
export type WeatherDailyType = 'weather_daily' | 'air_quality_daily';

/**
 * Weather/air-quality hourly-series data types (stored in
 * `integration_timeseries` with `source: 'weather'`).
 */
export type WeatherHourlyType = 'weather_hourly' | 'air_quality_hourly';

/** Combined discriminator for all weather data types. */
export type WeatherDataType = WeatherDailyType | WeatherHourlyType;

// ---------------------------------------------------------------------------
// Shared location (forward-compatible per-record location)
// ---------------------------------------------------------------------------

/**
 * Per-record location stamp.
 *
 * NULLABLE for forward compatibility (per ADR 0022, decision 3): v1 always
 * writes the single globally-configured location, but encoding a per-record
 * location now means a future travel-aware / per-night location feature can
 * populate it WITHOUT a schema migration. When a field is `null`, consumers
 * fall back to the globally-configured location in settings.
 *
 * Coordinates here are the (already 2-dp-rounded — see
 * `@/analysis/weather/coordinates`) values that were sent to the provider; they
 * are the canonical stored representation of "where this weather is for".
 */
export interface WeatherLocation {
  /** Human-readable label (e.g. a city name), or `null` if unlabelled. */
  readonly label: string | null;
  /** Latitude in decimal degrees, rounded to 2 dp; `null` if unknown. */
  readonly latitude: number | null;
  /** Longitude in decimal degrees, rounded to 2 dp; `null` if unknown. */
  readonly longitude: number | null;
}

// ---------------------------------------------------------------------------
// Weather — hourly payload
// ---------------------------------------------------------------------------

/**
 * One hourly sample of core weather (SI/metric units — see module doc).
 *
 * `time` is the local wall-clock timestamp of the hour as returned by
 * Open-Meteo (ISO 8601 *without* an offset, e.g. `"2026-01-15T03:00"`, when the
 * request used the location's `timezone`). It denotes the start of the hour.
 */
export interface WeatherHourlySample {
  /** Local wall-clock hour timestamp, ISO 8601 without offset (hour start). */
  readonly time: string;
  /** Air temperature at 2 m, °C. */
  readonly temperature2m: number | null;
  /** Relative humidity at 2 m, % (0–100). */
  readonly relativeHumidity2m: number | null;
  /** Dewpoint at 2 m, °C. */
  readonly dewpoint2m: number | null;
  /** Surface (station-level) pressure, hPa. */
  readonly surfacePressure: number | null;
  /** Mean-sea-level barometric pressure, hPa. Headline clinical variable. */
  readonly pressureMsl: number | null;
  /** Precipitation accumulated in the hour, mm. */
  readonly precipitation: number | null;
  /** Wind speed at 10 m, km/h. */
  readonly windspeed10m: number | null;
  /** Total cloud cover, % (0–100). */
  readonly cloudcover: number | null;
  /** WMO weather interpretation code (categorical; not averaged). */
  readonly weathercode: number | null;
}

/**
 * Hourly weather series payload for one local calendar date.
 *
 * Stored as the `data` of an {@link IntegrationTimeseries} record with
 * `source: 'weather'`, `dataType: 'weather_hourly'`. One record per local date;
 * a night spanning two civil dates merges two such records at read time (see
 * `@/analysis/weather/aggregation`).
 */
export interface WeatherHourly {
  /** Location this series is for (nullable; see {@link WeatherLocation}). */
  readonly location: WeatherLocation | null;
  /** Hourly samples, ascending by `time`, one per hour of the local date. */
  readonly samples: readonly WeatherHourlySample[];
}

// ---------------------------------------------------------------------------
// Weather — daily payload
// ---------------------------------------------------------------------------

/**
 * Daily core-weather summary payload for one local calendar date.
 *
 * Stored as the `data` of an {@link IntegrationDailySummary} record with
 * `source: 'weather'`, `dataType: 'weather_daily'`.
 *
 * These are Open-Meteo's OWN daily aggregates (civil-day based). They are
 * convenient for a calendar view but are NOT the canonical "overnight" numbers
 * used for correlation — those are computed from the hourly series over the
 * shared overnight window (see `@/analysis/weather/aggregation`).
 */
export interface WeatherDaily {
  /** Location this summary is for (nullable; see {@link WeatherLocation}). */
  readonly location: WeatherLocation | null;
  /** Civil-day maximum temperature at 2 m, °C. */
  readonly temperature2mMax: number | null;
  /** Civil-day minimum temperature at 2 m, °C. */
  readonly temperature2mMin: number | null;
  /** Civil-day mean temperature at 2 m, °C. */
  readonly temperature2mMean: number | null;
  /** Civil-day precipitation total, mm. */
  readonly precipitationSum: number | null;
  /** Civil-day maximum wind speed at 10 m, km/h. */
  readonly windspeed10mMax: number | null;
  /** Dominant/representative WMO weather code for the civil day. */
  readonly weathercode: number | null;
}

// ---------------------------------------------------------------------------
// Air quality — hourly payload
// ---------------------------------------------------------------------------

/**
 * One hourly sample of air quality (µg/m³ for pollutants; unitless AQI).
 *
 * `time` follows the same local-wall-clock-without-offset convention as
 * {@link WeatherHourlySample.time}.
 */
export interface AirQualityHourlySample {
  /** Local wall-clock hour timestamp, ISO 8601 without offset (hour start). */
  readonly time: string;
  /** PM2.5 mass concentration, µg/m³. */
  readonly pm25: number | null;
  /** PM10 mass concentration, µg/m³. */
  readonly pm10: number | null;
  /** Ozone (O₃) concentration, µg/m³. */
  readonly ozone: number | null;
  /** Nitrogen dioxide (NO₂) concentration, µg/m³. */
  readonly nitrogenDioxide: number | null;
  /** US Air Quality Index (0–500+ scale), unitless. */
  readonly usAqi: number | null;
  /** European Air Quality Index (0–100+ scale), unitless. */
  readonly europeanAqi: number | null;
}

/**
 * Hourly air-quality series payload for one local calendar date.
 *
 * Stored as the `data` of an {@link IntegrationTimeseries} record with
 * `source: 'weather'`, `dataType: 'air_quality_hourly'`.
 */
export interface AirQualityHourly {
  /** Location this series is for (nullable; see {@link WeatherLocation}). */
  readonly location: WeatherLocation | null;
  /** Hourly samples, ascending by `time`, one per hour of the local date. */
  readonly samples: readonly AirQualityHourlySample[];
}

// ---------------------------------------------------------------------------
// Air quality — daily payload
// ---------------------------------------------------------------------------

/**
 * Daily air-quality summary payload for one local calendar date.
 *
 * Stored as the `data` of an {@link IntegrationDailySummary} record with
 * `source: 'weather'`, `dataType: 'air_quality_daily'`.
 *
 * The Open-Meteo air-quality endpoint is hourly-only; these daily aggregates
 * are DERIVED LOCALLY (overnight mean/max) by `@/analysis/weather/aggregation`,
 * not returned by the provider. Fields are nullable when no hours were
 * available to aggregate.
 */
export interface AirQualityDaily {
  /** Location this summary is for (nullable; see {@link WeatherLocation}). */
  readonly location: WeatherLocation | null;
  /** Overnight-mean PM2.5, µg/m³. */
  readonly pm25Mean: number | null;
  /** Overnight-max PM2.5, µg/m³. */
  readonly pm25Max: number | null;
  /** Overnight-mean PM10, µg/m³. */
  readonly pm10Mean: number | null;
  /** Overnight-max PM10, µg/m³. */
  readonly pm10Max: number | null;
  /** Overnight-mean ozone, µg/m³. */
  readonly ozoneMean: number | null;
  /** Overnight-mean nitrogen dioxide, µg/m³. */
  readonly nitrogenDioxideMean: number | null;
  /** Overnight-mean US AQI, unitless. */
  readonly usAqiMean: number | null;
  /** Overnight-max US AQI, unitless. */
  readonly usAqiMax: number | null;
  /** Overnight-mean European AQI, unitless. */
  readonly europeanAqiMean: number | null;
  /** Overnight-max European AQI, unitless. */
  readonly europeanAqiMax: number | null;
}

// ---------------------------------------------------------------------------
// Discriminated payload maps (mirror the Fitbit payload-map convention)
// ---------------------------------------------------------------------------

/** Maps {@link WeatherDailyType} discriminator to its typed payload. */
export type WeatherDailyPayloadMap = {
  readonly weather_daily: WeatherDaily;
  readonly air_quality_daily: AirQualityDaily;
};

/** Maps {@link WeatherHourlyType} discriminator to its typed payload. */
export type WeatherHourlyPayloadMap = {
  readonly weather_hourly: WeatherHourly;
  readonly air_quality_hourly: AirQualityHourly;
};

// ---------------------------------------------------------------------------
// Human-readable labels (UI grouping; mirrors FITBIT_DATA_TYPE_LABEL)
// ---------------------------------------------------------------------------

/** Human-readable labels for each weather data type. */
export const WEATHER_DATA_TYPE_LABEL: Record<WeatherDataType, string> = {
  weather_daily: 'Weather (Daily)',
  weather_hourly: 'Weather (Hourly)',
  air_quality_daily: 'Air Quality (Daily)',
  air_quality_hourly: 'Air Quality (Hourly)',
} as const;
