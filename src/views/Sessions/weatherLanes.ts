/**
 * Pure helpers for building the Signal Viewer **weather** lanes from stored
 * hourly weather / air-quality series. Mirrors {@link module:views/Sessions/signalLanes}
 * (the wearable lane builders) so the alignment maths, channel construction, and
 * auto-hide logic can be unit-tested directly, free of React and DOM.
 *
 * ## Three lanes (visual-spec §4)
 *
 * 1. **Conditions ribbon** — one segment per condition run from `weathercode`,
 *    rendered through the existing `render: 'ribbon'` path with a neutral sky
 *    palette and a weather glyph per category.
 * 2. **Barometric pressure** (solid line) and **Temperature** (a SEPARATE
 *    stacked line lane, dashed) — two single-series line lanes, because the
 *    renderer's lanes are single-series (data-visualization finding).
 * 3. **AQI ribbon** — fill `--color-aqi-{rank}` + the rank's escalating-density
 *    pattern from {@link module:analysis/weather/aqiRamp}; the word is carried by
 *    the legend / readout, never relied on inside a narrow band.
 *
 * ## Time alignment (critical — same convention as the wearable lanes)
 *
 * Hourly weather samples carry a local wall-clock `time` string WITHOUT an
 * offset. We parse them with {@link parseWallClockMs} (wall-clock-as-UTC epoch),
 * which is the exact same base the wearable lanes use. Subtracting the session's
 * {@link sessionWallClockEpoch} yields a session-relative offset in ms directly
 * comparable to the CPAP/wearable lanes. See the `signalLanes` module docstring
 * for the full rationale (it applies verbatim here).
 *
 * @module views/Sessions/weatherLanes
 */

import { parseWallClockMs } from '@/analysis/weather/aggregation';
import { AQI_RAMP, resolveAqi, type AqiScale } from '@/analysis/weather/aqiRamp';
import {
  convertPressure,
  convertTemperature,
  convertWind,
  type PressureUnit,
  type TemperatureUnit,
  type WindUnit,
} from '@/analysis/weather/units';
import type { RibbonBand, SignalChannel } from '@/components/charts/canvas/SignalRenderer';
import type { AirQualityHourly, WeatherHourly } from '@/types/weather';

import type { LaneDescriptor, LaneGroup, LaneKindPill } from './signalLanes';

// ---------------------------------------------------------------------------
// Lane identity
// ---------------------------------------------------------------------------

/** The three weather lane ids, stable within a session. */
export const WEATHER_LANE_IDS = {
  conditions: 'weather:conditions',
  pressure: 'weather:pressure',
  temperature: 'weather:temperature',
  aqi: 'weather:aqi',
} as const;

/** Discriminator for which weather lane a spec describes. */
export type WeatherLaneKey = keyof typeof WEATHER_LANE_IDS;

/**
 * Weather lane catalogue: presentation metadata for each lane. Order defines the
 * stack order (conditions ribbon on top, then pressure, temperature, AQI). The
 * `pill` is `'WX'` for every weather lane (a non-colour redundancy cue).
 */
export const WEATHER_LANE_SPECS: readonly {
  readonly key: WeatherLaneKey;
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly group: LaneGroup;
  readonly pill: LaneKindPill;
  readonly colorVar: string;
  readonly render: 'line' | 'step' | 'ribbon';
  readonly heightVar: string;
}[] = [
  {
    key: 'conditions',
    id: WEATHER_LANE_IDS.conditions,
    name: 'Conditions',
    unit: '',
    group: 'weather',
    pill: 'WX',
    colorVar: 'var(--color-text-secondary)',
    render: 'ribbon',
    heightVar: '--signal-lane-height-ribbon',
  },
  {
    key: 'pressure',
    id: WEATHER_LANE_IDS.pressure,
    name: 'Barometric Pressure',
    unit: 'hPa',
    group: 'weather',
    pill: 'WX',
    colorVar: 'var(--color-weather-pressure)',
    render: 'line',
    heightVar: '--signal-lane-height',
  },
  {
    key: 'temperature',
    id: WEATHER_LANE_IDS.temperature,
    name: 'Temperature',
    unit: '°C',
    group: 'weather',
    pill: 'WX',
    colorVar: 'var(--color-weather-temp)',
    render: 'line',
    heightVar: '--signal-lane-height',
  },
  {
    key: 'aqi',
    id: WEATHER_LANE_IDS.aqi,
    name: 'Air Quality',
    unit: 'AQI',
    group: 'weather',
    pill: 'WX',
    colorVar: 'var(--color-aqi-3)',
    render: 'ribbon',
    heightVar: '--signal-lane-height-ribbon',
  },
];

