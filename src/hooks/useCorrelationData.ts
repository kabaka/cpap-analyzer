/**
 * Hook that joins CPAP nightly aggregates with wearable daily summaries by
 * date, producing an inner-joined dataset suitable for correlation analysis.
 *
 * Only days with BOTH CPAP and wearable data are included. Each
 * {@link JoinedDayRecord} groups wearable records by data type for easy
 * downstream access.
 *
 * @module hooks/useCorrelationData
 */

import { useState, useEffect, useRef } from 'react';
import type { FitbitDailyType, IntegrationDailySummary, NightlyAggregate } from '@/types';
import { getDB } from '@/services/storage/getDB';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JoinedDayRecord {
  /** ISO date (YYYY-MM-DD) shared by both sources. */
  date: string;
  /** CPAP nightly aggregate for this date. */
  cpap: NightlyAggregate;
  /** Wearable daily summaries keyed by data type. */
  wearable: Record<string, IntegrationDailySummary>;
}

interface UseCorrelationDataResult {
  /** Inner-joined records (only dates present in BOTH sources). */
  data: JoinedDayRecord[];
  loading: boolean;
  error: string | null;
  /** Total CPAP days available in the date range. */
  cpapDays: number;
  /** Total wearable days available in the date range. */
  wearableDays: number;
  /** Number of days with data from both sources (= data.length). */
  overlapDays: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch CPAP nightly aggregates and wearable daily summaries for the given
 * date range and inner-join them by date.
 *
 * @param dateRange     - ISO date strings (YYYY-MM-DD, inclusive). Pass `null`
 *                        to skip the query.
 * @param wearableTypes - Optional filter: only include these wearable data
 *                        types. When omitted, all types are included.
 */
export function useCorrelationData(
  dateRange: { start: string; end: string } | null,
  wearableTypes?: FitbitDailyType[],
): UseCorrelationDataResult {
  const [data, setData] = useState<JoinedDayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cpapDays, setCpapDays] = useState(0);
  const [wearableDays, setWearableDays] = useState(0);
  const [overlapDays, setOverlapDays] = useState(0);
  const requestIdRef = useRef(0);

  // Stable dependency key for wearableTypes.
  const typesKey = wearableTypes ? wearableTypes.slice().sort().join(',') : undefined;
  const rangeKey = dateRange ? `${dateRange.start}_${dateRange.end}` : null;

  useEffect(() => {
    if (rangeKey === null || dateRange === null) {
      setData([]);
      setCpapDays(0);
      setWearableDays(0);
      setOverlapDays(0);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const db = await getDB();

        // Fetch both sources in parallel.
        const [aggregates, summaries] = await Promise.all([
          db.getNightlyAggregatesByDateRange(dateRange.start, dateRange.end),
          db.getIntegrationDailySummariesByDateRange(dateRange.start, dateRange.end),
        ]);

        if (requestId !== requestIdRef.current) return;

        // --- Build a date-keyed map of CPAP aggregates. ---
        // When multiple aggregates share a date (e.g. split sessions), pick
        // the one with the longest usage so the correlation uses the primary
        // session for that night.
        const cpapMap = new Map<string, NightlyAggregate>();
        for (const agg of aggregates) {
          const existing = cpapMap.get(agg.date);
          if (!existing || agg.usageHours > existing.usageHours) {
            cpapMap.set(agg.date, agg);
          }
        }

        // --- Build a date-keyed map of wearable summaries. ---
        // Each date maps to a record of dataType -> summary.
        const wearableMap = new Map<string, Record<string, IntegrationDailySummary>>();
        const wearableDateSet = new Set<string>();

        for (const s of summaries) {
          // Source filter: only include Fitbit data.
          if (s.source !== 'fitbit') continue;
          // Optional type filter.
          if (wearableTypes && !wearableTypes.includes(s.dataType)) continue;

          wearableDateSet.add(s.date);
          let dateRecord = wearableMap.get(s.date);
          if (!dateRecord) {
            dateRecord = {};
            wearableMap.set(s.date, dateRecord);
          }
          dateRecord[s.dataType] = s;
        }

        // --- Inner join on date. ---
        const joined: JoinedDayRecord[] = [];
        for (const [date, cpap] of cpapMap) {
          const wearable = wearableMap.get(date);
          if (wearable) {
            joined.push({ date, cpap, wearable });
          }
        }

        // Sort chronologically.
        joined.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        if (requestId !== requestIdRef.current) return;

        setData(joined);
        setCpapDays(cpapMap.size);
        setWearableDays(wearableDateSet.size);
        setOverlapDays(joined.length);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load correlation data');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, typesKey]);

  return { data, loading, error, cpapDays, wearableDays, overlapDays };
}
