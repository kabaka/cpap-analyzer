/**
 * Draw-op + timing benchmark harness for {@link SignalRenderer}.
 *
 * PURPOSE
 * -------
 * Establish an OBJECTIVE, REPRODUCIBLE baseline for the per-frame rendering cost
 * of the Session Signals canvas renderer, and quantitatively confirm the
 * root-cause hypothesis behind poor hover/zoom/scroll frame rate:
 *
 *   > Hover/crosshair movement repaints the ENTIRE waveform stack. The dominant
 *   > per-frame cost is the waveform polyline drawing (`ctx.lineTo`/`ctx.moveTo`,
 *   > one call per displayed output point per lane). A crosshair-only update
 *   > therefore costs almost as much as a full viewport render, even though
 *   > visually only a 1px line + a few badges change.
 *
 * This file adds NO production code and changes NO rendering behaviour. It only
 * instruments `renderImmediate` via a recording mock 2D context and reports
 * numbers. It is intentionally co-located with the existing renderer tests and
 * reuses their jsdom canvas-stubbing pattern.
 *
 * KEY METRICS (the numbers we will use to demonstrate improvement)
 * ----------------------------------------------------------------
 *   - "waveform draw-ops per crosshair update" = (lineTo + moveTo) calls emitted
 *     by a single crosshair-move frame on the current code.
 *   - "ms per crosshair update" = wall-clock time of that frame.
 * On the current code these are ~equal to a full viewport render (the bug).
 *
 * RUNNING
 * -------
 *   - Op-count assertions run in the normal suite (cheap; tiny iteration count).
 *   - The full timing table (heavier; builds 720k-sample pyramids) prints to
 *     stdout and runs more iterations when invoked via:
 *         npm run bench:renderer
 *     which sets BENCH_RENDERER=1. Without that flag the timing loop still runs
 *     a single warm pass so the assertions are meaningful, but uses a reduced
 *     iteration count to keep `npm test` fast.
 *
 * @module components/charts/canvas/__tests__/SignalRenderer.bench.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignalRenderer } from '../SignalRenderer';
import type { ViewportState, RenderOptions, SignalChannel, EventMarker } from '../SignalRenderer';
import { buildDecimationPyramid, selectPyramidLevel } from '../decimationPyramid';
import type { DecimationPyramid } from '../decimationPyramid';
import { lttbImpl, lttbInto, lttbOutLength } from '@/services/workers/downsample.worker';

// ── Config mirrored from SignalViewer.tsx ────────────────────────
//
// These constants are copied (not imported) from src/views/Sessions/SignalViewer.tsx
// so the harness reproduces the production geometry without pulling the 2000-line
// React host (and its store/worker deps) into a unit test. If those change there,
// update them here.

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const CHANNEL_HEIGHT = 150;
const PADDING = { top: 20, right: 24, bottom: 28, left: 56 } as const;
const DOWNSAMPLE_MULTIPLIER = 2;
/** LTTB output point budget per lane, exactly as SignalViewer computes it. */
const TARGET_POINTS = Math.max(100, Math.round(CANVAS_WIDTH * DOWNSAMPLE_MULTIPLIER)); // 2400

const BENCH_MODE = process.env.BENCH_RENDERER === '1';
/** Iterations for the timing average. Heavier in bench mode, light otherwise. */
const TIMING_ITERS = BENCH_MODE ? 200 : 12;

// ── Recording mock CanvasRenderingContext2D ──────────────────────

/** A faithful no-op 2D context that counts every method call by name. */
interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  counts: Record<string, number>;
  reset(): void;
}

