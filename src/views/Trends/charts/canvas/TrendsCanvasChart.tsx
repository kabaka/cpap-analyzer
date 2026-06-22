/**
 * Reusable Canvas2D chart shell for the Trends view.
 *
 * Wires a base canvas (series/grid/axes) and a transparent overlay canvas
 * (synced crosshair + active dots) via callback refs, exactly like the Signal
 * Viewer. It owns:
 *
 * - A {@link TrendsCanvasRenderer} per mount, resized on a coalesced
 *   ResizeObserver so the canvas matches its container width and the fixed chart
 *   height (DPR-aware).
 * - Theme reactivity: a `redraw` runs on mount, resize, data identity, and theme
 *   change (the chart passes resolved colours in via the draw callbacks).
 * - Synced-crosshair registration: it registers an overlay-repaint callback with
 *   {@link useSyncedChart} so a hover on ANY chart repaints THIS chart's
 *   crosshair without a React re-render.
 * - Pointer hover → category hit-test → `setActive(date, index)` and click →
 *   `onDataPointClick(date)`, matching the Recharts mouse semantics the charts
 *   relied on.
 *
 * The chart-specific drawing lives in the `drawBase` / `drawOverlay` callbacks
 * the caller supplies; this shell knows nothing about a particular chart's marks.
 * All accessible chrome (figure/title/footnote/SR table/legend/prompt) stays in
 * the calling component as retained HTML over the canvas.
 *
 * @module views/Trends/charts/canvas/TrendsCanvasChart
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { TrendsCanvasRenderer, type PlotRect } from './TrendsCanvasRenderer';
import { indexAtX } from './scale';
import { useSyncedChart } from '../../context/SyncedChartContext';

/** Margins around the inner plot, replicating the Recharts chart `margin` +
 *  right-oriented Y-axis gutter (`width={40}`) the Trends charts use. */
export interface ChartMargins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Context handed to the chart's draw callbacks each frame. */
export interface DrawContext {
  readonly renderer: TrendsCanvasRenderer;
  readonly plot: PlotRect;
  /** Number of categories (nights). */
  readonly count: number;
  /** Resolved font-family for canvas text (matches the app body font). */
  readonly fontFamily: string;
}

export interface TrendsCanvasChartProps {
  /** Category count (nights) — drives layout + hit-testing. */
  count: number;
  /** Identity key that changes when the underlying data changes (forces redraw). */
  dataKey: unknown;
  /** Fixed chart height in CSS px (the inner plot area height incl. margins). */
  height: number;
  /** Inner margins + axis gutter. */
  margins: ChartMargins;
  /** True for the bar chart (scaleBand hit-testing); false for point scales. */
  isBand?: boolean;
  /** Draw the base layer (series, grid, axes, zones, reference lines). */
  drawBase: (ctx: DrawContext) => void;
  /** Draw the overlay layer (crosshair + active dots) for an active index. */
  drawOverlay: (ctx: DrawContext, activeIndex: number | null) => void;
  /** Resolve the ISO date string for a category index (for hover/click). */
  dateAtIndex: (index: number) => string | undefined;
  /** Navigate-to-detail on click. */
  onDataPointClick?: (date: string) => void;
  /** Accessible label for the interactive canvas surface. */
  ariaLabel: string;
}

/**
 * Compute the inner plot rect from the canvas size and margins. The right-
 * oriented Y axis labels live in `margins.right`; the plot starts at
 * `margins.left`.
 */
function computePlot(width: number, height: number, m: ChartMargins): PlotRect {
  return {
    left: m.left,
    top: m.top,
    width: Math.max(0, width - m.left - m.right),
    height: Math.max(0, height - m.top - m.bottom),
  };
}

