import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

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
  accessToken: string | null;
}

interface WeatherIntegration {
  enabled: boolean;
  apiKey: string | null;
  location: string;
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
      mildThreshold: 5,
      moderateThreshold: 15,
      severeThreshold: 30,
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
    fitbit: { enabled: false, accessToken: null },
    weather: { enabled: false, apiKey: null, location: '' },
    llm: { enabled: false, provider: null, apiKey: null },
  },
};

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

        resetToDefaults: () => set({ ...defaultSettings }, undefined, 'resetToDefaults'),
      }),
      { name: 'cpap-settings' },
    ),
    { name: 'SettingsStore', enabled: import.meta.env.DEV },
  ),
);