function createRecordingContext(canvas: HTMLCanvasElement): RecordingContext {
  // Every method call the renderer makes is recorded here by name; the report
  // tabulates the draw-relevant ones (moveTo/lineTo/stroke/fill/fillRect/arc/
  // fillText/measureText/setLineDash/clip/save/restore/…).
  const counts: Record<string, number> = {};

  const bump = (name: string): void => {
    counts[name] = (counts[name] ?? 0) + 1;
  };

  // measureText must return a TextMetrics-like object so badge code that reads
  // `.width` runs to completion.
  const measureText = (): TextMetrics => {
    bump('measureText');
    return { width: 24 } as TextMetrics;
  };

  // getContextAttributes is consulted by some canvas helpers; return alpha:false
  // to mirror the production `getContext('2d', { alpha:false })` request.
  const getContextAttributes = (): CanvasRenderingContext2DSettings => {
    bump('getContextAttributes');
    return { alpha: false };
  };

  // A target object carrying the few non-counted properties the renderer assigns
  // (fillStyle, strokeStyle, lineWidth, font, etc.) and the canvas backref.
  const target: Record<string, unknown> = {
    canvas,
    measureText,
    getContextAttributes,
  };

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      // Any unknown property accessed as a function → a counting no-op.
      // Property *reads* of style fields that were never written return ''.
      const fn = (..._args: unknown[]): undefined => {
        void _args;
        bump(prop);
        return undefined;
      };
      return fn;
    },
    set(obj, prop: string, value) {
      // Record style/state assignments without counting them as draw ops.
      obj[prop] = value;
      return true;
    },
  };

  const ctx = new Proxy(target, handler) as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    counts,
    reset() {
      for (const k of Object.keys(counts)) counts[k] = 0;
    },
  };
}

// Patch HTMLCanvasElement.getContext so the renderer obtains our recording ctx.
let activeRecorder: RecordingContext | null = null;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
  ): RenderingContext | null {
    activeRecorder = createRecordingContext(this);
    return activeRecorder.ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  activeRecorder = null;
});

// ── Synthetic full-night dataset ─────────────────────────────────

interface LaneSpec {
  readonly name: string;
  readonly sampleRate: number;
  readonly unit: string;
  readonly physicalMin: number;
  readonly physicalMax: number;
  /** Synthetic waveform generator: index → value. */
  readonly gen: (i: number, n: number) => number;
}

/** ~8 hours. */
const NIGHT_MS = 8 * 60 * 60 * 1000;

const LANE_SPECS: readonly LaneSpec[] = [
  {
    name: 'Flow',
    sampleRate: 25,
    unit: 'L/min',
    physicalMin: -60,
    physicalMax: 60,
    // Breathing ~15 brpm (0.25 Hz) with harmonics + slow drift, zero-centred.
    gen: (i) => {
      const t = i / 25;
      return (
        30 * Math.sin(2 * Math.PI * 0.25 * t) +
        8 * Math.sin(2 * Math.PI * 0.75 * t) +
        4 * Math.sin(2 * Math.PI * 0.013 * t)
      );
    },
  },
  {
    name: 'MaskPressure',
    sampleRate: 25,
    unit: 'cmH2O',
    physicalMin: 0,
    physicalMax: 25,
    gen: (i) => {
      const t = i / 25;
      return 9 + 2 * Math.sin(2 * Math.PI * 0.25 * t) + 0.5 * Math.sin(2 * Math.PI * 0.0008 * t);
    },
  },
  {
    name: 'Leak',
    sampleRate: 25,
    unit: 'L/min',
    physicalMin: 0,
    physicalMax: 60,
    gen: (i) => {
      const t = i / 25;
      const base = 18 + 6 * Math.sin(2 * Math.PI * 0.002 * t);
      // Occasional leak transients.
      const burst = Math.sin(2 * Math.PI * 0.0003 * t) > 0.97 ? 25 : 0;
      return base + burst;
    },
  },
  {
    name: 'SpO2',
    sampleRate: 25,
    unit: '%',
    physicalMin: 80,
    physicalMax: 100,
    gen: (i) => {
      const t = i / 25;
      return 96 + 1.5 * Math.sin(2 * Math.PI * 0.004 * t);
    },
  },
];

interface BenchChannel {
  readonly spec: LaneSpec;
  readonly raw: Float32Array;
  readonly pyramid: DecimationPyramid;
  readonly totalSamples: number;
}

let benchChannels: BenchChannel[] | null = null;

/** Build the full-night dataset + pyramids once (expensive), memoised. */
function getBenchChannels(): BenchChannel[] {
  if (benchChannels) return benchChannels;
  benchChannels = LANE_SPECS.map((spec) => {
    const n = Math.round((NIGHT_MS / 1000) * spec.sampleRate); // 720,000 for 25 Hz
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = spec.gen(i, n);
    const pyramid = buildDecimationPyramid(raw);
    return { spec, raw, pyramid, totalSamples: n };
  });
  return benchChannels;
}

/**
 * Reproduce SignalViewer.buildCpapChannel: select a pyramid level for the
 * viewport span, slice it, run LTTB to TARGET_POINTS. The renderer's `data`
 * is therefore the LTTB output (≤ TARGET_POINTS), NOT the raw 720k array — this
 * is exactly what the production renderer draws.
 */
