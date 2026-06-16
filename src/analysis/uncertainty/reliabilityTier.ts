/**
 * Per-metric reliability tier + data-quality flags.
 *
 * A metric's intrinsic reliability (`ReliabilityTier`) and a per-session
 * degrading condition (`DataQualityFlag`) are **orthogonal** concerns
 * (consensus D1): a `high`-tier metric can still carry a `high-leak` flag.
 * "Unavailable" is a render state, not a tier, and is out of scope here.
 *
 * This module is intentionally INDEPENDENT of
 * `src/analysis/breathing/confidenceTier.ts`. That module maps a continuous
 * morphology score to a tier for the breathing detector and its consumers
 * (`ConfidenceBar`, `SignalViewer`, breathing analysis); it is not touched
 * here and shares only the `'low' | 'moderate' | 'high'` vocabulary.
 *
 * @module analysis/uncertainty/reliabilityTier
 */

import {
  LEAK_NOTICE_LPM,
  LEAK_SUPPRESS_LPM,
  MIN_SPLIT_TOTAL_EVENTS,
  MIN_RARE_CLASS_EVENTS,
  SPO2_COVERAGE_MIN,
  SHORT_SESSION_HOURS,
  POISSON_NORMAL_APPROX_MIN_COUNT,
} from './constants';

/** Intrinsic reliability of a metric/estimate (consensus D1, D5). */
export type ReliabilityTier = 'high' | 'moderate' | 'low';

/**
 * A per-session condition that degrades a value (consensus D1). Orthogonal to
 * the tier and may co-occur with any tier.
 */
export type DataQualityFlag = 'high-leak' | 'short-session' | 'low-coverage' | 'low-count';

/** Context used to downgrade tiers and attach data-quality flags. */
export interface ReliabilityContext {
  /** Median unintentional leak for the session, L/min. */
  readonly medianLeak?: number;
  /** Mask-on session length, hours. */
  readonly maskOnHours?: number;
  /** Total event count N driving the index. */
  readonly eventCount?: number;
  /** Count of the rarer sub-class (e.g. central) for a split. */
  readonly rareClassCount?: number;
  /** Fraction [0, 1] of the recording with valid SpO₂ samples. */
  readonly spo2Coverage?: number;
}

/** Full reliability assessment for a metric in a given context. */
export interface ReliabilityAssessment {
  readonly tier: ReliabilityTier;
  /** Active data-quality flags (orthogonal to the tier), de-duplicated. */
  readonly flags: readonly DataQualityFlag[];
}

/**
 * Canonical metric identifiers known to the reliability registry. Unknown ids
 * are accepted at runtime (string) but fall back to `moderate`.
 */
export type MetricId =
  // --- high (reliable; no chip; show with precision) ----------------------
  | 'pressure'
  | 'pressureMedian'
  | 'pressureP95'
  | 'epap'
  | 'ipap'
  | 'usage'
  | 'maskOnTime'
  | 'compliance'
  | 'leakBelow'
  // --- moderate (algorithmically detected; leak-gated) --------------------
  | 'apneaCount'
  | 'ahi'
  | 'hypopneaCount'
  | 'hypopneaIndex'
  | 'tidalVolume'
  | 'minuteVentilation'
  | 'respiratoryRate'
  // --- low ("surface, don't diagnose") ------------------------------------
  | 'centralObstructiveSplit'
  | 'centralFraction'
  | 'flowLimitation'
  | 'rera'
  | 'wearableSpo2'
  | 'sleepStage';

/**
 * Which data-quality gates are evaluated for each metric. This keeps the
 * downgrade logic table-driven and deterministic.
 */
interface MetricProfile {
  readonly baseTier: ReliabilityTier;
  /** Flow-derived → subject to the leak gate (notice at 24, suppress at 30). */
  readonly leakGated: boolean;
  /** Count-driven (Poisson) → subject to the low-count gate. */
  readonly countGated: boolean;
  /** Central/obstructive split → subject to the rare-class split gate. */
  readonly splitGated: boolean;
  /** SpO₂-derived → subject to the coverage gate. */
  readonly coverageGated: boolean;
  /** Single-session value → subject to the short-session flag. */
  readonly sessionGated: boolean;
}

