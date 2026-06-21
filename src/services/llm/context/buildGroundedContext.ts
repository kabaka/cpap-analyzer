/**
 * Grounded-context builders (design reference §1, §2; compute-then-narrate).
 *
 * Pure functions that take the app's **already-computed** data — nightly
 * aggregates, analysis-module outputs, the active AHI thresholds, the compliance
 * constants, and the user's display-unit preferences — and assemble the frozen
 * {@link GroundedContext} snapshot for each insight type. The model may quote
 * the values in this snapshot but can neither recompute them (every numeric is a
 * display *string*, not an operand) nor read anything outside it.
 *
 * Design invariants enforced here:
 * - **Strings, not numbers.** Every quotable metric value is pre-formatted with
 *   {@link file://src/analysis/uncertainty/formatMetric.ts} `formatMetric`, so
 *   the model cannot surface extra precision (design §2 "Why strings").
 * - **Nulls are first-class.** A per-hour rate below `MIN_INDEX_USAGE_HOURS` is
 *   `null`, NOT `0`; it becomes `availability: 'undefined-rate'` with a `null`
 *   `displayValue`. An absent channel becomes `availability: 'unavailable'`.
 * - **Provenance travels with every value.** Each metric carries its
 *   `reliabilityTier`, `dataQualityFlags`, and an app-authored `caveat`; each
 *   trend carries its statistical qualifiers inseparable from its slope.
 * - **Active thresholds, not defaults.** `clinical.ahiThresholds` are the user's
 *   configured cutoffs (or the AASM/ICSD-3 fallback), and `severityBand` is
 *   computed app-side from them — the model never re-bands.
 * - **The `numericAllowList` is built mechanically here** from every quotable
 *   numeral, and the assembled object is run through the redaction guard
 *   ({@link file://src/services/llm/context/redaction.ts}) before it is returned,
 *   so a forbidden field can never be serialized (design §3).
 *
 * Pure and deterministic. No I/O, no store access — callers inject the
 * already-resolved data (dependency injection, for testability and to keep the
 * privacy surface auditable).
 *
 * @module services/llm/context/buildGroundedContext
 */

import type { NightlyAggregate, MachineType } from '@/types/session';
import { classifyAhiSeverity, type AhiSeverityThresholds } from '@/analysis/clinical/ahiSeverity';
import { CMS_COMPLIANCE_HOURS, RECOMMENDED_USAGE_HOURS } from '@/analysis/clinical/compliance';
import { formatMetric } from '@/analysis/uncertainty/formatMetric';
import {
  reliabilityTier,
  type ReliabilityContext,
  type ReliabilityTier,
  type DataQualityFlag,
} from '@/analysis/uncertainty/reliabilityTier';
import type { LinearTrend } from '@/analysis/timeseries';
import type {
  ChartSeriesSnapshot,
  ClinicalReferences,
  DisplayUnitPreferences,
  GroundedContext,
  MachineClass,
  MetricSnapshot,
  ReferenceLine,
  SeriesPoint,
  TrendSnapshot,
} from './types';
import { assertNoForbiddenFields } from './redaction';

// ─── Inputs the builders consume (already-computed app data) ────────────────

/**
 * The active AHI thresholds + display preferences + machine class shared by all
 * insight builders. These are resolved by the caller (frontend/integration
 * wave) from the settings store and the session record — the builders never read
 * stores themselves.
 */
export interface GroundingCommonInput {
  /** The ACTIVE AHI severity cutoffs and whether they are user-overridden. */
  readonly ahiThresholds: AhiSeverityThresholds;
  readonly ahiThresholdsSource: ClinicalReferences['ahiThresholdsSource'];
  /** Coarse device class only (never serial/model/firmware — design §3 R4). */
  readonly machineClass: MachineClass;
  /** The user's display-unit & locale preferences. */
  readonly display: DisplayUnitPreferences;
  /** Generation date (calendar date only — no clock time; design §3 R3). */
  readonly generatedOnDate: string;
}

/** Input for the single-night insight: one aggregate + the shared context. */
export interface SingleNightInput extends GroundingCommonInput {
  readonly aggregate: NightlyAggregate;
}