function buildDisplayChannel(
  bc: BenchChannel,
  range: { startTime: number; endTime: number },
): SignalChannel {
  const { raw, pyramid, totalSamples } = bc;
  const startFrac = range.startTime / NIGHT_MS;
  const endFrac = range.endTime / NIGHT_MS;
  const startSample = Math.floor(startFrac * totalSamples);
  const endSample = Math.min(Math.ceil(endFrac * totalSamples), totalSamples);

  const pslice = selectPyramidLevel(pyramid, startSample, endSample, TARGET_POINTS);
  const levelSlice = pslice.data.subarray(pslice.startIndex, pslice.endIndex);
  const displayData =
    levelSlice.length > TARGET_POINTS ? lttbImpl(levelSlice, TARGET_POINTS) : levelSlice;

  void raw;
  return {
    name: bc.spec.name,
    data: displayData,
    sampleRate: bc.spec.sampleRate,
    unit: bc.spec.unit,
    color: '#3366cc',
    physicalMin: bc.spec.physicalMin,
    physicalMax: bc.spec.physicalMax,
    kind: 'cpap',
    render: 'line',
  };
}

const EVENT_MARKERS: readonly EventMarker[] = [
  { startTime: 90 * 60 * 1000, duration: 18_000, type: 'ObstructiveApnea', color: '#dc2626' },
  { startTime: 200 * 60 * 1000, duration: 12_000, type: 'Hypopnea', color: '#f59e0b' },
];

function makeOptions(overrides?: Partial<RenderOptions>): RenderOptions {
  return {
    showCrosshair: false,
    crosshairX: null,
    showGrid: true,
    eventMarkers: EVENT_MARKERS,
    channelHeight: CHANNEL_HEIGHT,
    padding: PADDING,
    ...overrides,
  };
}

// ── Viewport spans under test ────────────────────────────────────

interface SpanSpec {
  readonly label: string;
  readonly range: { startTime: number; endTime: number };
}

/** Centre a span of `ms` width near the middle of the night. */
function centredSpan(label: string, ms: number): SpanSpec {
  const mid = NIGHT_MS / 2;
  const half = Math.min(ms, NIGHT_MS) / 2;
  return { label, range: { startTime: mid - half, endTime: mid + half } };
}

const SPANS: readonly SpanSpec[] = [
  { label: 'All (8h)', range: { startTime: 0, endTime: NIGHT_MS } },
  centredSpan('1h', 60 * 60 * 1000),
  centredSpan('5m', 5 * 60 * 1000),
  centredSpan('1m', 1 * 60 * 1000),
];

// ── Measurement helpers ──────────────────────────────────────────

