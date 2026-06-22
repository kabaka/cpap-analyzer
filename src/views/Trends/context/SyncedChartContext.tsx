/**
 * Context for synchronizing crosshair and hover state across multiple trend
 * charts.
 *
 * Two coordination channels coexist, deliberately:
 *
 * 1. **Low-frequency React state** (`activeDate` / `activeIndex`) drives the
 *    things that legitimately need a re-render: the hovered chart's tooltip and
 *    the screen-reader content. It updates only when the hovered category
 *    actually changes.
 *
 * 2. **An imperative overlay-repaint channel** (`registerOverlay` +
 *    `activeIndexRef` / `activeDateRef`) lets a hover on ONE chart repaint the
 *    synced crosshair on EVERY chart's transparent overlay canvas WITHOUT
 *    re-rendering the React tree — mirroring the Signal Viewer's overlay pattern.
 *    Each Canvas2D chart registers a repaint callback; `notifyOverlays()` invokes
 *    them all with the current active index/date held in refs.
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

/** A chart's overlay-repaint callback, invoked with the current active index. */
export type OverlayRepaint = (activeIndex: number | null) => void;

export interface SyncedChartContextValue {
  /** ISO date string of the currently hovered data point, or null. */
  activeDate: string | null;
  /** Index into the visible aggregates array. */
  activeIndex: number | null;
  /** Set active hover state (updates React state AND notifies overlays). */
  setActive: (date: string | null, index: number | null) => void;
  /** Clear hover state. */
  clear: () => void;
  /** Ref containing the latest active date (avoids re-renders for perf). */
  activeDateRef: React.RefObject<string | null>;
  /** Ref containing the latest active index (read by overlay repaints). */
  activeIndexRef: React.RefObject<number | null>;
  /**
   * Register a chart's overlay-repaint callback. Returns an unregister function.
   * The callback is invoked (with the current active index) whenever any chart's
   * hover changes, so all crosshairs stay in sync without a React re-render.
   */
  registerOverlay: (fn: OverlayRepaint) => () => void;
  /** Imperatively repaint every registered overlay at the current active index. */
  notifyOverlays: () => void;
}

const SyncedChartContext = createContext<SyncedChartContextValue | null>(null);

export function SyncedChartProvider({ children }: { children: ReactNode }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeDateRef = useRef<string | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const overlaysRef = useRef<Set<OverlayRepaint>>(new Set());

  const notifyOverlays = useCallback(() => {
    const idx = activeIndexRef.current;
    for (const fn of overlaysRef.current) fn(idx);
  }, []);

  const registerOverlay = useCallback((fn: OverlayRepaint) => {
    overlaysRef.current.add(fn);
    // Paint the new chart's crosshair at the current shared position immediately.
    fn(activeIndexRef.current);
    return () => {
      overlaysRef.current.delete(fn);
    };
  }, []);

  const setActive = useCallback(
    (date: string | null, index: number | null) => {
      const changed = activeIndexRef.current !== index || activeDateRef.current !== date;
      activeDateRef.current = date;
      activeIndexRef.current = index;
      // Repaint crosshairs synchronously on every chart (no React round-trip).
      notifyOverlays();
      // Update tooltip / SR content state only when the category actually changed.
      if (changed) {
        setActiveDate(date);
        setActiveIndex(index);
      }
    },
    [notifyOverlays],
  );

  const clear = useCallback(() => {
    const changed = activeIndexRef.current !== null || activeDateRef.current !== null;
    activeDateRef.current = null;
    activeIndexRef.current = null;
    notifyOverlays();
    if (changed) {
      setActiveDate(null);
      setActiveIndex(null);
    }
  }, [notifyOverlays]);

  const value = useMemo(
    (): SyncedChartContextValue => ({
      activeDate,
      activeIndex,
      setActive,
      clear,
      activeDateRef,
      activeIndexRef,
      registerOverlay,
      notifyOverlays,
    }),
    [activeDate, activeIndex, setActive, clear, registerOverlay, notifyOverlays],
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
