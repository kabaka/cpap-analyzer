/**
 * Unit tests for the hybrid renderer's WebGL-ACTIVE orchestration (ADR 0019,
 * Stage 2).
 *
 * jsdom has no WebGL2, so the sibling `HybridSignalRenderer.test.ts` can only
 * exercise the Canvas2D FALLBACK path. The pure-TS orchestration that runs ONLY
 * when WebGL is live — putting the inner Canvas2D renderer into `chromeOnly`
 * mode, gating `uploadLanes` via the re-upload signature, and the
 * context-lost/restored transitions — is therefore covered here by MOCKING the
 * GL-context-bound {@link WebGLWaveformRenderer} with a pure stub. The real GL
 * draw is validated by the CI pixel-diff fidelity gate, not here.
 *
 * The mock seam: `HybridSignalRenderer` obtains its renderer via a direct
 * `new WebGLWaveformRenderer(canvas)` from `'../webgl'`. We `vi.mock` that module
 * to swap ONLY the class for a controllable stub, keeping the REAL
 * `WebGLUnavailableError` and the real `LANE_TOP_INSET`/`LANE_BOTTOM_INSET`
 * constants so the orchestration runs against genuine collaborators.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RenderOptions, SignalChannel, ViewportState } from '../canvas/SignalRenderer';

// ── Mock the WebGL renderer module ────────────────────────────────
// We replace ONLY `WebGLWaveformRenderer` with a stub class whose methods are
// `vi.fn()`s, while re-exporting the real error class and layout constants from
// the actual module so the orchestration runs against the genuine collaborators.

// `vi.mock` is hoisted above all top-level code, so the stub class and its
// control state must be created inside `vi.hoisted` (also hoisted) and shared
// via the returned object. We read those handles through `mockState`.

const mockState = vi.hoisted(() => {
  /** Controls whether the next mock construction throws (and with what). */
  const ctorControl: { throwError: Error | null } = { throwError: null };
  /** The most recently constructed mock instance (one hybrid → one renderer). */
  const ref: { last: MockWebGLWaveformRenderer | null } = { last: null };

  class MockWebGLWaveformRenderer {
    onContextLost: (() => void) | null = null;
    onContextRestored: (() => void) | null = null;

    private contextLost = false;

    readonly resize = vi.fn<(cssW: number, cssH: number, dpr: number) => void>();
    readonly uploadLanes =
      vi.fn<(lanes: readonly import('../webgl').WaveformLaneInput[]) => void>();
    readonly render =
      vi.fn<
        (
          viewport: import('../webgl').ViewportX,
          laneStates: readonly import('../webgl').LaneFrameState[],
        ) => void
      >();
    readonly dispose = vi.fn<() => void>();

    constructor(canvas: HTMLCanvasElement) {
      void canvas; // signature parity with the real renderer; unused in the stub
      if (ctorControl.throwError) throw ctorControl.throwError;
      ref.last = this;
    }

    isContextLost(): boolean {
      return this.contextLost;
    }

    /** Test helper: simulate the GL context being lost (fires the host callback). */
    simulateContextLost(): void {
      this.contextLost = true;
      this.onContextLost?.();
    }

    /** Test helper: simulate the GL context being restored (fires the host callback). */
    simulateContextRestored(): void {
      this.contextLost = false;
      this.onContextRestored?.();
    }
  }

  return { ctorControl, ref, MockWebGLWaveformRenderer };
});

type MockWebGLWaveformRenderer = InstanceType<typeof mockState.MockWebGLWaveformRenderer>;
const ctorControl = mockState.ctorControl;

vi.mock('../webgl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../webgl')>();
  return {
    ...actual,
    WebGLWaveformRenderer: mockState.MockWebGLWaveformRenderer,
  };
});

// Imported AFTER the mock declaration; `vi.mock` is hoisted so the SUT sees the
// stub. `WebGLUnavailableError` here is the REAL class (re-exported above).
import { HybridSignalRenderer } from '../HybridSignalRenderer';
import { WebGLUnavailableError } from '../webgl';

// ── 2D context stub (jsdom returns null for both 'webgl2' and '2d') ──
// The inner SignalRenderer needs a working 2D context. The mock GL renderer no
// longer depends on the 'webgl2' branch (it never calls getContext), so we only
// need to satisfy '2d'.

