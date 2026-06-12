/**
 * Data hook: load all therapy events across the active date range.
 *
 * Mirrors the loading strategy of the former EventAnalysis view — sessions are
 * fetched for the global date range, then events are read per session from
 * IndexedDB and concatenated. Event analysis runs on the main thread (these
 * primitives operate on `Event[]` directly, not through the worker engine).
 *
 * @module views/Explore/EventExplorer/useExplorerEvents
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { getDB } from '@/services/storage/getDB';
import type { Event } from '@/types';

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface ExplorerEventsState {
  events: Event[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useExplorerEvents(): ExplorerEventsState {
  const dateRange = useAppStore((s) => s.dateRange);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const db = await getDB();
        const sessions = await db.getSessionsByDateRange(startStr, endStr);
        const allEvents: Event[] = [];
        for (const session of sessions) {
          const sessionEvents = await db.getEventsBySessionId(session.id);
          allEvents.push(...sessionEvents);
        }
        if (!cancelled) setEvents(allEvents);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load event data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [startStr, endStr, refreshKey]);

  return { events, loading, error, refetch };
}