/** Run `fn` with rAF stubbed to fire synchronously (jsdom has no real rAF). */
function withSyncRaf(fn: () => void): void {
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
  try {
    fn();
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
}

/** Invoke the private renderImmediate synchronously via the rAF-backed render(). */
function renderOnce(renderer: SignalRenderer, vp: ViewportState, opts: RenderOptions): void {
  withSyncRaf(() => renderer.render(vp, opts));
}

/** Invoke renderOverlayImmediate synchronously via the rAF-backed renderOverlay(). */
function renderOverlayOnce(renderer: SignalRenderer, vp: ViewportState, opts: RenderOptions): void {
  withSyncRaf(() => renderer.renderOverlay(vp, opts));
}

interface FrameResult {
  readonly counts: Record<string, number>;
  readonly waveformOps: number; // lineTo + moveTo
}

/** Render once and snapshot op counts. */
function measureFrame(
  renderer: SignalRenderer,
  vp: ViewportState,
  opts: RenderOptions,
): FrameResult {
  const rec = activeRecorder;
  if (!rec) throw new Error('no recording context');
  rec.reset();
  renderOnce(renderer, vp, opts);
  const counts = { ...rec.counts };
  const waveformOps = (counts.lineTo ?? 0) + (counts.moveTo ?? 0);
  return { counts, waveformOps };
}

/** Average wall-clock ms over N renders. Returns mean and p95. */
function timeFrames(
  renderer: SignalRenderer,
  vp: ViewportState,
  opts: RenderOptions,
  iters: number,
): { mean: number; p95: number } {
  // Warm up so JIT/first-touch costs don't skew the mean.
  for (let i = 0; i < 3; i++) renderOnce(renderer, vp, opts);
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    renderOnce(renderer, vp, opts);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? mean;
  return { mean, p95 };
}

// ── Report formatting ────────────────────────────────────────────

function pad(s: string | number, w: number): string {
  const str = String(s);
  return str.length >= w ? str : ' '.repeat(w - str.length) + str;
}

// ── The benchmark ────────────────────────────────────────────────

describe('SignalRenderer rendering-cost baseline', () => {
  let renderer: SignalRenderer;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    renderer = new SignalRenderer(canvas);
    renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
  });

  it('prints the baseline table and confirms the crosshair-cost hypothesis', () => {
    const channels = getBenchChannels();

    const lines: string[] = [];
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(
      ` SignalRenderer baseline  (canvas ${CANVAS_WIDTH}x${CANVAS_HEIGHT}, ${LANE_SPECS.length} CPAP lanes, LTTB target=${TARGET_POINTS}/lane)`,
    );
    lines.push(
      `   mode=${BENCH_MODE ? 'BENCH (200 iters)' : 'fast (12 iters; run `npm run bench:renderer` for full)'}`,
    );
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(
      `${pad('span', 9)} | ${pad('lineTo', 8)} ${pad('moveTo', 7)} ${pad('wave-ops', 9)} | ${pad('stroke', 6)} ${pad('fillRect', 8)} ${pad('fillText', 8)} ${pad('arc', 4)} ${pad('measTxt', 7)} | ${pad('full ms', 8)} | ${pad('xhair ms', 8)} ${pad('xhair wave', 10)}`,
    );
    lines.push('───────────────────────────────────────────────────────────────────────────────');

    // Collected for assertions on the most-zoomed-in span (worst relative case).
    let confirmedAtLeastOne = false;

    for (const span of SPANS) {
      const cpapChannels = channels.map((bc) => buildDisplayChannel(bc, span.range));
      const vp: ViewportState = {
        startTime: span.range.startTime,
        endTime: span.range.endTime,
        channels: cpapChannels,
      };

      // 1) Full render (no crosshair) — the baseline frame.
      const fullOpts = makeOptions({ showCrosshair: false, crosshairX: null });
      const full = measureFrame(renderer, vp, fullOpts);
      const fullTime = timeFrames(renderer, vp, fullOpts, TIMING_ITERS);

      // 2) Crosshair-move frame — what the CURRENT code does on every pointermove
      //    (a FULL renderImmediate with showCrosshair + a moved crosshairX).
      const crossX = PADDING.left + (CANVAS_WIDTH - PADDING.left - PADDING.right) * 0.5;
      const crossOpts = makeOptions({ showCrosshair: true, crosshairX: crossX });
      const cross = measureFrame(renderer, vp, crossOpts);
      const crossTime = timeFrames(renderer, vp, crossOpts, TIMING_ITERS);

      lines.push(
        `${pad(span.label, 9)} | ${pad(full.counts.lineTo ?? 0, 8)} ${pad(full.counts.moveTo ?? 0, 7)} ${pad(full.waveformOps, 9)} | ${pad(full.counts.stroke ?? 0, 6)} ${pad(full.counts.fillRect ?? 0, 8)} ${pad(full.counts.fillText ?? 0, 8)} ${pad(full.counts.arc ?? 0, 4)} ${pad(full.counts.measureText ?? 0, 7)} | ${pad(fullTime.mean.toFixed(3), 8)} | ${pad(crossTime.mean.toFixed(3), 8)} ${pad(cross.waveformOps, 10)}`,
      );

      // The crosshair frame's waveform-op count should be ~equal to the full
      // frame's (the crosshair adds only the lane intersection dots/badges, a
      // tiny fixed cost). This is the BUG: a 1px crosshair move repaints every
      // waveform polyline.
      const ratio = full.waveformOps > 0 ? cross.waveformOps / full.waveformOps : 1;
      expect(cross.waveformOps).toBeGreaterThanOrEqual(full.waveformOps);
      // Crosshair adds dots only; waveform ops must be within a small margin.
      expect(ratio).toBeLessThan(1.05);
      // And the full frame draws a large number of waveform ops (the dominant
      // per-frame work). With 4 lanes × ~TARGET_POINTS this is in the thousands.
      if (full.waveformOps > 1000) confirmedAtLeastOne = true;
    }

    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(' KEY METRIC  "waveform draw-ops per crosshair update" = lineTo+moveTo on the');
    lines.push('             crosshair frame (≈ a full repaint). "ms per crosshair update" =');
    lines.push('             xhair ms column. Both should drop to ~0 after the fix.');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');

    // process.stdout.write (not console.log) so Vitest's reporter does not buffer
    // away the table — the headline before/after numbers must be observable when
    // the benchmark is run.
    process.stdout.write(`${lines.join('\n')}\n`);

    expect(confirmedAtLeastOne).toBe(true);
  });

  it('confirms the overlay crosshair path emits ~zero waveform ops (the fix)', () => {
    const channels = getBenchChannels();

    const lines: string[] = [];
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(' SignalRenderer overlay-crosshair path  (BASE waveforms NOT repainted on hover)');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(
      `${pad('span', 9)} | ${pad('xhair wave (old)', 16)} -> ${pad('overlay wave (new)', 18)} | ${pad('arc', 4)} ${pad('stroke', 6)} | ${pad('overlay ms', 10)}`,
    );
    lines.push('───────────────────────────────────────────────────────────────────────────────');

    let assertedOnce = false;

    for (const span of SPANS) {
      const cpapChannels = channels.map((bc) => buildDisplayChannel(bc, span.range));
      const vp: ViewportState = {
        startTime: span.range.startTime,
        endTime: span.range.endTime,
        channels: cpapChannels,
      };
      const crossX = PADDING.left + (CANVAS_WIDTH - PADDING.left - PADDING.right) * 0.5;
      const crossOpts = makeOptions({ showCrosshair: true, crosshairX: crossX });

      // BEFORE — the legacy hover path: a full renderImmediate that repaints the
      // whole waveform stack just to move the crosshair. Measured on a renderer
      // with NO overlay attached (its base getContext sets activeRecorder).
      const legacyCanvas = document.createElement('canvas');
      const legacyRenderer = new SignalRenderer(legacyCanvas);
      legacyRenderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
      const legacy = measureFrame(legacyRenderer, vp, crossOpts);
      legacyRenderer.dispose();

      // AFTER — the overlay-only path. Attach a fresh overlay; its getContext sets
      // activeRecorder to the overlay recorder, which we then measure.
      const overlayCanvas = document.createElement('canvas');
      const overlayRenderer = new SignalRenderer(document.createElement('canvas'));
      overlayRenderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
      overlayRenderer.setOverlayCanvas(overlayCanvas);
      const overlayRec = activeRecorder;
      if (!overlayRec) throw new Error('no overlay recording context');
      overlayRenderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT);

      overlayRec.reset();
      renderOverlayOnce(overlayRenderer, vp, crossOpts);
      const overlayCounts = { ...overlayRec.counts };
      const overlayWaveformOps = (overlayCounts.lineTo ?? 0) + (overlayCounts.moveTo ?? 0);

      // Time the overlay path (after a warm pass).
      for (let i = 0; i < 3; i++) renderOverlayOnce(overlayRenderer, vp, crossOpts);
      const t0 = performance.now();
      for (let i = 0; i < TIMING_ITERS; i++) renderOverlayOnce(overlayRenderer, vp, crossOpts);
      const overlayMs = (performance.now() - t0) / TIMING_ITERS;
      overlayRenderer.dispose();

      lines.push(
        `${pad(span.label, 9)} | ${pad(legacy.waveformOps, 16)} -> ${pad(overlayWaveformOps, 18)} | ${pad(overlayCounts.arc ?? 0, 4)} ${pad(overlayCounts.stroke ?? 0, 6)} | ${pad(overlayMs.toFixed(4), 10)}`,
      );

      // THE FIX: the overlay crosshair frame emits essentially no waveform ops —
      // just the single crosshair line (1 moveTo + 1 lineTo). Intersection dots
      // use arc, not lineTo/moveTo. Generous headroom (<50) vs the ~6,000–9,600
      // baseline this replaces.
      expect(overlayWaveformOps).toBeLessThan(50);
      // And it is dramatically cheaper than the legacy full repaint it replaces.
      expect(overlayWaveformOps).toBeLessThan(legacy.waveformOps / 50);
      assertedOnce = true;
    }

    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(' BEFORE/AFTER  "waveform draw-ops per crosshair update": the xhair-wave (old)');
    lines.push('               column (a full repaint) collapses to overlay-wave (new) ≈ 2 (just');
    lines.push('               the crosshair line). Intersection dots are counted under `arc`.');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');

    // process.stdout.write (not console.log) so Vitest's reporter does not buffer
    // away the table — the headline before/after numbers must be observable when
    // the benchmark is run.
    process.stdout.write(`${lines.join('\n')}\n`);

    expect(assertedOnce).toBe(true);
  });

  it('breaks the per-lane waveform cost down by output points (proxy validation)', () => {
    // Confirms the waveform-op count tracks the LTTB output point count per lane:
    // ~ (sum over lanes of (points-1)) lineTo + (lanes) moveTo. This proves the
    // dominant draw cost is the polyline, not the grid/axes/markers.
    const channels = getBenchChannels();
    const span = SPANS[0]!; // All
    const cpapChannels = channels.map((bc) => buildDisplayChannel(bc, span.range));
    const vp: ViewportState = {
      startTime: span.range.startTime,
      endTime: span.range.endTime,
      channels: cpapChannels,
    };

    const expectedWaveformOps = cpapChannels.reduce((sum, ch) => sum + ch.data.length, 0);

    // Isolate the grid/axis polyline overhead: render the SAME frame with grid
    // OFF, so the only moveTo/lineTo left is from event markers (none use the
    // polyline path). The difference between grid-on and grid-off is the grid's
    // contribution; the bulk is the waveform.
    const noGrid = measureFrame(renderer, vp, makeOptions({ showGrid: false }));
    const full = measureFrame(renderer, vp, makeOptions({ showGrid: true }));

    const gridOverhead = full.waveformOps - noGrid.waveformOps;

    // The waveform polyline contributes ~one vertex (lineTo/moveTo) per displayed
    // point per lane; with grid off the count is essentially the point total.
    expect(noGrid.waveformOps).toBeGreaterThan(expectedWaveformOps * 0.9);
    expect(noGrid.waveformOps).toBeLessThanOrEqual(expectedWaveformOps + cpapChannels.length);
    // Grid/axis polyline overhead is tiny next to the waveform: the waveform is
    // the dominant per-frame draw cost.
    expect(expectedWaveformOps).toBeGreaterThan(gridOverhead * 20);
  });
});