/**
 * Input for the date-range / trend insight. The trend objects are the
 * **already-computed** `linearTrend` outputs over the selected nights — the
 * builder never receives the raw nightly arrays to trend itself (design §1b).
 */
export interface DateRangeInput extends GroundingCommonInput {
  readonly aggregates: readonly NightlyAggregate[];
  /** Pre-computed trends keyed by their headline metric. */
  readonly trends: readonly DateRangeTrendInput[];
}

/** One already-computed trend plus the metadata needed to phrase it. */
export interface DateRangeTrendInput {
  /** Canonical metric id, e.g. `'ahi'`, `'usage'`, `'leakMedian'`. */
  readonly metricId: string;
  /** Human label, e.g. "AHI". */
  readonly label: string;
  /** Unit of the SLOPE, e.g. "events/h per day". */
  readonly slopeUnit: string;
  /** The `linearTrend()` result over the (null-excluded) nightly series. */
  readonly trend: LinearTrend;
  /** Nights that contributed (post null-exclusion). */
  readonly n: number;
}

/** Input for the "explain this metric / chart" insight. */
export interface ExplainInput extends GroundingCommonInput {
  /** Optional single-metric snapshot (explain-a-KPI variant). */
  readonly metric?: MetricSnapshot;
  /** Optional chart series (explain-a-chart variant). */
  readonly chart?: ChartSeriesSnapshot;
  /** Calendar date scope the explained view covers. */
  readonly scope: { readonly startDate: string; readonly endDate: string };
}

/** Input for the clinical-context note insight. */
export interface ClinicalContextInput extends GroundingCommonInput {
  /** The aggregate whose value is being situated against a named reference. */
  readonly aggregate: NightlyAggregate;
}

// ─── Reference / display constants ──────────────────────────────────────────

const REFERENCE_PROVENANCE =
  'AHI severity bands are AASM / ICSD-3 conventions (or your configured overrides). ' +
  'The 4-hour adherence floor is US CMS / Medicare policy; the 6-hour target is a ' +
  'commonly cited good-adherence goal, not a regulatory floor. Leak thresholds are ' +
  'device-reporting conventions, not clinical standards.';

/** Map the internal therapy mode to the coarse, egress-safe machine class. */
export function machineClassFromType(type: MachineType): MachineClass {
  switch (type) {
    case 'cpap':
      return 'CPAP';
    case 'apap':
      return 'APAP';
    case 'bipap':
      return 'BiPAP';
    case 'vpap':
      return 'VPAP';
    case 'asv':
      return 'ASV';
    default:
      return 'unknown';
  }
}

/** Build the always-present clinical-reference block from the active thresholds. */
function buildClinicalReferences(input: GroundingCommonInput): ClinicalReferences {
  return {
    ahiThresholds: {
      mild: input.ahiThresholds.mild,
      moderate: input.ahiThresholds.moderate,
      severe: input.ahiThresholds.severe,
    },
    ahiThresholdsSource: input.ahiThresholdsSource,
    cmsComplianceHours: CMS_COMPLIANCE_HOURS,
    recommendedUsageHours: RECOMMENDED_USAGE_HOURS,
    complianceDefinition: `A night counts as compliant when mask-on usage is at least ${CMS_COMPLIANCE_HOURS} hours.`,
    referenceProvenance: REFERENCE_PROVENANCE,
  };
}

// ─── Metric-snapshot assembly ───────────────────────────────────────────────

/** Specification for turning one aggregate field into a {@link MetricSnapshot}. */
interface MetricSpec {
  /** Snapshot id (also the precision-registry / allow-list token id). */
  readonly id: string;
  /** Reliability-registry metric id (may differ from the snapshot id). */
  readonly reliabilityId: string;
  readonly label: string;
  readonly unit: string;
  /** The full-precision value, or `null` (undefined rate or absent channel). */
  readonly value: number | null;
  /**
   * Discriminates the two null cases: a per-hour rate below the validity floor
   * is `'undefined-rate'`; an absent channel is `'unavailable'`. Ignored when
   * `value` is non-null.
   */
  readonly nullKind: 'undefined-rate' | 'unavailable';
  /** Precision-registry id for `formatMetric` (defaults to `id`). */
  readonly formatId?: string;
}

