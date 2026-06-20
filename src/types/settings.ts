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

/** Temperature display unit. */
export type WeatherTemperatureUnit = 'C' | 'F';
/** Barometric pressure display unit. */
export type WeatherPressureUnit = 'hPa' | 'inHg';
/** Wind-speed display unit. */
export type WeatherWindUnit = 'kmh' | 'mph' | 'ms';
/** Precipitation display unit. */
export type WeatherPrecipUnit = 'mm' | 'in';

/** Stored resolution preference for the weather integration. */
export type WeatherResolution = 'daily' | 'daily+hourly';

/**
 * The single globally-configured weather location.
 *
 * Coordinates are the (already 2-dp-rounded) values that are sent to the
 * provider. `null` means "not yet configured" — no request can be made until
 * both latitude and longitude are present.
 */
export interface WeatherLocationSetting {
  /** Human-readable city/place label, or `null` if unlabelled. */
  readonly label: string | null;
  /** Latitude in decimal degrees (rounded to 2 dp before egress), or `null`. */
  readonly latitude: number | null;
  /** Longitude in decimal degrees (rounded to 2 dp before egress), or `null`. */
  readonly longitude: number | null;
}

/** Display-unit preferences for weather quantities. */
export interface WeatherUnitsSetting {
  readonly temperature: WeatherTemperatureUnit;
  readonly pressure: WeatherPressureUnit;
  readonly wind: WeatherWindUnit;
  readonly precip: WeatherPrecipUnit;
}

/** Which weather data domains are enabled for fetching (pollen deferred). */
export interface WeatherDomainsSetting {
  /** Core weather (temperature, humidity, pressure, wind, precipitation). */
  readonly core: boolean;
  /** Air quality (PM2.5/PM10, ozone, NO₂, US/European AQI). */
  readonly airQuality: boolean;
}

/**
 * Configuration for the opt-in Weather & Environmental Data integration.
 *
 * This is the first feature that makes an outbound network request. There is
 * **no API key** — Open-Meteo is keyless. `consentAt` records the two-gate
 * consent acknowledgement so a future change to *what is sent* can re-prompt.
 */
export interface WeatherIntegrationConfig {
  /** Whether the integration is enabled (off by default). */
  readonly enabled: boolean;
  /** ISO 8601 timestamp the user acknowledged the egress consent, or `null`. */
  readonly consentAt: string | null;
  /** The single globally-configured location. */
  readonly location: WeatherLocationSetting;
  /** Display-unit preferences (storage is always SI/metric). */
  readonly units: WeatherUnitsSetting;
  /** Enabled data domains (pollen deferred — see design reference §3). */
  readonly domains: WeatherDomainsSetting;
  /** Fetch resolution: daily summaries only, or daily + hourly series. */
  readonly resolution: WeatherResolution;
  /** Auto-sync weather for newly imported nights (off by default). */
  readonly autoSyncNewImports: boolean;
  /** ISO 8601 timestamp of the last successful sync, or `null`. */
  readonly lastSyncAt: string | null;
}

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
  readonly weather: WeatherIntegrationConfig;
  readonly llm: {
    readonly enabled: boolean;
    readonly provider: LLMProvider | null;
    readonly apiKey: string | null;
  };
}