/** Dash pattern (CSS px) for the temperature line — the grayscale distinguisher. */
export const TEMPERATURE_DASH: readonly number[] = [4, 4];

// ---------------------------------------------------------------------------
// Merged hourly sample model
// ---------------------------------------------------------------------------

/**
 * A weather sample projected onto session-relative time, with the raw fields the
 * cursor readout needs. `timeMs` is the wall-clock-as-UTC epoch (NOT yet
 * session-relative); subtract the session epoch for a renderer offset.
 */
export interface WeatherPoint {
  /** Wall-clock-as-UTC epoch of the hour start. */
  readonly timeMs: number;
  readonly temperature2m: number | null;
  readonly pressureMsl: number | null;
  readonly dewpoint2m: number | null;
  readonly windspeed10m: number | null;
  readonly weathercode: number | null;
}

/** An air-quality sample projected onto a wall-clock-as-UTC epoch. */
export interface AirQualityPoint {
  readonly timeMs: number;
  readonly usAqi: number | null;
  readonly europeanAqi: number | null;
}

/**
 * Merge the hourly weather samples of one or more stored date records (the two
 * civil dates a midnight-spanning night straddles) into a single ascending,
 * timestamp-deduplicated series of {@link WeatherPoint}. Non-parseable
 * timestamps are dropped. First occurrence of a timestamp wins.
 */
