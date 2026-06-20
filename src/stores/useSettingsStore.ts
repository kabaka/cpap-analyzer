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

interface LLMIntegration {
  enabled: boolean;
  provider: 'openai' | 'anthropic' | null;
  apiKey: string | null;
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
    llm: { enabled: false, provider: null, apiKey: null },
  },
};

/** The legacy (v0) persisted weather shape, retained only for migration. */
interface LegacyWeatherIntegration {
  enabled?: boolean;
  apiKey?: string | null;
  location?: string;
}

/**
 * Persist migration for the settings store.
 *
 * Versioned migrations run when the persisted `version` is older than the
 * store's current `version`. v0 persisted the weather integration as
 * `{ enabled, apiKey, location: string }`. This maps it onto the current
 * {@link WeatherIntegration} shape:
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
 * - every other settings slice is preserved untouched.
 *
 * Unknown / unexpected persisted shapes fall back to the full defaults rather
 * than throwing, so a corrupt blob can never wedge app startup.
 */
export function migrateSettings(persisted: unknown, version: number): Partial<SettingsState> {
  // Anything we cannot interpret -> start clean.
  if (typeof persisted !== 'object' || persisted === null) {
    return structuredClone(defaultSettings);
  }

  const state = persisted as Partial<SettingsState> & {
    integrations?: Partial<Integrations> & {
      weather?: LegacyWeatherIntegration | WeatherIntegration;
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

    return {
      ...state,
      integrations: {
        ...defaultSettings.integrations,
        ...state.integrations,
        weather: migratedWeather,
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
        version: 1,
        migrate: migrateSettings,
      },
    ),
    { name: 'SettingsStore', enabled: import.meta.env.DEV },
  ),
);
