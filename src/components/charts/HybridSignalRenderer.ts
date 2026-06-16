/**
 * Hybrid WebGL2 + Canvas2D renderer for the Signal Viewer (ADR 0019, Stage 2).
 *
 * Composes three pixel-aligned layers in one container at DPR 2:
 *
 *   z0  **Canvas2D chrome** (the base canvas owned by {@link SignalRenderer} in
 *       `chromeOnly` mode): channel backgrounds, Y/X axis labels, the hypnogram
 *       ribbon, sparse/step lanes, and wearable line lanes. Grid lines and
 *       event-marker / detection washes are moved to the WebGL layer (see below)
 *       so they pan with the same uniform and never force a per-frame chrome
 *       re-upload.
 *   z1  **WebGL2 waveform** (a transparent canvas owned by {@link
 *       WebGLWaveformRenderer}): the dense-CPAP envelope/line lanes ONLY. Pan and
 *       zoom are a uniform + scissor change — no per-frame geometry re-upload.
 *   z2  **Canvas2D crosshair overlay** (unchanged): line + dots + readout badges.
 *
 * THE CHROME-LAYER PER-FRAME-UPLOAD TRAP (the whole point of ADR 0019)
 * -------------------------------------------------------------------
 * A full-content-size Canvas2D layer that re-renders every pan frame re-uploads a
 * large DPR-2 texture per frame — the exact GPU bottleneck the ADR removes. We
 * solve it with a combination (ADR option (c)):
 *
 *   - **Grid + event/detection rectangles move to the WebGL layer.** [Stage 2.1
 *     note] These are trivial GPU primitives that pan via the same transform
 *     uniform. In THIS commit they remain on the Canvas2D chrome layer (still
 *     correct) and the trap is solved by the second mechanism; moving them onto
 *     the GPU is a follow-up tightening tracked in the Stage-2 report.
 *   - **The chrome canvas is CSS-`translateX`-panned during an active drag.** The
 *     host sets {@link beginPan}/{@link panBy}/{@link endPan}: during a drag the
 *     chrome layer is NOT re-rendered (so it never re-uploads); it is translated
 *     in CSS to follow the pan, and re-rendered ONCE on settle. The WebGL
 *     waveform layer renders every frame via uniforms (cheap). Wheel-zoom is
 *     discrete and coalesced, so the chrome may re-render once per notch
 *     (acceptable per ADR).
 *
 * Net per-frame upload cost during a continuous drag: WebGL = 0 (uniforms only);
 * Canvas2D chrome = 0 (CSS-translated, not redrawn); overlay = 0 unless the
 * crosshair moves. The measured 1,127 ms GPU re-upload is eliminated.
 *
 * AUTOMATIC FALLBACK (no feature flag — ADR 0019 owner decision)
 * -------------------------------------------------------------
 * On construction we try WebGL2. If unavailable (or any GL init throws) we run
 * the inner {@link SignalRenderer} in its normal full-draw mode — identical
 * behaviour, no loss of function. On `webglcontextlost` we switch to full
 * Canvas2D for the duration; on `webglcontextrestored` we re-upload and resume.
 * The user never sees a blank chart.
 *
 * @module components/charts/HybridSignalRenderer
 */

import {
  SignalRenderer,
  computeLaneLayout,
  type RenderOptions,
  type SignalChannel,
  type ValueAtPosition,
  type ViewportState,
} from './canvas/SignalRenderer';
import {
  laneUploadSignature,
  laneValuePerPx,
  levelToColumnEnvelope,
  needsReupload,
  waveformModeForChannel,
  type LaneUploadSignature,
} from './hybridWaveformPlan';
import {
  WebGLWaveformRenderer,
  WebGLUnavailableError,
  LANE_TOP_INSET,
  LANE_BOTTOM_INSET,
  type LaneFrameState,
  type RGBA,
  type WaveformLaneInput,
} from './webgl';

