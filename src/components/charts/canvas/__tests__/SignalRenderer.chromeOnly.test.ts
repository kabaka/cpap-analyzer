/**
 * Unit tests for the SignalRenderer CHROME-ONLY mode (ADR 0019, Stage 2).
 *
 * In `chromeOnly` mode the renderer draws everything EXCEPT the dense-CPAP
 * waveform itself (which the WebGL2 layer paints), but ONLY for lanes that
 * actually carry WebGL geometry (`webglLane`). This proves the chrome/waveform
 * split via op-counting on a recording context — no GL needed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalRenderer } from '../SignalRenderer';
import type { RenderOptions, SignalChannel, ViewportState } from '../SignalRenderer';

// ── Recording context (counts path ops) ──────────────────────────

interface Recorder {
  ctx: CanvasRenderingContext2D;
  counts: Record<string, number>;
}

function createRecorder(canvas: HTMLCanvasElement): Recorder {
  const counts: Record<string, number> = {};
  const bump = (n: string): void => {
    counts[n] = (counts[n] ?? 0) + 1;
  };
  const target: Record<string, unknown> = {
    canvas,
    measureText: () => ({ width: 20 }) as TextMetrics,
    getContextAttributes: () => ({ alpha: false }) as CanvasRenderingContext2DSettings,
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      return (..._a: unknown[]): undefined => {
        void _a;
        bump(prop);
        return undefined;
      };
    },
    set(obj, prop: string, value) {
      obj[prop] = value;
      return true;
    },
  };
  return { ctx: new Proxy(target, handler) as unknown as CanvasRenderingContext2D, counts };
}

let activeRecorder: Recorder | null = null;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
  ): RenderingContext | null {
    activeRecorder = createRecorder(this);
    return activeRecorder.ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  activeRecorder = null;
});

const WIDTH = 1000;
const HEIGHT = 400;
const PADDING = { top: 20, right: 20, bottom: 28, left: 60 } as const;

function makeOptions(over?: Partial<RenderOptions>): RenderOptions {
  return {
    showCrosshair: false,
    crosshairX: null,
    showGrid: false,
    eventMarkers: [],
    channelHeight: 200,
    padding: PADDING,
    ...over,
  };
}

function renderOnce(r: SignalRenderer, vp: ViewportState, opts: RenderOptions): void {
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
  try {
    r.render(vp, opts);
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
}

function denseCpapChannel(over: Partial<SignalChannel> = {}): SignalChannel {
  return {
    name: 'Flow',
    data: new Float32Array([0, 10, -10, 5, 0, 8, -3, 2]),
    sampleRate: 25,
    unit: 'L/min',
    color: '#3366cc',
    physicalMin: -60,
    physicalMax: 60,
    kind: 'cpap',
    render: 'line',
    ...over,
  };
}

const webglLane: NonNullable<SignalChannel['webglLane']> = {
  mode: 'line',
  levelData: new Float32Array([0, 10, -10, 5]),
  levelIndex: 1,
  dataXPerElementMs: 40,
  dataXStartMs: 0,
  plotWidthColumns: 920,
  physRange: 120,
};

function viewportWith(ch: SignalChannel): ViewportState {
  return { startTime: 0, endTime: 1000, channels: [ch] };
}

describe('SignalRenderer chrome-only mode (ADR 0019)', () => {
  let renderer: SignalRenderer;
  beforeEach(() => {
    renderer = new SignalRenderer(document.createElement('canvas'));
    renderer.resize(WIDTH, HEIGHT);
  });
  afterEach(() => renderer.dispose());

  it('defaults to full-draw mode (chrome-only off): dense CPAP polyline IS drawn', () => {
    expect(renderer.isChromeOnly()).toBe(false);
    renderOnce(renderer, viewportWith(denseCpapChannel({ webglLane })), makeOptions());
    // The polyline path issues moveTo/lineTo for the waveform.
    const moves = activeRecorder?.counts['moveTo'] ?? 0;
    expect(moves).toBeGreaterThan(0);
  });

  it('chrome-only SKIPS the dense CPAP polyline when the lane carries webglLane', () => {
    renderer.setChromeOnly(true);
    renderOnce(renderer, viewportWith(denseCpapChannel({ webglLane })), makeOptions());
    // No waveform path ops at all (grid off, no markers) → the WebGL layer paints it.
    expect(activeRecorder?.counts['moveTo'] ?? 0).toBe(0);
    expect(activeRecorder?.counts['lineTo'] ?? 0).toBe(0);
  });

  it('chrome-only STILL draws the dense CPAP polyline when NO webglLane (pre-pyramid frame)', () => {
    renderer.setChromeOnly(true);
    renderOnce(renderer, viewportWith(denseCpapChannel()), makeOptions());
    // Without webglLane the WebGL layer cannot paint it yet, so chrome must — the
    // waveform is never invisible.
    expect(activeRecorder?.counts['moveTo'] ?? 0).toBeGreaterThan(0);
  });

  it('chrome-only still draws wearable line lanes (not dense CPAP)', () => {
    renderer.setChromeOnly(true);
    const wearable = denseCpapChannel({
      name: 'HR',
      kind: 'wearable',
      webglLane, // even if present, a wearable lane is never a WebGL waveform lane
    });
    renderOnce(renderer, viewportWith(wearable), makeOptions());
    expect(activeRecorder?.counts['moveTo'] ?? 0).toBeGreaterThan(0);
  });

  it('chrome-only still draws grid + axis chrome for a skipped dense lane', () => {
    renderer.setChromeOnly(true);
    renderOnce(
      renderer,
      viewportWith(denseCpapChannel({ webglLane })),
      makeOptions({ showGrid: true }),
    );
    // Y/X grid + axis labels are chrome and must still be issued.
    expect(activeRecorder?.counts['fillText'] ?? 0).toBeGreaterThan(0);
    expect(activeRecorder?.counts['stroke'] ?? 0).toBeGreaterThan(0);
  });

  it('toggling chrome-only off restores the full draw', () => {
    renderer.setChromeOnly(true);
    renderer.setChromeOnly(false);
    expect(renderer.isChromeOnly()).toBe(false);
    renderOnce(renderer, viewportWith(denseCpapChannel({ webglLane })), makeOptions());
    expect(activeRecorder?.counts['moveTo'] ?? 0).toBeGreaterThan(0);
  });
});
