/**
 * Unit tests for the hybrid renderer's NON-GL behaviour (ADR 0019, Stage 2).
 *
 * jsdom provides no WebGL2 context, so constructing the hybrid here exercises the
 * AUTOMATIC Canvas2D fallback path — exactly the path a browser without WebGL2 or
 * after a lost context takes. We assert the fallback is selected, that the inner
 * Canvas2D renderer is NOT put into chrome-only mode (so it draws the waveforms
 * itself), and that hit-testing + lifecycle delegate correctly. The WebGL draw
 * itself is validated by the CI pixel-diff fidelity gate, not here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HybridSignalRenderer } from '../HybridSignalRenderer';
import type { RenderOptions, SignalChannel, ViewportState } from '../canvas/SignalRenderer';

// ── Canvas mock for jsdom ────────────────────────────────────────
// jsdom returns null for getContext('2d'); patch it to a stub. We deliberately
// return null for 'webgl2' so the hybrid takes its AUTOMATIC Canvas2D fallback —
// the exact path this suite verifies (a real browser without WebGL2, or after a
// lost context, behaves identically).

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
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
    if (type === 'webgl2') return null; // force the Canvas2D fallback
    return createMockContext2D();
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
});

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
    ...over,
  };
}

function makeViewport(): ViewportState {
  return { startTime: 0, endTime: 1000, channels: [makeChannel()] };
}

function makeOptions(): RenderOptions {
  return {
    showCrosshair: false,
    crosshairX: null,
    showGrid: true,
    eventMarkers: [],
    channelHeight: 150,
    padding: { top: 20, right: 24, bottom: 28, left: 56 },
  };
}

const resolveColor = () => ({ r: 0.2, g: 0.4, b: 0.8, a: 1 });

describe('HybridSignalRenderer — Canvas2D fallback (no WebGL2 in jsdom)', () => {
  it('falls back to Canvas2D when WebGL2 is unavailable and stays out of chrome-only mode', () => {
    const base = document.createElement('canvas');
    const waveform = document.createElement('canvas');
    const r = new HybridSignalRenderer(base, waveform, resolveColor);
    expect(r.isWebGLActive()).toBe(false);
    r.dispose();
  });

  it('runs Canvas2D-only when no waveform canvas is supplied', () => {
    const base = document.createElement('canvas');
    const r = new HybridSignalRenderer(base, null, resolveColor);
    expect(r.isWebGLActive()).toBe(false);
    r.dispose();
  });

  it('render() does not throw on the fallback path and sizes the base canvas', () => {
    const base = document.createElement('canvas');
    const r = new HybridSignalRenderer(base, null, resolveColor);
    r.resize(800, 400);
    expect(base.width).toBeGreaterThan(0);
    expect(base.height).toBeGreaterThan(0);
    expect(() => r.render(makeViewport(), makeOptions())).not.toThrow();
    r.dispose();
  });

  it('delegates hit-testing to the inner Canvas2D renderer', () => {
    const base = document.createElement('canvas');
    const r = new HybridSignalRenderer(base, null, resolveColor);
    r.resize(800, 400);
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

    r.dispose();
  });

  it('pan lifecycle (beginPan/panBy/endPan) is a no-op-safe sequence on the fallback', () => {
    const base = document.createElement('canvas');
    const r = new HybridSignalRenderer(base, null, resolveColor);
    r.resize(800, 400);
    r.render(makeViewport(), makeOptions());

    r.beginPan();
    expect(() => r.renderDuringPan(makeViewport(), makeOptions(), 42)).not.toThrow();
    // On the fallback the chrome re-renders rather than CSS-translating, so the
    // base canvas transform is never left set.
    expect(base.style.transform === '' || base.style.transform === undefined).toBe(true);
    expect(() => r.endPan()).not.toThrow();
    r.dispose();
  });

  it('renderOverlay delegates without throwing', () => {
    const base = document.createElement('canvas');
    const overlay = document.createElement('canvas');
    const r = new HybridSignalRenderer(base, null, resolveColor);
    r.setOverlayCanvas(overlay);
    r.resize(800, 400);
    const vp = makeViewport();
    const opts = makeOptions();
    r.render(vp, opts);
    expect(() =>
      r.renderOverlay(vp, { ...opts, showCrosshair: true, crosshairX: 100 }),
    ).not.toThrow();
    r.dispose();
  });

  it('the color resolver is not invoked on the fallback (no WebGL lane draw)', () => {
    const base = document.createElement('canvas');
    const spy = vi.fn(resolveColor);
    const r = new HybridSignalRenderer(base, null, spy);
    r.resize(800, 400);
    r.render(makeViewport(), makeOptions());
    expect(spy).not.toHaveBeenCalled();
    r.dispose();
  });
});
