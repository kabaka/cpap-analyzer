/**
 * Grounded-context data contract for AI Insights (ADR 0024; design reference
 * `docs/design/ai-insights-grounded-context.md`).
 *
 * This is the **only** object that may be serialized and handed to a language
 * model. The app computes every clinical and statistical value deterministically
 * and ships a frozen snapshot of those *already-computed* results; the model may
 * only select, phrase, and caveat them — it must never compute, derive, or
 * introduce any value not literally present here (compute-then-narrate).
 *
 * Privacy (Core Principle 1) governs this contract: per the design reference §3
 * redaction rules, the snapshot is aggregate-only — no raw/high-frequency signal
 * arrays, no within-night timestamps or clock times, no device identifiers, no
 * free-text notes/tags, no location, no external-integration identifiers, and no
 * full-precision numerics (every value is a pre-rounded display string).
 *
 * This module is the **shared source of truth** for both the snapshot builder
 * (later "context" wave) and the provider layer ({@link file://src/services/llm/types.ts}),
 * so neither has to duplicate the shape. It is types-only and has no runtime
 * dependencies. The serializer/validator that produce and check these objects
 * are owned by later waves (data-science / frontend).
 *
 * @module services/llm/context/types
 */

/** Availability discriminator for a metric — the narrator MUST branch on this. */
export type MetricAvailability = 'present' | 'undefined-rate' | 'unavailable';

/** Intrinsic reliability tier (ADR 0018 D1). */
export type ReliabilityTier = 'high' | 'moderate' | 'low';

/** Per-session degrading conditions (orthogonal to the reliability tier). */
export type DataQualityFlag = 'high-leak' | 'short-session' | 'low-coverage' | 'low-count';

/** A single metric, fully self-describing for narration. */
export interface MetricSnapshot {
  /** Canonical metric id (matches reliability & precision registries). */
  readonly id: string;
  /** Human label as shown in the UI, e.g. "Median leak". */
  readonly label: string;
  /**
   * Availability discriminator — the model MUST branch on this and never read
   * `displayValue` when not 'present'.
   *  - 'present'        → a real, finite value is available
   *  - 'undefined-rate' → per-hour rate below MIN_INDEX_USAGE_HOURS (null, NOT 0)
   *  - 'unavailable'    → channel/data absent (e.g. no oximeter)
   */
  readonly availability: MetricAvailability;
  /** Pre-rounded display string at D9 precision, e.g. "12.4". Null unless present. */
  readonly displayValue: string | null;
  /** Unit token, e.g. "events/h", "cmH2O", "L/min", "%", "h", "min", "mL". */
  readonly unit: string;
  /** Intrinsic reliability (ADR 0018 D1). */
  readonly reliabilityTier: ReliabilityTier;
  /** Per-session degrading conditions (orthogonal to tier). */
  readonly dataQualityFlags: ReadonlyArray<DataQualityFlag>;
  /**
   * App-authored caveat the model MUST surface verbatim-in-meaning when the
   * tier is not 'high' or a flag is present, e.g. "Estimate; leak-affected".
   * Null when no caveat applies.
   */
  readonly caveat: string | null;
}

/** Effect-size / strength label for a trend (from `linearTrend.trendStrength`). */
export type TrendStrength = 'negligible' | 'weak' | 'moderate' | 'strong';

/** Already-classified trend direction. */
export type TrendDirection = 'increasing' | 'decreasing' | 'flat';

/** A trend, with its statistical qualifiers inseparable from its headline. */
export interface TrendSnapshot {
  readonly metricId: string;
  readonly label: string;
  /** "increasing" | "decreasing" | "flat" — already classified app-side. */
  readonly direction: TrendDirection;
  /** Slope display string, e.g. "-0.18". Null if not estimable. */
  readonly slopeDisplay: string | null;
  /** Unit of the slope, e.g. "events/h per day". */
  readonly slopeUnit: string;
  /** Effect-size / strength label (linearTrend.trendStrength). */
  readonly strength: TrendStrength;
  /** p-value display string, e.g. "0.04". Null if undefined. */
  readonly pValueDisplay: string | null;
  /** r² display string, e.g. "0.11". */
  readonly rSquaredDisplay: string | null;
  /** Nights contributing (post null-exclusion). */
  readonly n: number;
  /**
   * App-authored statistical caveat the model MUST attach, e.g.
   * "Weak trend; not statistically significant (p = 0.34)." Never omit.
   */
  readonly qualifier: string;
}

