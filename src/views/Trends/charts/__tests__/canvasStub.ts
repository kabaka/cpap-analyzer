/**
 * Shared jsdom Canvas2D stub for the Trends chart component tests.
 *
 * Under jsdom, `HTMLCanvasElement.getContext('2d')` is unimplemented and logs a
 * noisy "Not implemented" `console.error`. The Trends canvas renderer correctly
 * fails soft (it returns `null` and skips painting), so the components still
 * render their accessible HTML chrome — but the console noise pollutes the suite
 * output and could mask real errors.
 *
 * This installs a minimal `CanvasRenderingContext2D` stub (mirroring the Signal
 * Viewer's `SignalRenderer.test.ts` precedent) so `getContext('2d')` returns a
 * working mock instead of throwing/logging. It does NOT swallow other errors —
 * only the canvas context acquisition is stubbed.
 *
 * Call {@link installCanvas2DStub} once per test file (typically at module top
 * level); it registers `beforeEach`/`afterEach` hooks that install and restore
 * the prototype method around every test, so files remain isolated.
 *
 * @module views/Trends/charts/__tests__/canvasStub
 */

import { afterEach, beforeEach, vi } from 'vitest';

/** Minimal CanvasRenderingContext2D stub — every method the renderers call. */
function createMockContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas,
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 }) as TextMetrics),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    getContextAttributes: vi.fn(() => ({ alpha: true })),
  } as unknown as CanvasRenderingContext2D;
}

/**
 * Patch `HTMLCanvasElement.prototype.getContext` so `'2d'` returns a mock context
 * during this test file. Restores the original after each test. Non-2d context
 * requests fall through to the original implementation.
 */
export function installCanvas2DStub(): void {
  const original = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      ...rest: unknown[]
    ) {
      if (contextId === '2d') return createMockContext2D(this);
      return (
        original as (this: HTMLCanvasElement, id: string, ...args: unknown[]) => unknown
      ).call(this, contextId, ...rest);
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = original;
  });
}
