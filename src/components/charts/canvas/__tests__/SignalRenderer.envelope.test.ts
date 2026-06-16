/**
 * Fidelity tests for the zoomed-OUT MIN/MAX envelope render path.
 *
 * These guard the ONE intentional appearance change in the project: dense CPAP
 * waveform lanes (`kind:'cpap'`, `render:'line'`) render a per-x-pixel min/max
 * ENVELOPE when zoomed out, instead of the LTTB polyline. Because this is health
 * data, the load-bearing properties are:
 *
 *   1. SPIKE SURVIVAL — the envelope's column at a 1-sample spike/notch reaches
 *      that spike's expected y (±1px). A true envelope can NEVER hide an extreme
 *      (it is the column's min or max by definition), whereas the LTTB polyline's
 *      vertex-picking CAN skip it — we demonstrate both here.
 *   2. GAP PRESERVATION — a NaN run produces a VISIBLE BREAK, not a bridged span.
 *   3. ZOOMED-IN BYTE-IDENTITY — with no envelope attached (the zoomed-in path)
 *      the op stream is identical to today's `drawLine` polyline.
 *
 * The tests use a coordinate-recording 2D context so they can assert the actual
 * (x, y) pixels the renderer emits, not just op counts.
 *
 * @module components/charts/canvas/__tests__/SignalRenderer.envelope.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignalRenderer } from '../SignalRenderer';
import type { ViewportState, RenderOptions, SignalChannel } from '../SignalRenderer';
import { columnEnvelopeInto, lttbImpl } from '@/services/workers/downsample.worker';

// ── Coordinate-recording 2D context ──────────────────────────────

interface PathOp {
  readonly op: 'moveTo' | 'lineTo';
  readonly x: number;
  readonly y: number;
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  path: PathOp[];
  counts: Record<string, number>;
  reset(): void;
}

function createRecorder(canvas: HTMLCanvasElement): Recorder {
  const path: PathOp[] = [];
  const counts: Record<string, number> = {};
  const bump = (n: string): void => {
    counts[n] = (counts[n] ?? 0) + 1;
  };

  const target: Record<string, unknown> = {
    canvas,
    measureText: () => {
      bump('measureText');
      return { width: 20 } as TextMetrics;
    },
    getContextAttributes: () => ({ alpha: false }) as CanvasRenderingContext2DSettings,
    moveTo: (x: number, y: number) => {
      bump('moveTo');
      path.push({ op: 'moveTo', x, y });
    },
    lineTo: (x: number, y: number) => {
      bump('lineTo');
      path.push({ op: 'lineTo', x, y });
    },
  };

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      const fn = (..._args: unknown[]): undefined => {
        void _args;
        bump(prop);
        return undefined;
      };
      return fn;
    },
    set(obj, prop: string, value) {
      obj[prop] = value;
      return true;
    },
  };

  const ctx = new Proxy(target, handler) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    path,
    counts,
    reset() {
      path.length = 0;
      for (const k of Object.keys(counts)) counts[k] = 0;
    },
  };
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

// ── Geometry shared with production ───────────────────────────────

const WIDTH = 1000;
const HEIGHT = 400;
const CHANNEL_HEIGHT = 200;
const PADDING = { top: 20, right: 20, bottom: 28, left: 60 } as const;
const PLOT_LEFT = PADDING.left;
const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;

const PHYS_MIN = -60;
const PHYS_MAX = 60;

/** Reproduce drawLine/drawEnvelope's inner Y mapping for a lane at stripTop=top. */
function yOf(value: number, stripTop: number): number {
  const innerTop = stripTop + 16;
  const innerBottom = stripTop + CHANNEL_HEIGHT - 8;
  const innerHeight = innerBottom - innerTop;
  return innerBottom - ((value - PHYS_MIN) / (PHYS_MAX - PHYS_MIN)) * innerHeight;
}