// ── Pan/zoom gesture frame: data path + render, allocation metric ─
//
// The tests above instrument the RENDER cost (draw-ops). This block instruments
// the FULL gesture frame the pan/wheel hot paths actually run each animation
// frame: the DATA path (pyramid level select + LTTB downsample per lane) PLUS
// the render. It contrasts the two LTTB strategies:
//
//   OLD (allocating)  — lttbImpl: a fresh Float32Array per lane per frame.
//   NEW (buffer-reuse) — lttbInto: writes into a per-lane DOUBLE-BUFFERED
//                        scratch, mirroring SignalViewer.buildCpapChannel.
//
// METRIC FAITHFULNESS
//   - allocations-per-frame & op-counts are jsdom-PROXY-FAITHFUL: they count
//     ArrayBuffer creations / 2D-context method calls deterministically, exactly
//     as the real browser would issue them (the algorithm + draw calls are
//     identical; only rasterization differs).
//   - wall-clock ms in jsdom is INDICATIVE ONLY (no GPU rasterization, no real
//     GC pressure modelling). Real-browser frame timing is owned by the
//     Playwright probe in tests/e2e/signal-viewer-perf.spec.ts.

interface DoubleBuffer {
  a: Float32Array;
  b: Float32Array;
  flip: 0 | 1;
  capacity: number;
}

