/**
 * Pure, deterministic per-session analysis helpers for the redesigned Session
 * Details page.
 *
 * Every function here is **pure**: given the same inputs it returns the same
 * output, performs no I/O, touches no React/DOM, and mutates nothing (inputs are
 * treated as read-only). The Session Details UI consumes these directly so that
 * no clinical threshold or statistic is ever re-implemented — or, worse, subtly
 * re-derived — inside a component.
 *
 * ## Honesty rules honoured here (see `views/Dashboard/signalDeck/metrics.ts`)
 * - **`null` is a gap, never `0`.** Per-hour indices on a {@link NightlyAggregate}
 *   are `number | null`, where `null` means the recording fell below the
 *   rate-validity floor so the rate is *undefined*. These are skipped in every
 *   mean/ratio and are never coerced to `0`; a `null` AHI never counts as a pass.
 * - **No re-hardcoded thresholds.** The good-night gates come from
 *   {@link GOOD_NIGHT_AHI_MAX} / {@link GOOD_NIGHT_MIN_HOURS} (themselves derived
 *   from the canonical `AHI_SEVERITY_THRESHOLDS` / `CMS_COMPLIANCE_HOURS`),
 *   AHI severity from {@link classifyAhiSeverity}, and the leak notice level from
 *   {@link LEAK_NOTICE_LPM}. Numbers are re-used, never re-typed.
 * - **No re-implemented statistics.** Null-skipping means go through
 *   {@link seriesMean}; percentage change goes through {@link percentChange};
 *   clustering goes through {@link clusterEventsFLGBridged} (never re-implemented).
 *
 * ## Non-diagnostic
 * Nothing in this module diagnoses. The per-night {@link assessNight} verdict word
 * and the component-strip severity tokens are an **explicitly heuristic
 * presentation layer** — they map established clinical gates and bands to
 * qualitative labels/colours for the UI, and must be presented as a rough
 * summary, not a medical assessment.
 *
 * @module views/Sessions/sessionAssessment
 */

import type { AhiSeverity } from '@/analysis/clinical';
import { classifyAhiSeverity, classifySpo2T90Severity } from '@/analysis/clinical';
import { LEAK_NOTICE_LPM, LEAK_SUPPRESS_LPM, MIN_SPLIT_TOTAL_EVENTS } from '@/analysis/uncertainty';
import type { Cluster, FLGPreset } from '@/analysis/events';
import { clusterEventsFLGBridged } from '@/analysis/events';
import {
  GOOD_NIGHT_AHI_MAX,
  GOOD_NIGHT_MIN_HOURS,
  seriesMean,
} from '@/views/Dashboard/signalDeck/metrics';
import { percentChange } from '@/views/Sessions/comparison-utils';
import type { Event, EventType, NightlyAggregate } from '@/types';

// ===========================================================================
// 1. Per-night verdict — two independent gates, NON-composite
// ===========================================================================

/**
 * Qualitative one-line verdict word for a night.
 *
 * A **heuristic presentation label**, not a clinical instrument: it is a
 * two-bit summary of the two independent good-night gates (effective, adherent),
 * chosen for at-a-glance UI. It does not diagnose.
 */
export type VerdictWord = 'Good night' | 'Fair night' | 'Partial night' | 'Rough night';

/** Result of {@link assessNight}. */
export interface NightVerdict {
  /**
   * Effective gate: `true` when `ahi != null && ahi < AHI_MAX`
   * ({@link GOOD_NIGHT_AHI_MAX}, the normal/mild AASM boundary, = 5). `null` when
   * `ahi` is `null` — residual control **cannot be confirmed** (recording below
   * the rate-validity floor), which is treated as NOT passing, never as a pass.
   */
  readonly effective: boolean | null;
  /** Adherent gate: `usageHours >= MIN_HOURS` ({@link GOOD_NIGHT_MIN_HOURS}, the CMS 4 h floor). */
  readonly adherent: boolean;
  /** The night's AHI (events/hour), or `null` when undefined for this recording. */
  readonly ahi: number | null;
  /** The night's usage hours (mask-on time). Always defined. */
  readonly usageHours: number;
  /** `true` only when the effective gate passed (`effective === true`) AND the adherent gate passed. */
  readonly bothPass: boolean;
  /**
   * Heuristic verdict word: both pass → `'Good night'`; adherent only →
   * `'Fair night'`; effective only → `'Partial night'`; neither → `'Rough night'`.
   * A presentation label, not a diagnosis.
   */
  readonly verdictWord: VerdictWord;
  /**
   * Severity token the UI maps to the verdict colour. This is a colour mapping
   * for the verdict word only — it is **not** the clinical AHI severity of the
   * night (see {@link componentStatuses} for the per-metric AHI severity).
   */
  readonly severityForVerdict: AhiSeverity;
}