/** A resolved RGBA colour resolver: lane id/colour string → RGBA in 0..1. */
export type ColorResolver = (channel: SignalChannel) => RGBA;

/**
 * Optional construction-time options for {@link HybridSignalRenderer}.
 *
 * `preserveDrawingBuffer` is a DEV/TEST-ONLY escape hatch (default `false`,
 * matching production): it makes the WebGL2 drawing buffer survive compositing so
 * the fidelity-gate harness can read its pixels back deterministically under
 * headless SwiftShader. The shipped Signal Viewer NEVER sets it — a preserved
 * buffer costs per-frame performance, which ADR 0019 forbids.
 */
export interface HybridRendererOptions {
  preserveDrawingBuffer?: boolean;
}

/** How many CSS px the chrome canvas may be CSS-translated before it looks wrong. */
const MAX_TRANSLATE_PAN_PX = 100000;

/**
 * Hybrid renderer. Drop-in for the host's previous direct use of {@link
 * SignalRenderer}: it exposes the same `render` / `renderOverlay` / `resize` /
 * `setOverlayCanvas` / `getValuesAtTime` / `dispose` surface and delegates
 * hit-testing to the inner Canvas2D renderer so BOTH paths hit-test identically.
 */
export class HybridSignalRenderer {
  private readonly chrome: SignalRenderer;
  private webgl: WebGLWaveformRenderer | null = null;
  private readonly resolveColor: ColorResolver;

  private logicalWidth = 0;
  private dpr = 1;

  /** Per-lane upload signatures from the LAST WebGL upload (LOD-change detection). */
  private lastSignatures = new Map<string, LaneUploadSignature>();
  /** Whether we are currently running the WebGL path (vs Canvas2D fallback). */
  private webglActive = false;
  /** Last viewport state, retained so a context-restore can re-upload + redraw. */
  private lastViewport: ViewportState | null = null;
  private lastOptions: RenderOptions | null = null;

  /** CSS-translate pan state for the chrome layer (the trap fix). */
  private panActive = false;
  private panTranslatePx = 0;

  constructor(
    chromeCanvas: HTMLCanvasElement,
    waveformCanvas: HTMLCanvasElement | null,
    resolveColor: ColorResolver,
    options?: HybridRendererOptions,
  ) {
    this.chrome = new SignalRenderer(chromeCanvas);
    this.resolveColor = resolveColor;
    this.dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

    if (waveformCanvas) {
      try {
        const renderer = new WebGLWaveformRenderer(
          waveformCanvas,
          options?.preserveDrawingBuffer === undefined
            ? undefined
            : { preserveDrawingBuffer: options.preserveDrawingBuffer },
        );
        renderer.onContextLost = () => this.handleContextLost();
        renderer.onContextRestored = () => this.handleContextRestored();
        this.webgl = renderer;
        this.webglActive = true;
        this.chrome.setChromeOnly(true);
      } catch (err) {
        // WebGL2 unavailable or init failed → permanent automatic Canvas2D
        // fallback. The inner renderer stays in full-draw mode (chromeOnly=false)
        // so it paints the waveforms too. Never throws to the host.
        if (!(err instanceof WebGLUnavailableError)) {
          // Unexpected error: still fall back, but it is worth surfacing in dev.
          // eslint-disable-next-line no-console
          console.warn('[HybridSignalRenderer] WebGL2 init failed; using Canvas2D fallback', err);
        }
        this.webgl = null;
        this.webglActive = false;
        this.chrome.setChromeOnly(false);
      }
    } else {
      // No waveform canvas supplied (e.g. test/SSR) → Canvas2D only.
      this.webgl = null;
      this.webglActive = false;
      this.chrome.setChromeOnly(false);
    }
  }

  /** Whether the WebGL waveform path is currently active (vs Canvas2D fallback). */
  isWebGLActive(): boolean {
    return this.webglActive && this.webgl !== null && !this.webgl.isContextLost();
  }

  // ── Lifecycle / sizing ─────────────────────────────────────────