function createMockContext2D(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    roundRect: vi.fn(),
    fill: vi.fn(),
    clearRect: vi.fn(),
    arc: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    canvas: document.createElement('canvas'),
    getContextAttributes: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  ctorControl.throwError = null;
  mockState.ref.last = null;
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
    if (type === '2d') return createMockContext2D();
    return null;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
});

// ── Fixtures ──────────────────────────────────────────────────────

type WebGLLane = NonNullable<SignalChannel['webglLane']>;

function makeWebGLLane(over: Partial<WebGLLane> = {}): WebGLLane {
  return {
    mode: 'envelope',
    levelData: new Float32Array([0, 10, -10, 5, -3, 8]),
    levelIndex: 2,
    dataXPerElementMs: 40,
    dataXStartMs: 0,
    plotWidthColumns: 920,
    physRange: 120,
    ...over,
  };
}

/** A dense-CPAP lane equipped with WebGL geometry (the kind the GPU paints). */
function makeChannel(over: Partial<SignalChannel> = {}): SignalChannel {
  return {
    name: 'Flow',
    data: new Float32Array([0, 10, -10, 5, 0]),
    sampleRate: 25,
    unit: 'L/min',
    color: '#3366cc',
    physicalMin: -60,
    physicalMax: 60,
    kind: 'cpap',
    render: 'line',
    webglLane: makeWebGLLane(),
    ...over,
  };
}

function makeViewport(over: Partial<ViewportState> = {}): ViewportState {
  return { startTime: 0, endTime: 1000, channels: [makeChannel()], ...over };
}

function makeOptions(over: Partial<RenderOptions> = {}): RenderOptions {
  return {
    showCrosshair: false,
    crosshairX: null,
    showGrid: true,
    eventMarkers: [],
    channelHeight: 150,
    padding: { top: 20, right: 24, bottom: 28, left: 56 },
    ...over,
  };
}

const resolveColor = () => ({ r: 0.2, g: 0.4, b: 0.8, a: 1 });

/** Construct a hybrid whose WebGL path is engaged, sized and rendered once. */
function makeActiveHybrid(): { r: HybridSignalRenderer; gl: MockWebGLWaveformRenderer } {
  const base = document.createElement('canvas');
  const waveform = document.createElement('canvas');
  const r = new HybridSignalRenderer(base, waveform, resolveColor);
  r.resize(800, 400);
  const gl = mockState.ref.last;
  if (!gl) throw new Error('expected a mock WebGL renderer to be constructed');
  return { r, gl };
}

// ── 1. WebGL available → WebGL path engaged ───────────────────────

describe('HybridSignalRenderer — WebGL active orchestration', () => {
  it('engages the WebGL path: inner renderer is chrome-only and the GL layer uploads + renders', () => {
    const { r, gl } = makeActiveHybrid();
    expect(r.isWebGLActive()).toBe(true);

    r.render(makeViewport(), makeOptions());

    // The dense-CPAP lane carries webglLane → the GPU paints it, so it uploaded
    // geometry and issued a per-frame draw.
    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);
    expect(gl.render).toHaveBeenCalledTimes(1);

    // The single uploaded lane is the equipped Flow lane.
    const uploaded = gl.uploadLanes.mock.calls[0]?.[0];
    expect(uploaded?.length).toBe(1);
    expect(uploaded?.[0]?.id).toBe('Flow');

    r.dispose();
  });

  it('puts the inner Canvas2D renderer into chrome-only mode (waveform skipped by 2D)', () => {
    // We assert chrome-only indirectly via behaviour: a chrome-only inner renderer
    // does NOT draw the dense polyline, but the resolveColor resolver IS invoked
    // for the GPU lane. (The Canvas2D fallback suite asserts the inverse.)
    const base = document.createElement('canvas');
    const waveform = document.createElement('canvas');
    const colorSpy = vi.fn(resolveColor);
    const r = new HybridSignalRenderer(base, waveform, colorSpy);
    r.resize(800, 400);
    r.render(makeViewport(), makeOptions());
    // The GPU lane draw resolves a colour — only reachable on the WebGL path.
    expect(colorSpy).toHaveBeenCalled();
    r.dispose();
  });
});

// ── 2. Construction failure → Canvas2D fallback ───────────────────

