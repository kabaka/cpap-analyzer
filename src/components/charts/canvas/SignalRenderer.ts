/**
 * Canvas 2D rendering engine for high-frequency CPAP signal waveforms.
 *
 * Renders multi-channel time-series data (Flow, MaskPressure, Leak, SpO₂)
 * as stacked waveform strips with DPI-aware rendering, crosshair overlays,
 * event markers, and grid/axis labelling.
 *
 * This is a **pure TypeScript class** — no React dependency. It operates
 * directly on an HTMLCanvasElement and is designed to be called from
 * `requestAnimationFrame` for smooth 60 fps rendering.
 *
 * @module components/charts/canvas/SignalRenderer
 */

// ── Public interfaces ────────────────────────────────────────────

/** One signal channel to render. */
export interface SignalChannel {
  /** Display name (e.g. "Flow", "MaskPress"). */
  readonly name: string;
  /** Sample data — may already be downsampled to viewport resolution. */
  readonly data: Float32Array;
  /** Effective sample rate in Hz of the provided data. */
  readonly sampleRate: number;
  /** Physical unit label (e.g. "L/min", "cmH2O"). */
  readonly unit: string;
  /** CSS colour string (resolved value, not a var() reference). */
  readonly color: string;
  /** Physical minimum for Y-axis scaling. */
  readonly physicalMin: number;
  /** Physical maximum for Y-axis scaling. */
  readonly physicalMax: number;
}

/** Current viewport time range and channel data to render. */
export interface ViewportState {
  /** Start time in ms offset from signal start. */
  readonly startTime: number;
  /** End time in ms offset from signal start. */
  readonly endTime: number;
  /** Channels in rendering order (top to bottom). */
  readonly channels: readonly SignalChannel[];
}

/** A therapy event marker drawn as a coloured overlay rectangle. */
export interface EventMarker {
  /** Start time in ms offset from signal start. */
  readonly startTime: number;
  /** Duration in ms. */
  readonly duration: number;
  /** Event type label (e.g. "ObstructiveApnea"). */
  readonly type: string;
  /** CSS colour string (resolved). */
  readonly color: string;
}

/** Options controlling visual overlays and layout. */
export interface RenderOptions {
  /** Whether to draw the crosshair overlay. */
  readonly showCrosshair: boolean;
  /** Canvas X coordinate of the crosshair, or `null` when hidden. */
  readonly crosshairX: number | null;
  /** Whether to draw grid lines. */
  readonly showGrid: boolean;
  /** Event markers to render as semi-transparent rectangles. */
  readonly eventMarkers: readonly EventMarker[];
  /** Pixel height per channel strip. */
  readonly channelHeight: number;
  /** Padding around the plot area. */
  readonly padding: Readonly<{
    top: number;
    right: number;
    bottom: number;
    left: number;
  }>;
}

/** Result from a positional value lookup. */
export interface ValueAtPosition {
  /** Channel name. */
  readonly channel: string;
  /** Physical value at the cursor position. */
  readonly value: number;
  /** Time in ms offset from signal start. */
  readonly time: number;
}

// ── Internal constants ───────────────────────────────────────────

/** Minimum pixels between grid/label tick marks. */
const MIN_TICK_SPACING_PX = 80;

/** Crosshair + readout styling. */
const CROSSHAIR_COLOR = 'rgba(120, 120, 120, 0.6)';
const READOUT_FONT_SIZE = 11;
const READOUT_BG = 'rgba(0, 0, 0, 0.75)';
const READOUT_FG = '#ffffff';

/** Grid styling. */
const GRID_DASH = [4, 4];
const GRID_LINE_WIDTH = 0.5;

/** Channel label styling. */
const CHANNEL_LABEL_FONT_SIZE = 12;
const AXIS_FONT_SIZE = 10;

// ── Helpers ──────────────────────────────────────────────────────

