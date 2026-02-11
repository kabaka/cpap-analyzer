/**
 * Hook to compute aggregate KPI statistics from nightly aggregates.
 *
 * Fetches NightlyAggregate records from IndexedDB for the given date range
 * and computes summary statistics for the dashboard KPI cards.
 *
 * @module hooks/useSummaryStats
 */

import { useState, useEffect } from 'react';
import type { NightlyAggregate } from '@/types';
import { getDB } from '@/services/storage/getDB';

/** Computed summary statistics for a date range. */
export interface SummaryStats {
  meanAHI: number;
  medianAHI: number;
  meanLeak: number;
  leakP95: number;
  meanUsageHours: number;
  complianceRate: number;
  totalSessions: number;
  /** Daily values for sparkline/trend charts (last 30 entries). */
  trendData: TrendDataPoint[];
}

/** A single day's data point for trend display. */
export interface TrendDataPoint {
  date: string;
  ahi: number;
  leakMedian: number;
  usageHours: number;
}

interface UseSummaryStatsResult {
  stats: SummaryStats | null;
  loading: boolean;
  error: string | null;
}

/**
 * Compute aggregate statistics from nightly aggregates within a date range.
 *
 * @param dateRange - Start/end dates for the query (inclusive).
 * @returns Computed statistics, loading state, and any error.
 */
export function useSummaryStats(dateRange: { start: Date; end: Date }): UseSummaryStatsResult {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const db = await getDB();
        const aggregates = await db.getNightlyAggregatesByDateRange(startStr, endStr);

        if (!cancelled) {
          setStats(computeStats(aggregates));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load statistics');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [startStr, endStr]);

  return { stats, loading, error };
}

/** Compute summary statistics from an array of nightly aggregates. */
function computeStats(aggregates: NightlyAggregate[]): SummaryStats {
  if (aggregates.length === 0) {
    return {
      meanAHI: 0,
      medianAHI: 0,
      meanLeak: 0,
      leakP95: 0,
      meanUsageHours: 0,
      complianceRate: 0,
      totalSessions: 0,
      trendData: [],
    };
  }

  const ahiValues = aggregates.map((a) => a.ahi);
  const leakValues = aggregates.map((a) => a.leakMedian);
  const leakP95Values = aggregates.map((a) => a.leakP95);
  const usageValues = aggregates.map((a) => a.usageHours);
  const compliantCount = aggregates.filter((a) => a.complianceStatus === 'compliant').length;

  const meanAHI = mean(ahiValues);
  const medianAHI = median(ahiValues);
  const meanLeak = mean(leakValues);
  const leakP95 = mean(leakP95Values);
  const meanUsageHours = mean(usageValues);
  const complianceRate = compliantCount / aggregates.length;

  // Build trend data from the last 30 days of aggregates, sorted by date
  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
  const trendSlice = sorted.slice(-30);
  const trendData: TrendDataPoint[] = trendSlice.map((a) => ({
    date: a.date,
    ahi: a.ahi,
    leakMedian: a.leakMedian,
    usageHours: a.usageHours,
  }));

  return {
    meanAHI,
    medianAHI,
    meanLeak,
    leakP95,
    meanUsageHours,
    complianceRate,
    totalSessions: aggregates.length,
    trendData,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Format a Date as YYYY-MM-DD for IndexedDB date range queries. */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
