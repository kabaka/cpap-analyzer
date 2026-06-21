import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { AHI_SEVERITY_THRESHOLDS } from '@/analysis/clinical';

interface AHIThresholds {
  mildThreshold: number;
  moderateThreshold: number;
  severeThreshold: number;
}

interface ClusteringParams {
  method: 'flg' | 'kmeans' | 'single-link';
  minClusterSize: number;
}

interface TimeSeriesParams {
  rollingWindow: number;
  trendConfidence: number;
}

interface DisplayPreferences {
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  timeFormat: '12h' | '24h';
  chartAnimations: boolean;
}

interface FitbitIntegration {
  enabled: boolean;
  visibleDataTypes: string[];
  lastImportAt: string | null;
  recordCount: number;
}

interface WeatherLocationSetting {
  label: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface WeatherUnitsSetting {
  temperature: 'C' | 'F';
  pressure: 'hPa' | 'inHg';
  wind: 'kmh' | 'mph' | 'ms';
  precip: 'mm' | 'in';
}

interface WeatherDomainsSetting {
  core: boolean;
  airQuality: boolean;
}

interface WeatherIntegration {
  enabled: boolean;
  consentAt: string | null;
  location: WeatherLocationSetting;
  units: WeatherUnitsSetting;
  domains: WeatherDomainsSetting;
  resolution: 'daily' | 'daily+hourly';
  autoSyncNewImports: boolean;
  lastSyncAt: string | null;
}

type LLMBackendId = 'webllm' | 'chrome-ai' | 'anthropic' | 'openai-compatible';
type LLMAnthropicModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';

interface LLMIntegration {
  enabled: boolean;
  /** Active backend; `null` until explicitly chosen. Never auto-set to cloud. */
  backend: LLMBackendId | null;
  /** ISO 8601 timestamp of cloud-egress consent, or `null`. */
  consentAt: string | null;
  /** EGRESS_CONTRACT_VERSION in force when consent was granted, or `null`. */
  consentContractVersion: number | null;
  webllm: { modelId: string | null };
  anthropic: { model: LLMAnthropicModel };
  openaiCompatible: { baseUrl: string | null; model: string | null };
}

interface Integrations {
  fitbit: FitbitIntegration;
  weather: WeatherIntegration;
  llm: LLMIntegration;
}

interface AnalysisParams {
  ahi: AHIThresholds;
  clustering: ClusteringParams;
  timeSeries: TimeSeriesParams;
}

interface SettingsState {
  // Analysis parameters
  analysisParams: AnalysisParams;
  updateAnalysisParam: <K extends keyof AnalysisParams>(
    category: K,
    updates: Partial<AnalysisParams[K]>,
  ) => void;

  // Display preferences
  display: DisplayPreferences;
  updateDisplay: (updates: Partial<DisplayPreferences>) => void;

  // Integration config
  integrations: Integrations;
  updateIntegration: <K extends keyof Integrations>(
    key: K,
    config: Partial<Integrations[K]>,
  ) => void;