/**
 * App-authored caveat for a metric, surfaced verbatim-in-meaning by the
 * narrator when the tier is not `high` or any flag is present (design §4 rule 4).
 */
function caveatFor(tier: ReliabilityTier, flags: readonly DataQualityFlag[]): string | null {
  if (tier === 'high' && flags.length === 0) return null;
  const parts: string[] = [];
  if (tier === 'moderate') parts.push('Estimate');
  else if (tier === 'low') parts.push('Modeled value — surface for awareness, not as a conclusion');
  if (flags.includes('high-leak')) parts.push('leak-affected');
  if (flags.includes('short-session')) parts.push('short recording');
  if (flags.includes('low-coverage')) parts.push('low data coverage');
  if (flags.includes('low-count')) parts.push('few events');
  return parts.length > 0 ? parts.join('; ') : 'Estimate';
}

/** Build one {@link MetricSnapshot} from a spec + reliability context. */
function buildMetric(spec: MetricSpec, relCtx: ReliabilityContext): MetricSnapshot {
  const { tier, flags } = reliabilityTier(spec.reliabilityId, relCtx);
  if (spec.value === null) {
    return {
      id: spec.id,
      label: spec.label,
      availability: spec.nullKind,
      displayValue: null,
      unit: spec.unit,
      reliabilityTier: tier,
      dataQualityFlags: flags,
      caveat: caveatFor(tier, flags),
    };
  }
  return {
    id: spec.id,
    label: spec.label,
    availability: 'present',
    displayValue: formatMetric(spec.formatId ?? spec.id, spec.value),
    unit: spec.unit,
    reliabilityTier: tier,
    dataQualityFlags: flags,
    caveat: caveatFor(tier, flags),
  };
}

/**
 * Build the per-night reliability context from an aggregate (design §1a). Mirrors
 * `ReliabilityContext`: median leak, mask-on hours, event count, rare-class
 * count (central), and SpO₂ coverage fraction.
 */
function reliabilityContextOf(agg: NightlyAggregate): ReliabilityContext {
  const coverage =
    agg.spo2CoveragePercent === null || agg.spo2CoveragePercent === undefined
      ? undefined
      : agg.spo2CoveragePercent / 100;
  return {
    medianLeak: agg.leakMedian,
    maskOnHours: agg.maskOnTimeMinutes / 60,
    eventCount: agg.eventCount,
    rareClassCount: agg.eventsByType.central,
    spo2Coverage: coverage,
  };
}

/**
 * The ordered set of metric specs for a single night. Per-hour indices use
 * `nullKind: 'undefined-rate'` (a `null` is the validity floor, NOT zero);
 * channel-gated metrics (SpO₂, bilevel pressures, respiratory) use
 * `'unavailable'`.
 */
