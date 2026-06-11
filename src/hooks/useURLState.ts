import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { formatDate, parseLocalDate } from '@/utils/formatDate';

/**
 * Bidirectional sync between the Zustand app store and URL search params.
 *
 * On mount, URL params are read and used to hydrate the store.
 * On store change, URL params are updated (debounced, using `replace`
 * to avoid polluting browser history).
 *
 * Synced parameters:
 * - `start` / `end` — the active date range (ISO date strings)
 * - `session` — the currently selected session ID
 */
export function useURLStateSync(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const isHydrating = useRef(true);

  const setDateRange = useAppStore((s) => s.setDateRange);
  const setSelectedSession = useAppStore((s) => s.setSelectedSession);

  // --- Hydrate store from URL on mount ---
  useEffect(() => {
    const startParam = searchParams.get('start');
    const endParam = searchParams.get('end');
    const session = searchParams.get('session');

    if (startParam && endParam) {
      const start = parseLocalDate(startParam);
      const end = parseLocalDate(endParam);

      if (start && end) {
        setDateRange({ start, end });
      }
    }

    if (session) {
      setSelectedSession(session);
    }

    isHydrating.current = false;
    // Only run on mount — intentionally omitting deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Store → URL sync (debounced) ---
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncToURL = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      const { dateRange, selectedSessionId } = useAppStore.getState();

      const next = new URLSearchParams();
      next.set('start', formatDate(dateRange.start));
      next.set('end', formatDate(dateRange.end));

      if (selectedSessionId) {
        next.set('session', selectedSessionId);
      }

      setSearchParams(next, { replace: true });
      timerRef.current = null;
    }, 300);
  }, [setSearchParams]);

  const dateRangeStart = useAppStore((s) => s.dateRange.start);
  const dateRangeEnd = useAppStore((s) => s.dateRange.end);
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);

  useEffect(() => {
    // Skip the first sync triggered by hydration writes.
    if (isHydrating.current) return;

    syncToURL();
  }, [dateRangeStart, dateRangeEnd, selectedSessionId, syncToURL]);

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}
