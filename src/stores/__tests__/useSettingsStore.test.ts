import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/stores/useSettingsStore';

const defaultAnalysisParams = {
  ahi: {
    mildThreshold: 5,
    moderateThreshold: 15,
    severeThreshold: 30,
  },
  clustering: {
    method: 'flg' as const,
    minClusterSize: 3,
  },
  timeSeries: {
    rollingWindow: 7,
    trendConfidence: 0.95,
  },
};

const defaultDisplay = {
  dateFormat: 'YYYY-MM-DD' as const,
  timeFormat: '24h' as const,
  chartAnimations: true,
};

const defaultIntegrations = {
  fitbit: { enabled: false, accessToken: null },
  weather: { enabled: false, apiKey: null, location: '' },
  llm: { enabled: false, provider: null, apiKey: null },
};

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
  });

  describe('default state', () => {
    it('should have correct AASM AHI thresholds (5/15/30)', () => {
      const { analysisParams } = useSettingsStore.getState();
      expect(analysisParams.ahi.mildThreshold).toBe(5);
      expect(analysisParams.ahi.moderateThreshold).toBe(15);
      expect(analysisParams.ahi.severeThreshold).toBe(30);
    });

    it('should have default clustering params', () => {
      const { analysisParams } = useSettingsStore.getState();
      expect(analysisParams.clustering).toEqual({
        method: 'flg',
        minClusterSize: 3,
      });
    });

    it('should have default time series params', () => {
      const { analysisParams } = useSettingsStore.getState();
      expect(analysisParams.timeSeries).toEqual({
        rollingWindow: 7,
        trendConfidence: 0.95,
      });
    });

    it('should have default display preferences', () => {
      expect(useSettingsStore.getState().display).toEqual(defaultDisplay);
    });

    it('should have default integration config', () => {
      expect(useSettingsStore.getState().integrations).toEqual(defaultIntegrations);
    });
  });

  describe('updateAnalysisParam', () => {
    it('should update AHI thresholds', () => {
      useSettingsStore.getState().updateAnalysisParam('ahi', {
        mildThreshold: 10,
      });
      expect(useSettingsStore.getState().analysisParams.ahi.mildThreshold).toBe(10);
      // Other thresholds should remain unchanged
      expect(useSettingsStore.getState().analysisParams.ahi.moderateThreshold).toBe(15);
      expect(useSettingsStore.getState().analysisParams.ahi.severeThreshold).toBe(30);
    });

    it('should update clustering params', () => {
      useSettingsStore.getState().updateAnalysisParam('clustering', {
        method: 'kmeans',
      });
      expect(useSettingsStore.getState().analysisParams.clustering.method).toBe('kmeans');
      expect(useSettingsStore.getState().analysisParams.clustering.minClusterSize).toBe(3);
    });

    it('should update time series params', () => {
      useSettingsStore.getState().updateAnalysisParam('timeSeries', {
        rollingWindow: 14,
      });
      expect(useSettingsStore.getState().analysisParams.timeSeries.rollingWindow).toBe(14);
      expect(useSettingsStore.getState().analysisParams.timeSeries.trendConfidence).toBeCloseTo(
        0.95,
      );
    });
  });

  describe('updateDisplay', () => {
    it('should update date format', () => {
      useSettingsStore.getState().updateDisplay({ dateFormat: 'MM/DD/YYYY' });
      expect(useSettingsStore.getState().display.dateFormat).toBe('MM/DD/YYYY');
    });

    it('should update time format', () => {
      useSettingsStore.getState().updateDisplay({ timeFormat: '12h' });
      expect(useSettingsStore.getState().display.timeFormat).toBe('12h');
    });

    it('should update chart animations', () => {
      useSettingsStore.getState().updateDisplay({ chartAnimations: false });
      expect(useSettingsStore.getState().display.chartAnimations).toBe(false);
    });

    it('should preserve other display values when updating one', () => {
      useSettingsStore.getState().updateDisplay({ dateFormat: 'DD/MM/YYYY' });
      expect(useSettingsStore.getState().display.timeFormat).toBe('24h');
      expect(useSettingsStore.getState().display.chartAnimations).toBe(true);
    });
  });

  describe('updateIntegration', () => {
    it('should update fitbit integration', () => {
      useSettingsStore.getState().updateIntegration('fitbit', {
        enabled: true,
        accessToken: 'abc-123',
      });
      expect(useSettingsStore.getState().integrations.fitbit).toEqual({
        enabled: true,
        accessToken: 'abc-123',
      });
    });

    it('should update weather integration partially', () => {
      useSettingsStore.getState().updateIntegration('weather', {
        enabled: true,
      });
      const weather = useSettingsStore.getState().integrations.weather;
      expect(weather.enabled).toBe(true);
      expect(weather.apiKey).toBeNull();
      expect(weather.location).toBe('');
    });

    it('should update LLM integration', () => {
      useSettingsStore.getState().updateIntegration('llm', {
        enabled: true,
        provider: 'anthropic',
        apiKey: 'sk-test',
      });
      expect(useSettingsStore.getState().integrations.llm).toEqual({
        enabled: true,
        provider: 'anthropic',
        apiKey: 'sk-test',
      });
    });
  });

  describe('resetToDefaults', () => {
    it('should restore all defaults after modifications', () => {
      // Modify everything
      useSettingsStore.getState().updateAnalysisParam('ahi', { mildThreshold: 99 });
      useSettingsStore.getState().updateDisplay({ dateFormat: 'DD/MM/YYYY' });
      useSettingsStore.getState().updateIntegration('fitbit', { enabled: true });

      // Reset
      useSettingsStore.getState().resetToDefaults();

      const state = useSettingsStore.getState();
      expect(state.analysisParams).toEqual(defaultAnalysisParams);
      expect(state.display).toEqual(defaultDisplay);
      expect(state.integrations).toEqual(defaultIntegrations);
    });

    it('should deep-clone defaults so mutations after a reset never leak into later resets', () => {
      // Reset, then mutate a NESTED default-derived object. If resetToDefaults
      // aliased the shared module-level constant, this mutation would corrupt
      // the defaults and the second reset would observe the mutated value.
      useSettingsStore.getState().resetToDefaults();
      useSettingsStore.getState().updateAnalysisParam('ahi', { mildThreshold: 42 });
      useSettingsStore.getState().updateIntegration('fitbit', {
        enabled: true,
        accessToken: 'leaked-token',
      });

      useSettingsStore.getState().resetToDefaults();

      const state = useSettingsStore.getState();
      expect(state.analysisParams.ahi.mildThreshold).toBe(5);
      expect(state.integrations.fitbit).toEqual({ enabled: false, accessToken: null });
      // Full structural equality confirms no nested aliasing crept in.
      expect(state.analysisParams).toEqual(defaultAnalysisParams);
      expect(state.integrations).toEqual(defaultIntegrations);
    });
  });

  describe('persistence', () => {
    it('should use "cpap-settings" as the persist store name', () => {
      // The persist middleware exposes the store name via the persist API
      const persistApi = (
        useSettingsStore as unknown as { persist: { getOptions: () => { name: string } } }
      ).persist;
      expect(persistApi.getOptions().name).toBe('cpap-settings');
    });
  });
});
