/**
 * User settings and configuration types.
 *
 * Settings are stored client-side in IndexedDB and control analysis
 * parameters, display preferences, and external service integrations.
 */

/** A single key-value setting entry for generic storage. */
export interface Settings {
  readonly key: string;
  readonly value: unknown;
}

/** Clustering algorithm identifiers. */
export type ClusteringMethod = 'flg' | 'kmeans' | 'single-link';

/**
 * Parameters that control analysis algorithm behavior.
 *
 * These are user-configurable thresholds and options that affect
 * how raw data is interpreted and analyzed.
 */
export interface AnalysisParams {
  /** AHI severity classification thresholds (events/hour). */
  readonly ahi: {
    /** Threshold above which AHI is classified as mild (default: 5). */
    readonly mildThreshold: number;
    /** Threshold above which AHI is classified as moderate (default: 15). */
    readonly moderateThreshold: number;
    /** Threshold above which AHI is classified as severe (default: 30). */
    readonly severeThreshold: number;
  };
  /** Event clustering algorithm configuration. */
  readonly clustering: {
    readonly method: ClusteringMethod;
    /** Minimum number of events to form a cluster. */
    readonly minClusterSize: number;
  };
  /** Time-series analysis configuration. */
  readonly timeSeries: {
    /** Rolling window size in days. */
    readonly rollingWindow: number;
    /** Confidence level for trend detection (0–1). */
    readonly trendConfidence: number;
  };
}

/** Supported date display formats. */
export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';

/** Supported time display formats. */
export type TimeFormat = '12h' | '24h';

/**
 * User preferences for data display and UI behavior.
 */
export interface DisplayPreferences {
  readonly dateFormat: DateFormat;
  readonly timeFormat: TimeFormat;
  /** Whether to animate chart transitions. */
  readonly chartAnimations: boolean;
}

/** Supported LLM providers for AI-assisted analysis. */
export type LLMProvider = 'openai' | 'anthropic';

/**
 * Configuration for external service integrations.
 *
 * All tokens and keys are stored locally; no data leaves the browser
 * unless the user explicitly enables an integration.
 */
export interface IntegrationConfig {
  readonly fitbit: {
    readonly enabled: boolean;
    /** Data types the user has chosen to display in views. */
    readonly visibleDataTypes: readonly string[];
    /** ISO 8601 timestamp of the last import. */
    readonly lastImportAt: string | null;
    /** Number of records imported. */
    readonly recordCount: number;
  };
  readonly weather: {
    readonly enabled: boolean;
    readonly apiKey: string | null;
    readonly location: string;
  };
  readonly llm: {
    readonly enabled: boolean;
    readonly provider: LLMProvider | null;
    readonly apiKey: string | null;
  };
}