/** Format a millisecond offset as HH:MM:SS or MM:SS depending on magnitude. */
export function formatTimeLabel(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Choose a "nice" tick interval for a given visible range and available pixel width.
 * Returns the interval in milliseconds.
 */
export function chooseTimeTickInterval(rangeMs: number, availablePx: number): number {
  const maxTicks = Math.max(2, Math.floor(availablePx / MIN_TICK_SPACING_PX));
  const rawInterval = rangeMs / maxTicks;

  // Snap to nice intervals (seconds, then minutes, then hours)
  const niceIntervals = [
    1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
    1_800_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000,
  ];

  for (const interval of niceIntervals) {
    if (interval >= rawInterval) return interval;
  }
  return niceIntervals[niceIntervals.length - 1] ?? 28_800_000;
}

/**
 * Choose nice Y-axis tick values for a physical range.
 * Returns an array of physical values at which to draw ticks.
 */
export function chooseYTicks(physMin: number, physMax: number, maxTicks: number): number[] {
  const range = physMax - physMin;
  if (range <= 0 || maxTicks < 2) return [physMin, physMax];

  const rawStep = range / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 5, 10];

  let step = magnitude;
  for (const n of niceSteps) {
    if (n * magnitude >= rawStep) {
      step = n * magnitude;
      break;
    }
  }

  const ticks: number[] = [];
  const start = Math.ceil(physMin / step) * step;
  for (let v = start; v <= physMax; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6); // avoid float drift
  }
  return ticks;
}

// ── SignalRenderer ────────────────────────────────────────────────

/**
 * High-performance Canvas 2D renderer for multi-channel CPAP signal waveforms.
 *
 * Create one instance per canvas element. Call {@link render} on each
 * animation frame (or when viewport/data changes). Call {@link dispose}
 * when unmounting.
 */
