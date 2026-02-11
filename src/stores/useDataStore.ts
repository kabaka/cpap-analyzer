import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/** Lightweight session metadata for lists (not the full Session type). */
interface SessionMetadata {
  id: string;
  date: string; // ISO date YYYY-MM-DD
  machineModel: string;
  durationMinutes: number;
  usageMinutes: number;
  ahi: number;
  leakMedian: number;
  eventCount: number;
  complianceStatus: 'compliant' | 'non-compliant' | 'partial';
}

interface SummaryStatistics {
  totalSessions: number;
  dateRange: { start: string; end: string };
  meanAHI: number;
  medianAHI: number;
  meanLeak: number;
  meanUsageHours: number;
  /** Compliance rate as a fraction 0–1. */
  complianceRate: number;
}

interface DataState {
  // Session metadata cache
  sessions: Map<string, SessionMetadata>;
  sessionsLoading: boolean;
  sessionsError: string | null;
  loadSessions: (range: { start: Date; end: Date }) => Promise<void>;

  // Summary statistics
  summaryStats: { range: { start: Date; end: Date }; stats: SummaryStatistics } | null;
  summaryStatsLoading: boolean;
  loadSummaryStats: (range: { start: Date; end: Date }) => Promise<void>;

  // Data freshness
  lastImportAt: string | null;
  setLastImportAt: (timestamp: string) => void;

  // Clear all cached data
  clearCache: () => void;
}

export const useDataStore = create<DataState>()(
  devtools(
    (set) => ({
      // Sessions
      sessions: new Map<string, SessionMetadata>(),
      sessionsLoading: false,
      sessionsError: null,
      loadSessions: async (range) => {
        void range; // Will be used for IndexedDB query in Phase 5+
        set({ sessionsLoading: true, sessionsError: null }, undefined, 'loadSessions/start');
        await Promise.resolve();
        set({ sessionsLoading: false }, undefined, 'loadSessions/end');
      },

      // Summary statistics
      summaryStats: null,
      summaryStatsLoading: false,
      loadSummaryStats: async (range) => {
        void range; // Will be used for computation in Phase 5+
        set({ summaryStatsLoading: true }, undefined, 'loadSummaryStats/start');
        await Promise.resolve();
        set({ summaryStatsLoading: false }, undefined, 'loadSummaryStats/end');
      },

      // Data freshness
      lastImportAt: null,
      setLastImportAt: (timestamp) =>
        set({ lastImportAt: timestamp }, undefined, 'setLastImportAt'),

      // Clear cache
      clearCache: () =>
        set(
          {
            sessions: new Map<string, SessionMetadata>(),
            sessionsLoading: false,
            sessionsError: null,
            summaryStats: null,
            summaryStatsLoading: false,
            lastImportAt: null,
          },
          undefined,
          'clearCache',
        ),
    }),
    { name: 'DataStore', enabled: import.meta.env.DEV },
  ),
);