export function mergeWeatherPoints(
  ...records: ReadonlyArray<WeatherHourly | undefined | null>
): WeatherPoint[] {
  const byTime = new Map<number, WeatherPoint>();
  for (const rec of records) {
    if (!rec) continue;
    for (const s of rec.samples) {
      const ms = parseWallClockMs(s.time);
      if (!Number.isFinite(ms) || byTime.has(ms)) continue;
      byTime.set(ms, {
        timeMs: ms,
        temperature2m: s.temperature2m,
        pressureMsl: s.pressureMsl,
        dewpoint2m: s.dewpoint2m,
        windspeed10m: s.windspeed10m,
        weathercode: s.weathercode,
      });
    }
  }
  return [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Merge the hourly air-quality samples of one or more stored date records into a
 * single ascending, deduplicated {@link AirQualityPoint} series.
 */
export function mergeAirQualityPoints(
  ...records: ReadonlyArray<AirQualityHourly | undefined | null>
): AirQualityPoint[] {
  const byTime = new Map<number, AirQualityPoint>();
  for (const rec of records) {
    if (!rec) continue;
    for (const s of rec.samples) {
      const ms = parseWallClockMs(s.time);
      if (!Number.isFinite(ms) || byTime.has(ms)) continue;
      byTime.set(ms, { timeMs: ms, usAqi: s.usAqi, europeanAqi: s.europeanAqi });
    }
  }
  return [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
}

// ---------------------------------------------------------------------------
// hasData predicates (drive auto-hide, mirroring seriesHasData)
// ---------------------------------------------------------------------------

/** True when any merged weather point carries a finite temperature OR pressure. */
export function weatherSeriesHasData(points: readonly WeatherPoint[]): boolean {
  return points.some(
    (p) => Number.isFinite(p.temperature2m ?? NaN) || Number.isFinite(p.pressureMsl ?? NaN),
  );
}

/** True when any merged weather point carries a finite `weathercode`. */
export function conditionsHaveData(points: readonly WeatherPoint[]): boolean {
  return points.some((p) => p.weathercode !== null && Number.isFinite(p.weathercode));
}

/** True when any merged weather point carries a finite temperature. */
export function temperatureHasData(points: readonly WeatherPoint[]): boolean {
  return points.some((p) => Number.isFinite(p.temperature2m ?? NaN));
}

/** True when any merged weather point carries a finite barometric pressure. */
export function pressureHasData(points: readonly WeatherPoint[]): boolean {
  return points.some((p) => Number.isFinite(p.pressureMsl ?? NaN));
}

/** True when any merged AQI point carries a finite value on the active scale. */
export function aqiSeriesHasData(points: readonly AirQualityPoint[], scale: AqiScale): boolean {
  const pick = (p: AirQualityPoint): number | null => (scale === 'us' ? p.usAqi : p.europeanAqi);
  return points.some((p) => Number.isFinite(pick(p) ?? NaN));
}

/**
 * Pick the AQI scale to display: prefer US (matching the dashboard tile default)
 * when any US value is present; fall back to European when only European data
 * exists; otherwise default to US. Keeps every weather surface on one scale.
 */
export function pickAqiScale(points: readonly AirQualityPoint[]): AqiScale {
  if (aqiSeriesHasData(points, 'us')) return 'us';
  if (aqiSeriesHasData(points, 'european')) return 'european';
  return 'us';
}

// ---------------------------------------------------------------------------
// Weather condition categories (WMO weathercode → glyph + label + palette)
// ---------------------------------------------------------------------------

/**
 * Coarse weather condition categories, derived from the WMO `weathercode`. We
 * bucket the full WMO table into a handful of clinically meaningful runs so the
 * conditions ribbon shows broad regimes (clear / cloud / fog / rain / snow /
 * storm) rather than 28 near-identical codes. Each category carries a glyph and
 * a neutral-sky palette token (NOT a severity/clinical hue).
 */
export type ConditionCategory =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm';

/** Presentation for one condition category. */
export interface ConditionSpec {
  readonly category: ConditionCategory;
  /** Ordinal used as the ribbon band `value` (stable, distinct per category). */
  readonly ordinal: number;
  /** Human-readable word for legend / readout. */
  readonly label: string;
  /** Weather glyph drawn per segment when wide enough. */
  readonly glyph: string;
  /** Neutral-sky palette CSS var for the band fill. */
  readonly colorVar: string;
}

/**
 * The condition catalogue, ordinal-indexed. Order is fixed so the ribbon band
 * stacking (when several categories occur in one night) is deterministic.
 */
export const CONDITION_SPECS: readonly ConditionSpec[] = [
  { category: 'clear', ordinal: 0, label: 'Clear', glyph: '☀', colorVar: '--color-chart-grid' },
  {
    category: 'partly',
    ordinal: 1,
    label: 'Partly cloudy',
    glyph: '⛅',
    colorVar: '--color-surface-tertiary',
  },
  {
    category: 'cloudy',
    ordinal: 2,
    label: 'Cloudy',
    glyph: '☁',
    colorVar: '--color-surface-secondary',
  },
  { category: 'fog', ordinal: 3, label: 'Fog', glyph: '🌫', colorVar: '--color-surface-tertiary' },
  {
    category: 'drizzle',
    ordinal: 4,
    label: 'Drizzle',
    glyph: '🌦',
    colorVar: '--color-weather-pressure',
  },
  {
    category: 'rain',
    ordinal: 5,
    label: 'Rain',
    glyph: '🌧',
    colorVar: '--color-weather-pressure',
  },
  { category: 'snow', ordinal: 6, label: 'Snow', glyph: '❄', colorVar: '--color-surface-elevated' },
  {
    category: 'storm',
    ordinal: 7,
    label: 'Thunderstorm',
    glyph: '⛈',
    colorVar: '--color-text-secondary',
  },
];

/** Lookup a condition spec by its ordinal (the ribbon band `value`). */
export function conditionByOrdinal(ordinal: number): ConditionSpec | undefined {
  return CONDITION_SPECS.find((c) => c.ordinal === ordinal);
}

/**
 * Map a WMO `weathercode` to a coarse {@link ConditionCategory}. Returns `null`
 * for a `null`/non-finite/unknown code so the ribbon shows a gap rather than a
 * fabricated condition. Buckets follow the WMO 4677 / Open-Meteo grouping:
 *
 * - 0 clear; 1–2 partly cloudy; 3 overcast; 45/48 fog; 51–57 drizzle;
 *   61–67 + 80–82 rain; 71–77 + 85–86 snow; 95–99 thunderstorm.
 */
export function weatherCodeToCategory(code: number | null): ConditionCategory | null {
  if (code === null || !Number.isFinite(code)) return null;
  const c = Math.round(code);
  if (c === 0) return 'clear';
  if (c === 1 || c === 2) return 'partly';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95 && c <= 99) return 'storm';
  return null;
}

/** The human-readable condition word for a WMO code, or `null` when unknown. */
export function weatherCodeLabel(code: number | null): string | null {
  const cat = weatherCodeToCategory(code);
  if (!cat) return null;
  return CONDITION_SPECS.find((s) => s.category === cat)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Ribbon band construction
// ---------------------------------------------------------------------------

/**
 * Build the condition ribbon bands for the categories actually present in the
 * night, ordered by the fixed catalogue order. Colours are resolved by the
 * caller (kept out of this pure module). Returns `[]` when no condition data.
 *
 * The band `value` is the category ordinal; the ribbon channel's per-sample data
 * carries the same ordinal so each hour fills its category's row.
 */
export function conditionBands(
  points: readonly WeatherPoint[],
  resolve: (cssVar: string) => string,
): RibbonBand[] {
  const present = new Set<number>();
  for (const p of points) {
    const cat = weatherCodeToCategory(p.weathercode);
    if (cat) {
      const spec = CONDITION_SPECS.find((s) => s.category === cat);
      if (spec) present.add(spec.ordinal);
    }
  }
  return CONDITION_SPECS.filter((s) => present.has(s.ordinal)).map((s) => ({
    value: s.ordinal,
    label: s.glyph,
    color: resolve(s.colorVar),
  }));
}

/**
 * Build the AQI ribbon bands for the ranks present in the night, each fill +
 * escalating-density pattern from the shared {@link resolveAqi} ramp. The band
 * `value` is the 1-based AQI rank; the channel's per-sample data carries each
 * hour's rank so it fills the matching rank's row.
 *
 * This is the wiring the spec calls out: rank → `--color-aqi-{rank}` fill +
 * `aqiRamp` pattern, so the ribbon agrees with the dashboard tile and tooltip.
 */
export function aqiBands(
  points: readonly AirQualityPoint[],
  scale: AqiScale,
  resolve: (cssVar: string) => string,
): RibbonBand[] {
  const ranks = new Set<number>();
  for (const p of points) {
    const value = scale === 'us' ? p.usAqi : p.europeanAqi;
    const resolved = resolveAqi(value, scale);
    if (resolved.rank !== null) ranks.add(resolved.rank);
  }
  const bands: RibbonBand[] = [];
  for (let rank = 1; rank <= 6; rank++) {
    if (!ranks.has(rank)) continue;
    const ramp = AQI_RAMP[rank - 1];
    if (!ramp) continue;
    bands.push({
      value: rank,
      label: ramp.glyph,
      color: resolve(ramp.colorVar),
      pattern: ramp.pattern,
      patternColor: resolve(ramp.fgVar),
    });
  }
  return bands;
}

// ---------------------------------------------------------------------------
// Channel construction
// ---------------------------------------------------------------------------

/** Session-relative projected arrays for a ribbon channel. */
interface RibbonArrays {
  readonly values: Float32Array;
  readonly times: Float64Array;
}

/**
 * Project merged weather points into a conditions-ribbon channel's per-sample
 * ordinal values + session-relative times. Hours whose code is unknown become
 * `NaN` (a ribbon gap). Returns parallel arrays.
 */
export function conditionRibbonArrays(
  points: readonly WeatherPoint[],
  wallClockEpoch: number,
): RibbonArrays {
  const n = points.length;
  const values = new Float32Array(n);
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!p) {
      values[i] = NaN;
      times[i] = 0;
      continue;
    }
    const cat = weatherCodeToCategory(p.weathercode);
    const spec = cat ? CONDITION_SPECS.find((s) => s.category === cat) : undefined;
    values[i] = spec ? spec.ordinal : NaN;
    times[i] = p.timeMs - wallClockEpoch;
  }
  return { values, times };
}

/**
 * Project merged AQI points into an AQI-ribbon channel's per-sample rank values
 * + session-relative times for the active scale. Hours with no valid reading
 * become `NaN` (a ribbon gap, never a fabricated rank).
 */
export function aqiRibbonArrays(
  points: readonly AirQualityPoint[],
  scale: AqiScale,
  wallClockEpoch: number,
): RibbonArrays {
  const n = points.length;
  const values = new Float32Array(n);
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!p) {
      values[i] = NaN;
      times[i] = 0;
      continue;
    }
    const raw = scale === 'us' ? p.usAqi : p.europeanAqi;
    const resolved = resolveAqi(raw, scale);
    values[i] = resolved.rank ?? NaN;
    times[i] = p.timeMs - wallClockEpoch;
  }
  return { values, times };
}

