/**
 * Overlay-repaint draw-op regression guard for {@link TrendsCanvasRenderer}.
 *
 * PURPOSE
 * -------
 * Lock in the "overlay-only repaint" guarantee that makes the synced Trends
 * crosshair cheap: a hover sweep repaints ONLY the transparent overlay canvas
 * (one vertical crosshair line + at most a couple of active-dot arcs), and NEVER
 * the base canvas (series/grid/axes/zones). This must hold regardless of how many
 * nights are plotted — at multi-year "all" ranges the base layer is thousands of
 * draw ops, but the per-hover overlay cost is a small BOUNDED constant.
 *
 * It mirrors the recording-Proxy 2D-context pattern of
 * {@link module:components/charts/canvas/__tests__/SignalRenderer.bench.test}: a
 * no-op context that counts every method call by name, so draw ops can be tallied
 * deterministically in jsdom without real rasterization.
 *
 * The overlay draw path under test is the one the production charts run in their
 * `drawOverlay` callback (see e.g. AHITrendChart): `beginOverlay()` →
 * `drawVerticalReferenceLine()` (the crosshair) → `drawActiveDot()` (0–2 dots) →
 * `endOverlay()`.
 *
 * @module views/Trends/charts/canvas/__tests__/TrendsCanvasRenderer.overlay.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrendsCanvasRenderer, type PlotRect, type YDomain } from '../TrendsCanvasRenderer';

// ── Recording mock CanvasRenderingContext2D ──────────────────────
//
// A faithful no-op 2D context that counts every method call by name. Identical in
// spirit to SignalRenderer.bench.test's recorder. Each canvas gets its own
// recorder so we can assert the BASE context is never touched during an overlay
// pass (the load-bearing "overlay-only" guarantee).

interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  counts: Record<string, number>;
  reset(): void;
}

function createRecordingContext(canvas: HTMLCanvasElement): RecordingContext {
  const counts: Record<string, number> = {};
  const bump = (name: string): void => {
    counts[name] = (counts[name] ?? 0) + 1;
  };

  const measureText = (): TextMetrics => {
    bump('measureText');
    return { width: 24 } as TextMetrics;
  };

  const target: Record<string, unknown> = { canvas, measureText };

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
    counts,
    reset() {
      for (const k of Object.keys(counts)) counts[k] = 0;
    },
  };
}

// Patch getContext so every canvas yields a fresh recorder, tracked by canvas so
// the test can read the base vs overlay recorders independently.
const recorders = new WeakMap<HTMLCanvasElement, RecordingContext>();
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
  ): RenderingContext | null {
    const existing = recorders.get(this);
    if (existing) return existing.ctx;
    const rec = createRecordingContext(this);
    recorders.set(this, rec);
    return rec.ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

// ── Fixtures ─────────────────────────────────────────────────────

const WIDTH = 800;
const HEIGHT = 200;
const PLOT: PlotRect = { left: 0, top: 8, width: 752, height: 192 };
const DOMAIN: YDomain = { min: 0, max: 40 };

/** Build a renderer with a base + attached overlay canvas, sized. */
function makeRenderer(): {
  renderer: TrendsCanvasRenderer;
  base: RecordingContext;
  overlay: RecordingContext;
} {
  const baseCanvas = document.createElement('canvas');
  const overlayCanvas = document.createElement('canvas');
  const renderer = new TrendsCanvasRenderer(baseCanvas);
  renderer.resize(WIDTH, HEIGHT);
  renderer.setOverlayCanvas(overlayCanvas);
  const base = recorders.get(baseCanvas);
  const overlay = recorders.get(overlayCanvas);
  if (!base || !overlay) throw new Error('recorders not attached');
  return { renderer, base, overlay };
}

/**
 * Run the production overlay draw path for one hover step at category `idx` of
 * `count` nights: a crosshair line + up to two active dots (e.g. AHI draws a
 * median dot and a raw dot). This is exactly the work a chart's `drawOverlay`
 * callback emits through {@link TrendsCanvasRenderer}.
 */
