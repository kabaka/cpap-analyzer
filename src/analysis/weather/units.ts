/**
 * Unit conversions for weather display.
 *
 * Internally all weather data is stored in SI / metric units (see
 * `@/types/weather` module doc): °C, hPa, km/h, mm. These pure functions
 * convert a canonical stored value to a user-selected display unit (and back
 * where useful). Storage values are never mutated — conversion happens only at
 * the rendering edge.
 *
 * Every function:
 * - is pure and deterministic;
 * - returns `null` when given `null` (so a missing value stays missing — never
 *   fabricated into a numeric default);
 * - returns `NaN` for non-finite numeric input rather than a misleading number.
 *
 * Conversion factors are exact (or the standard accepted constants) and are
 * cited inline against reference values used in the unit tests.
 *
 * @module analysis/weather/units
 */

// ---------------------------------------------------------------------------
// Unit token types (mirror IntegrationConfig.weather.units in settings)
// ---------------------------------------------------------------------------

export type TemperatureUnit = 'C' | 'F';
export type PressureUnit = 'hPa' | 'inHg';
export type WindUnit = 'kmh' | 'mph' | 'ms';
export type PrecipUnit = 'mm' | 'in';

// ---------------------------------------------------------------------------
// Internal guard
// ---------------------------------------------------------------------------

/**
 * Apply a numeric conversion while preserving the null/NaN contract: `null`
 * passes through as `null`; non-finite numbers become `NaN`.
 */
function mapNullable(value: number | null, fn: (v: number) => number): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return NaN;
  return fn(value);
}

// ---------------------------------------------------------------------------
// Temperature: °C <-> °F
// ---------------------------------------------------------------------------

/**
 * Celsius -> Fahrenheit: `F = C × 9/5 + 32`.
 *
 * Reference: 0 °C → 32 °F; 100 °C → 212 °F; −40 °C → −40 °F; 37 °C → 98.6 °F.
 */
export function celsiusToFahrenheit(celsius: number | null): number | null {
  return mapNullable(celsius, (c) => (c * 9) / 5 + 32);
}

/**
 * Fahrenheit -> Celsius: `C = (F − 32) × 5/9`.
 *
 * Reference: 32 °F → 0 °C; 212 °F → 100 °C; −40 °F → −40 °C.
 */
export function fahrenheitToCelsius(fahrenheit: number | null): number | null {
  return mapNullable(fahrenheit, (f) => ((f - 32) * 5) / 9);
}

/**
 * Convert a canonical (°C) temperature to the requested display unit.
 */
export function convertTemperature(celsius: number | null, to: TemperatureUnit): number | null {
  return to === 'F' ? celsiusToFahrenheit(celsius) : mapNullable(celsius, (c) => c);
}

// ---------------------------------------------------------------------------
// Pressure: hPa <-> inHg
// ---------------------------------------------------------------------------

/**
 * Inches of mercury per hectopascal.
 *
 * 1 inHg = 3386.389 Pa (conventional inHg at 0 °C) = 33.86389 hPa, so
 * 1 hPa = 1 / 33.86389 inHg ≈ 0.0295299830714 inHg.
 *
 * Reference: 1013.25 hPa (1 standard atmosphere) → 29.9213 inHg.
 */
export const HPA_TO_INHG = 1 / 33.86389;

/** Hectopascals -> inches of mercury. */
export function hpaToInHg(hpa: number | null): number | null {
  return mapNullable(hpa, (h) => h * HPA_TO_INHG);
}

/** Inches of mercury -> hectopascals. */
export function inHgToHpa(inHg: number | null): number | null {
  return mapNullable(inHg, (i) => i / HPA_TO_INHG);
}

/**
 * Convert a canonical (hPa) pressure to the requested display unit.
 */
export function convertPressure(hpa: number | null, to: PressureUnit): number | null {
  return to === 'inHg' ? hpaToInHg(hpa) : mapNullable(hpa, (h) => h);
}

// ---------------------------------------------------------------------------
// Wind speed: km/h <-> mph <-> m/s
// ---------------------------------------------------------------------------

/**
 * Exact factors. 1 km/h = 1000 m / 3600 s = 1/3.6 m/s. 1 mile = 1609.344 m
 * (exact, international mile), so 1 mph = 1.609344 km/h exactly and
 * 1 km/h = 1/1.609344 mph.
 *
 * Reference: 100 km/h → 27.7778 m/s → 62.1371 mph.
 */
export const KMH_TO_MS = 1 / 3.6;
export const KMH_TO_MPH = 1 / 1.609344;

/** Kilometres per hour -> metres per second. */
export function kmhToMs(kmh: number | null): number | null {
  return mapNullable(kmh, (k) => k * KMH_TO_MS);
}

/** Kilometres per hour -> miles per hour. */
export function kmhToMph(kmh: number | null): number | null {
  return mapNullable(kmh, (k) => k * KMH_TO_MPH);
}

/** Metres per second -> kilometres per hour. */
export function msToKmh(ms: number | null): number | null {
  return mapNullable(ms, (m) => m / KMH_TO_MS);
}

/** Miles per hour -> kilometres per hour. */
export function mphToKmh(mph: number | null): number | null {
  return mapNullable(mph, (m) => m / KMH_TO_MPH);
}

/**
 * Convert a canonical (km/h) wind speed to the requested display unit.
 */
export function convertWind(kmh: number | null, to: WindUnit): number | null {
  switch (to) {
    case 'ms':
      return kmhToMs(kmh);
    case 'mph':
      return kmhToMph(kmh);
    case 'kmh':
    default:
      return mapNullable(kmh, (k) => k);
  }
}

// ---------------------------------------------------------------------------
// Precipitation: mm <-> in
// ---------------------------------------------------------------------------

/**
 * 1 inch = 25.4 mm exactly, so 1 mm = 1/25.4 in.
 *
 * Reference: 25.4 mm → 1 in; 12.7 mm → 0.5 in.
 */
export const MM_PER_INCH = 25.4;

/** Millimetres -> inches. */
export function mmToInches(mm: number | null): number | null {
  return mapNullable(mm, (m) => m / MM_PER_INCH);
}

/** Inches -> millimetres. */
export function inchesToMm(inches: number | null): number | null {
  return mapNullable(inches, (i) => i * MM_PER_INCH);
}

/**
 * Convert a canonical (mm) precipitation amount to the requested display unit.
 */
export function convertPrecip(mm: number | null, to: PrecipUnit): number | null {
  return to === 'in' ? mmToInches(mm) : mapNullable(mm, (m) => m);
}