/**
 * Project merged weather points into a single-series LINE channel's arrays for a
 * numeric field (temperature or pressure). Non-finite values are kept as `NaN`
 * so the renderer breaks the line at gaps.
 */
export function weatherLineArrays(
  points: readonly WeatherPoint[],
  pick: (p: WeatherPoint) => number | null,
  wallClockEpoch: number,
): { values: Float32Array; times: Float64Array } {
  const n = points.length;
  const values = new Float32Array(n);
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!p) {
      values[i] = NaN;
      times[i] = 0;
      continue;
    }
    const v = pick(p);
    values[i] = v !== null && Number.isFinite(v) ? v : NaN;
    times[i] = p.timeMs - wallClockEpoch;
  }
  return { values, times };
}

/** Compute a padded [min, max] domain over the finite values (or a fallback). */
export function lineDomain(
  values: Float32Array,
  fallback: { min: number; max: number },
): { min: number; max: number } {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined || Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return fallback;
  if (lo === hi) return { min: lo - 1, max: hi + 1 };
  const pad = (hi - lo) * 0.1;
  return { min: lo - pad, max: hi + pad };
}

/** Default fallback domains (used only when a series is all-NaN). */
export const WEATHER_LINE_FALLBACK = {
  pressure: { min: 990, max: 1030 },
  temperature: { min: 0, max: 30 },
} as const;