/** Verdict word → colour-severity token. `Good → normal … Rough → severe`. */
function severityForVerdictWord(word: VerdictWord): AhiSeverity {
  switch (word) {
    case 'Good night':
      return 'normal';
    case 'Fair night':
      return 'mild';
    case 'Partial night':
      return 'moderate';
    case 'Rough night':
      return 'severe';
  }
}

/**
 * Assess a single night against the **two independent** good-night gates and
 * produce a heuristic one-line verdict.
 *
 * ## Two gates (NON-composite)
 * There is deliberately **no numeric composite score**. The two gates are the
 * same ones the dashboard's good-night rate uses, evaluated for one night:
 *
 * - **Effective** — `ahi != null && ahi < GOOD_NIGHT_AHI_MAX` (AHI in the normal
 *   band, `< 5`). A `null` AHI yields `effective = null` ("cannot confirm"),
 *   which is treated as NOT passing.
 * - **Adherent** — `usageHours >= GOOD_NIGHT_MIN_HOURS` (`>= 4 h`, the CMS floor).
 *
 * The verdict word crosses the two gates into a 2×2 quadrant. It, and its
 * colour token, are a **heuristic presentation layer** — a rough summary for the
 * UI, never a medical assessment.
 *
 * @param aggregate - The night's aggregate (not mutated).
 * @returns The two gate outcomes, the raw AHI/usage, whether both pass, and the
 *   heuristic verdict word + colour token. Deterministic.
 */
export function assessNight(aggregate: NightlyAggregate): NightVerdict {
  const ahi = aggregate.ahi;
  const usageHours = aggregate.usageHours;

  // `null` AHI => cannot confirm effectiveness => null (not a pass), never 0.
  const effective: boolean | null = ahi === null ? null : ahi < GOOD_NIGHT_AHI_MAX;
  const adherent = usageHours >= GOOD_NIGHT_MIN_HOURS;
  const effectivePass = effective === true;
  const bothPass = effectivePass && adherent;

  let verdictWord: VerdictWord;
  if (effectivePass && adherent) verdictWord = 'Good night';
  else if (adherent) verdictWord = 'Fair night';
  else if (effectivePass) verdictWord = 'Partial night';
  else verdictWord = 'Rough night';

  return {
    effective,
    adherent,
    ahi,
    usageHours,
    bothPass,
    verdictWord,
    severityForVerdict: severityForVerdictWord(verdictWord),
  };
}

// ===========================================================================
// 2. Component statuses — 4-segment strip (AHI / Leak / Usage / SpO₂)
// ===========================================================================

/** Identifier for one segment of the component-status strip. */
export type ComponentKey = 'ahi' | 'leak' | 'usage' | 'spo2';

/** One segment of the 4-part component-status strip. */
export interface ComponentStatus {
  /** Stable machine key for the segment. */
  readonly key: ComponentKey;
  /** Human-readable segment label. */
  readonly label: string;
  /**
   * Colour-severity token for the segment, or `null` when the metric is
   * undefined for this night (AHI below the rate-validity floor, or no oximetry).
   * A `null` renders as "no data" (e.g. "—"), never as a passing/normal state.
   */
  readonly severity: AhiSeverity | null;
}

/**
 * Leak severity is a 2-band split over two **canonical** leak anchors, both
 * ResMed device-reporting conventions (not AASM standards):
 *
 * - `< LEAK_NOTICE_LPM` (24 L/min, the AirSense large-leak notice level) →
 *   `'normal'`.
 * - `[LEAK_NOTICE_LPM, LEAK_SUPPRESS_LPM)` (24–30 L/min) → `'moderate'`: a
 *   user-facing notice appears but flow-derived metrics remain usable.
 * - `>= LEAK_SUPPRESS_LPM` (30 L/min, where flow-derived metrics are actually
 *   flagged/suppressed as unreliable) → `'severe'`.
 *
 * Both cut points are imported canonical constants; there is no invented factor.
 */

/** Classify `leakP95` (L/min) into a colour-severity token. */
function classifyLeakSeverity(leakP95: number): AhiSeverity | null {
  if (!Number.isFinite(leakP95)) return null;
  if (leakP95 < LEAK_NOTICE_LPM) return 'normal';
  if (leakP95 < LEAK_SUPPRESS_LPM) return 'moderate';
  return 'severe';
}