/** A chart series point, for the "explain this chart" insight. Display precision only. */
export interface SeriesPoint {
  /** ISO YYYY-MM-DD. */
  readonly date: string;
  readonly displayValue: string | null;
  readonly availability: MetricAvailability;
  readonly reliabilityTier: ReliabilityTier;
}

/** A reference line a chart drew, e.g. the CMS 4h line or an AHI band cutoff. */
export interface ReferenceLine {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
}

/** The active, user-configured clinical references. */
export interface ClinicalReferences {
  /** The ACTIVE AHI severity cutoffs (user override or AASM/ICSD-3 default). */
  readonly ahiThresholds: {
    readonly mild: number;
    readonly moderate: number;
    readonly severe: number;
  };
  readonly ahiThresholdsSource: 'user-configured' | 'aasm-icsd3-default';
  /** CMS adherence floor in hours (4). */
  readonly cmsComplianceHours: number;
  /** Recommended good-adherence target in hours (6); NOT a regulatory floor. */
  readonly recommendedUsageHours: number;
  /** Plain-language compliance definition string. */
  readonly complianceDefinition: string;
  /** Provenance note: which references are AASM vs CMS vs device convention. */
  readonly referenceProvenance: string;
}

/** The user's display-unit & locale preferences, so narration matches the UI. */
export interface DisplayUnitPreferences {
  /** "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY". */
  readonly dateFormat: string;
  /** "12h" | "24h". */
  readonly timeFormat: string;
  /** CPAP physiological units are fixed SI; stated for clarity. */
  readonly pressureUnit: 'cmH2O';
  readonly leakUnit: 'L/min';
  readonly tidalVolumeUnit: 'mL';
  /** Only present when weather context is included; mirrors WeatherUnitsSetting. */
  readonly temperatureUnit?: 'C' | 'F';
  readonly weatherPressureUnit?: 'hPa' | 'inHg';
}

/** Which insight is being requested (drives the narration brief). */
export type InsightType = 'single-night' | 'date-range' | 'explain' | 'clinical-context';

/** Coarse machine class — NEVER serial/firmware (design reference §3, R4). */
export type MachineClass = 'CPAP' | 'APAP' | 'BiPAP' | 'VPAP' | 'ASV' | 'unknown';

/** Chart-series block, present only for the "explain this chart" insight. */
export interface ChartSeriesSnapshot {
  readonly chartTitle: string;
  readonly yUnit: string;
  readonly points: ReadonlyArray<SeriesPoint>;
  /** Reference lines the chart drew, e.g. CMS 4h, AHI band cutoffs. */
  readonly referenceLines: ReadonlyArray<ReferenceLine>;
  readonly caption: string;
}

/**
 * Top-level grounded snapshot — the ONLY object sent to the model.
 *
 * `schemaVersion` is the data-contract version (distinct from the egress
 * *consent* contract version in settings, though a schema change that alters
 * what egresses must also bump the consent contract).
 */
export interface GroundedContext {
  /** Schema version, for prompt/contract compatibility. */
  readonly schemaVersion: 1;
  /** Which insight is being requested (drives the narration brief). */
  readonly insightType: InsightType;
  /** Generation timestamp (date only — no within-night clock time; §3). */
  readonly generatedOnDate: string;
  /** Device class only — NEVER serial/firmware (§3, R4). */
  readonly machineClass: MachineClass;
  /** Date scope. Calendar dates only — no clock times. */
  readonly scope: {
    readonly startDate: string;
    readonly endDate: string;
    readonly nightCount: number;
    /** Excludes undefined-rate nights. */
    readonly nightsWithDefinedRate: number;
  };
  /** Per-metric snapshots relevant to this insight. */
  readonly metrics: ReadonlyArray<MetricSnapshot>;
  /** Trends (date-range insight). Empty for single-night. */
  readonly trends: ReadonlyArray<TrendSnapshot>;
  /** Chart series (explain-chart insight only). Absent/empty otherwise. */
  readonly series?: ChartSeriesSnapshot;
  /** Active clinical references (always present). */
  readonly clinical: ClinicalReferences;
  /** User display preferences so prose matches the on-screen UI. */
  readonly display: DisplayUnitPreferences;
  /**
   * A flat allow-list of every numeric token that appears anywhere above, built
   * mechanically while serializing. The post-generation validator checks the
   * narration's numerals against THIS set. See design reference §2/§5.
   */
  readonly numericAllowList: ReadonlyArray<string>;
}
