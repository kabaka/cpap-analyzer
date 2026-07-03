/**
 * Tests for the synced-crosshair coordination context.
 *
 * Covers the two coordination channels introduced by the Canvas2D migration:
 *
 * 1. The imperative overlay-repaint channel (`registerOverlay` / `notifyOverlays`
 *    / `activeIndexRef`): a hover/`setActive` on one chart must invoke every
 *    registered overlay callback with the current active index, WITHOUT requiring
 *    a React re-render.
 * 2. The low-frequency React state (`activeDate` / `activeIndex`) used for the
 *    hovered tooltip and the screen-reader table: it must update when the active
 *    category changes, and stay stable when it does not.
 *
 * @module views/Trends/context/__tests__/SyncedChartContext
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SyncedChartProvider, useSyncedChart, type OverlayRepaint } from '../SyncedChartContext';

function wrapper({ children }: { children: ReactNode }) {
  return <SyncedChartProvider>{children}</SyncedChartProvider>;
}

describe('SyncedChartContext', () => {
  describe('imperative overlay-repaint channel', () => {
    it('invokes a registered overlay with the current index when another chart hovers', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      const repaint = vi.fn<OverlayRepaint>();
      act(() => {
        result.current.registerOverlay(repaint);
      });

      // Registration paints once at the current (null) position.
      expect(repaint).toHaveBeenCalledTimes(1);
      expect(repaint).toHaveBeenLastCalledWith(null);

      // A hover on one chart repaints every registered overlay with the index.
      act(() => {
        result.current.setActive('2025-06-03', 2);
      });
      expect(repaint).toHaveBeenLastCalledWith(2);
      // refs hold the latest active position for overlay reads.
      expect(result.current.activeIndexRef.current).toBe(2);
      expect(result.current.activeDateRef.current).toBe('2025-06-03');
    });

    it('fans a single hover out to every registered overlay', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      const a = vi.fn<OverlayRepaint>();
      const b = vi.fn<OverlayRepaint>();
      act(() => {
        result.current.registerOverlay(a);
        result.current.registerOverlay(b);
      });
      a.mockClear();
      b.mockClear();

      act(() => {
        result.current.setActive('2025-06-05', 4);
      });
      expect(a).toHaveBeenCalledWith(4);
      expect(b).toHaveBeenCalledWith(4);
    });

    it('paints a newly registered overlay immediately at the shared position', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      act(() => {
        result.current.setActive('2025-06-07', 6);
      });

      // A chart mounting late should sync to the existing crosshair at once.
      const late = vi.fn<OverlayRepaint>();
      act(() => {
        result.current.registerOverlay(late);
      });
      expect(late).toHaveBeenCalledTimes(1);
      expect(late).toHaveBeenCalledWith(6);
    });

    it('stops notifying an overlay after it unregisters', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      const repaint = vi.fn<OverlayRepaint>();
      let unregister: () => void = () => {};
      act(() => {
        unregister = result.current.registerOverlay(repaint);
      });
      act(() => {
        unregister();
      });
      repaint.mockClear();

      act(() => {
        result.current.setActive('2025-06-08', 7);
      });
      expect(repaint).not.toHaveBeenCalled();
    });

    it('notifyOverlays repaints at the current ref index without changing state', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      const repaint = vi.fn<OverlayRepaint>();
      act(() => {
        result.current.registerOverlay(repaint);
        result.current.setActive('2025-06-09', 8);
      });
      repaint.mockClear();

      act(() => {
        result.current.notifyOverlays();
      });
      expect(repaint).toHaveBeenCalledTimes(1);
      expect(repaint).toHaveBeenCalledWith(8);
    });
  });

  describe('React state for tooltip / screen-reader content', () => {
    it('updates activeDate/activeIndex when the hovered category changes', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      expect(result.current.activeDate).toBeNull();
      expect(result.current.activeIndex).toBeNull();

      act(() => {
        result.current.setActive('2025-06-10', 9);
      });
      expect(result.current.activeDate).toBe('2025-06-10');
      expect(result.current.activeIndex).toBe(9);
    });

    it('clears both the state and the refs on clear()', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      act(() => {
        result.current.setActive('2025-06-11', 10);
      });
      act(() => {
        result.current.clear();
      });
      expect(result.current.activeDate).toBeNull();
      expect(result.current.activeIndex).toBeNull();
      expect(result.current.activeIndexRef.current).toBeNull();
      expect(result.current.activeDateRef.current).toBeNull();
    });

    it('still repaints overlays on a same-category re-hover even though state is unchanged', () => {
      const { result } = renderHook(() => useSyncedChart(), { wrapper });

      const repaint = vi.fn<OverlayRepaint>();
      act(() => {
        result.current.registerOverlay(repaint);
        result.current.setActive('2025-06-12', 11);
      });
      repaint.mockClear();

      // Re-hover the SAME category: refs/state unchanged, but the imperative
      // channel still fires so a freshly repainted base re-stamps its crosshair.
      act(() => {
        result.current.setActive('2025-06-12', 11);
      });
      expect(repaint).toHaveBeenCalledTimes(1);
      expect(repaint).toHaveBeenCalledWith(11);
      expect(result.current.activeIndex).toBe(11);
    });
  });

  it('throws when useSyncedChart is used outside a provider', () => {
    // React logs the thrown error and jsdom re-dispatches it as an uncaught
    // `error` event; both are EXPECTED here. Silence only this test's noise
    // (console.error + the jsdom window error event) without masking others.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const swallow = (e: Event) => e.preventDefault();
    window.addEventListener('error', swallow);
    try {
      expect(() => renderHook(() => useSyncedChart())).toThrow(
        /must be used within a SyncedChartProvider/i,
      );
    } finally {
      window.removeEventListener('error', swallow);
      consoleSpy.mockRestore();
    }
  });
});