function singleNightMetricSpecs(agg: NightlyAggregate): MetricSpec[] {
  const specs: MetricSpec[] = [
    rate('ahi', 'ahi', 'AHI', agg.ahi),
    rate('ahiObstructive', 'apneaCount', 'Obstructive apnea index', agg.ahiObstructive, 'ahi'),
    rate('ahiCentral', 'centralFraction', 'Central apnea index', agg.ahiCentral, 'ahi'),
    rate('ahiHypopnea', 'hypopneaIndex', 'Hypopnea index', agg.ahiHypopnea, 'hypopneaIndex'),
    rate('rdi', 'ahi', 'RDI', agg.rdi ?? null, 'rdi'),
    rate('ahiRera', 'rera', 'RERA index', agg.ahiRera, 'ahi'),
    {
      id: 'eventCount',
      reliabilityId: 'apneaCount',
      label: 'Total scored events',
      unit: 'count',
      value: agg.eventCount,
      nullKind: 'unavailable',
      formatId: 'count',
    },
    {
      id: 'usageHours',
      reliabilityId: 'usage',
      label: 'Usage',
      unit: 'h',
      value: agg.usageHours,
      nullKind: 'unavailable',
      formatId: 'usage',
    },
    {
      id: 'maskOnMinutes',
      reliabilityId: 'maskOnTime',
      label: 'Mask-on time',
      unit: 'min',
      value: agg.maskOnTimeMinutes,
      nullKind: 'unavailable',
      formatId: 'count',
    },
    {
      id: 'pressureMedian',
      reliabilityId: 'pressureMedian',
      label: 'Median pressure',
      unit: 'cmH2O',
      value: agg.pressureMedian,
      nullKind: 'unavailable',
      formatId: 'pressure',
    },
    {
      id: 'pressureP95',
      reliabilityId: 'pressureP95',
      label: '95th-percentile pressure',
      unit: 'cmH2O',
      value: agg.pressureP95,
      nullKind: 'unavailable',
      formatId: 'pressure',
    },
    {
      id: 'pressureMax',
      reliabilityId: 'pressure',
      label: 'Maximum pressure',
      unit: 'cmH2O',
      value: agg.pressureMax,
      nullKind: 'unavailable',
      formatId: 'pressure',
    },
    chan('epapMedian', 'epap', 'Median EPAP', 'cmH2O', agg.epapMedian, 'pressure'),
    chan('ipapMedian', 'ipap', 'Median IPAP', 'cmH2O', agg.ipapMedian, 'pressure'),
    chan('pressureSupport', 'ipap', 'Pressure support', 'cmH2O', agg.pressureSupport, 'pressure'),
    {
      id: 'leakMedian',
      reliabilityId: 'leakBelow',
      label: 'Median leak',
      unit: 'L/min',
      value: agg.leakMedian,
      nullKind: 'unavailable',
      formatId: 'leakMedian',
    },
    {
      id: 'leakP95',
      reliabilityId: 'leakBelow',
      label: '95th-percentile leak',
      unit: 'L/min',
      value: agg.leakP95,
      nullKind: 'unavailable',
      formatId: 'leakP95',
    },
    {
      id: 'leakMax',
      reliabilityId: 'leakBelow',
      label: 'Maximum leak',
      unit: 'L/min',
      value: agg.leakMax,
      nullKind: 'unavailable',
      formatId: 'leakMax',
    },
    {
      id: 'leakMinutesOver24',
      reliabilityId: 'leakBelow',
      label: 'Minutes with high leak',
      unit: 'min',
      value: agg.leakDurationMinutes,
      nullKind: 'unavailable',
      formatId: 'count',
    },
    chan('spo2Mean', 'wearableSpo2', 'Mean SpO2', '%', agg.spo2Mean, 'spo2'),
    chan('spo2Median', 'wearableSpo2', 'Median SpO2', '%', agg.spo2Median, 'spo2'),
    chan('spo2Min', 'wearableSpo2', 'Minimum SpO2', '%', agg.spo2Min, 'spo2Min'),
    chan('t90Percent', 'wearableSpo2', 'T90 (time below 90%)', '%', agg.spo2Below90Percent, 't90'),
    chan(
      'spo2CoveragePercent',
      'wearableSpo2',
      'SpO2 coverage',
      '%',
      agg.spo2CoveragePercent ?? null,
      'compliance',
    ),
    rate('odi', 'wearableSpo2', 'Oxygen desaturation index', agg.oxygenDesaturationIndex, 'odi'),
    chan(
      'tidalVolumeMedian',
      'tidalVolume',
      'Median tidal volume',
      'mL',
      agg.tidalVolumeMedian,
      'tidalVolume',
    ),
    chan(
      'minuteVentMean',
      'minuteVentilation',
      'Mean minute ventilation',
      'L/min',
      agg.minuteVentMean,
      'minuteVentilation',
    ),
    chan(
      'respRateMedian',
      'respiratoryRate',
      'Median respiratory rate',
      'breaths/min',
      agg.respRateMedian,
      'respiratoryRate',
    ),
  ];
  return specs;
}

