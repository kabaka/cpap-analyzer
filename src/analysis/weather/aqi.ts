/**
 * Air Quality Index (AQI) category mapping.
 *
 * Maps a numeric AQI value to a category **label word** plus a stable
 * **severity rank**. The severity rank exists so non-colour encodings
 * (text + number + pattern; WCAG AA — colour is never the sole signal) can
 * order and badge categories without relying on hue.
 *
 * Two scales are supported, matching the Open-Meteo air-quality variables
 * `us_aqi` and `european_aqi`:
 *
 * - **US AQI** (US EPA): six categories. Breakpoints (index value, inclusive
 *   lower bound) per the EPA AQI definition (40 CFR Part 58 Appendix G; EPA
 *   "Technical Assistance Document for the Reporting of Daily Air Quality",
 *   EPA-454/B-18-007, Table 4):
 *     0–50      Good
 *     51–100    Moderate
 *     101–150   Unhealthy for Sensitive Groups
 *     151–200   Unhealthy
 *     201–300   Very Unhealthy
 *     301+      Hazardous            (301–500 = Hazardous; >500 "Beyond the AQI")
 *
 * - **European AQI** (European Environment Agency / Copernicus CAMS). Bands per
 *   the EEA European Air Quality Index (https://www.eea.europa.eu/themes/air/
 *   air-quality-index), overall-index value:
 *     0–20      Good
 *     20–40     Fair
 *     40–60     Moderate
 *     60–80     Poor
 *     80–100    Very Poor
 *     100+      Extremely Poor
 *   The EEA bands are half-open `[lower, upper)` on the lower edge; we treat a
 *   value as belonging to the band whose lower bound it meets or exceeds (so 20
 *   → Fair, 40 → Moderate, 100 → Extremely Poor), which matches Open-Meteo's
 *   categorisation.
 *
 * This module is pure and dependency-free.
 *
 * @module analysis/weather/aqi
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** US EPA AQI category words. */
export type UsAqiCategoryLabel =
  | 'Good'
  | 'Moderate'
  | 'Unhealthy for Sensitive Groups'
  | 'Unhealthy'
  | 'Very Unhealthy'
  | 'Hazardous';

/** European AQI category words. */
export type EuropeanAqiCategoryLabel =
  | 'Good'
  | 'Fair'
  | 'Moderate'
  | 'Poor'
  | 'Very Poor'
  | 'Extremely Poor';

/**
 * Result of categorising an AQI value.
 *
 * `severity` is a 0-based rank: 0 = best (cleanest air), increasing with
 * worsening air quality. It is stable across scales in the sense of "higher =
 * worse", letting non-colour encodings sort/badge consistently. `null` value
 * inputs yield `label: null`, `severity: null`.
 */
export interface AqiCategory<L extends string> {
  /** The category word, or `null` when the input value was `null`. */
  readonly label: L | null;
  /** 0-based severity rank (0 = best); `null` when the input value was `null`. */
  readonly severity: number | null;
}

// ---------------------------------------------------------------------------
// Breakpoint tables (inclusive lower bound -> label), best-first
// ---------------------------------------------------------------------------

interface Band<L extends string> {
  /** Inclusive lower bound of the band on the index value. */
  readonly lower: number;
  readonly label: L;
}

/** US EPA AQI bands, ascending by lower bound. Severity = array index. */
const US_AQI_BANDS: readonly Band<UsAqiCategoryLabel>[] = [
  { lower: 0, label: 'Good' },
  { lower: 51, label: 'Moderate' },
  { lower: 101, label: 'Unhealthy for Sensitive Groups' },
  { lower: 151, label: 'Unhealthy' },
  { lower: 201, label: 'Very Unhealthy' },
  { lower: 301, label: 'Hazardous' },
];

/** European AQI bands, ascending by lower bound. Severity = array index. */
const EUROPEAN_AQI_BANDS: readonly Band<EuropeanAqiCategoryLabel>[] = [
  { lower: 0, label: 'Good' },
  { lower: 20, label: 'Fair' },
  { lower: 40, label: 'Moderate' },
  { lower: 60, label: 'Poor' },
  { lower: 80, label: 'Very Poor' },
  { lower: 100, label: 'Extremely Poor' },
];

// ---------------------------------------------------------------------------
// Core categoriser
// ---------------------------------------------------------------------------

/**
 * Find the band a value belongs to: the highest band whose inclusive `lower`
 * bound the value meets or exceeds. Returns the band index as severity.
 *
 * Values below the first band's lower bound (negative AQI — not physically
 * meaningful but defended against) clamp to the first band. Non-finite values
 * yield `null`.
 */
function categorise<L extends string>(
  value: number | null,
  bands: readonly Band<L>[],
): AqiCategory<L> {
  if (value === null || !Number.isFinite(value)) {
    return { label: null, severity: null };
  }
  let severity = 0;
  for (let i = 0; i < bands.length; i++) {
    if (value >= (bands[i] as Band<L>).lower) {
      severity = i;
    } else {
      break;
    }
  }
  return { label: (bands[severity] as Band<L>).label, severity };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Categorise a US EPA AQI value (0–500+ scale) into its label word and
 * severity rank (0 = Good … 5 = Hazardous).
 *
 * Boundary behaviour: bounds are inclusive lower bounds, so 50 → Good, 51 →
 * Moderate, 100 → Moderate, 101 → Unhealthy for Sensitive Groups, 300 → Very
 * Unhealthy, 301 → Hazardous. Values > 500 ("Beyond the AQI") still report
 * Hazardous (the worst defined category).
 */
export function categorizeUsAqi(value: number | null): AqiCategory<UsAqiCategoryLabel> {
  return categorise(value, US_AQI_BANDS);
}

/**
 * Categorise a European AQI value into its label word and severity rank
 * (0 = Good … 5 = Extremely Poor).
 *
 * Boundary behaviour: lower bounds are inclusive, so 20 → Fair, 40 → Moderate,
 * 60 → Poor, 80 → Very Poor, 100 → Extremely Poor.
 */
export function categorizeEuropeanAqi(value: number | null): AqiCategory<EuropeanAqiCategoryLabel> {
  return categorise(value, EUROPEAN_AQI_BANDS);
}

/** Total number of US AQI severity ranks (0..N-1). */
export const US_AQI_SEVERITY_COUNT = US_AQI_BANDS.length;

/** Total number of European AQI severity ranks (0..N-1). */
export const EUROPEAN_AQI_SEVERITY_COUNT = EUROPEAN_AQI_BANDS.length;