/**
 * Compute the four **independent, non-composite** component statuses for the
 * Session Details strip, in fixed order: AHI, Leak, Usage, SpO₂.
 *
 * Each segment is classified in isolation against its own canonical threshold;
 * they are never blended into a single score.
 *
 * - **AHI** — {@link classifyAhiSeverity}; `null` when the night's AHI is `null`
 *   (below the rate-validity floor — undefined, not zero).
 * - **Leak** — `leakP95` against the canonical {@link LEAK_NOTICE_LPM} /
 *   {@link LEAK_SUPPRESS_LPM} anchors (2-band split, see
 *   {@link classifyLeakSeverity}).
 * - **Usage** — compliance: `usageHours >= GOOD_NIGHT_MIN_HOURS` → `'normal'`,
 *   else `'moderate'` (a not-yet-compliant night).
 * - **SpO₂** — the robust, time-based **T90** (`spo2Below90Percent`, % of valid
 *   oximetry time < 90%) against the canonical {@link classifySpo2T90Severity}
 *   bands; `null` when there is no oximetry (`spo2Below90Percent === null`). The
 *   raw single-sample nadir (`spo2Min`) is deliberately NOT used to drive the
 *   colour — one artifact sample must not paint an otherwise-fine night severe.
 *
 * @param aggregate - The night's aggregate (not mutated).
 * @returns Exactly four {@link ComponentStatus} entries in fixed order.
 */
export function componentStatuses(aggregate: NightlyAggregate): ComponentStatus[] {
  const ahiSeverity: AhiSeverity | null =
    aggregate.ahi === null ? null : classifyAhiSeverity(aggregate.ahi);

  const usageSeverity: AhiSeverity =
    aggregate.usageHours >= GOOD_NIGHT_MIN_HOURS ? 'normal' : 'moderate';

  return [
    { key: 'ahi', label: 'AHI', severity: ahiSeverity },
    { key: 'leak', label: 'Leak', severity: classifyLeakSeverity(aggregate.leakP95) },
    { key: 'usage', label: 'Usage', severity: usageSeverity },
    { key: 'spo2', label: 'SpO₂', severity: classifySpo2T90Severity(aggregate.spo2Below90Percent) },
  ];
}

// ===========================================================================
// 3. Session-vs-trailing-baseline delta
// ===========================================================================

/** Which way a metric moved from its trailing baseline to the current session. */
export type DeltaDirection = 'up' | 'down' | 'unchanged';

/** Result of {@link baselineDelta}. */
export interface BaselineDelta {
  /**
   * Null-skipping mean of the prior values (the trailing baseline), or `null`
   * when every prior value is `null`/non-finite or the list is empty. Never `0`
   * for an all-gap baseline.
   */
  readonly mean: number | null;
  /**
   * `current - mean`, or `null` when either operand is `null` (missing current
   * value, or no usable baseline). Never `0` for a missing operand.
   */
  readonly delta: number | null;
  /**
   * Percentage change from the baseline mean to the current value (via
   * {@link percentChange}), or `null` when it is undefined (missing operand, or a
   * zero baseline that makes the percentage undefined).
   */
  readonly percent: number | null;
  /**
   * Direction of {@link delta}: `'up'` when `delta > 0`, `'down'` when
   * `delta < 0`, `'unchanged'` when `delta === 0` **or** `delta` is `null`
   * (nothing to compare). Direction alone does not imply better/worse — that
   * depends on the metric (lower AHI is better, higher usage is better).
   */
  readonly direction: DeltaDirection;
}

/**
 * Compare a session's value to a trailing baseline (e.g. "▲ 1.6 vs 30-night").
 *
 * The baseline is the null-skipping mean of `priorValues` (via {@link seriesMean}),
 * so `null` gaps in the prior window are skipped, never treated as `0`. When the
 * current value is `null` or the baseline has no usable value, `delta`/`percent`
 * are `null` and `direction` is `'unchanged'` — the caller renders "—", never a
 * fabricated `0`.
 *
 * @param current - The current session's value, or `null` when undefined.
 * @param priorValues - Trailing prior values (any order), each `number | null`.
 * @returns The baseline mean, the signed delta, the percentage change, and the
 *   movement direction. Deterministic and null-safe throughout.
 */
export function baselineDelta(
  current: number | null,
  priorValues: readonly (number | null)[],
): BaselineDelta {
  const mean = seriesMean(priorValues);

  if (current === null || !Number.isFinite(current) || mean === null) {
    return { mean, delta: null, percent: null, direction: 'unchanged' };
  }

  const delta = current - mean;
  const rawPercent = percentChange(mean, current);
  const percent = Number.isFinite(rawPercent) ? rawPercent : null;

  const direction: DeltaDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged';

  return { mean, delta, percent, direction };
}