/** Helper: a per-hour rate spec (null ⇒ undefined-rate, never zero). */
function rate(
  id: string,
  reliabilityId: string,
  label: string,
  value: number | null,
  formatId?: string,
): MetricSpec {
  return {
    id,
    reliabilityId,
    label,
    unit: 'events/h',
    value,
    nullKind: 'undefined-rate',
    formatId: formatId ?? id,
  };
}

/** Helper: a channel-gated metric spec (null ⇒ unavailable channel). */
function chan(
  id: string,
  reliabilityId: string,
  label: string,
  unit: string,
  value: number | null,
  formatId: string,
): MetricSpec {
  return { id, reliabilityId, label, unit, value, nullKind: 'unavailable', formatId };
}

// ─── Trend-snapshot assembly ────────────────────────────────────────────────

/**
 * Build a {@link TrendSnapshot}, keeping the statistical qualifiers inseparable
 * from the headline slope (design §1b, §2). A `negligible`/non-significant
 * trend's `qualifier` instructs the narrator to call it "no clear trend".
 */
function buildTrend(input: DateRangeTrendInput): TrendSnapshot {
  const t = input.trend;
  const slopeDisplay = Number.isFinite(t.slope) ? formatMetric('trendSlope', t.slope) : null;
  const pValueDisplay = Number.isFinite(t.pValue) ? formatMetric('pValue', t.pValue) : null;
  const rSquaredDisplay = Number.isFinite(t.rSquared) ? formatMetric('rSquared', t.rSquared) : null;

  return {
    metricId: input.metricId,
    label: input.label,
    direction: t.trendDirection,
    slopeDisplay,
    slopeUnit: input.slopeUnit,
    strength: t.trendStrength,
    pValueDisplay,
    rSquaredDisplay,
    n: input.n,
    qualifier: trendQualifier(t, pValueDisplay),
  };
}

const SIGNIFICANCE_ALPHA = 0.05;

