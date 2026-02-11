import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';

/** Format a Date as an ISO date string (YYYY-MM-DD). */
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Validate that a string is a plausible ISO date (YYYY-MM-DD) and parse it. */
function parseISODate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

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
      const start = parseISODate(startParam);
      const end = parseISODate(endParam);

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
      next.set('start', toISODate(dateRange.start));
      next.set('end', toISODate(dateRange.end));

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
