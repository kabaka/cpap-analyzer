/**
 * Zustand store for synchronised chart interactions.
 *
 * Manages shared zoom domain, brush selection, and crosshair
 * position so multiple chart panels can stay in sync.
 *
 * @module stores/useChartInteractionStore
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface ChartInteractionState {
  /** Synchronised zoom domain across charts. */
  zoomDomain: { x: [number, number]; y?: [number, number] } | null;
  setZoomDomain: (domain: ChartInteractionState['zoomDomain']) => void;
  resetZoom: () => void;

  /** Brush-selected date range. */
  brushSelection: { start: Date; end: Date } | null;
  setBrushSelection: (selection: ChartInteractionState['brushSelection']) => void;
  clearBrushSelection: () => void;

  /** Crosshair x-position synchronised across charts. */
  crosshairPosition: { x: number } | null;
  setCrosshairPosition: (pos: ChartInteractionState['crosshairPosition']) => void;
}

export const useChartInteractionStore = create<ChartInteractionState>()(
  devtools(
    (set) => ({
      zoomDomain: null,
      setZoomDomain: (domain) => set({ zoomDomain: domain }, undefined, 'setZoomDomain'),
      resetZoom: () => set({ zoomDomain: null }, undefined, 'resetZoom'),

      brushSelection: null,
      setBrushSelection: (selection) =>
        set({ brushSelection: selection }, undefined, 'setBrushSelection'),
      clearBrushSelection: () => set({ brushSelection: null }, undefined, 'clearBrushSelection'),

      crosshairPosition: null,
      setCrosshairPosition: (pos) =>
        set({ crosshairPosition: pos }, undefined, 'setCrosshairPosition'),
    }),
    { name: 'ChartInteractionStore' },
  ),
);