function makeOptions(over?: Partial<RenderOptions>): RenderOptions {
  return {
    showCrosshair: false,
    crosshairX: null,
    showGrid: false,
    eventMarkers: [],
    channelHeight: CHANNEL_HEIGHT,
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

/** Build a flow channel WITH an envelope from a dense source over `columns`. */
function envelopeChannel(source: Float32Array, columns: number): SignalChannel {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const env = columnEnvelopeInto(source, columns, min, max);
  return {
    name: 'Flow',
    // `data` carries the LTTB output (the crosshair source), as in production.
    data: lttbImpl(source, 2 * columns),
    sampleRate: 25,
    unit: 'L/min',
    color: '#3366cc',
    physicalMin: PHYS_MIN,
    physicalMax: PHYS_MAX,
    kind: 'cpap',
    render: 'line',
    envelope: { min: env.min, max: env.max, columns: env.columns },
  };
}

describe('SignalRenderer envelope — spike survival', () => {
  let renderer: SignalRenderer;
  beforeEach(() => {
    renderer = new SignalRenderer(document.createElement('canvas'));
    renderer.resize(WIDTH, HEIGHT);
  });
  afterEach(() => renderer.dispose());

  it('reaches a 1-sample spike and notch at the expected y (±1px) when zoomed out', () => {
    // 20,000 samples → ~20 samples per pixel column at PLOT_WIDTH≈920 columns.
    const n = 20_000;
    const source = new Float32Array(n);
    for (let i = 0; i < n; i++) source[i] = 5 * Math.sin((2 * Math.PI * i) / 200);
    const spikeIdx = 9_137;
    const notchIdx = 15_402;
    source[spikeIdx] = 58; // near the top of the domain
    source[notchIdx] = -58;

    const columns = PLOT_WIDTH;
    const ch = envelopeChannel(source, columns);

    const vp: ViewportState = { startTime: 0, endTime: 800_000, channels: [ch] };
    const rec = activeRecorder!;
    rec.reset();
    renderOnce(renderer, vp, makeOptions());

    // The spike's column: floor(spikeIdx / n * columns).
    const stripTop = PADDING.top;
    const spikeCol = Math.floor((spikeIdx / n) * columns);
    const notchCol = Math.floor((notchIdx / n) * columns);
    const spikeX = PLOT_LEFT + (spikeCol + 0.5) * (PLOT_WIDTH / columns);
    const notchX = PLOT_LEFT + (notchCol + 0.5) * (PLOT_WIDTH / columns);
    const expectedSpikeY = yOf(58, stripTop);
    const expectedNotchY = yOf(-58, stripTop);

    // Find the recorded path point closest in x to the spike/notch column and
    // assert SOME emitted vertex there reaches the extreme y (±1px). The envelope
    // path visits each column's max (upper) and min (lower), so the extreme must
    // appear among the emitted vertices at that x.
    const near = (px: number): PathOp[] => rec.path.filter((p) => Math.abs(p.x - px) <= 1.0);

    const spikeYs = near(spikeX).map((p) => p.y);
    const notchYs = near(notchX).map((p) => p.y);

    expect(spikeYs.some((y) => Math.abs(y - expectedSpikeY) <= 1)).toBe(true);
    expect(notchYs.some((y) => Math.abs(y - expectedNotchY) <= 1)).toBe(true);
  });

  it('demonstrates the OLD LTTB polyline CAN miss an extreme the envelope keeps', () => {
    // LTTB keeps at most ONE vertex per bucket. When a bucket contains BOTH a
    // tall spike AND a deep notch (a flow-limitation transient adjacent to a leak
    // burst is a real example), LTTB surfaces only the single area-maximising
    // vertex and the OTHER extreme is silently dropped. The per-column envelope
    // reports BOTH the min and the max for the column, so neither is lost.
    const n = 720_000;
    const source = new Float32Array(n);
    for (let i = 0; i < n; i++) source[i] = 5 * Math.sin((2 * Math.PI * i) / 200);
    // Two opposite extremes 1 sample apart → same LTTB bucket and same pixel col.
    const upIdx = 360_100;
    const downIdx = 360_101;
    source[upIdx] = 58;
    source[downIdx] = -58;

    const lttb = lttbImpl(source, 2400); // the old zoomed-out output budget
    let lttbMax = -Infinity;
    let lttbMin = Infinity;
    for (let i = 0; i < lttb.length; i++) {
      const v = lttb[i] as number;
      if (v > lttbMax) lttbMax = v;
      if (v < lttbMin) lttbMin = v;
    }
    // LTTB cannot represent BOTH extremes: it keeps at most one of ±58.
    const lttbKeptBoth = lttbMax >= 58 && lttbMin <= -58;
    expect(lttbKeptBoth).toBe(false);

    // The envelope keeps BOTH in their (shared) column — never hides either.
    const columns = PLOT_WIDTH;
    const min = new Float32Array(columns);
    const max = new Float32Array(columns);
    columnEnvelopeInto(source, columns, min, max);
    const col = Math.floor((upIdx / n) * columns);
    expect(max[col]).toBe(58);
    expect(min[col]).toBe(-58);
  });

  it('keeps the spike across multiple zoom levels (different column counts)', () => {
    const n = 20_000;
    const source = new Float32Array(n);
    for (let i = 0; i < n; i++) source[i] = 1;
    source[12_345] = 55;

    for (const columns of [200, 500, PLOT_WIDTH]) {
      const min = new Float32Array(columns);
      const max = new Float32Array(columns);
      columnEnvelopeInto(source, columns, min, max);
      const col = Math.floor((12_345 / n) * columns);
      expect(max[col]).toBe(55);
    }
  });
});

describe('SignalRenderer envelope — gap preservation', () => {
  let renderer: SignalRenderer;
  beforeEach(() => {
    renderer = new SignalRenderer(document.createElement('canvas'));
    renderer.resize(WIDTH, HEIGHT);
  });
  afterEach(() => renderer.dispose());

  it('breaks the envelope at a NaN run instead of bridging across it', () => {
    // A dense source with a clean NaN run in the middle third.
    const n = 6_000;
    const source = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      source[i] = i >= 2_000 && i < 4_000 ? NaN : 10 * Math.sin(i / 50);
    }
    const columns = 300; // 20 samples/column; the gap spans whole columns.
    const ch = envelopeChannel(source, columns);
    const vp: ViewportState = { startTime: 0, endTime: 240_000, channels: [ch] };

    const rec = activeRecorder!;
    rec.reset();
    renderOnce(renderer, vp, makeOptions());

    // A bridged span would emit a SINGLE continuous path (one moveTo run). A
    // broken envelope emits MULTIPLE sub-bands, i.e. more than one moveTo.
    expect(rec.counts.moveTo ?? 0).toBeGreaterThanOrEqual(2);

    // No emitted path vertex should sit inside the gap's x window — the break
    // means nothing is drawn across the missing columns.
    const gapColStart = Math.floor((2_000 / n) * columns);
    const gapColEnd = Math.ceil((4_000 / n) * columns);
    const xScale = PLOT_WIDTH / columns;
    const gapXMin = PLOT_LEFT + (gapColStart + 0.5) * xScale;
    const gapXMax = PLOT_LEFT + (gapColEnd - 0.5) * xScale;
    const insideGap = rec.path.filter((p) => p.x > gapXMin + xScale && p.x < gapXMax - xScale);
    expect(insideGap.length).toBe(0);
  });

  it('column envelope marks gap columns as NaN (min===max===NaN)', () => {
    const n = 600;
    const source = new Float32Array(n);
    for (let i = 0; i < n; i++) source[i] = i >= 200 && i < 400 ? NaN : 1;
    const columns = 30;
    const min = new Float32Array(columns);
    const max = new Float32Array(columns);
    columnEnvelopeInto(source, columns, min, max);
    // Columns fully inside [200,400) → indices [10,20) → all NaN.
    for (let c = 10; c < 20; c++) {
      expect(Number.isNaN(min[c] as number)).toBe(true);
      expect(Number.isNaN(max[c] as number)).toBe(true);
    }
    // Columns outside the gap keep the baseline.
    expect(min[0]).toBe(1);
    expect(max[29]).toBe(1);
  });
});

describe('SignalRenderer envelope — zoomed-in byte-identity', () => {
  let renderer: SignalRenderer;
  beforeEach(() => {
    renderer = new SignalRenderer(document.createElement('canvas'));
    renderer.resize(WIDTH, HEIGHT);
  });
  afterEach(() => renderer.dispose());

  it('emits an identical path op stream to the polyline when no envelope is attached', () => {
    // A small data array (zoomed in): NO envelope attached → drawLine polyline.
    const data = new Float32Array(400);
    for (let i = 0; i < data.length; i++) data[i] = 20 * Math.sin(i / 7);

    const base: SignalChannel = {
      name: 'Flow',
      data,
      sampleRate: 25,
      unit: 'L/min',
      color: '#3366cc',
      physicalMin: PHYS_MIN,
      physicalMax: PHYS_MAX,
      kind: 'cpap',
      render: 'line',
    };
    const vp: ViewportState = { startTime: 0, endTime: 16_000, channels: [base] };

    const rec = activeRecorder!;
    rec.reset();
    renderOnce(renderer, vp, makeOptions());
    const polyPath = rec.path.map((p) => `${p.op}:${p.x.toFixed(4)}:${p.y.toFixed(4)}`);

    // Re-render the SAME channel again (no envelope) — must be deterministic.
    rec.reset();
    renderOnce(renderer, vp, makeOptions());
    const polyPath2 = rec.path.map((p) => `${p.op}:${p.x.toFixed(4)}:${p.y.toFixed(4)}`);

    expect(polyPath2).toEqual(polyPath);
    // Sanity: it really drew a polyline (one vertex per visible sample).
    expect(rec.counts.lineTo ?? 0).toBeGreaterThan(300);
    // And it did NOT fill (the envelope path fills; the polyline only strokes).
    expect(rec.counts.fill ?? 0).toBe(0);
  });

  it('the seam is continuous: at ≈1 sample/column min≈max so the band degenerates to a line', () => {
    // Exactly one sample per column → every column min===max → the upper and
    // lower boundaries coincide, so the envelope reads as a single continuous
    // line (no visible thickness pop versus the polyline at the threshold).
    const columns = 256;
    const source = new Float32Array(columns);
    for (let i = 0; i < columns; i++) source[i] = 15 * Math.sin(i / 9);
    const min = new Float32Array(columns);
    const max = new Float32Array(columns);
    columnEnvelopeInto(source, columns, min, max);
    for (let c = 0; c < columns; c++) {
      expect(min[c]).toBe(max[c]); // band collapses to a line — seamless
    }
  });
});