/**
 * Mirror of SignalViewer.buildCpapChannel's downsample step, parameterised by
 * strategy. Returns the SignalChannel plus the number of NEW ArrayBuffers the
 * downsample step allocated for this frame (0 in the steady-state reuse path).
 */
function buildDisplayChannelWithStrategy(
  bc: BenchChannel,
  range: { startTime: number; endTime: number },
  strategy: 'alloc' | 'reuse',
  scratch: Map<string, DoubleBuffer>,
): { channel: SignalChannel; allocations: number } {
  const { pyramid, totalSamples } = bc;
  const startFrac = range.startTime / NIGHT_MS;
  const endFrac = range.endTime / NIGHT_MS;
  const startSample = Math.floor(startFrac * totalSamples);
  const endSample = Math.min(Math.ceil(endFrac * totalSamples), totalSamples);

  const pslice = selectPyramidLevel(pyramid, startSample, endSample, TARGET_POINTS);
  const levelSlice = pslice.data.subarray(pslice.startIndex, pslice.endIndex);

  let displayData: Float32Array;
  let allocations = 0;

  if (levelSlice.length > TARGET_POINTS) {
    if (strategy === 'alloc') {
      displayData = lttbImpl(levelSlice, TARGET_POINTS); // fresh Float32Array
      allocations = 1;
    } else {
      const needed = lttbOutLength(levelSlice.length, TARGET_POINTS);
      let buf = scratch.get(bc.spec.name);
      if (!buf || buf.capacity < needed) {
        const capacity = Math.max(needed, TARGET_POINTS);
        buf = { a: new Float32Array(capacity), b: new Float32Array(capacity), flip: 0, capacity };
        scratch.set(bc.spec.name, buf);
        allocations = 2; // one-time double-buffer allocation on (re)size only
      }
      const out = buf.flip === 0 ? buf.a : buf.b;
      buf.flip = buf.flip === 0 ? 1 : 0;
      displayData = lttbInto(levelSlice, TARGET_POINTS, out); // view; no allocation
    }
  } else {
    displayData = levelSlice; // already a view — no copy in either strategy
  }

  return {
    channel: {
      name: bc.spec.name,
      data: displayData,
      sampleRate: bc.spec.sampleRate,
      unit: bc.spec.unit,
      color: '#3366cc',
      physicalMin: bc.spec.physicalMin,
      physicalMax: bc.spec.physicalMax,
      kind: 'cpap',
      render: 'line',
    },
    allocations,
  };
}

