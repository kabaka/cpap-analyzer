/**
 * Map a continuous breathing-detection confidence in `[0, 1]` to a discrete
 * UI tier. The thresholds are chosen so a tier label can be used as a redundant
 * non-colour cue (low/moderate/high) per the breathing-detection visual spec.
 *
 * The mapping is intentionally conservative — the detector's confidence is a
 * morphology + periodicity score, not a probability of disease (ADR 0017), so
 * the tier should be read as "how strongly the morphology matches", never as
 * a clinical certainty.
 *
 * @module analysis/breathing/confidenceTier
 */

/** Discrete tier label, derived from {@link confidenceTier}. */
export type ConfidenceTier = 'low' | 'moderate' | 'high';

/** Threshold separating low- and moderate-confidence detections. */
export const CONFIDENCE_LOW_MAX = 0.5;
/** Threshold separating moderate- and high-confidence detections. */
export const CONFIDENCE_MODERATE_MAX = 0.75;

/**
 * Bucket a continuous confidence score in `[0, 1]` into one of three tiers.
 *
 * - `low` &lt; 0.5
 * - `moderate` in `[0.5, 0.75)`
 * - `high` ≥ 0.75
 *
 * Non-finite or out-of-range inputs are clamped to `[0, 1]` before bucketing.
 */
export function confidenceTier(value: number): ConfidenceTier {
  if (!Number.isFinite(value)) return 'low';
  const v = value < 0 ? 0 : value > 1 ? 1 : value;
  if (v < CONFIDENCE_LOW_MAX) return 'low';
  if (v < CONFIDENCE_MODERATE_MAX) return 'moderate';
  return 'high';
}

/** Human-readable label for the tier. */
export function confidenceTierLabel(tier: ConfidenceTier): string {
  switch (tier) {
    case 'low':
      return 'Low confidence';
    case 'moderate':
      return 'Moderate confidence';
    case 'high':
      return 'High confidence';
  }
}
