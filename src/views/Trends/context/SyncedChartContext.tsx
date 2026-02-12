/**
 * Context for synchronizing crosshair and hover state across
 * multiple trend charts. Each chart reports its hovered date,
 * and all charts render a crosshair at that position.
 *
 * @module views/Trends/context/SyncedChartContext
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface SyncedChartContextValue {
  /** ISO date string of the currently hovered data point, or null. */
  activeDate: string | null;
  /** Index into the visible aggregates array. */
  activeIndex: number | null;
  /** Set active hover state. */
  setActive: (date: string | null, index: number | null) => void;
  /** Clear hover state. */
  clear: () => void;
  /** Ref containing the latest active date (avoids re-renders for perf). */
  activeDateRef: React.RefObject<string | null>;
}

const SyncedChartContext = createContext<SyncedChartContextValue | null>(null);

export function SyncedChartProvider({ children }: { children: ReactNode }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeDateRef = useRef<string | null>(null);

  const setActive = useCallback((date: string | null, index: number | null) => {
    activeDateRef.current = date;
    setActiveDate(date);
    setActiveIndex(index);
  }, []);

  const clear = useCallback(() => {
    activeDateRef.current = null;
    setActiveDate(null);
    setActiveIndex(null);
  }, []);

  const value = useMemo(
    (): SyncedChartContextValue => ({
      activeDate,
      activeIndex,
      setActive,
      clear,
      activeDateRef,
    }),
    [activeDate, activeIndex, setActive, clear],
  );

  return <SyncedChartContext.Provider value={value}>{children}</SyncedChartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncedChart(): SyncedChartContextValue {
  const ctx = useContext(SyncedChartContext);
  if (!ctx) {
    throw new Error('useSyncedChart must be used within a SyncedChartProvider');
  }
  return ctx;
}