/**
 * Build a renderer {@link SignalChannel} for one weather lane. `lineWidth` and
 * `dash` come from the caller (theme-resolved). Returns `null` when the lane has
 * no data (so the caller can omit it — auto-hide).
 */
export function buildWeatherChannel(
  key: WeatherLaneKey,
  ctx: {
    readonly weatherPoints: readonly WeatherPoint[];
    readonly aqiPoints: readonly AirQualityPoint[];
    readonly aqiScale: AqiScale;
    readonly wallClockEpoch: number;
  },
  presentation: {
    readonly resolveColor: (cssVar: string) => string;
    readonly resolveHeight: (token: string) => number;
    readonly pressureLineWidth: number;
    readonly temperatureLineWidth: number;
  },
): SignalChannel | null {
  const spec = WEATHER_LANE_SPECS.find((s) => s.key === key);
  if (!spec) return null;
  const height = presentation.resolveHeight(spec.heightVar);
  const color = presentation.resolveColor(spec.colorVar);

  if (key === 'conditions') {
    const { values, times } = conditionRibbonArrays(ctx.weatherPoints, ctx.wallClockEpoch);
    if (values.length === 0) return null;
    return {
      name: spec.name,
      data: values,
      sampleTimes: times,
      sampleRate: 1 / 3600,
      unit: spec.unit,
      color,
      physicalMin: 0,
      physicalMax: CONDITION_SPECS.length - 1,
      kind: 'wearable',
      render: 'ribbon',
      height,
    };
  }

  if (key === 'aqi') {
    const { values, times } = aqiRibbonArrays(ctx.aqiPoints, ctx.aqiScale, ctx.wallClockEpoch);
    if (values.length === 0) return null;
    return {
      name: spec.name,
      data: values,
      sampleTimes: times,
      sampleRate: 1 / 3600,
      unit: spec.unit,
      color,
      physicalMin: 1,
      physicalMax: 6,
      kind: 'wearable',
      render: 'ribbon',
      height,
    };
  }

  // Line lanes: pressure (solid) / temperature (dashed).
  const pick =
    key === 'pressure'
      ? (p: WeatherPoint): number | null => p.pressureMsl
      : (p: WeatherPoint): number | null => p.temperature2m;
  const { values, times } = weatherLineArrays(ctx.weatherPoints, pick, ctx.wallClockEpoch);
  if (values.length === 0) return null;
  const domain = lineDomain(
    values,
    key === 'pressure' ? WEATHER_LINE_FALLBACK.pressure : WEATHER_LINE_FALLBACK.temperature,
  );
  const base: SignalChannel = {
    name: spec.name,
    data: values,
    sampleTimes: times,
    sampleRate: 1 / 3600,
    unit: spec.unit,
    color,
    physicalMin: domain.min,
    physicalMax: domain.max,
    kind: 'wearable',
    render: 'line',
    sparse: true,
    height,
    lineWidth:
      key === 'pressure' ? presentation.pressureLineWidth : presentation.temperatureLineWidth,
  };
  return key === 'temperature' ? { ...base, dash: TEMPERATURE_DASH } : base;
}

