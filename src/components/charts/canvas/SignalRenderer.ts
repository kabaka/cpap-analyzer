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
 * In the WebGL2 hybrid (ADR 0019) this class plays two roles: the **Canvas2D
 * chrome layer** (in `chromeOnly` mode, where it skips the dense-CPAP waveform
 * the WebGL layer paints) and the **permanent automatic fallback** (in normal
 * mode, where it draws everything). The chrome/waveform split is governed by the
 * shared pure predicate {@link isDenseCpapWaveform}.
 *
 * @module components/charts/canvas/SignalRenderer
 */

import { isDenseCpapWaveform } from '../hybridWaveformPlan';

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
  /**
   * Optional per-x-pixel-column MIN/MAX envelope for dense CPAP waveform lanes
   * (`kind: 'cpap'`, `render: 'line'`). When present, the line path draws this
   * envelope — a vertical span from each column's max down to its min, connected
   * column-to-column into a continuous filled-and-stroked waveform — INSTEAD of
   * the LTTB polyline in {@link data}. This is the zoomed-OUT fidelity path: a
   * true envelope cannot hide a 1-sample spike or notch the way LTTB's
   * vertex-picking can. It is only attached when the viewport holds > ~1 source
   * sample per pixel; zoomed-in frames omit it so the polyline is drawn exactly
   * as before (byte-identical). The envelope must be computed from a source dense
   * enough to have several samples per column (a pyramid level), NOT from the
   * already-reduced {@link data}.
   *
   * `min[c]`/`max[c]` are physical values for column `c` (0 ≤ c < `columns`),
   * mapped left→right across the lane's plot width. A column with
   * `min[c] === max[c] === NaN` is a gap and BREAKS the envelope (no bridge),
   * mirroring the polyline's NaN break. {@link data} is still populated (the LTTB
   * output) so the crosshair readout keeps reading a correct value at the cursor.
   */
  readonly envelope?: {
    /** Per-column physical minima (length ≥ `columns`). NaN marks a gap. */
    readonly min: Float32Array;
    /** Per-column physical maxima (length ≥ `columns`). NaN marks a gap. */
    readonly max: Float32Array;
    /** Number of populated columns. */
    readonly columns: number;
  };
  /**
   * Per-lane WebGL geometry source for the hybrid renderer (ADR 0019). Carries
   * the WHOLE chosen pyramid level in a stable, absolute ms domain so the WebGL2
   * waveform layer can pan/zoom via uniforms WITHOUT re-uploading. The Canvas2D
   * path IGNORES this field — it consumes the pre-sliced {@link data}/{@link
   * envelope} above — so attaching it is fully back-compatible and the fallback
   * path is unaffected. Typed structurally to avoid a Canvas→WebGL import cycle;
   * the authoritative shape is {@link WebGLLaneGeometry} in `hybridWaveformPlan`.
   */
  readonly webglLane?: {
    readonly mode: 'envelope' | 'line';
    readonly levelData: Float32Array;
    readonly levelIndex: number;
    readonly dataXPerElementMs: number;
    readonly dataXStartMs: number;
    readonly plotWidthColumns: number;
    readonly physRange: number;
  };
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

