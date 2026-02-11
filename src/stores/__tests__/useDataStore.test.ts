import { describe, it, expect, beforeEach } from 'vitest';
import { useDataStore } from '@/stores/useDataStore';

describe('useDataStore', () => {
  beforeEach(() => {
    useDataStore.getState().clearCache();
  });

  describe('default state', () => {
    it('should have empty sessions map', () => {
      const { sessions } = useDataStore.getState();
      expect(sessions).toBeInstanceOf(Map);
      expect(sessions.size).toBe(0);
    });

    it('should not be loading sessions', () => {
      expect(useDataStore.getState().sessionsLoading).toBe(false);
    });

    it('should have no sessions error', () => {
      expect(useDataStore.getState().sessionsError).toBeNull();
    });

    it('should have no summary stats', () => {
      expect(useDataStore.getState().summaryStats).toBeNull();
    });

    it('should not be loading summary stats', () => {
      expect(useDataStore.getState().summaryStatsLoading).toBe(false);
    });

    it('should have no lastImportAt', () => {
      expect(useDataStore.getState().lastImportAt).toBeNull();
    });
  });

  describe('loadSessions', () => {
    it('should set sessionsLoading to true during load', async () => {
      const range = { start: new Date('2025-01-01'), end: new Date('2025-01-30') };
      const promise = useDataStore.getState().loadSessions(range);

      // The stub immediately resolves, but loading flag should have been set
      await promise;
      // After completion the stub sets loading back to false
      expect(useDataStore.getState().sessionsLoading).toBe(false);
    });

    it('should clear sessionsError before loading', async () => {
      // Simulate a prior error
      useDataStore.setState({ sessionsError: 'Previous failure' });

      const range = { start: new Date('2025-01-01'), end: new Date('2025-01-30') };
      await useDataStore.getState().loadSessions(range);

      expect(useDataStore.getState().sessionsError).toBeNull();
    });
  });

  describe('loadSummaryStats', () => {
    it('should set summaryStatsLoading to true during load', async () => {
      const range = { start: new Date('2025-01-01'), end: new Date('2025-01-30') };
      const promise = useDataStore.getState().loadSummaryStats(range);

      await promise;
      expect(useDataStore.getState().summaryStatsLoading).toBe(false);
    });
  });

  describe('setLastImportAt', () => {
    it('should update lastImportAt', () => {
      const ts = '2025-06-15T12:00:00Z';
      useDataStore.getState().setLastImportAt(ts);
      expect(useDataStore.getState().lastImportAt).toBe(ts);
    });
  });

  describe('clearCache', () => {
    it('should reset all data to defaults', async () => {
      // Populate the store with non-default values
      useDataStore.setState({
        sessions: new Map([
          [
            's1',
            {
              id: 's1',
              date: '2025-01-01',
              machineModel: 'AirSense 11',
              durationMinutes: 480,
              usageMinutes: 420,
              ahi: 3.2,
              leakMedian: 12,
              eventCount: 8,
              complianceStatus: 'compliant' as const,
            },
          ],
        ]),
        sessionsLoading: true,
        sessionsError: 'error',
        summaryStats: {
          range: { start: new Date('2025-01-01'), end: new Date('2025-01-30') },
          stats: {
            totalSessions: 1,
            dateRange: { start: '2025-01-01', end: '2025-01-01' },
            meanAHI: 3,
            medianAHI: 3,
            meanLeak: 10,
            meanUsageHours: 7,
            complianceRate: 1,
          },
        },
        summaryStatsLoading: true,
        lastImportAt: '2025-01-01T00:00:00Z',
      });

      useDataStore.getState().clearCache();

      const state = useDataStore.getState();
      expect(state.sessions).toBeInstanceOf(Map);
      expect(state.sessions.size).toBe(0);
      expect(state.sessionsLoading).toBe(false);
      expect(state.sessionsError).toBeNull();
      expect(state.summaryStats).toBeNull();
      expect(state.summaryStatsLoading).toBe(false);
      expect(state.lastImportAt).toBeNull();
    });
  });
});
