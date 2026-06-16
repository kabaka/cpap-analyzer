/**
 * Trends chart y-axis display tuning.
 *
 * These are DISPLAY constants — a small headroom multiplier and per-chart
 * minimum axis maxima so a chart never collapses to an unreadable scale when
 * the data happens to be small. They are deliberately NOT clinical thresholds:
 *
 * - The AHI floor (10) is NOT an AHI severity cutoff (those are 5 / 15 / 30 in
 *   `analysis/clinical/ahiSeverity.ts`); it just guarantees the severity zones
 *   are visible on a quiet night.
 * - The leak floor (30) is NOT the leak notice/suppress threshold
 *   (`LEAK_NOTICE_LPM` / `LEAK_SUPPRESS_LPM`).
 * - The usage floor (8) is NOT a compliance target (4 / 6 in
 *   `analysis/clinical/compliance.ts`).
 * - These are also distinct from the signal-lane clinical plotting ranges in
 *   `views/Sessions/signalDomain.ts` (RESMED_CLINICAL_RANGES).
 *
 * Tuning only — changing them alters the rendered scale, never any boundary,
 * classification, or computed value.
 *
 * @module views/Trends/charts/chartScale
 */

/**
 * Headroom multiplier applied to a chart's data maximum so the topmost point
 * is not flush against the axis. 1.1 = 10% of empty space above the peak.
 */
export const CHART_AXIS_HEADROOM = 1.1;

/** Minimum AHI-chart y-axis maximum (events/hour) so severity zones stay visible. */
export const AHI_AXIS_FLOOR = 10;

/** Minimum leak-chart y-axis maximum (L/min) so the notice line stays in view. */
export const LEAK_AXIS_FLOOR = 30;

/** Minimum usage-chart y-axis maximum (hours) so the 4h/6h lines stay in view. */
export const USAGE_AXIS_FLOOR = 8;

/**
 * Compute a chart's y-axis maximum: the larger of the data max scaled by the
 * headroom multiplier, or a fixed display floor.
 *
 * @param dataMax - The largest value present in the series.
 * @param floor - The minimum axis maximum for this chart.
 * @param headroom - Multiplier applied to `dataMax` (defaults to
 *   {@link CHART_AXIS_HEADROOM}).
 */
export function computeAxisMax(
  dataMax: number,
  floor: number,
  headroom: number = CHART_AXIS_HEADROOM,
): number {
  return Math.max(dataMax * headroom, floor);
}
