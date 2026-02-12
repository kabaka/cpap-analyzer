/**
 * Hook to fetch nightly aggregates from IndexedDB for a date range.
 *
 * Returns raw NightlyAggregate records for joining with session data
 * in table views.
 *
 * @module hooks/useNightlyAggregates
 */

import { useState, useEffect, useCallback } from 'react';
import type { NightlyAggregate } from '@/types';
import { getDB } from '@/services/storage/getDB';

interface UseNightlyAggregatesResult {
  aggregates: NightlyAggregate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch nightly aggregates from IndexedDB within the given date range.
 *
 * @param dateRange - Start/end dates for the query (inclusive).
 * @returns Aggregates, loading state, and any error.
 */
export function useNightlyAggregates(dateRange: {
  start: Date;
  end: Date;
}): UseNightlyAggregatesResult {
  const [aggregates, setAggregates] = useState<NightlyAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const db = await getDB();
        const results = await db.getNightlyAggregatesByDateRange(startStr, endStr);

        if (!cancelled) {
          setAggregates(results);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load aggregates');
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
  }, [startStr, endStr, refreshKey]);

  return { aggregates, loading, error, refetch };
}

/** Format a Date as YYYY-MM-DD for IndexedDB date range queries. */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
