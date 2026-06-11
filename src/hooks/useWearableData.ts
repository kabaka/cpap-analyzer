/**
 * Hooks for fetching wearable integration daily summaries and timeseries
 * from IndexedDB.
 *
 * Each hook follows the useState + useEffect pattern with monotonic request
 * sequencing to prevent stale data overwrites (the same technique used in
 * {@link useDataStore}).
 *
 * @module hooks/useWearableData
 */

import { useState, useEffect, useRef } from 'react';
import type {
  FitbitDailyType,
  FitbitTimeseriesType,
  IntegrationDailySummary,
  IntegrationTimeseries,
} from '@/types';
import { getDB } from '@/services/storage/getDB';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface DateRange {
  start: string;
  end: string;
}

interface AsyncResult<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// useWearableDailySummaries
// ---------------------------------------------------------------------------

/**
 * Fetch {@link IntegrationDailySummary} records from IndexedDB for the given
 * data type(s) and date range.
 *
 * When `dataType` is an array, all types are fetched and concatenated.
 * When either parameter is `null`, no query is issued and an empty array is
 * returned immediately.
 *
 * Uses a monotonic request counter so a slow earlier request cannot overwrite
 * fresher results.
 */
export function useWearableDailySummaries(
  dataType: FitbitDailyType | FitbitDailyType[] | null,
  dateRange: DateRange | null,
): AsyncResult<IntegrationDailySummary[]> {
  const [data, setData] = useState<IntegrationDailySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Normalise to a stable string for the effect dependency.
  const typesKey =
    dataType === null ? null : Array.isArray(dataType) ? dataType.join(',') : dataType;
  const rangeKey = dateRange ? `${dateRange.start}_${dateRange.end}` : null;

  useEffect(() => {
    // Nothing to fetch — reset to empty.
    if (typesKey === null || rangeKey === null || dateRange === null) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    const types: FitbitDailyType[] = Array.isArray(dataType)
      ? dataType
      : [dataType as FitbitDailyType];

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const db = await getDB();
        const all = await db.getIntegrationDailySummariesByDateRange(
          dateRange.start,
          dateRange.end,
        );

        // Discard if a newer request has been issued.
        if (requestId !== requestIdRef.current) return;

        const filtered = all.filter((r) => types.includes(r.dataType));
        setData(filtered);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load wearable daily summaries');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesKey, rangeKey]);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// useWearableTimeseries
// ---------------------------------------------------------------------------

/**
 * Fetch {@link IntegrationTimeseries} records from IndexedDB for the given
 * data type(s) and date range.
 *
 * Mirrors the behaviour of {@link useWearableDailySummaries} for the
 * `integration_timeseries` store.
 */
export function useWearableTimeseries(
  dataType: FitbitTimeseriesType | FitbitTimeseriesType[] | null,
  dateRange: DateRange | null,
): AsyncResult<IntegrationTimeseries[]> {
  const [data, setData] = useState<IntegrationTimeseries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const typesKey =
    dataType === null ? null : Array.isArray(dataType) ? dataType.join(',') : dataType;
  const rangeKey = dateRange ? `${dateRange.start}_${dateRange.end}` : null;

  useEffect(() => {
    if (typesKey === null || rangeKey === null || dateRange === null) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    const types: FitbitTimeseriesType[] = Array.isArray(dataType)
      ? dataType
      : [dataType as FitbitTimeseriesType];

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const db = await getDB();
        const all = await db.getIntegrationTimeseriesByDateRange(dateRange.start, dateRange.end);

        if (requestId !== requestIdRef.current) return;

        const filtered = all.filter((r) => types.includes(r.dataType));
        setData(filtered);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load wearable timeseries');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesKey, rangeKey]);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// useWearableDayData
// ---------------------------------------------------------------------------

/**
 * Fetch a single day's {@link IntegrationDailySummary} for a specific data
 * type. Returns `null` when no record exists for the given date.
 *
 * When `date` is `null`, no query is issued.
 */
export function useWearableDayData(
  dataType: FitbitDailyType,
  date: string | null,
): AsyncResult<IntegrationDailySummary | null> {
  const [data, setData] = useState<IntegrationDailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (date === null) {
      setData(null);
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
        const result = await db.getIntegrationDailySummaryByKey('fitbit', dataType, date);

        if (requestId !== requestIdRef.current) return;

        setData(result);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load wearable day data');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [dataType, date]);

  return { data, loading, error };
}