export default function TrendsCanvasChart({
  count,
  dataKey,
  height,
  margins,
  isBand = false,
  drawBase,
  drawOverlay,
  dateAtIndex,
  onDataPointClick,
  ariaLabel,
}: TrendsCanvasChartProps) {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const { setActive, clear, registerOverlay } = useSyncedChart();

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<TrendsCanvasRenderer | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number | null>(null);
  const widthRef = useRef(0);

  // Latest draw callbacks (kept in refs so the imperative paths never go stale
  // without forcing the renderer/observer to be torn down).
  const drawBaseRef = useRef(drawBase);
  const drawOverlayRef = useRef(drawOverlay);
  drawBaseRef.current = drawBase;
  drawOverlayRef.current = drawOverlay;

  const fontFamily = useMemo(() => {
    if (typeof document === 'undefined') return 'sans-serif';
    const f = getComputedStyle(document.body).fontFamily;
    return f && f.trim() ? f : 'sans-serif';
    // Re-resolve on theme change (custom themes may swap fonts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  const drawCtx = useCallback((): DrawContext | null => {
    const renderer = rendererRef.current;
    if (!renderer || renderer.width <= 0 || renderer.height <= 0) return null;
    const plot = computePlot(renderer.width, renderer.height, margins);
    return { renderer, plot, count, fontFamily };
  }, [margins, count, fontFamily]);

  /** Repaint the base layer (series). */
  const paintBase = useCallback(() => {
    const ctx = drawCtx();
    if (!ctx) return;
    drawBaseRef.current(ctx);
  }, [drawCtx]);

  /** Repaint only the overlay crosshair for a given active index. */
  const paintOverlay = useCallback(
    (activeIndex: number | null) => {
      const renderer = rendererRef.current;
      const ctx = drawCtx();
      if (!renderer || !ctx) return;
      if (!renderer.beginOverlay()) return;
      drawOverlayRef.current(ctx, activeIndex);
      renderer.endOverlay();
    },
    [drawCtx],
  );

  /** Full repaint (base + current crosshair). Coalesced to one rAF. */
  const scheduleRedraw = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paintBase();
      // Re-stamp the crosshair from the shared ref after a base repaint.
      const ai = activeIndexFromContext.current;
      paintOverlay(ai());
    });
  }, [paintBase, paintOverlay]);

  // Hold a stable getter for the shared active index without re-subscribing.
  const sync = useSyncedChart();
  const activeIndexFromContext = useRef(() => sync.activeIndexRef.current ?? null);
  activeIndexFromContext.current = () => sync.activeIndexRef.current ?? null;

  // Register the overlay-repaint callback so other charts' hovers repaint us.
  useEffect(() => {
    const unregister = registerOverlay((idx) => paintOverlay(idx));
    return unregister;
  }, [registerOverlay, paintOverlay]);

  // Construct the renderer + observe size via callback refs.
  const baseCallbackRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      baseCanvasRef.current = canvas;
      if (!canvas) {
        if (observerRef.current) {
          observerRef.current.disconnect();
          observerRef.current = null;
        }
        rendererRef.current = null;
        return;
      }
      const renderer = new TrendsCanvasRenderer(canvas);
      rendererRef.current = renderer;
      if (overlayCanvasRef.current) renderer.setOverlayCanvas(overlayCanvasRef.current);

      const wrapper = wrapperRef.current ?? canvas.parentElement;
      if (wrapper && !observerRef.current) {
        let pending: number | null = null;
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) widthRef.current = entry.contentRect.width;
          if (pending !== null) return;
          pending = requestAnimationFrame(() => {
            pending = null;
            const w = widthRef.current;
            if (w > 0) {
              renderer.resize(w, height);
              scheduleRedraw();
            }
          });
        });
        observer.observe(wrapper);
        observerRef.current = observer;
        const rect = wrapper.getBoundingClientRect();
        if (rect.width > 0) {
          widthRef.current = rect.width;
          renderer.resize(rect.width, height);
          scheduleRedraw();
        }
      }
    },
    [height, scheduleRedraw],
  );

  const overlayCallbackRef = useCallback((canvas: HTMLCanvasElement | null) => {
    overlayCanvasRef.current = canvas;
    const renderer = rendererRef.current;
    if (renderer) renderer.setOverlayCanvas(canvas);
  }, []);

  // Redraw on data identity, theme, height, count, margins change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer && widthRef.current > 0) renderer.resize(widthRef.current, height);
    scheduleRedraw();
  }, [dataKey, resolvedTheme, height, count, scheduleRedraw]);

  // Teardown.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      rendererRef.current = null;
    };
  }, []);

  // ── Pointer interaction (hover → setActive, click → navigate) ──

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      if (!renderer || count === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const plot = computePlot(renderer.width, renderer.height, margins);
      const idx = indexAtX(x, count, plot.left, plot.width, isBand);
      if (idx === null) return;
      const date = dateAtIndex(idx);
      if (date) setActive(date, idx);
    },
    [count, margins, isBand, dateAtIndex, setActive],
  );

  const handlePointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const renderer = rendererRef.current;
      if (!renderer || count === 0 || !onDataPointClick) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const plot = computePlot(renderer.width, renderer.height, margins);
      const idx = indexAtX(x, count, plot.left, plot.width, isBand);
      if (idx === null) return;
      const date = dateAtIndex(idx);
      if (date) onDataPointClick(date);
    },
    [count, margins, isBand, dateAtIndex, onDataPointClick],
  );

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', width: '100%', height }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
      role="presentation"
      aria-label={ariaLabel}
    >
      <canvas
        ref={baseCallbackRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        aria-hidden="true"
      />
      <canvas
        ref={overlayCallbackRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />
    </div>
  );
}
