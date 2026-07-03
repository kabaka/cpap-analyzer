/**
 * AQI presentation ramp — the single shared source of truth mapping an AQI
 * severity RANK (1–6) to its colour token, non-colour pattern, and glyph, plus
 * a {@link resolveAqi} helper that goes from a raw value + scale straight to a
 * fully-resolved, renderable descriptor.
 *
 * The numeric categorisation (value → label word + 0-based severity) lives in
 * {@link ./aqi}; this module layers the VISUAL encoding on top so the dashboard
 * tile, the coverage view, the Signal-Viewer ribbon, and any tooltip all agree
 * on rank → {word, colour, pattern, glyph}. Per the visual spec (§1), severity
 * is encoded redundantly as word + number + pattern + glyph so colour is never
 * the sole signal (WCAG 1.4.1).
 *
 * Rank is 1-based here (1 = best … 6 = worst) to match the design spec's
 * `--color-aqi-1…6` tokens; it is simply `aqi.ts` severity + 1.
 *
 * @module analysis/weather/aqiRamp
 */

import {
  categorizeEuropeanAqi,
  categorizeUsAqi,
  type EuropeanAqiCategoryLabel,
  type UsAqiCategoryLabel,
} from './aqi';

/** Which AQI scale a value is on. Mirrors the Open-Meteo variables. */
export type AqiScale = 'us' | 'european';

/**
 * Escalating non-colour band pattern per rank. Mirrors the renderer's
 * `RibbonBand.pattern` enum (data-visualization owns the canvas side); the DOM
 * swatch maps each onto an SVG hatch density.
 */
export type AqiPattern =
  | 'solid'
  | 'hatch-sparse'
  | 'hatch-med'
  | 'hatch-dense'
  | 'crosshatch'
  | 'crosshatch-outline';

/** Visual descriptor for one AQI rank (1–6). */
export interface AqiRampEntry {
  /** 1-based rank (1 = best … 6 = worst). */
  readonly rank: number;
  /** CSS custom property holding the fill colour, e.g. `--color-aqi-3`. */
  readonly colorVar: string;
  /** CSS custom property for the translucent background, e.g. `--color-aqi-3-bg`. */
  readonly bgVar: string;
  /** CSS custom property for on-fill text, e.g. `--color-aqi-3-fg`. */
  readonly fgVar: string;
  /** Non-colour band pattern (escalating hatch density). */
  readonly pattern: AqiPattern;
  /** Single-character glyph shown in narrow contexts. */
  readonly glyph: string;
}

/**
 * Rank → visual encoding. Index 0 is rank 1. The order and patterns/glyphs
 * follow visual-spec §1.2/§1.3 exactly.
 */
export const AQI_RAMP: readonly AqiRampEntry[] = [
  {
    rank: 1,
    colorVar: '--color-aqi-1',
    bgVar: '--color-aqi-1-bg',
    fgVar: '--color-aqi-1-fg',
    pattern: 'solid',
    glyph: '●',
  },
  {
    rank: 2,
    colorVar: '--color-aqi-2',
    bgVar: '--color-aqi-2-bg',
    fgVar: '--color-aqi-2-fg',
    pattern: 'hatch-sparse',
    glyph: '◐',
  },
  {
    rank: 3,
    colorVar: '--color-aqi-3',
    bgVar: '--color-aqi-3-bg',
    fgVar: '--color-aqi-3-fg',
    pattern: 'hatch-med',
    glyph: '◑',
  },
  {
    rank: 4,
    colorVar: '--color-aqi-4',
    bgVar: '--color-aqi-4-bg',
    fgVar: '--color-aqi-4-fg',
    pattern: 'hatch-dense',
    glyph: '▲',
  },
  {
    rank: 5,
    colorVar: '--color-aqi-5',
    bgVar: '--color-aqi-5-bg',
    fgVar: '--color-aqi-5-fg',
    pattern: 'crosshatch',
    glyph: '⧫',
  },
  {
    rank: 6,
    colorVar: '--color-aqi-6',
    bgVar: '--color-aqi-6-bg',
    fgVar: '--color-aqi-6-fg',
    pattern: 'crosshatch-outline',
    glyph: '◆',
  },
] as const;

/** A fully-resolved, renderable AQI descriptor (value + scale → everything). */
export interface ResolvedAqi {
  /** The category word (provider-aware), or `null` when value was `null`. */
  readonly label: UsAqiCategoryLabel | EuropeanAqiCategoryLabel | null;
  /** 1-based rank (1–6), or `null` when value was `null`. */
  readonly rank: number | null;
  /** The rounded display value, or `null`. */
  readonly value: number | null;
  /** Which scale the value is on. */
  readonly scale: AqiScale;
  /** Visual ramp entry for the rank, or `null` when value was `null`. */
  readonly ramp: AqiRampEntry | null;
}

/**
 * Resolve a raw AQI value on a given scale into label word, 1-based rank, and
 * the full visual ramp entry. A `null` value yields all-`null` (so a missing
 * reading is never fabricated into "Good / 0").
 */
export function resolveAqi(value: number | null, scale: AqiScale): ResolvedAqi {
  const category = scale === 'us' ? categorizeUsAqi(value) : categorizeEuropeanAqi(value);
  if (category.severity === null) {
    return { label: null, rank: null, value: null, scale, ramp: null };
  }
  const rank = category.severity + 1;
  const ramp = AQI_RAMP[category.severity] ?? null;
  return {
    label: category.label,
    rank,
    value: value === null ? null : Math.round(value),
    scale,
    ramp,
  };
}