/** App-authored statistical caveat the narrator must attach to a trend. */
function trendQualifier(t: LinearTrend, pValueDisplay: string | null): string {
  const significant = Number.isFinite(t.pValue) && t.pValue < SIGNIFICANCE_ALPHA;
  const pPart = pValueDisplay !== null ? ` (p = ${pValueDisplay})` : '';
  if (t.trendStrength === 'negligible' || t.trendDirection === 'flat') {
    return `No clear trend${pPart}.`;
  }
  if (!significant) {
    return `${capitalize(t.trendStrength)} ${t.trendDirection} trend, not statistically significant${pPart}.`;
  }
  return `${capitalize(t.trendStrength)} ${t.trendDirection} trend, statistically significant${pPart}.`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── numericAllowList assembly ──────────────────────────────────────────────

/**
 * Build the flat allow-list of every quotable numeral in the snapshot,
 * mechanically (design §2, §5). The validator checks the narrative's numerals
 * against this set. Includes every metric `displayValue`, trend slope / p / r²,
 * reference-line value, series point, the active thresholds, and the
 * CMS/recommended hour constants — each as its exact display string.
 */
function buildNumericAllowList(
  metrics: readonly MetricSnapshot[],
  trends: readonly TrendSnapshot[],
  clinical: ClinicalReferences,
  series: ChartSeriesSnapshot | undefined,
): string[] {
  const set = new Set<string>();
  const add = (s: string | null): void => {
    if (s !== null && s !== '' && s !== '—') set.add(s);
  };

  for (const m of metrics) add(m.displayValue);
  for (const t of trends) {
    add(t.slopeDisplay);
    add(t.pValueDisplay);
    add(t.rSquaredDisplay);
    add(String(t.n));
  }
  if (series) {
    for (const p of series.points) add(p.displayValue);
    for (const r of series.referenceLines) add(r.value);
  }
  // Clinical reference constants are quotable numerals too.
  add(String(clinical.ahiThresholds.mild));
  add(String(clinical.ahiThresholds.moderate));
  add(String(clinical.ahiThresholds.severe));
  add(String(clinical.cmsComplianceHours));
  add(String(clinical.recommendedUsageHours));

  return Array.from(set).sort();
}

// ─── Public builders, one per insight type ──────────────────────────────────

/** Finalize: attach the allow-list, freeze, and run the redaction guard. */
function finalize(
  ctx: Omit<GroundedContext, 'numericAllowList'>,
  series: ChartSeriesSnapshot | undefined,
): GroundedContext {
  const numericAllowList = buildNumericAllowList(ctx.metrics, ctx.trends, ctx.clinical, series);
  const full: GroundedContext = { ...ctx, numericAllowList };
  // Fail-closed: a forbidden field can never be serialized (design §3).
  assertNoForbiddenFields(full);
  return full;
}

/**
 * Build the {@link GroundedContext} for a single-night summary (design §1a).
 *
 * @param input one aggregate + the active thresholds, machine class, and display
 *   preferences. The builder reads ONLY these fields — never a store.
 */
export function buildSingleNightContext(input: SingleNightInput): GroundedContext {
  const agg = input.aggregate;
  const relCtx = reliabilityContextOf(agg);
  const metrics = singleNightMetricSpecs(agg).map((spec) => buildMetric(spec, relCtx));

  const base: Omit<GroundedContext, 'numericAllowList'> = {
    schemaVersion: 1,
    insightType: 'single-night',
    generatedOnDate: input.generatedOnDate,
    machineClass: input.machineClass,
    scope: {
      startDate: agg.date,
      endDate: agg.date,
      nightCount: 1,
      nightsWithDefinedRate: agg.ahi === null ? 0 : 1,
    },
    metrics,
    trends: [],
    clinical: buildClinicalReferences(input),
    display: input.display,
  };
  return finalize(base, undefined);
}

/**
 * Build the {@link GroundedContext} for a date-range / trend summary (design §1b).
 * Trends are passed in already computed; this builder phrases them and excludes
 * `null`-rate nights from `nightsWithDefinedRate`.
 */
export function buildDateRangeContext(input: DateRangeInput): GroundedContext {
  const aggregates = input.aggregates;
  const nightCount = aggregates.length;
  const nightsWithDefinedRate = aggregates.filter((a) => a.ahi !== null).length;
  const startDate = firstDate(aggregates);
  const endDate = lastDate(aggregates);

  const trends = input.trends.map(buildTrend);

  const base: Omit<GroundedContext, 'numericAllowList'> = {
    schemaVersion: 1,
    insightType: 'date-range',
    generatedOnDate: input.generatedOnDate,
    machineClass: input.machineClass,
    scope: { startDate, endDate, nightCount, nightsWithDefinedRate },
    metrics: [],
    trends,
    clinical: buildClinicalReferences(input),
    display: input.display,
  };
  return finalize(base, undefined);
}

/**
 * Build the {@link GroundedContext} for an "explain this metric / chart" insight
 * (design §1c). The most constrained type: it carries only the data backing the
 * one view.
 */
export function buildExplainContext(input: ExplainInput): GroundedContext {
  const metrics = input.metric ? [input.metric] : [];
  const series = input.chart;

  const base: Omit<GroundedContext, 'numericAllowList'> = {
    schemaVersion: 1,
    insightType: 'explain',
    generatedOnDate: input.generatedOnDate,
    machineClass: input.machineClass,
    scope: {
      startDate: input.scope.startDate,
      endDate: input.scope.endDate,
      nightCount: series ? series.points.length : metrics.length > 0 ? 1 : 0,
      nightsWithDefinedRate: series
        ? series.points.filter((p) => p.availability === 'present').length
        : metrics.filter((m) => m.availability === 'present').length,
    },
    metrics,
    trends: [],
    ...(series ? { series } : {}),
    clinical: buildClinicalReferences(input),
    display: input.display,
  };
  return finalize(base, series);
}

/**
 * Build the {@link GroundedContext} for a clinical-context note (design §1d):
 * one night's AHI/usage situated against the **active** AHI bands and the CMS
 * adherence floor. `severityBand` is computed app-side from the active
 * thresholds so the model never re-bands using its own knowledge.
 */
export function buildClinicalContext(input: ClinicalContextInput): GroundedContext {
  const agg = input.aggregate;
  const relCtx = reliabilityContextOf(agg);

  const ahiMetric = buildMetric(rate('ahi', 'ahi', 'AHI', agg.ahi), relCtx);
  const usageMetric = buildMetric(
    {
      id: 'usageHours',
      reliabilityId: 'usage',
      label: 'Usage',
      unit: 'h',
      value: agg.usageHours,
      nullKind: 'unavailable',
      formatId: 'usage',
    },
    relCtx,
  );
  // Compliance is a verdict, not a numeral; carry the verdict word as the
  // `displayValue` (a categorical label, never a digit) so the validator can
  // consistency-check any compliance claim against the app-computed verdict.
  const { tier: complianceTier, flags: complianceFlags } = reliabilityTier('compliance', relCtx);
  const complianceMetric: MetricSnapshot = {
    id: 'complianceStatus',
    label: 'Compliance status',
    availability: 'present',
    displayValue: agg.complianceStatus,
    unit: '',
    reliabilityTier: complianceTier,
    dataQualityFlags: complianceFlags,
    caveat: null,
  };

  // Severity band, computed app-side from the ACTIVE thresholds.
  const severityMetric: MetricSnapshot =
    agg.ahi === null
      ? {
          id: 'severityBand',
          label: 'AHI severity band',
          availability: 'undefined-rate',
          displayValue: null,
          unit: '',
          reliabilityTier: ahiMetric.reliabilityTier,
          dataQualityFlags: ahiMetric.dataQualityFlags,
          caveat: ahiMetric.caveat,
        }
      : {
          id: 'severityBand',
          label: 'AHI severity band',
          availability: 'present',
          // The band is a categorical label, not a numeral — no displayValue digit.
          displayValue: classifyAhiSeverity(agg.ahi, input.ahiThresholds),
          unit: '',
          reliabilityTier: ahiMetric.reliabilityTier,
          dataQualityFlags: ahiMetric.dataQualityFlags,
          caveat: ahiMetric.caveat,
        };

  const base: Omit<GroundedContext, 'numericAllowList'> = {
    schemaVersion: 1,
    insightType: 'clinical-context',
    generatedOnDate: input.generatedOnDate,
    machineClass: input.machineClass,
    scope: {
      startDate: agg.date,
      endDate: agg.date,
      nightCount: 1,
      nightsWithDefinedRate: agg.ahi === null ? 0 : 1,
    },
    metrics: [ahiMetric, severityMetric, usageMetric, complianceMetric],
    trends: [],
    clinical: buildClinicalReferences(input),
    display: input.display,
  };
  return finalize(base, undefined);
}

// ─── helpers for date-scope ─────────────────────────────────────────────────

function firstDate(aggs: readonly NightlyAggregate[]): string {
  let min: string | null = null;
  for (const a of aggs) {
    if (min === null || a.date < min) min = a.date;
  }
  return min ?? '';
}

function lastDate(aggs: readonly NightlyAggregate[]): string {
  let max: string | null = null;
  for (const a of aggs) {
    if (max === null || a.date > max) max = a.date;
  }
  return max ?? '';
}

/**
 * Build a {@link ReferenceLine} at display precision, for the explain-chart
 * builder's reference lines (CMS 4h, AHI band cutoffs). Exposed so the chart
 * adapter (frontend wave) formats reference values identically to the series.
 */
export function buildReferenceLine(
  label: string,
  value: number,
  unit: string,
  formatId: string,
): ReferenceLine {
  return { label, value: formatMetric(formatId, value), unit };
}

/**
 * Build a {@link SeriesPoint} at display precision (explain-chart builder).
 * `null` value ⇒ caller supplies the availability discriminator.
 */
export function buildSeriesPoint(
  date: string,
  value: number | null,
  availability: SeriesPoint['availability'],
  tier: ReliabilityTier,
  formatId: string,
): SeriesPoint {
  return {
    date,
    displayValue: value === null ? null : formatMetric(formatId, value),
    availability,
    reliabilityTier: tier,
  };
}