// ===========================================================================
// 4. Longest apnea (from raw events)
// ===========================================================================

/** Apnea event types that count toward "longest apnea" (all AHI-apnea classes). */
const APNEA_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'ObstructiveApnea',
  'CentralApnea',
  'MixedApnea',
  'UnclassifiedApnea',
]);

/** Result of {@link longestApnea}. */
export interface LongestApnea {
  /** Duration of the longest apnea (seconds). */
  readonly durationSec: number;
  /** The apnea's event type. */
  readonly type: EventType;
  /** Epoch-ms timestamp of the apnea onset. */
  readonly timestamp: number;
}

/**
 * Find the single longest apnea among raw events.
 *
 * Only the four apnea classes are considered (obstructive, central, mixed,
 * unclassified — the events that count toward AHI); hypopneas, RERAs, flow
 * limitations, leaks, etc. are ignored. Ties on duration are broken by the
 * **earliest** timestamp so the result is deterministic; if timestamps also tie,
 * the first such event in input order wins.
 *
 * @param events - Raw therapy events (not mutated).
 * @returns The longest apnea's duration/type/timestamp, or `null` when there are
 *   no apnea events.
 */
export function longestApnea(events: readonly Event[]): LongestApnea | null {
  let best: Event | null = null;
  for (const e of events) {
    if (!APNEA_TYPES.has(e.type)) continue;
    if (!Number.isFinite(e.duration)) continue;
    if (
      best === null ||
      e.duration > best.duration ||
      (e.duration === best.duration && e.timestamp < best.timestamp)
    ) {
      best = e;
    }
  }
  if (best === null) return null;
  return { durationSec: best.duration, type: best.type, timestamp: best.timestamp };
}

// ===========================================================================
// 5. Central fraction (a ratio, not a stored field)
// ===========================================================================

/**
 * Central-apnea fraction: central apnea count ÷ total apnea count for the night.
 *
 * This is a **derived ratio computed on the fly**, not a field stored on the
 * aggregate. The denominator is all four apnea classes
 * (`obstructive + central + mixed + unclassified`); `unclassified` is optional on
 * older records and treated as `0` when absent. Hypopneas and RERAs are excluded
 * (they are not apneas).
 *
 * ## Minimum-event gate (patient safety)
 * The ratio is only returned once the apnea total reaches the canonical
 * {@link MIN_SPLIT_TOTAL_EVENTS} floor — the documented minimum before a
 * central-fraction ratio is considered reportable. Below it the ratio is
 * statistically meaningless and, worse, alarming: a 1-apnea night would read
 * "100% central". Such nights return `null` (rendered as "—"), never a
 * fabricated or overstated fraction. The divide-by-zero case (no apneas at all)
 * is subsumed by this gate — `0 < MIN_SPLIT_TOTAL_EVENTS` — and still yields
 * `null`.
 *
 * @param aggregate - The night's aggregate (not mutated).
 * @returns The central fraction in `[0, 1]`, or `null` when the apnea total is
 *   below {@link MIN_SPLIT_TOTAL_EVENTS} (which includes the zero-apnea case).
 */
export function centralFraction(aggregate: NightlyAggregate): number | null {
  const byType = aggregate.eventsByType;
  const central = byType.central;
  const totalApneas =
    byType.obstructive + byType.central + byType.mixed + (byType.unclassified ?? 0);
  if (totalApneas < MIN_SPLIT_TOTAL_EVENTS) return null;
  return central / totalApneas;
}

// ===========================================================================
// 6. Respiratory breakdown (component bars)
// ===========================================================================

/** One respiratory-event component row for the breakdown bars. */
export interface RespiratoryComponent {
  /** The event type this row summarises. */
  readonly type: EventType;
  /** Human-readable label. */
  readonly label: string;
  /**
   * Per-hour rate for this component (events/hour), from the aggregate's `ahi*`
   * field, or `null` when the rate is undefined for this recording (below the
   * rate-validity floor, or the field is absent on an older record). Never `0`
   * for an undefined rate — a genuine zero rate is reported as `0`.
   */
  readonly ratePerHour: number | null;
  /** Raw event count for this component (always defined). */
  readonly count: number;
}

