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

/**
 * The kind of lane. CPAP lanes are high-frequency waveforms routed through the
 * existing 60 fps line path; wearable lanes are low-rate health signals rendered
 * directly without downsampling.
 */
export type LaneKind = 'cpap' | 'wearable';

/**
 * How a channel's samples are drawn.
 * - `line`   — continuous polyline (default; CPAP waveforms, dense HR).
 * - `step`   — stepAfter hold with a filled dot at each real sample, dashed
 *   connector across large gaps (sparse series such as HRV).
 * - `ribbon` — categorical stacked bands (the hypnogram). Never read as a
 *   waveform: no `lineTo` between segments.
 */
export type LaneRender = 'line' | 'step' | 'ribbon';

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
  /** Lane kind. Defaults to `'cpap'`. */
  readonly kind?: LaneKind;
  /** Render style. Defaults to `'line'`. */
  readonly render?: LaneRender;
  /**
   * Marks a low-cadence series whose individual samples should be emphasised
   * (filled dots) and whose gaps should not be bridged with a solid line.
   * Implied by `render === 'step'`.
   */
  readonly sparse?: boolean;
  /** Override stroke width in CSS pixels. Defaults to the dense CPAP width. */
  readonly lineWidth?: number;
  /**
   * Absolute timestamps (ms, session-relative, same base as the viewport) for
   * each sample. Required for sparse/step series so dots and gap detection land
   * on the real sample times rather than an assumed uniform cadence. When
   * omitted, samples are assumed evenly spaced across the viewport (CPAP path).
   */
  readonly sampleTimes?: Float64Array;
  /**
   * Explicit lane height in CSS pixels. When omitted, the renderer falls back to
   * {@link RenderOptions.channelHeight}. Enables tall hero lanes and short
   * hypnogram/collapsed lanes within one stack.
   */
  readonly height?: number;
}

/**
 * A categorical band definition for ribbon (hypnogram) lanes, ordered top→bottom.
 * The renderer maps each sample value to the matching band by `value` and fills
 * that band's sub-row.
 */
