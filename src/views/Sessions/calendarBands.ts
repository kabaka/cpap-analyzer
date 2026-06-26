/**
 * Clinical colour bands and value formatting for the Sessions calendar heatmap.
 *
 * Each calendar metric (`ahi` | `usage` | `leak`) is coloured by a small set of
 * discrete {@link CalendarBand}s that share one green → amber → orange → red
 * language built from the SOLID `--color-status-*` fills. The band EDGES are
 * derived from the canonical clinical constants wherever a canonical value
 * exists, so the cutoffs are never re-hardcoded here:
 *
 * - **AHI** edges come from {@link AHI_SEVERITY_THRESHOLDS} (AASM / ICSD-3:
 *   5 / 15 / 30 events·h⁻¹).
 * - **Usage** edges come from {@link CMS_COMPLIANCE_HOURS} (4 h) and
 *   {@link RECOMMENDED_USAGE_HOURS} (6 h); the 2 h sub-floor is a local display
 *   constant with no clinical authority.
 * - **Leak** anchors its red edge on {@link LEAK_NOTICE_LPM} (24 L·min⁻¹, the
 *   large-leak notice threshold); 6 and 12 are local display edges.
 *
 * Keeping these tables out of the component render avoids re-allocating the band
 * arrays on every render and keeps the consumer component focused on wiring.
 *
 * @module views/Sessions/calendarBands
 */

import {
  AHI_SEVERITY_THRESHOLDS,
  CMS_COMPLIANCE_HOURS,
  RECOMMENDED_USAGE_HOURS,
} from '@/analysis/clinical';
import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty';
import type { CalendarBand } from '@/components/charts/d3/CalendarHeatmap';
import type { CalendarMetric } from './viewParams';

/**
 * Local display sub-floor (hours) below which usage is treated as the worst
 * tier. NOT a clinical constant — it only subdivides the "under compliance"
 * region for a smoother colour ramp.
 */
const USAGE_CRITICAL_HOURS = 2;

/** Local display edges (L·min⁻¹) subdividing the "acceptable leak" region. */
const LEAK_MILD_LPM = 6;
const LEAK_ELEVATED_LPM = 12;

/**
 * AHI bands (events·h⁻¹) — higher is worse. Edges derive from the canonical
 * {@link AHI_SEVERITY_THRESHOLDS}; `value === null` nights render as PARTIAL
 * ("short recording"), never as 0, so they never enter the Normal band.
 */
const AHI_BANDS: readonly CalendarBand[] = [
  { min: 0, color: 'var(--color-status-normal)', label: 'Normal', rangeLabel: '<5' },
  {
    min: AHI_SEVERITY_THRESHOLDS.mild,
    color: 'var(--color-status-mild)',
    label: 'Mild',
    rangeLabel: '5–<15',
  },
  {
    min: AHI_SEVERITY_THRESHOLDS.moderate,
    color: 'var(--color-status-moderate)',
    label: 'Moderate',
    rangeLabel: '15–<30',
  },
  {
    min: AHI_SEVERITY_THRESHOLDS.severe,
    color: 'var(--color-status-severe)',
    label: 'Severe',
    rangeLabel: '≥30',
  },
];

/**
 * Usage bands (hours) — higher is BETTER, so the colour ramp is inverted:
 * low usage is red (severe) and high usage is green (normal). Edges at 4 h and
 * 6 h come from the canonical compliance / recommended constants.
 */
const USAGE_BANDS: readonly CalendarBand[] = [
  { min: 0, color: 'var(--color-status-severe)', label: 'Under 2h', rangeLabel: '<2h' },
  {
    min: USAGE_CRITICAL_HOURS,
    color: 'var(--color-status-moderate)',
    label: '2–4h',
    rangeLabel: '2–<4h',
  },
  {
    min: CMS_COMPLIANCE_HOURS,
    color: 'var(--color-status-mild)',
    label: '4–6h',
    rangeLabel: '4–<6h',
  },
  {
    min: RECOMMENDED_USAGE_HOURS,
    color: 'var(--color-status-normal)',
    label: '6h+',
    rangeLabel: '≥6h',
  },
];

/**
 * Leak bands (median L·min⁻¹) — lower is better. The red edge is anchored on the
 * canonical {@link LEAK_NOTICE_LPM} large-leak threshold; the 6 and 12 edges are
 * local display subdivisions.
 */
const LEAK_BANDS: readonly CalendarBand[] = [
  { min: 0, color: 'var(--color-status-normal)', label: 'Good', rangeLabel: '<6' },
  { min: LEAK_MILD_LPM, color: 'var(--color-status-mild)', label: 'Mild', rangeLabel: '6–<12' },
  {
    min: LEAK_ELEVATED_LPM,
    color: 'var(--color-status-moderate)',
    label: 'Elevated',
    rangeLabel: '12–<24',
  },
  { min: LEAK_NOTICE_LPM, color: 'var(--color-status-severe)', label: 'High', rangeLabel: '≥24' },
];

/** Per-metric presentation: legend bands, units caption, tooltip formatter, partial text. */
export interface CalendarMetricConfig {
  /** Discrete colour bands for the heatmap, ordered by ascending `min`. */
  readonly bands: readonly CalendarBand[];
  /** Legend caption with units, e.g. `'AHI (events/h)'`. */
  readonly metricLabel: string;
  /** Formats a numeric value for the tooltip. */
  readonly metricFormatter: (v: number) => string;
  /**
   * Tooltip text for `value === null` (partial) cells. Only AHI can be partial
   * in practice (a too-short recording has no per-hour rate); usage and leak are
   * always numeric, so their `partialLabel` is a harmless fallback.
   */
  readonly partialLabel: string;
}

/** Calendar presentation config keyed by metric. */
export const CALENDAR_METRIC_CONFIG: Record<CalendarMetric, CalendarMetricConfig> = {
  ahi: {
    bands: AHI_BANDS,
    metricLabel: 'AHI (events/h)',
    metricFormatter: (v) => v.toFixed(1),
    partialLabel: 'Short recording — AHI not available',
  },
  usage: {
    bands: USAGE_BANDS,
    metricLabel: 'Usage (hours)',
    metricFormatter: (v) => `${v.toFixed(1)}h`,
    partialLabel: 'Short recording — usage not available',
  },
  leak: {
    bands: LEAK_BANDS,
    metricLabel: 'Leak median (L/min)',
    metricFormatter: (v) => v.toFixed(1),
    partialLabel: 'Short recording — leak not available',
  },
};
