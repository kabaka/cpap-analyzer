/**
 * Weighted overall-progress aggregation for an import job.
 *
 * The per-stage {@link StageProgress} counters are heterogeneous (files vs days
 * vs records vs sessions), so a naive "completed / total" across stages would be
 * meaningless. Instead each stage contributes a fixed WEIGHT to the overall
 * percentage and we sum each stage's fractional completion scaled by its weight:
 *
 *   overall = Σ ( weight_i · fraction_i ) / Σ weight_i
 *
 * Weighting (agreed in the import-redesign plan):
 *   - CPAP:   scan 5, parse 60, build 20, store 15   (parse dominates the wall-clock cost)
 *   - Fitbit: scan 5, import 95
 *
 * Stage fractions:
 *   - done / skipped → 1 (fully credited)
 *   - pending        → 0
 *   - active + determinate (total known, > 0) → completed / total
 *   - active + INDETERMINATE (total unknown)  → held at the stage FLOOR (0 of its
 *     own contribution) so the bar never shows a fake percentage while a total is
 *     unknown. Prior stages are still fully credited, so the overall value climbs
 *     monotonically as stages complete.
 *   - error/warning  → treated by their numeric completion if determinate,
 *     otherwise as pending (we never fabricate completion on a failed stage).
 *
 * Pure & framework-agnostic — directly unit-tested.
 *
 * @module components/import/overallProgress
 */

import type { ImportJobProgress, StageProgress } from '@/services/import/types';

/** Per-stage weights, keyed by job kind then stage id. */
const STAGE_WEIGHTS: Record<ImportJobProgress['kind'], Record<string, number>> = {
  cpap: { scan: 5, parse: 60, build: 20, store: 15 },
  fitbit: { scan: 5, import: 95 },
};

/** Default weight for a stage id not present in the table (defensive). */
const DEFAULT_STAGE_WEIGHT = 1;

/** Resolve the weight for a stage within a job kind. */
function weightFor(kind: ImportJobProgress['kind'], stageId: string): number {
  return STAGE_WEIGHTS[kind][stageId] ?? DEFAULT_STAGE_WEIGHT;
}

/**
 * The completed fraction (0..1) a single stage contributes to its own weight.
 *
 * Indeterminate active stages contribute 0 (held at the floor) so we never show
 * a fabricated percentage before a total is known.
 */
export function stageFraction(stage: StageProgress): number {
  switch (stage.state) {
    case 'done':
    case 'skipped':
      return 1;
    case 'pending':
      return 0;
    case 'active':
    case 'warning':
    case 'error': {
      // Only credit partial progress when we have a real denominator.
      if (stage.determinate && stage.total !== null && stage.total > 0) {
        return clamp01(stage.completed / stage.total);
      }
      // Indeterminate: hold at the floor (no fake percentage).
      return 0;
    }
    default:
      return 0;
  }
}

/** Clamp a number into the inclusive [0, 1] range. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Compute the overall completion percentage (0..100, integer) for a job.
 *
 * Terminal `complete` jobs always read 100; `error` / `cancelled` jobs report
 * the partial progress actually achieved (never snapped to 100).
 */
export function overallPercent(progress: ImportJobProgress): number {
  if (progress.status === 'complete') return 100;

  const { kind, stages } = progress;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const stage of stages) {
    const weight = weightFor(kind, stage.id);
    totalWeight += weight;
    weightedSum += weight * stageFraction(stage);
  }

  if (totalWeight === 0) return 0;
  return Math.round(clamp01(weightedSum / totalWeight) * 100);
}
