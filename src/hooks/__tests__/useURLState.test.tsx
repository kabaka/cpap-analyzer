import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useURLStateSync } from '@/hooks/useURLState';
import { useAppStore } from '@/stores/useAppStore';
import { formatDate, parseLocalDate } from '@/utils/formatDate';

/**
 * Wrapper that renders the hook inside a MemoryRouter (so useSearchParams
 * works) while also exposing the current location's search string for
 * round-trip assertions.
 */
function makeWrapper(initialEntry: string) {
  let currentSearch = '';
  function LocationProbe() {
    currentSearch = useLocation().search;
    return null;
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        {children}
        <LocationProbe />
      </MemoryRouter>
    );
  }
  return { Wrapper, getSearch: () => currentSearch };
}

function setStoreRange(start: Date, end: Date) {
  act(() => {
    useAppStore.getState().setDateRange({ start, end });
  });
}

describe('useURLStateSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset relevant store slices to a known default.
    useAppStore.setState({
      dateRange: { start: new Date(2025, 0, 1), end: new Date(2025, 0, 31) },
      selectedSessionId: null,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('hydrate from URL → store', () => {
    it('reads start/end/session params on mount and writes them to the store', () => {
      const { Wrapper } = makeWrapper('/?start=2025-03-10&end=2025-03-20&session=abc');
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      const { dateRange, selectedSessionId } = useAppStore.getState();
      expect(formatDate(dateRange.start)).toBe('2025-03-10');
      expect(formatDate(dateRange.end)).toBe('2025-03-20');
      expect(selectedSessionId).toBe('abc');
    });

    it('hydrates dates as LOCAL midnight (no UTC off-by-one shift)', () => {
      const { Wrapper } = makeWrapper('/?start=2025-03-10&end=2025-03-20');
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      const { dateRange } = useAppStore.getState();
      // parseLocalDate constructs local midnight; the local calendar day must
      // match the URL exactly regardless of the host timezone offset.
      expect(dateRange.start).toEqual(parseLocalDate('2025-03-10'));
      expect(dateRange.start.getHours()).toBe(0);
      expect(dateRange.start.getDate()).toBe(10);
    });

    it('ignores malformed date params and leaves the store range untouched', () => {
      const original = useAppStore.getState().dateRange;
      const { Wrapper } = makeWrapper('/?start=not-a-date&end=2025-13-99');
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      expect(useAppStore.getState().dateRange).toBe(original);
    });
  });

  describe('store → URL round-trip stability', () => {
    it('serializes a store date range to the URL and re-hydrates to the SAME range', () => {
      const { Wrapper, getSearch } = makeWrapper('/');
      const { unmount } = renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      const start = new Date(2025, 6, 4); // local July 4 2025
      const end = new Date(2025, 6, 14); // local July 14 2025
      setStoreRange(start, end);

      // Flush the 300ms debounce that writes to the URL.
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const search = new URLSearchParams(getSearch());
      expect(search.get('start')).toBe('2025-07-04');
      expect(search.get('end')).toBe('2025-07-14');

      unmount();

      // Re-hydrate a fresh hook from the serialized URL.
      useAppStore.setState({
        dateRange: { start: new Date(2025, 0, 1), end: new Date(2025, 0, 2) },
      });
      const { Wrapper: Wrapper2 } = makeWrapper(`/?${search.toString()}`);
      renderHook(() => useURLStateSync(), { wrapper: Wrapper2 });

      const rehydrated = useAppStore.getState().dateRange;
      // The local calendar day must round-trip identically.
      expect(formatDate(rehydrated.start)).toBe('2025-07-04');
      expect(formatDate(rehydrated.end)).toBe('2025-07-14');
      expect(rehydrated.start.getDate()).toBe(4);
      expect(rehydrated.end.getDate()).toBe(14);
    });

    it('round-trips stably for a date near a month boundary (simulated non-UTC offset)', () => {
      // A user east/west of UTC: a local date like the 1st of a month is the
      // classic case where toISOString() would have shifted to the previous or
      // next day. Using the shared formatDate/parseLocalDate must avoid that.
      const { Wrapper, getSearch } = makeWrapper('/');
      const { unmount } = renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      const start = new Date(2025, 2, 1); // local March 1 2025
      const end = new Date(2025, 2, 31); // local March 31 2025
      setStoreRange(start, end);
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const search = getSearch();
      expect(search).toContain('start=2025-03-01');
      expect(search).toContain('end=2025-03-31');
      unmount();

      const { Wrapper: Wrapper2 } = makeWrapper(`/${search}`);
      renderHook(() => useURLStateSync(), { wrapper: Wrapper2 });

      const rehydrated = useAppStore.getState().dateRange;
      expect(formatDate(rehydrated.start)).toBe('2025-03-01');
      expect(formatDate(rehydrated.end)).toBe('2025-03-31');
    });
  });

  describe('unknown-param preservation (deep-link IA regression guard)', () => {
    /**
     * The IA introduced view-state-in-URL patterns owned by individual views
     * — e.g. `/explore/correlations?tab=cross-source` for the inner tab, or
     * `/explore/events?types=Hypopnea&dur=30-` for Event Explorer filters.
     * useURLStateSync only owns start/end/session and MUST NOT clobber any
     * other query param when it writes its three keys. A previous regression
     * built a fresh URLSearchParams with only the three owned keys, silently
     * wiping every other param ~300 ms after mount on every route mount and
     * on every date-range change.
     */

    it('preserves an unrelated `tab` param across a date-range write', () => {
      const { Wrapper, getSearch } = makeWrapper(
        '/?start=2025-05-05&end=2025-05-15&tab=cross-source',
      );
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      // A genuine post-hydration store change flushes the debounce.
      setStoreRange(new Date(2025, 7, 1), new Date(2025, 7, 10));
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const search = new URLSearchParams(getSearch());
      expect(search.get('start')).toBe('2025-08-01');
      expect(search.get('end')).toBe('2025-08-10');
      // The view-owned `tab` param must survive — this is the regression.
      expect(search.get('tab')).toBe('cross-source');
    });

    it('preserves multiple unrelated params (Event Explorer-style filters)', () => {
      const { Wrapper, getSearch } = makeWrapper(
        '/?start=2025-05-05&end=2025-05-15&types=Hypopnea&dur=30-',
      );
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      setStoreRange(new Date(2025, 7, 1), new Date(2025, 7, 10));
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const search = new URLSearchParams(getSearch());
      expect(search.get('types')).toBe('Hypopnea');
      expect(search.get('dur')).toBe('30-');
      expect(search.get('start')).toBe('2025-08-01');
    });

    it('clearing the store session removes `session=…` but keeps unrelated params', () => {
      const { Wrapper, getSearch } = makeWrapper(
        '/?start=2025-05-05&end=2025-05-15&session=abc&tab=cross-source',
      );
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      // Confirm hydration picked up the session before we clear it.
      expect(useAppStore.getState().selectedSessionId).toBe('abc');

      act(() => {
        useAppStore.getState().setSelectedSession(null);
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const search = new URLSearchParams(getSearch());
      // session is removed when the store clears it.
      expect(search.get('session')).toBeNull();
      // The view-owned `tab` param must survive the session clear.
      expect(search.get('tab')).toBe('cross-source');
      // start/end remain as serialized from the store.
      expect(search.get('start')).toBe('2025-05-05');
      expect(search.get('end')).toBe('2025-05-15');
    });
  });

  describe('isHydrating guard', () => {
    it('does not echo the hydrated range straight back to the URL on mount', () => {
      // URL carries a range; on mount the hook hydrates the store from it. The
      // isHydrating guard must suppress the store→URL effect that the hydration
      // writes would otherwise trigger, so no replace() fires before any real
      // user change. We assert the search string is unchanged after the debounce
      // window elapses with no further store mutation.
      const { Wrapper, getSearch } = makeWrapper('/?start=2025-05-05&end=2025-05-15');
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      const before = getSearch();
      act(() => {
        vi.advanceTimersByTime(500);
      });
      const after = getSearch();

      expect(after).toBe(before);
      expect(after).toContain('start=2025-05-05');
      expect(after).toContain('end=2025-05-15');
    });

    it('DOES sync to the URL after a genuine post-hydration store change', () => {
      const { Wrapper, getSearch } = makeWrapper('/?start=2025-05-05&end=2025-05-15');
      renderHook(() => useURLStateSync(), { wrapper: Wrapper });

      setStoreRange(new Date(2025, 7, 1), new Date(2025, 7, 10));
      act(() => {
        vi.advanceTimersByTime(300);
      });

      const search = getSearch();
      expect(search).toContain('start=2025-08-01');
      expect(search).toContain('end=2025-08-10');
    });
  });
});