/**
 * Build the per-component respiratory breakdown rows for the Session Details
 * component bars, in clinical-convention order.
 *
 * Obstructive apnea, Hypopnea, and Central apnea are **always** included (even at
 * a zero count) so the primary AHI contributors are always visible. Mixed apnea,
 * Unclassified apnea, and RERA are included **only when their count is non-zero**
 * to avoid cluttering the bars with rows that never fired.
 *
 * Rates come from the `ahi*` per-hour fields (`null` = undefined rate, never
 * coerced to `0`); counts come from `eventsByType` (always defined).
 *
 * @param aggregate - The night's aggregate (not mutated).
 * @returns Component rows in order: Obstructive, Hypopnea, Central, then Mixed,
 *   Unclassified, RERA (each of the last three only if its count > 0).
 */
export function respiratoryBreakdown(aggregate: NightlyAggregate): RespiratoryComponent[] {
  const byType = aggregate.eventsByType;
  const rows: RespiratoryComponent[] = [
    {
      type: 'ObstructiveApnea',
      label: 'Obstructive apnea',
      ratePerHour: aggregate.ahiObstructive,
      count: byType.obstructive,
    },
    {
      type: 'Hypopnea',
      label: 'Hypopnea',
      ratePerHour: aggregate.ahiHypopnea,
      count: byType.hypopnea,
    },
    {
      type: 'CentralApnea',
      label: 'Central apnea',
      ratePerHour: aggregate.ahiCentral,
      count: byType.central,
    },
  ];

  const mixedCount = byType.mixed;
  if (mixedCount > 0) {
    rows.push({
      type: 'MixedApnea',
      label: 'Mixed apnea',
      ratePerHour: aggregate.ahiMixed,
      count: mixedCount,
    });
  }

  const unclassifiedCount = byType.unclassified ?? 0;
  if (unclassifiedCount > 0) {
    rows.push({
      type: 'UnclassifiedApnea',
      label: 'Unclassified apnea',
      ratePerHour: aggregate.ahiUnclassified ?? null,
      count: unclassifiedCount,
    });
  }

  const reraCount = byType.rera;
  if (reraCount > 0) {
    rows.push({
      type: 'RERA',
      label: 'RERA',
      ratePerHour: aggregate.ahiRera,
      count: reraCount,
    });
  }

  return rows;
}

// ===========================================================================
// 7. Session clusters (thin select/sort/shape over the canonical clusterer)
// ===========================================================================

/** A compact, display-ready summary of one event cluster. */
export interface ClusterSummary {
  /** Cluster identifier from the underlying clusterer. */
  readonly id: string;
  /** Epoch-ms window start (earliest event in the cluster). */
  readonly startTime: number;
  /** Epoch-ms window end (latest event end). */
  readonly endTime: number;
  /** Number of events in the cluster. */
  readonly eventCount: number;
  /** Events per minute within the cluster window. */
  readonly density: number;
  /** Seconds of event duration per minute within the cluster window. */
  readonly weightedDensity: number;
  /** Heuristic severity score (span × density) from the clusterer. */
  readonly severityScore: number;
}

/** Result of {@link sessionClusters}. */
export interface SessionClustersResult {
  /** Clusters sorted by {@link Cluster.severityScore} descending. */
  readonly clusters: readonly Cluster[];
  /** Display-ready summaries, in the same (severity-descending) order as {@link clusters}. */
  readonly summaries: readonly ClusterSummary[];
}

/**
 * Select, sort, and shape event clusters for the Session Details view.
 *
 * A **thin wrapper** over {@link clusterEventsFLGBridged} — the clustering itself
 * is never re-implemented here. This function only: runs the canonical clusterer,
 * sorts the resulting clusters by `severityScore` descending (ties broken by
 * earlier `startTime`, then by `id` for full determinism), and derives a compact
 * per-cluster {@link ClusterSummary}.
 *
 * The input is not mutated; a defensive copy is passed to the clusterer.
 *
 * @param events - Raw therapy events (not mutated).
 * @param preset - Optional FLG sensitivity preset; defaults to the clusterer's
 *   own default (`'balanced'`).
 * @returns The severity-sorted clusters and their summaries. Deterministic.
 */
export function sessionClusters(
  events: readonly Event[],
  preset?: FLGPreset,
): SessionClustersResult {
  const { clusters } = clusterEventsFLGBridged([...events], preset);

  const sorted = clusters.slice().sort((a, b) => {
    if (b.severityScore !== a.severityScore) return b.severityScore - a.severityScore;
    if (a.startTime !== b.startTime) return a.startTime - b.startTime;
    return a.id.localeCompare(b.id);
  });

  const summaries: ClusterSummary[] = sorted.map((c) => ({
    id: c.id,
    startTime: c.startTime,
    endTime: c.endTime,
    eventCount: c.events.length,
    density: c.density,
    weightedDensity: c.weightedDensity,
    severityScore: c.severityScore,
  }));

  return { clusters: sorted, summaries };
}
