/**
 * Canonical AHI (Apnea–Hypopnea Index) severity classification.
 *
 * Single source of truth for the clinical severity cutoffs that were
 * previously duplicated inline across tables, panels, charts, and the PDF
 * report. Per AASM / ICSD-3 the standard adult bands are:
 *
 * - **normal**   — AHI < 5 events/hour
 * - **mild**     — 5 ≤ AHI < 15
 * - **moderate** — 15 ≤ AHI < 30
 * - **severe**   — AHI ≥ 30
 *
 * These are clinical thresholds, NOT display/axis tuning. Chart y-axis floors
 * and headroom live separately (see `views/Trends/charts/chartScale.ts`).
 *
 * @module analysis/clinical/ahiSeverity
 */

/** A clinical AHI severity category (AASM / ICSD-3 adult bands). */
export type AhiSeverity = 'normal' | 'mild' | 'moderate' | 'severe';

/**
 * Lower bounds (events/hour) for each successive severity band.
 *
 * Boundary semantics are "value at or above the threshold enters the next
 * band": AHI < `mild` is normal, < `moderate` is mild, < `severe` is moderate,
 * and ≥ `severe` is severe. These exact numbers (5 / 15 / 30) are the AASM /
 * ICSD-3 standard and must remain the only place the cutoffs are written.
 */
export const AHI_SEVERITY_THRESHOLDS = {
  /** AHI ≥ 5 is at least mild. */
  mild: 5,
  /** AHI ≥ 15 is at least moderate. */
  moderate: 15,
  /** AHI ≥ 30 is severe. */
  severe: 30,
} as const;

/** Shape of an (optionally user-overridden) AHI threshold set. */
export interface AhiSeverityThresholds {
  readonly mild: number;
  readonly moderate: number;
  readonly severe: number;
}

/**
 * Classify an AHI value into its clinical severity band.
 *
 * Pure and deterministic. Uses strict "below the next threshold" boundary
 * semantics so it reproduces the historical inline logic exactly:
 * `< 5 → normal`, `< 15 → mild`, `< 30 → moderate`, otherwise `severe`.
 *
 * @param ahi - Apnea–Hypopnea Index in events/hour.
 * @param thresholds - Optional override of the band lower bounds; defaults to
 *   {@link AHI_SEVERITY_THRESHOLDS}.
 * @returns The clinical severity category.
 */
export function classifyAhiSeverity(
  ahi: number,
  thresholds: AhiSeverityThresholds = AHI_SEVERITY_THRESHOLDS,
): AhiSeverity {
  if (ahi < thresholds.mild) return 'normal';
  if (ahi < thresholds.moderate) return 'mild';
  if (ahi < thresholds.severe) return 'moderate';
  return 'severe';
}