describe('HybridSignalRenderer — construction failure falls back to Canvas2D', () => {
  it('falls back (does not throw) when GL construction raises WebGLUnavailableError', () => {
    ctorControl.throwError = new WebGLUnavailableError();
    const base = document.createElement('canvas');
    const waveform = document.createElement('canvas');

    let r!: HybridSignalRenderer;
    expect(() => {
      r = new HybridSignalRenderer(base, waveform, resolveColor);
    }).not.toThrow();
    expect(r.isWebGLActive()).toBe(false);

    // Full-draw mode: rendering does not throw and never touches a GL renderer.
    r.resize(800, 400);
    expect(() => r.render(makeViewport(), makeOptions())).not.toThrow();
    expect(mockState.ref.last).toBeNull();
    r.dispose();
  });

  it('falls back (does not throw) when GL construction raises a generic Error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ctorControl.throwError = new Error('unexpected GL init explosion');
    const base = document.createElement('canvas');
    const waveform = document.createElement('canvas');

    let r!: HybridSignalRenderer;
    expect(() => {
      r = new HybridSignalRenderer(base, waveform, resolveColor);
    }).not.toThrow();
    expect(r.isWebGLActive()).toBe(false);
    // A non-WebGLUnavailableError is surfaced as a dev warning before falling back.
    expect(warn).toHaveBeenCalled();

    r.resize(800, 400);
    expect(() => r.render(makeViewport(), makeOptions())).not.toThrow();
    r.dispose();
    warn.mockRestore();
  });

  it('runs the inner renderer in full-draw mode (draws the waveform itself) on fallback', () => {
    ctorControl.throwError = new WebGLUnavailableError();
    const base = document.createElement('canvas');
    const waveform = document.createElement('canvas');
    const colorSpy = vi.fn(resolveColor);
    const r = new HybridSignalRenderer(base, waveform, colorSpy);
    r.resize(800, 400);
    r.render(makeViewport(), makeOptions());
    // No GPU lane draw on the fallback → the colour resolver is never consulted.
    expect(colorSpy).not.toHaveBeenCalled();
    r.dispose();
  });
});

// ── 3 & 4. Context loss / restore transitions ─────────────────────

describe('HybridSignalRenderer — context loss and restore', () => {
  it('webglcontextlost → switches to full Canvas2D and repaints (chart never blank)', () => {
    const { r, gl } = makeActiveHybrid();
    r.render(makeViewport(), makeOptions());
    expect(r.isWebGLActive()).toBe(true);

    gl.uploadLanes.mockClear();
    gl.render.mockClear();

    gl.simulateContextLost();

    // No longer active: the host now drives the full Canvas2D draw.
    expect(r.isWebGLActive()).toBe(false);
    // The lost handler repainted via the inner renderer, NOT via the GL layer.
    expect(gl.render).not.toHaveBeenCalled();
    expect(gl.uploadLanes).not.toHaveBeenCalled();

    // Subsequent frames stay on Canvas2D and do not touch the GL renderer.
    r.render(makeViewport(), makeOptions());
    expect(gl.render).not.toHaveBeenCalled();
    r.dispose();
  });

  it('webglcontextrestored → re-uploads retained lanes, re-enables chrome-only, redraws', () => {
    const { r, gl } = makeActiveHybrid();
    r.render(makeViewport(), makeOptions());

    gl.simulateContextLost();
    expect(r.isWebGLActive()).toBe(false);

    gl.uploadLanes.mockClear();
    gl.render.mockClear();

    gl.simulateContextRestored();

    // Resumed: active again, and the restore forced a re-upload + redraw of the
    // retained lane (signatures were cleared so the next frame must re-upload).
    expect(r.isWebGLActive()).toBe(true);
    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);
    expect(gl.render).toHaveBeenCalledTimes(1);
    expect(gl.uploadLanes.mock.calls[0]?.[0]?.[0]?.id).toBe('Flow');
    r.dispose();
  });
});

// ── 5 & 6. Re-upload gating via the upload signature ──────────────

