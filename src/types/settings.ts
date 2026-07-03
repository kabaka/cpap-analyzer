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

/**
 * Legacy LLM provider identifier (the v1 persisted `llm` stub).
 *
 * Retained ONLY so the v1→v2 settings migration can read the old persisted
 * `{ enabled, provider, apiKey }` shape and map it onto the new
 * {@link LLMIntegrationConfig}. It is no longer part of the live settings shape
 * and should not be referenced by new code — use {@link LLMBackendId} instead.
 */
export type LLMProvider = 'openai' | 'anthropic';

/**
 * The four interchangeable AI-Insights backends (ADR 0024).
 *
 * Ordered privacy-first in the UI: the two on-device backends (`webllm`,
 * `chrome-ai`) egress nothing; the two cloud backends (`anthropic`,
 * `openai-compatible`) send the grounded metric snapshot only, and only after
 * explicit two-gate consent. `openai-compatible` spans both cloud and
 * loopback/local (Ollama, LM Studio) depending on the configured base URL.
 */
export type LLMBackendId = 'webllm' | 'chrome-ai' | 'anthropic' | 'openai-compatible';

/**
 * The allowed Claude (Anthropic) models for the cloud backend.
 *
 * See `docs/design/ai-insights-ux.md` §3.6. The UX default is Sonnet, but the
 * stored default is `claude-opus-4-8` per the foundation task spec; the UI may
 * surface Sonnet as the *recommended* choice while the persisted default stays
 * explicit and stable.
 */
export type LLMAnthropicModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';

/**
 * Version of the cloud-egress consent contract (the "what leaves your device"
 * payload definition). Compared against
 * {@link LLMIntegrationConfig.consentContractVersion}: when this constant is
 * greater than the stored value, the previously-granted consent is stale and
 * the user must re-consent before any cloud generation. Bump this whenever the
 * set of fields that can egress changes (mirrors the weather re-consent gate).
 */
export const EGRESS_CONTRACT_VERSION = 1;

/** WebLLM (in-browser, WebGPU) backend sub-config. */
export interface LLMWebLLMConfig {
  /**
   * Curated WebLLM model id (e.g. a MLC model tag), or `null` until the user
   * picks one. The downloaded-weights lifecycle (download/ready state, size) is
   * tracked separately at runtime and is NOT persisted here.
   */
  readonly modelId: string | null;
}

/** Claude (Anthropic) browser-direct backend sub-config (BYO key). */
export interface LLMAnthropicConfig {
  /**
   * Chosen Claude model. Defaults to `claude-opus-4-8`.
   *
   * NOTE: the API key is intentionally NOT stored here. Keys are held in the
   * session-scoped {@link file://src/stores/useLLMCredentialStore.ts} credential
   * store, never in persisted settings — see that module and ADR 0024 §4 for
   * the XSS/exfiltration rationale.
   */
  readonly model: LLMAnthropicModel;
}

/** OpenAI-compatible / local-server backend sub-config (BYO key + base URL). */
export interface LLMOpenAICompatibleConfig {
  /**
   * Endpoint base URL (e.g. `https://api.openai.com/v1` or a loopback
   * `http://localhost:11434/v1` for Ollama), or `null` until configured. A
   * loopback URL is treated as on-device (no consent); a remote URL is cloud.
   */
  readonly baseUrl: string | null;
  /** Free-text model id (OpenAI-compatible servers expose arbitrary ids), or `null`. */
  readonly model: string | null;
}

/**
 * Configuration for the opt-in AI Insights integration (ADR 0024).
 *
 * Replaces the minimal `{ enabled, provider, apiKey }` stub. Like the weather
 * integration it is off by default and gated behind explicit consent for any
 * egress — but unlike weather, the default backends are on-device and egress
 * nothing.
 *
 * API KEYS ARE DELIBERATELY ABSENT from this (persisted) shape. Persisting a
 * provider key to localStorage is an XSS-exfiltration hazard (ADR 0024 §4), so
 * keys live only in the session-scoped credential store
 * ({@link file://src/stores/useLLMCredentialStore.ts}); they are never written
 * to localStorage and are placed only in the provider auth header at request
 * time, never in the grounded snapshot.
 */
export interface LLMIntegrationConfig {
  /** Whether the feature is enabled (off by default). */
  readonly enabled: boolean;
  /**
   * The active backend, or `null` until the user explicitly chooses one. NEVER
   * auto-selected to a cloud backend — cloud is always a deliberate user action
   * gated by consent (ADR 0024 §4; UX §3.3).
   */
  readonly backend: LLMBackendId | null;
  /**
   * ISO 8601 timestamp the user acknowledged the cloud-egress consent, or
   * `null` if cloud egress has never been consented. Local backends do not set
   * this (they never egress).
   */
  readonly consentAt: string | null;
  /**
   * The {@link EGRESS_CONTRACT_VERSION} that was in force when `consentAt` was
   * recorded, or `null`. If this is `null` or less than the current
   * `EGRESS_CONTRACT_VERSION`, prior consent is stale and the user must
   * re-consent before the next cloud generation.
   */
  readonly consentContractVersion: number | null;
  /** WebLLM (on-device) sub-config. */
  readonly webllm: LLMWebLLMConfig;
  /** Claude (Anthropic, cloud) sub-config. */
  readonly anthropic: LLMAnthropicConfig;
  /** OpenAI-compatible / local-server sub-config. */
  readonly openaiCompatible: LLMOpenAICompatibleConfig;
}

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
  readonly llm: LLMIntegrationConfig;
}