/**
 * Build a {@link LaneDescriptor} for a weather lane, given whether the lane has
 * data this night. Mirrors the wearable lane-descriptor construction in
 * SignalViewer so the existing lane machinery (show/hide, reorder, collapse,
 * persistence, presets) works for free.
 */
export function weatherLaneDescriptor(key: WeatherLaneKey, hasData: boolean): LaneDescriptor {
  const spec = WEATHER_LANE_SPECS.find((s) => s.key === key);
  if (!spec) throw new Error(`Unknown weather lane key: ${key}`);
  return {
    id: spec.id,
    name: spec.name,
    unit: spec.unit,
    group: spec.group,
    pill: spec.pill,
    colorVar: spec.colorVar,
    render: spec.render,
    heightVar: spec.heightVar,
    hasData,
  };
}

// ---------------------------------------------------------------------------
// Keyboard data-cursor readout (required non-visual / WCAG path)
// ---------------------------------------------------------------------------

/** Display-unit preferences for the cursor readout. */
export interface WeatherReadoutUnits {
  readonly temperature: TemperatureUnit;
  readonly pressure: PressureUnit;
  readonly wind: WindUnit;
}

/** The unit suffix spoken for each display unit. */
const TEMP_UNIT_WORD: Record<TemperatureUnit, string> = { C: '°C', F: '°F' };
const PRESSURE_UNIT_WORD: Record<PressureUnit, string> = { hPa: 'hectopascals', inHg: 'inches Hg' };
const WIND_UNIT_WORD: Record<WindUnit, string> = {
  kmh: 'km/h',
  mph: 'mph',
  ms: 'm/s',
};