describe('HybridSignalRenderer — uploadLanes gating (the load-bearing trap fix)', () => {
  it('issues ZERO additional uploads on pan/zoom within a level (same signature)', () => {
    const { r, gl } = makeActiveHybrid();
    const opts = makeOptions();

    // First frame uploads once.
    r.render(makeViewport({ startTime: 0, endTime: 1000 }), opts);
    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);

    // Pan (shifted window) and zoom (narrower window) WITHIN the same level:
    // identical signature (mode/levelIndex/columns/physRange unchanged) → no
    // further upload, only per-frame draws.
    r.render(makeViewport({ startTime: 200, endTime: 1200 }), opts); // pan
    r.render(makeViewport({ startTime: 300, endTime: 800 }), opts); // zoom in
    r.render(makeViewport({ startTime: 100, endTime: 1100 }), opts); // pan back

    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);
    // ...but every frame issued a draw.
    expect(gl.render).toHaveBeenCalledTimes(4);
    r.dispose();
  });

  it('re-uploads exactly once on an envelope↔line mode switch', () => {
    const { r, gl } = makeActiveHybrid();
    const opts = makeOptions();

    r.render(
      makeViewport({ channels: [makeChannel({ webglLane: makeWebGLLane({ mode: 'envelope' }) })] }),
      opts,
    );
    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);

    // Cross the samples-per-pixel threshold: envelope → line.
    r.render(
      makeViewport({
        channels: [makeChannel({ render: 'line', webglLane: makeWebGLLane({ mode: 'line' }) })],
      }),
      opts,
    );
    expect(gl.uploadLanes).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it('re-uploads exactly once on an LOD-level change', () => {
    const { r, gl } = makeActiveHybrid();
    const opts = makeOptions();

    r.render(
      makeViewport({ channels: [makeChannel({ webglLane: makeWebGLLane({ levelIndex: 2 }) })] }),
      opts,
    );
    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);

    r.render(
      makeViewport({ channels: [makeChannel({ webglLane: makeWebGLLane({ levelIndex: 3 }) })] }),
      opts,
    );
    expect(gl.uploadLanes).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it('re-uploads exactly once on a resize (plot width / column count change)', () => {
    const { r, gl } = makeActiveHybrid();
    const opts = makeOptions();

    r.render(makeViewport(), opts);
    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);

    // A resize clears the cached signatures → the next frame must re-upload once.
    r.resize(1200, 400);
    r.render(makeViewport(), opts);
    expect(gl.uploadLanes).toHaveBeenCalledTimes(2);

    // ...and a further pan within the new size does NOT re-upload again.
    r.render(makeViewport({ startTime: 50, endTime: 1050 }), opts);
    expect(gl.uploadLanes).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it('re-uploads exactly once on a display-domain (physRange) change in envelope mode', () => {
    const { r, gl } = makeActiveHybrid();
    const opts = makeOptions();

    r.render(
      makeViewport({ channels: [makeChannel({ webglLane: makeWebGLLane({ physRange: 120 }) })] }),
      opts,
    );
    expect(gl.uploadLanes).toHaveBeenCalledTimes(1);

    r.render(
      makeViewport({ channels: [makeChannel({ webglLane: makeWebGLLane({ physRange: 240 }) })] }),
      opts,
    );
    expect(gl.uploadLanes).toHaveBeenCalledTimes(2);
    r.dispose();
  });
});

// ── 7. Hit-testing delegated identically on both paths ────────────

describe('HybridSignalRenderer — hit-testing delegates to the inner Canvas2D renderer', () => {
  function assertHitTestingDelegates(r: HybridSignalRenderer): void {
    const vp = makeViewport();
    const opts = makeOptions();
    r.render(vp, opts);

    const plotLeft = opts.padding.left;
    const plotWidth = 800 - opts.padding.left - opts.padding.right;
    const midX = plotLeft + plotWidth / 2;

    const time = r.getTimeAtX(midX, vp, opts);
    expect(time).toBeGreaterThan(vp.startTime);
    expect(time).toBeLessThan(vp.endTime);

    const values = r.getValuesAtTime(midX, vp, opts);
    expect(values.length).toBe(1);
    expect(values[0]?.channel).toBe('Flow');

    // getValueAtPosition delegates too (may be null off any lane; just must not throw).
    expect(() => r.getValueAtPosition(midX, opts.padding.top + 10, vp, opts)).not.toThrow();
  }

  it('delegates identically on the WebGL-active path', () => {
    const { r } = makeActiveHybrid();
    assertHitTestingDelegates(r);
    expect(r.isWebGLActive()).toBe(true);
    r.dispose();
  });

  it('delegates identically on the Canvas2D fallback path', () => {
    ctorControl.throwError = new WebGLUnavailableError();
    const base = document.createElement('canvas');
    const waveform = document.createElement('canvas');
    const r = new HybridSignalRenderer(base, waveform, resolveColor);
    r.resize(800, 400);
    assertHitTestingDelegates(r);
    expect(r.isWebGLActive()).toBe(false);
    r.dispose();
  });
});