export class SignalRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private pendingFrame: number | null = null;
  private logicalWidth = 0;
  private logicalHeight = 0;
  private cachedStyle: CSSStyleDeclaration | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Failed to obtain Canvas 2D context');
    }
    this.ctx = ctx;
    this.dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Resize the canvas to match its container, accounting for `devicePixelRatio`.
   *
   * Call whenever the container size changes (e.g. from a ResizeObserver).
   */
  resize(width: number, height: number): void {
    this.dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.logicalWidth = width;
    this.logicalHeight = height;

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Cache computed style so resolveCSSVar avoids repeated getComputedStyle calls.
    this.cachedStyle = getComputedStyle(this.canvas);
  }

  /**
   * Render all channels with the current viewport and options.
   *
   * Internally schedules via `requestAnimationFrame` to coalesce
   * multiple calls per frame.
   */
  render(viewport: ViewportState, options: RenderOptions): void {
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame);
    }
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.renderImmediate(viewport, options);
    });
  }

  /**
   * Get the time value (ms offset from signal start) at a given canvas X coordinate.
   */
  getTimeAtX(x: number, viewport: ViewportState, options: RenderOptions): number {
    const plotLeft = options.padding.left;
    const plotWidth = this.logicalWidth - options.padding.left - options.padding.right;
    if (plotWidth <= 0) return viewport.startTime;

    const t = (x - plotLeft) / plotWidth;
    return viewport.startTime + t * (viewport.endTime - viewport.startTime);
  }

  /**
   * Get the channel name, physical value, and time at a given canvas position.
   * Returns `null` if the position is outside any channel strip.
   */
  getValueAtPosition(
    x: number,
    y: number,
    viewport: ViewportState,
    options: RenderOptions,
  ): ValueAtPosition | null {
    const { padding, channelHeight } = options;
    const plotWidth = this.logicalWidth - padding.left - padding.right;
    if (plotWidth <= 0) return null;

    const time = this.getTimeAtX(x, viewport, options);
    if (time < viewport.startTime || time > viewport.endTime) return null;

    for (let i = 0; i < viewport.channels.length; i++) {
      const ch = viewport.channels[i];
      if (!ch) continue;
      const stripTop = padding.top + i * channelHeight;
      const stripBottom = stripTop + channelHeight;

      if (y >= stripTop && y <= stripBottom) {
        // Map Y to physical value (top = physicalMax, bottom = physicalMin)
        const innerTop = stripTop + 4; // label space
        const innerBottom = stripBottom - 4;
        const tY = 1 - (y - innerTop) / (innerBottom - innerTop);
        const value = ch.physicalMin + tY * (ch.physicalMax - ch.physicalMin);

        return { channel: ch.name, value, time };
      }
    }

    return null;
  }

  /**
   * Get the physical value and Y position for ALL channels at a given canvas X coordinate.
   */
  getValuesAtTime(
    x: number,
    viewport: ViewportState,
    options: RenderOptions,
  ): { channel: string; value: number; unit: string; color: string; y: number }[] {
    const time = this.getTimeAtX(x, viewport, options);
    const results: { channel: string; value: number; unit: string; color: string; y: number }[] =
      [];

    for (let i = 0; i < viewport.channels.length; i++) {
      const ch = viewport.channels[i];
      if (!ch || ch.data.length === 0) continue;

      const durationMs = viewport.endTime - viewport.startTime;
      if (durationMs <= 0) continue;

      const msPerSample = durationMs / ch.data.length;
      const sampleIdx = Math.round((time - viewport.startTime) / msPerSample);
      if (sampleIdx < 0 || sampleIdx >= ch.data.length) continue;

      const value = ch.data[sampleIdx] ?? 0;

      const stripTop = options.padding.top + i * options.channelHeight;
      const innerTop = stripTop + 16;
      const innerBottom = stripTop + options.channelHeight - 8;
      const physRange = ch.physicalMax - ch.physicalMin;
      const normY = physRange > 0 ? (value - ch.physicalMin) / physRange : 0.5;
      const y = innerBottom - normY * (innerBottom - innerTop);

      results.push({ channel: ch.name, value, unit: ch.unit, color: ch.color, y });
    }

    return results;
  }

  /** Cancel any pending frame and release references. */
  dispose(): void {
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
  }

  // ── Internal render pipeline ───────────────────────────────────

  private renderImmediate(viewport: ViewportState, options: RenderOptions): void {
    const { ctx } = this;
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    if (w <= 0 || h <= 0) return;

    // Clear
    ctx.fillStyle = this.resolveCSSVar('--color-surface-primary', '#ffffff');
    ctx.fillRect(0, 0, w, h);

    const { padding, channelHeight } = options;
    const plotRight = w - padding.right;
    const plotWidth = plotRight - padding.left;

    if (plotWidth <= 0 || viewport.channels.length === 0) return;

    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const plotLeft = padding.left;

    // Draw each channel strip
    for (let i = 0; i < viewport.channels.length; i++) {
      const ch = viewport.channels[i];
      if (!ch) continue;
      const stripTop = padding.top + i * channelHeight;

      this.drawChannelBackground(plotLeft, stripTop, plotWidth, channelHeight, i);

      if (options.showGrid) {
        this.drawYGrid(ch, plotLeft, plotWidth, stripTop, channelHeight);
      }

      // Draw event markers within this channel strip
      this.drawEventMarkers(
        options.eventMarkers,
        viewport,
        plotLeft,
        plotWidth,
        stripTop,
        channelHeight,
      );

      // Draw signal waveform
      this.drawWaveform(ch, viewport, plotLeft, plotWidth, stripTop, channelHeight);

      // Channel name label
      this.drawChannelLabel(ch, plotLeft, stripTop);

      // Y-axis labels
      this.drawYAxis(ch, plotLeft, stripTop, channelHeight);
    }

    // X-axis (time) at the bottom of all channels
    if (options.showGrid) {
      this.drawXGrid(viewport, plotLeft, plotWidth, padding.top, options);
    }
    this.drawXAxis(viewport, plotLeft, plotWidth, padding.top, options);

    // Crosshair overlay
    if (options.showCrosshair && options.crosshairX !== null) {
      this.drawCrosshair(viewport, options, plotLeft, plotWidth);
    }
  }

  // ── Channel background ─────────────────────────────────────────

  private drawChannelBackground(
    x: number,
    y: number,
    width: number,
    height: number,
    index: number,
  ): void {
    const { ctx } = this;
    // Alternate subtle background for channel separation
    if (index % 2 === 1) {
      ctx.fillStyle = this.resolveCSSVar('--color-surface-secondary', '#f5f5f5');
      ctx.fillRect(x, y, width, height);
    }
  }

  // ── Waveform drawing ───────────────────────────────────────────

  private drawWaveform(
    ch: SignalChannel,
    viewport: ViewportState,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    channelHeight: number,
  ): void {
    const { ctx } = this;
    const { data, sampleRate } = ch;
    if (data.length === 0 || sampleRate <= 0) return;

    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    // Inner drawing area within the channel strip (leave room for label)
    const innerTop = stripTop + 16;
    const innerBottom = stripTop + channelHeight - 8;
    const innerHeight = innerBottom - innerTop;
    if (innerHeight <= 0) return;

    const physRange = ch.physicalMax - ch.physicalMin;
    if (physRange <= 0) return;

    // The data array covers the viewport time range (already sliced/downsampled).
    // Map data points directly to fill the viewport width.
    const msPerSample = durationMs / data.length;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, stripTop, plotWidth, channelHeight);
    ctx.clip();

    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let firstPoint = true;

    for (let s = 0; s < data.length; s++) {
      const sampleTimeMs = s * msPerSample;
      const x = plotLeft + (sampleTimeMs / durationMs) * plotWidth;

      // Skip samples clearly outside the visible area
      if (x < plotLeft - 2) continue;
      if (x > plotLeft + plotWidth + 2) break;

      const sample = data[s];
      if (sample === undefined) continue;
      const normY = (sample - ch.physicalMin) / physRange;
      const y = innerBottom - normY * innerHeight;

      if (firstPoint) {
        ctx.moveTo(x, y);
        firstPoint = false;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  // ── Grid lines ─────────────────────────────────────────────────

  private drawYGrid(
    ch: SignalChannel,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    channelHeight: number,
  ): void {
    const { ctx } = this;
    const innerTop = stripTop + 16;
    const innerBottom = stripTop + channelHeight - 8;
    const innerHeight = innerBottom - innerTop;
    if (innerHeight <= 0) return;

    const physRange = ch.physicalMax - ch.physicalMin;
    if (physRange <= 0) return;

    const maxTicks = Math.max(2, Math.floor(innerHeight / 40));
    const ticks = chooseYTicks(ch.physicalMin, ch.physicalMax, maxTicks);

    ctx.save();
    ctx.strokeStyle = this.resolveCSSVar('--color-chart-grid', '#e5e7eb');
    ctx.lineWidth = GRID_LINE_WIDTH;
    ctx.setLineDash(GRID_DASH);

    for (const value of ticks) {
      const normY = (value - ch.physicalMin) / physRange;
      const y = innerBottom - normY * innerHeight;

      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawXGrid(
    viewport: ViewportState,
    plotLeft: number,
    plotWidth: number,
    plotTop: number,
    options: RenderOptions,
  ): void {
    const { ctx } = this;
    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const tickInterval = chooseTimeTickInterval(durationMs, plotWidth);
    const firstTick = Math.ceil(viewport.startTime / tickInterval) * tickInterval;

    const totalHeight = options.padding.top + viewport.channels.length * options.channelHeight;

    ctx.save();
    ctx.strokeStyle = this.resolveCSSVar('--color-chart-grid', '#e5e7eb');
    ctx.lineWidth = GRID_LINE_WIDTH;
    ctx.setLineDash(GRID_DASH);

    for (let t = firstTick; t <= viewport.endTime; t += tickInterval) {
      const x = plotLeft + ((t - viewport.startTime) / durationMs) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── Axis labels ────────────────────────────────────────────────

  private drawChannelLabel(ch: SignalChannel, plotLeft: number, stripTop: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = ch.color;
    ctx.font = `bold ${CHANNEL_LABEL_FONT_SIZE}px ${this.fontFamily()}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(`${ch.name} (${ch.unit})`, plotLeft + 6, stripTop + 2);
    ctx.restore();
  }

  private drawYAxis(
    ch: SignalChannel,
    plotLeft: number,
    stripTop: number,
    channelHeight: number,
  ): void {
    const { ctx } = this;
    const innerTop = stripTop + 16;
    const innerBottom = stripTop + channelHeight - 8;
    const innerHeight = innerBottom - innerTop;
    if (innerHeight <= 0) return;

    const physRange = ch.physicalMax - ch.physicalMin;
    if (physRange <= 0) return;

    const maxTicks = Math.max(2, Math.floor(innerHeight / 40));
    const ticks = chooseYTicks(ch.physicalMin, ch.physicalMax, maxTicks);

    ctx.save();
    ctx.fillStyle = this.resolveCSSVar('--color-chart-axis', '#6b7280');
    ctx.font = `${AXIS_FONT_SIZE}px ${this.fontFamily()}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';

    for (const value of ticks) {
      const normY = (value - ch.physicalMin) / physRange;
      const y = innerBottom - normY * innerHeight;
      const label = Number.isInteger(value) ? String(value) : value.toFixed(1);
      ctx.fillText(label, plotLeft - 4, y);
    }

    ctx.restore();
  }

  private drawXAxis(
    viewport: ViewportState,
    plotLeft: number,
    plotWidth: number,
    _plotTop: number,
    options: RenderOptions,
  ): void {
    const { ctx } = this;
    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const tickInterval = chooseTimeTickInterval(durationMs, plotWidth);
    const firstTick = Math.ceil(viewport.startTime / tickInterval) * tickInterval;

    const axisY = options.padding.top + viewport.channels.length * options.channelHeight + 4;

    ctx.save();
    ctx.fillStyle = this.resolveCSSVar('--color-chart-axis', '#6b7280');
    ctx.font = `${AXIS_FONT_SIZE}px ${this.fontFamily()}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    for (let t = firstTick; t <= viewport.endTime; t += tickInterval) {
      const x = plotLeft + ((t - viewport.startTime) / durationMs) * plotWidth;
      ctx.fillText(formatTimeLabel(t), x, axisY);
    }

    ctx.restore();
  }

  // ── Event markers ──────────────────────────────────────────────

  private drawEventMarkers(
    markers: readonly EventMarker[],
    viewport: ViewportState,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    channelHeight: number,
  ): void {
    const { ctx } = this;
    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    ctx.save();

    for (const marker of markers) {
      const markerEnd = marker.startTime + marker.duration;

      // Skip markers fully outside the viewport
      if (markerEnd < viewport.startTime || marker.startTime > viewport.endTime) continue;

      const x1 =
        plotLeft + Math.max(0, (marker.startTime - viewport.startTime) / durationMs) * plotWidth;
      const x2 = plotLeft + Math.min(1, (markerEnd - viewport.startTime) / durationMs) * plotWidth;
      const markerWidth = Math.max(2, x2 - x1); // minimum 2px visibility

      ctx.fillStyle = marker.color;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(x1, stripTop, markerWidth, channelHeight);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Crosshair ──────────────────────────────────────────────────

  private drawCrosshair(
    viewport: ViewportState,
    options: RenderOptions,
    plotLeft: number,
    plotWidth: number,
  ): void {
    const { ctx } = this;
    const { crosshairX, channelHeight, padding } = options;

    if (crosshairX === null) return;

    const totalHeight = padding.top + viewport.channels.length * channelHeight;

    // Vertical crosshair line
    ctx.save();
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(crosshairX, padding.top);
    ctx.lineTo(crosshairX, totalHeight);
    ctx.stroke();

    // Time readout at top
    const time = this.getTimeAtX(crosshairX, viewport, options);
    if (time >= viewport.startTime && time <= viewport.endTime) {
      this.drawReadoutBadge(crosshairX, padding.top - 2, formatTimeLabel(time), 'bottom');
    }

    // Value readouts + intersection dots for ALL channels
    const values = this.getValuesAtTime(crosshairX, viewport, options);
    for (const v of values) {
      // Intersection dot on the waveform
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.arc(crosshairX, v.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Coloured readout badge at the right edge
      const label = `${v.value.toFixed(2)} ${v.unit}`;
      this.drawColoredReadoutBadge(plotLeft + plotWidth + 4, v.y, label, v.color);
    }

    ctx.restore();
  }

  /** Draw a small coloured text badge at the given position. */
  private drawColoredReadoutBadge(x: number, y: number, text: string, color: string): void {
    const { ctx } = this;
    ctx.save();

    ctx.font = `${READOUT_FONT_SIZE}px ${this.fontFamily()}`;
    const metrics = ctx.measureText(text);
    const pw = 4;
    const ph = 2;
    const boxW = metrics.width + pw * 2;
    const boxH = READOUT_FONT_SIZE + ph * 2;

    const bx = Math.max(0, Math.min(x, this.logicalWidth - boxW));
    const by = Math.max(0, y - boxH / 2);

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 3);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = READOUT_FG;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + pw, by + ph);

    ctx.restore();
  }

  /** Draw a small text badge with background at the given position. */
  private drawReadoutBadge(x: number, y: number, text: string, anchor: 'bottom' | 'left'): void {
    const { ctx } = this;
    ctx.save();

    ctx.font = `${READOUT_FONT_SIZE}px ${this.fontFamily()}`;
    const metrics = ctx.measureText(text);
    const pw = 4;
    const ph = 2;
    const boxW = metrics.width + pw * 2;
    const boxH = READOUT_FONT_SIZE + ph * 2;

    let bx: number;
    let by: number;

    if (anchor === 'bottom') {
      bx = x - boxW / 2;
      by = y - boxH;
    } else {
      bx = x;
      by = y - boxH / 2;
    }

    // Clamp to canvas bounds
    bx = Math.max(0, Math.min(bx, this.logicalWidth - boxW));
    by = Math.max(0, by);

    ctx.fillStyle = READOUT_BG;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 3);
    ctx.fill();

    ctx.fillStyle = READOUT_FG;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + pw, by + ph);

    ctx.restore();
  }

  // ── Utilities ──────────────────────────────────────────────────

  /** Resolve a CSS custom property to its computed value with a fallback. */
  private resolveCSSVar(varName: string, fallback: string): string {
    try {
      const style = this.cachedStyle ?? getComputedStyle(this.canvas);
      const value = style.getPropertyValue(varName).trim();
      return value || fallback;
    } catch {
      return fallback;
    }
  }

  /** Return the sans-serif font family from CSS tokens. */
  private fontFamily(): string {
    return this.resolveCSSVar(
      '--font-family-sans',
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    );
  }
}
