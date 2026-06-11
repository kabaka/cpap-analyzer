/**
 * Hook to fetch sessions from IndexedDB filtered by date range.
 *
 * Returns session metadata for list views and the dashboard.
 * Re-fetches whenever the date range changes.
 *
 * @module hooks/useSessionData
 */

import { useState, useEffect, useCallback } from 'react';
import type { Session } from '@/types';
import { getDB } from '@/services/storage/getDB';
import { formatDate } from '@/utils/formatDate';

interface UseSessionDataResult {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch sessions from IndexedDB within the given date range.
 *
 * @param dateRange - Start/end dates for the query (inclusive).
 * @returns Sessions, loading state, and any error.
 */
export function useSessionData(dateRange: { start: Date; end: Date }): UseSessionDataResult {
  const [sessions, setSessions] = useState<Session[]>([]);
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
        const results = await db.getSessionsByDateRange(startStr, endStr);

        if (!cancelled) {
          // Sort newest first
          results.sort((a, b) => b.date.localeCompare(a.date));
          setSessions(results);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sessions');
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

  return { sessions, loading, error, refetch };
}
