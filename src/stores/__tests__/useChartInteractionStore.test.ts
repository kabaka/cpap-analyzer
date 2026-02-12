import { describe, it, expect, beforeEach } from 'vitest';
import { useChartInteractionStore } from '@/stores/useChartInteractionStore';

describe('useChartInteractionStore', () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useChartInteractionStore.setState({
      zoomDomain: null,
      brushSelection: null,
      crosshairPosition: null,
    });
  });

  describe('default state', () => {
    it('should initialise zoomDomain as null', () => {
      expect(useChartInteractionStore.getState().zoomDomain).toBeNull();
    });

    it('should initialise brushSelection as null', () => {
      expect(useChartInteractionStore.getState().brushSelection).toBeNull();
    });

    it('should initialise crosshairPosition as null', () => {
      expect(useChartInteractionStore.getState().crosshairPosition).toBeNull();
    });
  });

  describe('setZoomDomain', () => {
    it('should update zoomDomain with x-only range', () => {
      const domain = { x: [0, 100] as [number, number] };
      useChartInteractionStore.getState().setZoomDomain(domain);

      const state = useChartInteractionStore.getState();
      expect(state.zoomDomain).toEqual(domain);
      expect(state.zoomDomain?.x).toEqual([0, 100]);
      expect(state.zoomDomain?.y).toBeUndefined();
    });

    it('should update zoomDomain with both x and y ranges', () => {
      const domain = { x: [10, 50] as [number, number], y: [0, 20] as [number, number] };
      useChartInteractionStore.getState().setZoomDomain(domain);

      const state = useChartInteractionStore.getState();
      expect(state.zoomDomain).toEqual(domain);
      expect(state.zoomDomain?.y).toEqual([0, 20]);
    });

    it('should allow setting zoomDomain to null', () => {
      useChartInteractionStore.getState().setZoomDomain({ x: [0, 100] as [number, number] });
      useChartInteractionStore.getState().setZoomDomain(null);

      expect(useChartInteractionStore.getState().zoomDomain).toBeNull();
    });

    it('should overwrite the previous zoomDomain', () => {
      useChartInteractionStore.getState().setZoomDomain({ x: [0, 100] as [number, number] });
      useChartInteractionStore.getState().setZoomDomain({ x: [25, 75] as [number, number] });

      expect(useChartInteractionStore.getState().zoomDomain?.x).toEqual([25, 75]);
    });
  });

  describe('resetZoom', () => {
    it('should set zoomDomain back to null', () => {
      useChartInteractionStore.getState().setZoomDomain({ x: [0, 100] as [number, number] });
      useChartInteractionStore.getState().resetZoom();

      expect(useChartInteractionStore.getState().zoomDomain).toBeNull();
    });

    it('should be safe to call when already null', () => {
      useChartInteractionStore.getState().resetZoom();
      expect(useChartInteractionStore.getState().zoomDomain).toBeNull();
    });
  });

  describe('setBrushSelection', () => {
    it('should update brushSelection with a date range', () => {
      const start = new Date('2025-01-01');
      const end = new Date('2025-01-31');
      useChartInteractionStore.getState().setBrushSelection({ start, end });

      const state = useChartInteractionStore.getState();
      expect(state.brushSelection).toEqual({ start, end });
    });

    it('should allow setting brushSelection to null', () => {
      useChartInteractionStore.getState().setBrushSelection({
        start: new Date('2025-01-01'),
        end: new Date('2025-01-31'),
      });
      useChartInteractionStore.getState().setBrushSelection(null);

      expect(useChartInteractionStore.getState().brushSelection).toBeNull();
    });

    it('should overwrite the previous brushSelection', () => {
      useChartInteractionStore.getState().setBrushSelection({
        start: new Date('2025-01-01'),
        end: new Date('2025-01-31'),
      });
      const newEnd = new Date('2025-02-28');
      useChartInteractionStore.getState().setBrushSelection({
        start: new Date('2025-02-01'),
        end: newEnd,
      });

      expect(useChartInteractionStore.getState().brushSelection?.end).toEqual(newEnd);
    });
  });

  describe('clearBrushSelection', () => {
    it('should set brushSelection back to null', () => {
      useChartInteractionStore.getState().setBrushSelection({
        start: new Date('2025-01-01'),
        end: new Date('2025-01-31'),
      });
      useChartInteractionStore.getState().clearBrushSelection();

      expect(useChartInteractionStore.getState().brushSelection).toBeNull();
    });

    it('should be safe to call when already null', () => {
      useChartInteractionStore.getState().clearBrushSelection();
      expect(useChartInteractionStore.getState().brushSelection).toBeNull();
    });
  });

  describe('setCrosshairPosition', () => {
    it('should update crosshairPosition', () => {
      useChartInteractionStore.getState().setCrosshairPosition({ x: 42 });

      expect(useChartInteractionStore.getState().crosshairPosition).toEqual({ x: 42 });
    });

    it('should allow setting crosshairPosition to null', () => {
      useChartInteractionStore.getState().setCrosshairPosition({ x: 42 });
      useChartInteractionStore.getState().setCrosshairPosition(null);

      expect(useChartInteractionStore.getState().crosshairPosition).toBeNull();
    });

    it('should overwrite the previous crosshairPosition', () => {
      useChartInteractionStore.getState().setCrosshairPosition({ x: 10 });
      useChartInteractionStore.getState().setCrosshairPosition({ x: 99 });

      expect(useChartInteractionStore.getState().crosshairPosition?.x).toBe(99);
    });
  });

  describe('state isolation', () => {
    it('should not affect other state slices when updating one slice', () => {
      // Set all three
      useChartInteractionStore.getState().setZoomDomain({ x: [0, 100] as [number, number] });
      useChartInteractionStore.getState().setBrushSelection({
        start: new Date('2025-01-01'),
        end: new Date('2025-01-31'),
      });
      useChartInteractionStore.getState().setCrosshairPosition({ x: 50 });

      // Reset zoom only
      useChartInteractionStore.getState().resetZoom();

      const state = useChartInteractionStore.getState();
      expect(state.zoomDomain).toBeNull();
      expect(state.brushSelection).not.toBeNull();
      expect(state.crosshairPosition).not.toBeNull();
    });
  });
});
