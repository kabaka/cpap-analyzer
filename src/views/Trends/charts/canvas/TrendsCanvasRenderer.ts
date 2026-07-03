/**
 * Canvas2D draw-primitive engine for the Trends charts.
 *
 * Mirrors the architecture of {@link module:components/charts/canvas/SignalRenderer}
 * (DPR-aware sizing, a per-frame CSS-var colour cache, an optional transparent
 * overlay canvas for cheap crosshair repaints) but exposes a set of CHART
 * PRIMITIVES — monotone/step lines, filled bands between two series, bars,
 * stacked areas, reference zones, reference lines with labels, diagonal hatch
 * fills, the dashed grid, and Y/X ticks — that the per-chart React components
 * compose. The drawing maths come from the pure {@link
 * module:views/Trends/charts/canvas/scale} and {@link
 * module:views/Trends/charts/canvas/curve} helpers so the geometry is identical
 * to the Recharts output it replaces.
 *
 * Colours are passed in as RESOLVED strings (the component reads them from
 * {@link useChartColors}); the renderer never calls `getComputedStyle` itself,
 * matching the "resolve upstream" contract used across the chart layer. The
 * renderer is a pure TypeScript class with no React dependency.
 *
 * @module views/Trends/charts/canvas/TrendsCanvasRenderer
 */

import { bandLeft, bandWidth, niceYTicks, pointX, valueY as scaleValueY } from './scale';
import { monotonePath, stepAfterPath, type CurvePoint } from './curve';

/** Inner plot rectangle in CSS px (inside the chart's margins/axis gutter). */
export interface PlotRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A linear Y domain `[min, max]` for value→pixel mapping. */
export interface YDomain {
  readonly min: number;
  readonly max: number;
}

/** Dashed-grid styling matching the SVG `strokeDasharray="3 3"` horizontal grid. */
const GRID_DASH: readonly number[] = [3, 3];
const GRID_LINE_WIDTH = 1;
const AXIS_FONT_SIZE = 11;
const TICK_LABEL_FONT_SIZE = 10;

/**
 * Canvas2D engine for one Trends chart. Construct against the base canvas; attach
 * a transparent overlay via {@link setOverlayCanvas} for crosshair-only repaints.
 */