  // Reset to defaults
  resetToDefaults: () => void;
}

const defaultSettings: Pick<SettingsState, 'analysisParams' | 'display' | 'integrations'> = {
  analysisParams: {
    ahi: {
      mildThreshold: AHI_SEVERITY_THRESHOLDS.mild,
      moderateThreshold: AHI_SEVERITY_THRESHOLDS.moderate,
      severeThreshold: AHI_SEVERITY_THRESHOLDS.severe,
    },
    clustering: {
      method: 'flg',
      minClusterSize: 3,
    },
    timeSeries: {
      rollingWindow: 7,
      trendConfidence: 0.95,
    },
  },
  display: {
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    chartAnimations: true,
  },
  integrations: {
    fitbit: { enabled: false, visibleDataTypes: [], lastImportAt: null, recordCount: 0 },
    weather: {
      enabled: false,
      consentAt: null,
      location: { label: null, latitude: null, longitude: null },
      units: { temperature: 'C', pressure: 'hPa', wind: 'kmh', precip: 'mm' },
      domains: { core: true, airQuality: true },
      resolution: 'daily+hourly',
      autoSyncNewImports: false,
      lastSyncAt: null,
    },
    // AI Insights (ADR 0024): off by default, no backend chosen, no consent.
    // API keys are NEVER stored here — they live in the session-scoped
    // useLLMCredentialStore (XSS-exfiltration mitigation, ADR 0024 §4).
    llm: {
      enabled: false,
      backend: null,
      consentAt: null,
      consentContractVersion: null,
      webllm: { modelId: null },
      anthropic: { model: 'claude-opus-4-8' },
      openaiCompatible: { baseUrl: null, model: null },
    },
  },
};

/** The legacy (v0) persisted weather shape, retained only for migration. */
interface LegacyWeatherIntegration {
  enabled?: boolean;
  apiKey?: string | null;
  location?: string;
}

/** The legacy (v1) persisted llm stub, retained only for the v1 → v2 migration. */
interface LegacyLLMIntegration {
  enabled?: boolean;
  provider?: 'openai' | 'anthropic' | null;
  apiKey?: string | null;
}

/**
 * Persist migration for the settings store.
 *
 * Versioned migrations run when the persisted `version` is older than the
 * store's current `version`. They are applied **cumulatively**: a v0 blob runs
 * the v0→v1 step and then the v1→v2 step, so the returned state always matches
 * the current shape regardless of how old the persisted blob is.
 *
 * ### v0 → v1: weather integration reshape
 *
 * v0 persisted the weather integration as `{ enabled, apiKey, location: string }`.
 * This maps it onto the current {@link WeatherIntegration} shape:
 * - `apiKey` is DROPPED (Open-Meteo is keyless — there is no key to migrate, and
 *   carrying a stale key forward would be a privacy hazard).
 * - the old free-text `location` string is wrapped into the structured
 *   `{ label, latitude: null, longitude: null }` (we cannot infer coordinates
 *   from a bare string; the user re-confirms a location, gated by consent).
 * - the integration is FORCED back through the consent gate: `enabled` is reset
 *   to `false` and `consentAt` to `null` regardless of the legacy `enabled`
 *   value. The v0 weather stub never made any network call, so disabling on
 *   migration loses no functionality; it guarantees a migrated user must re-pass
 *   the explicit consent gate before the new client can ever egress (Privacy is
 *   the top core principle). Location label/coords are preserved so re-consent
 *   is low-friction.
 * - all other new weather fields fall back to defaults.
 *
 * ### v1 → v2: AI Insights (llm) reshape (ADR 0024)
 *
 * v1 persisted the llm stub as `{ enabled, provider, apiKey }`. This maps it
 * onto the new {@link LLMIntegration} shape, applying the same privacy posture
 * as the weather v0→v1 precedent:
 * - `provider:'anthropic' → backend:'anthropic'`, `'openai' → 'openai-compatible'`;
 *   an unknown/`null` provider becomes `backend:null` (never auto-select cloud).
 * - the persisted `apiKey` is DROPPED. Keys are never carried into the new store
 *   — they belong only in the session-scoped useLLMCredentialStore (ADR 0024 §4).
 * - the feature is FORCED back through the consent gate: `enabled:false`,
 *   `consentAt:null`, `consentContractVersion:null`, regardless of the legacy
 *   `enabled` value (the v1 stub never made any network call, so nothing is
 *   lost). A migrated user must re-enable, re-pick a backend, and (for cloud)
 *   re-consent before any egress is possible.
 * - all other new llm sub-configs fall back to defaults.
 *
 * Every settings slice not named in a step is preserved untouched. Unknown /
 * unexpected persisted shapes fall back to the full defaults rather than
 * throwing, so a corrupt blob can never wedge app startup.
 */
export function migrateSettings(persisted: unknown, version: number): Partial<SettingsState> {
  // Anything we cannot interpret -> start clean.
  if (typeof persisted !== 'object' || persisted === null) {
    return structuredClone(defaultSettings);
  }

  let state = persisted as Partial<SettingsState> & {
    integrations?: Partial<Integrations> & {
      weather?: LegacyWeatherIntegration | WeatherIntegration;
      llm?: LegacyLLMIntegration | LLMIntegration;
    };
  };

  // v0 -> v1: reshape the weather integration.
  if (version < 1) {
    const legacy = (state.integrations?.weather ?? {}) as LegacyWeatherIntegration;
    const legacyLabel =
      typeof legacy.location === 'string' && legacy.location.trim().length > 0
        ? legacy.location
        : null;

    const migratedWeather: WeatherIntegration = {
      ...structuredClone(defaultSettings.integrations.weather),
      // Force re-consent: a migrated user must re-pass the explicit consent gate
      // before any egress is possible. The legacy `enabled` flag is intentionally
      // discarded (the old stub never made network calls, so nothing is lost).
      enabled: false,
      consentAt: null,
      location: { label: legacyLabel, latitude: null, longitude: null },
    };

    state = {
      ...state,
      integrations: {
        ...defaultSettings.integrations,
        ...state.integrations,
        weather: migratedWeather,
      },
    };
  }

  // v1 -> v2: reshape the llm stub into the AI Insights config (ADR 0024).
  if (version < 2) {
    const legacy = (state.integrations?.llm ?? {}) as LegacyLLMIntegration;
    const migratedBackend: LLMBackendId | null =
      legacy.provider === 'anthropic'
        ? 'anthropic'
        : legacy.provider === 'openai'
          ? 'openai-compatible'
          : null;

    const migratedLLM: LLMIntegration = {
      ...structuredClone(defaultSettings.integrations.llm),
      backend: migratedBackend,
      // Force re-consent and re-enable: the v1 stub never egressed, so forcing
      // the feature off loses nothing and guarantees the new client cannot
      // egress until the user explicitly re-enables, re-picks a backend, and
      // (for cloud) re-consents. The persisted apiKey is dropped entirely —
      // keys never enter persisted settings (ADR 0024 §4).
      enabled: false,
      consentAt: null,
      consentContractVersion: null,
    };

    state = {
      ...state,
      integrations: {
        ...defaultSettings.integrations,
        ...state.integrations,
        llm: migratedLLM,
      },
    };
  }

  return state;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set) => ({
        ...defaultSettings,

        updateAnalysisParam: (category, updates) =>
          set(
            (state) => ({
              analysisParams: {
                ...state.analysisParams,
                [category]: { ...state.analysisParams[category], ...updates },
              },
            }),
            undefined,
            'updateAnalysisParam',
          ),

        updateDisplay: (updates) =>
          set(
            (state) => ({
              display: { ...state.display, ...updates },
            }),
            undefined,
            'updateDisplay',
          ),

        updateIntegration: (key, config) =>
          set(
            (state) => ({
              integrations: {
                ...state.integrations,
                [key]: { ...state.integrations[key], ...config },
              },
            }),
            undefined,
            'updateIntegration',
          ),

        // Deep clone so the reset can never alias (and later mutate) the
        // module-level `defaultSettings` constant through its nested objects
        // (analysisParams.*, integrations.*).
        resetToDefaults: () => set(structuredClone(defaultSettings), undefined, 'resetToDefaults'),
      }),
      {
        name: 'cpap-settings',
        // v0 -> v1: the weather integration was reshaped from
        // `{ enabled, apiKey, location: string }` to the richer config (no
        // apiKey — Open-Meteo is keyless — plus structured location, units,
        // domains, resolution, auto-sync, and timestamps). See the weather
        // integration design reference §6.
        // v1 -> v2: the llm stub `{ enabled, provider, apiKey }` was reshaped
        // into the AI Insights config (backend selector, two-gate cloud consent,
        // per-backend sub-configs); the persisted apiKey is dropped (keys live
        // in the session-scoped useLLMCredentialStore, not localStorage). See
        // ADR 0024.
        version: 2,
        migrate: migrateSettings,
      },
    ),
    { name: 'SettingsStore', enabled: import.meta.env.DEV },
  ),
);
