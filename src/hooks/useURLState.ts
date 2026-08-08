import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { formatDate, parseLocalDate } from '@/utils/formatDate';
import { getLiveSearch } from '@/utils/liveRouterLocation';

/**
 * Bidirectional sync between the Zustand app store and URL search params.
 *
 * On mount, URL params are read and used to hydrate the store.
 * On store change, URL params are updated (debounced, using `replace`
 * to avoid polluting browser history).
 *
 * Synced parameters (THIS HOOK OWNS ONLY THESE THREE — every other query
 * param is preserved verbatim across writes, so view-state-in-URL patterns
 * elsewhere in the app (e.g. `/explore/correlations?tab=cross-source`,
 * `/explore/events?types=Hypopnea&dur=30-`) survive a date-range or session
 * change without being silently wiped):
 * - `start` / `end` — the active date range (ISO date strings)
 * - `session` — the currently selected session ID
 */
export function useURLStateSync(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const isHydrating = useRef(true);

  const setDateRange = useAppStore((s) => s.setDateRange);
  const setSelectedSession = useAppStore((s) => s.setSelectedSession);

  // --- Hydrate store from URL on mount ---
  // NOTE: this intentionally does NOT clear `isHydrating.current` — that is
  // done by a separate effect declared AFTER the store→URL sync effect
  // below (see the "isHydrating guard" comment there for why the ordering
  // matters).
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

      // Build the next params from the CURRENT URL so unknown params (e.g.
      // `?tab=cross-source`, Event Explorer filters) survive this write. We
      // only own start/end/session — set/overwrite those, delete them when
      // their store value is empty, and leave every other key untouched.
      //
      // IMPORTANT: `prev` (and the closed-over `searchParams` it's derived
      // from) reflects the last React-COMMITTED location, not necessarily
      // the real current URL — react-router 7's `RouterProvider` wraps the
      // state update behind `useLocation()`/`useSearchParams()` in
      // `React.startTransition`, so a `navigate()` that just changed the
      // real address bar (and thus the router's own internal state) may not
      // have flushed to a React re-render yet by the time this debounce
      // fires (up to ~300ms later). Merging onto a stale `prev` in that
      // window would clobber the just-navigated URL's query string. Prefer
      // `getLiveSearch()`, which is updated synchronously by the router
      // itself (see `src/utils/liveRouterLocation.ts`) and is therefore
      // never behind a pending transition. It's `null` only when no router
      // has registered (e.g. hooks under a bare `<MemoryRouter>` in unit
      // tests) — in that case `prev` is the correct/only available base.
      setSearchParams(
        (prev) => {
          const liveSearch = getLiveSearch();
          const next = new URLSearchParams(liveSearch ?? prev);
          next.set('start', formatDate(dateRange.start));
          next.set('end', formatDate(dateRange.end));
          if (selectedSessionId) {
            next.set('session', selectedSessionId);
          } else {
            next.delete('session');
          }
          return next;
        },
        { replace: true },
      );
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

  // Clear the hydration guard AFTER the sync effect above has had a chance
  // to run for this commit.
  //
  // Effect ORDER matters here: passive effects within a commit run in the
  // order their hooks are declared. This effect is declared (and therefore
  // runs) after the store→URL sync effect above, so on mount both effects
  // fire in the same commit with `isHydrating.current` still `true` when
  // the sync effect checks it — correctly suppressing a sync-to-URL for the
  // hydration write. Previously this flag was cleared at the end of the
  // hydrate-from-URL effect (declared FIRST), which — because that effect
  // also runs before the sync effect in the same commit — flipped the flag
  // to `false` too early, so the sync effect's own first run never saw it
  // as hydrating and fired a spurious (if usually no-op-content) sync-to-URL
  // on every `RootLayout` mount.
  useEffect(() => {
    isHydrating.current = false;
  }, []);

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}