export class TrendsCanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  /**
   * Base 2D context, or `null` when the platform provides no 2D canvas (e.g. the
   * jsdom test environment, or a browser with canvas disabled). The renderer
   * FAILS SOFT in that case: construction never throws, sizing/draw calls no-op,
   * and the chart's HTML chrome (figure/title/footnote/SR table/legend/prompt)
   * still renders. Mirrors {@link SignalRenderer.setOverlayCanvas}'s fail-soft.
   */
  private readonly ctx: CanvasRenderingContext2D | null;
  private dpr: number;
  private logicalWidth = 0;
  private logicalHeight = 0;

  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  /** The context currently being drawn into (base or overlay), or null. */
  private activeCtx: CanvasRenderingContext2D | null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.activeCtx = this.ctx;
    this.dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  }

  /** Whether a usable 2D context is available. */
  get supported(): boolean {
    return this.ctx !== null;
  }

  /** Resize the base (and overlay) canvas, honouring `devicePixelRatio`. */
  resize(width: number, height: number): void {
    this.dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.logicalWidth = width;
    this.logicalHeight = height;

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.overlayCanvas && this.overlayCtx) {
      this.overlayCanvas.width = Math.round(width * this.dpr);
      this.overlayCanvas.height = Math.round(height * this.dpr);
      this.overlayCanvas.style.width = `${width}px`;
      this.overlayCanvas.style.height = `${height}px`;
      this.overlayCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  /** Attach (or detach with `null`) the transparent crosshair overlay canvas. */
  setOverlayCanvas(canvas: HTMLCanvasElement | null): void {
    if (!canvas) {
      this.overlayCanvas = null;
      this.overlayCtx = null;
      return;
    }
    const octx = canvas.getContext('2d', { alpha: true });
    if (!octx) {
      this.overlayCanvas = null;
      this.overlayCtx = null;
      return;
    }
    this.overlayCanvas = canvas;
    this.overlayCtx = octx;
    if (this.logicalWidth > 0 && this.logicalHeight > 0) {
      canvas.width = Math.round(this.logicalWidth * this.dpr);
      canvas.height = Math.round(this.logicalHeight * this.dpr);
      canvas.style.width = `${this.logicalWidth}px`;
      canvas.style.height = `${this.logicalHeight}px`;
      octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  get width(): number {
    return this.logicalWidth;
  }
  get height(): number {
    return this.logicalHeight;
  }

  // ── Frame lifecycle ────────────────────────────────────────────

  /**
   * Clear the base canvas to the surface colour. Call at the top of a base draw.
   * (alpha:false canvases must be painted opaque, so we fill rather than clear.)
   */
  beginBase(surfaceColor: string): void {
    this.activeCtx = this.ctx;
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.logicalWidth <= 0 || this.logicalHeight <= 0) return;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
  }

  /** Clear the transparent overlay and point subsequent draws at it. */
  beginOverlay(): boolean {
    const octx = this.overlayCtx;
    if (!octx) return false;
    if (this.logicalWidth <= 0 || this.logicalHeight <= 0) return false;
    octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    octx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    octx.setLineDash([]);
    octx.globalAlpha = 1;
    this.activeCtx = octx;
    return true;
  }

  /** Restore the active context to the base after an overlay pass. */
  endOverlay(): void {
    this.activeCtx = this.ctx;
  }

  hasOverlay(): boolean {
    return this.overlayCtx !== null;
  }

  // ── Coordinate helpers (delegate to pure scale.ts) ─────────────

  /** Categorical point X for a non-bar (scalePoint) axis. */
  pointX(i: number, count: number, plot: PlotRect): number {
    return pointX(i, count, plot.left, plot.width);
  }

  /** Band left edge for a bar (scaleBand) axis. */
  bandLeft(i: number, count: number, plot: PlotRect): number {
    return bandLeft(i, count, plot.left, plot.width);
  }

  bandWidth(count: number, plot: PlotRect): number {
    return bandWidth(count, plot.width);
  }

  /** Value → Y px within the plot for a linear Y domain. */
  valueY(value: number, domain: YDomain, plot: PlotRect): number {
    return scaleValueY(value, domain.min, domain.max, plot.top, plot.height);
  }

  // ── Grid + axes ────────────────────────────────────────────────

  /**
   * Horizontal dashed grid at the nice Y ticks (matches `CartesianGrid
   * strokeDasharray="3 3" vertical={false}`). Returns the tick values so the
   * caller can reuse them for the axis labels.
   */
  drawHorizontalGrid(domain: YDomain, plot: PlotRect, gridColor: string): number[] {
    const ticks = this.computeYTicks(domain, plot);
    const ctx = this.activeCtx;
    if (!ctx) return ticks;
    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = GRID_LINE_WIDTH;
    ctx.setLineDash(GRID_DASH);
    for (const v of ticks) {
      const y = this.valueY(v, domain, plot);
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
    }
    ctx.restore();
    return ticks;
  }

  /** Nice Y ticks for the domain at ~40px spacing (Recharts-like density). */
  computeYTicks(domain: YDomain, plot: PlotRect): number[] {
    const maxTicks = Math.max(2, Math.floor(plot.height / 40));
    return niceYTicks(domain.min, domain.max, maxTicks);
  }

  /**
   * Right-oriented Y axis labels (the Trends default `orientation="right"`):
   * tick text is left-aligned just OUTSIDE the right plot edge.
   */
  drawYAxisRight(
    domain: YDomain,
    plot: PlotRect,
    axisColor: string,
    fontFamily: string,
    ticks?: number[],
  ): void {
    const values = ticks ?? this.computeYTicks(domain, plot);
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = axisColor;
    ctx.font = `${AXIS_FONT_SIZE}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const v of values) {
      const y = this.valueY(v, domain, plot);
      ctx.fillText(this.formatTick(v), plot.left + plot.width + 4, y);
    }
    ctx.restore();
  }

  /** Left-oriented Y axis labels (Settings chart's secondary EPR axis). */
  drawYAxisLeft(
    domain: YDomain,
    plot: PlotRect,
    axisColor: string,
    fontFamily: string,
    ticks?: number[],
  ): void {
    const values = ticks ?? this.computeYTicks(domain, plot);
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = axisColor;
    ctx.font = `${AXIS_FONT_SIZE}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const v of values) {
      const y = this.valueY(v, domain, plot);
      ctx.fillText(this.formatTick(v), plot.left - 4, y);
    }
    ctx.restore();
  }

  private formatTick(v: number): string {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  // ── Lines ──────────────────────────────────────────────────────

  /**
   * Stroke a monotone-cubic line (`type="monotone"`). `points` are plot-space
   * pixels; `null` entries are gaps (Recharts `connectNulls={false}`). Set
   * `connectNulls` true to bridge gaps (the rolling-median series). `dash` is an
   * optional `setLineDash` pattern.
   */
  drawMonotoneLine(
    points: readonly CurvePoint[],
    style: { color: string; width: number; opacity?: number; dash?: readonly number[] },
    plot: PlotRect,
    connectNulls = false,
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    this.clipPlot(plot);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(style.dash ? (style.dash as number[]) : []);
    ctx.beginPath();
    monotonePath(ctx, points, connectNulls);
    ctx.stroke();
    ctx.restore();
  }

  /** Stroke a `stepAfter` line (Settings chart). */
  drawStepAfterLine(
    points: readonly CurvePoint[],
    style: { color: string; width: number; dash?: readonly number[] },
    plot: PlotRect,
    connectNulls = true,
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    this.clipPlot(plot);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.setLineDash(style.dash ? (style.dash as number[]) : []);
    ctx.beginPath();
    stepAfterPath(ctx, points, connectNulls);
    ctx.stroke();
    ctx.restore();
  }

  // ── Filled areas & bands ───────────────────────────────────────

  /**
   * Fill a monotone area between an upper boundary polyline and a baseline Y
   * (Recharts `<Area>` from the series down to its base). `upper` are plot-space
   * points with `null` gaps; each contiguous run is closed down to `baseY`.
   * Optionally stroke the top edge (e.g. the band's dashed edge).
   */
  drawMonotoneArea(
    upper: readonly CurvePoint[],
    baseY: number,
    fill: { color: string; opacity: number },
    plot: PlotRect,
    edge?: { color: string; width: number; dash?: readonly number[] },
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    this.clipPlot(plot);
    for (const run of contiguousRuns(upper)) {
      if (run.length === 0) continue;
      ctx.beginPath();
      monotonePath(ctx, run, false);
      // Close down to baseline and back.
      const last = run[run.length - 1];
      const first = run[0];
      if (last && first) {
        ctx.lineTo(last.x, baseY);
        ctx.lineTo(first.x, baseY);
        ctx.closePath();
      }
      ctx.globalAlpha = fill.opacity;
      ctx.fillStyle = fill.color;
      ctx.fill();
      if (edge) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = edge.color;
        ctx.lineWidth = edge.width;
        ctx.setLineDash(edge.dash ? (edge.dash as number[]) : []);
        ctx.beginPath();
        monotonePath(ctx, run, false);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  /**
   * Fill the band BETWEEN two monotone boundary polylines (`lower` and `upper`),
   * with an optional dashed edge stroked along BOTH boundaries. Used for the
   * AHI [P25,P75] floating band: a closed path tracing `upper` left→right then
   * `lower` right→left, per contiguous run. Both boundary arrays must align index
   * for index; a `null` in either marks a shared gap.
   */
  drawBandBetween(
    lower: readonly CurvePoint[],
    upper: readonly CurvePoint[],
    fill: { color: string; opacity: number },
    plot: PlotRect,
    edge?: { color: string; width: number; dash?: readonly number[] },
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    this.clipPlot(plot);
    const n = Math.min(lower.length, upper.length);
    let runStart = -1;
    const flush = (start: number, endExcl: number): void => {
      if (start < 0 || endExcl <= start) return;
      const up = upper.slice(start, endExcl) as CurvePoint[];
      const lo = lower.slice(start, endExcl) as CurvePoint[];
      ctx.beginPath();
      monotonePath(ctx, up, false);
      // Trace lower boundary right→left to close the band.
      const loReversed = [...lo].reverse();
      // Continue the same path: lineTo the first reversed lower point, then curve.
      const firstLo = loReversed[0];
      if (firstLo) ctx.lineTo(firstLo.x, firstLo.y);
      monotoneInto(ctx, loReversed);
      ctx.closePath();
      ctx.globalAlpha = fill.opacity;
      ctx.fillStyle = fill.color;
      ctx.fill();
      if (edge) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = edge.color;
        ctx.lineWidth = edge.width;
        ctx.setLineDash(edge.dash ? (edge.dash as number[]) : []);
        ctx.beginPath();
        monotonePath(ctx, up, false);
        ctx.stroke();
        ctx.beginPath();
        monotonePath(ctx, lo, false);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    for (let i = 0; i < n; i++) {
      const gap = upper[i] === null || lower[i] === null;
      if (gap) {
        if (runStart >= 0) {
          flush(runStart, i);
          runStart = -1;
        }
      } else if (runStart < 0) {
        runStart = i;
      }
    }
    if (runStart >= 0) flush(runStart, n);
    ctx.restore();
  }

  /**
   * Fill a per-pixel-column MIN/MAX envelope as a stroked+filled band — the AHI
   * raw-series honesty path. `min`/`max` are physical values per column (NaN =
   * gap); columns map left→right across the plot at column centres. Drawn at the
   * given colour/opacity/width to read like the faint raw line it replaces.
   */
  drawColumnEnvelope(
    env: { min: Float32Array; max: Float32Array; columns: number },
    domain: YDomain,
    style: { color: string; width: number; opacity: number },
    plot: PlotRect,
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    const cols = env.columns;
    if (cols <= 0) return;
    const colW = plot.width / cols;
    const yOf = (v: number): number => this.valueY(v, domain, plot);
    ctx.save();
    this.clipPlot(plot);
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = style.opacity;

    let runStart = -1;
    const flush = (start: number, endExcl: number): void => {
      if (start < 0 || endExcl <= start) return;
      ctx.beginPath();
      for (let c = start; c < endExcl; c++) {
        const x = plot.left + (c + 0.5) * colW;
        const y = yOf(env.max[c] as number);
        if (c === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let c = endExcl - 1; c >= start; c--) {
        const x = plot.left + (c + 0.5) * colW;
        ctx.lineTo(x, yOf(env.min[c] as number));
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    for (let c = 0; c < cols; c++) {
      const isGap = Number.isNaN(env.min[c] as number) || Number.isNaN(env.max[c] as number);
      if (isGap) {
        if (runStart >= 0) {
          flush(runStart, c);
          runStart = -1;
        }
      } else if (runStart < 0) {
        runStart = c;
      }
    }
    if (runStart >= 0) flush(runStart, cols);
    ctx.restore();
  }

  /**
   * Fill a stacked-area band between an `upper` and `lower` monotone boundary
   * (both fully populated, no gaps — stacked event counts are always present),
   * at a flat fill colour/opacity. Used by the EventBreakdown solid series.
   * The path traces `upper` left→right then `lower` right→left and fills it.
   */
  drawStackedBand(
    upper: readonly CurvePoint[],
    lower: readonly CurvePoint[],
    fill: { color: string; opacity: number },
    plot: PlotRect,
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    if (upper.length === 0) return;
    ctx.save();
    this.clipPlot(plot);
    ctx.beginPath();
    monotonePath(ctx, upper, false);
    const loRev = [...lower].reverse();
    const first = loRev[0];
    if (first) ctx.lineTo(first.x, first.y);
    monotoneInto(ctx, loRev);
    ctx.closePath();
    ctx.globalAlpha = fill.opacity;
    ctx.fillStyle = fill.color;
    ctx.fill();
    ctx.restore();
  }

  // ── Bars ───────────────────────────────────────────────────────

  /**
   * Fill a single bar rectangle with a rounded TOP (radius [r,r,0,0]) matching
   * Recharts `<Bar radius={[2,2,0,0]}>`. `x`/`width` come from
   * {@link module:views/Trends/charts/canvas/scale}.singleBarGeometry; the bar
   * rises from the baseline `baseY` up to `topY`.
   */
  drawBar(
    x: number,
    width: number,
    topY: number,
    baseY: number,
    color: string,
    radius: number,
    plot: PlotRect,
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    const h = baseY - topY;
    if (h <= 0 || width <= 0) return;
    const r = Math.max(0, Math.min(radius, width / 2, h));
    ctx.save();
    this.clipPlot(plot);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, topY + r);
    ctx.arcTo(x, topY, x + r, topY, r);
    ctx.lineTo(x + width - r, topY);
    ctx.arcTo(x + width, topY, x + width, topY + r, r);
    ctx.lineTo(x + width, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── Reference zones & lines ────────────────────────────────────

  /**
   * Fill a horizontal reference zone (`<ReferenceArea y1 y2>`): a full-plot-width
   * band between two Y values at a given fill opacity.
   */
  drawReferenceZone(
    y1: number,
    y2: number,
    domain: YDomain,
    plot: PlotRect,
    color: string,
    opacity: number,
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    const yA = this.valueY(Math.min(y1, y2), domain, plot);
    const yB = this.valueY(Math.max(y1, y2), domain, plot);
    const top = Math.min(yA, yB);
    const bottom = Math.max(yA, yB);
    // Clamp to plot.
    const clampedTop = Math.max(plot.top, top);
    const clampedBottom = Math.min(plot.top + plot.height, bottom);
    if (clampedBottom <= clampedTop) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.fillRect(plot.left, clampedTop, plot.width, clampedBottom - clampedTop);
    ctx.restore();
  }

  /**
   * Draw a horizontal reference line (`<ReferenceLine y>`) at a Y value, with an
   * optional right-anchored text label (`position="right"`).
   */
  drawHorizontalReferenceLine(
    value: number,
    domain: YDomain,
    plot: PlotRect,
    style: { color: string; dash?: readonly number[]; opacity?: number },
    label?: { text: string; color: string; fontFamily: string },
  ): void {
    const y = this.valueY(value, domain, plot);
    if (y < plot.top || y > plot.top + plot.height) return;
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.setLineDash(style.dash ? (style.dash as number[]) : []);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
    ctx.stroke();
    if (label) {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.fillStyle = label.color;
      ctx.font = `${TICK_LABEL_FONT_SIZE}px ${label.fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText(label.text, plot.left + plot.width - 2, y);
    }
    ctx.restore();
  }

  /**
   * Draw a vertical reference line at an X coordinate (the synced crosshair and
   * settings-change markers). `dash`/`opacity` distinguish the two uses.
   */
  drawVerticalReferenceLine(
    x: number,
    plot: PlotRect,
    style: { color: string; dash?: readonly number[]; opacity?: number },
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.setLineDash(style.dash ? (style.dash as number[]) : []);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.top + plot.height);
    ctx.stroke();
    ctx.restore();
  }

  // ── Hatch fills ────────────────────────────────────────────────

  /**
   * Fill a region with a 45° diagonal hatch (EventBreakdown's "modeled" series).
   * Reproduces the SVG `<pattern>`: a translucent base fill at `baseOpacity`,
   * then diagonal strokes at `period` px, `strokeWidth`, `rotate(45)`. The region
   * is supplied as a closed path callback so it follows the stacked-area shape.
   */
  fillHatchedRegion(
    buildPath: (ctx: CanvasRenderingContext2D) => void,
    plot: PlotRect,
    base: { color: string; opacity: number },
    strokes: { color: string; width: number; period: number },
  ): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    // Clip to the region itself, then to the plot.
    ctx.beginPath();
    buildPath(ctx);
    ctx.clip();
    this.clipPlotPath(plot);
    // Base translucent fill.
    ctx.globalAlpha = base.opacity;
    ctx.fillStyle = base.color;
    ctx.fillRect(plot.left, plot.top, plot.width, plot.height);
    // Diagonal strokes (rotate 45°): lines of slope 1 across the plot bounds.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = strokes.color;
    ctx.lineWidth = strokes.width;
    ctx.setLineDash([]);
    ctx.beginPath();
    const x0 = plot.left;
    const y0 = plot.top;
    const w = plot.width;
    const h = plot.height;
    for (let d = -h; d < w + h; d += strokes.period) {
      ctx.moveTo(x0 + d, y0);
      ctx.lineTo(x0 + d + h, y0 + h);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Active dots (crosshair overlay) ────────────────────────────

  /** Draw a filled active-dot circle (Recharts `activeDot={{ r }}`). */
  drawActiveDot(x: number, y: number, radius: number, color: string): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Internals ──────────────────────────────────────────────────

  /** Clip to the plot rect (save() must be active; restored by the caller). */
  private clipPlot(plot: PlotRect): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.width, plot.height);
    ctx.clip();
  }

  /** Intersect the existing clip with the plot rect (no save/restore here). */
  private clipPlotPath(plot: PlotRect): void {
    const ctx = this.activeCtx;
    if (!ctx) return;
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.width, plot.height);
    ctx.clip();
  }
}

// ── Pure helpers ─────────────────────────────────────────────────

/** Split a point array into contiguous non-null runs. */
function contiguousRuns(points: readonly CurvePoint[]): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p === null) {
      if (cur.length > 0) runs.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/**
 * Append a monotone curve to an ALREADY-OPEN path WITHOUT an initial `moveTo`
 * (the caller has already issued a `lineTo` to the first point), used to trace
 * the lower boundary of a band while keeping a single closed subpath.
 */
function monotoneInto(ctx: CanvasRenderingContext2D, pts: readonly CurvePoint[]): void {
  // A temporary sink that swallows the initial moveTo (the caller has already
  // issued a lineTo to the first point), so the lower boundary continues the
  // same closed subpath instead of starting a new one.
  const sink = {
    moveTo: (): void => {
      /* swallowed: position already set by the caller's lineTo */
    },
    lineTo: (x: number, y: number): void => {
      ctx.lineTo(x, y);
    },
    bezierCurveTo: (a: number, b: number, c: number, d: number, e: number, f: number): void => {
      ctx.bezierCurveTo(a, b, c, d, e, f);
    },
  };
  monotonePath(sink, pts, false);
}