/** Axis label styling. (Channel name labels are rendered by the HTML lane
 * header overlay, not on the canvas.) */
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
  /**
   * Optional transparent overlay canvas stacked directly over the base canvas.
   * When set, the crosshair (line + time badge + per-lane intersection dots and
   * value/stage readout badges) is drawn here instead of on the base, so a
   * pointer move repaints ONLY this overlay — never the waveform stack. The base
   * layer (waveforms, grid, axes, markers, ribbons) repaints only when the
   * viewport/data/size/theme actually change. The overlay is OPTIONAL: with no
   * overlay set the renderer behaves exactly as before (crosshair on the base),
   * which keeps the existing back-compat tests valid.
   */
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  /** Coalescing rAF handle for overlay-only paints, separate from {@link pendingFrame}. */
  private pendingOverlayFrame: number | null = null;
  /**
   * The context currently being drawn into. Defaults to the base context; the
   * overlay pass temporarily points this at {@link overlayCtx} so the shared
   * `drawCrosshair`/badge/dot helpers (which read `this.activeCtx`) target the
   * overlay without duplicating their logic. The base render path leaves this at
   * the base context, so base output is byte-identical to before.
   */
  private activeCtx: CanvasRenderingContext2D;
  /**
   * Per-frame cache of resolved CSS-variable strings. The same tokens (grid,
   * axis, surface colours) are resolved many times within a single render pass;
   * resolving each one only once per frame removes that duplicate
   * `getPropertyValue` work on the hot path. Cleared at the top of every
   * `renderImmediate` so theme/size changes are always reflected on the next
   * frame — never cached across frames. The Map instance is reused (`.clear()`
   * does not reallocate) to avoid a per-frame allocation.
   */
  private readonly cssVarFrameCache = new Map<string, string>();

  /**
   * Chrome-only mode (ADR 0019 hybrid composition). When `true`, {@link
   * renderImmediate} draws everything EXCEPT the dense-CPAP waveform itself
   * (`kind: 'cpap'`, `render: 'line'`) — i.e. it still draws channel
   * backgrounds, grid, event-marker + detection washes, Y/X axis labels, the
   * hypnogram ribbon, sparse/step lanes, and wearable line lanes, but SKIPS the
   * `drawLine`/`drawEnvelope` call for dense CPAP lanes because the WebGL2
   * waveform layer composited above paints those instead.
   *
   * Defaults to `false`, in which case this class is the full, self-contained
   * Canvas2D renderer it has always been — byte-identical output, so the
   * existing tests and the automatic Canvas2D fallback path are unchanged. The
   * {@link HybridSignalRenderer} flips this to `true` only when WebGL2 is active
   * and flips it back to `false` whenever it must fall back (no WebGL2 / context
   * lost), so the fallback frame draws the waveforms here too.
   */
  private chromeOnly = false;

  /**
   * Toggle {@link chromeOnly} mode. See that field for semantics. No-op-safe to
   * call repeatedly; the next {@link render}/{@link renderImmediate} reflects it.
   */
  setChromeOnly(enabled: boolean): void {
    this.chromeOnly = enabled;
  }

  /** Whether chrome-only mode is currently active. */
  isChromeOnly(): boolean {
    return this.chromeOnly;
  }

  /**
   * The base canvas element this renderer owns. Exposed so the hybrid compositor
   * ({@link module:components/charts/HybridSignalRenderer}) can CSS-translate the
   * chrome layer during a drag without re-rendering it (the per-frame-upload trap
   * fix). Read-only use only — do not mutate its size/context here.
   */
  getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Failed to obtain Canvas 2D context');
    }
    this.ctx = ctx;
    this.activeCtx = ctx;
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

    // Size the overlay identically so it aligns pixel-perfectly over the base.
    if (this.overlayCanvas && this.overlayCtx) {
      this.overlayCanvas.width = Math.round(width * this.dpr);
      this.overlayCanvas.height = Math.round(height * this.dpr);
      this.overlayCanvas.style.width = `${width}px`;
      this.overlayCanvas.style.height = `${height}px`;
      this.overlayCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // Cache computed style so resolveCSSVar avoids repeated getComputedStyle calls.
    // CSS custom-property tokens are inherited from the shared container, so the
    // base canvas's computed style resolves the same values the overlay would —
    // we keep using it for both passes.
    this.cachedStyle = getComputedStyle(this.canvas);
  }

  /**
   * Attach (or detach with `null`) a transparent overlay canvas for cheap
   * crosshair-only repaints. When set, {@link renderImmediate} stops drawing the
   * crosshair on the base canvas and {@link renderOverlay} draws it here instead,
   * so pointer moves never repaint the waveform stack. Sizing is applied on the
   * next {@link resize}; callers that attach an overlay after the initial resize
   * should resize again so the overlay matches the base dimensions.
   */
  setOverlayCanvas(canvas: HTMLCanvasElement | null): void {
    // Cancel any overlay frame queued against a previous overlay element.
    if (this.pendingOverlayFrame !== null) {
      cancelAnimationFrame(this.pendingOverlayFrame);
      this.pendingOverlayFrame = null;
    }

    if (!canvas) {
      this.overlayCanvas = null;
      this.overlayCtx = null;
      return;
    }

    const octx = canvas.getContext('2d', { alpha: true });
    if (!octx) {
      // Fail soft: without an overlay context we simply keep the legacy
      // crosshair-on-base behaviour rather than throwing on the hot mount path.
      this.overlayCanvas = null;
      this.overlayCtx = null;
      return;
    }

    this.overlayCanvas = canvas;
    this.overlayCtx = octx;

    // Match the current base dimensions immediately so a crosshair drawn before
    // the next resize lands correctly (resize re-applies this for size changes).
    if (this.logicalWidth > 0 && this.logicalHeight > 0) {
      canvas.width = Math.round(this.logicalWidth * this.dpr);
      canvas.height = Math.round(this.logicalHeight * this.dpr);
      canvas.style.width = `${this.logicalWidth}px`;
      canvas.style.height = `${this.logicalHeight}px`;
      octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
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
   * Render the base layer SYNCHRONOUSLY (no rAF coalescing), cancelling any frame
   * already queued. Used by the hybrid compositor on pan-settle so the chrome
   * canvas is repainted at the settled viewport IN THE SAME TICK that its CSS
   * pan-translate is cleared — avoiding a one-frame flash of stale-content /
   * wrong-position that a deferred (rAF) paint would cause. Output is identical to
   * {@link render}; only the timing differs.
   */
  renderSync(viewport: ViewportState, options: RenderOptions): void {
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    this.renderImmediate(viewport, options);
  }

  /**
   * Render ONLY the crosshair overlay (line + time badge + per-lane intersection
   * dots + per-lane value/stage readout badges) onto the overlay canvas, clearing
   * the previous frame first. This is the cheap pointer-move path: it issues no
   * waveform/grid/axis work, so a hover repaints essentially nothing but the
   * crosshair. Coalesced via its own rAF handle, independent of the base
   * {@link render} frame, so a base repaint and an overlay repaint can be queued
   * for the same frame without cancelling each other.
   *
   * No-op when no overlay canvas is attached (the base path keeps drawing the
   * crosshair itself in that case, preserving legacy behaviour).
   */
  renderOverlay(viewport: ViewportState, options: RenderOptions): void {
    if (!this.overlayCtx) return;
    if (this.pendingOverlayFrame !== null) {
      cancelAnimationFrame(this.pendingOverlayFrame);
    }
    this.pendingOverlayFrame = requestAnimationFrame(() => {
      this.pendingOverlayFrame = null;
      this.renderOverlayImmediate(viewport, options);
    });
  }

  /**
   * Synchronous overlay paint. Clears the overlay, then draws the crosshair iff
   * requested. Pixel output is identical to the crosshair the base path used to
   * draw — it reuses {@link drawCrosshair} verbatim, just targeting the overlay
   * context via {@link activeCtx}.
   */
  private renderOverlayImmediate(viewport: ViewportState, options: RenderOptions): void {
    const octx = this.overlayCtx;
    if (!octx) return;

    const w = this.logicalWidth;
    const h = this.logicalHeight;
    if (w <= 0 || h <= 0) return;

    // Reset the per-frame CSS-var cache so the badge/dot colours reflect the
    // current theme (mirrors renderImmediate; never carried across frames).
    this.cssVarFrameCache.clear();

    // Clear the whole overlay (transparent) before redrawing.
    octx.clearRect(0, 0, w, h);

    if (!options.showCrosshair || options.crosshairX === null) return;

    const { padding, channelHeight } = options;
    const plotRight = w - padding.right;
    const plotWidth = plotRight - padding.left;
    if (plotWidth <= 0 || viewport.channels.length === 0) return;
    if (viewport.endTime - viewport.startTime <= 0) return;

    const totalH = totalLaneHeight(viewport.channels, channelHeight);

    // Point the shared draw helpers at the overlay for this pass, then restore.
    this.activeCtx = octx;
    try {
      this.drawCrosshair(viewport, options, padding.left, plotWidth, totalH);
    } finally {
      this.activeCtx = this.ctx;
    }
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

  /** Cancel any pending frame(s) and release references. */
  dispose(): void {
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    if (this.pendingOverlayFrame !== null) {
      cancelAnimationFrame(this.pendingOverlayFrame);
      this.pendingOverlayFrame = null;
    }
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.activeCtx = this.ctx;
  }

  // ── Internal render pipeline ───────────────────────────────────

  private renderImmediate(viewport: ViewportState, options: RenderOptions): void {
    const ctx = this.activeCtx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    if (w <= 0 || h <= 0) return;

    // Start a fresh per-frame CSS-var cache so resolved theme tokens are reused
    // within this frame but never carried across frames (theme/size changes stay
    // live on the next render). Reusing the Map avoids a per-frame allocation.
    this.cssVarFrameCache.clear();

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
      } else if (this.chromeOnly && isDenseCpapWaveform(ch) && ch.webglLane) {
        // Hybrid composition (ADR 0019): the dense-CPAP waveform itself is painted
        // by the WebGL2 layer above. Skip drawLine/drawEnvelope here, but the
        // background/grid/markers/axis for this lane were already drawn above so
        // the chrome is complete. Wearable line lanes (kind: 'wearable') are NOT
        // dense CPAP and still draw here.
        //
        // We only skip when the lane actually carries WebGL geometry (`webglLane`).
        // Before the host's decimation pyramid lands (the first frame[s]), a dense
        // CPAP lane has no `webglLane`, so the WebGL layer cannot paint it yet — we
        // draw the polyline HERE so the waveform is never invisible during that
        // window. Once `webglLane` is attached, WebGL takes over and chrome skips
        // it. This keeps the two layers mutually exclusive AND gap-free.
        // (Intentional no-op: the waveform for this lane is painted by WebGL.)
      } else {
        this.drawLine(ch, viewport, plotLeft, plotWidth, stripTop, stripHeight);
      }

      // Channel name label is drawn by the HTML lane header overlay, not on the
      // canvas. The waveform layout still reserves the top label strip (see the
      // `innerTop` insets in the draw* methods) so the line never renders under
      // the floating HTML label.

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

    // Crosshair overlay. When a dedicated overlay canvas is attached the
    // crosshair is drawn there instead (see renderOverlay), so the base never
    // repaints it on hover. With NO overlay (legacy/back-compat path) the
    // crosshair is still drawn on the base exactly as before.
    if (!this.overlayCtx && options.showCrosshair && options.crosshairX !== null) {
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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

    // Zoomed-OUT fidelity path: when a per-column MIN/MAX envelope is attached,
    // draw it instead of the LTTB polyline (a true envelope cannot hide a spike
    // the polyline's vertex-picking can skip). Only dense CPAP line lanes carry
    // an envelope; everything else (and zoomed-in CPAP) draws the polyline below,
    // byte-identical to before.
    if (ch.envelope && ch.envelope.columns > 0) {
      this.drawEnvelope(ch, plotLeft, plotWidth, stripTop, stripHeight, innerTop, innerBottom);
      return;
    }

    const times = ch.sampleTimes && ch.sampleTimes.length === data.length ? ch.sampleTimes : null;
    const msPerSample = durationMs / data.length;

    // LOAD-BEARING CLIP (defense in depth): the lane display bounds are now a
    // hybrid clinical domain that may not cover every sample (e.g. a clamped
    // corrupt spike). This rect clip guarantees an out-of-domain sample can
    // never paint into a neighbouring lane. Do not remove. (Same rationale for
    // the clips in drawStep and drawRibbon below.)
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, stripTop, plotWidth, stripHeight);
    ctx.clip();

    ctx.strokeStyle = ch.color;
    ctx.lineWidth = ch.lineWidth ?? DENSE_LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    // Hoist per-sample loop invariants: this is the densest loop in the renderer
    // (one iteration per CPAP sample, 25–50 Hz), so avoiding repeated property
    // reads and the divide-per-sample meaningfully cuts work during wheel-zoom
    // and drag-pan. Arithmetic is identical — same x/y as before.
    const { startTime } = viewport;
    const xScale = plotWidth / durationMs;
    const xMin = plotLeft - 2;
    const xMax = plotLeft + plotWidth + 2;
    const { physicalMin } = ch;

    // For the uniform-cadence (CPAP) path, x is strictly monotonic in `s`
    // (`x = plotLeft + s * msPerSample * xScale`), so the first on-screen sample
    // can be solved for directly instead of iterating-and-`continue`-ing across
    // every leading off-screen sample. When zoomed in on a long session this
    // turns an O(total samples) skip into O(1), which is the dominant cost during
    // wheel-zoom and drag-pan. The timestamped path keeps scanning from 0 because
    // its samples are not guaranteed uniform. The per-sample `x < xMin` guard
    // below is retained as a correctness safety net (a no-op for the indices we
    // skip), so the rendered polyline is identical.
    let startIndex = 0;
    if (!times && msPerSample > 0) {
      const firstVisibleMs = (xMin - plotLeft) / xScale;
      const candidate = Math.floor(firstVisibleMs / msPerSample);
      if (candidate > 0) startIndex = Math.min(candidate, data.length);
    }

    let firstPoint = true;
    for (let s = startIndex; s < data.length; s++) {
      const tMs = times ? (times[s] ?? 0) - startTime : s * msPerSample;
      const x = plotLeft + tMs * xScale;
      if (x < xMin) {
        if (!times) continue;
        // For timestamped data we may still need the prior point; keep scanning.
      }
      if (x > xMax && !times) break;

      const sample = data[s];
      if (sample === undefined || Number.isNaN(sample)) {
        firstPoint = true; // break the line across missing samples
        continue;
      }
      const normY = (sample - physicalMin) / physRange;
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
   * Zoomed-OUT MIN/MAX envelope for dense CPAP waveform lanes — the fidelity
   * replacement for the LTTB polyline when more than ~1 source sample maps to
   * each output pixel column.
   *
   * For each column `c` the channel carries the physical `min[c]`/`max[c]` of all
   * source samples in that column (computed upstream from a pyramid level dense
   * enough to have several samples per column — never from the already-reduced
   * `data`). We build ONE continuous closed path: the upper boundary (`max`)
   * left→right, then the lower boundary (`min`) right→left. Stroking AND filling
   * that path in the lane colour renders a solid waveform band whose vertical
   * extent at every x is the true range of the signal there — so a 1-sample spike
   * or notch ALWAYS reaches a pixel (it is, by definition, that column's min or
   * max). At the zoomed-in boundary each column holds ≈1 sample, so min≈max, the
   * band collapses to a ~1px ribbon, and the look matches the polyline it replaces
   * — the transition is seamless.
   *
   * RENDERING CHOICE (weight/colour to match today's 1.2px line): we FILL the band
   * in the lane colour and STROKE its outline at the same {@link DENSE_LINE_WIDTH}.
   * Where the band is thin (≈1px) the fill+stroke reads as a 1.2px line; where it
   * is tall it reads as a solid envelope — matching the perceived weight/colour of
   * the existing waveform across the threshold.
   *
   * NaN / GAPS: a column with `min === max === NaN` is a gap; it BREAKS the path
   * into a separate sub-band (no bridge across missing data), exactly as
   * {@link drawLine} breaks the polyline on NaN. Each contiguous run of real
   * columns is emitted as its own closed band.
   *
   * The load-bearing per-lane clip (see {@link drawLine}) is preserved so a
   * clamped out-of-domain extreme can never paint into a neighbouring lane.
   */
  private drawEnvelope(
    ch: SignalChannel,
    plotLeft: number,
    plotWidth: number,
    stripTop: number,
    stripHeight: number,
    innerTop: number,
    innerBottom: number,
  ): void {
    const env = ch.envelope;
    if (!env) return;
    const ctx = this.activeCtx;

    const innerHeight = innerBottom - innerTop;
    const physRange = ch.physicalMax - ch.physicalMin;
    const { physicalMin } = ch;
    const cols = env.columns;
    const { min, max } = env;

    // Column → x: columns map left→right across the plot width. Use the column
    // CENTRE so the first and last columns sit just inside the plot edges,
    // matching the polyline's first/last sample placement closely.
    const xScale = cols > 0 ? plotWidth / cols : 0;
    const yOf = (v: number): number => innerBottom - ((v - physicalMin) / physRange) * innerHeight;

    // LOAD-BEARING CLIP (defense in depth): identical guarantee to drawLine — an
    // out-of-domain (clamped) extreme must never paint into a neighbour lane. Do
    // not remove.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, stripTop, plotWidth, stripHeight);
    ctx.clip();

    ctx.strokeStyle = ch.color;
    ctx.fillStyle = ch.color;
    ctx.lineWidth = ch.lineWidth ?? DENSE_LINE_WIDTH;
    ctx.lineJoin = 'round';

    // Walk the columns, emitting one closed band per contiguous run of non-gap
    // columns. A run boundary is a NaN column (gap) — the band breaks there.
    let runStart = -1;
    const flushRun = (start: number, endExcl: number): void => {
      // endExcl is exclusive; a run needs at least one column.
      if (start < 0 || endExcl <= start) return;
      ctx.beginPath();
      // Upper boundary (max) left→right.
      for (let c = start; c < endExcl; c++) {
        const x = plotLeft + (c + 0.5) * xScale;
        const y = yOf(max[c] as number);
        if (c === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Lower boundary (min) right→left, closing the band.
      for (let c = endExcl - 1; c >= start; c--) {
        const x = plotLeft + (c + 0.5) * xScale;
        ctx.lineTo(x, yOf(min[c] as number));
      }
      ctx.closePath();
      // Fill the band, then stroke its outline so a thin (≈1px) band reads as a
      // ~1.2px line and a tall band reads as a solid envelope — matching weight.
      ctx.fill();
      ctx.stroke();
    };

    for (let c = 0; c < cols; c++) {
      const isGap = Number.isNaN(min[c] as number) || Number.isNaN(max[c] as number);
      if (isGap) {
        if (runStart >= 0) {
          flushRun(runStart, c);
          runStart = -1;
        }
      } else if (runStart < 0) {
        runStart = c;
      }
    }
    if (runStart >= 0) flushRun(runStart, cols);

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
    const ctx = this.activeCtx;
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

    // LOAD-BEARING CLIP (defense in depth): keeps out-of-domain samples from
    // painting a neighbouring lane. See the note in drawLine. Do not remove.
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
    const ctx = this.activeCtx;
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

    // LOAD-BEARING CLIP (defense in depth): keeps out-of-domain samples from
    // painting a neighbouring lane. See the note in drawLine. Do not remove.
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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

  private drawYAxis(
    ch: SignalChannel,
    plotLeft: number,
    stripTop: number,
    channelHeight: number,
  ): void {
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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
    const ctx = this.activeCtx;
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

  /**
   * Resolve a CSS custom property to its computed value with a fallback.
   *
   * The raw (trimmed) computed value is memoised in {@link cssVarFrameCache} for
   * the duration of one render frame, so tokens resolved repeatedly within a
   * frame (grid/axis colours) only hit `getPropertyValue` once. The fallback is
   * applied per call from the cached raw value, so call sites that share a
   * `varName` but pass different fallbacks never interfere. The cache is cleared
   * at the start of each frame, so theme/size changes are reflected on the next
   * render.
   */
  private resolveCSSVar(varName: string, fallback: string): string {
    const cached = this.cssVarFrameCache.get(varName);
    if (cached !== undefined) {
      return cached || fallback;
    }
    let raw = '';
    try {
      const style = this.cachedStyle ?? getComputedStyle(this.canvas);
      raw = style.getPropertyValue(varName).trim();
    } catch {
      raw = '';
    }
    this.cssVarFrameCache.set(varName, raw);
    return raw || fallback;
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