/**
 * Find the most-recent hourly sample at or before a target wall-clock epoch
 * (step-hold), within one hour of slack on either side so a cursor just past the
 * last hour still reads the night's final sample. Returns `null` when no sample
 * is close enough. Assumes `points` is ascending by `timeMs`.
 */
function sampleAtOrBefore<T extends { readonly timeMs: number }>(
  points: readonly T[],
  targetMs: number,
): T | null {
  if (points.length === 0) return null;
  const HOUR = 3_600_000;
  let best: T | null = null;
  for (const p of points) {
    if (p.timeMs <= targetMs + HOUR) best = p;
    else break;
  }
  // Reject a "best" that is implausibly far in the past (>2h before the cursor),
  // so a cursor before the first sample announces nothing rather than a stale one.
  if (best && targetMs - best.timeMs > 2 * HOUR) return null;
  return best;
}

/** Format a nullable number to `dp` decimals, or `null` when missing. */
function fmt(value: number | null, dp: number): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toFixed(dp);
}

/**
 * Build the weather clause for the keyboard data-cursor `aria-live` readout.
 *
 * Announces (in order, omitting any missing field): temperature, barometric
 * pressure, dew point, wind, the condition word, and — crucially — air quality
 * as **"Air quality: {word}, AQI {value}"** (the word and number TOGETHER, never
 * a bare value), which is the required non-visual path for the colour-encoded AQI
 * ribbon (WCAG 1.4.1). Returns `''` when no weather/AQI sample is near the cursor.
 *
 * @param targetMs   - Cursor wall-clock-as-UTC epoch (sessionEpoch + offsetMs).
 * @param weather    - Merged ascending weather points.
 * @param aqi        - Merged ascending air-quality points.
 * @param aqiScale   - Active AQI scale (drives the provider-aware word).
 * @param units      - Display units for temperature / pressure / wind.
 */
export function weatherCursorReadout(
  targetMs: number,
  weather: readonly WeatherPoint[],
  aqi: readonly AirQualityPoint[],
  aqiScale: AqiScale,
  units: WeatherReadoutUnits,
): string {
  const w = sampleAtOrBefore(weather, targetMs);
  const a = sampleAtOrBefore(aqi, targetMs);
  if (!w && !a) return '';

  const parts: string[] = [];

  if (w) {
    const temp = fmt(convertTemperature(w.temperature2m, units.temperature), 1);
    if (temp !== null) parts.push(`temperature ${temp} ${TEMP_UNIT_WORD[units.temperature]}`);

    const pressure = fmt(
      convertPressure(w.pressureMsl, units.pressure),
      units.pressure === 'inHg' ? 2 : 0,
    );
    if (pressure !== null) {
      parts.push(`barometric pressure ${pressure} ${PRESSURE_UNIT_WORD[units.pressure]}`);
    }

    const dew = fmt(convertTemperature(w.dewpoint2m, units.temperature), 1);
    if (dew !== null) parts.push(`dew point ${dew} ${TEMP_UNIT_WORD[units.temperature]}`);

    const wind = fmt(convertWind(w.windspeed10m, units.wind), 0);
    if (wind !== null) parts.push(`wind ${wind} ${WIND_UNIT_WORD[units.wind]}`);

    const condition = weatherCodeLabel(w.weathercode);
    if (condition !== null) parts.push(condition);
  }

  if (a) {
    const raw = aqiScale === 'us' ? a.usAqi : a.europeanAqi;
    const resolved = resolveAqi(raw, aqiScale);
    if (resolved.label !== null && resolved.value !== null) {
      // Word + number TOGETHER — never a bare value (the required encoding).
      parts.push(`Air quality: ${resolved.label}, AQI ${resolved.value}`);
    }
  }

  if (parts.length === 0) return '';
  return `Weather: ${parts.join('; ')}`;
}