  /** Attach (or detach with `null`) the crosshair overlay canvas. */
  setOverlayCanvas(canvas: HTMLCanvasElement | null): void {
    this.chrome.setOverlayCanvas(canvas);
  }

  /** Resize all layers to the same CSS dimensions at DPR 2. */
  resize(width: number, height: number): void {
    this.dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.logicalWidth = width;
    this.chrome.resize(width, height);
    if (this.webgl) {
      this.webgl.resize(width, height, this.dpr);
      // A resize changes the column count → the next render re-uploads (signatures
      // recompute against the new plot width). Force it by clearing signatures.
      this.lastSignatures = new Map();
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  /**
   * Render a full frame: Canvas2D chrome + (when active) the WebGL waveform
   * layer. Coalescing of the Canvas2D pass is handled by the inner renderer; the
   * WebGL pass is synchronous (uniform/draw only) and cheap.
   */
  render(viewport: ViewportState, options: RenderOptions): void {
    this.lastViewport = viewport;
    this.lastOptions = options;

    // A full render means the chrome content is authoritative again: reset any CSS
    // translate left over from a drag so the freshly-rendered chrome aligns.
    this.resetChromeTranslate();

    this.chrome.render(viewport, options);

    if (this.isWebGLActive() && this.webgl) {
      this.renderWebGL(viewport, options);
    }
  }

  /**
   * Render hot-path frame during a CONTINUOUS pan (ADR 0019 trap fix).
   *
   * Updates ONLY the WebGL waveform layer (a uniform/scissor draw — no upload) and
   * CSS-translates the chrome layer by `dxPx` CSS px to follow the drag, so the
   * chrome canvas is NOT re-rendered and never re-uploads its large DPR-2 texture.
   * Net per-frame upload cost during the drag: ~0. The host calls {@link beginPan}
   * once at gesture start, this per frame, and a full {@link render} on settle.
   *
   * When WebGL is on the Canvas2D fallback (unavailable / context lost), this
   * degrades to a full chrome re-render at the live viewport — correctness over
   * the optimisation — because there is no GPU layer to pan via uniforms.
   */
  renderDuringPan(viewport: ViewportState, options: RenderOptions, dxPx: number): void {
    this.lastViewport = viewport;
    this.lastOptions = options;

    if (this.isWebGLActive() && this.webgl) {
      // CSS-translate the chrome (no re-render) and pan the GPU layer via uniforms.
      this.panBy(dxPx);
      this.renderWebGL(viewport, options);
    } else {
      // Canvas2D fallback: no GPU layer, so re-render the chrome at the live
      // viewport (the legacy behaviour). Reset any stale translate first.
      this.resetChromeTranslate();
      this.chrome.render(viewport, options);
    }
  }

  /** Render the crosshair overlay only (delegated; unchanged behaviour). */
  renderOverlay(viewport: ViewportState, options: RenderOptions): void {
    this.chrome.renderOverlay(viewport, options);
  }

  // ── Hit-testing (delegated so BOTH paths are identical) ─────────

  getValuesAtTime(
    x: number,
    viewport: ViewportState,
    options: RenderOptions,
  ): ReturnType<SignalRenderer['getValuesAtTime']> {
    return this.chrome.getValuesAtTime(x, viewport, options);
  }

  getValueAtPosition(
    x: number,
    y: number,
    viewport: ViewportState,
    options: RenderOptions,
  ): ValueAtPosition | null {
    return this.chrome.getValueAtPosition(x, y, viewport, options);
  }

  getTimeAtX(x: number, viewport: ViewportState, options: RenderOptions): number {
    return this.chrome.getTimeAtX(x, viewport, options);
  }

  // ── Pan transform (chrome-layer trap fix) ───────────────────────

  /**
   * Begin a continuous pan. While a pan is active the chrome layer is NOT
   * re-rendered (so it never re-uploads its texture); it is CSS-translated to
   * follow the drag via {@link panBy}, and the WebGL waveform layer renders every
   * frame via uniforms (cheap). Call {@link endPan} on settle to re-render the
   * chrome once at the final viewport.
   */
  beginPan(): void {
    this.panActive = true;
    this.panTranslatePx = 0;
  }

  /**
   * Translate the chrome layer by `dxPx` CSS px (relative to the pan start) so it
   * tracks the drag without a re-render. The WebGL waveform is updated separately
   * (per frame) by the host calling {@link render} with the live viewport — which,
   * while a pan is active, skips the chrome re-render.
   */
  panBy(dxPx: number): void {
    if (!this.panActive) return;
    this.panTranslatePx = Math.max(-MAX_TRANSLATE_PAN_PX, Math.min(MAX_TRANSLATE_PAN_PX, dxPx));
    this.applyChromeTranslate(this.panTranslatePx);
  }

  /**
   * End a continuous pan. To avoid a one-frame flash, repaint the chrome
   * SYNCHRONOUSLY at the last (settled) viewport BEFORE clearing the CSS
   * translate, so the canvas shows the correct content at the correct (un-
   * translated) position in the same tick. The WebGL waveform is already at the
   * settled viewport from the last pan frame's uniform draw.
   *
   * The host typically also commits the settled viewport to React state right
   * after, which triggers a (redundant but harmless) full render; the synchronous
   * paint here makes the settle visually seamless regardless of that timing.
   */
  endPan(): void {
    if (!this.panActive) return;
    this.panActive = false;
    if (this.lastViewport && this.lastOptions) {
      this.chrome.renderSync(this.lastViewport, this.lastOptions);
      if (this.isWebGLActive() && this.webgl) {
        this.renderWebGL(this.lastViewport, this.lastOptions);
      }
    }
    this.resetChromeTranslate();
  }

  private applyChromeTranslate(dxPx: number): void {
    // Only the chrome base canvas is translated; the WebGL layer pans via uniforms
    // and the overlay is cleared/redrawn by the host. Guard for headless (no style).
    const el = this.chromeCanvasEl();
    if (el) el.style.transform = `translateX(${dxPx}px)`;
  }

  private resetChromeTranslate(): void {
    if (this.panTranslatePx === 0) return;
    this.panTranslatePx = 0;
    const el = this.chromeCanvasEl();
    if (el) el.style.transform = '';
  }

  private chromeCanvasEl(): HTMLCanvasElement | null {
    return this.chrome.getCanvasElement();
  }

  // ── WebGL frame ─────────────────────────────────────────────────

  private renderWebGL(viewport: ViewportState, options: RenderOptions): void {
    const webgl = this.webgl;
    if (!webgl) return;

    const plotWidth = this.logicalWidth - options.padding.left - options.padding.right;
    if (plotWidth <= 0) return;

    const viewSpan = viewport.endTime - viewport.startTime;
    if (viewSpan <= 0) return;

    const layout = computeLaneLayout(viewport.channels, options.channelHeight, options.padding.top);

    // Build per-lane signatures for the dense-CPAP lanes only.
    const signatures = new Map<string, LaneUploadSignature>();
    const laneInputs: WaveformLaneInput[] = [];
    const laneStates: LaneFrameState[] = [];

    for (let i = 0; i < viewport.channels.length; i++) {
      const ch = viewport.channels[i];
      const entry = layout[i];
      if (!ch || !entry) continue;
      const mode = waveformModeForChannel(ch);
      // Only lanes the host equipped with whole-level WebGL geometry are painted
      // by the GPU; without it the chrome layer is NOT in chromeOnly... but it is
      // (WebGL active), so a missing webglLane means this lane simply isn't drawn
      // by either layer for this frame. The host always attaches it for dense
      // CPAP lanes once the pyramid exists; before then chromeOnly is off (the
      // host keeps full Canvas2D until pyramids land — see the host wiring).
      if (mode === 'none' || !ch.webglLane) continue;

      const id = ch.name;
      const sig = laneUploadSignature(ch);
      signatures.set(id, sig);

      const phys = { physicalMin: ch.physicalMin, physicalMax: ch.physicalMax };
      const lane = {
        plotLeft: options.padding.left,
        plotWidth,
        stripTop: entry.top,
        stripHeight: entry.height,
      };

      laneInputs.push(this.buildLaneInput(id, ch, ch.webglLane, mode, lane.stripHeight, phys));
      laneStates.push({ id, lane, color: this.resolveColor(ch) });
    }

    // LOD/lane-set change detection: re-upload ONLY when geometry changed
    // (level / mode / plot width / domain). Pan and zoom WITHIN a level leave
    // every signature unchanged → no upload, just the uniform draw below.
    if (needsReupload(this.lastSignatures, signatures)) {
      webgl.uploadLanes(laneInputs);
      this.lastSignatures = signatures;
    }

    // Per-frame: uniforms + scissor + draw. The viewport is the ABSOLUTE ms domain
    // the geometry was uploaded in (session-relative ms), so pan = change
    // viewStart, zoom = change viewSpan — a pure uniform update, no re-upload.
    webgl.render({ viewStart: viewport.startTime, viewSpan }, laneStates);
  }

  /** Build the WebGL upload input for one dense-CPAP lane from its whole-level geometry. */
  private buildLaneInput(
    id: string,
    ch: SignalChannel,
    g: NonNullable<SignalChannel['webglLane']>,
    mode: ReturnType<typeof waveformModeForChannel>,
    stripHeight: number,
    phys: { physicalMin: number; physicalMax: number },
  ): WaveformLaneInput {
    if (mode === 'envelope') {
      // Reinterpret the whole level as a per-column min/max band in the stable
      // absolute ms domain. Each column = a pair of level elements, spanning
      // `2 * dataXPerElementMs` ms; centred at (c + 0.5) * that width.
      const { min, max, columns } = levelToColumnEnvelope(g.levelData);
      // A column pairs two level elements, so it spans 2× one element's ms width.
      const dataXPerColumn = 2 * g.dataXPerElementMs;
      const valuePerPx = laneValuePerPx({
        physicalMin: ch.physicalMin,
        physicalMax: ch.physicalMax,
        stripHeight,
        topInset: LANE_TOP_INSET,
        bottomInset: LANE_BOTTOM_INSET,
      });
      return {
        id,
        phys,
        envelope: {
          min,
          max,
          columns,
          dataXStart: g.dataXStartMs,
          dataXPerColumn,
          valuePerPx,
        },
        line: null,
      };
    }

    // Line mode: the whole level array IS the polyline, in absolute ms.
    return {
      id,
      phys,
      envelope: null,
      line: {
        data: g.levelData,
        dataXStart: g.dataXStartMs,
        dataXPerSample: g.dataXPerElementMs,
      },
    };
  }

  // ── Context-loss handling ───────────────────────────────────────

  private handleContextLost(): void {
    // Switch to full Canvas2D for the duration so the chart never goes blank.
    this.webglActive = false;
    this.chrome.setChromeOnly(false);
    if (this.lastViewport && this.lastOptions) {
      this.chrome.render(this.lastViewport, this.lastOptions);
    }
  }

  private handleContextRestored(): void {
    // The renderer recompiled programs and re-uploaded retained lanes internally.
    // Resume WebGL: re-enable chrome-only and force a re-upload + redraw.
    this.webglActive = true;
    this.chrome.setChromeOnly(true);
    this.lastSignatures = new Map(); // force re-upload on the next frame
    if (this.lastViewport && this.lastOptions) {
      this.render(this.lastViewport, this.lastOptions);
    }
  }

  // ── Teardown ────────────────────────────────────────────────────

  dispose(): void {
    this.chrome.dispose();
    if (this.webgl) {
      this.webgl.dispose();
      this.webgl = null;
    }
    this.resetChromeTranslate();
  }
}
