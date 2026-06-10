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
import { formatDate } from '@/utils/formatDate';

/** Computed summary statistics for a date range. */
export interface SummaryStats {
  meanAHI: number;
  medianAHI: number;
  meanLeak: number;
  leakP95: number;
  meanUsageHours: number;
  meanPressureP95: number;
  complianceRate: number;
  totalSessions: number;
  /** Percent change: first 7-day avg vs last 7-day avg. */
  trendAHIPercent: number;
  trendLeakPercent: number;
  trendUsagePercent: number;
  trendCompliancePercent: number;
  trendPressureP95Percent: number;
  /** Daily values for sparkline/trend charts (last 30 entries). */
  trendData: TrendDataPoint[];
}

/** A single day's data point for trend display. */
export interface TrendDataPoint {
  date: string;
  ahi: number;
  leakMedian: number;
  usageHours: number;
  pressureP95: number;
  complianceStatus: string;
  eventsByType: {
    obstructive: number;
    central: number;
    mixed: number;
    hypopnea: number;
    rera: number;
  };
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
      meanPressureP95: 0,
      complianceRate: 0,
      totalSessions: 0,
      trendAHIPercent: 0,
      trendLeakPercent: 0,
      trendUsagePercent: 0,
      trendCompliancePercent: 0,
      trendPressureP95Percent: 0,
      trendData: [],
    };
  }

  const ahiValues = aggregates.map((a) => a.ahi);
  const leakValues = aggregates.map((a) => a.leakMedian);
  const leakP95Values = aggregates.map((a) => a.leakP95);
  const usageValues = aggregates.map((a) => a.usageHours);
  const pressureP95Values = aggregates.map((a) => a.pressureP95);
  const compliantCount = aggregates.filter((a) => a.complianceStatus === 'compliant').length;

  const meanAHI = mean(ahiValues);
  const medianAHI = median(ahiValues);
  const meanLeak = mean(leakValues);
  const leakP95 = mean(leakP95Values);
  const meanUsageHours = mean(usageValues);
  const meanPressureP95 = mean(pressureP95Values);
  const complianceRate = compliantCount / aggregates.length;

  // Build trend data from the last 30 days of aggregates, sorted by date
  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
  const trendSlice = sorted.slice(-30);
  const trendData: TrendDataPoint[] = trendSlice.map((a) => ({
    date: a.date,
    ahi: a.ahi,
    leakMedian: a.leakMedian,
    usageHours: a.usageHours,
    pressureP95: a.pressureP95,
    complianceStatus: a.complianceStatus,
    eventsByType: {
      obstructive: a.eventsByType.obstructive,
      central: a.eventsByType.central,
      mixed: a.eventsByType.mixed,
      hypopnea: a.eventsByType.hypopnea,
      rera: a.eventsByType.rera,
    },
  }));

  // Compute trend percents: compare first 7-day avg vs last 7-day avg
  const trendAHIPercent = computeTrendPercent(trendSlice.map((a) => a.ahi));
  const trendLeakPercent = computeTrendPercent(trendSlice.map((a) => a.leakMedian));
  const trendUsagePercent = computeTrendPercent(trendSlice.map((a) => a.usageHours));
  const trendCompliancePercent = computeTrendPercent(
    trendSlice.map((a) => (a.complianceStatus === 'compliant' ? 1 : 0)),
  );
  const trendPressureP95Percent = computeTrendPercent(trendSlice.map((a) => a.pressureP95));

  return {
    meanAHI,
    medianAHI,
    meanLeak,
    leakP95,
    meanUsageHours,
    meanPressureP95,
    complianceRate,
    totalSessions: aggregates.length,
    trendAHIPercent,
    trendLeakPercent,
    trendUsagePercent,
    trendCompliancePercent,
    trendPressureP95Percent,
    trendData,
  };
}

/**
 * Compute percent change between the first 7 values' average and the last 7 values' average.
 * Returns 0 if not enough data.
 */
function computeTrendPercent(values: number[]): number {
  if (values.length < 2) return 0;
  const n = Math.min(7, Math.floor(values.length / 2));
  const firstAvg = mean(values.slice(0, n));
  const lastAvg = mean(values.slice(-n));
  if (firstAvg === 0) return lastAvg === 0 ? 0 : 100;
  return ((lastAvg - firstAvg) / firstAvg) * 100;
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