/**
 * Base-tier + gate registry per consensus D5.
 *
 * - high: delivered/measured pressure; usage / mask-on time; compliance;
 *   unintentional leak below threshold.
 * - moderate: apnea count, AHI, hypopnea count/index, Vt, MV, RR.
 * - low: central-vs-obstructive split, flow-limitation, RERA, wearable SpO₂,
 *   multi-stage sleep.
 */
const REGISTRY: Readonly<Record<MetricId, MetricProfile>> = {
  // high ---------------------------------------------------------------------
  pressure: profile('high'),
  pressureMedian: profile('high'),
  pressureP95: profile('high'),
  epap: profile('high'),
  ipap: profile('high'),
  usage: profile('high', { sessionGated: true }),
  maskOnTime: profile('high', { sessionGated: true }),
  compliance: profile('high'),
  leakBelow: profile('high'),
  // moderate -----------------------------------------------------------------
  apneaCount: profile('moderate', { countGated: true, sessionGated: true }),
  ahi: profile('moderate', { countGated: true, sessionGated: true }),
  hypopneaCount: profile('moderate', { leakGated: true, countGated: true, sessionGated: true }),
  hypopneaIndex: profile('moderate', { leakGated: true, countGated: true, sessionGated: true }),
  tidalVolume: profile('moderate', { leakGated: true, sessionGated: true }),
  minuteVentilation: profile('moderate', { leakGated: true, sessionGated: true }),
  respiratoryRate: profile('moderate', { leakGated: true, sessionGated: true }),
  // low ----------------------------------------------------------------------
  centralObstructiveSplit: profile('low', { leakGated: true, splitGated: true }),
  centralFraction: profile('low', { leakGated: true, splitGated: true }),
  flowLimitation: profile('low', { leakGated: true }),
  rera: profile('low'),
  wearableSpo2: profile('low', { coverageGated: true }),
  sleepStage: profile('low'),
};

/** Construct a {@link MetricProfile} with sensible defaults. */
function profile(
  baseTier: ReliabilityTier,
  opts: Partial<Omit<MetricProfile, 'baseTier'>> = {},
): MetricProfile {
  return {
    baseTier,
    leakGated: opts.leakGated ?? false,
    countGated: opts.countGated ?? false,
    splitGated: opts.splitGated ?? false,
    coverageGated: opts.coverageGated ?? false,
    sessionGated: opts.sessionGated ?? false,
  };
}

const TIER_ORDER: readonly ReliabilityTier[] = ['high', 'moderate', 'low'];

/** Downgrade a tier by `steps`, clamped at the `low` floor. */
function downgrade(tier: ReliabilityTier, steps: number): ReliabilityTier {
  if (steps <= 0) return tier;
  const idx = TIER_ORDER.indexOf(tier);
  const next = Math.min(TIER_ORDER.length - 1, idx + steps);
  return TIER_ORDER[next] as ReliabilityTier;
}

/**
 * Look up the intrinsic base tier for a metric, without context. Unknown
 * metric ids fall back to `moderate` (never throws).
 */
export function baseReliabilityTier(metricId: string): ReliabilityTier {
  const p = REGISTRY[metricId as MetricId];
  return p ? p.baseTier : 'moderate';
}

