/**
 * Coordinate rounding and archive-vs-forecast routing constants for the
 * Open-Meteo weather integration.
 *
 * ## Privacy contract (ADR 0022, decision 2.6)
 *
 * Coordinates MUST be rounded to **exactly 2 decimal places (~1.1 km at the
 * equator)** BEFORE they are placed into any outbound request. GPS-precise
 * coordinates never leave the device. {@link roundCoordinate} is the single
 * canonical rounding primitive; the network layer must call it on every
 * latitude and longitude immediately before constructing a request URL, and the
 * stored {@link import('@/types/weather').WeatherLocation} values are the
 * rounded ones.
 *
 * This module is pure and dependency-free so the rounding contract can be
 * exhaustively unit-tested in isolation.
 *
 * @module analysis/weather/coordinates
 */

/** Number of decimal places coordinates are rounded to before any request. */
export const COORDINATE_DECIMAL_PLACES = 2;

/**
 * Round a coordinate (latitude or longitude, decimal degrees) to exactly 2
 * decimal places.
 *
 * Rounding rules:
 * - Round-half-away-from-zero on the MAGNITUDE, then re-apply the sign, so the
 *   privacy coarsening is symmetric about zero (`Math.round` alone rounds half
 *   toward +∞, which would treat `+x.xx5` and `−x.xx5` asymmetrically). The
 *   rounding is performed by scaling by 100, rounding to the nearest integer,
 *   and dividing back.
 * - Normalizes `-0` to `0`.
 * - Non-finite inputs (`NaN`, `±Infinity`) are returned unchanged — callers are
 *   responsible for rejecting them before sending a request; this function does
 *   not fabricate a finite coordinate from garbage.
 *
 * Floating-point caveat (IMPORTANT — affects exact `…5` half-way inputs):
 * the rounding operates on the IEEE-754 double, not on the decimal you typed.
 * A literal such as `1.005` is stored as `1.00499999999999989…`, i.e. just
 * BELOW the half-way point, so it correctly rounds DOWN to `1.00` — whereas
 * `0.005` is stored as `0.005000000000000000104…`, just ABOVE, and rounds UP to
 * `0.01`. This is round-to-nearest-double behaviour, not a bug; matching naive
 * decimal intuition for inexactly-representable halves is impossible without a
 * decimal library, and is irrelevant for a ~1.1 km privacy coarsening. The
 * function is fully deterministic given the input double.
 *
 * @param value - Coordinate in decimal degrees.
 * @returns The coordinate rounded to 2 dp (or the original value if non-finite).
 */
export function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** COORDINATE_DECIMAL_PLACES;
  // Round the magnitude away from zero, then re-apply the sign so the coarsening
  // is symmetric about zero.
  const sign = value < 0 ? -1 : 1;
  const rounded = (sign * Math.round(Math.abs(value) * factor)) / factor;
  // Normalize -0 to 0.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Number of days behind "today" the Open-Meteo historical ARCHIVE API
 * (`archive-api.open-meteo.com`, ERA5 reanalysis) lags. Dates at or before
 * `today − ARCHIVE_LAG_DAYS` are served by the archive; more recent dates must
 * use the forecast API's `past_days` window instead.
 *
 * See the design reference §4.1.
 */
export const ARCHIVE_LAG_DAYS = 5;

/** Which Open-Meteo endpoint family serves a requested night's data. */
export type WeatherEndpointRoute = 'archive' | 'forecast';

/**
 * Decide whether a requested local date should be fetched from the historical
 * archive endpoint or the forecast (`past_days`) endpoint.
 *
 * Routing rule (design reference §4.1, single shared constant):
 *
 *   use the ARCHIVE when `date ≤ today − ARCHIVE_LAG_DAYS`, otherwise FORECAST.
 *
 * Comparison is done purely on the `YYYY-MM-DD` civil-date strings (lexical
 * comparison is correct for zero-padded ISO dates), so it is timezone-stable
 * and deterministic given the two inputs. The caller supplies `today` (the
 * reference "today" in the same calendar frame as `date`) so the function stays
 * pure and testable — it never reads the system clock.
 *
 * @param date  - The requested night's local date, `YYYY-MM-DD`.
 * @param today - Reference current local date, `YYYY-MM-DD`.
 * @returns `'archive'` when `date` is at least {@link ARCHIVE_LAG_DAYS} days
 *          before `today`, otherwise `'forecast'`.
 */
export function selectWeatherEndpoint(date: string, today: string): WeatherEndpointRoute {
  const cutover = subtractDaysIso(today, ARCHIVE_LAG_DAYS);
  // date ≤ cutover  ->  archive
  return date <= cutover ? 'archive' : 'forecast';
}

/**
 * Subtract a whole number of days from a `YYYY-MM-DD` date and return the
 * resulting `YYYY-MM-DD` date.
 *
 * Uses UTC math on a midnight-UTC anchor so it is free of DST/timezone drift
 * (we only ever manipulate calendar dates here, never wall-clock instants).
 *
 * @param date - Base date, `YYYY-MM-DD`.
 * @param days - Non-negative whole number of days to subtract.
 * @returns The shifted date as `YYYY-MM-DD`.
 */
export function subtractDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((p) => Number.parseInt(p, 10)) as [number, number, number];
  const anchor = Date.UTC(y, m - 1, d);
  const shifted = new Date(anchor - days * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear().toString().padStart(4, '0');
  const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = shifted.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