export interface RibbonBand {
  /** Ordinal sample value this band represents. */
  readonly value: number;
  /** Short row label shown at the left (e.g. "W", "REM", "N1–2", "N3"). */
  readonly label: string;
  /** Resolved fill colour. */
  readonly color: string;
  /** Draw a diagonal hatch overlay as a redundant non-colour cue (REM). */
  readonly hatch?: boolean;
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

/**
 * An app-detected breathing-pattern episode (Phase 3 prep). Parallels
 * {@link EventMarker} but carries a confidence score that drives the wash
 * opacity and border weight, and is rendered with a hatched, dashed-border
 * treatment to distinguish app-derived detections from device-reported events.
 *
 * Render-only for now: no detection data is wired into the viewer yet.
 */
export interface DetectionEpisode {
  /** Start time in ms offset from signal start. */
  readonly startTime: number;
  /** Duration in ms. */
  readonly duration: number;
  /** Detection type/category label. */
  readonly type: string;
  /** Confidence in [0, 1]; drives wash alpha and border width. */
  readonly confidence: number;
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
  /**
   * App-detected breathing episodes drawn with a hatched, dashed-border wash.
   * Optional; defaults to none. Render-only (Phase 3 prep).
   */
  readonly detectionEpisodes?: readonly DetectionEpisode[];
  /**
   * Ribbon band definitions keyed by channel name, for `render === 'ribbon'`
   * lanes (the hypnogram). Ordered top→bottom.
   */
  readonly ribbonBands?: Readonly<Record<string, readonly RibbonBand[]>>;
  /**
   * Default pixel height per channel strip. Individual channels may override via
   * {@link SignalChannel.height}.
   */
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

/** Crosshair + readout styling. Colours resolve from CSS tokens at render time. */
const CROSSHAIR_FALLBACK = 'rgba(120, 120, 120, 0.6)';
const READOUT_FONT_SIZE = 11;
const READOUT_BG_FALLBACK = 'rgba(0, 0, 0, 0.75)';
const READOUT_FG_FALLBACK = '#ffffff';

/** Default stroke width for dense CPAP waveforms (CSS px). */
const DENSE_LINE_WIDTH = 1.2;

/**
 * Gap factor for sparse/step series: a gap larger than this multiple of the
 * median inter-sample spacing is drawn as a dashed connector rather than a solid
 * hold, signalling missing coverage.
 */
const SPARSE_GAP_FACTOR = 2.5;

/** Detection wash alpha range, mapped from confidence [0, 1]. */
const DETECTION_ALPHA_MIN = 0.06;
const DETECTION_ALPHA_MAX = 0.2;
/** Detection border width range (CSS px), mapped from confidence [0, 1]. */
const DETECTION_BORDER_MIN = 1;
const DETECTION_BORDER_MAX = 2;
/** Detection hatch geometry. */
const DETECTION_HATCH_PERIOD = 6;

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

/** Vertical placement of one lane within the stack. */
export interface LaneLayoutEntry {
  /** Top Y (CSS px) of the lane strip. */
  readonly top: number;
  /** Height (CSS px) of the lane strip. */
  readonly height: number;
}

/**
 * Compute the cumulative top offset and height of each lane, honouring per-lane
 * `height` overrides and falling back to `defaultHeight`. Pure and exported so
 * the host can hit-test and position HTML lane headers identically to the canvas.
 */
export function computeLaneLayout(
  channels: readonly { readonly height?: number }[],
  defaultHeight: number,
  paddingTop: number,
): LaneLayoutEntry[] {
  const out: LaneLayoutEntry[] = [];
  let top = paddingTop;
  for (const ch of channels) {
    const height = ch.height && ch.height > 0 ? ch.height : defaultHeight;
    out.push({ top, height });
    top += height;
  }
  return out;
}

/** Total stack height (px) below `paddingTop` for the given lanes. */
export function totalLaneHeight(
  channels: readonly { readonly height?: number }[],
  defaultHeight: number,
): number {
  let h = 0;
  for (const ch of channels) {
    h += ch.height && ch.height > 0 ? ch.height : defaultHeight;
  }
  return h;
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

    const layout = computeLaneLayout(viewport.channels, channelHeight, padding.top);

    for (let i = 0; i < viewport.channels.length; i++) {
      const ch = viewport.channels[i];
      const entry = layout[i];
      if (!ch || !entry) continue;
      const stripTop = entry.top;
      const stripBottom = stripTop + entry.height;

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
   * Sample value at a session-relative time for one channel, honouring sparse
   * series sample times. Returns `null` when the time falls outside coverage.
   */
  private sampleValueAtTime(
    ch: SignalChannel,
    time: number,
    viewport: ViewportState,
  ): number | null {
    const { data } = ch;
    if (data.length === 0) return null;

    if (ch.sampleTimes && ch.sampleTimes.length === data.length) {
      // Step / sparse series: hold the most recent sample at or before `time`.
      const times = ch.sampleTimes;
      const first = times[0];
      if (first === undefined || time < first) return null;
      // Binary search for the last index with time <= target.
      let lo = 0;
      let hi = times.length - 1;
      let idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = times[mid];
        if (t === undefined) break;
        if (t <= time) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return data[idx] ?? null;
    }

    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return null;
    const msPerSample = durationMs / data.length;
    const sampleIdx = Math.round((time - viewport.startTime) / msPerSample);
    if (sampleIdx < 0 || sampleIdx >= data.length) return null;
    return data[sampleIdx] ?? null;
  }

  /**
   * Get the physical value and Y position for ALL channels at a given canvas X coordinate.
   */
  getValuesAtTime(
    x: number,
    viewport: ViewportState,
    options: RenderOptions,
  ): {
    channel: string;
    value: number;
    unit: string;
    color: string;
    y: number;
    label?: string;
  }[] {
    const time = this.getTimeAtX(x, viewport, options);
    const results: {
      channel: string;
      value: number;
      unit: string;
      color: string;
      y: number;
      label?: string;
    }[] = [];

    const layout = computeLaneLayout(viewport.channels, options.channelHeight, options.padding.top);

    for (let i = 0; i < viewport.channels.length; i++) {
      const ch = viewport.channels[i];
      const entry = layout[i];
      if (!ch || !entry || ch.data.length === 0) continue;

      const value = this.sampleValueAtTime(ch, time, viewport);
      if (value === null) continue;

      const stripTop = entry.top;
      const innerTop = stripTop + 16;
      const innerBottom = stripTop + entry.height - 8;
      const physRange = ch.physicalMax - ch.physicalMin;
      const normY = physRange > 0 ? (value - ch.physicalMin) / physRange : 0.5;
      const y = innerBottom - normY * (innerBottom - innerTop);

      // Ribbon lanes (hypnogram) report a stage label, not a number, and place
      // the readout dot at the centre of the matching band sub-row.
      if (ch.render === 'ribbon') {
        const bands = options.ribbonBands?.[ch.name];
        const band = bands?.find((b) => b.value === value);
        const bandY = bands ? this.ribbonBandCenterY(bands, value, stripTop, entry.height) : y;
        results.push({
          channel: ch.name,
          value,
          unit: ch.unit,
          color: band?.color ?? ch.color,
          y: bandY,
          label: band?.label,
        });
        continue;
      }

      results.push({ channel: ch.name, value, unit: ch.unit, color: ch.color, y });
    }

    return results;
  }

  /** Vertical centre (px) of the band whose `value` matches, within a ribbon strip. */
  private ribbonBandCenterY(
    bands: readonly RibbonBand[],
    value: number,
    stripTop: number,
    stripHeight: number,
  ): number {
    const innerTop = stripTop + 14;
    const innerBottom = stripTop + stripHeight - 4;
    const innerHeight = innerBottom - innerTop;
    const rows = bands.length;
    if (rows === 0 || innerHeight <= 0) return stripTop + stripHeight / 2;
    const rowH = innerHeight / rows;
    const idx = Math.max(
      0,
      bands.findIndex((b) => b.value === value),
    );
    return innerTop + idx * rowH + rowH / 2;
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
    const layout = computeLaneLayout(viewport.channels, channelHeight, padding.top);

    // Draw each channel strip
    for (let i = 0; i < viewport.channels.length; i++) {
      const ch = viewport.channels[i];
      const entry = layout[i];
      if (!ch || !entry) continue;
      const stripTop = entry.top;
      const stripHeight = entry.height;

      this.drawChannelBackground(plotLeft, stripTop, plotWidth, stripHeight, i);

      const isRibbon = ch.render === 'ribbon';

      // Grid only for value-axis lanes (ribbon/hypnogram has no numeric ticks).
      if (options.showGrid && !isRibbon) {
        this.drawYGrid(ch, plotLeft, plotWidth, stripTop, stripHeight);
      }

      // Event markers + detection washes within this channel strip.
      this.drawEventMarkers(
        options.eventMarkers,
        viewport,
        plotLeft,
        plotWidth,
        stripTop,
        stripHeight,
      );
      if (options.detectionEpisodes && options.detectionEpisodes.length > 0) {
        this.drawDetectionEpisodes(
          options.detectionEpisodes,
          viewport,
          plotLeft,
          plotWidth,
          stripTop,
          stripHeight,
        );
      }

      // Signal rendering dispatched by render style.
      if (isRibbon) {
        this.drawRibbon(ch, viewport, options, plotLeft, plotWidth, stripTop, stripHeight);
      } else if (ch.render === 'step' || ch.sparse) {
        this.drawStep(ch, viewport, plotLeft, plotWidth, stripTop, stripHeight);
      } else {
        this.drawLine(ch, viewport, plotLeft, plotWidth, stripTop, stripHeight);
      }

      // Channel name label
      this.drawChannelLabel(ch, plotLeft, stripTop);

      // Y-axis labels (ribbon lanes draw their own fixed row labels).
      if (!isRibbon) {
        this.drawYAxis(ch, plotLeft, stripTop, stripHeight);
      }
    }

    const totalH = totalLaneHeight(viewport.channels, channelHeight);

    // X-axis (time) at the bottom of all channels
    if (options.showGrid) {
      this.drawXGrid(viewport, plotLeft, plotWidth, padding.top, totalH);
    }
    this.drawXAxis(viewport, plotLeft, plotWidth, padding.top, totalH);

    // Crosshair overlay
    if (options.showCrosshair && options.crosshairX !== null) {
      this.drawCrosshair(viewport, options, plotLeft, plotWidth, totalH);
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

  /**
   * Continuous polyline — the original CPAP 60 fps path. When `sampleTimes` is
   * present (wearable line lanes such as the HR hero), X is positioned by real
   * timestamps; otherwise samples are assumed uniform across the viewport.
   */
  private drawLine(
    ch: SignalChannel,
    viewport: ViewportState,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    stripHeight: number,
  ): void {
    const { ctx } = this;
    const { data } = ch;
    if (data.length === 0) return;

    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const innerTop = stripTop + 16;
    const innerBottom = stripTop + stripHeight - 8;
    const innerHeight = innerBottom - innerTop;
    if (innerHeight <= 0) return;

    const physRange = ch.physicalMax - ch.physicalMin;
    if (physRange <= 0) return;

    const times = ch.sampleTimes && ch.sampleTimes.length === data.length ? ch.sampleTimes : null;
    const msPerSample = durationMs / data.length;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, stripTop, plotWidth, stripHeight);
    ctx.clip();

    ctx.strokeStyle = ch.color;
    ctx.lineWidth = ch.lineWidth ?? DENSE_LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let firstPoint = true;
    for (let s = 0; s < data.length; s++) {
      const tMs = times ? (times[s] ?? 0) - viewport.startTime : s * msPerSample;
      const x = plotLeft + (tMs / durationMs) * plotWidth;
      if (x < plotLeft - 2) {
        if (!times) continue;
        // For timestamped data we may still need the prior point; keep scanning.
      }
      if (x > plotLeft + plotWidth + 2 && !times) break;

      const sample = data[s];
      if (sample === undefined || Number.isNaN(sample)) {
        firstPoint = true; // break the line across missing samples
        continue;
      }
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

  /**
   * Step (stepAfter) render for sparse series (e.g. HRV RMSSD): hold each value
   * until the next sample, draw a filled dot at every real sample, and switch to
   * a dashed connector when the gap to the next sample exceeds the typical
   * spacing (signalling missing coverage rather than a genuine plateau).
   */
  private drawStep(
    ch: SignalChannel,
    viewport: ViewportState,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    stripHeight: number,
  ): void {
    const { ctx } = this;
    const { data } = ch;
    if (data.length === 0) return;

    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const innerTop = stripTop + 16;
    const innerBottom = stripTop + stripHeight - 8;
    const innerHeight = innerBottom - innerTop;
    if (innerHeight <= 0) return;

    const physRange = ch.physicalMax - ch.physicalMin;
    if (physRange <= 0) return;

    const times = ch.sampleTimes && ch.sampleTimes.length === data.length ? ch.sampleTimes : null;
    const msPerSample = durationMs / data.length;

    const xAt = (s: number): number => {
      const tMs = times ? (times[s] ?? 0) - viewport.startTime : s * msPerSample;
      return plotLeft + (tMs / durationMs) * plotWidth;
    };
    const yAt = (v: number): number =>
      innerBottom - ((v - ch.physicalMin) / physRange) * innerHeight;

    // Median inter-sample spacing → gap threshold.
    let gapThresholdMs = Number.POSITIVE_INFINITY;
    if (times && times.length > 1) {
      const diffs: number[] = [];
      for (let s = 1; s < times.length; s++) {
        const a = times[s - 1];
        const b = times[s];
        if (a !== undefined && b !== undefined) diffs.push(b - a);
      }
      diffs.sort((p, q) => p - q);
      const median = diffs[Math.floor(diffs.length / 2)] ?? 0;
      if (median > 0) gapThresholdMs = median * SPARSE_GAP_FACTOR;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, stripTop, plotWidth, stripHeight);
    ctx.clip();
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = ch.lineWidth ?? DENSE_LINE_WIDTH;
    ctx.lineJoin = 'round';

    let prevX: number | null = null;
    let prevY: number | null = null;
    let prevT: number | null = null;

    for (let s = 0; s < data.length; s++) {
      const sample = data[s];
      if (sample === undefined || Number.isNaN(sample)) continue;
      const x = xAt(s);
      const y = yAt(sample);
      const tMs = times ? (times[s] ?? 0) : s * msPerSample;

      if (prevX !== null && prevY !== null) {
        const gap = prevT !== null ? tMs - prevT : 0;
        const dashed = gap > gapThresholdMs;
        ctx.beginPath();
        ctx.setLineDash(dashed ? [4, 3] : []);
        // stepAfter: horizontal hold at prevY, then vertical riser to new y.
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, prevY);
        if (!dashed) ctx.lineTo(x, y);
        ctx.stroke();
        if (dashed) {
          // Riser drawn solid after a dashed connector for legibility.
          ctx.beginPath();
          ctx.setLineDash([]);
          ctx.moveTo(x, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }
      prevX = x;
      prevY = y;
      prevT = tMs;
    }

    // Filled dots at each real sample.
    ctx.setLineDash([]);
    ctx.fillStyle = ch.color;
    const dotR = this.resolveCSSVarNumber('--signal-sparse-dot-radius', 2.5);
    for (let s = 0; s < data.length; s++) {
      const sample = data[s];
      if (sample === undefined || Number.isNaN(sample)) continue;
      const x = xAt(s);
      if (x < plotLeft - dotR || x > plotLeft + plotWidth + dotR) continue;
      ctx.beginPath();
      ctx.arc(x, yAt(sample), dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Ribbon render for the hypnogram: categorical stacked bands, top→bottom in
   * the order given by `ribbonBands` (Wake → REM → Light → Deep). Each segment
   * is a `fillRect` in the matching band's sub-row — deliberately NOT a polyline,
   * so it never reads as a waveform. Faint vertical ticks mark transitions; the
   * REM band carries a diagonal hatch as a redundant non-colour cue. Fixed row
   * labels (W/REM/N1–2/N3) are drawn at the left; no numeric Y ticks.
   */
  private drawRibbon(
    ch: SignalChannel,
    viewport: ViewportState,
    options: RenderOptions,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    stripHeight: number,
  ): void {
    const { ctx } = this;
    const { data } = ch;
    const bands = options.ribbonBands?.[ch.name];
    if (!bands || bands.length === 0 || data.length === 0) return;

    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const innerTop = stripTop + 14;
    const innerBottom = stripTop + stripHeight - 4;
    const innerHeight = innerBottom - innerTop;
    if (innerHeight <= 0) return;

    const rowH = innerHeight / bands.length;
    const times = ch.sampleTimes && ch.sampleTimes.length === data.length ? ch.sampleTimes : null;
    const msPerSample = durationMs / data.length;

    const bandIndex = (value: number): number => bands.findIndex((b) => b.value === value);
    const xAt = (s: number): number => {
      const tMs = times ? (times[s] ?? 0) - viewport.startTime : s * msPerSample;
      return plotLeft + (tMs / durationMs) * plotWidth;
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, stripTop, plotWidth, stripHeight);
    ctx.clip();

    const sep = this.resolveCSSVar('--color-surface-primary', '#ffffff');
    const transitionXs: number[] = [];

    // Fill each segment as a rectangle from this sample's x to the next sample's x.
    for (let s = 0; s < data.length; s++) {
      const value = data[s];
      if (value === undefined || Number.isNaN(value)) continue;
      const idx = bandIndex(value);
      if (idx < 0) continue;

      const x1 = Math.max(plotLeft, xAt(s));
      const x2 =
        s + 1 < data.length ? Math.min(plotLeft + plotWidth, xAt(s + 1)) : plotLeft + plotWidth;
      const segW = Math.max(0, x2 - x1);
      if (segW <= 0) continue;

      const rowTop = innerTop + idx * rowH;
      const band = bands[idx];
      if (!band) continue;

      ctx.fillStyle = band.color;
      ctx.fillRect(x1, rowTop, segW, rowH);

      if (band.hatch) {
        this.fillDiagonalHatch(x1, rowTop, segW, rowH, sep, 5, 0.45);
      }

      // 1px surface separator between band rows for crisp edges.
      ctx.fillStyle = sep;
      ctx.fillRect(x1, rowTop, segW, 1);

      if (s > 0) transitionXs.push(x1);
    }

    // Faint vertical ticks at transitions.
    ctx.strokeStyle = this.resolveCSSVar('--color-chart-grid', '#e5e7eb');
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.7;
    for (const tx of transitionXs) {
      ctx.beginPath();
      ctx.moveTo(tx, innerTop);
      ctx.lineTo(tx, innerBottom);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Fixed row labels at the left gutter.
    ctx.fillStyle = this.resolveCSSVar('--color-chart-axis', '#6b7280');
    ctx.font = `${AXIS_FONT_SIZE}px ${this.fontFamily()}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      if (!band) continue;
      ctx.fillText(band.label, plotLeft - 4, innerTop + i * rowH + rowH / 2);
    }

    ctx.restore();
  }

  /**
   * App-detected breathing episodes (Phase 3 prep): a hatched wash with a dashed
   * border. Confidence drives both the wash alpha and the border width so a
   * stronger detection reads more solidly. Render-only.
   */
  private drawDetectionEpisodes(
    episodes: readonly DetectionEpisode[],
    viewport: ViewportState,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    stripHeight: number,
  ): void {
    const { ctx } = this;
    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const fill = this.resolveCSSVar('--color-detection', '#7c3aed');
    const wash = this.resolveCSSVar('--color-detection-bg', 'rgba(124,58,237,0.08)');
    const border = this.resolveCSSVar('--color-detection-border', '#6d28d9');

    for (const ep of episodes) {
      const epEnd = ep.startTime + ep.duration;
      if (epEnd < viewport.startTime || ep.startTime > viewport.endTime) continue;

      const x1 =
        plotLeft + Math.max(0, (ep.startTime - viewport.startTime) / durationMs) * plotWidth;
      const x2 = plotLeft + Math.min(1, (epEnd - viewport.startTime) / durationMs) * plotWidth;
      const w = Math.max(2, x2 - x1);
      const conf = Math.max(0, Math.min(1, ep.confidence));

      ctx.save();
      ctx.beginPath();
      ctx.rect(x1, stripTop, w, stripHeight);
      ctx.clip();

      // Base wash.
      ctx.fillStyle = wash;
      ctx.fillRect(x1, stripTop, w, stripHeight);

      // 45° hatch in the detection colour, alpha driven by confidence.
      const alpha = DETECTION_ALPHA_MIN + conf * (DETECTION_ALPHA_MAX - DETECTION_ALPHA_MIN);
      this.fillDiagonalHatch(x1, stripTop, w, stripHeight, fill, DETECTION_HATCH_PERIOD, alpha);
      ctx.restore();

      // Dashed border, width driven by confidence.
      ctx.save();
      ctx.strokeStyle = border;
      ctx.lineWidth = DETECTION_BORDER_MIN + conf * (DETECTION_BORDER_MAX - DETECTION_BORDER_MIN);
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1, stripTop + 0.5, w, stripHeight - 1);
      ctx.restore();
    }
  }

  /** Fill a 45° diagonal hatch within a rectangle (used by ribbon REM + detections). */
  private fillDiagonalHatch(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    period: number,
    alpha: number,
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let d = -h; d < w + h; d += period) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
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
    laneStackHeight: number,
  ): void {
    const { ctx } = this;
    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const tickInterval = chooseTimeTickInterval(durationMs, plotWidth);
    const firstTick = Math.ceil(viewport.startTime / tickInterval) * tickInterval;

    const totalHeight = plotTop + laneStackHeight;

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
    const label = ch.unit ? `${ch.name} (${ch.unit})` : ch.name;
    ctx.fillText(label, plotLeft + 6, stripTop + 2);
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
    plotTop: number,
    laneStackHeight: number,
  ): void {
    const { ctx } = this;
    const durationMs = viewport.endTime - viewport.startTime;
    if (durationMs <= 0) return;

    const tickInterval = chooseTimeTickInterval(durationMs, plotWidth);
    const firstTick = Math.ceil(viewport.startTime / tickInterval) * tickInterval;

    const axisY = plotTop + laneStackHeight + 4;

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
    laneStackHeight: number,
  ): void {
    const { ctx } = this;
    const { crosshairX, padding } = options;

    if (crosshairX === null) return;

    const totalHeight = padding.top + laneStackHeight;

    // Vertical crosshair line
    ctx.save();
    ctx.strokeStyle = this.resolveCSSVar('--color-crosshair', CROSSHAIR_FALLBACK);
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
      // Intersection dot on the waveform / band
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.arc(crosshairX, v.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Hypnogram (ribbon) lanes show the stage name, not a number.
      const label =
        v.label !== undefined ? v.label : `${v.value.toFixed(2)}${v.unit ? ` ${v.unit}` : ''}`;
      this.drawLaneReadoutBadge(plotLeft + plotWidth + 4, v.y, label, v.color);
    }

    ctx.restore();
  }

  /**
   * Per-lane crosshair readout: surface-elevated fill, 1px lane-colour border,
   * primary-text label, and a 4px lane-colour chip at the left. This fixes the
   * white-on-light contrast problem the old solid-colour badge had in dark mode,
   * while keeping the lane colour as a redundant (non-sole) cue.
   */
  private drawLaneReadoutBadge(x: number, y: number, text: string, laneColor: string): void {
    const { ctx } = this;
    ctx.save();

    ctx.font = `${READOUT_FONT_SIZE}px ${this.fontFamily()}`;
    const metrics = ctx.measureText(text);
    const pw = 5;
    const ph = 2;
    const chipW = 4;
    const chipGap = 4;
    const boxW = metrics.width + pw * 2 + chipW + chipGap;
    const boxH = READOUT_FONT_SIZE + ph * 2 + 2;

    const bx = Math.max(0, Math.min(x, this.logicalWidth - boxW));
    const by = Math.max(0, y - boxH / 2);

    // Fill + border.
    ctx.fillStyle = this.resolveCSSVar('--color-surface-elevated', READOUT_BG_FALLBACK);
    ctx.strokeStyle = laneColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1, 3);
    ctx.fill();
    ctx.stroke();

    // Lane-colour chip at the left.
    ctx.fillStyle = laneColor;
    ctx.fillRect(bx + pw, by + ph + 1, chipW, boxH - ph * 2 - 2);

    // Label text.
    ctx.fillStyle = this.resolveCSSVar('--color-text-primary', READOUT_FG_FALLBACK);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + pw + chipW + chipGap, by + boxH / 2);

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

    ctx.fillStyle = this.resolveCSSVar('--color-surface-elevated', READOUT_BG_FALLBACK);
    ctx.strokeStyle = this.resolveCSSVar('--color-border-default', 'transparent');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.resolveCSSVar('--color-text-primary', READOUT_FG_FALLBACK);
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

  /** Resolve a CSS custom property to a number (parsing a leading `px`), with fallback. */
  private resolveCSSVarNumber(varName: string, fallback: number): number {
    const raw = this.resolveCSSVar(varName, '');
    if (!raw) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Return the sans-serif font family from CSS tokens. */
  private fontFamily(): string {
    return this.resolveCSSVar(
      '--font-family-sans',
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    );
  }
}