/**
 * Assess a metric's reliability tier and data-quality flags in a session
 * context.
 *
 * Tier downgrades (each applied once, clamped at `low`):
 * - **Leak gate** (flow-derived metrics): leak ≥ {@link LEAK_SUPPRESS_LPM}
 *   downgrades two steps (effectively suppressed); leak in
 *   `[LEAK_NOTICE_LPM, LEAK_SUPPRESS_LPM)` downgrades one step. The aggregate
 *   apnea/AHI is intentionally NOT leak-gated (it is a gross flow-drop rule,
 *   robust to moderate leak — stats-review §8).
 * - **Low-count gate** (count-driven metrics): N <
 *   {@link POISSON_NORMAL_APPROX_MIN_COUNT} downgrades one step (wide Poisson
 *   CI).
 * - **Split gate** (central/obstructive): total <
 *   {@link MIN_SPLIT_TOTAL_EVENTS} or rare-class <
 *   {@link MIN_RARE_CLASS_EVENTS} downgrades one step.
 * - **Coverage gate** (SpO₂-derived): coverage < {@link SPO2_COVERAGE_MIN}
 *   downgrades one step.
 *
 * Data-quality flags (orthogonal — do not change the tier on their own):
 * - `high-leak` when leak ≥ {@link LEAK_NOTICE_LPM} (any leak-gated metric).
 * - `short-session` when maskOnHours < {@link SHORT_SESSION_HOURS}.
 * - `low-coverage` when a coverage-gated metric's coverage <
 *   {@link SPO2_COVERAGE_MIN}.
 * - `low-count` when a count- or split-gated metric falls below its floor.
 *
 * Missing context fields mean "gate not evaluated" — absent data never
 * downgrades.
 *
 * @param metricId the metric identifier (a {@link MetricId} or any string).
 * @param ctx      the session context.
 * @returns the {@link ReliabilityAssessment} (tier + de-duplicated flags).
 */
export function reliabilityTier(
  metricId: string,
  ctx: ReliabilityContext = {},
): ReliabilityAssessment {
  const p = REGISTRY[metricId as MetricId];
  const baseTier = p ? p.baseTier : 'moderate';
  // Unknown metric: no gates apply; return the fallback tier with no flags.
  if (!p) return { tier: baseTier, flags: [] };

  let steps = 0;
  const flags = new Set<DataQualityFlag>();

  // --- Leak gate ----------------------------------------------------------
  if (p.leakGated && ctx.medianLeak !== undefined && Number.isFinite(ctx.medianLeak)) {
    if (ctx.medianLeak >= LEAK_SUPPRESS_LPM) {
      steps += 2;
      flags.add('high-leak');
    } else if (ctx.medianLeak >= LEAK_NOTICE_LPM) {
      steps += 1;
      flags.add('high-leak');
    }
  }

  // --- Low-count gate -----------------------------------------------------
  if (p.countGated && ctx.eventCount !== undefined && Number.isFinite(ctx.eventCount)) {
    if (ctx.eventCount < POISSON_NORMAL_APPROX_MIN_COUNT) {
      steps += 1;
      flags.add('low-count');
    }
  }

  // --- Split gate (rare-class) --------------------------------------------
  if (p.splitGated) {
    const total = ctx.eventCount;
    const rare = ctx.rareClassCount;
    const totalFails =
      total !== undefined && Number.isFinite(total) && total < MIN_SPLIT_TOTAL_EVENTS;
    const rareFails = rare !== undefined && Number.isFinite(rare) && rare < MIN_RARE_CLASS_EVENTS;
    if (totalFails || rareFails) {
      steps += 1;
      flags.add('low-count');
    }
  }

  // --- Coverage gate ------------------------------------------------------
  if (p.coverageGated && ctx.spo2Coverage !== undefined && Number.isFinite(ctx.spo2Coverage)) {
    if (ctx.spo2Coverage < SPO2_COVERAGE_MIN) {
      steps += 1;
      flags.add('low-coverage');
    }
  }

  // --- Short-session flag (orthogonal; no tier change) --------------------
  if (p.sessionGated && ctx.maskOnHours !== undefined && Number.isFinite(ctx.maskOnHours)) {
    if (ctx.maskOnHours < SHORT_SESSION_HOURS) {
      flags.add('short-session');
    }
  }

  return {
    tier: downgrade(baseTier, steps),
    flags: Array.from(flags),
  };
}

/** Human-readable label for a reliability tier. */
export function reliabilityTierLabel(tier: ReliabilityTier): string {
  switch (tier) {
    case 'high':
      return 'High reliability';
    case 'moderate':
      return 'Estimate';
    case 'low':
      return 'Modeled';
  }
}

/** Human-readable label for a data-quality flag. */
export function dataQualityFlagLabel(flag: DataQualityFlag): string {
  switch (flag) {
    case 'high-leak':
      return 'Leak-affected';
    case 'short-session':
      return 'Short session';
    case 'low-coverage':
      return 'Low coverage';
    case 'low-count':
      return 'Few events';
  }
}