/** Build the full frame's channels under a strategy; sum downsample allocations. */
function buildFrame(
  channels: BenchChannel[],
  range: { startTime: number; endTime: number },
  strategy: 'alloc' | 'reuse',
  scratch: Map<string, DoubleBuffer>,
): { vp: ViewportState; allocations: number } {
  let allocations = 0;
  const cpapChannels = channels.map((bc) => {
    const r = buildDisplayChannelWithStrategy(bc, range, strategy, scratch);
    allocations += r.allocations;
    return r.channel;
  });
  return {
    vp: { startTime: range.startTime, endTime: range.endTime, channels: cpapChannels },
    allocations,
  };
}

describe('SignalViewer pan/zoom gesture frame (data path + render)', () => {
  let renderer: SignalRenderer;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    renderer = new SignalRenderer(canvas);
    renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
  });

  it('proves the buffer-reuse path allocates ~0 steady-state AND is byte-identical to lttbImpl', () => {
    const channels = getBenchChannels();
    // A pan sweep: slide a 5-minute window across the night, one step per frame.
    const windowMs = 5 * 60 * 1000;
    const STEPS = 240; // ~4 s of dragging at 60 fps
    const stride = (NIGHT_MS - windowMs) / STEPS;

    const reuseScratch = new Map<string, DoubleBuffer>();
    let reuseAllocTotal = 0;
    let reuseSteadyStateAlloc = 0;
    let allocPathAllocTotal = 0;
    let identicalFrames = 0;

    for (let step = 0; step < STEPS; step++) {
      const start = step * stride;
      const range = { startTime: start, endTime: start + windowMs };

      // OLD path — fresh allocation per lane per frame.
      const allocFrame = buildFrame(channels, range, 'alloc', new Map());
      allocPathAllocTotal += allocFrame.allocations;

      // NEW path — reused double buffers.
      const reuseFrame = buildFrame(channels, range, 'reuse', reuseScratch);
      reuseAllocTotal += reuseFrame.allocations;
      // After the first window settles (buffers sized), steady-state allocs are 0.
      if (step >= 1) reuseSteadyStateAlloc += reuseFrame.allocations;

      // Byte-identity: NEW output must equal OLD output element-for-element.
      let allEqual = true;
      for (let lane = 0; lane < channels.length; lane++) {
        const a = allocFrame.vp.channels[lane]!.data;
        const b = reuseFrame.vp.channels[lane]!.data;
        if (a.length !== b.length) {
          allEqual = false;
          break;
        }
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) {
            allEqual = false;
            break;
          }
        }
        if (!allEqual) break;
      }
      if (allEqual) identicalFrames++;

      // Render both so the full gesture frame (data + draw) is exercised.
      renderOnce(renderer, reuseFrame.vp, makeOptions({ showCrosshair: true, crosshairX: 600 }));
    }

    const lanes = channels.length;
    const lines: string[] = [];
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(
      ' SignalViewer pan gesture — downsample ALLOCATIONS per frame (jsdom-proxy-faithful)',
    );
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(
      `   ${lanes} CPAP lanes, LTTB target=${TARGET_POINTS}/lane, ${STEPS} frames (5m window pan)`,
    );
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(
      `${pad('strategy', 16)} | ${pad('total ArrayBuffer allocs', 24)} | ${pad('per-frame (steady)', 18)}`,
    );
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(
      `${pad('OLD lttbImpl', 16)} | ${pad(allocPathAllocTotal, 24)} | ${pad((allocPathAllocTotal / STEPS).toFixed(2), 18)}`,
    );
    lines.push(
      `${pad('NEW lttbInto', 16)} | ${pad(reuseAllocTotal, 24)} | ${pad((reuseSteadyStateAlloc / (STEPS - 1)).toFixed(2), 18)}`,
    );
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(` byte-identical frames: ${identicalFrames}/${STEPS}  (NEW output === OLD output)`);
    lines.push(
      ' NOTE: ArrayBuffer-alloc & op-counts are jsdom-proxy-faithful (algorithm-identical',
    );
    lines.push(
      '       to the browser). Wall-clock ms here is indicative only — real-browser frame',
    );
    lines.push(
      '       timing lives in tests/e2e/signal-viewer-perf.spec.ts (rasterization-bound).',
    );
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    process.stdout.write(`${lines.join('\n')}\n`);

    // ASSERTIONS
    // OLD path allocates one buffer per lane per frame.
    expect(allocPathAllocTotal).toBe(lanes * STEPS);
    // NEW path allocates only the one-time double buffers (≤ 2 per lane), and
    // ZERO in steady state after the first frame.
    expect(reuseAllocTotal).toBeLessThanOrEqual(lanes * 2);
    expect(reuseSteadyStateAlloc).toBe(0);
    // Every frame's NEW output is byte-identical to the OLD allocating output.
    expect(identicalFrames).toBe(STEPS);
  });

  it('times the full pan gesture frame (data path + render) under both strategies', () => {
    const channels = getBenchChannels();
    const span = SPANS[2]!; // 5m — a representative zoomed-in pan window

    function timeStrategy(strategy: 'alloc' | 'reuse'): { mean: number; p95: number } {
      const scratch = new Map<string, DoubleBuffer>();
      const opts = makeOptions({ showCrosshair: true, crosshairX: 600 });
      // Warm up (size buffers, JIT).
      for (let i = 0; i < 3; i++) {
        const f = buildFrame(channels, span.range, strategy, scratch);
        renderOnce(renderer, f.vp, opts);
      }
      const samples: number[] = [];
      for (let i = 0; i < TIMING_ITERS; i++) {
        const t0 = performance.now();
        const f = buildFrame(channels, span.range, strategy, scratch);
        renderOnce(renderer, f.vp, opts);
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
      const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? mean;
      return { mean, p95 };
    }

    const oldT = timeStrategy('alloc');
    const newT = timeStrategy('reuse');

    const lines: string[] = [];
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(' Full pan/zoom gesture frame: DATA PATH (pyramid+LTTB) + RENDER');
    lines.push(
      `   mode=${BENCH_MODE ? 'BENCH (200 iters)' : 'fast (12 iters)'}, span=${span.label}`,
    );
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(`${pad('strategy', 16)} | ${pad('mean ms', 10)} | ${pad('p95 ms', 10)}`);
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(
      `${pad('OLD lttbImpl', 16)} | ${pad(oldT.mean.toFixed(4), 10)} | ${pad(oldT.p95.toFixed(4), 10)}`,
    );
    lines.push(
      `${pad('NEW lttbInto', 16)} | ${pad(newT.mean.toFixed(4), 10)} | ${pad(newT.p95.toFixed(4), 10)}`,
    );
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(
      ' jsdom ms is INDICATIVE ONLY (no GPU raster / real GC). The allocation delta above',
    );
    lines.push(' is the load-bearing, proxy-faithful win; real frame-time gains (fewer GC pauses)');
    lines.push(' are measured by the Playwright probe under tests/e2e/.');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    process.stdout.write(`${lines.join('\n')}\n`);

    // Sanity only (timing is indicative): both strategies produce a positive,
    // finite frame time. We do NOT assert NEW < OLD on wall-clock in jsdom.
    expect(oldT.mean).toBeGreaterThan(0);
    expect(newT.mean).toBeGreaterThan(0);
    expect(Number.isFinite(newT.p95)).toBe(true);
  });
});