function paintOverlayStep(
  renderer: TrendsCanvasRenderer,
  idx: number,
  count: number,
  dots: number,
): void {
  if (!renderer.beginOverlay()) throw new Error('beginOverlay failed');
  const x = renderer.pointX(idx, count, PLOT);
  renderer.drawVerticalReferenceLine(x, PLOT, { color: '#000', opacity: 0.4 });
  for (let d = 0; d < dots; d++) {
    renderer.drawActiveDot(x, renderer.valueY(10 + d * 5, DOMAIN, PLOT), 5 - d * 2, '#000');
  }
  renderer.endOverlay();
}

const waveOps = (c: Record<string, number>): number => (c.lineTo ?? 0) + (c.moveTo ?? 0);

// ── Tests ────────────────────────────────────────────────────────

describe('TrendsCanvasRenderer overlay-only crosshair repaint', () => {
  it('emits a BOUNDED overlay op count per hover step regardless of night count', () => {
    // The crosshair is ONE vertical line (1 moveTo + 1 lineTo) plus up to two
    // active-dot arcs (one arc each). The count must NOT grow with `count`.
    const counts = [7, 365, 3650, 36500]; // a week → a century of nights
    let prevWave = -1;

    for (const n of counts) {
      const { renderer, overlay } = makeRenderer();
      overlay.reset();
      paintOverlayStep(renderer, Math.floor(n / 2), n, 2);

      const wave = waveOps(overlay.counts);
      const arcs = overlay.counts.arc ?? 0;
      const strokes = overlay.counts.stroke ?? 0;

      // Exactly one vertical line: 1 moveTo + 1 lineTo. Never scales with nights.
      expect(wave).toBe(2);
      // Two active dots → two arcs (and two fills). A small fixed cap.
      expect(arcs).toBeLessThanOrEqual(2);
      // One crosshair stroke + the dots are filled (arc→fill), so strokes stay tiny.
      expect(strokes).toBeLessThanOrEqual(2);

      // The op count is INVARIANT across the night counts (not merely bounded).
      if (prevWave >= 0) expect(wave).toBe(prevWave);
      prevWave = wave;
    }
  });

  it('touches ONLY the overlay context, never the base, during an overlay pass', () => {
    const { renderer, base, overlay } = makeRenderer();

    // Snapshot the base op tally after the (one-time) construction/sizing, then
    // run an overlay pass and confirm the base recorder gains ZERO draw ops.
    base.reset();
    overlay.reset();

    paintOverlayStep(renderer, 500, 1000, 2);

    const baseDrawOps =
      (base.counts.moveTo ?? 0) +
      (base.counts.lineTo ?? 0) +
      (base.counts.stroke ?? 0) +
      (base.counts.fill ?? 0) +
      (base.counts.fillRect ?? 0) +
      (base.counts.arc ?? 0) +
      (base.counts.fillText ?? 0) +
      (base.counts.clearRect ?? 0);
    expect(baseDrawOps).toBe(0);

    // The overlay, meanwhile, DID paint: a cleared frame + the crosshair + dots.
    expect(overlay.counts.clearRect ?? 0).toBeGreaterThanOrEqual(1);
    expect(waveOps(overlay.counts)).toBe(2);
    expect(overlay.counts.arc ?? 0).toBe(2);
  });

  it('repaints (clears) the overlay each hover step so crosshairs do not accumulate', () => {
    const { renderer, overlay } = makeRenderer();

    // A short hover sweep: each step clears then redraws — op count per step is
    // constant, so N steps cost N × (a small constant), never N².
    overlay.reset();
    const STEPS = 50;
    for (let i = 0; i < STEPS; i++) paintOverlayStep(renderer, i, STEPS, 1);

    // Each step: 1 clearRect + 1 crosshair line (2 wave ops) + 1 arc.
    expect(overlay.counts.clearRect ?? 0).toBe(STEPS);
    expect(waveOps(overlay.counts)).toBe(2 * STEPS);
    expect(overlay.counts.arc ?? 0).toBe(STEPS);
  });
});
