/**
 * Data hook: load therapy events for the Event Explorer.
 *
 * Two loading strategies, selected by whether a session scope is active:
 *
 * - **Session-scoped** (`sessionIds` non-null and non-empty): load events by
 *   iterating the requested session ids directly (`getSession` +
 *   `getEventsBySessionId`), IGNORING the global date range. This guarantees a
 *   session linked from the Session Detail page resolves even when it falls
 *   OUTSIDE the current global date range (which would otherwise show zero
 *   events).
 * - **Unscoped** (`sessionIds` null/empty): mirror the former EventAnalysis
 *   strategy — fetch sessions for the global date range, then read events per
 *   session and concatenate.
 *
 * In both paths we also build a `sessionStartTimes` map (sessionId → session
 * `startTime` ISO) so the table and scope chips can render wall-clock times and
 * human-readable session labels without re-querying.
 *
 * Event analysis runs on the main thread (these primitives operate on
 * `Event[]` directly, not through the worker engine).
 *
 * @module views/Explore/EventExplorer/useExplorerEvents
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { getDB } from '@/services/storage/getDB';
import { formatDate } from '@/utils/formatDate';
import type { Event } from '@/types';

export interface ExplorerEventsState {
  events: Event[];
  /** sessionId → session `startTime` (ISO). Drives wall-clock time + scope labels. */
  sessionStartTimes: Map<string, string>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Load events for the Explorer.
 *
 * @param sessionIds - Active session scope. When non-null and non-empty, events
 *   are loaded for exactly these sessions regardless of the global date range.
 *   When `null`/empty, the global date range governs loading.
 */
export function useExplorerEvents(sessionIds: ReadonlySet<string> | null): ExplorerEventsState {
  const dateRange = useAppStore((s) => s.dateRange);
  const [events, setEvents] = useState<Event[]>([]);
  const [sessionStartTimes, setSessionStartTimes] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  // Stabilize the scope across renders: a sorted, comma-joined key so the load
  // effect only re-runs when the actual set of ids changes (Sets are compared
  // by reference, which would otherwise re-fire on every parent render).
  const scopeKey = sessionIds && sessionIds.size > 0 ? [...sessionIds].sort().join(',') : '';

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const db = await getDB();
        const allEvents: Event[] = [];
        const starts = new Map<string, string>();

        if (scopeKey !== '') {
          // Session-scoped: resolve each id directly, ignoring the date range.
          const ids = scopeKey.split(',');
          for (const id of ids) {
            const session = await db.getSession(id);
            if (session === null) continue;
            starts.set(session.id, session.startTime);
            const sessionEvents = await db.getEventsBySessionId(session.id);
            allEvents.push(...sessionEvents);
          }
        } else {
          // Unscoped: load sessions within the global date range.
          const sessions = await db.getSessionsByDateRange(startStr, endStr);
          for (const session of sessions) {
            starts.set(session.id, session.startTime);
            const sessionEvents = await db.getEventsBySessionId(session.id);
            allEvents.push(...sessionEvents);
          }
        }

        if (!cancelled) {
          setEvents(allEvents);
          setSessionStartTimes(starts);
        }
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
  }, [startStr, endStr, scopeKey, refreshKey]);

  return { events, sessionStartTimes, loading, error, refetch };
}
