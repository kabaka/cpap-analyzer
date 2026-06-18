import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { getDB } from '@/services/storage/getDB';
import { pooledRate } from '@/analysis/uncertainty';
import { formatDate } from '@/utils/formatDate';

/** Lightweight session metadata for lists (not the full Session type). */
interface SessionMetadata {
  id: string;
  date: string; // ISO date YYYY-MM-DD
  machineModel: string;
  durationMinutes: number;
  usageMinutes: number;
  /**
   * Per-night AHI rate, or `null` when the recording was below the
   * rate-validity floor (undefined rate). List/table consumers MUST render
   * null as an "insufficient recording time" indicator, never as 0.
   */
  ahi: number | null;
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

/** Compute the median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface DataState {
  // Session metadata cache
  sessions: Map<string, SessionMetadata>;
  /** The date range that produced the current `sessions` map, if any. */
  sessionsRange: { start: Date; end: Date } | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  loadSessions: (range: { start: Date; end: Date }) => Promise<void>;

  // Summary statistics
  summaryStats: { range: { start: Date; end: Date }; stats: SummaryStatistics } | null;
  summaryStatsLoading: boolean;
  summaryStatsError: string | null;
  loadSummaryStats: (range: { start: Date; end: Date }) => Promise<void>;

  // Data freshness
  lastImportAt: string | null;
  setLastImportAt: (timestamp: string) => void;

  // Clear all cached data
  clearCache: () => void;
}

// ---------------------------------------------------------------------------
// Request sequencing
// ---------------------------------------------------------------------------
//
// `loadSessions` and `loadSummaryStats` are fire-and-forget. Without
// sequencing, a slow earlier request can resolve AFTER a newer one and
// overwrite current state with stale data. Each action captures a monotonic
// token before awaiting and only commits its result if it is still the latest
// request for that action. Tokens are module-scoped (one store instance per
// app), keeping the public store shape unchanged.

let sessionsRequestId = 0;
let summaryStatsRequestId = 0;

export const useDataStore = create<DataState>()(
  devtools(
    (set) => ({
      // Sessions
      sessions: new Map<string, SessionMetadata>(),
      sessionsRange: null,
      sessionsLoading: false,
      sessionsError: null,
      loadSessions: async (range) => {
        const requestId = ++sessionsRequestId;
        set({ sessionsLoading: true, sessionsError: null }, undefined, 'loadSessions/start');
        try {
          const db = await getDB();
          const start = formatDate(range.start);
          const end = formatDate(range.end);
          const sessions = await db.getSessionsByDateRange(start, end);
          const aggregates = await db.getNightlyAggregatesByDateRange(start, end);

          // A newer request superseded this one while it was in flight; discard.
          if (requestId !== sessionsRequestId) return;

          // Build a lookup from sessionId → aggregate
          const aggMap = new Map(aggregates.map((a) => [a.sessionId, a]));

          const map = new Map<string, SessionMetadata>();
          for (const s of sessions) {
            const agg = aggMap.get(s.id);
            map.set(s.id, {
              id: s.id,
              date: s.date,
              machineModel: s.machineModel,
              durationMinutes: s.durationMinutes,
              usageMinutes: s.usageMinutes,
              // Preserve a null/absent AHI as null (undefined rate); never 0.
              ahi: agg?.ahi ?? null,
              leakMedian: agg?.leakMedian ?? 0,
              eventCount: agg?.eventCount ?? 0,
              complianceStatus: agg?.complianceStatus ?? 'non-compliant',
            });
          }
          set(
            { sessions: map, sessionsRange: range, sessionsLoading: false },
            undefined,
            'loadSessions/end',
          );
        } catch (err) {
          // Ignore errors from superseded requests.
          if (requestId !== sessionsRequestId) return;
          set(
            {
              sessionsError: err instanceof Error ? err.message : 'Failed to load sessions',
              sessionsLoading: false,
            },
            undefined,
            'loadSessions/error',
          );
        }
      },

      // Summary statistics
      summaryStats: null,
      summaryStatsLoading: false,
      summaryStatsError: null,
      loadSummaryStats: async (range) => {
        const requestId = ++summaryStatsRequestId;
        set(
          { summaryStatsLoading: true, summaryStatsError: null },
          undefined,
          'loadSummaryStats/start',
        );
        try {
          const db = await getDB();
          const start = formatDate(range.start);
          const end = formatDate(range.end);
          const aggregates = await db.getNightlyAggregatesByDateRange(start, end);

          // A newer request superseded this one while it was in flight; discard.
          if (requestId !== summaryStatsRequestId) return;

          const leakValues = aggregates.map((a) => a.leakMedian);
          const usageValues = aggregates.map((a) => a.usageHours);
          const compliantCount = aggregates.filter(
            (a) => a.complianceStatus === 'compliant',
          ).length;

          const totalSessions = aggregates.length;
          // AHI is a per-hour RATE: nights with a null AHI had too little
          // recording for a defined rate and are EXCLUDED from every AHI
          // statistic (never coerced to 0). The window mean is the
          // duration-weighted POOLED rate (Σ ahi·hours / Σ hours = Σ events /
          // Σ hours) so a short noisy night cannot dominate; the median is
          // taken over the qualifying (non-null) nights only.
          const meanAHI =
            pooledRate(aggregates.map((a) => ({ rate: a.ahi, hours: a.usageHours }))) ?? 0;
          const qualifyingAhiValues = aggregates
            .map((a) => a.ahi)
            .filter((v): v is number => v !== null);
          const meanLeak =
            totalSessions > 0 ? leakValues.reduce((sum, v) => sum + v, 0) / totalSessions : 0;
          const meanUsageHours =
            totalSessions > 0 ? usageValues.reduce((sum, v) => sum + v, 0) / totalSessions : 0;
          const complianceRate = totalSessions > 0 ? compliantCount / totalSessions : 0;

          const stats: SummaryStatistics = {
            totalSessions,
            dateRange: { start, end },
            meanAHI,
            medianAHI: median(qualifyingAhiValues),
            meanLeak,
            meanUsageHours,
            complianceRate,
          };

          set(
            { summaryStats: { range, stats }, summaryStatsLoading: false },
            undefined,
            'loadSummaryStats/end',
          );
        } catch (err) {
          // Ignore errors from superseded requests.
          if (requestId !== summaryStatsRequestId) return;
          set(
            {
              summaryStatsError: err instanceof Error ? err.message : 'Failed to load statistics',
              summaryStatsLoading: false,
            },
            undefined,
            'loadSummaryStats/error',
          );
        }
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
            sessionsRange: null,
            sessionsLoading: false,
            sessionsError: null,
            summaryStats: null,
            summaryStatsLoading: false,
            summaryStatsError: null,
            lastImportAt: null,
          },
          undefined,
          'clearCache',
        ),
    }),
    { name: 'DataStore', enabled: import.meta.env.DEV },
  ),
);
